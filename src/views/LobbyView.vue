<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  BOARD_COUNT_OPTIONS,
  SCORING_LABELS,
  type BoardCount,
  type Position,
  type ScoringMode,
} from '@shared/protocol';
import { useOnlineStore } from '../store/online';
import { fetchRecentMatches, fetchPlayerMatches, type MatchSummary } from '../net/api';

const store = useOnlineStore();
const router = useRouter();

const nickname = ref(store.identity?.name ?? '');
const boards = ref<BoardCount>(12);
const scoring = ref<ScoringMode>('mp');
const seat = ref<Position>('S');
const joinCode = ref('');
const joinSeat = ref<Position | ''>('');
const matches = ref<MatchSummary[]>([]);
const loadingMatches = ref(false);

const POSITIONS: Array<{ value: Position; label: string }> = [
  { value: 'N', label: '北' },
  { value: 'E', label: '东' },
  { value: 'S', label: '南' },
  { value: 'W', label: '西' },
];
const SCORINGS = Object.keys(SCORING_LABELS) as ScoringMode[];

const connectionText = computed(
  () =>
    ({
      idle: '未连接',
      connecting: '连接中…',
      open: '已连接',
      reconnecting: '正在重连…',
      closed: '已断开',
    })[store.connection] ?? store.connection,
);

onMounted(async () => {
  store.init();
  nickname.value = store.identity?.name ?? nickname.value;
  await Promise.all([refreshMatches(), refreshMine()]);
});

watch(
  () => store.room?.code,
  (code) => {
    if (code) router.push(`/room/${code}`);
  },
);

watch(
  () => nickname.value,
  (name) => {
    if (name.trim() && name.trim() !== store.identity?.name) store.setName(name);
  },
);

async function refreshMatches(): Promise<void> {
  loadingMatches.value = true;
  try {
    matches.value = await fetchRecentMatches(8);
  } catch {
    matches.value = [];
  } finally {
    loadingMatches.value = false;
  }
}

async function refreshMine(): Promise<void> {
  if (!store.identity) return;
  try {
    const mine = await fetchPlayerMatches(store.identity.playerId, 5);
    if (mine.length > 0) {
      const ids = new Set(matches.value.map((m) => m.id));
      matches.value = [...mine.filter((m) => !ids.has(m.id)), ...matches.value].slice(0, 8);
    }
  } catch {
    // 服务端未启动时忽略
  }
}

function onCreate(): void {
  store.setName(nickname.value);
  store.createRoom({ boards: boards.value, scoring: scoring.value }, seat.value);
}

function onJoin(): void {
  store.setName(nickname.value);
  store.joinRoom(
    joinCode.value,
    joinSeat.value === '' ? undefined : (joinSeat.value as Position),
  );
}

function backToRoom(): void {
  if (store.room) router.push(`/room/${store.room.code}`);
}

function openMatch(id: string): void {
  router.push(`/matches/${id}`);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="lobby">
    <header class="lobby-header">
      <div>
        <h1><span class="suit-symbol">♠</span> 桥牌 MVP · 联网双人赛 <span class="suit-red suit-symbol">♥</span></h1>
        <p class="subtitle">与朋友或 AI 组队，完成 12/18/24 副双人赛或贴点制比赛</p>
      </div>
      <div class="header-actions">
        <span class="connection" :class="store.connection">{{ connectionText }}</span>
        <router-link to="/solo"><el-button>单人对战</el-button></router-link>
        <router-link to="/matches"><el-button>历史比赛</el-button></router-link>
      </div>
    </header>

    <el-alert
      v-if="store.error"
      class="error-bar"
      type="error"
      :title="store.error.message"
      :closable="true"
      @close="store.clearError()"
    />

    <div v-if="store.room && store.room.status !== 'finished'" class="resume">
      <span>你有一个进行中的房间 <strong>{{ store.room.code }}</strong></span>
      <el-button type="primary" size="small" @click="backToRoom">回到牌桌</el-button>
    </div>

    <div class="lobby-grid">
      <section class="card create-card">
        <h2>创建房间</h2>
        <label>
          昵称
          <el-input v-model="nickname" maxlength="20" show-word-limit placeholder="你的昵称" />
        </label>
        <label>
          比赛副数
          <el-select v-model="boards">
            <el-option v-for="n in BOARD_COUNT_OPTIONS" :key="n" :label="`${n} 副`" :value="n" />
          </el-select>
        </label>
        <label>
          计分模式
          <el-select v-model="scoring">
            <el-option v-for="mode in SCORINGS" :key="mode" :label="SCORING_LABELS[mode]" :value="mode" />
          </el-select>
        </label>
        <label>
          我的座位
          <el-radio-group v-model="seat">
            <el-radio-button v-for="p in POSITIONS" :key="p.value" :value="p.value">{{ p.label }}</el-radio-button>
          </el-radio-group>
        </label>
        <el-button type="primary" size="large" :disabled="!nickname.trim()" @click="onCreate">
          创建并进入房间
        </el-button>
        <p class="tip">创建后可在房间里把空位设为 AI 机器人，或把房间码发给朋友。</p>
      </section>

      <section class="card join-card">
        <h2>加入房间</h2>
        <label>
          房间码
          <el-input
            v-model="joinCode"
            maxlength="6"
            placeholder="6 位字母数字"
            class="code-input"
            @keyup.enter="onJoin"
          />
        </label>
        <label>
          座位（可选）
          <el-select v-model="joinSeat" clearable placeholder="自动选择空位">
            <el-option v-for="p in POSITIONS" :key="p.value" :label="`${p.label} 座`" :value="p.value" />
          </el-select>
        </label>
        <el-button size="large" :disabled="joinCode.trim().length !== 6 || !nickname.trim()" @click="onJoin">
          输入房间码加入
        </el-button>
        <p class="tip">若比赛已开始，只有原座位玩家可用同一设备重连。</p>
      </section>

      <section class="card matches-card">
        <header class="card-head">
          <h2>最近比赛</h2>
          <el-button text size="small" :loading="loadingMatches" @click="refreshMatches">刷新</el-button>
        </header>
        <ul v-if="matches.length" class="match-list">
          <li v-for="match in matches" :key="match.id" @click="openMatch(match.id)">
            <div class="match-top">
              <strong>{{ match.players.join(' / ') }}</strong>
              <span class="winner" :class="match.result.winner">
                {{ match.result.winner === 'tie' ? '平' : `${match.result.winner} 胜` }}
              </span>
            </div>
            <div class="match-sub">
              {{ match.config.boards }} 副 · {{ match.config.scoring === 'mp' ? 'MP' : '贴点制' }} ·
              {{ match.result.boardsPlayed }} 副完成 · {{ fmtTime(match.finishedAt) }}
            </div>
          </li>
        </ul>
        <p v-else class="empty">还没有已完成的比赛。先创建一间房吧。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lobby-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  color: #eaf5ee;
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(6, 32, 21, 0.68), rgba(4, 24, 16, 0.42));
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.lobby-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.lobby-header .suit-red {
  color: #ff7b6b;
}
.subtitle {
  margin: 0;
  font-size: 12px;
  color: rgba(234, 245, 238, 0.75);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.connection {
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.connection.open {
  color: #9ef0bd;
}
.connection.reconnecting,
.connection.connecting {
  color: #ffe19a;
}
.connection.closed {
  color: #ffb4a7;
}
.error-bar {
  border-radius: 12px;
}
.resume {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 225, 154, 0.14);
  border: 1px solid rgba(255, 225, 154, 0.45);
  color: #ffe19a;
  font-size: 13px;
}
.lobby-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.card {
  background: var(--paper);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card h2 {
  margin: 0;
  font-size: 16px;
  color: var(--felt-dark);
}
.card > label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #5a6a61;
}
.tip {
  margin: 0;
  font-size: 11px;
  color: #8a978f;
  line-height: 1.5;
}
.code-input :deep(input) {
  letter-spacing: 4px;
  text-transform: uppercase;
  font-weight: 700;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.match-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 330px;
  overflow: auto;
}
.match-list li {
  padding: 8px 10px;
  border-radius: 9px;
  background: #f1f6f2;
  cursor: pointer;
  transition: background 0.15s ease;
}
.match-list li:hover {
  background: #e5f0e8;
}
.match-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.winner {
  font-size: 12px;
  font-weight: 700;
  color: #14563a;
}
.winner.EW {
  color: #8a3d12;
}
.match-sub {
  margin-top: 3px;
  font-size: 11px;
  color: #7b897f;
}
.empty {
  margin: 0;
  font-size: 12px;
  color: #8a978f;
}
@media (max-width: 980px) {
  .lobby-grid {
    grid-template-columns: 1fr;
  }
}
</style>
