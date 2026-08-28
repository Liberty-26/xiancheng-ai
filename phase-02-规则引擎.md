# Phase 2：规则引擎

> 目标：能执行 15 个社会动作，规则引擎判定成功/失败，修改角色状态，生成事件
>
> 预计时间：4-6 小时
>
> 前置依赖：Phase 1（types.ts + engine.ts 骨架）

---

## 2.1 创建的所有文件

```
src/
├── rules/
│   ├── index.ts         # 规则引擎入口（execute 分发）
│   ├── executors.ts     # 15 个动作执行器
│   ├── checks.ts        # 合法性检查
│   ├── success-rates.ts # 成功率计算
│   └── pricing.ts       # 价格计算
└── engine.ts            # 修改：接入规则引擎
```

---

## 2.2 核心概念

### 规则引擎是唯一能改状态的地方

```
LLM 输出 {"action":"steal", "targetId":"char_shangren", "parameters":{"amount":30}}
  ↓
rules.execute(decision, actor, world)
  ↓
  1. checks.ts 检查合法性（能不能偷、能不能抓）
  2. success-rates.ts 计算成功率
  3. executors.ts 执行动作，返回 EventResult
  4. 生成 GameEvent
  ↓
engine.ts 调用 applyEvent() 应用变化
```

### EventResult 的结构（决定状态怎么变）

```typescript
interface EventResult {
  success: boolean;
  description: string;             // 一句话结果描述
  moneyChanges?: { characterId: string; amount: number }[];
  itemChanges?: { characterId: string; itemId: string; quantity: number }[];
  driveChanges?: { characterId: string; changes: Partial<Drives> }[];
  relationshipChanges?: { fromId: string; toId: string; changes: Partial<Relationship> }[];
  worldStateChanges?: Partial<WorldState>;
  wantedChanges?: { characterId: string; delta: number }[];
  detentionChanges?: { characterId: string; detained: boolean }[];
  witnesses: string[];             // 目击者 ID
}
```

---

## 2.3 成功率计算（success-rates.ts）

```typescript
import { Character, World, LocationId } from '../types';

export interface SuccessContext {
  actor: Character;
  target: Character | null;
  locationId: LocationId;
  world: World;
}

/**
 * 计算一个动作的成功率（0-1）
 * 原则：能力 + 状态 + 环境 + 对方状态 + 随机
 */
export function computeSuccessRate(
  action: string,
  ctx: SuccessContext
): number {
  const { actor, target, locationId, world } = ctx;
  const rng = () => Math.random() * 0.15;  // 随机浮动 0-0.15

  switch (action) {
    case 'steal': {
      // 偷窃成功率 = 隐蔽能力 * 0.4 + (1 - 目标战斗) * 0.25 + 地点隐蔽性 * 0.2 + 随机
      const locationStealth = STEALTH_BY_LOCATION[locationId] ?? 0.5;
      const targetCombatFactor = target ? (1 - target.skills.combat / 10) * 0.25 : 0.3;
      return clamp(
        actor.skills.stealth / 10 * 0.4 +
        targetCombatFactor +
        locationStealth * 0.2 +
        rng(),
        0.05, 0.95
      );
    }

    case 'arrest': {
      // 逮捕成功率 = 权限 + 战力差 + 对方状态
      if (actor.authorityLevel < 5) return 0;  // 权限不够不能抓
      const authorityBonus = (actor.authorityLevel - 5) * 0.08;
      const combatDiff = (actor.skills.combat - (target?.skills.combat ?? 5)) / 10 * 0.3;
      return clamp(0.5 + authorityBonus + combatDiff + rng(), 0.1, 0.98);
    }

    case 'bribe': {
      // 行贿成功率 = 金额吸引力 + 对方贪婪 + 对方正直
      if (!target) return 0;
      const amount = ctxAmount(ctx);  // 从参数取金额
      const amountAttract = Math.min(0.3, amount / 100);
      const greedFactor = target.personality.greed * 0.3;
      const honestyPenalty = target.personality.honesty * 0.2;
      return clamp(amountAttract + greedFactor - honestyPenalty + rng(), 0.02, 0.9);
    }

    case 'threaten': {
      // 威胁成功率 = 威慑力 + 目标恐惧 - 目标勇气
      if (!target) return 0;
      const intimidate = actor.skills.intimidation / 10 * 0.35;
      const targetFear = (target.relationships.get(actor.id)?.fear ?? 0) / 100 * 0.35;
      const targetResist = target.personality.riskTolerance * 0.2;
      return clamp(intimidate + targetFear - targetResist + rng(), 0.05, 0.9);
    }

    case 'demand_money': {
      // 勒索 = 威慑 + 恐惧 - 抵抗
      return computeSuccessRate('threaten', ctx);
    }

    case 'release': {
      // 释放 = 权限检查
      if (actor.authorityLevel < 5) return 0;
      if (!target?.isDetained) return 0;
      return 1;
    }

    case 'buy':
    case 'sell':
      return 1;  // 买卖总是成功（价格可能不满意）

    case 'give_money':
    case 'report_crime':
    case 'join_faction':
    case 'leave_faction':
    case 'move':
    case 'talk':
    case 'hire':
      return 1;  // 这些动作总是能发起（结果由规则/LLM 决定）

    default:
      return 0.5;
  }
}

// 地点的隐蔽性（0-1）
const STEALTH_BY_LOCATION: Record<LocationId, number> = {
  hideout: 0.9,     // 地下据点最隐蔽
  warehouse: 0.7,   // 仓库
  houses: 0.5,      // 民宅
  gate: 0.3,        // 城门（有人把守）
  market: 0.2,      // 街市（人多）
  shop: 0.4,        // 商铺
  yamen: 0.1,       // 县衙（守卫森严）
  main_area: 0.5,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
```

---

## 2.4 合法性检查（checks.ts）

```typescript
import { Character, World } from '../types';

export interface CheckResult {
  allowed: boolean;
  reason: string;
}

export function checkAction(
  action: string,
  actor: Character,
  target: Character | null,
  world: World
): CheckResult {
  switch (action) {
    case 'steal':
      if (actor.locationId === 'yamen') return { allowed: false, reason: '县衙守卫森严，不敢下手' };
      if (target && target.id === actor.id) return { allowed: false, reason: '不能偷自己' };
      return { allowed: true, reason: '' };

    case 'arrest':
      if (actor.authorityLevel < 5) return { allowed: false, reason: '你没有执法权' };
      if (target?.factionId === 'faction_guanfu') return { allowed: false, reason: '不能抓官府的人' };
      if (target?.isDetained) return { allowed: false, reason: '他已经在押' };
      return { allowed: true, reason: '' };

    case 'release':
      if (actor.authorityLevel < 5) return { allowed: false, reason: '你没有执法权' };
      return { allowed: true, reason: '' };

    case 'bribe':
      if (actor.money <= 0) return { allowed: false, reason: '你没钱行贿' };
      return { allowed: true, reason: '' };

    case 'demand_money':
      if (target && target.skills.combat > actor.skills.combat + 2) {
        return { allowed: false, reason: '对方比你强，勒索有风险' };
      }
      return { allowed: true, reason: '' };

    case 'join_faction':
      if (actor.factionId) return { allowed: false, reason: '你已经加入组织' };
      return { allowed: true, reason: '' };

    case 'leave_faction':
      if (!actor.factionId) return { allowed: false, reason: '你不在任何组织里' };
      return { allowed: true, reason: '' };

    case 'move':
      return { allowed: true, reason: '' };

    default:
      return { allowed: true, reason: '' };
  }
}
```

---

## 2.5 动作执行器（executors.ts）

```typescript
import { Character, World, GameEvent, EventResult, ActionDecision } from '../types';
import { checkAction } from './checks';
import { computeSuccessRate, SuccessContext } from './success-rates';
import { ITEM_PRICES } from './pricing';

export function execute(
  decision: ActionDecision,
  actor: Character,
  world: World
): GameEvent {
  const target = decision.targetId ? world.characters.get(decision.targetId) ?? null : null;

  // 1. 合法性检查
  const check = checkAction(decision.action, actor, target, world);
  if (!check.allowed) {
    return makeEvent(decision, actor, target, world, false, {
      description: check.reason,
      witnesses: getWitnesses(actor, world),
    });
  }

  // 2. 计算成功率
  const ctx: SuccessContext = { actor, target, locationId: actor.locationId, world };
  const rate = computeSuccessRate(decision.action, ctx);
  const success = Math.random() < rate;

  // 3. 分发到具体执行器
  const executor = EXECUTORS[decision.action];
  if (!executor) {
    return makeEvent(decision, actor, target, world, false, {
      description: `未知动作: ${decision.action}`,
      witnesses: getWitnesses(actor, world),
    });
  }

  const result = executor(decision, actor, target, world, success);
  return makeEvent(decision, actor, target, world, success, result);
}

// 每个动作的执行逻辑（返回 EventResult，即状态变化）
const EXECUTORS: Record<string, (
  decision: ActionDecision,
  actor: Character,
  target: Character | null,
  world: World,
  success: boolean
) => EventResult> = {

  // ── 给钱 ──
  give_money: (d, actor, target, world, success) => {
    const amount = Number(d.parameters?.amount ?? 0);
    if (!target || amount <= 0 || actor.money < amount) {
      return { success: false, description: '给钱失败：金额无效或钱不够', witnesses: getWitnesses(actor, world) };
    }
    return {
      success: true,
      description: `${actor.name}给了${target.name}${amount}两银子`,
      moneyChanges: [
        { characterId: actor.id, amount: -amount },
        { characterId: target.id, amount },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 10, affinity: 15 } },
      ],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 偷窃 ──
  steal: (d, actor, target, world, success) => {
    const amount = Number(d.parameters?.amount ?? 20);
    if (!target) {
      // 偷地点（如仓库）→ 从该地点的库存偷
      const stolen = Math.min(amount, world.state.grainReserve);
      if (!success) {
        return {
          success: false,
          description: `${actor.name}偷窃失败，惊动了守卫`,
          wantedChanges: [{ characterId: actor.id, delta: 1 }],
          worldStateChanges: { security: -1 },
          witnesses: getWitnesses(actor, world),
        };
      }
      return {
        success: true,
        description: `${actor.name}从仓库偷了${stolen}两的粮食`,
        wantedChanges: [{ characterId: actor.id, delta: 2 }],
        worldStateChanges: { security: -2, grainReserve: -stolen, crimeLevel: 2 },
        witnesses: getWitnesses(actor, world),
      };
    }

    // 偷角色
    const stolen = Math.min(amount, target.money);
    if (!success) {
      return {
        success: false,
        description: `${actor.name}想偷${target.name}的钱，被发现了`,
        wantedChanges: [{ characterId: actor.id, delta: 1 }],
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -30, affinity: -25, resentment: 40 } },
        ],
        worldStateChanges: { crimeLevel: 2, security: -1 },
        witnesses: getWitnesses(actor, world),
      };
    }
    return {
      success: true,
      description: `${actor.name}偷走了${target.name}${stolen}两银子`,
      moneyChanges: [
        { characterId: target.id, amount: -stolen },
        { characterId: actor.id, amount: stolen },
      ],
      wantedChanges: [{ characterId: actor.id, delta: 3 }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: -40, affinity: -30, resentment: 50 } },
      ],
      worldStateChanges: { crimeLevel: 3, security: -2 },
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 买 ──
  buy: (d, actor, target, world, success) => {
    const itemId = String(d.parameters?.itemId ?? 'grain');
    const quantity = Number(d.parameters?.quantity ?? 1);
    const price = ITEM_PRICES[itemId]?.price ?? 10;
    const total = price * quantity;
    if (actor.money < total) {
      return { success: false, description: `${actor.name}钱不够买${itemId}`, witnesses: getWitnesses(actor, world) };
    }
    return {
      success: true,
      description: `${actor.name}买了${quantity}个${itemId}（共${total}两）`,
      moneyChanges: [{ characterId: actor.id, amount: -total }],
      itemChanges: [{ characterId: actor.id, itemId, quantity }],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 卖 ──
  sell: (d, actor, target, world, success) => {
    const itemId = String(d.parameters?.itemId ?? 'grain');
    const quantity = Number(d.parameters?.quantity ?? 1);
    const price = ITEM_PRICES[itemId]?.price ?? 10;
    const owned = actor.inventory.find(i => i.itemId === itemId)?.quantity ?? 0;
    if (owned < quantity) {
      return { success: false, description: `${actor.name}没有足够的${itemId}`, witnesses: getWitnesses(actor, world) };
    }
    const total = price * quantity;
    return {
      success: true,
      description: `${actor.name}卖了${quantity}个${itemId}（得${total}两）`,
      moneyChanges: [{ characterId: actor.id, amount: total }],
      itemChanges: [{ characterId: actor.id, itemId, quantity: -quantity }],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 逮捕 ──
  arrest: (d, actor, target, world, success) => {
    if (!target) return { success: false, description: '逮捕目标无效', witnesses: getWitnesses(actor, world) };
    if (!success) {
      return {
        success: false,
        description: `${actor.name}试图逮捕${target.name}，被对方逃脱`,
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { resentment: 30, fear: 10 } },
        ],
        witnesses: getWitnesses(actor, world),
      };
    }
    return {
      success: true,
      description: `${actor.name}逮捕了${target.name}`,
      detentionChanges: [{ characterId: target.id, detained: true }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { resentment: 40, fear: 20 } },
      ],
      worldStateChanges: { security: 5, crimeLevel: -3 },
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 释放 ──
  release: (d, actor, target, world, success) => {
    if (!target) return { success: false, description: '释放目标无效', witnesses: getWitnesses(actor, world) };
    return {
      success: true,
      description: `${actor.name}释放了${target.name}`,
      detentionChanges: [{ characterId: target.id, detained: false }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 20, gratitude: 30 } },
      ],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 行贿 ──
  bribe: (d, actor, target, world, success) => {
    const amount = Number(d.parameters?.amount ?? 10);
    if (!target || actor.money < amount) {
      return { success: false, description: '行贿失败：目标无效或钱不够', witnesses: getWitnesses(actor, world) };
    }
    if (!success) {
      return {
        success: false,
        description: `${actor.name}试图行贿${target.name}，被拒绝`,
        moneyChanges: [{ characterId: actor.id, amount: -amount }],
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -10, respect: -10 } },
        ],
        wantedChanges: [{ characterId: actor.id, delta: 2 }],  // 行贿被拒可能被告发
        witnesses: getWitnesses(actor, world),
      };
    }
    return {
      success: true,
      description: `${actor.name}行贿${target.name}${amount}两，${
        target.role === '县武装总管' || target.role === '县令' ? '对方收下了' : '对方动摇了'
      }`,
      moneyChanges: [
        { characterId: actor.id, amount: -amount },
        { characterId: target.id, amount },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { affinity: 10, respect: -10, loyalty: -5 } },
      ],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 威胁 ──
  threaten: (d, actor, target, world, success) => {
    const demand = Number(d.parameters?.amount ?? 10);
    if (!target) return { success: false, description: '威胁目标无效', witnesses: getWitnesses(actor, world) };
    if (!success) {
      return {
        success: false,
        description: `${actor.name}威胁${target.name}，${target.name}不吃这套`,
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -20, resentment: 30 } },
        ],
        wantedChanges: [{ characterId: actor.id, delta: 1 }],
        witnesses: getWitnesses(actor, world),
      };
    }
    const paid = Math.min(demand, target.money);
    return {
      success: true,
      description: `${actor.name}威胁${target.name}，${target.name}被迫交出${paid}两`,
      moneyChanges: [
        { characterId: target.id, amount: -paid },
        { characterId: actor.id, amount: paid },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: -30, fear: 40, resentment: 30 } },
      ],
      wantedChanges: [{ characterId: actor.id, delta: 2 }],
      worldStateChanges: { crimeLevel: 2, security: -1 },
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 雇佣 ──
  hire: (d, actor, target, world, success) => {
    const wage = Number(d.parameters?.wage ?? 10);
    if (!target || actor.money < wage) {
      return { success: false, description: '雇佣失败', witnesses: getWitnesses(actor, world) };
    }
    return {
      success: true,
      description: `${actor.name}雇佣了${target.name}（日薪${wage}两）`,
      moneyChanges: [{ characterId: actor.id, amount: -wage }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 10, loyalty: 15 } },
      ],
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 举报 ──
  report_crime: (d, actor, target, world, success) => {
    if (!target) return { success: false, description: '举报目标无效', witnesses: getWitnesses(actor, world) };
    return {
      success: true,
      description: `${actor.name}举报了${target.name}的罪行`,
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { resentment: 50, fear: 20 } },
        { fromId: actor.id, toId: target.id, changes: {} },  // 举报者立场
      ],
      worldStateChanges: { security: 3, crimeLevel: -2 },
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 加入组织 ──
  join_faction: (d, actor, target, world, success) => {
    const factionId = String(d.parameters?.factionId ?? 'faction_guanfu');
    return {
      success: true,
      description: `${actor.name}加入了${world.factions.get(factionId)?.name ?? factionId}`,
      // 注意：faction 变更不在 EventResult 里，由 engine 特殊处理
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 离开组织 ──
  leave_faction: (d, actor, target, world, success) => {
    return {
      success: true,
      description: `${actor.name}退出了${world.factions.get(actor.factionId!)?.name ?? '组织'}`,
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 勒索 ──
  demand_money: (d, actor, target, world, success) => {
    return EXECUTORS.threaten(d, actor, target, world, success);
  },

  // ── 移动 ──
  move: (d, actor, target, world, success) => {
    const locationId = String(d.parameters?.locationId ?? actor.locationId);
    return {
      success: true,
      description: `${actor.name}移动到${locationId}`,
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 交谈 ──
  talk: (d, actor, target, world, success) => {
    const message = String(d.parameters?.message ?? '');
    return {
      success: true,
      description: message ? `${actor.name}对${target?.name ?? '某人'}说：${message}` : `${actor.name}想找人聊聊`,
      witnesses: getWitnesses(actor, world),
    };
  },

  // ── 发呆（回退）──
  idle: (d, actor, target, world, success) => {
    return {
      success: true,
      description: `${actor.name}原地发呆`,
      witnesses: getWitnesses(actor, world),
    };
  },
};

function getWitnesses(actor: Character, world: World): string[] {
  return Array.from(world.characters.values())
    .filter(c => c.id !== actor.id && c.locationId === actor.locationId && c.isAlive)
    .map(c => c.id);
}

function makeEvent(
  decision: ActionDecision,
  actor: Character,
  target: Character | null,
  world: World,
  success: boolean,
  result: EventResult
): GameEvent {
  return {
    id: `evt_${world.tick}_${actor.id}_${Math.random().toString(36).slice(2, 8)}`,
    tick: world.tick,
    type: decision.action,
    actorId: actor.id,
    targetId: target?.id ?? null,
    locationId: actor.locationId,
    success,
    result,
    witnesses: result.witnesses ?? [],
    knownTo: [actor.id, ...(result.witnesses ?? [])],
    description: result.description,
  };
}
```

---

## 2.6 价格计算（pricing.ts）

```typescript
import { World } from '../types';

export interface ItemPrice {
  price: number;      // 基准价
  category: 'food' | 'cloth' | 'weapon' | 'medicine' | 'metal' | 'luxury';
}

export const ITEM_PRICES: Record<string, ItemPrice> = {
  grain:    { price: 3,  category: 'food' },
  cloth:    { price: 8,  category: 'cloth' },
  herb:     { price: 6,  category: 'medicine' },
  knife:    { price: 15, category: 'weapon' },
  salt:     { price: 5,  category: 'food' },
  iron:     { price: 10, category: 'metal' },
  book:     { price: 12, category: 'luxury' },
  lockpick: { price: 20, category: 'tool' },
  seal:     { price: 100, category: 'luxury' },
  brush:    { price: 2,  category: 'tool' },
};

/** 实际价格 = 基准价 × 粮价系数（粮食价格随粮价波动） */
export function getPrice(itemId: string, world: World): number {
  const base = ITEM_PRICES[itemId]?.price ?? 10;
  if (ITEM_PRICES[itemId]?.category === 'food') {
    return Math.round(base * (world.state.grainPrice / 100));
  }
  return base;
}
```

---

## 2.7 修改 engine.ts —— 接入规则引擎

```typescript
import { World, Character, ActionDecision } from './types';
import { createInitialWorld } from './data/world';
import { execute as executeAction } from './rules';
import { DRIVE_EFFECTS, applyDriveChanges } from './drive';   // Phase 4 再启用
import { applyRelationshipChanges } from './relationship';    // Phase 6 再启用
import { knowledgeStore } from './knowledge';                  // Phase 3 再启用

export class SimulationEngine {
  world: World;
  private running = false;
  private tickCount = 0;

  constructor() {
    this.world = createInitialWorld();
  }

  async start() {
    this.running = true;
    console.log('=== 清河县模拟器启动 ===\n');
    while (this.running) {
      await this.tick();
      await this.sleep(500);
    }
  }

  stop() { this.running = false; }

  private async tick() {
    this.tickCount++;
    this.world.tick = this.tickCount;
    this.world.time = advanceTime(this.world.time);

    console.log(`--- 第 ${this.world.tick} tick | ${timeLabel(this.world.time.timeOfDay)} ---`);

    // Phase 2：用"测试决策"驱动角色（还没有 LLM）
    for (const [id, character] of this.world.characters) {
      if (character.isDetained || !character.isAlive) {
        console.log(`  [跳过] ${character.name}（被关押/死亡）`);
        continue;
      }

      // 生成一个测试决策（Phase 2 用简单规则，Phase 5 换成 LLM）
      const decision = makeTestDecision(character);
      if (!decision) continue;

      // 执行动作
      const event = executeAction(decision, character, this.world);
      this.world.events.push(event);

      // 应用状态变化
      this.applyEvent(event);

      // 打印
      const status = event.success ? '✅' : '❌';
      console.log(`  ${status} ${event.description}`);
    }
    this.printWorldState();
    console.log('');
  }

  /** 应用 Event 的所有变化（核心函数） */
  private applyEvent(event: GameEvent) {
    // 1. 金钱变化
    for (const mc of event.result.moneyChanges ?? []) {
      const c = this.world.characters.get(mc.characterId)!;
      const from = c.money;
      c.money = Math.max(0, c.money + mc.amount);
      this.world.stateDeltas.push({ entityId: mc.characterId, field: 'money', from, to: c.money, eventId: event.id, tick: this.world.tick });
    }
    // 2. 物品变化
    for (const ic of event.result.itemChanges ?? []) {
      const c = this.world.characters.get(ic.characterId)!;
      const item = c.inventory.find(i => i.itemId === ic.itemId);
      if (item) item.quantity += ic.quantity;
      else if (ic.quantity > 0) c.inventory.push({ itemId: ic.itemId, quantity: ic.quantity });
    }
    // 3. 通缉度变化
    for (const wc of event.result.wantedChanges ?? []) {
      const c = this.world.characters.get(wc.characterId)!;
      c.wantedLevel = Math.max(0, Math.min(10, c.wantedLevel + wc.delta));
    }
    // 4. 关押变化
    for (const dc of event.result.detentionChanges ?? []) {
      const c = this.world.characters.get(dc.characterId)!;
      c.isDetained = dc.detained;
    }
    // 5. 世界状态变化
    if (event.result.worldStateChanges) {
      Object.assign(this.world.state, event.result.worldStateChanges);
    }
    // 6. 关系变化（Phase 6 启用完整逻辑；Phase 2 先直接应用）
    for (const rc of event.result.relationshipChanges ?? []) {
      const from = this.world.characters.get(rc.fromId);
      const to = this.world.characters.get(rc.toId);
      if (!from || !to) continue;
      const rel = from.relationships.get(to.id) ?? { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
      for (const [k, v] of Object.entries(rc.changes)) {
        (rel as any)[k] = clampNum((rel as any)[k] + (v as number), -100, 100);
      }
      from.relationships.set(to.id, rel);
    }
  }

  private printWorldState() {
    console.log(`  [世界] 治安:${this.world.state.security} 民心:${this.world.state.publicMorale} 粮价:${this.world.state.grainPrice} 威望:${this.world.state.governmentPrestige} 犯罪:${this.world.state.crimeLevel}`);
  }

  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
}

/** Phase 2 的测试决策：简单规则驱动（Phase 5 换成 LLM） */
function makeTestDecision(c: Character): ActionDecision | null {
  // 小偷：有机会就偷
  if (c.role === '小偷') {
    const rich = [...c.relationships.keys()];
    return { action: 'steal', targetId: 'char_shangren', parameters: { amount: 20 } };
  }
  // 捕头：发现通缉犯就抓
  if (c.role === '县武装总管') {
    return { action: 'idle' };
  }
  return { action: 'idle' };
}
```

---

## 2.8 验收测试

### 验收标准 1：完整执法链

```bash
cd xiancheng-core
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { execute } from './src/rules';
const world = createInitialWorld();
const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;
const butou = world.characters.get('char_butou')!;

// 1. 三指偷商人
const stealResult = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief, world);
console.log('1. 偷窃:', stealResult.description, '| 成功:', stealResult.success);
console.log('   商人钱:', merchant.money, '小偷钱:', thief.money, '通缉:', thief.wantedLevel);

// 2. 捕头逮捕三指（如果三指被通缉）
const arrestResult = execute({ action: 'arrest', targetId: 'char_xiaotou' }, butou, world);
console.log('2. 逮捕:', arrestResult.description, '| 成功:', arrestResult.success);
console.log('   三指被关押:', thief.isDetained);

// 3. 县令释放三指
const xianling = world.characters.get('char_xianling')!;
const releaseResult = execute({ action: 'release', targetId: 'char_xiaotou' }, xianling, world);
console.log('3. 释放:', releaseResult.description, '| 成功:', releaseResult.success);
console.log('   三指被释放:', !thief.isDetained);
"
```

预期输出（注意随机性）：
```
1. 偷窃: 三指偷走了陈富贵30两银子 | 成功: true
   商人钱: 470 小偷钱: 40 通缉: 3
2. 逮捕: 张铁逮捕了三指 | 成功: true
   三指被关押: true
3. 释放: 赵文远释放了三指 | 成功: true
   三指被释放: true
```

### 验收标准 2：权限检查

```bash
# 市民尝试逮捕 → 应该被拒绝
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { execute } from './src/rules';
const world = createInitialWorld();
const citizen = world.characters.get('char_shimin_jia')!;
const thief = world.characters.get('char_xiaotou')!;
const result = execute({ action: 'arrest', targetId: 'char_xiaotou' }, citizen, world);
console.log('市民逮捕:', result.description, '| 成功:', result.success);  // 预期成功=false
"
```

### 验收标准 3：非法动作回退

```bash
# 未知动作 → 应该生成失败事件
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { execute } from './src/rules';
const world = createInitialWorld();
const thief = world.characters.get('char_xiaotou')!;
const result = execute({ action: 'fly_to_moon' }, thief, world);
console.log('非法动作:', result.description, '| 成功:', result.success);  // 预期成功=false
"
```

---

## 2.9 验收清单

- [ ] 偷窃成功 → 钱转移 + 通缉上升 + 关系恶化 + 犯罪上升
- [ ] 偷窃失败 → 通缉轻微上升 + 关系恶化 + 事件记录
- [ ] 逮捕需要权限（authorityLevel >= 5）
- [ ] 释放需要权限 + 目标在押
- [ ] 行贿成功率受金额/贪婪/正直影响
- [ ] 威胁/勒索受威慑/恐惧/勇气影响
- [ ] 买卖价格受粮价波动影响（食物类）
- [ ] 给钱 → 对方好感 + 信任上升
- [ ] 举报 → 被举报者怨恨 + 治安上升
- [ ] 所有动作都生成 GameEvent（有 actor/target/location/witnesses/description）
- [ ] 所有状态变化都有 delta 记录
- [ ] 事件里记录了目击者（同地点其他角色）

---

## 2.10 完成标志

运行 `npm start`，看到：
1. 小偷每 tick 尝试偷商人（测试决策）
2. 商人的钱在减少，小偷的钱在增加
3. 小偷的通缉度在上升
4. 治安在下降，犯罪程度在上升
5. 每次动作都有事件描述和状态变化
