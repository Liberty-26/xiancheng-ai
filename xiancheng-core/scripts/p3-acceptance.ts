// Phase 3 验收测试：感知 + 信息传播
import { SimulationEngine } from '../src/engine';
import { execute } from '../src/rules/executors';
import { Knowledge, shareKnowledgeDuringTalk, randomGossip } from '../src/knowledge';
import { Perceiver } from '../src/perceiver';

const engine = new SimulationEngine();
const world = engine.world;
const knowledge = new Knowledge();
world.knowledge = knowledge.getStore();
const perceiver = new Perceiver(world);

const thief = world.characters.get('char_xiaotou')!;
const merchant = world.characters.get('char_shangren')!;
const xianling = world.characters.get('char_xianling')!;
const citizen = world.characters.get('char_shimin_jia')!;
const butou = world.characters.get('char_butou')!;

// 测试1：信息边界——不同位置的角色不知道其他位置的事
console.log('=== 测试1: 信息边界 ===');
thief.locationId = 'hideout';
merchant.locationId = 'shop';
xianling.locationId = 'yamen';

const event = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 30 } }, thief, world);
world.events.push(event);
knowledge.recordEvent(event);

const thiefPerception = perceiver.perceive(thief);
const merchantPerception = perceiver.perceive(merchant);
const xianlingPerception = perceiver.perceive(xianling);

console.log(`  三指知道: ${thiefPerception.knownFacts.length > 0}（应 true）`);
console.log(`  商人知道: ${merchantPerception.knownFacts.length > 0}（应 false）`);
console.log(`  县令知道: ${xianlingPerception.knownFacts.length > 0}（应 false）`);

// 测试2：当面告知传播
console.log('\n=== 测试2: 当面告知 ===');
merchant.locationId = 'hideout';  // 商人来到三指旁边
const shared = shareKnowledgeDuringTalk('char_xiaotou', 'char_shangren', world, knowledge);
console.log(`  三指告诉商人: ${shared.join('、').slice(0, 40)}`);
console.log(`  商人现在知道: ${perceiver.perceive(merchant).knownFacts.length > 0}（应 true）`);

// 测试3：谣言递减传播
console.log('\n=== 测试3: 谣言递减 ===');
xianling.locationId = 'hideout';
// 商人把消息传给县令（二道传播）
const rumorFromMerchant = knowledge.getRumorsFor('char_shangren').slice(-1)[0];
knowledge.spreadRumor('char_shangren', 'char_xianling', rumorFromMerchant);
const xianlingRumors = perceiver.perceive(xianling).recentRumors;
console.log(`  县令听到传言可信度: ${xianlingRumors[0]?.credibility}（应 0.8）`);

// 测试4：目击者自动知道
console.log('\n=== 测试4: 目击者 ===');
citizen.locationId = 'hideout';
const event2 = execute({ action: 'steal', targetId: 'char_shangren', parameters: { amount: 10 } }, thief, world);
world.events.push(event2);
knowledge.recordEvent(event2);
console.log(`  事件目击者: ${event2.witnesses.join(',') || '(无人)'}`);
console.log(`  目击者(市民甲)知道: ${perceiver.perceive(citizen).knownFacts.length > 0}（应 true）`);

// 测试5：八卦传播
console.log('\n=== 测试5: 八卦传播 ===');
let gossipHappened = false;
for (let i = 0; i < 50; i++) {
  const before = Array.from(world.knowledge.rumors.values()).reduce((s, r) => s + r.length, 0);
  randomGossip(world, knowledge, 1.0);  // 强制 100% 概率
  const after = Array.from(world.knowledge.rumors.values()).reduce((s, r) => s + r.length, 0);
  if (after > before) { gossipHappened = true; break; }
}
console.log(`  八卦传播发生: ${gossipHappened}（应 true）`);

// 测试6：感知只返回附近信息
console.log('\n=== 测试6: 感知范围 ===');
butou.locationId = 'yamen';
const butouPerception = perceiver.perceive(butou);
console.log(`  捕头在县衙，附近有: ${butouPerception.nearbyCharacterIds.join(',') || '(无人)'}`);
console.log(`  捕头不知道仓库的事: ${butouPerception.knownFacts.length === 0}（应 true，除非被告知）`);

// 总结
console.log('\n========== 验收结果 ==========');
const checks = [
  ['测试1 三指知道自己的偷窃', thiefPerception.knownFacts.length > 0],
  ['测试1 商人不知道（不同位置）', merchantPerception.knownFacts.length === 0],
  ['测试1 县令不知道（不同位置）', xianlingPerception.knownFacts.length === 0],
  ['测试2 当面告知后商人知道', perceiver.perceive(merchant).knownFacts.length > 0],
  ['测试3 谣言可信度递减到0.8', Math.abs((xianlingRumors[0]?.credibility ?? 0) - 0.8) < 0.01],
  ['测试4 目击者自动知道', perceiver.perceive(citizen).knownFacts.length > 0],
  ['测试5 八卦传播发生', gossipHappened],
  ['测试6 感知范围限制', butouPerception.knownFacts.length === 0],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (ok) pass++;
}
console.log(`\n通过 ${pass}/${checks.length}`);
if (pass === checks.length) {
  console.log('✅ 全部通过 — Phase 3 验收 PASS');
} else {
  console.log('❌ 有未通过项');
}
