import { LLMClient } from '../src/llm/client';
async function main() {
  const llm = new LLMClient();
  let ok = 0, fail = 0;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await llm.chat([{ role: 'user', content: '说一个字' }], { maxTokens: 5 });
      ok++;
      console.log(`#${i + 1} ✅ ${res.slice(0, 20)}`);
    } catch (e: any) {
      fail++;
      console.log(`#${i + 1} ❌ ${e.message.slice(0, 120)}`);
    }
  }
  console.log(`\n结果: 成功${ok} 失败${fail}`);
}
main();
