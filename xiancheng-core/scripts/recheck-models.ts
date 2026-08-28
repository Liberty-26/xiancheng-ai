async function testModel(model: string) {
  process.env.SIMULATION_MODEL = model;
  const { LLMClient } = await import('../src/llm/client');
  const llm = new LLMClient();
  const start = Date.now();
  try {
    const res = await llm.chat([
      { role: 'system', content: '输出JSON。' },
      { role: 'user', content: '{"action":"idle"}' },
    ], { temperature: 0.3, maxTokens: 100 });
    console.log(`${model}: ${((Date.now()-start)/1000).toFixed(1)}s ✅ — ${res.slice(0,60)}`);
  } catch (e: any) {
    console.log(`${model}: ${((Date.now()-start)/1000).toFixed(1)}s ❌ — ${e.message.slice(0,90)}`);
  }
}

async function main() {
  // 候选：可能有免费额度的模型
  await testModel('deepseek-ai/DeepSeek-R1-0528-Qwen3-8B');  // 之前能用
  await testModel('deepseek-ai/DeepSeek-V3');                // 之前能跑
  await testModel('Qwen/Qwen3-14B');                         // 现在报余额不足
  await testModel('Qwen/Qwen3-8B');
  await testModel('deepseek-ai/DeepSeek-V3-0324');
  await testModel('Pro/deepseek-ai/DeepSeek-V3');
}
main().catch(console.error);
