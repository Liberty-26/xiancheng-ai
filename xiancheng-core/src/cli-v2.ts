// ============================================================
// 清河县 · v2 状态驱动引擎入口（CLI 演示版）
// ============================================================

import { SimulationEngineV2 } from './engine-v2';

async function main() {
  // 支持 --test 模式（无 LLM）
  const useLlm = !process.argv.includes('--test');
  const engine = new SimulationEngineV2({ useLlm });
  console.log('=== 清河县 v2（状态驱动）===');
  console.log(`决策模式: ${engine.usesLlm ? 'LLM' : '测试'}\n`);

  // 初始化所有 NPC 的初始状态（LLM 生成）
  console.log('--- 生成初始状态 ---');
  for (const [, c] of engine.world.characters) {
    if (!c.isAlive || c.isDetained) continue;
    if (!c.npcState) {
      await (engine as any).reflector.generateInitialState(c, engine.world);
      const s = c.npcState!;
      console.log(`  ${c.name}：目标="${s.goal.slice(0, 30)}" 规划[${s.plan.map(p => p.action).join(',')}]`);
    }
  }

  console.log('\n--- 模拟运行（每 2 秒推进一个行动）---\n');
  const SIGINT = () => {
    console.log('\n模拟停止');
    engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', SIGINT);

  // 持续运行
  while (true) {
    await engine.advanceOneAction();
    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(err => {
  console.error('出错:', err);
  process.exit(1);
});
