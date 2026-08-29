import { LLMClient } from '../src/llm/client';

// 测试：同一个API key，两个不同NPC的上下文，模拟对话

async function main() {
  const llm = new LLMClient();
  const KEY = process.env.SIMULATION_API_KEY;
  const BASE = process.env.SIMULATION_BASE_URL;
  const MODEL = process.env.SIMULATION_MODEL;
  console.log(`模型: ${MODEL}\n`);

  // NPC-A 的上下文（三指）
  const ctxA = [
    { role: 'system', content: '你是三指，清河县的小偷，干瘦，缺钱，想找商人借钱但不想暴露自己。说话简短，像古代人。' },
    { role: 'user', content: '你去找商人陈富贵借钱。你对他说一句话。' },
  ] as any[];

  // NPC-B 的上下文（商人陈富贵）
  const ctxB = [
    { role: 'system', content: '你是陈富贵，清河县的商人，精明，怕惹麻烦，但也不愿得罪人。说话简短，像古代人。' },
  ] as any[];

  // 模拟对话 3 轮
  for (let round = 0; round < 3; round++) {
    // A 说话
    const resA = await llm.chat(ctxA, { temperature: 0.7, maxTokens: 100 });
    ctxA.push({ role: 'assistant', content: resA });
    console.log(`三指: ${resA.slice(0, 80)}`);

    // 把 A 的话给 B 听
    ctxB.push({ role: 'user', content: `三指对你说：${resA.slice(0, 200)}。你回应他。` });

    // B 回应
    const resB = await llm.chat(ctxB, { temperature: 0.7, maxTokens: 100 });
    ctxB.push({ role: 'assistant', content: resB });
    console.log(`陈富贵: ${resB.slice(0, 80)}`);

    // 把 B 的话给 A 听
    ctxA.push({ role: 'user', content: `陈富贵回应：${resB.slice(0, 200)}。你接着说。` });

    console.log('---');
  }

  console.log('\n✅ 多轮对话成功！同一个 API key，各自独立上下文，完全可行。');
}

main().catch(e => console.error('FAIL:', e.message));
