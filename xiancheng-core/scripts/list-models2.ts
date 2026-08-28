async function main() {
  const key = process.env.SIMULATION_API_KEY;
  const res = await fetch('https://api.siliconflow.cn/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  console.log('status:', res.status);
  console.log('response:', text.slice(0, 2000));
}
main().catch(e => console.error('FAIL:', e.message));
