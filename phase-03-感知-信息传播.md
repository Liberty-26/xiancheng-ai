# Phase 3：感知 + 信息传播

> 目标：角色不是全知的——只能感知所在位置的信息，事件有目击者，消息可以传播
>
> 预计时间：3-4 小时
>
> 前置依赖：Phase 2（规则引擎 + 事件系统）

---

## 3.1 创建的所有文件

```
src/
├── perceiver.ts       # 感知系统：角色能看到/听到/知道什么
├── knowledge.ts       # 知识存储与传播
└── engine.ts          # 修改：每 tick 调用 perceiver 收集感知，事件后调用 knowledge.spread
```

---

## 3.2 核心概念

### 信息边界

一个角色永远不能"全知"。它只能知道：

```
① 亲眼所见    —— 自己所在位置发生的事件（目击者）
② 亲身经历    —— 自己参与的事件
③ 被告知      —— 别人告诉他的事（面对面交谈）
④ 推断        —— 基于以上信息的合理推断（LLM 做）
```

角色**不知道**：
```
✗ 其他位置发生的事（除非被告知）
✗ 别人心中的想法
✗ 未公开的秘密
✗ 地图外的信息
```

### 信息传播链条

```
事件发生
  ↓
目击者（同位置的人）直接知道
  ↓
目击者遇到别人 → 可以告诉别人（通过 talk 动作 + 传播规则）
  ↓
听到的人遇到别人 → 可以再传（谣言，可信度递减）
  ↓
最终扩散到全城（或永远保守秘密）
```

---

## 3.3 knowledge.ts —— 知识存储

```typescript
import { KnowledgeStore, Fact, RumoredFact, GameEvent, CharacterId } from './types';

export class Knowledge {
  private store: KnowledgeStore;

  constructor() {
    this.store = {
      knownBy: new Map(),
      facts: new Map(),
      rumors: new Map(),
    };
  }

  getStore(): KnowledgeStore { return this.store; }

  /**
   * 记录一个事件，并让目击者知道
   */
  recordEvent(event: GameEvent): void {
    const factId = event.id;
    const fact: Fact = {
      id: factId,
      content: event.description,
      category: 'event',
      isTrue: true,           // 亲眼所见的事件一定是真的
      createdAt: event.tick,
    };

    // 存储事实
    const factsFor = this.store.facts.get(event.actorId) ?? [];
    factsFor.push(fact);
    this.store.facts.set(event.actorId, factsFor);

    // 让行为者 + 目击者知道
    const knowers = new Set([event.actorId, ...event.witnesses]);
    for (const cid of knowers) {
      this.addKnownFact(cid, factId);
    }
  }

  /**
   * A 把一条消息/事实告诉 B（面对面）
   * @returns 是否成功传播
   */
  shareFact(fromId: CharacterId, toId: CharacterId, factId: string): boolean {
    // B 必须在 A 的旁边（同位置）——由调用方保证
    const fact = this.findFact(factId);
    if (!fact) return false;

    // 机密/秘密需要检查（先简化：都能传）
    this.addKnownFact(toId, factId);

    // 记录一条"谣言"给 B（带来源）
    const rumor: RumoredFact = {
      factId,
      content: fact.content,
      credibility: fact.isTrue ? 1 : 0.3,
      sourceId: fromId,
      tick: 0,  // 由调用方设置当前 tick
    };
    const rumorsFor = this.store.rumors.get(toId) ?? [];
    rumorsFor.push(rumor);
    this.store.rumors.set(toId, rumorsFor);
    return true;
  }

  /**
   * 传播一条谣言（二道传播，可信度递减）
   */
  spreadRumor(fromId: CharacterId, toId: CharacterId, rumor: RumoredFact): void {
    const decayed: RumoredFact = {
      ...rumor,
      credibility: rumor.credibility * 0.8,   // 每传一手可信度打 8 折
      sourceId: fromId,
    };
    const rumorsFor = this.store.rumors.get(toId) ?? [];
    rumorsFor.push(decayed);
    this.store.rumors.set(toId, rumorsFor);
  }

  /** 某个角色知道哪些事实 ID */
  getKnownFactIds(characterId: string): string[] {
    return Array.from(this.store.knownBy.get(characterId) ?? []);
  }

  /** 某个角色知道哪些事实内容 */
  getKnownFacts(characterId: string): Fact[] {
    const ids = this.getKnownFactIds(characterId);
    return ids
      .map(id => this.findFact(id))
      .filter((f): f is Fact => !!f);
  }

  /** 某个角色最近听到的谣言 */
  getRumorsFor(characterId: string): RumoredFact[] {
    return this.store.rumors.get(characterId) ?? [];
  }

  /** 某条事实有多少人知道 */
  getFactSpread(factId: string): number {
    return this.store.knownBy.get(factId)?.size ?? 0;
  }

  private addKnownFact(characterId: string, factId: string): void {
    const known = this.store.knownBy.get(factId) ?? new Set();
    known.add(characterId);
    this.store.knownBy.set(factId, known);
  }

  private findFact(factId: string): Fact | null {
    for (const facts of this.store.facts.values()) {
      const f = facts.find(f => f.id === factId);
      if (f) return f;
    }
    return null;
  }
}
```

---

## 3.4 perceiver.ts —— 感知系统

```typescript
import { Character, World, Perception, GameEvent, RumoredFact } from './types';

export class Perceiver {
  constructor(private world: World) {}

  /**
   * 感知：给定一个角色，返回它"此刻能看到/听到/知道"的一切
   * 原则：只给与角色相关的信息，不给全知
   */
  perceive(character: Character): Perception {
    const locationId = character.locationId;

    // 1. 附近的人（同位置的其他活着的角色）
    const nearbyCharacterIds = Array.from(this.world.characters.values())
      .filter(c => c.id !== character.id && c.locationId === locationId && c.isAlive)
      .map(c => c.id);

    // 2. 附近的事件（同位置、最近 3 个 tick 内的事件）
    const nearbyEvents = this.world.events
      .filter(e => e.locationId === locationId && this.world.tick - e.tick <= 3)
      .slice(-5);

    // 3. 已知事实（从知识库）
    const knownFacts = this.world.knowledge.getKnownFacts(character.id)
      .map(f => f.content);

    // 4. 最近听到的谣言
    const recentRumors = this.world.knowledge.getRumorsFor(character.id)
      .slice(-5);

    return {
      locationId,
      nearbyCharacterIds,
      nearbyEvents,
      recentRumors,
      knownFacts,
    };
  }

  /**
   * 生成给 LLM 的感知描述文本（Phase 5 用）
   * 这里先提供结构化数据，Phase 5 再渲染成文字
   */
  renderPerceptionText(perception: Perception, world: World): string {
    const locationName = world.locations?.get(perception.locationId)?.name ?? perception.locationId;
    const lines: string[] = [];
    lines.push(`你现在在：${locationName}`);
    
    if (perception.nearbyCharacterIds.length > 0) {
      const names = perception.nearbyCharacterIds
        .map(id => world.characters.get(id)?.name ?? id)
        .join('、');
      lines.push(`附近有：${names}`);
    } else {
      lines.push('附近没有其他人。');
    }

    if (perception.nearbyEvents.length > 0) {
      lines.push('你最近在这里看到/听到：');
      for (const e of perception.nearbyEvents) {
        lines.push(`  - ${e.description}`);
      }
    }

    if (perception.knownFacts.length > 0) {
      lines.push('你知道的事情：');
      for (const f of perception.knownFacts.slice(-5)) {
        lines.push(`  - ${f}`);
      }
    }

    if (perception.recentRumors.length > 0) {
      lines.push('你最近听到的传言：');
      for (const r of perception.recentRumors) {
        lines.push(`  - [可信度${Math.round(r.credibility * 100)}%] ${r.content}`);
      }
    }

    return lines.join('\n');
  }
}
```

---

## 3.5 传播规则 —— 什么时候信息会传播

### 规则 1：事件发生时

```typescript
// engine.ts 中，applyEvent 之后：
knowledge.recordEvent(event);
// 这会自动让 actor + witnesses 知道
```

### 规则 2：talk 动作可以传递信息

当角色 A 对角色 B 说话时，如果 A 知道某个事实，可以选择告诉 B：

```typescript
// 在 executors.ts 的 talk 执行器里，或单独在 engine 里处理：
export function shareKnowledgeDuringTalk(
  from: Character,
  to: Character,
  world: World
): string[] {
  // A 知道的事实
  const knownFacts = world.knowledge.getKnownFacts(from.id);
  if (knownFacts.length === 0) return [];

  // 默认：告诉最近一条重要事实
  const shared = knownFacts.slice(-1);
  for (const fact of shared) {
    world.knowledge.shareFact(from.id, to.id, fact.id);
  }
  return shared.map(f => f.content);
}
```

### 规则 3：公开事件自然扩散

治安事件（偷窃/抓捕/暴乱）如果发生在人多的地点（market），会自然扩散：

```typescript
export function publicSpread(
  event: GameEvent,
  world: World,
  knowledge: Knowledge
): void {
  // 公共地点的事件 → 同位置所有人都算目击者
  const PUBLIC_LOCATIONS = ['market', 'gate', 'main_area'];
  if (!PUBLIC_LOCATIONS.includes(event.locationId)) return;

  // 扩散给所有同位置的人（已在 witnesses 里）
  // 之后这些目击者会通过 talk 继续传播
}
```

### 规则 4：谣言随机扩散

每 N 个 tick，有一定概率让一个知道消息的人把它告诉另一个随机的人：

```typescript
export function randomGossip(
  world: World,
  knowledge: Knowledge,
  gossipChance = 0.1
): void {
  if (Math.random() > gossipChance) return;

  // 随机挑一个知道某事实的人，随机告诉同位置的一个其他人
  const characters = Array.from(world.characters.values()).filter(c => c.isAlive);
  const from = characters[Math.floor(Math.random() * characters.length)];
  const knownIds = knowledge.getKnownFactIds(from.id);
  if (knownIds.length === 0) return;

  const factId = knownIds[Math.floor(Math.random() * knownIds.length)];
  const neighbors = characters.filter(c => 
    c.id !== from.id && c.locationId === from.locationId && c.isAlive
  );
  if (neighbors.length === 0) return;

  const to = neighbors[Math.floor(Math.random() * neighbors.length)];
  const rumor = {
    factId,
    content: knowledge.getKnownFacts(from.id).find(f => f.id === factId)?.content ?? '',
    credibility: 0.9,
    sourceId: from.id,
    tick: world.tick,
  };
  knowledge.spreadRumor(from.id, to.id, rumor);
  console.log(`  [八卦] ${from.name} 对 ${to.name} 说起了某件事`);
}
```

---

## 3.6 修改 engine.ts —— 接入感知与传播

```typescript
// engine.ts 关键改动：

// 1. 每 tick 开始前，收集所有角色的感知（存到 character 或单独 map）
private perceptions = new Map<string, Perception>();

private async tick() {
  // ... 时间推进 ...

  // 为每个角色收集感知
  for (const [id, character] of this.world.characters) {
    this.perceptions.set(id, this.perceiver.perceive(character));
  }

  // 角色决策（Phase 2 测试决策；Phase 5 用 LLM）
  for (const [id, character] of this.world.characters) {
    // ... 执行动作 ...
    const event = executeAction(decision, character, this.world);
    this.world.events.push(event);
    this.applyEvent(event);

    // ★ 信息传播：记录事件
    this.knowledge.recordEvent(event);

    // ★ 如果有目标角色在场，且是 talk，传播知识
    if (decision.action === 'talk' && decision.targetId) {
      const target = this.world.characters.get(decision.targetId)!;
      const shared = shareKnowledgeDuringTalk(character, target, this.world);
      if (shared.length > 0) {
        console.log(`  [消息] ${character.name} 告诉 ${target.name}：${shared.join('、')}`);
      }
    }
  }

  // ★ 随机八卦扩散
  randomGossip(this.world, this.knowledge);

  this.printWorldState();
  this.printKnowledgeStats();
}

private printKnowledgeStats() {
  const totalFacts = this.world.knowledge.getStore().knownBy.size;
  const totalKnowers = this.world.knowledge.getStore().knownBy
    .values().reduce((sum, s) => sum + s.size, 0);
  console.log(`  [信息] ${totalFacts} 条事实，${totalKnowers} 次"知道"记录`);
}
```

---

## 3.7 验收测试

### 验收标准 1：信息边界

```bash
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { Knowledge } from './src/knowledge';
import { Perceiver } from './src/perceiver';
import { execute } from './src/rules';

const world = createInitialWorld();
const knowledge = new Knowledge();
world.knowledge = knowledge.getStore();
const perceiver = new Perceiver(world);

const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;
const xianling = world.characters.get('char_xianling')!;

// 三指在 hideout 偷东西（只有三指自己）
thief.locationId = 'hideout';
merchant.locationId = 'shop';
xianling.locationId = 'yamen';

const event = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief, world);
world.events.push(event);
knowledge.recordEvent(event);

// 三指知道
const thiefPerception = perceiver.perceive(thief);
console.log('三指知道事实:', thiefPerception.knownFacts.length > 0);  // true
// 商人不知道（不同位置，不是目击者）
const merchantPerception = perceiver.perceive(merchant);
console.log('商人知道事实:', merchantPerception.knownFacts.length > 0);  // false
// 县令不知道
const xianlingPerception = perceiver.perceive(xianling);
console.log('县令知道事实:', xianlingPerception.knownFacts.length > 0);  // false

// 三指告诉商人
merchant.locationId = 'hideout';  // 商人来到三指旁边
knowledge.shareFact('char_xiaotou', 'char_shangren', event.id);
console.log('商人现在知道:', perceiver.perceive(merchant).knownFacts.length > 0);  // true

// 商人再告诉县令
xianling.locationId = 'hideout';
const rumor = knowledge.getRumorsFor('char_shangren').slice(-1)[0];
knowledge.spreadRumor('char_shangren', 'char_xianling', rumor);
const xianlingPerception2 = perceiver.perceive(xianling);
console.log('县令听到传言:', xianlingPerception2.recentRumors.length > 0);  // true
console.log('传言可信度:', xianlingPerception2.recentRumors[0]?.credibility);  // 0.8（打8折）
"
```

预期输出：
```
三指知道事实: true
商人知道事实: false
县令知道事实: false
商人现在知道: true
县令听到传言: true
传言可信度: 0.8
```

### 验收标准 2：谣言递减

```typescript
// 同一谣言传 3 手，可信度从 1 → 0.8 → 0.64 → 0.512
```

### 验收标准 3：感知只显示附近信息

```typescript
// 角色在 yamen，只显示 yamen 的人和事
// 不会显示 market 发生的事件
```

---

## 3.8 验收清单

- [ ] 事件发生时，行为者 + 目击者（同位置）自动知道
- [ ] 不同位置的角色不知道其他位置发生的事
- [ ] talk 动作可以传递已知信息
- [ ] 谣言传播时可信度递减（每手 ×0.8）
- [ ] 随机八卦：每 tick 有概率让消息扩散
- [ ] 感知函数只返回：位置/附近的人/附近事件/已知事实/谣言
- [ ] 知识库可以查询：谁知道了什么、某事实多少人知道

---

## 3.9 完成标志

运行 `npm start`，看到：
1. 三指在仓库偷粮后，只有仓库附近的人知道
2. 通过 talk，消息从一个人传到另一个人
3. 八卦系统让消息偶尔自然扩散
4. 知识统计显示事实数量和"知道"次数在增长
