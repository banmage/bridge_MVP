<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BidCall, BidSuit, RoomView } from '@shared/protocol';
import { isCallLegal, lastBidOf } from '../../core/bidding/validator';

const props = defineProps<{ room: RoomView }>();
const emit = defineEmits<{
  (e: 'bid', call: BidCall, alert?: { text: string }): void;
}>();

const SUITS: BidSuit[] = ['C', 'D', 'H', 'S', 'NT'];
const SUIT_TEXT: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };
const alertText = ref('');

const board = computed(() => props.room.board);
const canAct = computed(() => !!board.value?.canAct && board.value.phase === 'bidding');
const seat = computed(() => board.value?.yourSeat ?? null);
const currentBid = computed(() => {
  const b = board.value;
  if (!b) return null;
  return lastBidOf(b.bidding);
});

function legal(call: BidCall): boolean {
  const b = board.value;
  if (!b || !seat.value) return false;
  return isCallLegal(b.bidding, currentBid.value, seat.value, call);
}

function submit(call: BidCall): void {
  if (!canAct.value || !legal(call)) return;
  const text = alertText.value.trim();
  emit('bid', call, text ? { text } : undefined);
  alertText.value = '';
}

function isRed(suit: BidSuit): boolean {
  return suit === 'D' || suit === 'H';
}
</script>

<template>
  <section class="bid-panel" :class="{ disabled: !canAct }">
    <header class="bid-head">
      <strong>{{ canAct ? '轮到你叫牌' : '等待对手叫牌' }}</strong>
      <span v-if="currentBid" class="current">
        当前叫品：{{ currentBid.level }}{{ SUIT_TEXT[currentBid.suit] }}
      </span>
      <span v-else class="current">尚无叫品</span>
    </header>

    <div class="bid-grid">
      <template v-for="level in 7" :key="level">
        <button
          v-for="suit in SUITS"
          :key="`${level}-${suit}`"
          type="button"
          class="bid-btn"
          :class="{ red: isRed(suit), illegal: !legal({ type: 'bid', level, suit }) }"
          :disabled="!canAct || !legal({ type: 'bid', level, suit })"
          @click="submit({ type: 'bid', level, suit })"
        >
          <span class="level">{{ level }}</span>
          <span class="suit">{{ SUIT_TEXT[suit] }}</span>
        </button>
      </template>
    </div>

    <div class="bid-actions">
      <button type="button" class="bid-btn pass" :disabled="!canAct" @click="submit({ type: 'pass' })">Pass</button>
      <button
        type="button"
        class="bid-btn dbl"
        :disabled="!canAct || !legal({ type: 'double' })"
        @click="submit({ type: 'double' })"
      >
        X 加倍
      </button>
      <button
        type="button"
        class="bid-btn dbl"
        :disabled="!canAct || !legal({ type: 'redouble' })"
        @click="submit({ type: 'redouble' })"
      >
        XX 再加倍
      </button>
    </div>

    <label class="alert-row">
      约定提醒（可选）
      <input v-model="alertText" maxlength="80" placeholder="如：负加倍" :disabled="!canAct" />
    </label>
  </section>
</template>

<style scoped>
.bid-panel {
  background: var(--paper);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bid-panel.disabled {
  opacity: 0.72;
}
.bid-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--felt-dark);
  font-size: 13px;
}
.bid-head .current {
  margin-left: auto;
  color: #5a6a61;
  font-weight: 600;
}
.bid-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
}
.bid-btn {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 3px;
  padding: 7px 4px;
  border-radius: 8px;
  border: 1px solid #cdd8d1;
  background: #fff;
  color: #172b63;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.15s ease;
}
.bid-btn .suit {
  font-family: var(--suit-font);
  font-size: 15px;
}
.bid-btn.red .suit {
  color: #c0392b;
}
.bid-btn:hover:not(:disabled) {
  background: #eef7f1;
  transform: translateY(-1px);
}
.bid-btn.illegal,
.bid-btn:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
.bid-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bid-actions .bid-btn {
  flex: 1;
  padding: 8px 10px;
  min-width: 90px;
}
.bid-btn.pass {
  color: #14563a;
}
.bid-btn.dbl {
  color: #8a3d12;
}
.alert-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #5a6a61;
}
.alert-row input {
  flex: 1;
  border: 1px solid #cdd8d1;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
}
</style>
