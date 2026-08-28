async function main() {
  const key = process.env.SIMULATION_API_KEY;
  const res = await fetch('https://api.siliconflow.cn/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await res.json();
  const models = (data.data ?? []).map((m: any) => m.id);
  // 筛选出对话/非图像模型
  const interesting = models.filter((id: string) =>
    !id.includes('embedding') && !id.includes('image') && !id.includes('rerank') &&
    (id.includes('deepseek') || id.includes('Qwen') || id.includes('qwen') || id.includes('glm') || id.includes('kimi') || id.includes('hunyuan'))
  );
  console.log('可用对话模型:', interesting.join('\n'));
}

main().catch(e => console.error('FAIL:', e.message));
