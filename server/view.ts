import type { Position } from '../src/models/gameState';
import { ORDER } from '../src/models/gameState';
import {
  DEFAULT_BIDDING_SYSTEMS,
  normalizeBiddingSystems,
  type BoardView,
  type MatchConfig,
  type MatchResult,
  type RoomView,
  type SeatOccupant,
} from '../shared/protocol';
import type { MatchEngine } from './match';
import type { Room } from './room';

/**
 * 视角投影：服务端发给客户端的唯一出口（宪法 II）。
 *
 * 不变量：
 * 1. yourHand 仅包含自己的手牌；
 * 2. dummyHand 仅在明手已摊牌时存在；
 * 3. revealedHands 仅在本副结算后存在；
 * 4. BoardView 不含 seed。
 */

const EMPTY_RESULT: MatchResult = {
  boardsPlayed: 0,
  nsPoints: 0,
  ewPoints: 0,
  nsImps: 0,
  nsMpPercent: 0,
  winner: 'tie',
  perBoard: [],
};

function cloneSeat(seat: SeatOccupant): SeatOccupant {
  if (seat.kind === 'open') return { kind: 'open' };
  if (seat.kind === 'human') return { ...seat };
  return { kind: 'bot', persona: { ...seat.persona, conventions: [...seat.persona.conventions] } };
}

function configOf(room: Room): MatchConfig {
  return {
    ...room.config,
    systems: normalizeBiddingSystems(room.config.systems, DEFAULT_BIDDING_SYSTEMS),
  };
}

export function projectBoardView(engine: MatchEngine, playerId: string): BoardView | null {
  const board = engine.board;
  if (!board) return null;

  const yourSeat = engine.seatOfPlayer(playerId);
  const contract = board.contract;
  const phase = board.phase;
  const scored = phase === 'scored';

  return {
    index: board.index,
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    phase,
    currentBidder: board.currentBidder,
    nextPlayer: board.nextPlayer,
    contract: contract ? { ...contract } : null,
    bidding: board.bidding.map((b) => ({
      ...b,
      call: { ...b.call },
    })),
    tricks: board.tricks.map((t) => ({
      plays: t.plays.map((p) => ({ ...p })),
      leader: t.leader,
      winner: t.winner,
    })),
    currentTrick: board.currentTrick.map((p) => ({ ...p })),
    yourSeat,
    yourHand: yourSeat && !scored ? [...board.hands[yourSeat]] : null,
    dummySeat: contract ? contract.dummy : null,
    dummyHand: contract && board.dummyOpen && !scored ? [...board.hands[contract.dummy]] : null,
    dummyOpen: board.dummyOpen,
    revealedHands: scored
      ? (Object.fromEntries(
          ORDER.map((pos) => [pos, [...board.allHands[pos]]]),
        ) as Record<Position, number[]>)
      : null,
    score: scored ? { ...board.score } : null,
    scoring: scored && board.scoring ? { ...board.scoring } : null,
    canAct: engine.canPlayerAct(playerId),
    actingForSeat: engine.canPlayerAct(playerId)
      ? phase === 'bidding'
        ? board.currentBidder
        : board.nextPlayer
      : null,
    message: board.message,
  };
}

export function projectRoomView(
  room: Room,
  playerId: string,
  now = Date.now(),
): RoomView {
  const seats = Object.fromEntries(
    ORDER.map((pos) => [pos, cloneSeat(room.seats[pos])]),
  ) as Record<Position, SeatOccupant>;
  const seat = seatOf(room, playerId);
  const name = seat && room.seats[seat].kind === 'human'
    ? room.seats[seat].name
    : '';
  const reclaimableSeat = ORDER.find((pos) => room.takeovers[pos]?.playerId === playerId) ?? null;
  const takeoverName = reclaimableSeat ? room.takeovers[reclaimableSeat]?.name ?? '' : '';

  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    you: {
      playerId,
      name: name || takeoverName,
      seat,
      ...(reclaimableSeat ? { reclaimableSeat } : {}),
      ...(seat && room.autoPlay[seat] ? { autoPlay: true } : {}),
    },
    config: configOf(room),
    seats,
    board: room.match ? projectBoardView(room.match, playerId) : null,
    completed: room.match ? room.match.completed.map((record) => room.match!.summaryOf(record)) : [],
    result: room.match ? room.match.result() : { ...EMPTY_RESULT, perBoard: [] },
    chat: room.chat.slice(-50).map((c) => ({ ...c })),
    nextBoardAt: room.nextBoardAt,
    serverTime: now,
  };
}

function seatOf(room: Room, playerId: string): Position | null {
  for (const pos of ORDER) {
    const seat = room.seats[pos];
    if (seat.kind === 'human' && seat.playerId === playerId) return pos;
  }
  return null;
}
