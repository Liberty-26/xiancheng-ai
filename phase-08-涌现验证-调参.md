# Phase 8：涌现验证 + 调参

> 目标：验证系统能否产生非预设的涌现故事，调优参数
>
> 预计时间：3-4 小时（持续迭代）
>
> 前置依赖：Phase 1-7 全部完成

---

## 8.1 创建的所有文件

```
scripts/
├── test-emergence.ts    # 涌现测试脚本
└── tune-params.ts       # 参数扫描工具
```

---

## 8.2 核心验证目标

我们要验证的不是"游戏能跑"，而是：

> **同样开局，重复跑会产生不同的故事；角色会因为状态和记忆改变行为；一个事件会连锁影响一圈人。**

如果每次跑都走向同一个结局，说明还是脚本游戏，只是套了 LLM。

---

## 8.3 验收场景（4 个核心场景）

### 场景 1：三指偷粮（基础涌现）

**初始条件**：三指在仓库独处，仓库有粮食

**预期链**：
```
三指缺钱（wealth 低）→ LLM 自主决定偷粮
  → 偷窃成功/失败（规则判定）
  → 产生犯罪记录、通缉度上升
  → 市民/捕头听说（信息传播）
  → 捕头开始调查三指
  → 县令警觉"仓库有动静"
  → 三指 safety 下降 → 生成新 Goal（跑路/贿赂）
```

**验证方法**：
```bash
cd xiancheng-core
npx tsx scripts/test-emergence.ts --scenario steal-grain
```

**通过条件**：
- [ ] 三指主动选择偷窃（不是预设的）
- [ ] 偷窃后通缉度上升
- [ ] 至少 1 个其他角色听说此事
- [ ] 捕头后续决策里出现"调查/警惕三指"
- [ ] 三指的 Goal 因安全下降而变化

---

### 场景 2：玩家挑拨

**初始条件**：玩家在县城自由活动，可以对县令/捕头说话

**预期链**：
```
玩家对捕头说："县令说你办事不力，想撤你的职"
  → 捕头对县令的 loyalty 下降
  → 捕头的信任/关系变化
  → 捕头重新评估对县令的态度
  → 可能：更卖力表现 / 暗中找靠山 / 开始收集县令把柄
```

**验证方法**：
```bash
npx tsx scripts/test-emergence.ts --scenario provoke
```

**通过条件**：
- [ ] 捕头对县令的 loyalty 因玩家的话下降
- [ ] 捕头的行为发生可观察的变化
- [ ] 没有预设"政变支线"，但可能自然发生

---

### 场景 3：商人受威胁

**初始条件**：三指向商人敲诈

**预期链**：
```
三指 threaten 商人
  → 商人 fear 上升
  → 商人根据人格/关系/处境做选择：
     胆小 → 交钱
     胆大 → 报官
     精明 → 雇佣保镖 / 联合其他商人
  → 选择不同 → 后续完全不同
```

**验证方法**：
```bash
npx tsx scripts/test-emergence.ts --scenario extort
```

**通过条件**：
- [ ] 同一初始条件，商人可能做出不同反应（多次运行对比）
- [ ] 商人的反应符合他的人格/关系/处境
- [ ] 不同反应导致不同后续（报官→通缉上升；交钱→没钱；雇佣→关系变化）

---

### 场景 4：重复运行同一开局

**验证涌现性**（最重要的测试）

```bash
# 跑 3 次，各 100 tick，对比事件序列
npx tsx scripts/test-emergence.ts --scenario repeat --runs 3 --ticks 100
```

**通过条件**：
- [ ] 三次运行的事件序列明显不同
- [ ] 三次运行的角色关系变化不同
- [ ] 三次运行的最终世界状态不同
- [ ] 至少 2 次出现了"非平凡故事"（不是大家都发呆）

---

## 8.4 test-emergence.ts —— 测试脚本

```typescript
import { SimulationEngine } from '../src/engine';
import { execute as executeAction } from '../src/rules';
import { createInitialWorld } from '../src/data/world';
import { ActionDecision } from '../src/types';

async function runScenario(name: string, ticks: number, setup?: (engine: SimulationEngine) => void) {
  const engine = new SimulationEngine();
  if (setup) setup(engine);

  console.log(`\n=== 场景: ${name} ===`);
  const story: string[] = [];

  for (let i = 0; i < ticks; i++) {
    // 在特定 tick 注入玩家动作
    await engine.tickOnce();
    // 收集关键事件
    const recent = engine.world.events.slice(-3);
    for (const e of recent) {
      story.push(`[t${e.tick}] ${e.success ? '✅' : '❌'} ${e.description}`);
    }
  }

  // 输出故事摘要
  console.log(story.slice(0, 50).join('\n'));
  return engine;
}

// 场景 1：三指偷粮
async function scenarioStealGrain() {
  await runScenario('三指偷粮', 30, (engine) => {
    const thief = engine.world.characters.get('char_xiaotou')!;
    thief.locationId = 'warehouse';   // 仓库独处
    thief.drives.wealth = 0.2;        // 很缺钱
    // 确保仓库有粮
    engine.world.state.grainReserve = 300;
  });
}

// 场景 2：玩家挑拨
async function scenarioProvoke() {
  const engine = await runScenario('玩家挑拨', 10);
  // 玩家对捕头说话
  const player = engine.world.characters.get('char_player')!;
  const decision: ActionDecision = {
    action: 'talk',
    targetId: 'char_butou',
    parameters: { message: '我听说县令赵文远想找个借口撤你的职，说你办事不力还收保护费。' },
  };
  const event = executeAction(decision, player, engine.world);
  engine.applyEventToWorld(event);
  // 继续跑 20 tick 观察变化
  for (let i = 0; i < 20; i++) {
    await engine.tickOnce();
    const rel = engine.world.characters.get('char_butou')!.relationships.get('char_xianling');
    if (i % 5 === 0) {
      console.log(`  tick${i}: 捕头对县令 loyalty = ${rel?.loyalty}`);
    }
  }
}

// 场景 3：商人受威胁
async function scenarioExtort() {
  await runScenario('商人受威胁', 30, (engine) => {
    // 让三指和商人同处一室
    const thief = engine.world.characters.get('char_xiaotou')!;
    const merchant = engine.world.characters.get('char_shangren')!;
    thief.locationId = 'shop';
    merchant.locationId = 'shop';
    // 三指勒索商人
    const decision: ActionDecision = {
      action: 'demand_money',
      targetId: 'char_shangren',
      parameters: { amount: 50 },
    };
    const event = executeAction(decision, thief, engine.world);
    engine.applyEventToWorld(event);
  });
}

// 场景 4：重复运行
async function scenarioRepeat() {
  const runs = 3;
  const results: string[][] = [];
  for (let r = 0; r < runs; r++) {
    const engine = await runScenario(`运行${r + 1}`, 100);
    const sig = engine.world.events.slice(0, 50).map(e => e.type).join(',');
    results.push(sig.split(','));
    console.log(`\n  运行${r + 1} 事件序列前10: ${engine.world.events.slice(0, 10).map(e => e.type).join(' → ')}`);
    console.log(`  最终世界: 治安${engine.world.state.security} 民心${engine.world.state.publicMorale} 犯罪${engine.world.state.crimeLevel}`);
  }

  // 对比不同
  const allSame = results.every(r => JSON.stringify(r) === JSON.stringify(results[0]));
  console.log(`\n${allSame ? '❌ 三次运行完全相同（没有涌现！）' : '✅ 三次运行不同（涌现存在）'}`);
}

// main
const scenario = process.argv.find(a => a.startsWith('--scenario'))?.split('=')[1] ?? 'repeat';
switch (scenario) {
  case 'steal-grain': scenarioStealGrain(); break;
  case 'provoke': scenarioProvoke(); break;
  case 'extort': scenarioExtort(); break;
  case 'repeat': scenarioRepeat(); break;
  default: console.log('用法: --scenario steal-grain|provoke|extort|repeat');
}
```

---

## 8.5 调参清单（tune-params.ts）

```typescript
/**
 * 参数扫描：一次跑多个参数组合，输出对比
 * 用法: npx tsx scripts/tune-params.ts --param driveDecay --values 0.01,0.02,0.05
 */
import { SimulationEngine } from '../src/engine';

// 需要 engine 支持参数注入
// 在 engine 里增加 CONFIG 对象，可被外部覆盖
interface Params {
  driveDecayRate: number;         // Drive 自然衰减率
  goalEvalInterval: number;       // Goal 重评估间隔 tick
  driveChangeThreshold: number;   // Drive 漂移触发阈值
  gossipChance: number;           // 八卦概率
  memoryTTL: number;              // 记忆存活 tick 数
}

const DEFAULT_PARAMS: Params = {
  driveDecayRate: 0.02,
  goalEvalInterval: 5,
  driveChangeThreshold: 0.15,
  gossipChance: 0.1,
  memoryTTL: 100,
};

async function scan() {
  const arg = process.argv.find(a => a.startsWith('--param'));
  const values = process.argv.find(a => a.startsWith('--values'));
  if (!arg || !values) {
    console.log('用法: --param driveDecayRate --values 0.01,0.02,0.05');
    return;
  }
  const param = arg.split('=')[1];
  const valList = values.split('=')[1].split(',');

  for (const v of valList) {
    const params = { ...DEFAULT_PARAMS, [param]: Number(v) };
    console.log(`\n=== 参数 ${param} = ${v} ===`);
    
    const engine = new SimulationEngine();
    engine.applyParams(params);   // engine 需要实现
    for (let i = 0; i < 100; i++) await engine.tickOnce();
    
    console.log(`  事件数: ${engine.world.events.length}`);
    console.log(`  角色平均目标数: ...`);
    console.log(`  治安: ${engine.world.state.security} 犯罪: ${engine.world.state.crimeLevel}`);
  }
}

scan();
```

---

## 8.6 需要重点调参的参数

| 参数 | 默认 | 调什么 | 现象 | 调整方向 |
|---|---|---|---|---|
| `driveDecayRate` | 0.02 | 角色多快"忘掉"需求 | 太快→角色没长期目标；太慢→目标永不更新 | 调到 0.01-0.05 观察 |
| `goalEvalInterval` | 5 | 多久重新评估目标 | 太频繁→目标飘忽；太慢→目标僵化 | 3-8 tick |
| `driveChangeThreshold` | 0.15 | 多大变化触发重评估 | 太大→不触发；太小→频繁 LLM 调用 | 0.1-0.25 |
| `gossipChance` | 0.1 | 消息自然扩散速度 | 太高→全城皆知没秘密；太低→信息不流动 | 0.05-0.2 |
| `memoryTTL` | 100 | 记忆存多久 | 太长→上下文爆；太短→角色健忘 | 50-200 |
| 偷窃成功率系数 | 见 Phase 2 | 犯罪是否太容易/太难 | 太高→人人偷；太低→没人偷 | 按需 |
| 关系变化幅度 | 见 Phase 6 | 一次偷窃伤多少关系 | 太大→一次断交；太小→无感 | -20~-50 试探 |

---

## 8.7 涌现质量评估表

运行 100 tick 后，人工检查：

### Agent 层
- [ ] Agent 有没有主动改变目标？（不是一直一个目标）
- [ ] 有没有产生合理行动？（行为符合人格/状态）
- [ ] 有没有循环行为？（一直做同一件事——需要调）
- [ ] 有没有完全不合理的事？（如商人突然去偷东西——检查人格权重）

### 社会层
- [ ] 信息有没有传播？（有多少角色知道了关键事件）
- [ ] 关系有没有形成？（信任/怨恨在演化）
- [ ] 有没有联盟/敌对？（多角色关系联动）
- [ ] 一个事件有没有影响第三个角色？（链式反应）

### 玩家层（最关键）
- [ ] 玩家能否"利用这个社会系统"？
  - 骗商人说小偷要抢他 → 商人恐慌 → 再去告诉小偷 → 挑拨关系
  - 如果玩家开始**利用 NPC 之间的关系做事**，游戏真正成立

---

## 8.8 常见问题与修复

| 问题 | 可能原因 | 修复 |
|---|---|---|
| 所有角色都发呆 | 决策 prompt 不够具体 / Drive 太低 | 增强 prompt 或调高 drive 基线 |
| 三指从不偷 | 成功率太高风险 / 记忆里被捕太多次 | 降低 penalty 或调 personality |
| 商人每次都报官 | 人格太单一 | 调商人的人格随机性 |
| 世界 50 tick 后死寂 | 目标都完成了没有新目标 | 调低 Goal 完成标准 / 增加动态事件 |
| LLM 输出不稳定 | prompt 太长 / 模型太弱 | 精简 prompt / 换更强模型 |
| 每次结局相同 | 决策太"合理"缺乏随机性 | 调 temperature / 加随机噪音到 Drive |
| 成本太高 | 每 tick 都调 LLM | 加决策冷却 / 减少重试 |

---

## 8.9 调参方法

1. **单参数扫描**：`--param driveDecayRate --values 0.01,0.02,0.05` 跑 100 tick 对比
2. **多参数组合**：手动组合 2-3 个参数交叉验证
3. **人工抽查**：每个参数组合跑完后，人工看事件序列是否符合"剧情"
4. **记录基准**：固定一个"基准场景"，每次改参数后跑一遍对比

---

## 8.10 完成标志（整个项目验收）

- [ ] 场景 1-3 全部能跑出预期链式反应
- [ ] 场景 4 三次运行明显不同（涌现存在）
- [ ] 玩家能通过 API 操作影响世界（挑拨/给钱/行贿）
- [ ] 运行 100 tick 成本 < 2 元
- [ ] 角色行为符合人格（胆小的商人会交保护费，胆大的会报官）
- [ ] 信息在传播（不是全知，也不是完全封闭）
- [ ] 关系在演化（偷窃后商人恨小偷）
- [ ] 目标在更新（三指从"搞钱"变成"跑路"）
