# 清河县 · 技术实现细节设计

> 本文档回答："架构图"与"能跑的代码"之间的所有技术缝隙：
> 状态如何进入 LLM、状态变化由谁记录、LLM 输出如何约束、模型如何"知道"后果。

---

## 一、状态进入 LLM：三层上下文拼装

### 1.1 三层结构

| 层 | 名称 | 内容 | 何时变化 | 大小 |
|---|---|---|---|---|
| L1 | 系统提示词（固定） | 人格、背景、世界规则说明、输出格式 | 角色创建时 | ~1-2K token |
| L2 | 状态快照（动态） | 位置/附近/Drives/Goal/关系/可用动作 | 每次决策时 | ~500-1K token |
| L3 | 记忆检索（按需） | 相关历史记忆、最近事件、消息 | 决策时检索 | ~500-1K token |

### 1.2 代码实现（伪代码）

```typescript
// decision-maker.ts
async function decide(character: Character, world: World): Promise<ActionDecision> {
  // L1：固定人格层（角色创建时生成一次，缓存）
  const systemPrompt = buildSystemPrompt(character);

  // L2：动态状态层（每次决策现拼）
  const perception = perceiver.perceive(character, world);       // 位置/附近/可见事件
  const snapshot = renderStateSnapshot(character, perception);   // drives/goal/关系/动作菜单

  // L3：记忆检索层（相关性排序取 Top N）
  const memories = memoryManager.retrieve(character.id, {
    query: snapshot.keywords,
    limit: 8,
    minImportance: 3,
  });

  // 拼装并调用
  const userContent = `
## 当前世界状态
${renderPerception(perception)}

## 你当前的内部状态
${renderDrives(character.drives)}
${renderGoal(character.currentGoal)}
${renderRelationships(character, perception.nearbyCharacterIds)}

## 你最近的记忆
${memories.map(m => `- [${m.tick}] ${m.text}`).join('\n')}

## 你现在可以做的动作
${renderActionMenu(character)}

请根据以上状态，决定你下一步做什么。
`;

  const response = await llm.chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ], {
    response_format: { type: "json_schema", json_schema: ACTION_DECISION_SCHEMA }
  });

  return validateDecision(response);   // zod 校验，失败重试
}
```

### 1.3 状态快照的渲染模板（L2 示例）

```text
## 你当前的内部状态

【驱动力】（0-1，越高越渴望）
- 安全：0.35（你正被通缉，很不安）
- 财富：0.72（你迫切需要钱）
- 权力：0.40
- 归属：0.50
- 复仇：0.45

【当前目标】
- "凑 50 两银子跑路"（进度 30%，优先级 0.8）
- 策略：先偷商人的货 → 卖到黑市 → 收买狱卒

【人际关系】（只显示与当前情境相关的）
- 对 捕头张铁：信任 -20 / 恐惧 70 / 怨恨 15
- 对 商人陈富贵：信任 -30 / 恐惧 10 / 怨恨 25

【最近记忆】
- [tick 12] 你在仓库偷了一袋粮食，无人发现
- [tick 15] 你听说捕头开始调查仓库失窃案
- [tick 17] 商人陈富贵昨天在市场见过你

【你现在可以做的动作】
- steal —— 偷窃（💡 符合你的身份）
- move —— 移动到其他地点
- hide —— 躲藏（💡 你正被通缉）
- sell —— 出售你手里的东西
- talk —— 与他人交谈
- bribe —— 行贿
```

---

## 二、状态变化的记录者：规则引擎 + Event 真相源

### 2.1 铁律

> **LLM 永远不能直接修改任何状态。**
> 所有状态变化（钱、Drives、关系、世界状态、知识）都必须经过规则引擎，
> 且以 Event 的形式记录为"真相源"。

### 2.2 状态变化流水线

```typescript
// engine.ts 的一个 tick 中，对每个角色：
async function processCharacter(character, world) {
  const decision = await decide(character, world);      // LLM 只输出"想做什么"
  const event = await rules.execute(decision, character, world);  // 规则引擎算"现实结果"
  applyEvent(event, world);                              // 应用变化 + 记录 delta
  knowledge.spread(event);                               // 信息传播
  goalManager.checkCompletion(character, world);         // 检查目标是否完成
  driveManager.applyEventToDrives(event, character);     // 事件 → 驱动力变化
}

// rules/execute.ts —— 唯一能改状态的地方
function execute(decision, actor, world): Event {
  const result = EXECUTORS[decision.action](decision, actor, world);
  return {
    id: uuid(),
    tick: world.tick,
    type: decision.action,
    actor: actor.id,
    target: decision.targetId,
    location: actor.location,
    success: result.success,
    result: {
      moneyChange: result.moneyChange,          // { actor: -30, target: +30 }
      driveChanges: result.driveChanges,        // { actor: {wealth: -0.1, safety: +0.05} }
      relationshipChanges: result.relationshipChanges, // { actor: {targetId, trust: -20, ...} }
      worldStateChanges: result.worldStateChanges,     // { crimeLevel: +2 }
      itemChanges: result.itemChanges,
    },
    witnesses: result.witnesses,                // 目击者
    description: result.description,            // 一句话描述
    narrative: result.narrative,                // LLM 生成的叙事（可选）
  };
}

// applyEvent —— 应用变化 + 记录 delta
function applyEvent(event, world) {
  const deltas = [];
  for (const [id, change] of Object.entries(event.result.moneyChange ?? {})) {
    const before = world.characters[id].money;
    world.characters[id].money = clamp(before + change, 0, MAX);
    deltas.push({ entity: id, field: "money", from: before, to: world.characters[id].money, eventId: event.id });
  }
  // ... 同样处理 drives / relationships / worldState / items
  world.stateDeltas.push(...deltas);   // 审计 + 回放用
}
```

### 2.3 状态变化来源总表

| 状态 | 谁改 | 改的规则 |
|---|---|---|
| money / inventory | 规则引擎 `EXECUTORS` | 偷窃/买卖/给钱/勒索/罚款 |
| drives | `driveManager.applyEventToDrives` | DRIVE_EFFECTS 表 |
| relationships | `relationshipManager.applyEventToRelationships` | RELATIONSHIP_EFFECTS 表 |
| knowledge | `knowledge.spread` | 目击者 + 传播规则 |
| worldState | 规则引擎（公共状态动作）+ `endOfDay` | 联动公式 |
| goal | `goalManager` | LLM 生成 / 规则检测完成 |
| location | 规则引擎 move | 移动动作 |

---

## 三、LLM 输出的结构化约束

### 3.1 决策输出 Schema（必须严格遵守）

```typescript
// schemas.ts
import { z } from "zod";

export const ACTION_DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: AVAILABLE_ACTIONS },   // 只能从菜单里选
    targetId: { type: "string" },                          // 目标角色/地点/物品 ID
    parameters: {                                          // 可选参数
      type: "object",
      additionalProperties: true,
    },
    reason: { type: "string", description: "为什么这么做（给叙事用）" },
    innerMonologue: { type: "string", description: "内心独白（给玩家看）" },
  },
  required: ["action"],
  additionalProperties: false,
};

export const ZodActionDecision = z.object({
  action: z.enum([...AVAILABLE_ACTIONS]),
  targetId: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  reason: z.string().optional(),
  innerMonologue: z.string().optional(),
});

export function validateDecision(raw: unknown): ActionDecision {
  const parsed = ZodActionDecision.safeParse(raw);
  if (!parsed.success) {
    throw new DecisionValidationError(parsed.error);
  }
  // 额外校验：action 必须在"当前可用动作"列表里（由 action-menu-builder 生成）
  if (!availableActions.has(parsed.data.action)) {
    throw new DecisionValidationError(`action ${parsed.data.action} not available`);
  }
  return parsed.data;
}
```

### 3.2 失败重试策略

```
LLM 输出
  ├─ 通过 zod 校验 ✅ → 执行
  ├─ 校验失败（格式错）→ 重试（最多 2 次，附上错误信息让 LLM 修正）
  ├─ 重试仍失败 → 回退 idle（原地发呆 + 内心独白："我一时不知该怎么办"）
  └─ action 不在可用列表 → 同上重试
```

### 3.3 为什么不用 MCP / function calling 作为主通道

| 方案 | 适合 | 我们怎么用 |
|---|---|---|
| **function calling** | LLM 主动"查询/调用"世界 API | ✅ 用。但只允许**只读工具**（`get_inventory`/`get_relationship`/`get_nearby`），**禁止任何写工具** |
| **response_format JSON** | 强制输出结构 | ✅ 用。作为决策主通道 |
| **MCP** | 外部系统集成（文件/数据库/浏览器） | ⚠️ 游戏内部不用 MCP。MCP 是给"Agent 连外部世界"的，游戏世界本身就是 Agent 的 MCP——我们直接暴露只读函数即可 |

设计原则：**给 LLM 的"眼睛"是只读感知函数，给 LLM 的"手"是唯一的决策输出通道（action + 参数）。** 它不能绕过规则引擎做任何事。

---

## 四、模型如何"知道"后果：记忆反馈回路（不是训练）

### 4.1 核心机制：后果 → 记忆 → 下次决策可见

```
tick 10: 三指决定 steal 商人的钱
         ↓
         规则引擎计算后果：
           wealth +0.08, safety -0.05
           商人.trust -20, 商人.resentment +25
           crimeLevel +2, wantedLevel +3
         ↓
         后果被封装成记忆写入：
         "我偷了商人的钱，商人生气了，我的通缉度上升了。"
         "商人对我的信任下降了很多。"
         ↓
tick 12: 三指再次决策时，LLM 上下文里出现这些记忆
         → LLM 读到"后果" → 调整策略：
           更隐蔽 / 躲起来 / 贿赂捕头 / 换个目标
```

**这就是"让模型清楚后果"的实现方式——不是训练，是让它在游戏里"经历"后果并记住。**

### 4.2 为什么模型"本来就懂"后果

LLM 的训练数据里包含大量世界常识：

- 偷钱被抓会坐牢（它知道）
- 抢劫会让人恨你（它知道）
- 贿赂官员可能有用但会留下把柄（它知道）

**所以我们不需要教它"偷钱是坏事"**——我们只需要让它在**这个具体的县城、这些具体的人、这个具体的处境**里，知道"我上次那么做，结果是这样的"。这正是记忆反馈提供的。

### 4.3 记忆反馈的三种强度（从弱到强）

| 机制 | 做法 | 效果 | 何时做 |
|---|---|---|---|
| ① 事件记忆 | 后果 → 存为普通记忆 | LLM 能看到上次发生了什么 | **Phase 5 就要** |
| ② 策略记忆 | 存"情况X→我做Y→结果Z" | 下次遇到类似情况优先参考 | Phase 8 之后 |
| ③ 反思摘要 | 每天结束，LLM 总结"今天学到了什么" | 浓缩经验，跨天生效 | Phase 8 之后 |

### 4.4 记忆的存储结构

```typescript
interface Memory {
  id: string;
  characterId: string;
  tick: number;              // 发生时间
  text: string;              // 记忆内容（自然语言）
  type: "event" | "relationship" | "promise" | "emotion" | "info" | "strategy";
  importance: number;        // 0-1，规则引擎打分（重大事件更高）
  credibility: number;       // 可信度（听说的谣言 < 亲眼所见）
  relatedCharacterIds: string[];
  tags: string[];            // 检索用关键词
  // 策略记忆特有
  strategy?: { situation: string; action: string; outcome: string };
}
```

### 4.5 检索策略（决定哪些记忆进上下文）

```typescript
function retrieve(characterId, query, world): Memory[] {
  return memoryStore.list(characterId)
    .filter(m => world.tick - m.tick < MEMORY_TTL_TICKS)   // 时间新鲜度
    .sort((a, b) =>
      relevanceScore(a, query) * 0.5 +
      a.importance * 0.3 +
      freshness(a, world.tick) * 0.2
    )
    .slice(0, MAX_MEMORIES);   // 最多 8 条
}
```

---

## 五、关于"训练模型"（微调 / RL / RLHF）—— 明确结论

### 5.1 我们不做，以及为什么

| 方案 | 成本 | 问题 | 结论 |
|---|---|---|---|
| 微调（fine-tune） | 高（数据+算力） | 锁死行为、杀死涌现、每次改规则要重训 | ❌ |
| RLHF / RL | 极高 | 需要奖励函数，而"好的故事"无法定义奖励 | ❌ |
| **上下文学习（记忆反馈）** | 极低 | 模型不更新，但经验积累，行为演化 | ✅ **就用这个** |

### 5.2 深度解释：为什么微调会杀死你要的东西

你要的是"开放世界，允许做好事也允许做坏事，让模型清楚后果"。

- **微调** = 把"正确行为"编码进权重 → 模型被框死在训练分布里 → 涌现消失
- **RLHF** = 需要定义"什么是好" → 但你不想定义好坏（你允许坏事）
- **记忆反馈** = 不定义好坏，只让模型**看到后果** → 它自己权衡利弊 → 保留全部自由度

举个具体例子：

```
微调后的模型（假设教它"不该偷"）：
  三指永远不偷 → 故事死了

记忆反馈的模型：
  三指第一次偷 → 记忆："被捕风险 +3，商人恨我"
  三指判断：值吗？
    · 如果值（急着跑路）→ 继续偷但更隐蔽
    · 如果不值（风险太高）→ 改行做点别的
  每种选择都可能 → 涌现保留
```

### 5.3 什么时候才需要碰训练（远期）

如果未来发现"LLM 无论如何都无法理解某种因果"（极少见），可以考虑：
- **LoRA 微调**（低成本微调）——但只在积累了足够的"高质量决策数据"之后
- 或者换更强的模型
- 大部分情况下，问题可以通过**更好的记忆检索 / 更好的 prompt / 更细的规则反馈**解决

**MVP 阶段：完全不需要训练。** 省下的精力放在"后果反馈写得好不好"上——这才是决定模型行为质量的地方。

---

## 六、一个完整 tick 的代码级时序

```typescript
// engine.ts
async function tick(world: World) {
  world.tick += 1;
  world.time = advanceTime(world.time);        // 08:00 → 08:15

  // 1. 世界公共状态自然演化
  worldStateManager.tick(world);               // 粮价浮动、治安回归等

  // 2. 遍历每个角色（串行处理，避免写冲突）
  for (const character of world.characters) {
    if (isDetained(character)) continue;       // 被关押的角色不决策

    // a. 感知
    const perception = perceiver.perceive(character, world);

    // b. 决策（LLM）
    const decision = await decisionMaker.decide(character, world, perception);

    // c. 执行（规则引擎）
    const event = await rules.execute(decision, character, world);

    // d. 应用变化 + 传播
    applyEvent(event, world);
    knowledge.spread(event, world);

    // e. 目标检查
    goalManager.checkCompletion(character, world);
  }

  // 3. 每日结束处理
  if (isEndOfDay(world.time)) {
    worldStateManager.endOfDay(world);
    goalManager.dailyReflection(world);        // 每天反思（可选）
  }

  // 4. 持久化
  store.saveSnapshot(world);
}
```

---

## 七、MCP 的正确位置（澄清）

你提到"MCP 可能会输出一大堆文字"——这里要澄清：

**MCP 是给"AI Agent 连接外部世界"的协议（文件系统、数据库、浏览器、企业内部系统）。**
它解决的问题是：**LLM 无法直接访问现实世界的工具。**

但我们的游戏世界**本身就是数字世界**——LLM 不需要通过 MCP 去"连"它，因为我们直接把状态渲染进上下文了（第一节）。

我们的"MCP"其实是：

```typescript
// 只读工具（可选的"眼睛"，让 LLM 主动查询更细的信息）
const READ_ONLY_TOOLS = {
  get_inventory: (characterId) => world.characters[characterId].inventory,
  get_relationship: (charA, charB) => world.characters[charA].relationships[charB],
  get_nearby: (locationId) => world.characters.filter(c => c.location === locationId),
  get_public_state: () => world.state,
  check_legality: (action, targetId) => rules.checkLegality(action, targetId),
};

// 决策输出 = 唯一的"手"
// LLM 只能通过输出 { action, targetId, parameters } 来改变世界
```

如果你未来想让**玩家**用自然语言和游戏交互（"把县令骗出来"），那才需要一层"意图解析"（LLM 把自然语言 → ActionDecision）。这也是 Phase 7 玩家功能的一部分。

---

## 八、后续各阶段对应的技术重点

| 阶段 | 本节对应实现 |
|---|---|
| Phase 1 | types.ts 完整类型 |
| Phase 2 | rules/execute.ts（规则引擎唯一写入者） |
| Phase 3 | perceiver + knowledge（感知层 + 信息边界） |
| Phase 4 | drive + goal（驱动力/目标 + 完成检测） |
| Phase 5 | 本节的"三层上下文" + "JSON Schema 约束" + "记忆反馈回路" |
| Phase 6 | relationship（关系变化表） |
| Phase 7 | api + 前端（展示本节的 snapshot） |
| Phase 8 | 反思摘要 + 策略记忆（可选） |