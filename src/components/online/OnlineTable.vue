<script setup lang="ts">
import { computed } from 'vue';
import type { Position } from '../../models/gameState';
import type { RoomView } from '@shared/protocol';
import { describeContract, vulName } from '@shared/format';
import Hand from '../Hand.vue';
import PlayingCard from '../PlayingCard.vue';

const props = defineProps<{ room: RoomView }>();
const emit = defineEmits<{ (e: 'play', card: number): void }>();

const SEAT_CN: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };

const board = computed(() => props.room.board);

function occupantName(pos: Position): string {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return seat.name;
  if (seat.kind === 'bot') return seat.persona.name;
  return '空位';
}

function occupantTag(pos: Position): string {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return seat.playerId === props.room.you.playerId ? '（你）' : '（真人）';
  if (seat.kind === 'bot') return '（AI）';
  return '';
}

function isActive(pos: Position): boolean {
  const b = board.value;
  if (!b) return false;
  if (b.phase === 'bidding') return b.currentBidder === pos;
  if (b.phase === 'play' || b.phase === 'play_waiting_lead') return b.nextPlayer === pos;
  return false;
}

/** 该座位当前可见的牌：自己 / 明手（已摊牌）/ 结算后四手牌 */
function visibleCards(pos: Position): number[] | null {
  const b = board.value;
  if (!b) return null;
  if (b.phase === 'scored' && b.revealedHands) return b.revealedHands[pos];
  if (b.yourSeat === pos && b.yourHand) return b.yourHand;
  if (b.dummySeat === pos && b.dummyOpen && b.dummyHand) return b.dummyHand;
  return null;
}

/** 暗手牌背数量 = 13 - 已出牌数 */
function hiddenCount(pos: Position): number {
  const b = board.value;
  if (!b) return 13;
  const played =
    b.tricks.reduce((sum, t) => sum + t.plays.filter((p) => p.position === pos).length, 0) +
    b.currentTrick.filter((p) => p.position === pos).length;
  return Math.max(0, 13 - played);
}

function canClick(pos: Position): boolean {
  const b = board.value;
  if (!b || !b.canAct) return false;
  return b.actingForSeat === pos;
}

function onCard(card: number): void {
  if (board.value?.canAct) emit('play', card);
}

const tricksBySide = computed(() => {
  const counts = { NS: 0, EW: 0 };
  for (const trick of board.value?.tricks ?? []) {
    if (trick.winner === 'N' || trick.winner === 'S') counts.NS += 1;
    else counts.EW += 1;
  }
  return counts;
});

const declarer = computed(() => board.value?.contract?.declarer ?? null);
const declarerTricks = computed(() => {
  if (!declarer.value) return 0;
  const side = declarer.value === 'N' || declarer.value === 'S' ? 'NS' : 'EW';
  return tricksBySide.value[side];
});

const phaseText = computed(() => {
  const phase = board.value?.phase;
  const map: Record<string, string> = {
    bidding: '叫牌中',
    play_waiting_lead: '等待首攻',
    play: '打牌中',
    scored: '本副结束',
  };
  return map[phase ?? ''] ?? '等待开赛';
});

</script>

<template>
  <section class="online-table">
    <div class="table-felt">
      <div class="seat seat-north">
        <div class="seat-head" :class="{ active: isActive('N') }">
          <span class="pos">{{ SEAT_CN.N }}</span>
          <span class="name">{{ occupantName('N') }}</span>
          <span class="tag">{{ occupantTag('N') }}</span>
          <span v-if="board?.dummySeat === 'N' && board?.dummyOpen" class="dummy-tag">明手</span>
        </div>
        <Hand
          v-if="visibleCards('N')"
          :cards="visibleCards('N')!"
          position="N"
          :clickable="canClick('N')"
          :is-dummy="board?.dummySeat === 'N'"
          :active="isActive('N')"
          :show-turn-arrow="canClick('N')"
          @card-click="onCard"
        />
        <Hand v-else :cards="Array(hiddenCount('N')).fill(0)" position="N" face-down />
      </div>

      <div class="seat seat-west">
        <div class="seat-head" :class="{ active: isActive('W') }">
          <span class="pos">{{ SEAT_CN.W }}</span>
          <span class="name">{{ occupantName('W') }}</span>
          <span class="tag">{{ occupantTag('W') }}</span>
          <span v-if="board?.dummySeat === 'W' && board?.dummyOpen" class="dummy-tag">明手</span>
        </div>
        <Hand
          v-if="visibleCards('W')"
          :cards="visibleCards('W')!"
          position="W"
          :clickable="canClick('W')"
          :is-dummy="board?.dummySeat === 'W'"
          :active="isActive('W')"
          :show-turn-arrow="canClick('W')"
          @card-click="onCard"
        />
        <Hand v-else :cards="Array(hiddenCount('W')).fill(0)" position="W" face-down />
      </div>

      <div class="table-center">
        <div class="center-meta">
          <span v-if="board">第 {{ board.index }} 副 · {{ vulName(board.vulnerability) }} · 庄家 {{ board.dealer }}</span>
          <span v-else>等待开始</span>
        </div>
        <div class="contract-line">
          <strong>{{ board?.contract ? describeContract(board.contract) : phaseText }}</strong>
          <span v-if="board?.contract">庄 {{ declarer }} · {{ declarerTricks }} 墩</span>
        </div>
        <div class="trick-area">
          <PlayingCard
            v-for="play in board?.currentTrick ?? []"
            :key="`${play.position}-${play.card}`"
            :card="play.card"
            size="md"
            label-mode="suit-first"
          />
        </div>
        <div class="center-message">{{ board?.message ?? '四位玩家就座后由房主开赛' }}</div>
        <div class="score-line">
          <span>NS {{ tricksBySide.NS }}</span>
          <span>EW {{ tricksBySide.EW }}</span>
          <span v-if="board?.scoring?.mpPercent !== undefined">MP {{ board.scoring.mpPercent }}%</span>
          <span v-if="board?.scoring">点数 {{ board.scoring.points > 0 ? '+' : '' }}{{ board.scoring.points }}</span>
        </div>
      </div>

      <div class="seat seat-east">
        <div class="seat-head" :class="{ active: isActive('E') }">
          <span class="pos">{{ SEAT_CN.E }}</span>
          <span class="name">{{ occupantName('E') }}</span>
          <span class="tag">{{ occupantTag('E') }}</span>
          <span v-if="board?.dummySeat === 'E' && board?.dummyOpen" class="dummy-tag">明手</span>
        </div>
        <Hand
          v-if="visibleCards('E')"
          :cards="visibleCards('E')!"
          position="E"
          :clickable="canClick('E')"
          :is-dummy="board?.dummySeat === 'E'"
          :active="isActive('E')"
          :show-turn-arrow="canClick('E')"
          @card-click="onCard"
        />
        <Hand v-else :cards="Array(hiddenCount('E')).fill(0)" position="E" face-down />
      </div>

      <div class="seat seat-south">
        <div class="seat-head" :class="{ active: isActive('S') }">
          <span class="pos">{{ SEAT_CN.S }}</span>
          <span class="name">{{ occupantName('S') }}</span>
          <span class="tag">{{ occupantTag('S') }}</span>
          <span v-if="board?.dummySeat === 'S' && board?.dummyOpen" class="dummy-tag">明手</span>
        </div>
        <Hand
          v-if="visibleCards('S')"
          :cards="visibleCards('S')!"
          position="S"
          :clickable="canClick('S')"
          :is-dummy="board?.dummySeat === 'S'"
          :active="isActive('S')"
          :show-turn-arrow="canClick('S')"
          @card-click="onCard"
        />
        <Hand v-else :cards="Array(hiddenCount('S')).fill(0)" position="S" face-down />
      </div>
    </div>

    <div class="bidding-strip">
      <div
        v-for="(bid, i) in board?.bidding ?? []"
        :key="i"
        class="bid-chip"
        :class="{ alerted: bid.alerted }"
        :title="bid.alertText ?? ''"
      >
        <span class="who">{{ bid.position }}</span>
        <span v-if="bid.call.type === 'bid'">{{ bid.call.level }}{{ bid.call.suit }}</span>
        <span v-else-if="bid.call.type === 'pass'">Pass</span>
        <span v-else-if="bid.call.type === 'double'">X</span>
        <span v-else>XX</span>
      </div>
      <span v-if="!(board?.bidding?.length)" class="bidding-empty">尚无叫牌</span>
    </div>
  </section>
</template>

<style scoped>
.online-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.table-felt {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 1.1fr) minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background:
    radial-gradient(ellipse at 50% 45%, rgba(49, 156, 102, 0.5), transparent 60%),
    linear-gradient(180deg, #1a5b3c, #0e3a27);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.32);
}
.seat-north { grid-area: north; }
.seat-west { grid-area: west; }
.seat-center { grid-area: center; }
.seat-east { grid-area: east; }
.seat-south { grid-area: south; }
.seat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
.seat-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(234, 245, 238, 0.92);
  font-size: 12px;
  padding: 3px 7px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  width: fit-content;
}
.seat-head.active {
  background: rgba(255, 225, 154, 0.2);
  box-shadow: 0 0 0 1px rgba(255, 225, 154, 0.6);
  color: #ffe19a;
}
.seat-head .pos {
  font-weight: 700;
}
.seat-head .tag {
  opacity: 0.75;
}
.dummy-tag {
  color: #7fd7ff;
  font-weight: 700;
}
.seat-south :deep(.hand),
.seat-north :deep(.hand) {
  justify-content: center;
}
.seat-west :deep(.hand),
.seat-east :deep(.hand) {
  transform: scale(0.82);
  transform-origin: left center;
}
.table-center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
  color: rgba(234, 245, 238, 0.9);
  min-height: 160px;
}
.center-meta {
  font-size: 12px;
  opacity: 0.8;
}
.contract-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 15px;
  color: #ffe19a;
}
.contract-line span {
  font-size: 12px;
  color: rgba(234, 245, 238, 0.85);
}
.trick-area {
  display: flex;
  gap: 4px;
  min-height: 54px;
  align-items: center;
  justify-content: center;
}
.center-message {
  font-size: 12px;
  min-height: 18px;
  opacity: 0.9;
}
.score-line {
  display: flex;
  gap: 12px;
  font-size: 12px;
  opacity: 0.85;
}
.bidding-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-radius: 10px;
  background: rgba(7, 30, 21, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 34px;
}
.bid-chip {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #eaf5ee;
  font-size: 12px;
}
.bid-chip.alerted {
  background: #f7f7f2;
  color: #1c2b22;
  border: 1px solid #ffe19a;
}
.bid-chip .who {
  font-weight: 700;
  opacity: 0.75;
}
.bidding-empty {
  color: rgba(234, 245, 238, 0.6);
  font-size: 12px;
}
@media (max-width: 900px) {
  .table-felt {
    grid-template-columns: 1fr;
    grid-template-areas: 'north' 'west' 'center' 'east' 'south';
  }
  .seat-west :deep(.hand),
  .seat-east :deep(.hand) {
    transform: none;
  }
}
</style>
