# Phase 1：骨架 + 数据模型

> 目标：建立一个能跑起来的 tick 循环，所有类型定义完整，能打印"第 X tick：7 个角色当前状态"
> 
> 预计时间：2-3 小时
> 
> 技术栈：TypeScript + tsx（直接运行，不需编译）

---

## 1.1 项目初始化

```bash
cd /Users/libaodian/Desktop/小县城
mkdir -p xiancheng-core/src/data
cd xiancheng-core
npm init -y
npm install typescript tsx @types/node --save-dev
```

`tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`package.json` 的 scripts：
```json
{
  "scripts": {
    "start": "tsx src/index.ts"
  }
}
```

---

## 1.2 创建的所有文件

```
src/
├── index.ts              # 入口
├── types.ts              # 所有类型定义（~200 行）
└── data/
    ├── characters.ts     # 7 个角色的初始数据
    └── world.ts          # 初始世界状态
```

---

## 1.3 types.ts 完整内容

### 1.3.1 基础枚举

```typescript
// --- 位置 ID ---
export type LocationId = 
  | 'yamen' | 'market' | 'shop' | 'warehouse' 
  | 'houses' | 'hideout' | 'gate' | 'main_area';

// --- 组织 ID ---
export type FactionId = 'faction_guanfu' | 'faction_shanghui' | 'faction_heimu';

// --- 角色 ID ---
export type CharacterId = string;  // 运行时 id，如 'char_xianling'

// --- 动作枚举（MVP 15 个）---
export type ActionType = 
  | 'move' | 'talk' | 'give_money' | 'steal' | 'buy' | 'sell'
  | 'arrest' | 'release' | 'bribe' | 'threaten' | 'hire'
  | 'report_crime' | 'join_faction' | 'leave_faction' | 'demand_money'
  | 'idle';  // 回退动作

// --- 时间段 ---
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

// --- 目标状态 ---
export type GoalStatus = 'active' | 'completed' | 'abandoned' | 'failed';

// --- 社会身份 ---
export type SocialStatus = 'official' | 'merchant' | 'civilian' | 'criminal' | 'outsider';
```

### 1.3.2 角色类型

```typescript
export interface Character {
  // ── 身份（不变）──
  id: string;
  name: string;
  role: string;              // 县令/捕头/商人/市民/小偷/旅人
  factionId: FactionId | null;
  socialStatus: SocialStatus;
  authorityLevel: number;    // 0-10，县令=10，捕头=7，平民=0
  wantedLevel: number;       // 0-10，通缉度
  
  // ── 位置 ──
  locationId: LocationId;
  isDetained: boolean;       // 是否被关押
  isAlive: boolean;

  // ── 财产 ──
  money: number;
  inventory: InventoryItem[];

  // ── 驱动力（0-1，越高越渴望）──
  drives: Drives;

  // ── 人格（固定权重，决定 Drive 变化敏感度）──
  personality: Personality;

  // ── 关系 ──
  relationships: Map<CharacterId, Relationship>;

  // ── 目标 ──
  currentGoal: Goal | null;

  // ── 能力 ──
  skills: Skills;

  // ── 声望（不同群体视角）──
  reputation: Reputation;
}

export interface InventoryItem {
  itemId: string;
  quantity: number;
}

export interface Drives {
  safety: number;      // 安全
  wealth: number;      // 财富
  power: number;       // 权力
  belonging: number;   // 归属
  revenge: number;     // 复仇
}

export interface Personality {
  greed: number;          // 贪婪 0-1
  riskTolerance: number;  // 风险偏好 0-1
  aggression: number;     // 攻击性 0-1
  empathy: number;        // 同理心 0-1
  loyalty: number;        // 忠诚 0-1
  honesty: number;        // 诚实 0-1
  ambition: number;       // 野心 0-1
  obedience: number;      // 服从权威 0-1
}

export interface Relationship {
  trust: number;       // -100 ~ 100
  affinity: number;    // -100 ~ 100
  fear: number;        // 0 ~ 100
  respect: number;     // 0 ~ 100
  loyalty: number;     // 0 ~ 100
  resentment: number;  // 0 ~ 100
}

export interface Skills {
  combat: number;         // 战斗
  speech: number;         // 口才
  stealth: number;        // 偷窃/潜行
  investigation: number;  // 调查
  leadership: number;     // 领导
  intimidation: number;   // 威慑
}

export interface Reputation {
  official: number;    // -100 ~ 100
  civilian: number;
  criminal: number;
  merchant: number;
}
```

### 1.3.3 目标类型

```typescript
export interface Goal {
  id: string;
  characterId: string;
  description: string;        // LLM 生成的描述
  
  // 成功条件（规则引擎可检查）
  condition: GoalCondition;
  
  priority: number;           // 0~1
  status: GoalStatus;
  progress: number;           // 0~1
  createdAt: number;          // tick
  source: 'drive' | 'event' | 'player' | 'llm';
  strategy?: string;          // LLM 生成策略提示
}

export type GoalCondition = 
  | { type: 'money_ge'; value: number }
  | { type: 'item_has'; itemId: string; quantity: number }
  | { type: 'relationship_le'; targetId: string; field: keyof Relationship; value: number }
  | { type: 'location_at'; locationId: LocationId }
  | { type: 'faction_joined'; factionId: FactionId }
  | { type: 'wanted_le'; value: number }
  | { type: 'custom'; description: string; check: string }; // check 是函数名，规则引擎执行
```

### 1.3.4 事件类型

```typescript
export interface GameEvent {
  id: string;
  tick: number;
  type: ActionType;
  
  actorId: string;
  targetId: string | null;
  locationId: LocationId;
  
  success: boolean;
  
  // 结果（规则引擎判定）
  result: EventResult;
  
  // 信息传播
  witnesses: string[];       // 直接目击者 ID
  knownTo: string[];         // 当前知道此事的人
  
  // 叙事
  description: string;
  narrative?: string;
}

export interface EventResult {
  moneyChanges?: { characterId: string; amount: number }[];
  itemChanges?: { characterId: string; itemId: string; quantity: number }[];
  driveChanges?: { characterId: string; changes: Partial<Drives> }[];
  relationshipChanges?: { 
    fromId: string; 
    toId: string; 
    changes: Partial<Relationship> 
  }[];
  worldStateChanges?: Partial<WorldState>;
  wantedChanges?: { characterId: string; delta: number }[];
  detentionChanges?: { characterId: string; detained: boolean }[];
}
```

### 1.3.5 世界状态

```typescript
export interface WorldState {
  security: number;           // 治安 0-100
  publicMorale: number;       // 民心 0-100
  grainPrice: number;         // 粮价（基准 100）
  governmentPrestige: number; // 官府威望 0-100
  crimeLevel: number;         // 犯罪程度 0-100
  grainReserve: number;       // 官仓粮食储备
}

export interface FactionState {
  id: FactionId;
  name: string;
  members: string[];
  wealth: number;
  territory: LocationId[];
  prestige: number;
  goal: string;
}

export interface Time {
  day: number;
  timeOfDay: TimeOfDay;
  tick: number;     // 当前 tick 编号
}
```

### 1.3.6 决策类型

```typescript
export interface ActionDecision {
  action: ActionType;
  targetId?: string;
  parameters?: Record<string, unknown>;
  reason?: string;
  innerMonologue?: string;
}

export interface Perception {
  locationId: LocationId;
  nearbyCharacterIds: string[];
  nearbyEvents: GameEvent[];
  recentRumors: RumoredFact[];
  knownFacts: string[];  // 事实 ID 列表
}

export interface RumoredFact {
  factId: string;
  content: string;
  credibility: number;  // 0-1
  sourceId: string;
  tick: number;
}
```

### 1.3.7 记忆类型

```typescript
export interface Memory {
  id: string;
  characterId: string;
  tick: number;
  text: string;
  type: 'event' | 'relationship' | 'promise' | 'emotion' | 'info' | 'strategy';
  importance: number;     // 0-1
  credibility: number;    // 0-1
  relatedCharacterIds: string[];
  tags: string[];
}
```

### 1.3.8 容器类型（World）

```typescript
export interface World {
  tick: number;
  time: Time;
  characters: Map<CharacterId, Character>;
  state: WorldState;
  factions: Map<FactionId, FactionState>;
  events: GameEvent[];
  stateDeltas: StateDelta[];
  knowledge: KnowledgeStore;
}

export interface StateDelta {
  entityId: string;
  field: string;
  from: number;
  to: number;
  eventId: string;
  tick: number;
}

export interface KnowledgeStore {
  // factId → 知道的人
  knownBy: Map<string, Set<string>>;
  // characterId → 他们知道的日程事实
  facts: Map<string, Fact[]>;
  // characterId → 他们听到的谣言
  rumors: Map<string, RumoredFact[]>;
}

export interface Fact {
  id: string;
  content: string;
  category: 'event' | 'relationship' | 'info' | 'secret';
  isTrue: boolean;
  createdAt: number;
}
```

---

## 1.4 data/characters.ts —— 7 个角色初始数据

```typescript
import { Character, LocationId, FactionId, Drives, Personality, Skills } from '../types';

// 辅助函数：创建关系
function rel(trust = 0, affinity = 0, fear = 0, respect = 0, loyalty = 0, resentment = 0) {
  return { trust, affinity, fear, respect, loyalty, resentment };
}

export const INITIAL_CHARACTERS: Character[] = [
  {
    id: 'char_xianling',
    name: '赵文远',
    role: '县令',
    factionId: 'faction_guanfu',
    socialStatus: 'official',
    authorityLevel: 10,
    wantedLevel: 0,
    locationId: 'yamen',
    isDetained: false,
    isAlive: true,
    money: 200,
    inventory: [{ itemId: 'seal', quantity: 1 }, { itemId: 'brush', quantity: 1 }],
    drives: { safety: 0.6, wealth: 0.5, power: 0.9, belonging: 0.5, revenge: 0.1 },
    personality: { greed: 0.4, riskTolerance: 0.3, aggression: 0.2, empathy: 0.6, loyalty: 0.8, honesty: 0.7, ambition: 0.6, obedience: 0.9 },
    relationships: new Map([
      ['char_butou', rel(80, 70, 20, 85, 90, 0)],
      ['char_shangren', rel(40, 30, 0, 30, 10, 0)],
      ['char_xiaotou', rel(-50, -60, 10, 0, 0, 20)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_jia', rel(20, 10, 0, 20, 0, 0)],
      ['char_shimin_yi', rel(20, 15, 0, 25, 0, 0)],
    ]),
    currentGoal: { id: 'g1', characterId: 'char_xianling', description: '维持县城的稳定', condition: { type: 'custom', description: '治安 > 60', check: 'security_gt_60' }, priority: 0.9, status: 'active', progress: 0.6, createdAt: 0, source: 'drive' },
    skills: { combat: 3, speech: 7, stealth: 2, investigation: 6, leadership: 8, intimidation: 6 },
    reputation: { official: 50, civilian: 60, criminal: -20, merchant: 40 },
  },
  {
    id: 'char_butou',
    name: '张铁',
    role: '县武装总管',
    factionId: 'faction_guanfu',
    socialStatus: 'official',
    authorityLevel: 7,
    wantedLevel: 0,
    locationId: 'yamen',
    isDetained: false,
    isAlive: true,
    money: 150,
    inventory: [{ itemId: 'knife', quantity: 1 }],
    drives: { safety: 0.7, wealth: 0.6, power: 0.7, belonging: 0.6, revenge: 0.2 },
    personality: { greed: 0.5, riskTolerance: 0.5, aggression: 0.6, empathy: 0.4, loyalty: 0.8, honesty: 0.5, ambition: 0.5, obedience: 0.7 },
    relationships: new Map([
      ['char_xianling', rel(100, 100, 100, 100, 100, 0)],
      ['char_shangren', rel(100, 100, 0, 100, 0, 0)],
      ['char_xiaotou', rel(-100, -100, 0, 0, 0, 0)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_jia', rel(30, 20, 0, 30, 0, 0)],
      ['char_shimin_yi', rel(25, 20, 0, 25, 0, 0)],
    ]),
    currentGoal: { id: 'g2', characterId: 'char_butou', description: '维持县城的治安', condition: { type: 'custom', description: '犯罪程度 < 30', check: 'crime_lt_30' }, priority: 0.8, status: 'active', progress: 0.5, createdAt: 0, source: 'drive' },
    skills: { combat: 9, speech: 4, stealth: 4, investigation: 6, leadership: 6, intimidation: 8 },
    reputation: { official: 60, civilian: 50, criminal: -40, merchant: 30 },
  },
  {
    id: 'char_shangren',
    name: '陈富贵',
    role: '商人',
    factionId: null,
    socialStatus: 'merchant',
    authorityLevel: 0,
    wantedLevel: 0,
    locationId: 'shop',
    isDetained: false,
    isAlive: true,
    money: 500,
    inventory: [{ itemId: 'cloth', quantity: 10 }, { itemId: 'grain', quantity: 20 }],
    drives: { safety: 0.6, wealth: 0.9, power: 0.3, belonging: 0.5, revenge: 0.1 },
    personality: { greed: 0.8, riskTolerance: 0.4, aggression: 0.2, empathy: 0.5, loyalty: 0.3, honesty: 0.4, ambition: 0.7, obedience: 0.5 },
    relationships: new Map([
      ['char_xianling', rel(50, 40, 20, 50, 20, 0)],
      ['char_butou', rel(30, 20, 50, 30, 10, 0)],
      ['char_xiaotou', rel(-60, -50, 60, 0, 0, 30)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_jia', rel(20, 20, 0, 10, 0, 0)],
      ['char_shimin_yi', rel(20, 15, 0, 20, 0, 0)],
    ]),
    currentGoal: { id: 'g3', characterId: 'char_shangren', description: '赚更多钱', condition: { type: 'money_ge', value: 800 }, priority: 0.9, status: 'active', progress: 0.5, createdAt: 0, source: 'drive' },
    skills: { combat: 2, speech: 7, stealth: 2, investigation: 5, leadership: 4, intimidation: 3 },
    reputation: { official: 30, civilian: 40, criminal: 10, merchant: 60 },
  },
  {
    id: 'char_shimin_jia',
    name: '李老实',
    role: '市民',
    factionId: null,
    socialStatus: 'civilian',
    authorityLevel: 0,
    wantedLevel: 0,
    locationId: 'market',
    isDetained: false,
    isAlive: true,
    money: 30,
    inventory: [],
    drives: { safety: 0.7, wealth: 0.7, power: 0.1, belonging: 0.6, revenge: 0.1 },
    personality: { greed: 0.3, riskTolerance: 0.2, aggression: 0.1, empathy: 0.7, loyalty: 0.5, honesty: 0.8, ambition: 0.2, obedience: 0.8 },
    relationships: new Map([
      ['char_xianling', rel(40, 30, 30, 50, 30, 0)],
      ['char_butou', rel(30, 20, 40, 40, 20, 0)],
      ['char_shangren', rel(20, 15, 10, 20, 0, 0)],
      ['char_xiaotou', rel(-20, -30, 50, 0, 0, 10)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_yi', rel(30, 30, 0, 20, 0, 0)],
    ]),
    currentGoal: { id: 'g4', characterId: 'char_shimin_jia', description: '养家糊口', condition: { type: 'money_ge', value: 50 }, priority: 0.8, status: 'active', progress: 0.3, createdAt: 0, source: 'drive' },
    skills: { combat: 2, speech: 3, stealth: 2, investigation: 2, leadership: 1, intimidation: 1 },
    reputation: { official: 10, civilian: 20, criminal: 0, merchant: 5 },
  },
  {
    id: 'char_shimin_yi',
    name: '王秀才',
    role: '市民',
    factionId: null,
    socialStatus: 'civilian',
    authorityLevel: 0,
    wantedLevel: 0,
    locationId: 'houses',
    isDetained: false,
    isAlive: true,
    money: 20,
    inventory: [{ itemId: 'book', quantity: 1 }],
    drives: { safety: 0.5, wealth: 0.5, power: 0.2, belonging: 0.6, revenge: 0.2 },
    personality: { greed: 0.2, riskTolerance: 0.3, aggression: 0.2, empathy: 0.6, loyalty: 0.4, honesty: 0.7, ambition: 0.3, obedience: 0.4 },
    relationships: new Map([
      ['char_xianling', rel(30, 20, 20, 40, 20, 0)],
      ['char_butou', rel(20, 15, 30, 30, 15, 0)],
      ['char_shangren', rel(10, 10, 0, 15, 0, 0)],
      ['char_xiaotou', rel(-30, -40, 40, 0, 0, 20)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_jia', rel(30, 30, 0, 15, 0, 0)],
    ]),
    currentGoal: { id: 'g5', characterId: 'char_shimin_yi', description: '教好书，过安稳日子', condition: { type: 'money_ge', value: 40 }, priority: 0.6, status: 'active', progress: 0.4, createdAt: 0, source: 'drive' },
    skills: { combat: 1, speech: 6, stealth: 1, investigation: 5, leadership: 2, intimidation: 2 },
    reputation: { official: 20, civilian: 30, criminal: 0, merchant: 10 },
  },
  {
    id: 'char_xiaotou',
    name: '三指',
    role: '小偷',
    factionId: null,
    socialStatus: 'criminal',
    authorityLevel: 0,
    wantedLevel: 0,
    locationId: 'hideout',
    isDetained: false,
    isAlive: true,
    money: 10,
    inventory: [{ itemId: 'lockpick', quantity: 1 }],
    drives: { safety: 0.5, wealth: 0.8, power: 0.5, belonging: 0.3, revenge: 0.3 },
    personality: { greed: 0.7, riskTolerance: 0.8, aggression: 0.5, empathy: 0.2, loyalty: 0.2, honesty: 0.1, ambition: 0.6, obedience: 0.1 },
    relationships: new Map([
      ['char_xianling', rel(-60, -50, 40, 0, 0, 30)],
      ['char_butou', rel(-80, -70, 60, 0, 0, 40)],
      ['char_shangren', rel(-40, -30, 20, 0, 0, 20)],
      ['char_player', rel(0, 0, 0, 0, 0, 0)],
      ['char_shimin_jia', rel(-10, -10, 20, 0, 0, 5)],
      ['char_shimin_yi', rel(-10, -10, 20, 0, 0, 5)],
    ]),
    currentGoal: { id: 'g6', characterId: 'char_xiaotou', description: '搞钱', condition: { type: 'money_ge', value: 100 }, priority: 0.9, status: 'active', progress: 0.1, createdAt: 0, source: 'drive' },
    skills: { combat: 5, speech: 3, stealth: 8, investigation: 4, leadership: 3, intimidation: 4 },
    reputation: { official: -50, civilian: -30, criminal: 40, merchant: -40 },
  },
  {
    id: 'char_player',
    name: '玩家',
    role: '旅人',
    factionId: null,
    socialStatus: 'outsider',
    authorityLevel: 0,
    wantedLevel: 0,
    locationId: 'gate',
    isDetained: false,
    isAlive: true,
    money: 50,
    inventory: [],
    drives: { safety: 0.5, wealth: 0.5, power: 0.3, belonging: 0.4, revenge: 0.1 },
    personality: { greed: 0.5, riskTolerance: 0.5, aggression: 0.5, empathy: 0.5, loyalty: 0.5, honesty: 0.5, ambition: 0.5, obedience: 0.5 },
    relationships: new Map(),
    currentGoal: null,
    skills: { combat: 4, speech: 5, stealth: 4, investigation: 5, leadership: 4, intimidation: 4 },
    reputation: { official: 0, civilian: 0, criminal: 0, merchant: 0 },
  },
];

export const CHARACTER_ORDER = [
  'char_xianling', 'char_butou', 'char_shangren',
  'char_shimin_jia', 'char_shimin_yi', 'char_xiaotou', 'char_player'
];
```

### 1.4 data/world.ts —— 初始世界状态

```typescript
import { World, WorldState, FactionState, KnowledgeStore, Time } from '../types';

export const INITIAL_WORLD_STATE: WorldState = {
  security: 65,
  publicMorale: 60,
  grainPrice: 100,    // 基准价
  governmentPrestige: 55,
  crimeLevel: 20,
  grainReserve: 500,
};

export const INITIAL_FACTIONS: Map<string, FactionState> = new Map([
  ['faction_guanfu', { id: 'faction_guanfu', name: '官府', members: ['char_xianling', 'char_butou'], wealth: 1000, territory: ['yamen'], prestige: 60, goal: '维持统治' }],
  ['faction_shanghui', { id: 'faction_shanghui', name: '商行', members: [], wealth: 500, territory: ['shop'], prestige: 30, goal: '促进商业' }],
  ['faction_heimu', { id: 'faction_heimu', name: '黑手帮', members: [], wealth: 100, territory: ['hideout'], prestige: 10, goal: '扩张地下势力' }],
]);

export const INITIAL_KNOWLEDGE: KnowledgeStore = {
  knownBy: new Map(),
  facts: new Map(),
  rumors: new Map(),
};

export function createInitialWorld(): World {
  return {
    tick: 0,
    time: { day: 1, timeOfDay: 'morning', tick: 0 },
    characters: new Map(CHARACTER_ORDER.map(id => [id, structuredClone(INITIAL_CHARACTERS.find(c => c.id === id)!)] )),
    state: { ...INITIAL_WORLD_STATE },
    factions: new Map(INITIAL_FACTIONS),
    events: [],
    stateDeltas: [],
    knowledge: { knownBy: new Map(), facts: new Map(), rumors: new Map() },
  };
}
```

---

## 1.5 engine.ts —— 骨架 tick 循环

```typescript
import { World, Character, GameEvent } from './types';
import { createInitialWorld } from './data/world';

export class SimulationEngine {
  world: World;
  private running = false;

  constructor() {
    this.world = createInitialWorld();
  }

  async start() {
    this.running = true;
    console.log('=== 清河县模拟器启动 ===\n');
    while (this.running) {
      await this.tick();
      await this.sleep(500); // 每 tick 暂停 500ms 方便观察
    }
  }

  stop() {
    this.running = false;
  }

  private async tick() {
    this.world.tick += 1;
    this.world.time = advanceTime(this.world.time);

    console.log(`--- 第 ${this.world.tick} tick | 第 ${this.world.time.day} 天 ${timeLabel(this.world.time.timeOfDay)} ---`);

    // 遍历每个角色
    for (const [id, character] of this.world.characters) {
      if (character.isDetained || !character.isAlive) {
        console.log(`  [跳过] ${character.name}（${character.isDetained ? '被关押' : '已死亡'}）`);
        continue;
      }
      
      // Phase 1：只打印角色状态，不做决策
      console.log(formatCharacterStatus(character));
    }
    console.log('');
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function advanceTime(time: { day: number; timeOfDay: string; tick: number }): { day: number; timeOfDay: string; tick: number } {
  const sequence = ['morning', 'afternoon', 'evening', 'night'];
  const idx = sequence.indexOf(time.timeOfDay);
  if (idx < 3) {
    return { ...time, timeOfDay: sequence[idx + 1] };
  } else {
    return { day: time.day + 1, timeOfDay: 'morning', tick: time.tick };
  }
}

function timeLabel(t: string): string {
  const map: Record<string, string> = {
    morning: '早晨 08:00',
    afternoon: '下午 14:00',
    evening: '傍晚 20:00',
    night: '深夜 02:00',
  };
  return map[t] || t;
}

function formatCharacterStatus(c: Character): string {
  const goalStr = c.currentGoal ? `目标: ${c.currentGoal.description.slice(0, 20)}` : '无目标';
  return `  ${c.name}(${c.role}) | 位置: ${c.locationId} | 银两: ${c.money} | 通缉: ${c.wantedLevel} | ${goalStr}`;
}
```

---

## 1.6 index.ts —— 入口

```typescript
import { SimulationEngine } from './engine';

const engine = new SimulationEngine();

// 按下 Ctrl+C 停止
process.on('SIGINT', () => {
  console.log('\n模拟停止');
  engine.stop();
  process.exit(0);
});

engine.start().catch(err => {
  console.error('模拟出错:', err);
  process.exit(1);
});
```

---

## 1.7 验收与测试

### 验收标准

```bash
cd xiancheng-core
npm start
```

预期输出：
```
=== 清河县模拟器启动 ===

--- 第 1 tick | 第 1 天 早晨 08:00 ---
  赵文远(县令) | 位置: yamen | 银两: 200 | 通缉: 0 | 目标: 维持县城的稳定
  张铁(捕头) | 位置: yamen | 银两: 150 | 通缉: 0 | 目标: 维持县城的治安
  陈富贵(商人) | 位置: shop | 银两: 500 | 通缉: 0 | 目标: 赚更多钱
  李老实(市民) | 位置: market | 银两: 30 | 通缉: 0 | 目标: 养家糊口
  王秀才(市民) | 位置: houses | 银两: 20 | 通缉: 0 | 目标: 教好书
  三指(小偷) | 位置: hideout | 银两: 10 | 通缉: 0 | 目标: 搞钱
  玩家(旅人) | 位置: gate | 银两: 50 | 通缉: 0 | 无目标

--- 第 2 tick | 第 1 天 下午 14:00 ---
  ...
```

### 手动验证

1. 运行 `npm start`，看到 7 个角色状态打印
2. 时间按 morning → afternoon → evening → night → 下一天 循环
3. 被关押的角色显示"跳过"
4. Ctrl+C 正常退出

### 测试脚本（可选）

```typescript
// 验证角色数据完整性
function validateCharacters() {
  for (const c of INITIAL_CHARACTERS) {
    assert(c.drives.safety >= 0 && c.drives.safety <= 1);
    assert(c.drives.wealth >= 0 && c.drives.wealth <= 1);
    assert(c.personality.greed >= 0 && c.personality.greed <= 1);
    assert(c.money >= 0);
    assert(c.authorityLevel >= 0 && c.authorityLevel <= 10);
    // ... 更多断言
    console.log(`✅ ${c.name} 数据完整`);
  }
}
```

---

## 1.8 可执行步骤

```bash
# 1. 创建项目目录
mkdir -p /Users/libaodian/Desktop/小县城/xiancheng-core/src/data

# 2. 创建 package.json
cd /Users/libaodian/Desktop/小县城/xiancheng-core
npm init -y
npm install typescript tsx @types/node --save-dev

# 3. 创建 tsconfig.json（内容如上）

# 4. 创建 src/types.ts（内容如上）

# 5. 创建 src/data/characters.ts（内容如上）

# 6. 创建 src/data/world.ts（内容如上）

# 7. 创建 src/engine.ts（内容如上）

# 8. 创建 src/index.ts（内容如上）

# 9. 运行
npx tsx src/index.ts
```

**完成标志**：终端每 500ms 打印一次 7 个角色的状态，时间正常流转。