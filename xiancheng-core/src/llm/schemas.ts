// ============================================================
// 清河县 · LLM 输出 Schema 约束
// Phase 5：LLM 决策管道
// ============================================================

import { z } from 'zod';
import { ActionType } from '../types';

// 当前可用动作（从 action-menu-builder 动态生成，这里给基础集）
export const AVAILABLE_ACTIONS = [
  'move', 'talk', 'give_money', 'steal', 'buy', 'sell',
  'arrest', 'release', 'bribe', 'threaten', 'hire',
  'report_crime', 'join_faction', 'leave_faction', 'demand_money',
  'idle',
] as const;

// 决策输出 Schema（给 LLM 的 JSON Schema）
export const ACTION_DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: AVAILABLE_ACTIONS,
      description: '你要执行的动作，只能从列表里选',
    },
    targetId: {
      type: 'string',
      description: '动作目标（角色ID或地点ID），不需要目标可不填',
    },
    parameters: {
      type: 'object',
      description: '动作参数（如 amount/quantity/itemId/locationId/message）',
    },
    reason: {
      type: 'string',
      description: '为什么这么做（2-3句话）',
    },
    innerMonologue: {
      type: 'string',
      description: '你的内心独白（给玩家看，体现你的性格）',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

// zod 校验
export const ZodActionDecision = z.object({
  action: z.enum(AVAILABLE_ACTIONS),
  targetId: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
  reason: z.string().optional(),
  innerMonologue: z.string().optional(),
});

export type ParsedDecision = z.infer<typeof ZodActionDecision>;

// Goal 生成输出 Schema
export const GOAL_GENERATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    shouldGenerate: { type: 'boolean', description: '是否需要新的目标' },
    description: { type: 'string', description: '目标的自然语言描述' },
    conditionType: {
      type: 'string',
      enum: ['money_ge', 'item_has', 'relationship_le', 'location_at', 'faction_joined', 'wanted_le', 'custom'],
    },
    conditionValue: { type: 'number', description: '条件的数值' },
    priority: { type: 'number', description: '优先级 0-1' },
    strategy: { type: 'string', description: '你打算怎么实现这个目标' },
  },
  required: ['shouldGenerate'],
};

export const ZodGoalGeneration = z.object({
  shouldGenerate: z.boolean(),
  description: z.string().optional(),
  conditionType: z.enum(['money_ge', 'item_has', 'relationship_le', 'location_at', 'faction_joined', 'wanted_le', 'custom']).optional(),
  conditionValue: z.number().optional(),
  priority: z.number().optional(),
  strategy: z.string().optional(),
});
