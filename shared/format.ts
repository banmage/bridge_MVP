import type { BidCall, BidSuit, Contract } from '../src/models/gameState';

/** 与服务端/客户端共用的文案工具（不依赖 Pinia 或 Vite）。 */

export const SUIT_TEXT: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };

export function suitName(suit: BidSuit): string {
  return SUIT_TEXT[suit];
}

export const PASS_TEXT = '—';
export const FINAL_PASS_TEXT = '=';

export function describeCall(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return PASS_TEXT;
    case 'bid':
      return `${call.level}${suitName(call.suit)}`;
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
  }
}

export function describeContract(contract: Contract | null): string {
  if (!contract) return '未定约';
  const dbl = contract.redoubled ? '×4' : contract.doubled ? '×2' : '';
  return `${contract.declarer} ${contract.level}${suitName(contract.suit)}${dbl}`;
}

export function vulName(v: string): string {
  return { none: '无', NS: '南北', EW: '东西', both: '双有' }[v] ?? v;
}

/** 带符号数值格式化：+3 / -2 / 0 */
export function signed(n: number, digits = 0): string {
  const v = digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  return n > 0 ? `+${v}` : v;
}
