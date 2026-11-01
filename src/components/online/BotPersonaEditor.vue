<script setup lang="ts">
import { reactive, watch } from 'vue';
import {
  BIDDING_SYSTEM_LABELS,
  CONVENTION_LABELS,
  DEFAULT_PERSONA,
  RISK_LABELS,
  type BotPersona,
  type BiddingSystem,
  type ConventionKey,
  type Risk,
} from '@shared/protocol';

const props = defineProps<{
  visible: boolean;
  persona: BotPersona | null;
  seatLabel?: string;
}>();
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'save', persona: BotPersona): void;
}>();

const CONVENTIONS = Object.keys(CONVENTION_LABELS) as ConventionKey[];
const RISKS = Object.keys(RISK_LABELS) as Risk[];
const SYSTEMS = Object.keys(BIDDING_SYSTEM_LABELS) as BiddingSystem[];

const draft = reactive<BotPersona>({
  id: '',
  name: '机器人',
  risk: DEFAULT_PERSONA.risk,
  system: DEFAULT_PERSONA.system,
  conventions: [...DEFAULT_PERSONA.conventions],
  randomness: DEFAULT_PERSONA.randomness,
});

watch(
  () => [props.visible, props.persona] as const,
  ([visible, persona]) => {
    if (!visible) return;
    const source = persona ?? {
      ...DEFAULT_PERSONA,
      id: `bot-${Math.random().toString(36).slice(2, 8)}`,
      name: '机器人',
    };
    draft.id = source.id;
    draft.name = source.name;
    draft.risk = source.risk;
    draft.system = source.system;
    draft.conventions = [...source.conventions];
    draft.randomness = source.randomness;
  },
  { immediate: true },
);

function toggleConvention(key: ConventionKey): void {
  draft.conventions = draft.conventions.includes(key)
    ? draft.conventions.filter((c) => c !== key)
    : [...draft.conventions, key];
}

function save(): void {
  emit('save', {
    ...draft,
    name: draft.name.trim().slice(0, 16) || '机器人',
    randomness: Math.min(1, Math.max(0, draft.randomness)),
  });
  emit('update:visible', false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`配置机器人${seatLabel ? ` · ${seatLabel}` : ''}`"
    width="560px"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <div class="persona-form">
      <label>
        名字
        <el-input v-model="draft.name" maxlength="16" show-word-limit size="small" />
      </label>

      <label>
        风险偏好
        <el-select v-model="draft.risk" size="small">
          <el-option v-for="risk in RISKS" :key="risk" :label="RISK_LABELS[risk]" :value="risk" />
        </el-select>
      </label>

      <label>
        叫牌体系
        <el-select v-model="draft.system" size="small">
          <el-option v-for="system in SYSTEMS" :key="system" :label="BIDDING_SYSTEM_LABELS[system]" :value="system" />
        </el-select>
      </label>

      <label class="slider">
        随机度 {{ draft.randomness.toFixed(2) }}
        <el-slider v-model="draft.randomness" :min="0" :max="1" :step="0.05" />
      </label>

      <div class="conventions">
        <span class="section-title">附加约定</span>
        <el-checkbox
          v-for="key in CONVENTIONS"
          :key="key"
          :model-value="draft.conventions.includes(key)"
          @update:model-value="toggleConvention(key)"
        >
          {{ CONVENTION_LABELS[key] }}
        </el-checkbox>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.persona-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.persona-form > label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #5a6a61;
}
.persona-form .slider {
  grid-column: 1 / -1;
}
.conventions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.section-title {
  font-size: 12px;
  color: #5a6a61;
  font-weight: 700;
}
</style>
