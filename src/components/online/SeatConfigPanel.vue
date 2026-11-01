<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BIDDING_SYSTEM_LABELS,
  DEFAULT_PERSONA,
  RISK_LABELS,
  SCORING_LABELS,
  BOARD_COUNT_OPTIONS,
  type BoardCount,
  type BotPersona,
  type Position,
  type RoomConfigInput,
  type RoomView,
  type ScoringMode,
} from '@shared/protocol';
import BotPersonaEditor from './BotPersonaEditor.vue';

const props = defineProps<{ room: RoomView; isHost: boolean }>();
const emit = defineEmits<{
  (e: 'set-seat', seat: Position, occupant: { kind: 'open' } | { kind: 'bot'; persona: BotPersona }): void;
  (e: 'update-bot', seat: Position, persona: BotPersona): void;
  (e: 'set-config', config: RoomConfigInput): void;
  (e: 'start'): void;
}>();

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];
const SEAT_LABEL: Record<Position, string> = { N: '北家', E: '东家', S: '南家', W: '西家' };
const SCORINGS = Object.keys(SCORING_LABELS) as ScoringMode[];

const editorVisible = ref(false);
const editingSeat = ref<Position | null>(null);
const editingPersona = ref<BotPersona | null>(null);

const isLobby = computed(() => props.room.status === 'lobby');
const allFilled = computed(() => POSITIONS.every((pos) => props.room.seats[pos].kind !== 'open'));
const canEdit = computed(() => props.isHost && isLobby.value);

function displayName(pos: Position): string {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return seat.name;
  if (seat.kind === 'bot') return seat.persona.name;
  return '空位';
}

function seatKind(pos: Position): string {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return seat.playerId === props.room.you.playerId ? '你（真人）' : '真人';
  if (seat.kind === 'bot') {
    return `${RISK_LABELS[seat.persona.risk]} · ${BIDDING_SYSTEM_LABELS[seat.persona.system]}`;
  }
  return '等待真人加入';
}

function openEditor(pos: Position): void {
  editingSeat.value = pos;
  const seat = props.room.seats[pos];
  editingPersona.value =
    seat.kind === 'bot'
      ? seat.persona
      : {
          ...DEFAULT_PERSONA,
          id: `bot-${pos}-${Math.random().toString(36).slice(2, 6)}`,
          name: `${SEAT_LABEL[pos]}机器人`,
        };
  editorVisible.value = true;
}

function savePersona(persona: BotPersona): void {
  const pos = editingSeat.value;
  if (!pos) return;
  const seat = props.room.seats[pos];
  if (seat.kind === 'bot') emit('update-bot', pos, persona);
  else emit('set-seat', pos, { kind: 'bot', persona });
}

function clearSeat(pos: Position): void {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human' && seat.playerId === props.room.you.playerId) return;
  emit('set-seat', pos, { kind: 'open' });
}

function setBoards(value: BoardCount): void {
  emit('set-config', { boards: value, scoring: props.room.config.scoring });
}

function setScoring(value: ScoringMode): void {
  emit('set-config', { boards: props.room.config.boards, scoring: value });
}
</script>

<template>
  <section class="seat-panel">
    <header class="panel-head">
      <h3>座位与机器人</h3>
      <span class="hint">{{ canEdit ? '房主可配置空位或机器人；真人可用房间码加入' : '等待房主开赛' }}</span>
    </header>

    <div class="seat-grid">
      <article v-for="pos in POSITIONS" :key="pos" class="seat-card" :class="room.seats[pos].kind">
        <div class="seat-title">
          <span class="pos">{{ pos }}</span>
          <strong>{{ SEAT_LABEL[pos] }}</strong>
          <span class="kind">{{ seatKind(pos) }}</span>
        </div>
        <div class="seat-name">{{ displayName(pos) }}</div>
        <div v-if="room.seats[pos].kind === 'human'" class="seat-meta">
          {{ room.seats[pos].kind === 'human' && room.seats[pos].connected ? '在线' : '离线' }}
        </div>
        <div v-else-if="room.seats[pos].kind === 'bot'" class="seat-meta">
          约定：{{ room.seats[pos].persona.conventions.length }} 项 · 随机度
          {{ room.seats[pos].persona.randomness.toFixed(2) }}
        </div>

        <div v-if="canEdit" class="seat-actions">
          <el-button v-if="room.seats[pos].kind !== 'human'" size="small" @click="openEditor(pos)">
            {{ room.seats[pos].kind === 'bot' ? '编辑机器人' : '设为机器人' }}
          </el-button>
          <el-button
            v-if="room.seats[pos].kind === 'bot'"
            size="small"
            text
            type="danger"
            @click="clearSeat(pos)"
          >
            清空
          </el-button>
          <el-button
            v-else-if="room.seats[pos].kind === 'open'"
            size="small"
            text
            @click="openEditor(pos)"
          >
            放机器人
          </el-button>
        </div>
      </article>
    </div>

    <div class="config-row">
      <label>
        比赛副数
        <el-select
          :model-value="room.config.boards"
          :disabled="!canEdit"
          size="small"
          @update:model-value="(v: BoardCount) => setBoards(v)"
        >
          <el-option v-for="n in BOARD_COUNT_OPTIONS" :key="n" :label="`${n} 副`" :value="n" />
        </el-select>
      </label>
      <label>
        计分模式
        <el-select
          :model-value="room.config.scoring"
          :disabled="!canEdit"
          size="small"
          @update:model-value="(v: ScoringMode) => setScoring(v)"
        >
          <el-option v-for="mode in SCORINGS" :key="mode" :label="SCORING_LABELS[mode]" :value="mode" />
        </el-select>
      </label>
      <div class="start-box">
        <el-button v-if="canEdit" type="primary" :disabled="!allFilled" @click="emit('start')">
          {{ allFilled ? '开始比赛' : '还有空座位' }}
        </el-button>
        <span v-else class="hint">等待房主开始</span>
      </div>
    </div>

    <BotPersonaEditor
      v-model:visible="editorVisible"
      :persona="editingPersona"
      :seat-label="editingSeat ? SEAT_LABEL[editingSeat] : undefined"
      @save="savePersona"
    />
  </section>
</template>

<style scoped>
.seat-panel {
  background: var(--paper);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.panel-head h3 {
  margin: 0;
  color: var(--felt-dark);
  font-size: 16px;
}
.hint {
  font-size: 12px;
  color: #6b7a71;
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.seat-card {
  border: 1px solid #d8e2db;
  border-radius: 12px;
  padding: 10px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 128px;
}
.seat-card.bot {
  border-color: #b9d8ff;
  background: linear-gradient(180deg, #f5faff, #fff);
}
.seat-card.human {
  border-color: #b9e2c8;
  background: linear-gradient(180deg, #f4fbf6, #fff);
}
.seat-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: #44544b;
}
.seat-title .pos {
  font-weight: 800;
  color: #14563a;
  background: #e7f3ec;
  border-radius: 6px;
  padding: 0 5px;
}
.seat-title .kind {
  margin-left: auto;
  color: #6b7a71;
  font-size: 11px;
  text-align: right;
}
.seat-name {
  font-size: 15px;
  font-weight: 700;
  color: #1c2b22;
}
.seat-meta {
  font-size: 11px;
  color: #6b7a71;
}
.seat-actions {
  margin-top: auto;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.config-row {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px dashed #d8e2db;
}
.config-row > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #5a6a61;
}
.start-box {
  margin-left: auto;
}
@media (max-width: 900px) {
  .seat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .start-box {
    margin-left: 0;
  }
}
</style>
