import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BiddingRule, LeadRule } from '../src/engine/types';
import { parseBiddingRules, parseLeadRules } from '../src/engine/parse';

/**
 * 服务端规则加载：从 `src/rules/` 读取 YAML 文本，复用 `src/engine/parse.ts` 解析。
 * 结果按文件缓存（规则在运行期只读）。
 */

const here = dirname(fileURLToPath(import.meta.url));
export const RULES_DIR = resolve(here, '../src/rules');

const biddingCache = new Map<string, BiddingRule[]>();
let leadCache: LeadRule[] | null = null;

/** 可用的叫牌体系文件（逻辑名，不含扩展名） */
export function listBiddingSystems(): string[] {
  try {
    return readdirSync(join(RULES_DIR, 'bidding'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => f.replace(/\.ya?ml$/, ''))
      .sort();
  } catch {
    return ['precision'];
  }
}

const DEFAULT_SYSTEM = 'precision';

export function biddingRulesFor(system: string): BiddingRule[] {
  const key = system || DEFAULT_SYSTEM;
  const cached = biddingCache.get(key);
  if (cached) return cached;
  let rules: BiddingRule[];
  try {
    const text = readFileSync(join(RULES_DIR, 'bidding', `${key}.yml`), 'utf8');
    rules = parseBiddingRules(text);
  } catch {
    // 未知体系回退到默认精确体系，保证对局可继续
    if (key !== DEFAULT_SYSTEM) return biddingRulesFor(DEFAULT_SYSTEM);
    throw new Error(`无法加载叫牌规则：${key}`);
  }
  biddingCache.set(key, rules);
  return rules;
}

/** 首攻规则（全局共享） */
export function leadRules(): LeadRule[] {
  if (leadCache) return leadCache;
  const text = readFileSync(join(RULES_DIR, 'play', 'leads.yml'), 'utf8');
  leadCache = parseLeadRules(text);
  return leadCache;
}

/** 测试/热更新用：清空缓存 */
export function clearRuleCache(): void {
  biddingCache.clear();
  leadCache = null;
}
