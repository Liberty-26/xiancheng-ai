// ============================================================
// 清河县 · AI 社会模拟器入口
// Phase 1：骨架 + 数据模型
// ============================================================

import { SimulationEngine } from './engine';

const engine = new SimulationEngine();

// 按下 Ctrl+C 停止
process.on('SIGINT', () => {
  console.log('\n模拟停止');
  engine.stop();
  process.exit(0);
});

engine.start().catch((err) => {
  console.error('模拟出错:', err);
  process.exit(1);
});