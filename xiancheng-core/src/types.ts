// ============================================================
// 清河县 · AI 社会模拟器 — 核心类型定义
// Phase 1：骨架 + 数据模型
// ============================================================

// --- 位置 ID ---
export type LocationId =
  | 'yamen' | 'market' | 'shop' | 'warehouse'
  | 'houses' | 'hideout' | 'gate' | 'main_area';

// --- 组织 ID ---
export type FactionId = 'faction_guanfu' | 'faction_shanghui' | 'faction_heimu';

// --- 角色 ID ---
export type CharacterId = string;

// --- 动作枚举（MVP 15 个）---
export type ActionType =
  | 'move' | 'talk' | 'give_money' | 'steal' | 'buy' | 'sell'
  | 'arrest' | 'release' | 'bribe' | 'threaten' | 'hire'
  | 'report_crime' | 'join_faction' | 'leave_faction' | 'demand_money'
  | 'idle';

// --- 时间段 ---
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

// --- 目标状态 ---
export type GoalStatus = 'active' | 'completed' | 'abandoned' | 'failed';

// --- 社会身份 ---
export type SocialStatus = 'official' | 'merchant' | 'civilian' | 'criminal' | 'outsider';

// ============================================================
// 角色
// ============================================================

export interface Character {
  // ── 身份（不变）──
  id: string;
  name: string;
  role: string;               // 县令/捕头/商人/市民/小偷/旅人
  factionId: FactionId | null;
  socialStatus: SocialStatus;
  authorityLevel: number;     // 0-10，县令=10，捕头=7，平民=0
  wantedLevel: number;        // 0-10，通缉度

  // ── 位置 ──
  locationId: LocationId;
  isDetained: boolean;        // 是否被关押
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

// ============================================================
// 目标
// ============================================================

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
  | { type: 'custom'; description: string; check: string };

// ============================================================
// 事件
// ============================================================

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
  /** 结果的一句话描述（用于生成 GameEvent.description） */
  description?: string;
  /** 显式失败标志：执行器守卫（钱不够/库存不足/无权限等）返回 false 时覆盖随机成功率 */
  success?: boolean;
  moneyChanges?: { characterId: string; amount: number }[];
  itemChanges?: { characterId: string; itemId: string; quantity: number }[];
  driveChanges?: { characterId: string; changes: Partial<Drives> }[];
  relationshipChanges?: {
    fromId: string;
    toId: string;
    changes: Partial<Relationship>;
  }[];
  worldStateChanges?: Partial<WorldState>;
  wantedChanges?: { characterId: string; delta: number }[];
  detentionChanges?: { characterId: string; detained: boolean }[];
  factionChanges?: { characterId: string; factionId: FactionId | null }[];
  locationChanges?: { characterId: string; locationId: LocationId }[];
}

// ============================================================
// 世界状态
// ============================================================

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

// ============================================================
// 决策与感知
// ============================================================

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

// ============================================================
// 记忆
// ============================================================

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

// ============================================================
// 世界容器
// ============================================================

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
