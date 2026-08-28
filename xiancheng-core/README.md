# 清河县 · AI 社会模拟器（XianCheng Core）

一个中国古代县城的社会模拟器：7 个 AI 驱动的 NPC（县令/捕头/商人/市民×2/小偷/玩家）在同一县城里自主生活——做决策、对话、建立关系、犯罪、执法、交易、组建组织，涌现出无人预先写好的故事。

> **核心哲学：LLM 决定"想做什么"，规则引擎决定"现实允许发生什么"。**

## ✨ 已实现的功能

### 8 个阶段全部完成

| 阶段 | 内容 |
|---|---|
| Phase 1 | 数据模型：Character/Goal/Event/World 全类型 + 7 角色初始数据 |
| Phase 2 | 规则引擎：15 个社会动作 + 成功率公式 + 合法性检查 + 事件系统 |
| Phase 3 | 感知 + 信息传播：信息边界 + 谣言递减 + 八卦扩散 |
| Phase 4 | Drive + Goal：5 驱动力 + 目标生成/完成检测/生命周期 |
| Phase 5 | LLM 决策管道：三层上下文 + JSON 结构化输出 + 记忆反馈回路 |
| Phase 6 | 关系系统：6 维关系 + 事件驱动 + 关系联动 |
| Phase 7 | API + 前端：浏览器仪表盘 + 玩家操作面板 |
| Phase 8 | 涌现验证：链式反应 + 重复运行涌现性 |

### 涌现案例（已验证）
- 三指偷粮 → 通缉上升 → 商人举报 → 捕头调查 → 三指目标从"搞钱"变成"保安全"
- 商人被勒索 → 恐惧/怨恨上升 → 选择举报或雇佣保镖
- 同一开局重复运行 → 三次故事明显不同

## 🚀 快速开始

```bash
cd xiancheng-core
npm install
cp .env.example .env   # 填入 LLM API key（支持硅基流动/DeepSeek/Qwen）
npm start              # 打开 http://localhost:3300
```

## 🎮 怎么玩

打开 http://localhost:3300：
- **推进一 tick** / **自动运行**：让世界自己跑
- **角色卡片**：看每个角色的驱动力/目标/位置
- **点击角色**：看详情（关系矩阵/最近记忆）
- **玩家面板**：给钱/偷窃/威胁/行贿/买卖/举报——你的每个动作都真实改变世界

## 🧠 核心架构

```
SimulationEngine (tick 循环)
 ├─ Perceiver    → 角色能看到什么（信息边界）
 ├─ DecisionMaker → LLM 决策（三层上下文 + JSON 约束）
 ├─ ActionExecutor → 规则引擎执行（唯一能改状态的地方）
 ├─ DriveSystem   → 5 驱动力（事件驱动 + 自然衰减）
 ├─ GoalManager   → 目标（LLM 生成/完成检测）
 ├─ Relationship  → 6 维关系（事件驱动 + 联动）
 ├─ Knowledge     → 信息传播（谁知道什么）
 └─ MemorySystem  → 记忆反馈回路（后果→记忆→下次决策可见）
```

## 📄 设计文档

- `../ARCHITECTURE.md` — 系统架构 + Agent 思维模型
- `../TECHNICAL-DESIGN.md` — 技术实现细节
- `../phase-01~08.md` — 每个阶段的完整代码与验收标准

## 🔧 常用命令

```bash
npm start                    # 启动服务器 (http://localhost:3300)
npx tsx scripts/p2-acceptance.ts   # Phase 2 规则引擎验收
npx tsx scripts/p3-acceptance.ts   # Phase 3 信息传播验收
npx tsx scripts/p4-acceptance.ts   # Phase 4 Drive/Goal 验收
npx tsx scripts/p6-acceptance.ts   # Phase 6 关系系统验收
npx tsx scripts/test-emergence.ts  # Phase 8 涌现验证
```

## 📝 说明

- **LLM 降级**：API 余额不足/不可用时自动切换到测试决策（有熔断机制，充值后自动恢复）
- **端口**：默认 3300（可用 `PORT=xxxx npm start` 修改）
- **模型**：默认 `Qwen/Qwen3-8B`（硅基流动），支持任意 OpenAI 兼容模型
