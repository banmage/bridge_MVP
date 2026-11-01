<script setup lang="ts">
import { computed } from 'vue';
import type { Position } from '../../models/gameState';
import type { ReplayBoard } from '../../models/replay';
import { describeContract, signed, vulName } from '@shared/format';
import { sortHand } from '../../models/hand';
import { getSuit } from '../../models/card';
import PlayingCard from '../PlayingCard.vue';

const props = defineProps<{
  visible: boolean;
  board: ReplayBoard | null;
}>();
const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>();

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];
const SEAT_LABEL: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };
const SUIT_ROWS: Array<{ suit: number; label: string; red: boolean }> = [
  { suit: 3, label: '♠', red: false },
  { suit: 2, label: '♥', red: true },
  { suit: 0, label: '♣', red: false },
  { suit: 1, label: '♦', red: true },
];

const hands = computed(() => {
  if (!props.board) return null;
  const result: Record<Position, ReturnType<typeof sortHand>> = {} as Record<
    Position,
    ReturnType<typeof sortHand>
  >;
  for (const pos of POSITIONS) result[pos] = sortHand(props.board.hands[pos] ?? []);
  return result;
});

function cardsOf(pos: Position, suit: number): number[] {
  return hands.value?.[pos].filter((card) => getSuit(card) === suit) ?? [];
}

function declarerTricks(): number {
  if (!props.board?.contract) return 0;
  const declarer = props.board.contract.declarer;
  const side = declarer === 'N' || declarer === 'S' ? 'NS' : 'EW';
  return props.board.tricks.filter((t) =>
    side === 'NS' ? t.winner === 'N' || t.winner === 'S' : t.winner === 'E' || t.winner === 'W',
  ).length;
}

function close(): void {
  emit('update:visible', false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="board ? `第 ${board.index} 副复盘` : '复盘'"
    width="920px"
    top="6vh"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <template v-if="board">
      <div class="replay-meta">
        <span>庄家 {{ board.dealer }}</span>
        <span>局况 {{ vulName(board.vulnerability) }}</span>
        <span>定约 {{ board.contract ? describeContract(board.contract) : '流局' }}</span>
        <span>定约方 {{ declarerTricks() }} 墩</span>
        <span>NS {{ board.score.NS }} / EW {{ board.score.EW }}</span>
        <span v-if="board.scoring">
          IMP {{ signed(board.scoring.imp) }} · 点数 {{ signed(board.scoring.points) }}
        </span>
        <span v-if="board.scoring?.mpPercent !== undefined">MP {{ board.scoring.mpPercent }}%</span>
      </div>

      <div class="hands-grid">
        <article v-for="pos in POSITIONS" :key="pos" class="replay-hand">
          <header>
            <strong>{{ SEAT_LABEL[pos] }}</strong>
            <span>{{ pos }}</span>
          </header>
          <div v-for="row in SUIT_ROWS" :key="row.suit" class="suit-line">
            <span class="suit" :class="{ red: row.red }">{{ row.label }}</span>
            <div class="cards">
              <PlayingCard
                v-for="card in cardsOf(pos, row.suit)"
                :key="card"
                :card="card"
                size="xs"
              />
              <span v-if="cardsOf(pos, row.suit).length === 0" class="void">—</span>
            </div>
          </div>
        </article>
      </div>

      <div class="replay-sections">
        <section>
          <h4>叫牌</h4>
          <div class="bid-list">
            <span
              v-for="(bid, i) in board.bidding"
              :key="i"
              class="bid-chip"
              :class="{ alerted: bid.alerted }"
              :title="bid.alertText ?? ''"
            >
              {{ bid.position }}
              <template v-if="bid.call.type === 'bid'">{{ bid.call.level }}{{ bid.call.suit }}</template>
              <template v-else-if="bid.call.type === 'pass'">Pass</template>
              <template v-else-if="bid.call.type === 'double'">X</template>
              <template v-else>XX</template>
            </span>
            <span v-if="board.bidding.length === 0" class="void">—</span>
          </div>
        </section>

        <section>
          <h4>逐墩出牌</h4>
          <div class="tricks-list">
            <div v-for="(trick, i) in board.tricks" :key="i" class="trick-row">
              <span class="trick-no">{{ i + 1 }}</span>
              <span v-for="play in trick.plays" :key="`${play.position}-${play.card}`" class="trick-play">
                <span class="who">{{ play.position }}</span>
                <PlayingCard :card="play.card" size="xs" label-mode="suit-first" />
              </span>
              <span class="winner">赢墩 {{ trick.winner }}</span>
            </div>
            <span v-if="board.tricks.length === 0" class="void">—</span>
          </div>
        </section>

        <section v-if="board.scoring?.referenceResults?.length">
          <h4>MP 对照场（7 桌 NS 分数）</h4>
          <div class="reference-list">
            <span v-for="(score, i) in board.scoring.referenceResults" :key="i" class="reference-chip">
              桌 {{ i + 1 }}：{{ score }}
            </span>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <el-button type="primary" @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.replay-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #5a6a61;
  padding: 8px 10px;
  background: #eef4ef;
  border-radius: 9px;
  margin-bottom: 12px;
}
.hands-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.replay-hand {
  border: 1px solid #dfe7e2;
  border-radius: 10px;
  padding: 8px;
  background: #fff;
}
.replay-hand header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 5px;
  color: #14563a;
}
.replay-hand header span {
  font-size: 11px;
  color: #7b897f;
}
.suit-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
}
.suit-line .suit {
  width: 16px;
  text-align: center;
  font-family: var(--suit-font);
  font-size: 14px;
}
.suit-line .suit.red {
  color: #c0392b;
}
.suit-line .cards {
  display: flex;
  gap: 1px;
  flex-wrap: wrap;
}
.void {
  color: #a6b1aa;
  font-size: 12px;
}
.replay-sections {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-top: 14px;
}
.replay-sections h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--felt-dark);
}
.bid-list,
.reference-list {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.bid-chip,
.reference-chip {
  padding: 3px 7px;
  border-radius: 6px;
  background: #eef4ef;
  font-size: 12px;
  color: #33443a;
}
.bid-chip.alerted {
  background: #fff8e2;
  border: 1px solid #e8c96a;
}
.tricks-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 260px;
  overflow: auto;
}
.trick-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 6px;
  border-radius: 6px;
  background: #f7faf8;
  font-size: 12px;
}
.trick-no {
  width: 22px;
  color: #7b897f;
}
.trick-play {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.trick-play .who {
  color: #7b897f;
  font-size: 11px;
}
.winner {
  margin-left: auto;
  color: #14563a;
  font-weight: 700;
}
@media (max-width: 900px) {
  .hands-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
