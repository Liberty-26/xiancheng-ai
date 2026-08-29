# 清河县 · 状态驱动架构 v2 设计文档

> 核心转变：从"固定 tick 集体决策" → "NPC 完成行动后自主触发思考"
> 时间从"分片推进" → "行动耗时自然流动"

---

## 一、术语表（v2 重新定义）

| 术语 | 含义 | 谁生成 | 生命周期 |
|---|---|---|---|
| **状态 (State)** | NPC 当前的目标 + 行动规划 + 完成/失败条件 | **LLM 输出** | 行动完成后更新 |
| **情境 (Context)** | 给 LLM 决策时拼装的信息（世界/感知/驱动力/关系/记忆/当前状态） | 代码拼装 | 每次 LLM 调用时生成 |
| **行动 (Action)** | 世界允许的底层行为（move/talk/steal...） | 代码定义（15 个） | 执行一次 |
| **规划 (Plan)** | 有序的行动列表 + 每步参数 | **LLM 输出** | 随状态更新 |
| **事件 (Event)** | 行动执行的结果（谁/做了什么/结果） | 规则引擎 | 永久记录 |
| **地图 (Map)** | 地点/道路/建筑/连接关系的数据定义 | 代码定义 | 静态（MVP） |

**关键区分（不能再混）：**
- **状态** = NPC 自己宣布的"我要干什么、怎么干、怎样算成功" —— LLM 的自由意志
- **情境** = 代码在 LLM 思考前递给它的"世界现在长什么样" —— 客观事实

---

## 二、核心循环：状态机

```
                    ┌──────────────────────────┐
                    │   NPC 状态（持久）         │
                    │   goal: 自然语言           │
                    │   plan: [行动序列]         │
                    │   successCondition: 条件   │
                    │   failureCondition: 条件   │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │   执行 plan 的第一项       │
                    │   （行动由代码执行）        │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │   行动完成 → 事件生成       │
                    │   时间流逝（行动耗时）       │
                    └───────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
    ┌─────────▼──────┐  ┌──────▼─────────┐  ┌────▼──────────┐
    │ 检查成功条件     │  │ 检查失败条件     │  │ 规划还有步骤？ │
    │ 代码验证        │  │ 代码验证        │  │               │
    └─────────┬──────┘  └──────┬─────────┘  └────┬──────────┘
              │                 │                 │
          达成成功          达成失败           还有步骤
              │                 │                 │
              ▼                 ▼                 ▼
    ┌─────────────────────────────────────────────┐
    │             触发 LLM 反思                    │
    │  输入：情境 + 当前状态 + 最近结果             │
    │  输出：新的状态（新目标 or 调整规划）          │
    └─────────────────────────────────────────────┘
              │
              ▼
     回到循环（执行新状态）
```

**要点：**
1. **NPC 永远活在状态里** —— 没有"无目标"状态；发呆也是 `goal:"休息"`, `plan:[{action:"wait",duration:60}]`
2. **LLM 只在行动完成后介入** —— 执行期间代码自主运行，LLM 退出
3. **成功/失败条件由代码验证** —— LLM 不自己判断"我成功了吗"
4. **多 NPC 并行** —— 每个 NPC 独立循环，时间按各自行动耗时流动

---

## 三、状态定义（LLM 输出）

```typescript
interface NpcState {
  id: string;
  characterId: string;

  /** 自然语言目标 —— LLM 的自由表达，不做结构化约束 */
  goal: string;                    // "从县令那里借到50两银子买粮食"

  /** 行动规划 —— 有序多步，由预定义行动组成 */
  plan: PlanStep[];

  /** 成功条件 —— 代码可解析的表达式 */
  successCondition: Condition;

  /** 失败条件（可选）—— 代码可解析 */
  failureCondition?: Condition;

  /** 状态来源 */
  source: 'initial' | 'reflection' | 'reaction';
  createdAt: number;              // 世界时间
}

interface PlanStep {
  action: ActionType;             // 15 个预定义行动之一
  targetId?: string;              // 目标角色/地点
  parameters?: Record<string, unknown>;  // 参数（amount/message/...）
  duration: number;               // 预计耗时（分钟）
}

type Condition =
  | { type: 'money_ge'; value: number; actorId?: string }
  | { type: 'item_has'; itemId: string; quantity: number }
  | { type: 'relationship_le'; targetId: string; field: string; value: number }
  | { type: 'location_at'; locationId: string }
  | { type: 'talk_success'; targetId: string }       // 对方答应了请求
  | { type: 'talk_refused'; targetId: string; times: number }  // 被拒绝N次
  | { type: 'time_elapsed'; minutes: number }        // 过了N分钟
  | { type: 'custom'; check: string };               // 扩展函数名
```

**示例状态（三指借粮）：**
```json
{
  "goal": "从县令那里借到50两银子买粮食",
  "plan": [
    { "action": "move", "targetId": "yamen", "duration": 30 },
    { "action": "talk", "targetId": "char_xianling",
      "parameters": { "message": "大人，今年收成不好，想借点银子度日..." }, "duration": 10 },
    { "action": "wait", "duration": 5 }
  ],
  "successCondition": { "type": "money_ge", "value": 50, "actorId": "char_shimin_jia" },
  "failureCondition": { "type": "talk_refused", "targetId": "char_xianling", "times": 3 }
}
```

---

## 四、情境定义（代码拼装，给 LLM 看）

LLM 每次思考时收到的内容（**注意：状态也在其中，但状态是它上次自己写的**）：

```text
【世界现状】
- 时间：第3天 下午
- 治安：58  民心：62  粮价：105  官府威望：55  犯罪程度：30

【你的处境】
- 你在：民宅
- 附近有：王秀才
- 你最近在这里看到：李老实卖掉了布匹

【你的内部状态】
驱动力：安全0.6 财富0.7 权力0.2 归属0.6 复仇0.1
财产：银两30 | 物品：无
通缉：0
关系：对县令 信任40 恐惧30 | 对商人 信任20 怨恨0

【你当前的"状态"】（这是你上次自己定的）
目标：从县令那里借到50两银子买粮食
规划：移动到县衙 → 和县令谈话 → 等待回应
成功条件：money >= 50
失败条件：被县令拒绝3次
最近结果：你移动到县衙了

【你的记忆】
- [t12] 你告诉王秀才粮价要涨
- [t20] 你向县令提了借钱的请求

【行动菜单】（代码检查过你能做什么）
- move —— 移动到其他地点（yamen/market/shop/warehouse/houses/hideout/gate）
- talk —— 和附近的人交谈
- give_money / buy / sell / steal / bribe / threaten / hire
- report_crime / join_faction / leave_faction / demand_money
- wait —— 等待/休息（原地）

【任务】
1. 评估你的目标：还要继续吗？成功了吗？失败了要换策略吗？
2. 输出新状态 JSON：
   {
     "goal": "自然语言目标",
     "plan": [{"action": "...", "targetId": "...", "parameters": {}, "duration": 分钟}],
     "successCondition": {...},
     "failureCondition": {...}
   }
   如果目标没变，规划可以只包含下一步。
```

---

## 五、行动系统（15 个行动 + 耗时）

| 行动 | 耗时(分钟) | 说明 |
|---|---|---|
| move | 5-30 | 移动到相邻地点（地图连接关系决定） |
| talk | 5-15 | 对话；若对方是 NPC 触发其感知，若对方有"等回应"规划则 LLM 回应 |
| wait | 自定义 | 等待/休息/发呆 |
| give_money | 2 | 给钱 |
| steal | 5 | 规则判定成功率 |
| buy / sell | 5 | 按定价交易 |
| bribe | 5 | 规则判定 |
| threaten / demand_money | 5 | 规则判定 |
| hire | 5 | 雇佣 |
| report_crime | 5 | 举报 |
| arrest / release | 10 | 执法（权限） |
| join_faction / leave_faction | 10 | 组织 |

**行动执行流程（代码）：**
```typescript
async function executeStep(character, step, world): Promise<StepResult> {
  // 1. 移动：需要先移动到目标所在位置（如果行动有 targetId 且不同位置）
  if (step.action === 'talk' && step.targetId) {
    const target = world.characters.get(step.targetId);
    if (target && target.locationId !== character.locationId) {
      await moveCharacter(character, target.locationId, world);  // 自动走到目标旁
    }
  }
  // 2. 执行行动（规则引擎，Phase 2 的 executor 复用）
  const event = executeAction({action: step.action, targetId, parameters}, character, world);
  applyEvent(event, world);
  // 3. 时间流逝
  world.time = advanceTime(world.time, step.duration);
  // 4. 返回结果（供条件验证）
  return { event, success: event.success };
}
```

---

## 六、时间模型（流动的）

```
不再有"tick"概念。世界有一个时钟（分钟制）。

NPC-A: move(30分钟) → talk(10分钟) → 完成 → 触发LLM思考（耗时不计）
NPC-B: steal(5分钟) → 完成 → 触发LLM思考
NPC-C: wait(60分钟) → 完成 → 触发LLM思考

世界时间 = 所有 NPC 行动推进的时钟
（实现：一个循环，每轮推进"最早完成的行动"到完成时刻，
       期间其他 NPC 继续执行）
```

**实现方案（事件队列）：**
```typescript
interface WorldClock {
  now: number;                    // 当前世界时间（分钟）
  scheduled: Array<{
    characterId: string;
    step: PlanStep;
    finishAt: number;             // 完成时刻
  }>;
}

// 循环：
// 1. 找到 finishAt 最早的行动
// 2. world.now = 该 finishAt
// 3. 执行该行动（规则判定）
// 4. 检查条件 → 决定：继续执行/触发 LLM
// 5. 重复
```

这样多个 NPC 的行动自然交错，形成"流动的世界"。

---

## 七、地图数据定义（MVP）

```typescript
interface MapLocation {
  id: string;
  name: string;               // 县衙/街市/商铺/仓库/民宅/地下据点/城门
  type: 'building' | 'outdoor' | 'road';
  /** 相邻地点（移动路径） */
  connections: string[];
  /** 可容纳角色数（可选） */
  capacity?: number;

  // ── 未来扩展（MVP 不实现）──
  // interactiveObjects: InteractiveObject[];  // 可交互物品
  // ownerId?: string;         // 地块所有者
  // buildable: boolean;       // 能否建造
  // region?: Rect;            // 地图上的区域矩形
}

const MAP: MapLocation[] = [
  { id: 'gate',    name: '城门',   type: 'outdoor',  connections: ['market', 'houses'] },
  { id: 'yamen',   name: '县衙',   type: 'building', connections: ['market'] },
  { id: 'market',  name: '街市',   type: 'outdoor',  connections: ['gate', 'yamen', 'shop', 'warehouse'] },
  { id: 'shop',    name: '商铺',   type: 'building', connections: ['market'] },
  { id: 'warehouse', name: '仓库', type: 'building', connections: ['market', 'hideout'] },
  { id: 'houses',  name: '民宅',   type: 'building', connections: ['market', 'gate'] },
  { id: 'hideout', name: '地下据点', type: 'building', connections: ['warehouse'] },
];

/** 移动：返回路径（BFS） */
function findPath(from: string, to: string, map): string[] {
  // BFS 找到最短路径，返回经过的地点序列
}
```

**地图与视觉的关系：**
- **地图 = 数据结构**（上面的 MAP）：决定移动、建筑、位置
- **视觉 = 图片**（文生图生成背景，可选覆盖层）：只是显示
- MVP 先做数据结构；视觉可以后接（之前的 Qwen 生成图可复用为背景）

---

## 八、与 v1（tick 式）的对比

| 维度 | v1（tick 式） | v2（状态驱动） |
|---|---|---|
| 思考时机 | 固定 tick，所有人同时 | 行动完成后，各自触发 |
| 时间感 | 分片推进（15分钟/片） | 行动耗时自然流动 |
| 目标 | 结构化字段（模板生成） | 自然语言（LLM 自由表达） |
| 输出 | 单个动作 | 完整规划（多步行动） |
| 成功判定 | 代码检查（已有） | 代码检查（扩充 talk_success 等） |
| NPC 空闲 | "idle" | `goal:"休息", plan:[wait]` |
| 对话 | 单次生成 | 规划中的 talk 步骤 + 对方按需回应 |
| 并行 | 串行遍历 | 事件队列交错执行 |

---

## 九、迁移计划

### Step 1：数据结构改造
- `NpcState`（目标+规划+条件）替换 `currentGoal`
- `WorldClock`（分钟制）替换 `tick`
- 地图 MAP 数据定义

### Step 2：引擎改造
- 状态机循环（执行→验证→触发思考）
- 事件队列（多 NPC 交错）
- 行动耗时

### Step 3：LLM 输出改造
- 新 prompt（情境 + 状态反思）
- 新 JSON Schema（goal/plan/conditions）

### Step 4：对话系统
- talk 步骤 → 对方感知 → 若对方规划含"等待回应"则 LLM 生成回应文本

### Step 5：条件验证系统
- successCondition / failureCondition 的代码解释器

### Step 6：前端适配
- 事件流/角色面板显示"状态"（目标+规划）
- 世界时间显示

---

## 十、待讨论的问题

1. **对话机制**：A 对 B 说"借钱"，B 怎么回应？
   - 方案 A：B 的规划里有 `wait_for_response` 步骤 → 触发 B 的 LLM 回应
   - 方案 B：A 的 talk 步骤自动触发 B 的 LLM（每次谈话都花 B 的"思考次数"）
   - 我倾向 A：只有 B"准备好回应"时才调 LLM，更省也更自然

2. **LLM 调用频率**：状态驱动下，NPC 每个行动完成都触发 LLM？
   - 建议：**不**。一个规划中的连续步骤（move→move→talk）只在**关键节点**（talk 完成/条件达成）才触发反思，move/wait 只是执行。减少调用约 70%。

3. **时间粒度**：分钟制？时辰制？
   - 建议分钟制（一天 1440 分钟），行动耗时 2-30 分钟

---

*这份设计把"世界怎么转"讲清楚了。确认后我开始改代码（先改数据结构，再改引擎，然后 LLM 输出，最后前端）。*
