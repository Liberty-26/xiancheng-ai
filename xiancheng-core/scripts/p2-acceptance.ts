// Phase 2 验收测试（通过 engine 应用状态变化）
import { SimulationEngine } from '../src/engine';
import { execute } from '../src/rules/executors';

const engine = new SimulationEngine();
const world = engine.world;
const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;
const butou = world.characters.get('char_butou')!;
const xianling = world.characters.get('char_xianling')!;
const citizen = world.characters.get('char_shimin_jia')!;
const player = world.characters.get('char_player')!;

function run(decision: Parameters<typeof execute>[0], actor: Parameters<typeof execute>[1]) {
  const event = execute(decision, actor, world);
  engine.applyEvent(event);   // 应用状态变化
  world.events.push(event);
  return event;
}

// 测试1：偷窃（把三指放到商铺，保证成功率合理）
thief.locationId = 'shop';
merchant.locationId = 'shop';
console.log('=== 测试1: 三指偷商人 ===');
let succ = 0;
for (let i = 0; i < 20; i++) {
  const e = run({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 20 } }, thief);
  if (e.success) succ++;
}
const last = run({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief);
console.log(`  成功 ${succ}/20 | 最后事件: ${last.description}`);
console.log(`  商人钱: ${merchant.money} | 小偷钱: ${thief.money} | 通缉: ${thief.wantedLevel}`);
console.log('  商人对小偷关系:', JSON.stringify(merchant.relationships.get('char_xiaotou')));

// 测试2：权限检查（市民不能逮捕）
console.log('\n=== 测试2: 市民尝试逮捕（应被拒绝）===');
const citizenArrest = run({ action: 'arrest', targetId: 'char_xiaotou' }, citizen);
console.log(`  市民逮捕: ${citizenArrest.description} | 成功: ${citizenArrest.success}`);
console.log(`  三指被关押: ${thief.isDetained}（应 false）`);

// 测试3：捕头逮捕
console.log('\n=== 测试3: 捕头逮捕三指 ===');
const arrest = run({ action: 'arrest', targetId: 'char_xiaotou' }, butou);
console.log(`  捕头逮捕: ${arrest.description} | 成功: ${arrest.success}`);
console.log(`  三指被关押: ${thief.isDetained}（应 true）`);
const arrestOk = arrest.success === true && thief.isDetained === true;

// 测试4：县令释放
console.log('\n=== 测试4: 县令释放三指 ===');
const release = run({ action: 'release', targetId: 'char_xiaotou' }, xianling);
console.log(`  县令释放: ${release.description} | 成功: ${release.success}`);
console.log(`  三指被释放: ${!thief.isDetained}（应 true）`);
const releaseOk = release.success === true && thief.isDetained === false;

// 测试5：非法动作
console.log('\n=== 测试5: 非法动作 ===');
const bad = run({ action: 'fly_to_moon' as never, targetId: undefined }, thief);
console.log(`  非法动作: ${bad.description} | 成功: ${bad.success}（应 false）`);

// 测试6：买卖
console.log('\n=== 测试6: 买卖 ===');
const buy = run({ action: 'buy', parameters: { itemId: 'grain', quantity: 5 } }, merchant);
console.log(`  商人买粮: ${buy.description}`);
const sell = run({ action: 'sell', parameters: { itemId: 'cloth', quantity: 2 } }, merchant);
console.log(`  商人卖布: ${sell.description}`);
console.log(`  商人库存: ${JSON.stringify(merchant.inventory)}`);

// 测试7：给钱 + 威胁
console.log('\n=== 测试7: 给钱/威胁 ===');
const give = run({ action: 'give_money', targetId: 'char_player', parameters: { amount: 10 } }, merchant);
console.log(`  给钱: ${give.description} | 玩家钱: ${player.money}（应 60）`);
const threat = run({ action: 'threaten', targetId: 'char_shimin_jia', parameters: { amount: 5 } }, thief);
const citizen2 = world.characters.get('char_shimin_jia')!;
console.log(`  威胁: ${threat.description} | 市民钱: ${citizen2.money}`);

// 测试8：加入/退出组织
console.log('\n=== 测试8: 加入/退出组织 ===');
const join = run({ action: 'join_faction', parameters: { factionId: 'faction_shanghui' } }, merchant);
console.log(`  商人加入商行: ${join.description} | factionId: ${merchant.factionId}（应 faction_shanghui）`);
console.log(`  商行成员: ${world.factions.get('faction_shanghui')?.members.join(',')}`);
const leave = run({ action: 'leave_faction' }, merchant);
console.log(`  商人退出商行: ${leave.description} | factionId: ${merchant.factionId}（应 null）`);

// 测试9：目击者记录
console.log('\n=== 测试9: 目击者 ===');
thief.locationId = 'market';
citizen2.locationId = 'market';
const publicEvent = run({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 10 } }, thief);
console.log(`  事件目击者: ${publicEvent.witnesses.join(',') || '(无人)'}（应含 char_shimin_jia）`);

// 测试10：世界状态联动
console.log('\n=== 测试10: 世界状态 ===');
console.log(`  治安: ${world.state.security}（应 < 65）| 犯罪: ${world.state.crimeLevel}（应 > 20）`);

// 总结
console.log('\n========== 验收结果 ==========');
const checks = [
  ['测试1 偷窃改变状态', merchant.money < 500 && thief.money > 10],
  ['测试1 通缉上升', thief.wantedLevel > 0],
  ['测试1 关系恶化', (merchant.relationships.get('char_xiaotou')?.trust ?? 0) < -60],
  ['测试2 市民无执法权', citizenArrest.success === false],
  ['测试3 捕头逮捕成功', arrestOk],
  ['测试4 县令释放成功', releaseOk],
  ['测试5 非法动作拒绝', bad.success === false],
  ['测试6 买卖生效', merchant.inventory.some(i => i.itemId === 'grain' && i.quantity >= 5)],
  ['测试7 给钱生效', player.money === 60],
  ['测试8 加入组织生效', world.factions.get('faction_shanghui')?.members.includes('char_shangren') === false && merchant.factionId === null],
  ['测试9 目击者记录', publicEvent.witnesses.includes('char_shimin_jia')],
  ['测试10 世界状态联动', world.state.security < 65 && world.state.crimeLevel > 20],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (ok) pass++;
}
console.log(`\n通过 ${pass}/${checks.length}`);
if (pass === checks.length) {
  console.log('✅ 全部通过 — Phase 2 验收 PASS');
} else {
  console.log('❌ 有未通过项 — 需要修复');
}
