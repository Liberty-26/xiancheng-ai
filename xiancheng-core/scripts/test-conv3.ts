import { LLMClient } from '../src/llm/client';

async function main() {
  const llm = new LLMClient();

  const ctxA: any[] = [
    { role: 'system', content: '你是三指，缺钱的小偷。一句话。' },
    { role: 'user', content: '向商人陈富贵开口借钱，说一句话。' },
  ];
  const ctxB: any[] = [
    { role: 'system', content: '你是商人陈富贵，精明的生意人。一句话。' },
  ];

  const start = Date.now();
  for (let round = 0; round < 2; round++) {
    const resA = await llm.chat(ctxA, { temperature: 0.7, maxTokens: 50 });
    ctxA.push({ role: 'assistant', content: resA });
    console.log(`三指: ${resA.slice(0, 60)}`);

    ctxB.push({ role: 'user', content: `三指说：${resA.slice(0, 100)}。你怎么回？一句话。` });
    const resB = await llm.chat(ctxB, { temperature: 0.7, maxTokens: 50 });
    ctxB.push({ role: 'assistant', content: resB });
    console.log(`陈富贵: ${resB.slice(0, 60)}`);

    ctxA.push({ role: 'user', content: `陈富贵回：${resB.slice(0, 100)}。你回他一句。` });
    console.log('---');
  }
  console.log(`\n✅ 2轮对话完成，耗时 ${((Date.now()-start)/1000).toFixed(0)}s`);
}

main().catch(e => console.error('FAIL:', e.message));
