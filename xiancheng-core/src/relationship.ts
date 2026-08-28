// ============================================================
// 清河县 · 关系系统
// Phase 6：关系系统
// ============================================================

import { Character, GameEvent, World, Relationship, EventResult } from './types';

/** 事件 → 关系变化规则表 */
export const RELATIONSHIP_EFFECTS: Record<string, {
  actorOnTarget?: Partial<Relationship>;   // actor 对 target 的变化
  targetOnActor?: Partial<Relationship>;   // target 对 actor 的变化
  witnessOnActor?: Partial<Relationship>;  // 目击者对 actor 的变化
  witnessOnTarget?: Partial<Relationship>; // 目击者对 target 的变化
}> = {
  // ── 经济类 ──
  give_money: {
    targetOnActor: { trust: 15, affinity: 20, loyalty: 5 },  // 被给者对给钱者：感恩
  },
  steal: {
    targetOnActor: { trust: -40, affinity: -30, resentment: 50, fear: 10 },  // 被偷者对偷者
    witnessOnActor: { trust: -20, affinity: -15 },          // 目击者对偷者：警惕
  },
  buy: { targetOnActor: { trust: 5, affinity: 5 } },
  sell: { targetOnActor: { trust: 5, affinity: 5 } },
  demand_money: {
    targetOnActor: { trust: -30, fear: 35, resentment: 40 },
    actorOnTarget: { trust: -10, affinity: -10 },
  },

  // ── 执法类 ──
  arrest: {
    targetOnActor: { resentment: 50, fear: 20 },            // 被抓者对逮捕者：怨恨+恐惧
    witnessOnActor: { respect: 15, trust: 10 },             // 目击者对逮捕者：尊敬
    witnessOnTarget: { fear: 10 },                          // 目击者对被抓者：害怕
  },
  release: {
    targetOnActor: { trust: 25, loyalty: 20, respect: 15 },  // 被释放者对释放者：感恩
    witnessOnActor: { respect: 10 },                        // 目击者对释放者
  },
  report_crime: {
    targetOnActor: { resentment: 60, fear: 20 },            // 罪犯对举报者：极度怨恨
    witnessOnActor: { trust: 10, respect: 10 },             // 目击者对举报者
  },

  // ── 关系类 ──
  bribe: {
    targetOnActor: { affinity: 5, respect: -10, loyalty: -5 },  // 受贿者对行贿者
    actorOnTarget: { respect: -10 },                            // 行贿者对受贿者：看轻
  },
  threaten: {
    targetOnActor: { trust: -30, fear: 40, resentment: 40 },
    actorOnTarget: { affinity: -5 },
  },
  hire: {
    targetOnActor: { trust: 10, loyalty: 20, respect: 10 },  // 被雇者对雇主
    actorOnTarget: { trust: 10 },                            // 雇主对被雇者
  },
  talk: {
    targetOnActor: { affinity: 2 },    // 交谈微增好感
    actorOnTarget: { affinity: 2 },
  },
  join_faction: {},
  leave_faction: {},
  move: {},
  idle: {},
};

/**
 * 事件 → 关系变化（唯一入口）
 * 由 engine 在 applyEvent 后调用
 */
export function applyRelationshipChanges(
  event: GameEvent,
  world: World,
): EventResult['relationshipChanges'] {
  const effects = RELATIONSHIP_EFFECTS[event.type];
  const applied: EventResult['relationshipChanges'] = [];
  if (!effects) return applied;

  const actor = world.characters.get(event.actorId);
  const target = event.targetId ? world.characters.get(event.targetId) : null;
  if (!actor) return applied;

  // 1. actor 对 target 的变化
  if (target && effects.actorOnTarget) {
    const c = mutateRelationship(actor, target, effects.actorOnTarget);
    if (c) applied.push(c);
  }
  // 2. target 对 actor 的变化
  if (target && effects.targetOnActor) {
    const c = mutateRelationship(target, actor, effects.targetOnActor);
    if (c) applied.push(c);
  }
  // 3. 目击者对 actor / target
  for (const wid of event.witnesses) {
    const witness = world.characters.get(wid);
    if (!witness || witness.id === actor.id) continue;
    if (effects.witnessOnActor) {
      const c = mutateRelationship(witness, actor, effects.witnessOnActor);
      if (c) applied.push(c);
    }
    if (target && effects.witnessOnTarget) {
      const c = mutateRelationship(witness, target, effects.witnessOnTarget);
      if (c) applied.push(c);
    }
  }

  return applied;
}

/**
 * 目击者反应：只处理 witnessOnActor / witnessOnTarget
 * （actor/target 的直接关系变化已由 executors.ts 应用，这里避免双重应用）
 */
export function applyRelationshipWitnessEffects(
  event: GameEvent,
  world: World,
): EventResult['relationshipChanges'] {
  const effects = RELATIONSHIP_EFFECTS[event.type];
  const applied: EventResult['relationshipChanges'] = [];
  if (!effects) return applied;

  const actor = world.characters.get(event.actorId);
  const target = event.targetId ? world.characters.get(event.targetId) : null;
  if (!actor) return applied;

  for (const wid of event.witnesses) {
    const witness = world.characters.get(wid);
    if (!witness || witness.id === actor.id) continue;
    if (effects.witnessOnActor) {
      const c = mutateRelationship(witness, actor, effects.witnessOnActor);
      if (c) applied.push(c);
    }
    if (target && effects.witnessOnTarget) {
      const c = mutateRelationship(witness, target, effects.witnessOnTarget);
      if (c) applied.push(c);
    }
  }

  return applied;
}

/**
 * 关系联动规则：一个维度变化可能带动其他维度
 * 例如：恐惧升高 → 信任可能下降；怨恨升高 → 好感下降
 */
export function applyRelationshipCouplings(character: Character): void {
  for (const rel of character.relationships.values()) {
    // 怨恨升高 → 好感下降
    if (rel.resentment > 30) {
      rel.affinity = clamp(rel.affinity - rel.resentment * 0.1, -100, 100);
    }
    // 恐惧极高 → 信任下降（怕一个人就不会信任他）
    if (rel.fear > 70) {
      rel.trust = clamp(rel.trust - (rel.fear - 70) * 0.5, -100, 100);
    }
    // 信任极高 + 好感高 → 忠诚上升
    if (rel.trust > 60 && rel.affinity > 50) {
      rel.loyalty = clamp(Math.max(rel.loyalty, 60), 0, 100);
    }
  }
}

type RelationshipChangeEntry = NonNullable<EventResult['relationshipChanges']>[number];

function mutateRelationship(
  from: Character,
  to: Character,
  changes: Partial<Relationship>,
): RelationshipChangeEntry | null {
  let rel = from.relationships.get(to.id);
  if (!rel) {
    rel = { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
  }
  const delta: Partial<Relationship> = {};
  for (const [field, v] of Object.entries(changes)) {
    const key = field as keyof Relationship;
    const d = v ?? 0;
    if (d === 0) continue;
    rel[key] = clamp(rel[key] + d, -100, 100);
    delta[key] = d;
  }
  from.relationships.set(to.id, rel);
  if (Object.keys(delta).length === 0) return null;
  return { fromId: from.id, toId: to.id, changes: delta };
}

/**
 * 渲染某人对某些人的关系文本（给 LLM 用）
 */
export function renderRelationships(
  character: Character,
  targetIds: string[],
  world: World,
): string {
  const lines: string[] = [];
  for (const tid of targetIds) {
    const rel = character.relationships.get(tid);
    const name = world.characters.get(tid)?.name ?? tid;
    if (!rel) {
      lines.push(`- 对${name}：还不熟悉`);
      continue;
    }
    const parts = [
      rel.trust !== 0 ? `信任${rel.trust}` : null,
      rel.affinity !== 0 ? `好感${rel.affinity}` : null,
      rel.fear > 0 ? `恐惧${rel.fear}` : null,
      rel.respect > 0 ? `尊敬${rel.respect}` : null,
      rel.loyalty > 0 ? `忠诚${rel.loyalty}` : null,
      rel.resentment > 0 ? `怨恨${rel.resentment}` : null,
    ].filter(Boolean).join('，');
    lines.push(`- 对${name}：${parts || '关系中性'}`);
  }
  return lines.join('\n');
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
