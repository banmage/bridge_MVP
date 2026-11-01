/** 浏览器侧比赛记录查询（与 contracts/http-api.md 对齐） */

export interface MatchSummary {
  id: string;
  finishedAt: number;
  config: { boards: number; scoring: string };
  players: string[];
  result: { boardsPlayed: number; nsMpPercent: number; nsPoints: number; winner: string };
}

export interface ApiBoardRecord {
  index: number;
  seed: number;
  dealer: 'N' | 'E' | 'S' | 'W';
  vulnerability: 'none' | 'NS' | 'EW' | 'both';
  hands: Record<'N' | 'E' | 'S' | 'W', number[]>;
  bidding: import('@shared/protocol').BidRecord[];
  tricks: import('@shared/protocol').Trick[];
  contract: import('@shared/protocol').Contract | null;
  declarerTricks: number;
  score: { NS: number; EW: number };
  scoring: import('@shared/protocol').BoardScoring;
}

export interface ApiMatchRecord {
  id: string;
  roomCode: string;
  hostId: string;
  startedAt: number;
  finishedAt: number;
  config: { boards: number; scoring: string; seedBase: number; matchId: string };
  players: Array<{ seat: 'N' | 'E' | 'S' | 'W'; name: string; kind: 'human' | 'bot'; playerId?: string }>;
  result: import('@shared/protocol').MatchResult;
  boards: ApiBoardRecord[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return (await response.json()) as T;
}

export async function fetchRecentMatches(limit = 10): Promise<MatchSummary[]> {
  const data = await getJson<{ matches: MatchSummary[] }>(`/api/matches?limit=${limit}`);
  return data.matches;
}

export async function fetchPlayerMatches(playerId: string, limit = 10): Promise<MatchSummary[]> {
  const data = await getJson<{ matches: MatchSummary[] }>(
    `/api/players/${encodeURIComponent(playerId)}/matches?limit=${limit}`,
  );
  return data.matches;
}

export async function fetchMatch(id: string): Promise<ApiMatchRecord> {
  const data = await getJson<{ schemaVersion: number; match: ApiMatchRecord }>(
    `/api/matches/${encodeURIComponent(id)}`,
  );
  return data.match;
}
