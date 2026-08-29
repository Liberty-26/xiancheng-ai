// ============================================================
// 清河县 · 核心类型定义（v2：状态驱动架构）
// ============================================================

// --- 基础枚举 ---
export type LocationId = 'yamen' | 'market' | 'shop' | 'warehouse' | 'houses' | 'hideout' | 'gate' | 'main_area';
export type FactionId = 'faction_guanfu' | 'faction_shanghui' | 'faction_heimu';
export type CharacterId = string;
export type ActionType =
  | 'move' | 'talk' | 'give_money' | 'steal' | 'buy' | 'sell'
  | 'arrest' | 'release' | 'bribe' | 'threaten' | 'hire'
  | 'report_crime' | 'join_faction' | 'leave_faction' | 'demand_money'
  | 'wait'  // ★ 新增等待
  | 'idle';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type GoalStatus = 'active' | 'completed' | 'abandoned' | 'failed';
export type SocialStatus = 'official' | 'merchant' | 'civilian' | 'criminal' | 'outsider';

// ═══════════════════════════════════════════════════════════════
// 一、状态（State）—— LLM 输出
// ═══════════════════════════════════════════════════════════════

export interface NpcState {
  id: string;
  characterId: string;
  goal: string;                    // 自然语言目标
  plan: PlanStep[];                // 行动规划
  successCondition: Condition;     // 成功条件
  failureCondition?: Condition;    // 失败条件
  currentStepIndex: number;        // 当前在规划中的索引
  source: 'initial' | 'reflection' | 'reaction';
  createdAt: number;
}

export interface PlanStep {
  action: ActionType;
  targetId?: string;
  parameters?: Record<string, unknown>;
  duration: number;  // 预计耗时（分钟）
}

export type Condition =
  | { type: 'money_ge'; value: number }
  | { type: 'item_has'; itemId: string; quantity: number }
  | { type: 'relationship_le'; targetId: string; field: string; value: number }
  | { type: 'location_at'; locationId: string }
  | { type: 'talk_success'; targetId: string }
  | { type: 'talk_refused'; targetId: string; times: number }
  | { type: 'time_elapsed'; minutes: number }
  | { type: 'custom'; check: string };

// ═══════════════════════════════════════════════════════════════
// 二、世界时钟（分钟制，流动时间）
// ═══════════════════════════════════════════════════════════════

export interface WorldClock {
  now: number;                     // 当前世界时间（分钟）
  scheduled: ScheduledAction[];    // 已调度的事件队列
}

export interface ScheduledAction {
  characterId: string;
  step: PlanStep;
  finishAt: number;                // 完成时刻
}

// ═══════════════════════════════════════════════════════════════
// 三、地图
// ═══════════════════════════════════════════════════════════════

export interface MapLocation {
  id: string;
  name: string;
  type: 'building' | 'outdoor' | 'road';
  connections: string[];
  /** 地图坐标（网格单位，用于计算移动耗时） */
  x: number;
  y: number;
}

/** 所有 NPC 统一的移动速度（格/分钟）—— 后续可改为按体能个性化 */
export const WALK_SPEED = 2;

/** 计算两个地点的移动耗时（分钟）= 曼哈顿距离 / 速度 */
export function travelTime(fromId: string, toId: string, map: MapLocation[] = MAP_LOCATIONS): number {
  if (fromId === toId) return 0;
  const from = map.find(l => l.id === fromId);
  const to = map.find(l => l.id === toId);
  if (!from || !to) return 10;
  const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  return Math.max(1, Math.round(dist / WALK_SPEED));
}

export const MAP_LOCATIONS: MapLocation[] = [
  { id: 'gate',    name: '城门',   type: 'outdoor',  connections: ['market', 'houses'], x: 6, y: 0 },
  { id: 'yamen',   name: '县衙',   type: 'building', connections: ['market'], x: 0, y: 2 },
  { id: 'market',  name: '街市',   type: 'outdoor',  connections: ['gate', 'yamen', 'shop', 'warehouse'], x: 3, y: 2 },
  { id: 'shop',    name: '商铺',   type: 'building', connections: ['market'], x: 6, y: 2 },
  { id: 'warehouse', name: '仓库', type: 'building', connections: ['market', 'hideout'], x: 1, y: 4 },
  { id: 'houses',  name: '民宅',   type: 'building', connections: ['market', 'gate'], x: 5, y: 4 },
  { id: 'hideout', name: '地下据点', type: 'building', connections: ['warehouse'], x: 2, y: 6 },
];

export function findPath(from: string, to: string, map: MapLocation[] = MAP_LOCATIONS): string[] | null {
  if (from === to) return [from];
  const visited = new Set<string>([from]);
  const queue: { id: string; path: string[] }[] = [{ id: from, path: [from] }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const loc = map.find(l => l.id === current.id);
    if (!loc) continue;
    for (const conn of loc.connections) {
      if (visited.has(conn)) continue;
      visited.add(conn);
      const newPath = [...current.path, conn];
      if (conn === to) return newPath;
      queue.push({ id: conn, path: newPath });
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 四、对话系统
// ═══════════════════════════════════════════════════════════════

export interface Conversation {
  id: string;
  participants: string[];
  turn: ConversationTurn[];
  status: 'active' | 'ended';
  startedAt: number;
}

export interface ConversationTurn {
  speakerId: string;
  content: string;
  tick: number;
}

// ═══════════════════════════════════════════════════════════════
// 五、角色
// ═══════════════════════════════════════════════════════════════

export interface Character {
  id: string; name: string; role: string;
  factionId: FactionId | null; socialStatus: SocialStatus;
  authorityLevel: number; wantedLevel: number;
  locationId: LocationId; isDetained: boolean; isAlive: boolean;
  money: number; inventory: InventoryItem[];
  drives: Drives; personality: Personality;
  relationships: Map<CharacterId, Relationship>;
  currentGoal: Goal | null;
  npcState: NpcState | null;  // ★ v2 新：LLM 输出的状态
  skills: Skills; reputation: Reputation;
}

export interface InventoryItem { itemId: string; quantity: number; }
export interface Drives { safety: number; wealth: number; power: number; belonging: number; revenge: number; }
export interface Personality {
  greed: number; riskTolerance: number; aggression: number;
  empathy: number; loyalty: number; honesty: number;
  ambition: number; obedience: number;
}
export interface Relationship {
  trust: number; affinity: number; fear: number;
  respect: number; loyalty: number; resentment: number;
}
export interface Skills {
  combat: number; speech: number; stealth: number;
  investigation: number; leadership: number; intimidation: number;
}
export interface Reputation { official: number; civilian: number; criminal: number; merchant: number; }

// ═══════════════════════════════════════════════════════════════
// 六、目标（v1 兼容）
// ═══════════════════════════════════════════════════════════════

export interface Goal {
  id: string; characterId: string; description: string;
  condition: GoalCondition; priority: number; status: GoalStatus;
  progress: number; createdAt: number; source: 'drive' | 'event' | 'player' | 'llm'; strategy?: string;
}
export type GoalCondition =
  | { type: 'money_ge'; value: number }
  | { type: 'item_has'; itemId: string; quantity: number }
  | { type: 'relationship_le'; targetId: string; field: keyof Relationship; value: number }
  | { type: 'location_at'; locationId: LocationId }
  | { type: 'faction_joined'; factionId: FactionId }
  | { type: 'wanted_le'; value: number }
  | { type: 'custom'; description: string; check: string };

// ═══════════════════════════════════════════════════════════════
// 七、事件
// ═══════════════════════════════════════════════════════════════

export interface GameEvent {
  id: string; tick: number; type: ActionType;
  actorId: string; targetId: string | null; locationId: LocationId;
  success: boolean; result: EventResult;
  witnesses: string[]; knownTo: string[];
  description: string; narrative?: string;
}
export interface EventResult {
  description?: string; success?: boolean;
  moneyChanges?: { characterId: string; amount: number }[];
  itemChanges?: { characterId: string; itemId: string; quantity: number }[];
  driveChanges?: { characterId: string; changes: Partial<Drives> }[];
  relationshipChanges?: { fromId: string; toId: string; changes: Partial<Relationship> }[];
  worldStateChanges?: Partial<WorldState>;
  wantedChanges?: { characterId: string; delta: number }[];
  detentionChanges?: { characterId: string; detained: boolean }[];
  factionChanges?: { characterId: string; factionId: FactionId | null }[];
  locationChanges?: { characterId: string; locationId: LocationId }[];
}

// ═══════════════════════════════════════════════════════════════
// 八、世界状态
// ═══════════════════════════════════════════════════════════════

export interface WorldState {
  security: number; publicMorale: number; grainPrice: number;
  governmentPrestige: number; crimeLevel: number; grainReserve: number;
}
export interface FactionState {
  id: FactionId; name: string; members: string[];
  wealth: number; territory: LocationId[]; prestige: number; goal: string;
}
export interface Time {
  day: number; timeOfDay: TimeOfDay; tick: number;
}

// ═══════════════════════════════════════════════════════════════
// 九、决策与感知
// ═══════════════════════════════════════════════════════════════

export interface ActionDecision {
  action: ActionType; targetId?: string; parameters?: Record<string, unknown>;
  reason?: string; innerMonologue?: string;
}
export interface Perception {
  locationId: LocationId; nearbyCharacterIds: string[];
  nearbyEvents: GameEvent[]; recentRumors: RumoredFact[]; knownFacts: string[];
}
export interface RumoredFact {
  factId: string; content: string; credibility: number; sourceId: string; tick: number;
}

// ── 记忆（MemorySystem 用）──
export interface Memory {
  id: string;
  characterId: string;
  tick: number;
  text: string;
  type: 'event' | 'relationship' | 'promise' | 'emotion' | 'info' | 'strategy';
  importance: number;
  credibility: number;
  relatedCharacterIds: string[];
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════
// 十、世界容器
// ═══════════════════════════════════════════════════════════════

export interface World {
  tick: number; time: Time;
  clock: WorldClock;
  characters: Map<CharacterId, Character>;
  state: WorldState; factions: Map<FactionId, FactionState>;
  events: GameEvent[]; stateDeltas: StateDelta[];
  knowledge: KnowledgeStore;
  conversations: Map<string, Conversation>;
}
export interface StateDelta {
  entityId: string; field: string; from: number; to: number; eventId: string; tick: number;
}
export interface KnowledgeStore {
  knownBy: Map<string, Set<string>>;
  facts: Map<string, Fact[]>; rumors: Map<string, RumoredFact[]>;
}
export interface Fact {
  id: string; content: string; category: 'event' | 'relationship' | 'info' | 'secret';
  isTrue: boolean; createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// 十一、LLM 输出 Schema（新状态输出）
// ═══════════════════════════════════════════════════════════════

export const NPC_STATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: '你的目标（自然语言）' },
    plan: {
      type: 'array',
      description: '行动规划（多步）',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['move', 'talk', 'steal', 'give_money', 'buy', 'sell', 'bribe', 'threaten', 'demand_money', 'hire', 'report_crime', 'arrest', 'release', 'join_faction', 'leave_faction', 'wait', 'idle'] },
          targetId: { type: 'string' },
          parameters: { type: 'object' },
          duration: { type: 'number', description: '预计耗时（分钟）' },
        },
        required: ['action', 'duration'],
      },
    },
    successCondition: {
      type: 'object', properties: {
        type: { type: 'string', enum: ['money_ge', 'item_has', 'relationship_le', 'location_at', 'talk_success', 'talk_refused', 'time_elapsed', 'custom'] },
        value: { type: 'number' }, targetId: { type: 'string' }, field: { type: 'string' },
        times: { type: 'number' }, minutes: { type: 'number' }, check: { type: 'string' },
      }, required: ['type'],
    },
    failureCondition: {
      type: 'object', properties: {
        type: { type: 'string', enum: ['money_ge', 'item_has', 'relationship_le', 'location_at', 'talk_success', 'talk_refused', 'time_elapsed', 'custom'] },
        value: { type: 'number' }, targetId: { type: 'string' }, times: { type: 'number' }, minutes: { type: 'number' },
      },
    },
  },
  required: ['goal', 'plan', 'successCondition'],
  additionalProperties: false,
};