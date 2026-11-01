import { defineStore } from 'pinia';
import {
  PROTOCOL_VERSION,
  type BidCall,
  type BotPersona,
  type ErrorCode,
  type Position,
  type RoomConfigInput,
  type RoomView,
  type ServerMessage,
} from '@shared/protocol';
import { loadIdentity, onlineSocket, saveIdentity, type ConnectionState, type Identity } from '../net/socket';
import { replayFromBoardView, type ReplayBoard } from '../models/replay';

/**
 * 在线对局状态：只保存服务端快照与本地意图，不自行推导对局状态。
 * 所有动作都通过 WebSocket 发送，由服务端校验并广播新快照。
 */

export interface OnlineError {
  code: ErrorCode;
  message: string;
  at: number;
}

export interface OnlineToast {
  id: number;
  message: string;
  level: 'info' | 'warn';
}

interface OnlineState {
  identity: Identity | null;
  connection: ConnectionState;
  room: RoomView | null;
  error: OnlineError | null;
  toasts: OnlineToast[];
  /** 本局内已完成副的完整快照（用于复盘） */
  records: Record<number, ReplayBoard>;
  bound: boolean;
}

function asPosition(value: unknown): Position | null {
  return value === 'N' || value === 'E' || value === 'S' || value === 'W' ? value : null;
}

export const useOnlineStore = defineStore('online', {
  state: (): OnlineState => ({
    identity: null,
    connection: 'idle',
    room: null,
    error: null,
    toasts: [],
    records: {},
    bound: false,
  }),

  getters: {
    mySeat(state): Position | null {
      return state.room?.you.seat ?? null;
    },
    isHost(state): boolean {
      return !!state.room && !!state.identity && state.room.hostId === state.identity.playerId;
    },
    isMyTurn(state): boolean {
      return !!state.room?.board?.canAct;
    },
    allSeatsFilled(state): boolean {
      if (!state.room) return false;
      return (['N', 'E', 'S', 'W'] as Position[]).every(
        (pos) => state.room!.seats[pos].kind !== 'open',
      );
    },
    replayBoards(state): ReplayBoard[] {
      return Object.values(state.records).sort((a, b) => a.index - b.index);
    },
    inProgress(state): boolean {
      return !!state.room && state.room.status !== 'finished';
    },
  },

  actions: {
    /** 页面初始化：载入设备身份并建立连接（幂等） */
    init(): void {
      if (!this.identity) {
        this.identity = loadIdentity();
      }
      if (!this.bound) {
        this.bound = true;
        onlineSocket.onMessage((message) => this.handleMessage(message));
        onlineSocket.onState((state) => {
          this.connection = state;
        });
      }
      onlineSocket.connect(this.identity);
    },

    connect(): void {
      this.init();
      onlineSocket.connect(this.identity!);
    },

    disconnect(): void {
      onlineSocket.close();
      this.connection = 'closed';
    },

    setName(name: string): void {
      const trimmed = name.trim().slice(0, 20);
      if (!trimmed || !this.identity) return;
      this.identity = { ...this.identity, name: trimmed };
      saveIdentity(this.identity);
      onlineSocket.setName(trimmed);
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'setName', name: trimmed });
    },

    createRoom(config: RoomConfigInput, seat: Position): void {
      this.clearError();
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'createRoom', config, seat });
    },

    joinRoom(code: string, seat?: Position): void {
      this.clearError();
      onlineSocket.send({
        v: PROTOCOL_VERSION,
        t: 'joinRoom',
        code: code.trim().toUpperCase(),
        ...(seat ? { seat } : {}),
      });
    },

    leaveRoom(): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'leaveRoom' });
      this.room = null;
      this.records = {};
    },

    setSeat(seat: Position, occupant: { kind: 'open' } | { kind: 'bot'; persona: BotPersona }): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'setSeat', seat, occupant });
    },

    updateBot(seat: Position, persona: BotPersona): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'updateBot', seat, persona });
    },

    setConfig(config: RoomConfigInput): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'setConfig', config });
    },

    startMatch(): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'startMatch' });
    },

    submitBid(call: BidCall, alert?: { text: string }): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'bid', call, ...(alert ? { alert } : {}) });
    },

    submitPlay(card: number): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'play', card });
    },

    nextBoard(): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'nextBoard' });
    },

    chat(text: string): void {
      const trimmed = text.trim();
      if (trimmed) onlineSocket.send({ v: PROTOCOL_VERSION, t: 'chat', text: trimmed });
    },

    requestState(): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'requestState' });
    },

    clearError(): void {
      this.error = null;
    },

    dismissToast(id: number): void {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    handleMessage(message: ServerMessage): void {
      switch (message.t) {
        case 'hello': {
          if (this.identity && message.name && message.name !== this.identity.name) {
            this.identity = { ...this.identity, name: message.name };
            saveIdentity(this.identity);
          }
          // 重连后服务端只记得身份，不记得房间；主动回到原房间
          if (this.room?.code) {
            onlineSocket.send({ v: PROTOCOL_VERSION, t: 'joinRoom', code: this.room.code });
          }
          return;
        }
        case 'room': {
          this.room = message.room;
          const board = message.room.board;
          if (board && board.phase === 'scored') {
            const replay = replayFromBoardView(board);
            if (replay) this.records = { ...this.records, [board.index]: replay };
          }
          return;
        }
        case 'error': {
          // 比赛刚结束的瞬间，可能仍有基于旧快照的迟到动作；
          // 此时服务端已广播 finished，忽略对应的 WRONG_PHASE 提示，避免误导玩家。
          if (this.room?.status === 'finished' && message.code === 'WRONG_PHASE') return;
          this.error = { code: message.code, message: message.message, at: Date.now() };
          this.toasts = [
            ...this.toasts.slice(-4),
            { id: Date.now() + Math.random(), message: message.message, level: 'warn' },
          ];
          return;
        }
        case 'toast': {
          this.toasts = [
            ...this.toasts.slice(-4),
            { id: Date.now() + Math.random(), message: message.message, level: message.level ?? 'info' },
          ];
          return;
        }
        case 'pong':
          return;
        default:
          return;
      }
    },

    /** 便捷：返回指定座位的显示名 */
    seatName(seat: Position): string {
      const seatView = this.room?.seats[seat];
      if (!seatView) return seat;
      if (seatView.kind === 'human') return seatView.name;
      if (seatView.kind === 'bot') return seatView.persona.name;
      return '空位';
    },

    seatOfMe(): Position | null {
      return asPosition(this.room?.you.seat ?? null);
    },
  },
});
