import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { scheduleTable } from '../shared/matchSchedule';
import { getMatchRecord, listMatches, matchesForPlayer } from './persistence';
import { GameHub, type ClientTransport } from './protocolHandlers';
import { RoomManager } from './room';

/**
 * HTTP + WebSocket 入口。
 *
 * - `/ws`：实时对局协议（见 contracts/protocol.md）
 * - `/api/*`：健康检查、轮转表、比赛记录
 * - 生产模式托管 `dist/`，SPA fallback 到 index.html
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const DIST_DIR = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
const VERSION = pkg.version ?? '0.0.0';
const startedAt = Date.now();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

const hub = new GameHub({
  aiDelayMs: Number(process.env.AI_DELAY_MS ?? 700),
  takeoverMs: Number(process.env.BOT_TAKEOVER_MS ?? 60_000),
  rooms: new RoomManager({
    autoNextMs: Number(process.env.AUTO_NEXT_MS ?? 10_000),
  }),
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  if (!pathname.startsWith('/api/')) return false;

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      rooms: hub.rooms.rooms.size,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    });
    return true;
  }

  if (pathname === '/api/match-schedule') {
    sendJson(res, 200, { boards: scheduleTable(16) });
    return true;
  }

  if (pathname === '/api/matches') {
    const limit = Number(url.searchParams.get('limit') ?? 10);
    sendJson(res, 200, { matches: listMatches(Number.isFinite(limit) ? limit : 10) });
    return true;
  }

  const matchDetail = pathname.match(/^\/api\/matches\/([^/]+)$/);
  if (matchDetail) {
    const record = getMatchRecord(decodeURIComponent(matchDetail[1]));
    if (!record) {
      sendJson(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    sendJson(res, 200, { schemaVersion: 1, match: record });
    return true;
  }

  const playerMatches = pathname.match(/^\/api\/players\/([^/]+)\/matches$/);
  if (playerMatches) {
    const limit = Number(url.searchParams.get('limit') ?? 10);
    sendJson(res, 200, {
      matches: matchesForPlayer(decodeURIComponent(playerMatches[1]), Number.isFinite(limit) ? limit : 10),
    });
    return true;
  }

  sendJson(res, 404, { error: 'NOT_FOUND' });
  return true;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (!existsSync(DIST_DIR)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：请先运行 npm run build，或在开发模式使用 Vite。');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = resolve(DIST_DIR, normalize(rel));
  if (!file.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback：仅对无扩展名路径返回 index.html
    if (extname(rel) === '') {
      file = join(DIST_DIR, 'index.html');
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
  }

  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (handleApi(req, res, url.pathname, url)) return;
  serveStatic(req, res, url.pathname);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

interface AuthedSocket extends WebSocket {
  playerId?: string;
  lastSeenAt?: number;
}

function wsTransport(ws: WebSocket): ClientTransport {
  return {
    send(message) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    close() {
      try {
        ws.close();
      } catch {
        // 已关闭
      }
    },
  };
}

wss.on('connection', (ws: AuthedSocket) => {
  const transport = wsTransport(ws);
  let authenticated = false;

  ws.on('message', (data) => {
    ws.lastSeenAt = Date.now();
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      transport.send({ v: PROTOCOL_VERSION, t: 'error', code: 'BAD_REQUEST', message: '报文不是合法 JSON' });
      return;
    }

    if (!authenticated) {
      const msg = parsed as { t?: string; playerId?: string; name?: string; token?: string; v?: number };
      if (!msg || msg.t !== 'hello' || !msg.playerId || !msg.token) {
        transport.send({ v: PROTOCOL_VERSION, t: 'error', code: 'AUTH_FAILED', message: '首条报文必须是 hello' });
        transport.close();
        return;
      }
      const ok = hub.connect(msg.playerId, msg.token, msg.name ?? msg.playerId, transport);
      if (!ok) return;
      authenticated = true;
      ws.playerId = msg.playerId;
      return;
    }

    if (!ws.playerId) return;
    hub.receive(ws.playerId, parsed);
  });

  ws.on('close', () => {
    if (ws.playerId) hub.disconnect(ws.playerId, transport);
  });

  ws.on('error', () => {
    if (ws.playerId) hub.disconnect(ws.playerId, transport);
  });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// 心跳回收：60 秒无报文视为断线（保留座位，等待重连）
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients as Set<AuthedSocket>) {
    if (ws.lastSeenAt && now - ws.lastSeenAt > 60_000) ws.terminate();
  }
}, 30_000);
heartbeat.unref?.();

// 自动开下一副
const ticker = setInterval(() => hub.tick(), 1000);
ticker.unref?.();

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[bridge] server listening on http://${HOST}:${PORT} (ws: /ws, api: /api)`);
});

function shutdown(): void {
  clearInterval(heartbeat);
  clearInterval(ticker);
  hub.closeAll();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server, hub };
