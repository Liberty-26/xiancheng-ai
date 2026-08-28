import { LLMClient } from '../src/llm/client';

async function main() {
  const llm = new LLMClient();
  const start = Date.now();
  const res = await llm.chat([
    { role: 'system', content: '输出 JSON。' },
    { role: 'user', content: '{"action":"idle"}' },
  ], { temperature: 0.3, maxTokens: 200 });
  console.log('耗时:', ((Date.now() - start) / 1000).toFixed(1) + 's');
  console.log('响应:', res.slice(0, 150));
}

main().catch(e => console.error('FAIL:', e.message));
