import { LLMClient } from '../src/llm/client';

async function testModel(model: string) {
  // 临时覆盖模型
  process.env.SIMULATION_MODEL = model;
  const llm = new LLMClient();
  const start = Date.now();
  try {
    const res = await llm.chat([
      { role: 'system', content: '你是一个角色决策助手。输出JSON。' },
      { role: 'user', content: '{"action":"idle"}' },
    ], { temperature: 0.3, maxTokens: 100 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${model}: ${elapsed}s — ${res.slice(0, 80)}`);
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${model}: ${elapsed}s — FAIL ${e.message.slice(0, 60)}`);
  }
}

async function main() {
  // 恢复原模型
  process.env.SIMULATION_MODEL = 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
  console.log('--- 基准: R1 (当前) ---');
  await testModel('deepseek-ai/DeepSeek-R1-0528-Qwen3-8B');

  console.log('--- 快速模型测试 ---');
  // 快速模型候选
  await testModel('deepseek-ai/DeepSeek-V3');
  await testModel('deepseek-ai/DeepSeek-V2.5');
  await testModel('Qwen/Qwen3-8B');
  await testModel('Qwen/Qwen3-14B');
  await testModel('Qwen/Qwen3-72B');
  await testModel('THUDM/glm-4-9b-chat');
  await testModel('Pro/Qwen3-8B');
  await testModel('Pro/deepseek-ai/DeepSeek-V3');
}

main().catch(console.error);
