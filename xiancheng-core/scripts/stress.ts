const KEY_A = process.env.SIMULATION_API_KEY;
const KEY_B = 'sk-etznouqnrthtujcmeqkiofydwbpcjhwxphqtoksmqwzrwyuy';

async function hammer(key: string, label: string) {
  let ok = 0, fail = 0;
  const errs: string[] = [];
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'deepseek-ai/DeepSeek-V4-Flash', messages: [{ role: 'user', content: `测试${i+1}` }], max_tokens: 10 }),
      });
      if (res.status === 200) ok++;
      else {
        fail++;
        const d = await res.json().catch(() => ({}));
        errs.push(`${res.status}: ${(d?.error?.message ?? '').slice(0, 40)}`);
      }
    } catch { fail++; errs.push('net'); }
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`${label}: 成功${ok}/4 失败${fail}/4 ${errs.length ? '| ' + errs.join(' | ') : ''}`);
}

async function main() {
  console.log('Key-A(县城):', KEY_A?.slice(0, 10) + '...');
  await hammer(KEY_A!, 'Key-A');
  await new Promise(r => setTimeout(r, 1000));
  await hammer(KEY_B, 'Key-B');
}
main().catch(console.error);
