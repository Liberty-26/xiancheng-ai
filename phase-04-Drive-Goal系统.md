# Phase 4：Drive + Goal 系统

> 目标：角色有持久的内在驱动力，基于 drives 生成目标，目标驱动行为，完成后检测
>
> 预计时间：4-5 小时
>
> 前置依赖：Phase 1-3（类型 + 规则引擎 + 感知/传播）

---

## 4.1 创建的所有文件

```
src/
├── drive.ts           # Drive 系统：驱动力 + 事件变化 + 自然衰减
├── goal.ts            # Goal 系统：目标生成（模板版）+ 完成检测
├── goal-manager.ts    # Goal 管理：评估时机 + 生命周期
└── engine.ts          # 修改：每 tick 调用 drive/goal 系统
```

---

## 4.2 核心概念

### Drive（驱动力）—— 角色"为什么做事"

每个角色有 5 个驱动力（0-1）：

| Drive | 含义 | 高了会怎样 | 低了会怎样 |
|---|---|---|---|
| safety | 安全 | 想搞武器/找保护 | 想冒险/不在乎 |
| wealth | 财富 | 想赚钱/偷/卖 | 挥霍/行善 |
| power | 权力 | 想升官/组建势力 | 服从/躺平 |
| belonging | 归属 | 想加入组织/交朋友 | 独来独往 |
| revenge | 复仇 | 想报复某人 | 宽容/遗忘 |

**Drive 的变化由规则引擎判定（DRIVE_EFFECTS 表），不是 LLM 自己写。**

### Goal（目标）—— 角色"现在要做什么"

Goal 由 LLM 或模板根据 Drives 生成，持久化，跨 tick 生效。

```
Drive 变化 → 触发 Goal 重评估 → 生成/更新/放弃 Goal → Goal 驱动决策 → 完成后检测
```

---

## 4.3 drive.ts —— Drive 系统

```typescript
import { Drives, GameEvent, Character, World } from './types';

/** 每个角色人格对应的"基线"（Drive 会自然回归到这个值） */
export function getDriveBaseline(character: Character): Drives {
  // 基线由人格决定：
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
};

/**
 * 应用事件对某角色的 Drive 影响
 */
export function applyDriveChanges(
  character: Character,
  event: GameEvent,
  world: World
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
export function decayDrives(character: Character): void {
  const baseline = getDriveBaseline(character);
  const DECAY_RATE = 0.02;  // 每 tick 回归 2%

  for (const key of Object.keys(character.drives) as (keyof Drives)[]) {
    const current = character.drives[key];
    const target = baseline[key];
    character.drives[key] = clamp01(current + (target - current) * DECAY_RATE);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
```

---

## 4.4 goal.ts —— Goal 系统

```typescript
import { Character, Goal, World, GoalCondition, Relationship } from './types';
import { Drives } from './types';

/**
 * Goal 生成（Phase 4：模板版，基于 drives + 人格）
 * Phase 5 换成 LLM 生成
 */
export function generateGoalTemplate(character: Character, world: World): Goal | null {
  const d = character.drives;
  const p = character.personality;

  // 按优先级判断最需要的目标
  const candidates: Goal[] = [];

  // 1. 安全极低 → 想搞武器/躲藏
  if (d.safety < 0.3) {
    candidates.push(makeGoal(character, {
      description: '想办法提高自己的安全',
      condition: { type: 'custom', description: '购买武器或加入有保护的组织', check: 'safety_restored' },
      priority: 0.9,
      source: 'drive',
    }));
  }

  // 2. 财富低且贪婪高 → 想赚钱
  if (d.wealth < 0.35 && p.greed > 0.5) {
    candidates.push(makeGoal(character, {
      description: '攒够一笔钱（100两）',
      condition: { type: 'money_ge', value: 100 },
      priority: 0.85,
      source: 'drive',
    }));
  }

  // 3. 复仇高 → 想报复
  if (d.revenge > 0.6) {
    const enemy = findEnemy(character);
    if (enemy) {
      candidates.push(makeGoal(character, {
        description: `报复${enemy.name}`,
        condition: { type: 'relationship_le', targetId: enemy.id, field: 'trust', value: -90 },
        priority: 0.8,
        source: 'drive',
      }));
    }
  }

  // 4. 权力低但野心高 → 想提升地位
  if (d.power < 0.3 && p.ambition > 0.6) {
    candidates.push(makeGoal(character, {
      description: '提升自己在县城的地位',
      condition: { type: 'faction_joined', factionId: 'faction_guanfu' },
      priority: 0.7,
      source: 'drive',
    }));
  }

  // 5. 归属低 → 想交朋友/加入组织
  if (d.belonging < 0.3) {
    candidates.push(makeGoal(character, {
      description: '在县城里找到归属',
      condition: { type: 'custom', description: '加入一个组织或建立深厚友谊', check: 'belonging_restored' },
      priority: 0.6,
      source: 'drive',
    }));
  }

  // 返回最高优先级的目标
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

function makeGoal(
  character: Character,
  params: {
    description: string;
    condition: GoalCondition;
    priority: number;
    source: Goal['source'];
    strategy?: string;
  }
): Goal {
  return {
    id: `goal_${character.id}_${Date.now()}`,
    characterId: character.id,
    description: params.description,
    condition: params.condition,
    priority: params.priority,
    status: 'active',
    progress: 0,
    createdAt: 0,  // 调用方设置 tick
    source: params.source,
    strategy: params.strategy,
  };
}

/** 找到复仇对象（怨恨最深的人） */
function findEnemy(character: Character): Character | null {
  let worst: { id: string; resentment: number } | null = null;
  for (const [id, rel] of character.relationships) {
    if (!worst || rel.resentment > worst.resentment) {
      worst = { id, resentment: rel.resentment };
    }
  }
  return worst && worst.resentment > 30 ? { id: worst.id } as Character : null;
}

/**
 * 检查 Goal 是否完成
 * 返回 completed / failed / still active
 */
export function checkGoalCompletion(
  goal: Goal,
  character: Character,
  world: World
): 'completed' | 'failed' | 'active' {
  const cond = goal.condition;

  switch (cond.type) {
    case 'money_ge':
      return character.money >= cond.value ? 'completed' : 'active';

    case 'item_has': {
      const owned = character.inventory.find(i => i.itemId === cond.itemId)?.quantity ?? 0;
      return owned >= cond.quantity ? 'completed' : 'active';
    }

    case 'relationship_le': {
      const rel: Relationship | undefined = character.relationships.get(cond.targetId);
      const val = rel?.[cond.field] ?? 0;
      return val <= cond.value ? 'completed' : 'active';
    }

    case 'location_at':
      return character.locationId === cond.locationId ? 'completed' : 'active';

    case 'faction_joined':
      return character.factionId === cond.factionId ? 'completed' : 'active';

    case 'wanted_le':
      return character.wantedLevel <= cond.value ? 'completed' : 'active';

    case 'custom':
      return checkCustomCondition(cond.check, character, world);

    default:
      return 'active';
  }
}

function checkCustomCondition(
  checkName: string,
  character: Character,
  world: World
): 'completed' | 'active' {
  // Phase 4 用简单规则；Phase 8 完善
  switch (checkName) {
    case 'safety_restored':
      return character.drives.safety >= 0.5 ? 'completed' : 'active';
    case 'belonging_restored':
      return character.drives.belonging >= 0.5 ? 'completed' : 'active';
    case 'security_gt_60':
      return world.state.security > 60 ? 'completed' : 'active';
    case 'crime_lt_30':
      return world.state.crimeLevel < 30 ? 'completed' : 'active';
    default:
      return 'active';
  }
}

/**
 * 更新 Goal 进度（0-1）
 */
export function updateGoalProgress(
  goal: Goal,
  character: Character,
  world: World
): void {
  const cond = goal.condition;
  switch (cond.type) {
    case 'money_ge':
      goal.progress = Math.min(1, character.money / cond.value);
      break;
    case 'item_has': {
      const owned = character.inventory.find(i => i.itemId === cond.itemId)?.quantity ?? 0;
      goal.progress = Math.min(1, owned / cond.quantity);
      break;
    }
    case 'relationship_le': {
      const rel = character.relationships.get(cond.targetId);
      const val = rel?.[cond.field] ?? 0;
      goal.progress = Math.max(0, Math.min(1, 1 - val / 100));
      break;
    }
    case 'wanted_le':
      goal.progress = Math.max(0, Math.min(1, 1 - character.wantedLevel / 10));
      break;
    default:
      goal.progress = 0.5;
  }
}
```

---

## 4.5 goal-manager.ts —— Goal 管理

```typescript
import { Character, World, Goal } from './types';
import { generateGoalTemplate } from './goal';
import { checkGoalCompletion, updateGoalProgress } from './goal';
import { getDriveBaseline } from './drive';

export class GoalManager {
  // 记录每个角色上次评估的 tick（避免每 tick 都评估）
  private lastEvaluated = new Map<string, number>();
  private readonly EVAL_INTERVAL = 5;        // 每 5 tick 评估一次
  private readonly DRIVE_CHANGE_THRESHOLD = 0.15;  // 或 drive 变化超过 0.15

  constructor(private world: World) {}

  /** 每 tick 调用：检查完成 + 决定是否重评估 */
  tick(): void {
    for (const [id, character] of this.world.characters) {
      if (!character.isAlive || character.isDetained) continue;
      this.checkAndUpdateGoal(character);
      this.maybeReevaluate(character);
    }
  }

  /** 检查当前 Goal 是否完成/失败 */
  private checkAndUpdateGoal(character: Character): void {
    if (!character.currentGoal) return;

    // 更新进度
    updateGoalProgress(character.currentGoal, character, this.world);

    // 检查完成
    const status = checkGoalCompletion(character.currentGoal, character, this.world);
    if (status === 'completed') {
      console.log(`  [目标达成] ${character.name}：${character.currentGoal.description}`);
      // 完成目标后：Drives 奖励（满足感）
      character.drives.wealth = Math.min(1, character.drives.wealth + 0.1);
      character.drives.belonging = Math.min(1, character.drives.belonging + 0.1);
      character.currentGoal = null;  // 清空，下次会生成新目标
      this.lastEvaluated.set(character.id, this.world.tick);
    } else if (status === 'failed') {
      character.currentGoal.status = 'failed';
      character.currentGoal = null;
      this.lastEvaluated.set(character.id, this.world.tick);
    }
  }

  /** 决定是否重新评估（生成新 Goal） */
  private maybeReevaluate(character: Character): void {
    // 没有目标 → 生成一个
    if (!character.currentGoal) {
      this.generateNewGoal(character);
      return;
    }

    // 间隔到了 → 重新评估
    const lastEval = this.lastEvaluated.get(character.id) ?? 0;
    if (this.world.tick - lastEval < this.EVAL_INTERVAL) return;

    // Drive 相对基线变化过大 → 重新评估
    const baseline = getDriveBaseline(character);
    const driveDrift = Object.keys(character.drives).some(
      (key) => Math.abs(character.drives[key as keyof typeof character.drives] - baseline[key as keyof typeof baseline]) > this.DRIVE_CHANGE_THRESHOLD
    );
    if (!driveDrift) return;

    this.generateNewGoal(character);
  }

  /** 生成新 Goal（Phase 4：模板；Phase 5：LLM） */
  private generateNewGoal(character: Character): void {
    const newGoal = generateGoalTemplate(character, this.world);
    if (!newGoal) return;
    newGoal.createdAt = this.world.tick;

    if (character.currentGoal) {
      character.currentGoal.status = 'abandoned';
      console.log(`  [目标放弃] ${character.name}：${character.currentGoal.description}`);
    }

    character.currentGoal = newGoal;
    this.lastEvaluated.set(character.id, this.world.tick);
    console.log(`  [新目标] ${character.name}：${newGoal.description}（优先级 ${newGoal.priority.toFixed(1)}）`);
  }

  /** 供决策层读取：把 Goal 渲染成文本（Phase 5 用） */
  renderGoal(character: Character): string {
    if (!character.currentGoal) return '（暂无目标）';
    const g = character.currentGoal;
    return `"${g.description}"（进度 ${Math.round(g.progress * 100)}%，优先级 ${g.priority.toFixed(1)}）`;
  }
}
```

---

## 4.6 修改 engine.ts —— 接入 Drive + Goal

```typescript
// engine.ts 关键改动：

import { applyDriveChanges, decayDrives } from './drive';
import { GoalManager } from './goal-manager';

// constructor 里初始化：
private goalManager: GoalManager;
constructor() {
  this.world = createInitialWorld();
  this.goalManager = new GoalManager(this.world);
}

private async tick() {
  // ... 时间推进 ...

  // ★ 每 tick 先衰减 Drives
  for (const character of this.world.characters.values()) {
    decayDrives(character);
  }

  // 角色决策与执行
  for (const [id, character] of this.world.characters) {
    if (character.isDetained || !character.isAlive) continue;

    const decision = makeTestDecision(character);  // Phase 5 换 LLM
    if (!decision) continue;

    const event = executeAction(decision, character, this.world);
    this.world.events.push(event);
    this.applyEvent(event);

    // ★ 事件 → Drive 变化
    applyDriveChanges(character, event, this.world);

    this.knowledge.recordEvent(event);
  }

  // ★ Goal 检查与重评估
  this.goalManager.tick();

  this.printWorldState();
  this.printDrives();
}

private printDrives() {
  for (const c of this.world.characters.values()) {
    const d = c.drives;
    console.log(`  ${c.name} | 安全:${d.safety.toFixed(2)} 财富:${d.wealth.toFixed(2)} 权力:${d.power.toFixed(2)} 归属:${d.belonging.toFixed(2)} 复仇:${d.revenge.toFixed(2)} | ${this.goalManager.renderGoal(c)}`);
  }
}
```

---

## 4.7 验收测试

### 验收标准 1：事件 → Drive 变化

```bash
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { execute } from './src/rules';
import { applyDriveChanges } from './src/drive';

const world = createInitialWorld();
const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;

console.log('偷窃前 三指: wealth =', thief.drives.wealth, ', safety =', thief.drives.safety);

const event = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief, world);
applyDriveChanges(thief, event, world);

console.log('偷窃后 三指: wealth =', thief.drives.wealth.toFixed(2), ', safety =', thief.drives.safety.toFixed(2));
// 预期：wealth 上升（+0.08），safety 下降（-0.08）
"
```

### 验收标准 2：Goal 生成与完成

```bash
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { GoalManager } from './src/goal-manager';

const world = createInitialWorld();
const goalManager = new GoalManager(world);
const thief = world.characters.get('char_xiaotou')!;

// 初始：三指 wealth 0.8 > 0.35，不该触发'赚钱'目标
// 手动压低 wealth 模拟缺钱
thief.drives.wealth = 0.2;
thief.personality.greed = 0.9;

goalManager.tick();
console.log('三指新目标:', thief.currentGoal?.description);  // 预期：'攒够一笔钱（100两）'

// 给钱到 100
thief.money = 100;
goalManager.tick();
console.log('达成后目标:', thief.currentGoal);  // 预期：null（已完成清空）
"
```

### 验收标准 3：目标驱动行为

```typescript
// Phase 4 测试版决策应该参考 Goal：
function makeTestDecision(c: Character): ActionDecision | null {
  if (c.currentGoal?.condition.type === 'money_ge') {
    return { action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } };
  }
  if (c.currentGoal?.condition.type === 'custom' && c.currentGoal.condition.check === 'safety_restored') {
    return { action: 'buy', parameters: { itemId: 'knife', quantity: 1 } };
  }
  return { action: 'idle' };
}
```

---

## 4.8 验收清单

- [ ] 5 个驱动力在角色创建时有初始值（0-1）
- [ ] 事件发生后，actor 和 target 的 drives 按 DRIVE_EFFECTS 表变化
- [ ] drives 每 tick 向人格基线自然衰减（2%）
- [ ] 低 drives 触发模板目标生成（缺钱→赚钱，不安全→买武器等）
- [ ] Goal 每 5 tick 或 drive 漂移 > 0.15 时重评估
- [ ] Goal 完成条件由规则引擎检查（money_ge/item_has/relationship_le 等）
- [ ] Goal 完成后清空并奖励 drives
- [ ] Goal 状态生命周期正确（active/completed/abandoned/failed）
- [ ] 测试决策会参考当前 Goal

---

## 4.9 完成标志

运行 `npm start`，看到：
1. 每个角色行尾显示当前目标和进度
2. 三指开始有"攒钱"目标，反复偷商人
3. 被通缉后 safety 下降，三指可能生成"提高安全"目标
4. 商人被偷后 wealth 下降、revenge 上升，可能出现"报复"目标
5. 目标达成后清空，生成新目标
