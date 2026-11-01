import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { PROTOCOL_VERSION } from '../../shared/protocol';

/**
 * 带自动重连与心跳的 WebSocket 客户端。
 *
 * - 单例连接，事件通过订阅分发；
 * - 断线后指数退避重连（最长 5 秒），重连成功自动重发 hello；
 * - 20 秒心跳，服务端 60 秒无消息视为断线。
 */

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface Identity {
  playerId: string;
  name: string;
  token: string;
}

const STORAGE_KEY = 'bridge.identity.v1';
const HEARTBEAT_MS = 20_000;
const MAX_RECONNECT_MS = 5_000;

function randomHex(bytes = 16): string {
  const view = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(view);
  } else {
    for (let i = 0; i < bytes; i += 1) view[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(view, (b) => b.toString(16).padStart(2, '0')).join('');
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${randomHex(4)}-${randomHex(2)}-${randomHex(2)}-${randomHex(2)}-${randomHex(6)}`;
}

/** 读取/创建本机设备身份（localStorage） */
export function loadIdentity(): Identity {
  let stored: Partial<Identity> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? (JSON.parse(raw) as Partial<Identity>) : null;
  } catch {
    stored = null;
  }
  const identity: Identity = {
    playerId: stored?.playerId || uuid(),
    name: stored?.name || '玩家',
    token: stored?.token || randomHex(16),
  };
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // 隐私模式/存储已满时忽略
  }
}

export function socketUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787/ws';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class OnlineSocket {
  private ws: WebSocket | null = null;
  private identity: Identity | null = null;
  private messageListeners = new Set<(msg: ServerMessage) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private state: ConnectionState = 'idle';
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private manualClose = false;

  getState(): ConnectionState {
    return this.state;
  }

  connect(identity: Identity): void {
    this.identity = identity;
    this.manualClose = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.open();
  }

  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  /** 更新昵称并持久化，下一次 hello 会带上 */
  setName(name: string): void {
    if (!this.identity) return;
    this.identity = { ...this.identity, name };
    saveIdentity(this.identity);
  }

  close(): void {
    this.manualClose = true;
    this.stopTimers();
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  private open(): void {
    if (typeof WebSocket === 'undefined' || !this.identity) {
      this.setState('closed');
      return;
    }
    this.setState(this.attempts > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setState('open');
      const identity = this.identity!;
      this.send({
        v: PROTOCOL_VERSION,
        t: 'hello',
        playerId: identity.playerId,
        name: identity.name,
        token: identity.token,
      });
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!message || typeof message.t !== 'string') return;
      for (const listener of this.messageListeners) listener(message);
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (this.manualClose) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose 会紧随其后处理重连
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ v: PROTOCOL_VERSION, t: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.attempts += 1;
    this.setState('reconnecting');
    const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** Math.min(this.attempts, 4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private stopTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

/** 全局单例：同一页面共享一个连接 */
export const onlineSocket = new OnlineSocket();
