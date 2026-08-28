# 清河县 · AI 社会模拟器架构设计

> 本文档包含：系统架构图 → Agent 思维模型 → 数据流 → 分阶段开发计划

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        模拟引擎 SimulationEngine                         │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      Tick 循环（每 tick 一轮）                     │   │
│  │                                                                   │   │
│  │  1. 时间推进 → 2. 世界状态更新 → 3. 遍历每个角色 → 4. 事件后处理  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│            ┌───────────────────────┼───────────────────────┐             │
│            ▼                       ▼                       ▼             │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐        │
│  │   感知层         │   │   决策层         │   │   执行层         │        │
│  │   Perceiver     │   │   DecisionMaker  │   │   ActionExecutor │        │
│  │                 │   │                 │   │                 │        │
│  │ 角色看到什么     │──▶│ LLM 选择动作     │──▶│ 规则引擎判定结果 │        │
│  │ 听到什么         │   │ 或生成 Goal      │   │ 修改世界状态     │        │
│  │ 知道什么         │   │                 │   │                 │        │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘        │
│           │                      │                      │                │
│           ▼                      ▼                      ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       事件系统 EventSystem                         │   │
│  │  action → Event → 传播/记录 → 触发 Drive 变化 → 触发关系变化 →    │   │
│  │  触发世界状态变化 → 其他角色感知到                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       持久化层 Store                              │   │
│  │  CharacterState | WorldState | Events | Knowledge | Goals | ...  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
          ▲                                                    │
          │             ┌──────────────────┐                   │
          │             │   API / WebSocket │                   │
          └─────────────┤                   │◄──────────────────┘
                        │   /api/state      │
                        │   /api/action     │
                        │   /api/characters  │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │   前端可视化       │
                        │   (HTML/React)    │
                        └──────────────────┘
```

---

## 二、一个 Agent 的"思维"过程

这是整个系统最核心的运转逻辑——每个角色在每个 tick 里如何思考：

```
                         ┌─────────────────────────────┐
                         │     世界给我什么信息          │
                         │  (Perceiver 层)              │
                         │                             │
                         │  • 我在哪个位置？            │
                         │  • 我附近有谁？              │
                         │  • 我最近听到了什么消息？     │
                         │  • 我最近经历了什么事件？     │
                         └─────────────┬───────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────┐
              │        我的内部状态是什么                  │
              │  (Internal State)                        │
              │                                          │
              │  • 我的驱动力：Safety/Wealth/Power/...    │
              │  • 我的人格：贪婪/风险/攻击性/...         │
              │  • 我的关系：我对每个人的信任/恐惧/好感    │
              │  • 我的目标：当前正在做什么、为什么         │
              │  • 我的记忆：最近 N 个重要事件             │
              │  • 我的能力：战斗/口才/偷窃/...            │
              └─────────────┬────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────────────────┐
              │        LLM 推理（决策层）                  │
              │                                          │
              │  输入：世界信息 + 内部状态 + 可用动作       │
              │                                          │
              │  "我是三指，我最近缺钱（wealth ↓），        │
              │   而且正在被通缉（safety ↓）。              │
              │   我当前目标是'凑 50 两跑路'。              │
              │   我现在在仓库，附近没人，看到一袋粮食。     │
              │   我该做什么？"                            │
              │                                          │
              │  输出：{"action": "steal", "target": ...}  │
              └─────────────┬────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────────────────┐
              │      规则引擎（执行层）                    │
              │                                          │
              │  "steal" → 计算成功率 → 判定结果           │
              │  • 战力差 × 隐蔽性 × 随机 → 成功/失败     │
              │  • 如果成功：物品转移                        │
              │  • 如果失败：可能被抓住                      │
              │  • 无论如何：生成事件记录                    │
              └─────────────┬────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────────────────┐
              │      事件传播（后处理层）                   │
              │                                          │
              │  生成 Event →                            │
              │  • 更新角色状态（money/-/关系/...）         │
              │  • 更新 Drive（被偷 → wealth↓, fear↑）     │
              │  • 更新关系（商人 → trust_thief↓）          │
              │  • 更新世界状态（crimeLevel↑）              │
              │  • 更新知识（谁知道了这件事）                │
              │  • 评估 Goal 是否完成                      │
              └─────────────┬────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────────────────┐
              │      下一轮 Tick：其他角色感知到变化        │
              │                                          │
              │  商人："我钱少了！听说三指在仓库出现过"     │
              │  → 生成新 Goal："让捕头抓住三指"            │
              │  → 去找捕头                                │
              │  → 故事继续                                │
              └──────────────────────────────────────────┘
```

---

## 三、核心数据模型关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          WorldState                                 │
│  security | morale | grainPrice | prestige | crimeLevel | day | time│
└─────────────────────────────────────────────────────────────────────┘
         ▲ affects                              ▲ affects
         │                                      │
┌────────┴───────────────────────────────────────────────────────────┐
│                         Character[]                                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Character                                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │   │
│  │  │ identity │  │ drives   │  │ skills   │  │ socialStatus  │ │   │
│  │  │ name     │  │ safety   │  │ combat   │  │ authority    │ │   │
│  │  │ role     │  │ wealth   │  │ speech   │  │ wantedLevel  │ │   │
│  │  │ faction  │  │ power    │  │ stealth  │  │ reputation   │ │   │
│  │  │ location │  │ belong   │  │ invest   │  │ (per group)  │ │   │
│  │  │ money    │  │ revenge  │  │ lead     │  │              │ │   │
│  │  │ items    │  │          │  │ intim    │  │              │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │   │
│  │                                                              │   │
│  │  ┌───────────────────────┐  ┌────────────────────────────┐   │   │
│  │  │ relationships[]       │  │ knowledge                  │   │   │
│  │  │ per character:        │  │  knownFacts: Set            │   │   │
│  │  │  trust / affinity     │  │  rumors: Map<id,cred>      │   │   │
│  │  │  fear / respect       │  │  beliefs: Map<id,cred>     │   │   │
│  │  │  loyalty / resentment  │  │                            │   │   │
│  │  └───────────────────────┘  └────────────────────────────┘   │   │
│  │                                                              │   │
│  │  ┌───────────────────────┐  ┌────────────────────────────┐   │   │
│  │  │ currentGoal: Goal     │  │ personality                │   │   │
│  │  │  description          │  │  greed / riskTolerance     │   │   │
│  │  │  condition            │  │  aggression / empathy      │   │   │
│  │  │  priority / status    │  │  loyalty / honesty         │   │   │
│  │  │  progress / strategy  │  │  ambition / obedience      │   │   │
│  │  └───────────────────────┘  └────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │  creates / receives
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Event[]                                     │
│  actor | action | target | location | success | result               │
│  witnesses[] | knownTo[] | secrecy | description | narrative         │
│                                                                      │
│  Event → 改变以下所有内容：                                           │
│  • Character.money/inventory  (财产变化)                              │
│  • Character.drives[]         (驱动力变化)                             │
│  • Character.relationships[]  (关系变化)                               │
│  • Character.knowledge        (谁知道什么)                             │
│  • WorldState.*              (公共状态变化)                            │
│  • 可能触发新 Goal 的生成                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、分阶段开发计划

### 阶段总览

```
Phase 1 ▸ 骨架 + 数据模型     → 能跑，tick 循环动起来
Phase 2 ▸ 规则引擎            → 15 个动作可执行、可判定
Phase 3 ▸ 感知 + 信息传播      → 角色不是全知的
Phase 4 ▸ Drive + Goal 系统   → 角色有持续需求 + 目标
Phase 5 ▸ LLM 决策管道        → LLM 基于状态做决策
Phase 6 ▸ 关系系统            → 关系变化驱动决策
Phase 7 ▸ API + 前端可视化    → 看得见、可操作
Phase 8 ▸ 涌现验证 + 调参     → 真正跑出故事
```

---

### Phase 1：骨架 + 数据模型

**目标**：建立一个能跑起来的 tick 循环，所有类型定义完整，能打印"第 X tick：7 个角色状态"

**交付物**：
- `/src/types.ts` — 所有类型定义（Character, Goal, Event, WorldState, Action 等）
- `/src/engine.ts` — tick 循环骨架（加载角色 → 每 tick 遍历 → 打印状态）
- `/src/data/characters.ts` — 7 个角色的初始数据（含 drives, personality, skills, relationships）
- `/src/data/world.ts` — 初始世界状态
- `/src/index.ts` — 入口，启动模拟
- `/package.json` — TypeScript + tsx 配置

**验收标准**：
```
npm start
→ 输出：
  第 1 tick | 时间: 08:00
    赵文远(县令)  位置: 县衙  money: 200  Goal: 维持稳定
    张铁(捕头)    位置: 县衙  money: 150  Goal: 维持治安
    陈富贵(商人)  位置: 商铺  money: 500  Goal: 赚钱
    李老实(市民)  位置: 街市  money: 30   Goal: 养家
    王秀才(市民)  位置: 民宅  money: 20   Goal: 看不惯不平事
    三指(小偷)    位置: 地下据点 money: 10 Goal: 搞钱
    玩家(旅人)    位置: 城门  money: 50   Goal: 探索
  ----------------------------------------
  第 2 tick | 时间: 08:15
  ...
```

**关键代码行**：约 300 行（类型定义 200 + 引擎骨架 100）

**时间估计**：2-3 小时

---

### Phase 2：规则引擎

**目标**：能执行 15 个社会动作，规则引擎判定成功/失败，修改角色状态

**交付物**：
- `/src/rules/execute.ts` — 动作执行器（每个 action 一个 case）
- `/src/rules/checks.ts` — 合法性检查（能否偷/能否逮捕/能否买卖）
- `/src/rules/pricing.ts` — 价格计算（粮价浮动）
- `/src/rules/types.ts` — 规则相关类型
- 测试脚本：模拟一次"偷窃→逮捕→关押→释放"完整执法链

**15 个动作**：
```
move / talk / give_money / steal / buy / sell
arrest / release / bribe / threaten / hire
report_crime / join_faction / leave_faction / demand_money
```

**规则引擎示例**（偷窃判定）：
```typescript
function executeSteal(actor: Character, target: Character, context: WorldContext): EventResult {
  const successRate = 
    (actor.skills.stealth * 0.4) + 
    (1 - target.skills.combat * 0.3) + 
    (context.location.security * 0.1) + 
    random(0, 0.2);
  
  const success = Math.random() < successRate;
  
  if (success) {
    // 转移金钱
    target.money -= amount;
    actor.money += amount;
    // 通缉度上升
    actor.wantedLevel += 2;
  }
  
  return { success, moneyChange: success ? amount : 0, ... };
}
```

**验收标准**：
```typescript
// 给定场景：三指在仓库独处，仓库有粮食
const result = executeAction('steal', { actor: thief, target: warehouse, amount: 30 });
// 验证：成功或失败都有对应的状态变化
// 验证：如果成功，thief.money += 30, warehouse.owner.money -= 30
// 验证：thief.wantedLevel > 0
// 验证：生成了一个 Event 记录
```

**关键代码行**：约 500 行

**时间估计**：4-6 小时（从现有 CountyEngine 移植 + 重构）

---

### Phase 3：感知 + 信息传播

**目标**：角色不是全知的——一个角色只能感知自己所在位置的信息，事件有目击者，消息可以传播

**交付物**：
- `/src/perceiver.ts` — 角色感知函数
  - 输入：角色位置、当前事件、知识库
  - 输出：该角色"知道什么"（看到/听到/推断）
- `/src/knowledge.ts` — 知识存储与传播
  - `knownTo: Set<string>` 每个事件维护谁知道
  - `shareKnowledge(from, to, factId)` — 当面告知
  - `spreadRumor(origin, fact)` — 谣言传播（fidelity 递减）
- 感知限制测试：三指在仓库偷东西，县衙里的县令不应该知道

**感知函数**：
```typescript
function perceive(character: Character, world: World): Perception {
  // 1. 角色所在位置能看到什么
  const nearbyCharacters = world.characters.filter(c => c.location === character.location);
  const nearbyEvents = world.events.filter(e => e.location === character.location && e.tick > world.tick - 3);
  
  // 2. 角色知道什么（知识库）
  const knownFacts = knowledge.getKnownFacts(character.id);
  
  // 3. 最近听到的消息
  const recentRumors = knowledge.getRumorsFor(character.id, world.tick);
  
  return { nearbyCharacters, nearbyEvents, knownFacts, recentRumors };
}
```

**验收标准**：
```typescript
// 三指在仓库偷东西，附近只有市民甲
const event = { actor: '三指', action: 'steal', location: '仓库', witnesses: ['市民甲'] };
// → 市民甲知道此事
// → 三指自己知道
// → 县令不知道（除非被告知）
// → 市民甲去告诉捕头后，捕头才知道
```

**关键代码行**：约 300 行

**时间估计**：3-4 小时

---

### Phase 4：Drive + Goal 系统

**目标**：角色有持久的内在驱动力，基于 drives 生成目标，目标驱动行为，完成后检测

**交付物**：
- `/src/drive.ts` — Drive 系统
  - 5 个驱动力：safety / wealth / power / belonging / revenge
  - 事件 → 驱动力变化规则（规则引擎判定，非 LLM）
  - 每 tick 自然衰减（drift back to baseline）
- `/src/goal.ts` — Goal 系统
  - Goal 类型定义（condition, priority, status, progress）
  - Goal 生成（LLM 调用，但 Phase 4 先硬编码/模板）
  - Goal 完成检测（每 tick 规则引擎检查 condition）
  - Goal 生命周期（active → completed/abandoned/failed）
- `/src/goal-manager.ts` — 管理所有角色的 goal
  - 评估是否需要重新生成 goal
  - 每 5 tick 或 drive 变化 > 0.15 时触发
- 示例场景：三指被通缉后 safety↓ → 生成 Goal "凑钱跑路"

**Drive 变化规则**（示例）：
```typescript
const DRIVE_EFFECTS = {
  'steal_success':    { wealth: 0.08, safety: -0.05, power: 0.02 },
  'arrested':         { safety: -0.3, power: -0.1, revenge: 0.15 },
  'given_money':      { wealth: -0.1, belonging: 0.05 },
  'threatened':       { safety: -0.15, power: -0.05, revenge: 0.1 },
  'joined_faction':   { belonging: 0.15, power: 0.05 },
  'reported_crime':   { safety: 0.1, belonging: 0.05 },
  // 自然衰减（每 tick 向 baseline 回归 2%）
  'decay': { safety: 0.02, wealth: 0.02, power: 0.02, belonging: 0.02, revenge: 0.02 },
};
```

**Goal 生成模板**（Phase 4 先用 LLM 模拟，即硬编码判断）：
```
if (character.drives.safety < 0.3) → generateGoal("提高安全", "acquire", "weapon", 0.8)
if (character.drives.wealth < 0.3) → generateGoal("赚钱", "acquire", "money", 0.9)
if (character.drives.revenge > 0.7) → generateGoal("报复某人", "eliminate", "target", 0.7)
if (character.drives.power < 0.4 且 ambition > 0.6) → generateGoal("提升地位", "change", "faction", 0.6)
```

**验收标准**：
```typescript
// 三指初始 drives: { wealth: 0.3, safety: 0.5, power: 0.4, ... }
// 执行一次偷窃后: wealth 上升, safety 下降
// → 触发 Goal 重评估
// → 生成新 Goal: "凑 50 两跑路"
// → 5 tick 后检查: money 是否达到 50?
// → 达到则 Goal 标记 completed
```

**关键代码行**：约 400 行

**时间估计**：4-5 小时

---

### Phase 5：LLM 决策管道

**目标**：真正的 LLM 替代 Phase 4 的硬编码模板，基于角色状态 + drives + goal 做决策

**交付物**：
- `/src/llm/client.ts` — LLM 客户端（OpenAI 兼容协议，可接 DeepSeek/Qwen）
- `/src/llm/prompt-builder.ts` — 构建角色决策 prompt
- `/src/llm/decision-maker.ts` — 决策主逻辑
  - 输入：角色感知 + 内部状态 + 可用动作
  - 输出：结构化 ActionChoice
- `/src/llm/goal-generator.ts` — 基于 drives 生成 Goal
  - 不需要每 tick 调 LLM，只在 drive 变化大时触发
- `/src/llm/schemas.ts` — 结构化输出 JSON Schema

**Prompt 模板**（决策用）：
```
你是一个古代县城里的【角色身份】。
你的名字是【名字】。

你当前的状态：
- 银两：50 两
- 位置：仓库
- 安全需求：0.3（低，你需要提高安全）
- 财富需求：0.7（高，你需要钱）
- 当前目标：凑 50 两跑路（进度 30%）

你的人际关系：
- 对县令：信任 60，恐惧 30
- 对捕头：信任 -20，恐惧 70
- 对商人：信任 10，好感 0

你最近记得的事：
- 你偷了商人的粮食（成功，无人发现）
- 捕头开始调查仓库失窃案

你现在可以做的动作：
- steal（偷窃）💡 符合你的身份
- move（移动到另一个地点）
- talk（和别人交谈）
- hide（躲藏）💡 你现在被通缉
- sell（卖掉你手里的东西）

请根据以上状态，决定你接下来要做什么动作。
返回 JSON 格式：
{
  "action": "steal",
  "target": "char_shangren",
  "reason": "我需要钱跑路，商人的商铺现在没人",
  "innerMonologue": "趁现在没人，干一票大的就走"
}
```

**验收标准**：
```typescript
// 给定角色状态 + 感知 + 可用动作
const decision = await llmDecide(character, perception, availableActions);
// 验证：decision 是有效的 action（从可用动作列表中选）
// 验证：decision 有 reason（解释为什么）
// 验证：不同状态下的 decision 明显不同
//   - wealth ↓ → 倾向于 steal/demand_money
//   - safety ↓ → 倾向于 hide/flee
//   - revenge ↑ → 倾向于 threaten/attack
```

**成本控制**：
- 不是每 tick 都调 LLM——只有角色需要决策时才调
- Goal 重评估更少：每 5 tick 或 drive 变化 > 0.15
- 每次调用约 300-500 token，成本约 0.001 元/次

**关键代码行**：约 400 行

**时间估计**：4-5 小时

---

### Phase 6：关系系统

**目标**：多维关系值（信任/好感/恐惧/尊重/忠诚/怨恨）受事件驱动变化，反过来影响 LLM 决策

**交付物**：
- `/src/relationship.ts` — 关系管理
  - 事件 → 关系变化规则（规则引擎判定）
  - 关系变化联动（如 fear 上升可能影响 trust 下降）
  - 关系与决策的关联（LLM prompt 中注入关系数据）
- 关系变化规则表：

```typescript
const RELATIONSHIP_EFFECTS = {
  'steal':          { target: { trust: -20, affinity: -15, fear: 10, resentment: 25 } },
  'arrest':         { target: { trust: -10, fear: 15, respect: 5 }, subject: { fear: 20 } },
  'give_money':     { target: { trust: 10, affinity: 15, gratitude: 20 } },
  'threaten':       { target: { trust: -25, fear: 30, resentment: 20 } },
  'bribe':          { target: { trust: -5, fear: 10, loyalty: -10 } },
  'report_crime':   { target: { trust: 15, respect: 10 } },
  'help':           { target: { trust: 20, affinity: 20, gratitude: 25 } },
};
```

**验收标准**：
```typescript
// 初始：商人对三指 trust: 0, fear: 0
// 三指偷了商人的钱
// → 商人对三指 trust: -20, affinity: -15, fear: 10, resentment: 25
// 商人 tell 捕头
// → 捕头对三指就有了初步认知
// 捕头逮捕了三指
// → 捕头对三指 fear: +15（见证拒捕）
// → 三指对捕头 resentment: +20
```

**关键代码行**：约 200 行

**时间估计**：2-3 小时

---

### Phase 7：API + 前端可视化

**目标**：能通过浏览器看到县城状态，玩家能操作

**交付物**：
- `/src/api/index.ts` — Express 服务器
  - `GET /api/state` — 当前世界状态 + 所有角色状态
  - `GET /api/characters` — 角色列表（含 drives/goals/关系）
  - `POST /api/action` — 玩家执行动作
  - `GET /api/events` — 事件流
  - `GET /api/timeline` — 时间线
- `/client/` — 简单前端（纯 HTML + CSS + JS 或 React）
  - 地图（最简版：文字/色块表示位置）
  - 角色面板（显示 drives/goals/关系/状态）
  - 事件流面板（实时显示最近事件）
  - 玩家操作面板（选择动作 + 目标）
  - 世界状态栏（治安/民心/粮价等）

**验收标准**：
- 打开 http://localhost:3200 → 看到县城状态
- 点击角色 → 看到 drives/goals/关系
- 执行一个动作 → 世界状态变化 → 事件流更新
- 模拟连续跑 10 个 tick → 事件流不断增长

**关键代码行**：约 500 行（API 200 + 前端 300）

**时间估计**：4-6 小时

---

### Phase 8：涌现验证 + 调参

**目标**：验证系统能否产生非预设的涌现故事，调优参数

**验收场景**（来自 WorldX 已验证的涌现）：
```
场景 1：三指偷粮
  初始条件：三指在仓库独处，仓库有粮食
  预期：LLM 自主决定偷 → 产生犯罪记录 → 捕头调查 → 县令警觉
  验证：Chain reaction 发生

场景 2：玩家挑拨
  初始条件：玩家在县城自由活动
  预期：玩家挑拨县令和捕头关系 → 捕头忠诚下降 → 产生新剧情
  验证：关系变化导致行为变化

场景 3：商人受威胁
  初始条件：三指向商人敲诈
  预期：商人恐惧 → 找捕头保护 → 或妥协交钱 → 或联合其他商人
  验证：同一事件不同 NPC 不同反应

场景 4：重复运行同一初始状态
  预期：三次运行产生的故事明显不同
  验证：涌现性
```

**调参清单**：
- Drive 衰减速度（走回 baseline 的速率）
- Drive 变化触发 Goal 重评估的阈值（0.15 过高/过低？）
- 关系变化幅度（一次偷窃 -20 trust 是否合适？）
- 偷窃成功率公式（战力 vs 隐蔽 vs 随机）
- LLM 调用频率（每 tick 还是每 3 tick？）
- 知识传播速度（告诉一个人后，多久传到全城？）

**关键代码行**：约 100 行（测试脚本）

**时间估计**：3-4 小时（持续迭代）

---

## 五、技术栈

| 层 | 技术 | 理由 |
|---|---|---|
| 语言 | TypeScript | 你熟悉，类型安全 |
| 运行时 | Node.js (v24) | 已装好，兼容 DeepSeek/Qwen API |
| 运行 | tsx | 直接跑 TS，不用编译 |
| 服务器 | Express | 轻量，熟悉 |
| 持久化 | JSONL（先）→ SQLite（后） | 先不要数据库依赖，MVP 之后迁移 |
| LLM | OpenAI 兼容协议 | DeepSeek/Qwen 都能接 |
| 前端 | 原生 HTML + CSS + JS | 不要框架依赖，MVP 能看就行 |
| 包管理 | npm | 已有的 |

---

## 六、项目结构

```
xiancheng-core/
│
├── package.json
├── tsconfig.json
├── .env                      # LLM API keys
│
├── src/
│   ├── index.ts              # 入口
│   ├── types.ts              # 所有类型定义
│   │
│   ├── data/
│   │   ├── characters.ts     # 7 个角色的初始数据
│   │   └── world.ts          # 初始世界状态
│   │
│   ├── engine.ts             # 模拟循环（tick 调度）
│   │
│   ├── rules/
│   │   ├── execute.ts        # 动作执行器
│   │   ├── checks.ts         # 合法性检查
│   │   └── pricing.ts        # 价格计算
│   │
│   ├── drive.ts              # Drive 系统
│   ├── goal.ts               # Goal 系统
│   ├── goal-manager.ts       # Goal 管理
│   ├── relationship.ts       # 关系系统
│   ├── perceiver.ts          # 感知系统
│   ├── knowledge.ts          # 信息传播
│   │
│   ├── llm/
│   │   ├── client.ts         # LLM 客户端
│   │   ├── prompt-builder.ts # 决策 prompt
│   │   ├── decision-maker.ts # 决策主逻辑
│   │   ├── goal-generator.ts # 目标生成
│   │   └── schemas.ts        # 结构化输出
│   │
│   ├── store.ts              # 持久化
│   │
│   └── api/
│       └── index.ts          # Express API
│
├── client/
│   └── index.html            # 前端页面
│
└── scripts/
    └── test-emergence.ts     # 涌现测试脚本
```

---

## 七、关键设计原则

### 1. LLM 与规则引擎的边界

```
LLM 负责                         规则引擎负责
──────────────────────────────  ──────────────────────────────
理解语言                         钱有多少
判断意图                         物品属于谁
判断对方是否可信                 人在哪里
形成计划                         战斗谁赢
生成目标                         是否成功偷窃
选择行动                         是否看见事件
谈判                             时间流逝
欺骗                             税率
说话                             商品库存
根据记忆解释事件                 世界状态数值
```

**一句话：LLM 决定"想做什么"，规则引擎决定"现实允许发生什么"。**

### 2. 信息边界

角色不是全知的。每个角色只能看到：
- 自己所在位置的人和物
- 别人告诉他的信息
- 他自己经历过的事件

角色的"知识"存储在 `knowledge` 系统中，感知层（perceiver）过滤信息。

### 3. 事件驱动一切

```
Action → Event → Event → Event → Event → ...
                  │
                  ├─ 改变角色状态
                  ├─ 改变驱动力
                  ├─ 改变关系
                  ├─ 改变世界状态
                  ├─ 更新知识库
                  └─ 可能触发新 Goal
```

每个事件至少产生一个"传播链"，最终形成连锁反应。

### 4. 不要写"剧本"

不要写：
```
if (三指偷了商人) → 商人去找捕头
```

要写：
```
偷窃 → 商人财产减少 → 商人安全需求变化 → LLM 决定下一步
```

由 Agent 自己决定怎么反应，不是开发者预设。

---

## 八、当前 WorldX 项目可以复用的东西

虽然"抛弃 WorldX"，但以下可以直接移植：

| 资源 | 位置 | 用途 |
|---|---|---|
| 7 个角色 JSON | `library/worlds/xiancheng_001/config/characters/` | 角色初始数据（name/role/backstory/personality） |
| 世界配置 | `library/worlds/xiancheng_001/config/world.json` | 物品/组织/法律/初始库存 |
| 角色 spritesheet | `library/worlds/xiancheng_001/characters/` | 可视化的精灵图（等前端阶段） |
| AI 地图 | `library/worlds/xiancheng_001/map/06-background.png` | 地图背景（等前端阶段） |
| CountyEngine 规则 | `server/src/core/county-engine.ts` | 偷窃/逮捕/买卖等规则逻辑参考 |
| 涌现用例 | 已验证的"三指偷粮" | 验收标准 |