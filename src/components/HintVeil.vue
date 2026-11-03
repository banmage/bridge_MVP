<script setup lang="ts">
/**
 * 统一的悬停解释层。
 *
 * 所有叫品、叫牌过程与出牌说明都通过这一层展示：
 * - 白色半透明“薄纱”质感，带轻微模糊；
 * - 固定在牌桌中心偏右，可覆盖叫牌过程右侧空白与右手方部分手牌；
 * - 不接收鼠标事件，鼠标移开后由调用方清空文字即可消失。
 */
defineProps<{ text?: string | null }>();
</script>

<template>
  <transition name="hint-veil">
    <div v-if="text" class="hint-veil" role="tooltip">
      <span class="hint-veil-mark" aria-hidden="true">i</span>
      <span class="hint-veil-text">{{ text }}</span>
    </div>
  </transition>
</template>

<style scoped>
.hint-veil {
  position: fixed;
  top: 38%;
  left: 50%;
  z-index: 5000;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: min(320px, 32vw);
  margin-left: 46px;
  padding: 9px 11px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.8);
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.26),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(5px) saturate(1.08);
  color: #1d2d25;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-line;
  pointer-events: none;
}
.hint-veil-mark {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border-radius: 50%;
  background: #14563a;
  color: #f4fff8;
  font-size: 10px;
  font-weight: 800;
  font-style: italic;
  line-height: 15px;
  text-align: center;
}
.hint-veil-text {
  min-width: 0;
}
.hint-veil-enter-active,
.hint-veil-leave-active {
  transition: opacity 0.12s ease;
}
.hint-veil-enter-from,
.hint-veil-leave-to {
  opacity: 0;
}
@media (max-width: 900px) {
  .hint-veil {
    top: 30%;
    right: 12px;
    left: auto;
    width: min(280px, 72vw);
    margin-left: 0;
  }
}
</style>
