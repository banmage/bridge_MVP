import yaml from 'js-yaml';
import type { BiddingRule, LeadRule } from './types';

/**
 * 纯文本解析层（不依赖运行环境）。
 *
 * 浏览器端由 `loader.ts` 通过 Vite `?raw` 取到文本后调用；
 * 服务端由 `server/rules.ts` 读取文件后调用。两端共用同一套解析与校验逻辑。
 */

/** 解析叫牌规则 YAML 文本（按 priority 降序稳定排序） */
export function parseBiddingRules(text: string): BiddingRule[] {
  const data = yaml.load(text) as { rules?: BiddingRule[] } | undefined;
  if (!data?.rules) throw new Error('叫牌规则文件缺少 rules 段');
  return [...data.rules].sort((a, b) => b.priority - a.priority);
}

/** 解析首攻规则 YAML 文本（按 priority 降序稳定排序） */
export function parseLeadRules(text: string): LeadRule[] {
  const data = yaml.load(text) as { rules?: LeadRule[] } | undefined;
  if (!data?.rules) throw new Error('首攻规则文件缺少 rules 段');
  return [...data.rules].sort((a, b) => b.priority - a.priority);
}

export interface RuleValidationResult {
  ok: boolean;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 校验叫牌规则文本：YAML 语法 + 必备字段 */
export function validateBiddingRuleText(text: string): RuleValidationResult {
  let rules: BiddingRule[];
  try {
    rules = parseBiddingRules(text);
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  rules.forEach((rule, index) => {
    const label = rule.id ? `规则 ${rule.id}` : `第 ${index + 1} 条规则`;
    if (!rule.id) errors.push(`${label}缺少 id`);
    if (!rule.sequence) errors.push(`${label}缺少 sequence`);
    if (!rule.action) errors.push(`${label}缺少 action`);
    if (typeof rule.priority !== 'number') errors.push(`${label}的 priority 必须是数字`);
    if (rule.tags !== undefined && !Array.isArray(rule.tags)) {
      errors.push(`${label}的 tags 必须是字符串数组`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/** 校验首攻规则文本：YAML 语法 + 必备字段 */
export function validateLeadRuleText(text: string): RuleValidationResult {
  let rules: LeadRule[];
  try {
    rules = parseLeadRules(text);
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  rules.forEach((rule, index) => {
    const label = rule.id ? `规则 ${rule.id}` : `第 ${index + 1} 条规则`;
    if (!rule.id) errors.push(`${label}缺少 id`);
    if (!rule.context?.contract_type) errors.push(`${label}缺少 context.contract_type`);
    if (!rule.lead) errors.push(`${label}缺少 lead`);
    if (typeof rule.priority !== 'number') errors.push(`${label}的 priority 必须是数字`);
    if (rule.role !== undefined && !['defender', 'declarer', 'any'].includes(rule.role)) {
      errors.push(`${label}的 role 只能是 defender / declarer / any`);
    }
  });
  return { ok: errors.length === 0, errors };
}
