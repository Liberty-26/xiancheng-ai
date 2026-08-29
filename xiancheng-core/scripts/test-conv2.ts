import { LLMClient } from '../src/llm/client';

async function main() {
  const llm = new LLMClient();
  console.log('模型:', process.env.SIMULATION_MODEL);

  // 单次调用测试
  const res = await llm.chat([
    { role: 'system', content: '简短回答，10字以内。' },
    { role: 'user', content: '你好' },
  ], { temperature: 0.3, maxTokens: 20 });
  console.log('单次响应:', res);
  console.log('✅ 一次调用成功');
}

main().catch(e => console.error('FAIL:', e.message));
