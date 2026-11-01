import type { BiddingRule, LeadRule } from './types';
import {
  parseBiddingRules,
  parseLeadRules,
  validateBiddingRuleText,
  validateLeadRuleText,
  type RuleValidationResult,
} from './parse';

/**
 * 浏览器侧规则加载：Vite `?raw` 构建期内联 + localStorage 覆盖层。
 * 纯解析与校验逻辑在 `parse.ts` 中，服务端复用同一实现（见 server/rules.ts）。
 */
export {
  parseBiddingRules,
  parseLeadRules,
  validateBiddingRuleText,
  validateLeadRuleText,
  type RuleValidationResult,
};

/* ------------------------------------------------------------------ *
 * 规则文件注册表：以 Vite `?raw` 构建期内联加载，支持多套文件热替换
 * （验收用例 19：换用备选叫牌规则文件后，AI 行为改变）。
 * ------------------------------------------------------------------ */

const biddingModules = import.meta.glob('../rules/bidding/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const leadModules = import.meta.glob('../rules/play/leads*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DEFAULT_BIDDING_FILE = 'precision';
const DEFAULT_LEAD_FILE = 'leads';

export interface RuleFileInfo {
  /** 逻辑名（不含扩展名），用于切换规则文件 */
  name: string;
  /** 原始模块路径 */
  key: string;
}

/** 规则类别：叫牌 / 打牌（首攻） */
export type RuleKind = 'bidding' | 'lead';

function toName(key: string): string {
  const base = key.split('/').pop() ?? key;
  return base.replace(/\.ya?ml$/, '');
}

function pickModule(modules: Record<string, string>, name: string): string {
  const entry = Object.entries(modules).find(([key]) => toName(key) === name);
  if (!entry) throw new Error(`未找到名为 "${name}" 的规则文件`);
  return entry[1];
}

function listFiles(modules: Record<string, string>): RuleFileInfo[] {
  return Object.keys(modules)
    .map((key) => ({ name: toName(key), key }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listBiddingRuleFiles(): RuleFileInfo[] {
  return listFiles(biddingModules);
}

export function listLeadRuleFiles(): RuleFileInfo[] {
  return listFiles(leadModules);
}

/* ------------------------------------------------------------------ *
 * 本地规则覆盖（浏览器 localStorage）
 *
 * 浏览器环境无法直接改写构建期内联的 YAML 文件，因此“修改规则”以
 * 覆盖层形式保存：优先读取本地覆盖文本，没有覆盖时回退到内置文件。
 * 这样刷新页面后修改仍然生效，且可随时“恢复默认”。
 * ------------------------------------------------------------------ */

const OVERRIDES_KEY = 'bridge.ruleOverrides.v1';

interface RuleOverrideState {
  bidding: Record<string, string>;
  lead: Record<string, string>;
}

/** 内存中的权威覆盖状态（localStorage 仅作持久化副本，便于无 storage 环境使用） */
let memoryOverrides: RuleOverrideState | null = null;

function emptyOverrides(): RuleOverrideState {
  return { bidding: {}, lead: {} };
}

function readOverrides(): RuleOverrideState {
  if (memoryOverrides) return memoryOverrides;
  memoryOverrides = emptyOverrides();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RuleOverrideState>;
        memoryOverrides = {
          bidding: { ...(parsed.bidding ?? {}) },
          lead: { ...(parsed.lead ?? {}) },
        };
      }
    }
  } catch {
    // 存储不可用或被禁用时，退回纯内存模式
  }
  return memoryOverrides;
}

function writeOverrides(state: RuleOverrideState): void {
  memoryOverrides = state;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state));
    }
  } catch {
    // 忽略持久化失败，内存中的修改仍然生效
  }
}

/** 清除全部本地规则覆盖（测试/重置用） */
export function clearRuleOverrides(): void {
  memoryOverrides = emptyOverrides();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(OVERRIDES_KEY);
  } catch {
    // 忽略
  }
}

/** 读取叫牌规则原始 YAML（优先返回本地覆盖版本） */
export function getBiddingRuleText(name: string): string {
  return readOverrides().bidding[name] ?? pickModule(biddingModules, name);
}

/** 读取首攻规则原始 YAML（优先返回本地覆盖版本） */
export function getLeadRuleText(name: string): string {
  return readOverrides().lead[name] ?? pickModule(leadModules, name);
}

export function isBiddingRuleOverridden(name: string): boolean {
  return readOverrides().bidding[name] !== undefined;
}

export function isLeadRuleOverridden(name: string): boolean {
  return readOverrides().lead[name] !== undefined;
}

/** 保存叫牌规则覆盖（校验失败时抛错，不写入） */
export function saveBiddingRuleText(name: string, text: string): void {
  const result = validateBiddingRuleText(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const state = readOverrides();
  state.bidding[name] = text;
  writeOverrides(state);
}

/** 保存首攻规则覆盖（校验失败时抛错，不写入） */
export function saveLeadRuleText(name: string, text: string): void {
  const result = validateLeadRuleText(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const state = readOverrides();
  state.lead[name] = text;
  writeOverrides(state);
}

/** 清除某个叫牌规则文件的本地覆盖，恢复内置默认 */
export function resetBiddingRuleText(name: string): void {
  const state = readOverrides();
  delete state.bidding[name];
  writeOverrides(state);
}

/** 清除某个首攻规则文件的本地覆盖，恢复内置默认 */
export function resetLeadRuleText(name: string): void {
  const state = readOverrides();
  delete state.lead[name];
  writeOverrides(state);
}

/** 加载叫牌规则；name 省略时使用默认文件 */
export function loadBiddingRules(name: string = DEFAULT_BIDDING_FILE): BiddingRule[] {
  return parseBiddingRules(getBiddingRuleText(name));
}

/** 加载首攻规则；name 省略时使用默认文件 */
export function loadLeadRules(name: string = DEFAULT_LEAD_FILE): LeadRule[] {
  return parseLeadRules(getLeadRuleText(name));
}

/**
 * 加载所有叫牌规则文件（键 = 逻辑名）。
 * 供规则配置面板枚举可选叫牌体系。
 */
export function loadAllBiddingRuleSets(): Record<string, BiddingRule[]> {
  const out: Record<string, BiddingRule[]> = {};
  for (const [key] of Object.entries(biddingModules)) {
    const name = toName(key);
    out[name] = parseBiddingRules(getBiddingRuleText(name));
  }
  return out;
}
