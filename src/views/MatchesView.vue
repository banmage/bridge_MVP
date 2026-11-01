<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { signed } from '@shared/format';
import type { ReplayBoard } from '../models/replay';
import {
  fetchMatch,
  fetchRecentMatches,
  type ApiMatchRecord,
  type MatchSummary,
} from '../net/api';
import BoardReplayDialog from '../components/online/BoardReplayDialog.vue';

const props = defineProps<{ id?: string }>();
const router = useRouter();

const matches = ref<MatchSummary[]>([]);
const detail = ref<ApiMatchRecord | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const replayVisible = ref(false);
const replayBoard = ref<ReplayBoard | null>(null);

const isMp = computed(() => detail.value?.config.scoring === 'mp');

onMounted(load);

watch(() => props.id, load);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    matches.value = await fetchRecentMatches(20);
    detail.value = props.id ? await fetchMatch(props.id) : null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

function openMatch(id: string): void {
  router.push(`/matches/${id}`);
}

function backToList(): void {
  router.push('/matches');
}

function replayBoardOf(index: number): ReplayBoard | null {
  const board = detail.value?.boards.find((b) => b.index === index);
  if (!board) return null;
  return {
    index: board.index,
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    hands: board.hands,
    bidding: board.bidding,
    tricks: board.tricks,
    contract: board.contract,
    declarerTricks: board.declarerTricks,
    score: board.score,
    scoring: board.scoring,
  };
}

function openReplay(index: number): void {
  replayBoard.value = replayBoardOf(index);
  replayVisible.value = true;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function winnerText(winner: string): string {
  return winner === 'tie' ? '双方打平' : `${winner === 'NS' ? '南北' : '东西'} 获胜`;
}
</script>

<template>
  <div class="matches-view">
    <header class="matches-header">
      <div>
        <router-link to="/" class="back">← 大厅</router-link>
        <h1><span class="suit-symbol">♠</span> 历史比赛 <span class="suit-red suit-symbol">♥</span></h1>
      </div>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </header>

    <el-alert v-if="error" type="error" :title="error" :closable="true" @close="error = null" />

    <template v-if="detail">
      <section class="card detail">
        <header class="detail-head">
          <div>
            <el-button text size="small" @click="backToList">← 返回列表</el-button>
            <h2>{{ detail.players.map((p) => p.name).join(' / ') }}</h2>
            <p class="sub">
              {{ detail.config.boards }} 副 · {{ detail.config.scoring === 'mp' ? '双人赛 MP' : '贴点制' }} ·
              {{ fmtTime(detail.finishedAt) }} · 房间 {{ detail.roomCode }}
            </p>
          </div>
          <div class="result-box">
            <strong>{{ winnerText(detail.result.winner) }}</strong>
            <span>NS 点数 {{ signed(detail.result.nsPoints) }}</span>
            <span>NS IMP {{ signed(detail.result.nsImps) }}</span>
            <span v-if="isMp">平均 MP {{ detail.result.nsMpPercent }}%</span>
          </div>
        </header>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>副</th>
                <th>定约</th>
                <th>赢墩</th>
                <th>NS</th>
                <th>EW</th>
                <th>IMP</th>
                <th>点数</th>
                <th v-if="isMp">MP%</th>
                <th>复盘</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in detail.result.perBoard" :key="row.index">
                <td>{{ row.index }}</td>
                <td>{{ row.contract ?? '—' }}</td>
                <td>{{ row.declarerTricks }}</td>
                <td>{{ row.score.NS }}</td>
                <td>{{ row.score.EW }}</td>
                <td>{{ signed(row.imp) }}</td>
                <td>{{ signed(row.points) }}</td>
                <td v-if="isMp">{{ row.mpPercent ?? '—' }}</td>
                <td>
                  <el-button text size="small" type="primary" @click="openReplay(row.index)">查看</el-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="players">
          <span v-for="player in detail.players" :key="player.seat">
            {{ player.seat }}：{{ player.name }}
            <em>{{ player.kind === 'bot' ? 'AI' : '真人' }}</em>
          </span>
        </div>
      </section>
    </template>

    <section v-else class="card list">
      <h2>最近完成的比赛</h2>
      <ul v-if="matches.length" class="match-list">
        <li v-for="match in matches" :key="match.id" @click="openMatch(match.id)">
          <div class="match-top">
            <strong>{{ match.players.join(' / ') }}</strong>
            <span class="winner">{{ winnerText(match.result.winner) }}</span>
          </div>
          <div class="match-sub">
            {{ match.config.boards }} 副 · {{ match.config.scoring === 'mp' ? 'MP' : '贴点制' }} ·
            {{ match.result.boardsPlayed }} 副完成 · {{ fmtTime(match.finishedAt) }}
          </div>
        </li>
      </ul>
      <p v-else class="empty">还没有已完成的比赛。</p>
    </section>

    <BoardReplayDialog v-model:visible="replayVisible" :board="replayBoard" />
  </div>
</template>

<style scoped>
.matches-view {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.matches-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: #eaf5ee;
  padding: 12px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(6, 32, 21, 0.68), rgba(4, 24, 16, 0.42));
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.matches-header h1 {
  display: inline-block;
  margin: 0 0 0 10px;
  font-size: 19px;
}
.matches-header .suit-red {
  color: #ff7b6b;
}
.back {
  color: #9ef0bd;
  text-decoration: none;
  font-size: 13px;
}
.card {
  background: var(--paper);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
}
.card h2 {
  margin: 0 0 6px;
  font-size: 17px;
  color: var(--felt-dark);
}
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.sub {
  margin: 0;
  font-size: 12px;
  color: #6b7a71;
}
.result-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: #5a6a61;
  text-align: right;
}
.result-box strong {
  font-size: 15px;
  color: #14563a;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 6px 8px;
  text-align: center;
  border-bottom: 1px solid #e5ebe7;
}
th {
  background: #eef4ef;
  color: #44544b;
}
.players {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 12px;
  color: #5a6a61;
}
.players em {
  font-style: normal;
  color: #8a978f;
  margin-left: 4px;
}
.match-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.match-list li {
  padding: 9px 11px;
  border-radius: 9px;
  background: #f1f6f2;
  cursor: pointer;
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
</style>
