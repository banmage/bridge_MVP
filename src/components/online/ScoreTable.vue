<script setup lang="ts">
import { computed } from 'vue';
import type { RoomView } from '@shared/protocol';
import { signed } from '@shared/format';

const props = defineProps<{ room: RoomView }>();
const emit = defineEmits<{ (e: 'replay', index: number): void }>();

const result = computed(() => props.room.result);
const rows = computed(() => props.room.completed);
const isMp = computed(() => props.room.config.scoring === 'mp');

const winnerText = computed(() => {
  const w = result.value.winner;
  if (result.value.boardsPlayed === 0) return '尚无成绩';
  if (w === 'tie') return '双方打平';
  return `${w === 'NS' ? '南北' : '东西'} 获胜`;
});

function fmt(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
</script>

<template>
  <section class="score-table">
    <header class="score-head">
      <div>
        <h3>成绩</h3>
        <p class="sub">
          已完成 {{ result.boardsPlayed }} / {{ room.config.boards }} 副 ·
          {{ isMp ? '双人赛 MP' : '贴点制' }} · {{ winnerText }}
        </p>
      </div>
      <div class="totals">
        <span>NS 点数 <strong>{{ fmt(result.nsPoints) }}</strong></span>
        <span>NS IMP <strong>{{ fmt(result.nsImps) }}</strong></span>
        <span v-if="isMp">平均 MP <strong>{{ result.nsMpPercent }}%</strong></span>
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
          <tr v-for="row in rows" :key="row.index">
            <td>{{ row.index }}</td>
            <td>{{ row.contract ?? '—' }}</td>
            <td>{{ row.declarerTricks }}</td>
            <td>{{ row.score.NS }}</td>
            <td>{{ row.score.EW }}</td>
            <td :class="{ pos: row.imp > 0, neg: row.imp < 0 }">{{ signed(row.imp) }}</td>
            <td :class="{ pos: row.points > 0, neg: row.points < 0 }">{{ signed(row.points) }}</td>
            <td v-if="isMp">{{ row.mpPercent ?? '—' }}</td>
            <td>
              <el-button size="small" text type="primary" @click="emit('replay', row.index)">查看</el-button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="isMp ? 9 : 8" class="empty">还没有完成的副</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="note">
      MP 模式每副由同一发牌生成 7 桌机器人对照场；贴点制点数 =
      IMP −（胜方联手大牌点 − 20）。
    </p>
  </section>
</template>

<style scoped>
.score-table {
  background: var(--paper);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
}
.score-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.score-head h3 {
  margin: 0 0 3px;
  color: var(--felt-dark);
  font-size: 16px;
}
.sub {
  margin: 0;
  font-size: 12px;
  color: #6b7a71;
}
.totals {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #5a6a61;
}
.totals strong {
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
  font-weight: 600;
}
td.pos {
  color: #1f7a4d;
  font-weight: 700;
}
td.neg {
  color: #b23b2e;
  font-weight: 700;
}
td.empty {
  color: #8a978f;
  padding: 18px;
}
.note {
  margin: 10px 0 0;
  font-size: 11px;
  color: #7b897f;
}
</style>
