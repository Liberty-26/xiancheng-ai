import { LLMClient } from '../src/llm/client';

async function main() {
  const llm = new LLMClient();
  console.log('configured:', llm.isConfigured);
  console.log('model:', process.env.SIMULATION_MODEL);
  console.log('base:', process.env.SIMULATION_BASE_URL);

  // 简单对话测试
  const res = await llm.chat([
    { role: 'system', content: '你是一个测试助手，只回答"连接成功"。' },
    { role: 'user', content: '你好' },
  ], { temperature: 0.3, maxTokens: 50 });
  console.log('对话响应:', res.slice(0, 100));

  // JSON Schema 测试
  const jsonRes = await llm.chat([
    { role: 'system', content: '输出 JSON，不要多余内容。' },
    { role: 'user', content: '{"action":"steal"}' },
  ], {
    jsonSchema: {
      type: 'object',
      properties: { action: { type: 'string' } },
      required: ['action'],
      additionalProperties: false,
    },
    temperature: 0.2,
    maxTokens: 100,
  });
  console.log('JSON响应:', jsonRes.slice(0, 200));
}

main().catch(e => console.error('FAIL:', e.message));
