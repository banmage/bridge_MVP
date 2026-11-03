import { defineStore } from 'pinia';
import {
  PROTOCOL_VERSION,
  type BidCall,
  type BotPersona,
  type ChatMessage,
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
  /** 本地系统提示（房间解散、连接异常等），与玩家聊天一起展示 */
  systemMessages: ChatMessage[];
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
    systemMessages: [],
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
    /** 聊天面板展示：服务端聊天 + 本地系统提示（按时间合并） */
    chatMessages(state): ChatMessage[] {
      return [...state.systemMessages, ...(state.room?.chat ?? [])].sort((a, b) => a.at - b.at);
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
      this.clearSystemMessages();
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'createRoom', config, seat });
    },

    joinRoom(code: string, seat?: Position): void {
      this.clearError();
      this.clearSystemMessages();
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

    /** 主动托管：保留自己的座位与手牌可见性，由 AI 代叫/代打 */
    setAutoPlay(enabled: boolean): void {
      onlineSocket.send({ v: PROTOCOL_VERSION, t: 'setAutoPlay', enabled });
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

    /** 写入一条本地系统消息，进入聊天列表并标记为系统消息 */
    noteSystem(text: string): void {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message: ChatMessage = {
        id: `sys_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        from: '系统',
        seat: null,
        text: trimmed,
        system: true,
      };
      this.systemMessages = [...this.systemMessages.slice(-49), message];
    },

    clearSystemMessages(): void {
      this.systemMessages = [];
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
          // 同一身份在另一个窗口/标签页连接：服务端会以新连接为准并踢掉旧连接。
          // 旧连接必须停止自动重连，否则两个窗口会互相“踢下线”形成循环。
          if (message.code === 'DUPLICATE_SESSION') {
            onlineSocket.close();
            this.connection = 'closed';
            this.error = { code: message.code, message: message.message, at: Date.now() };
            this.noteSystem('该身份已在其他窗口连接，本窗口已断开');
            this.toasts = [
              ...this.toasts.slice(-4),
              {
                id: Date.now() + Math.random(),
                message: '该身份已在其他窗口连接，本窗口已断开',
                level: 'warn',
              },
            ];
            return;
          }
          if (message.code === 'ROOM_NOT_FOUND') {
            this.room = null;
            this.records = {};
            // 房间已解散/不存在：错误同时写入聊天，避免只看顶部提示后找不到原因
            this.noteSystem('牌室已解散或不存在');
          }
          // 比赛刚结束的瞬间，可能仍有基于旧快照的迟到动作；
          // 此时服务端已广播 finished，忽略对应的 WRONG_PHASE 提示，避免误导玩家。
          if (this.room?.status === 'finished' && message.code === 'WRONG_PHASE') return;
          // 顶部错误提示容易错过，同步写入聊天并标记为系统消息
          if (message.code !== 'ROOM_NOT_FOUND') {
            this.noteSystem(message.message);
          }
          this.error = { code: message.code, message: message.message, at: Date.now() };
          this.toasts = [
            ...this.toasts.slice(-4),
            { id: Date.now() + Math.random(), message: message.message, level: 'warn' },
          ];
          return;
        }
        case 'toast': {
          // 服务端提示同样进入聊天，避免只在顶部短暂出现
          this.noteSystem(message.message);
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
