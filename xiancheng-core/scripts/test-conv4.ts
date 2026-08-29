import { LLMClient } from '../src/llm/client';
async function main() {
  const llm = new LLMClient();
  // 仅1轮对话验证
  const ctxA: any[] = [{ role: 'system', content: '你是三指，小偷。一句话。' }, { role: 'user', content: '向商人借钱，一句话。' }];
  const ctxB: any[] = [{ role: 'system', content: '你是商人陈富贵。一句话。' }];
  const resA = await llm.chat(ctxA, { temperature: 0.7, maxTokens: 50 });
  console.log('三指:', resA.slice(0, 60));
  ctxB.push({ role: 'user', content: `三指说"${resA.slice(0, 80)}"你怎么回？` });
  const resB = await llm.chat(ctxB, { temperature: 0.7, maxTokens: 50 });
  console.log('陈富贵:', resB.slice(0, 60));
  console.log('✅ 一輪對話成功');
}
main().catch(e => console.error('FAIL:', e.message));
