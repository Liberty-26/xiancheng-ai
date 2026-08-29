import { LLMClient } from '../src/llm/client';
async function main() {
  const llm = new LLMClient();
  const ctxA: any[] = [
    { role: 'system', content: '你是三指，清河县小偷，缺钱想借钱但不想暴露身份。回答不超过2句话。' },
    { role: 'user', content: '你找到商人陈富贵，开口借钱。' },
  ];
  const ctxB: any[] = [
    { role: 'system', content: '你是陈富贵，清河县商人，精明怕麻烦。回答不超过2句话。' },
  ];

  console.log('=== 多agent对话模拟（3轮）===');
  for (let r = 1; r <= 3; r++) {
    const t0 = Date.now();
    const resA = await llm.chat(ctxA, { temperature: 0.7, maxTokens: 60 });
    ctxA.push({ role: 'assistant', content: resA });
    console.log(`[轮${r}] 三指: ${resA.slice(0, 70)}`);

    ctxB.push({ role: 'user', content: `三指对你说："${resA.slice(0, 120)}" 你怎么回应？` });
    const resB = await llm.chat(ctxB, { temperature: 0.7, maxTokens: 60 });
    ctxB.push({ role: 'assistant', content: resB });
    console.log(`[轮${r}] 陈富贵: ${resB.slice(0, 70)}`);

    ctxA.push({ role: 'user', content: `陈富贵回应："${resB.slice(0, 120)}" 你继续交涉。` });
    console.log(`[轮${r}] 耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
    console.log('---');
  }
  console.log('\n✅ 3轮多agent对话全部完成（同一API key，各自独立上下文）');
}
main().catch(e => console.error('FAIL:', e.message));
