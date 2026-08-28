// ============================================================
// 清河县 · 涌现验证测试
// Phase 8：涌现验证 + 调参
// ============================================================

import { SimulationEngine } from '../src/engine';
import { execute as executeAction } from '../src/rules';
import { ActionDecision } from '../src/types';

async function runScenario(
  name: string,
  ticks: number,
  setup?: (engine: SimulationEngine) => void,
) {
  const engine = new SimulationEngine({ useLlm: false });  // 测试决策模式跑基础涌现
  if (setup) setup(engine);

  console.log(`\n=== 场景: ${name} ===`);
  const story: string[] = [];

  for (let i = 0; i < ticks; i++) {
    await engine.tickOnce();
    // 收集关键事件
    const recent = engine.world.events.slice(-3);
    for (const e of recent) {
      story.push(`[t${e.tick}] ${e.success ? '✅' : '❌'} ${e.description}`);
    }
  }

  // 输出故事摘要（去重，只显示变化）
  const seen = new Set<string>();
  for (const line of story) {
    if (!seen.has(line) && seen.size < 40) {
      seen.add(line);
      console.log(`  ${line}`);
    }
  }
  return engine;
}

// 场景 1：三指偷粮（基础涌现——链式反应）
async function scenarioStealGrain() {
  const engine = await runScenario('三指偷粮（链式反应）', 25, (e) => {
    const thief = e.world.characters.get('char_xiaotou')!;
    thief.locationId = 'warehouse';
    thief.drives.wealth = 0.2;   // 很缺钱
    e.world.state.grainReserve = 300;
  });

  const thief = engine.world.characters.get('char_xiaotou')!;
  const merchant = engine.world.characters.get('char_shangren')!;
  const events = engine.world.events;

  // 验证链式反应：偷窃 → 通缉 → 商人举报 → 捕头相关
  const hasSteal = events.some(e => e.type === 'steal');
  const hasWanted = thief.wantedLevel > 0;
  const hasReport = events.some(e => e.type === 'report_crime');
  const merchantResent = (merchant.relationships.get('char_xiaotou')?.resentment ?? 0) > 30;
  const hasGoalChange = !thief.currentGoal || thief.currentGoal.description !== '搞钱';

  console.log(`\n  链式反应检查:`);
  console.log(`  - 发生偷窃: ${hasSteal ? '✅' : '❌'}`);
  console.log(`  - 通缉度上升: ${hasWanted ? '✅' : '❌'} (${thief.wantedLevel})`);
  console.log(`  - 商人举报: ${hasReport ? '✅' : '❌'}`);
  console.log(`  - 商人怨恨上升: ${merchantResent ? '✅' : '❌'}`);
  console.log(`  - 三指目标变化: ${hasGoalChange ? '✅' : '❌'} (当前: ${thief.currentGoal?.description ?? '无'})`);

  const pass = hasSteal && hasWanted && hasReport && merchantResent && hasGoalChange;
  console.log(`\n  场景1 结果: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  return pass;
}

// 场景 2：商人受威胁（同一事件不同 NPC 反应）
async function scenarioExtort() {
  const engine = new SimulationEngine({ useLlm: false });
  const world = engine.world;
  const thief = world.characters.get('char_xiaotou')!;
  const merchant = world.characters.get('char_shangren')!;
  thief.locationId = 'shop';
  merchant.locationId = 'shop';

  // 商人初始关系重置（避免历史干扰）
  merchant.relationships.set('char_xiaotou', { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 });

  // 三指勒索商人
  const threat: ActionDecision = {
    action: 'demand_money',
    targetId: 'char_shangren',
    parameters: { amount: 50 },
  };
  const event = executeAction(threat, thief, world);
  engine.applyEvent(event);
  world.events.push(event);
  console.log(`\n=== 场景: 商人受威胁 ===`);
  console.log(`  勒索事件: ${event.description} | 成功: ${event.success}`);

  // 商人反应检查
  const rel = merchant.relationships.get('char_xiaotou')!;
  console.log(`  商人恐惧: ${rel.fear} | 怨恨: ${rel.resentment}`);

  // 再跑几 tick 看商人行为
  let reported = false;
  let hired = false;
  for (let i = 0; i < 15; i++) {
    await engine.tickOnce();
    if (world.events.some(e => e.type === 'report_crime' && e.actorId === 'char_shangren')) reported = true;
    if (world.events.some(e => e.type === 'hire' && e.actorId === 'char_shangren')) hired = true;
  }
  console.log(`  商人选择举报: ${reported ? '✅' : '（未举报）'}`);
  console.log(`  商人选择雇佣: ${hired ? '✅' : '（未雇佣）'}`);
  const reacted = reported || hired || rel.fear > 30;
  console.log(`  商人有反应: ${reacted ? '✅' : '❌'}`);
  console.log(`  场景2 结果: ${reacted ? '✅ PASS' : '❌ FAIL'}`);
  return reacted;
}

// 场景 3：玩家挑拨（关系变化驱动行为变化）
async function scenarioProvoke() {
  const engine = new SimulationEngine({ useLlm: false });
  const world = engine.world;
  const player = world.characters.get('char_player')!;
  const butou = world.characters.get('char_butou')!;
  const xianling = world.characters.get('char_xianling')!;

  const beforeLoyalty = butou.relationships.get('char_xianling')?.loyalty ?? 0;

  // 玩家挑拨捕头和县令
  const talk: ActionDecision = {
    action: 'talk',
    targetId: 'char_butou',
    parameters: { message: '我听说县令想找个借口撤你的职，说你办事不力还收保护费。' },
  };
  const event = executeAction(talk, player, world);
  engine.applyEvent(event);
  world.events.push(event);
  console.log(`\n=== 场景: 玩家挑拨 ===`);
  console.log(`  挑拨: ${event.description}`);

  // 跑几 tick 观察关系变化
  for (let i = 0; i < 10; i++) await engine.tickOnce();

  const afterLoyalty = butou.relationships.get('char_xianling')?.loyalty ?? 0;
  const afterTrust = butou.relationships.get('char_xianling')?.trust ?? 0;
  console.log(`  捕头对县令 loyalty: ${beforeLoyalty} → ${afterLoyalty}`);
  console.log(`  捕头对县令 trust: ${afterTrust}`);
  const changed = afterLoyalty !== beforeLoyalty || afterTrust < 90;
  console.log(`  关系发生变化: ${changed ? '✅' : '❌'}`);
  console.log(`  场景3 结果: ${changed ? '✅ PASS' : '❌ FAIL（说明：talk不直接改关系，需后续LLM叙事）'}`);
  return changed;
}

// 场景 4：重复运行同一开局（涌现性）
async function scenarioRepeat() {
  const runs = 3;
  const signatures: string[] = [];

  console.log(`\n=== 场景: 重复运行（涌现性）===\n`);
  for (let r = 0; r < runs; r++) {
    const engine = new SimulationEngine({ useLlm: false });
    for (let i = 0; i < 60; i++) {
      await engine.tickOnce();
    }
    const sig = engine.world.events.slice(0, 40).map(e => e.type).join(',');
    signatures.push(sig);
    const finalState = engine.world.state;
    console.log(`  运行${r + 1}: 事件序列前10 = ${engine.world.events.slice(0, 10).map(e => e.type).join('→')}`);
    console.log(`          最终 治安${finalState.security} 犯罪${finalState.crimeLevel} 事件数${engine.world.events.length}`);
  }

  const allSame = signatures.every(s => s === signatures[0]);
  console.log(`\n  涌现性: ${allSame ? '❌ 三次完全一致（无涌现）' : '✅ 三次运行不同（涌现存在）'}`);
  console.log(`  场景4 结果: ${allSame ? '❌ FAIL' : '✅ PASS'}`);
  return !allSame;
}

// main
async function main() {
  console.log('══════════════════════════════════════');
  console.log('   清河县 · Phase 8 涌现验证');
  console.log('══════════════════════════════════════\n');

  const results = [
    ['场景1 三指偷粮链式反应', await scenarioStealGrain()],
    ['场景2 商人受威胁反应', await scenarioExtort()],
    ['场景3 玩家挑拨关系变化', await scenarioProvoke()],
    ['场景4 重复运行涌现性', await scenarioRepeat()],
  ];

  console.log('\n══════════════════════════════════════');
  console.log('           验收总结');
  console.log('══════════════════════════════════════');
  let pass = 0;
  for (const [name, ok] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    if (ok) pass++;
  }
  console.log(`\n通过 ${pass}/${results.length}`);
  console.log(pass >= 3
    ? '✅ 涌现验证基本通过 — 系统能产生非预设的链式反应'
    : '❌ 涌现不足 — 需要调参');
}

main().catch((err) => {
  console.error('测试出错:', err);
  process.exit(1);
});
