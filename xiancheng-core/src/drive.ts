// ============================================================
// 清河县 · Drive 系统（驱动力）
// Phase 4：Drive + Goal 系统
// ============================================================

import { Drives, GameEvent, Character } from './types';

/** 每个角色人格对应的"基线"（Drive 会自然回归到这个值） */
export function getDriveBaseline(character: Character): Drives {
  // 基线由人格决定
  return {
    safety: 0.5 + (1 - character.personality.riskTolerance) * 0.3,
    wealth: 0.3 + character.personality.greed * 0.5,
    power: 0.2 + character.personality.ambition * 0.6,
    belonging: 0.4 + character.personality.loyalty * 0.3,
    revenge: character.personality.aggression * 0.4,
  };
}

/**
 * 事件 → Drive 变化规则表
 * 每个事件类型对行为者和目标的影响
 */
export const DRIVE_EFFECTS: Record<string, {
  actor?: Partial<Drives>;
  target?: Partial<Drives>;
}> = {
  // ── 经济类 ──
  give_money: {
    actor: { wealth: -0.05, belonging: 0.03 },
    target: { wealth: 0.05, belonging: 0.03 },
  },
  steal: {
    actor: { wealth: 0.08, safety: -0.08, power: 0.02 },
    target: { wealth: -0.1, safety: -0.05, revenge: 0.1 },
  },
  buy: { actor: { wealth: -0.03, safety: 0.02 } },
  sell: { actor: { wealth: 0.05 } },
  demand_money: {
    actor: { wealth: 0.06, power: 0.03, safety: -0.05 },
    target: { wealth: -0.08, safety: -0.08, revenge: 0.12 },
  },

  // ── 执法类 ──
  arrest: {
    actor: { power: 0.05, safety: 0.03 },
    target: { safety: -0.3, power: -0.1, revenge: 0.2 },
  },
  release: {
    actor: { power: 0.02, belonging: 0.02 },
    target: { safety: 0.2, belonging: 0.05 },
  },
  report_crime: {
    actor: { safety: 0.05, belonging: 0.03, revenge: -0.05 },
    target: { safety: -0.1, revenge: 0.1 },
  },

  // ── 关系类 ──
  bribe: {
    actor: { wealth: -0.05, safety: -0.05 },
    target: { wealth: 0.05, power: 0.03 },
  },
  threaten: {
    actor: { power: 0.03, safety: -0.03, revenge: -0.05 },
    target: { safety: -0.15, revenge: 0.15 },
  },
  hire: {
    actor: { wealth: -0.05, power: 0.05 },
    target: { wealth: 0.05, belonging: 0.05 },
  },
  join_faction: {
    actor: { belonging: 0.15, power: 0.05 },
  },
  leave_faction: {
    actor: { belonging: -0.15, power: -0.05 },
  },
  talk: {
    actor: { belonging: 0.02 },
    target: { belonging: 0.02 },
  },
  move: {},
  idle: {},
};

/**
 * 应用事件对某角色的 Drive 影响（规则引擎判定，非 LLM）
 */
export function applyDriveChanges(
  character: Character,
  event: GameEvent,
): void {
  const effects = DRIVE_EFFECTS[event.type];
  if (!effects) return;

  // 判断该角色是 actor 还是 target
  let changes: Partial<Drives> | undefined;
  if (event.actorId === character.id) {
    changes = effects.actor;
  } else if (event.targetId === character.id) {
    changes = effects.target;
  }
  if (!changes) return;

  for (const [key, delta] of Object.entries(changes)) {
    const driveKey = key as keyof Drives;
    character.drives[driveKey] = clamp01(character.drives[driveKey] + (delta ?? 0));
  }

  // 记录变化到事件结果里（供 delta 审计）
  event.result.driveChanges = event.result.driveChanges ?? [];
  event.result.driveChanges.push({ characterId: character.id, changes });
}

/**
 * 每 tick 自然衰减：驱动力向"基线"回归
 */
export function decayDrives(character: Character, decayRate = 0.02): void {
  const baseline = getDriveBaseline(character);

  for (const key of Object.keys(character.drives) as (keyof Drives)[]) {
    const current = character.drives[key];
    const target = baseline[key];
    character.drives[key] = clamp01(current + (target - current) * decayRate);
  }
}

/**
 * 渲染 Drives 文本（Phase 5 给 LLM 用）
 */
export function renderDrives(drives: Drives): string {
  const lines = [
    `- 安全：${drives.safety.toFixed(2)}`,
    `- 财富：${drives.wealth.toFixed(2)}`,
    `- 权力：${drives.power.toFixed(2)}`,
    `- 归属：${drives.belonging.toFixed(2)}`,
    `- 复仇：${drives.revenge.toFixed(2)}`,
  ];
  return lines.join('\n');
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
