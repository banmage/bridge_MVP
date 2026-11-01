import type {
  BidRecord,
  CardPlay,
  Contract,
  Position,
  Trick,
} from './gameState';
import type { BoardScoring, Vulnerability, BoardView } from '../../shared/protocol';

/** 单副回放数据：在线房间与历史比赛共用 */
export interface ReplayBoard {
  index: number;
  dealer: Position;
  vulnerability: Vulnerability;
  hands: Record<Position, number[]>;
  bidding: BidRecord[];
  tricks: Trick[];
  currentTrick?: CardPlay[];
  contract: Contract | null;
  declarerTricks: number;
  score: { NS: number; EW: number };
  scoring: BoardScoring | null;
}

function sideOf(pos: Position): 'NS' | 'EW' {
  return pos === 'N' || pos === 'S' ? 'NS' : 'EW';
}

/** 从结算后的 BoardView 生成本地回放记录 */
export function replayFromBoardView(view: BoardView): ReplayBoard | null {
  if (!view.revealedHands) return null;
  const declSide = view.contract ? sideOf(view.contract.declarer) : null;
  return {
    index: view.index,
    dealer: view.dealer,
    vulnerability: view.vulnerability,
    hands: view.revealedHands,
    bidding: view.bidding,
    tricks: view.tricks,
    currentTrick: view.currentTrick,
    contract: view.contract,
    declarerTricks: declSide
      ? view.tricks.filter((t) => sideOf(t.winner) === declSide).length
      : 0,
    score: view.score ?? { NS: 0, EW: 0 },
    scoring: view.scoring,
  };
}
