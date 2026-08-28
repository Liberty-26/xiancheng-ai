# Phase 6：关系系统

> 目标：多维关系值（信任/好感/恐惧/尊重/忠诚/怨恨）受事件驱动变化，反过来影响 LLM 决策
>
> 预计时间：2-3 小时
>
> 前置依赖：Phase 5（LLM 决策 + 记忆反馈可用）

---

## 6.1 创建的所有文件

```
src/
├── relationship.ts     # 关系系统：事件 → 关系变化 + 联动规则
└── engine.ts           # 修改：事件后调用 relationship 系统
```

---

## 6.2 核心概念

### 关系不是"一个好感度"

```
现实里完全可能：
  我不喜欢你，但是我怕你。
  我喜欢你，但是不相信你。
  我很尊敬你，但是政治上反对你。

我们的 6 维关系就是为了表达这种组合性：
  trust（信任）   —— 我相信你吗
  affinity（好感）—— 我喜欢你吗
  fear（恐惧）    —— 我怕你吗
  respect（尊敬） —— 我尊敬你吗
  loyalty（忠诚） —— 我是否站你这边
  resentment（怨恨）—— 我是否怨恨你
```

### 关系变化是"结果"，不是"动作"

角色不能主动调用"增加好感"。关系变化**只能由事件产生**。

---

## 6.3 relationship.ts —— 关系系统

```typescript
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
    actorOnTarget: {},                                     // 给钱者对被给者
    targetOnActor: { trust: 15, affinity: 20, loyalty: 5 }, // 被给者对给钱者：感恩
  },
  steal: {
    actorOnTarget: {},                                     // 小偷对被偷者
    targetOnActor: { trust: -40, affinity: -30, resentment: 50, fear: 10 },  // 被偷者对小偷
    witnessOnActor: { trust: -20, affinity: -15 },          // 目击者对小偷：警惕
    witnessOnTarget: { affinity: 5, respect: 0 },            // 目击者对受害者：同情
  },
  buy: { targetOnActor: { trust: 5, affinity: 5 } },        // 卖者对买家：好感
  sell: { targetOnActor: { trust: 5, affinity: 5 } },       // 买者对卖家：好感
  demand_money: {
    targetOnActor: { trust: -30, fear: 35, resentment: 40 },
    actorOnTarget: { trust: -10, affinity: -10 },
  },

  // ── 执法类 ──
  arrest: {
    actorOnTarget: { resentment: 20 },                      // 逮捕者对被抓者
    targetOnActor: { resentment: 50, fear: 20 },            // 被抓者对逮捕者：怨恨+恐惧
    witnessOnActor: { respect: 15, trust: 10 },             // 目击者对逮捕者：尊敬
    witnessOnTarget: { fear: 10 },                          // 目击者对被抓者：害怕
  },
  release: {
    actorOnTarget: {},                                      // 释放者对释放者
    targetOnActor: { trust: 25, loyalty: 20, respect: 15 },  // 被释放者对释放者：感恩
    witnessOnActor: { respect: 10 },                        // 目击者对释放者
  },
  report_crime: {
    actorOnTarget: { resentment: -5 },                      // 举报者对罪犯
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

  // ── 组织类 ──
  join_faction: {
    // 同组织成员之间的归属感（Phase 8 完善）
  },
  leave_faction: {},

  // ── 其他 ──
  idle: {},
  move: {},
};

/**
 * 事件 → 关系变化（唯一入口）
 * 由 engine 在 applyEvent 后调用
 */
export function applyRelationshipChanges(
  event: GameEvent,
  world: World
): void {
  const effects = RELATIONSHIP_EFFECTS[event.type];
  if (!effects) return;

  const actor = world.characters.get(event.actorId);
  const target = event.targetId ? world.characters.get(event.targetId) : null;
  if (!actor) return;

  // 1. actor 对 target 的变化
  if (target && effects.actorOnTarget) {
    mutateRelationship(actor, target, effects.actorOnTarget);
  }
  // 2. target 对 actor 的变化
  if (target && effects.targetOnActor) {
    mutateRelationship(target, actor, effects.targetOnActor);
  }
  // 3. 目击者对 actor / target
  for (const wid of event.witnesses) {
    const witness = world.characters.get(wid);
    if (!witness || witness.id === actor.id) continue;
    if (effects.witnessOnActor) mutateRelationship(witness, actor, effects.witnessOnActor);
    if (target && effects.witnessOnTarget) mutateRelationship(witness, target, effects.witnessOnTarget);
  }
}

/**
 * 关系联动规则：一个维度变化可能带动其他维度
 * 例如：恐惧升高 → 信任可能下降；怨恨升高 → 好感下降
 */
export function applyRelationshipCouplings(character: Character): void {
  for (const [targetId, rel] of character.relationships) {
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

function mutateRelationship(
  from: Character,
  to: Character,
  changes: Partial<Relationship>
): void {
  let rel = from.relationships.get(to.id);
  if (!rel) {
    rel = { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
  }
  for (const [field, delta] of Object.entries(changes)) {
    const key = field as keyof Relationship;
    rel[key] = clamp(rel[key] + (delta ?? 0), -100, 100);
  }
  from.relationships.set(to.id, rel);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 渲染某人对某些人的关系文本（给 LLM 用）
 */
export function renderRelationships(
  character: Character,
  targetIds: string[],
  world: World
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
```

---

## 6.4 修改 engine.ts —— 接入关系系统

```typescript
// engine.ts 关键改动：

import { applyRelationshipChanges, applyRelationshipCouplings } from './relationship';

private async tick() {
  // ... 执行动作，生成 event ...

  // 应用事件的所有变化
  this.applyEvent(event);

  // ★ 关系变化（事件驱动）
  applyRelationshipChanges(event, this.world);

  // ★ 关系联动（恐惧→信任等）
  for (const c of this.world.characters.values()) {
    applyRelationshipCouplings(c);
  }

  // ★ 关系变化 → 记忆（重要变化才记录）
  for (const rc of event.result.relationshipChanges ?? []) {
    for (const [field, val] of Object.entries(rc.changes)) {
      if (Math.abs(val as number) >= 10) {
        this.memorySystem.recordRelationshipChange(rc.fromId, rc.toId, { field, value: val as number }, this.world.tick);
      }
    }
  }
}
```

---

## 6.5 关系变化也记入事件结果（让 delta 审计完整）

在 `executors.ts` 中，偷窃执行器已经写了 relationshipChanges。为了让关系系统统一，让 `applyRelationshipChanges` 的结果也写回 event：

```typescript
// relationship.ts 增加：把变化追加到 event.result
export function applyRelationshipChanges(
  event: GameEvent,
  world: World
): void {
  // ... 现有逻辑 ...
  // 追加到事件结果（供审计/回放）
  const allChanges: EventResult['relationshipChanges'] = [];
  // 在 mutateRelationship 时收集变化
  // ... 简化：直接收集
}
```

---

## 6.6 验收测试

### 验收标准 1：偷窃 → 多维关系变化

```bash
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { execute } from './src/rules';
import { applyRelationshipChanges, applyRelationshipCouplings } from './src/relationship';

const world = createInitialWorld();
const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;

// 偷窃前
console.log('偷窃前 商人对小偷:');
console.log('  trust:', merchant.relationships.get('char_xiaotou')?.trust);

const event = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief, world);
applyRelationshipChanges(event, world);
applyRelationshipCouplings(merchant);

console.log('偷窃后 商人对小偷:');
const rel = merchant.relationships.get('char_xiaotou')!;
console.log('  trust:', rel.trust, 'affinity:', rel.affinity, 'fear:', rel.fear, 'resentment:', rel.resentment);
"
```

预期输出（示例）：
```
偷窃前 商人对小偷: trust: -40
偷窃后 商人对小偷:
  trust: -80 affinity: -70 fear: 10 resentment: 90
```

### 验收标准 2：关系联动

```typescript
// 恐惧升到 75+ → 信任自动下降
// 怨恨升到 40+ → 好感自动下降
```

### 验收标准 3：关系进入 LLM 决策上下文

```typescript
// Phase 5 的 prompt-builder 已包含关系渲染
// 商人被偷后，对三指的 trust=-80, resentment=90
// → 商人决策时 LLM 看到"我对三指极度怨恨、不信任"
// → 商人更可能 report_crime / hire 保镖 / 离开
```

---

## 6.7 验收清单

- [ ] 6 维关系都有：trust/affinity/fear/respect/loyalty/resentment
- [ ] 事件驱动关系变化（偷窃/逮捕/给钱/威胁/行贿/雇佣/举报/释放）
- [ ] 关系变化支持 actorOnTarget / targetOnActor / witnessOnActor / witnessOnTarget 四个方向
- [ ] 关系联动：恐惧→信任、怨恨→好感
- [ ] 关系变化重要时记入记忆
- [ ] 关系进入 LLM 决策上下文
- [ ] 关系值 clamp 在 -100~100（fear 0~100）

---

## 6.8 完成标志

运行 `npm start`，看到：
1. 商人被偷后，对三指的关系显著恶化（trust/affinity 下降、怨恨上升）
2. 三指被通缉后，其他人对他的恐惧和警惕上升
3. 商人开始改变行为（举报/雇佣保镖/远离三指）
4. 关系变化在角色面板可见（Phase 7 前端）
