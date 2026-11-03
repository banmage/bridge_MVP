export interface BiddingPopupPosition {
  x: number;
  y: number;
}

const STORAGE_KEY = 'bridge.bidding-popup.v1';

/**
 * 叫牌浮窗在非人类回合会被卸载，位置保存在 localStorage，
 * 这样下一次轮到人类叫牌（甚至刷新页面）时可以继续使用用户拖到的位置。
 * 模块级缓存作为 localStorage 不可用时的兜底。
 */
let savedPosition: BiddingPopupPosition | null = null;

function readStorage(): BiddingPopupPosition | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BiddingPopupPosition>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export function getSavedBiddingPopupPosition(): BiddingPopupPosition | null {
  const stored = readStorage();
  if (stored) {
    savedPosition = stored;
    return { ...stored };
  }
  return savedPosition ? { ...savedPosition } : null;
}

export function saveBiddingPopupPosition(position: BiddingPopupPosition): void {
  savedPosition = { ...position };
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // 隐私模式/存储配额不足时保留当前会话内的位置
  }
}
