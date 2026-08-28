// Phase 6 验收测试：关系系统
import { SimulationEngine } from '../src/engine';
import { execute } from '../src/rules/executors';
import { applyRelationshipWitnessEffects, applyRelationshipCouplings, RELATIONSHIP_EFFECTS } from '../src/relationship';

const engine = new SimulationEngine();
const world = engine.world;

function run(decision: Parameters<typeof execute>[0], actor: Parameters<typeof execute>[1]) {
  const event = execute(decision, actor, world);
  engine.applyEvent(event);
  world.events.push(event);
  return event;
}

const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;
const butou = world.characters.get('char_butou')!;
const citizen = world.characters.get('char_shimin_jia')!;

// ── 测试1：偷窃 → 商人对小偷关系恶化 ──
console.log('=== 测试1: 偷窃 → 关系恶化 ===');
// 重置关系
merchant.relationships.set('char_xiaotou', { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 });
thief.locationId = 'shop';
merchant.locationId = 'shop';

const stealEvent = run({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief);
const rel = merchant.relationships.get('char_xiaotou')!;
console.log(`  偷窃后 商人对小偷: trust=${rel.trust} affinity=${rel.affinity} fear=${rel.fear} resentment=${rel.resentment}`);
console.log(`  trust < 0: ${rel.trust < 0}（应 true）`);
console.log(`  resentment > 0: ${rel.resentment > 0}（应 true）`);
const stealOk = rel.trust < 0 && rel.resentment > 0;

// ── 测试2：目击者关系变化 ──
console.log('\n=== 测试2: 目击者对偷窃者的警惕 ===');
thief.locationId = 'market';
merchant.locationId = 'market';
citizen.locationId = 'market';
const witness = world.characters.get('char_shimin_jia')!;
witness.relationships.set('char_xiaotou', { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 });

const stealEvent2 = run({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 10 } }, thief);
const witnessChanges = applyRelationshipWitnessEffects(stealEvent2, world);
const witnessRel = witness.relationships.get('char_xiaotou')!;
console.log(`  目击者(市民甲)对偷窃者 trust: ${witnessRel.trust}（应 < 0）`);
const witnessOk = witnessRel.trust < 0;

// ── 测试3：给钱 → 好感/信任上升 ──
console.log('\n=== 测试3: 给钱 → 好感上升 ===');
const player = world.characters.get('char_player')!;
player.relationships.set('char_shangren', { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 });
const giveEvent = run({ action: 'give_money', targetId: 'char_player', parameters: { amount: 10 } }, merchant);
const playerRel = player.relationships.get('char_shangren')!;
console.log(`  玩家对商人: trust=${playerRel.trust} affinity=${playerRel.affinity}（应 > 0）`);
const giveOk = playerRel.trust > 0 && playerRel.affinity > 0;

// ── 测试4：威胁 → 怨恨上升（成功时恐惧也上升）──
console.log('\n=== 测试4: 威胁 → 怨恨/恐惧 ===');
citizen.relationships.set('char_xiaotou', { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 });
thief.locationId = 'market';
citizen.locationId = 'market';
// 提高威胁成功率（三指威慑 + 市民低抵抗）
(thief as any).skills.intimidation = 9;
const threatEvent = run({ action: 'threaten', targetId: 'char_shimin_jia', parameters: { amount: 5 } }, thief);
const citizenRel = citizen.relationships.get('char_xiaotou')!;
console.log(`  威胁${threatEvent.success ? '成功' : '失败'}: 市民对小偷 fear=${citizenRel.fear} resentment=${citizenRel.resentment}`);
console.log(`  resentment > 0: ${citizenRel.resentment > 0}（应 true，两个分支都有）`);
const threatOk = citizenRel.resentment > 0;

// ── 测试5：关系联动 ──
console.log('\n=== 测试5: 关系联动（恐惧→信任）===');
const xianling = world.characters.get('char_xianling')!;
xianling.relationships.set('char_butou', { trust: 50, affinity: 50, fear: 80, respect: 50, loyalty: 50, resentment: 0 });
applyRelationshipCouplings(xianling);
const couplingRel = xianling.relationships.get('char_butou')!;
console.log(`  恐惧80时 trust: ${couplingRel.trust}（应 < 50，联动下降）`);
const couplingOk = couplingRel.trust < 50;

// ── 测试6：关系表完整性 ──
console.log('\n=== 测试6: 关系规则表完整性 ===');
const actionTypes = ['steal', 'arrest', 'release', 'give_money', 'bribe', 'threaten', 'hire', 'report_crime', 'talk', 'demand_money', 'buy', 'sell'];
const missing = actionTypes.filter(a => !RELATIONSHIP_EFFECTS[a]);
console.log(`  缺失的关系规则: ${missing.join(',') || '(无)'}`);
const tableOk = missing.length === 0;

// ── 汇总 ──
console.log('\n========== 验收结果 ==========');
const checks = [
  ['测试1 偷窃→关系恶化', stealOk],
  ['测试2 目击者警惕', witnessOk],
  ['测试3 给钱→好感上升', giveOk],
  ['测试4 威胁→恐惧上升', threatOk],
  ['测试5 关系联动', couplingOk],
  ['测试6 关系表完整', tableOk],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (ok) pass++;
}
console.log(`\n通过 ${pass}/${checks.length}`);
if (pass === checks.length) {
  console.log('✅ 全部通过 — Phase 6 验收 PASS');
} else {
  console.log('❌ 有未通过项');
}
