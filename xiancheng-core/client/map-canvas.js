// ============================================================
// 清河县 · Canvas 像素风俯视地图
// 程序化绘制：草地 + 道路 + 建筑块 + 角色头像
// ============================================================

// 地图网格：12×7（每个地点一格），tile 绘制
const MAP_GRID = {
  cols: 12,
  rows: 7,
};
// 地点在网格中的位置（col, row）
const GRID_POS = {
  yamen:     { c: 1, r: 1 },
  market:    { c: 5, r: 1 },
  shop:      { c: 9, r: 1 },
  warehouse: { c: 1, r: 4 },
  houses:    { c: 9, r: 4 },
  hideout:   { c: 4, r: 6 },
  gate:      { c: 8, r: 6 },
};
const LOCATION_NAMES = {
  yamen: '县衙', market: '街市', shop: '商铺',
  warehouse: '仓库', houses: '民宅', hideout: '地下据点', gate: '城门',
};

// 像素风配色
const COLORS = {
  grass: '#7a9e4d',       // 草地
  grassDark: '#6d8f43',   // 草地暗斑
  road: '#c9b78a',        // 道路
  roadLine: '#b3a072',    // 道路接缝
  border: '#4a6b32',      // 绿篱/边界
  // 建筑
  yamen:     { roof: '#a5443a', wall: '#d8c29a', name: '#f0e6d2' },
  market:    { roof: '#c85c3c', wall: '#e8d5a8', name: '#f8e8d0' },
  shop:      { roof: '#8a5a3c', wall: '#d8c29a', name: '#f0e0c8' },
  warehouse: { roof: '#6b4a3a', wall: '#b89a72', name: '#e8d0b0' },
  houses:    { roof: '#7a4a3a', wall: '#c8a87a', name: '#e8d8b8' },
  hideout:   { roof: '#4a3a3a', wall: '#8a7a6a', name: '#c8b8a8' },
  gate:      { roof: '#6a5a4a', wall: '#a89880', name: '#d8c8a8' },
};

let mapCanvas = null;
let mapCtx = null;

let baseMapDrawn = false;

// 初始化画布
function initMapCanvas() {
  const canvas = document.getElementById('game-map');
  if (!canvas) return;
  mapCanvas = canvas;
  mapCtx = canvas.getContext('2d');
}

// 若基础地图未绘制则绘制（守卫，避免重复重绘）
function drawBaseMapIfNeeded() {
  if (!mapCtx) {
    const canvas = document.getElementById('game-map');
    if (!canvas) return;
    mapCanvas = canvas;
    mapCtx = canvas.getContext('2d');
  }
  if (!baseMapDrawn) {
    drawBaseMap();
    baseMapDrawn = true;
  }
}

// 绘制基础地图（草地、道路、建筑块）
function drawBaseMap() {
  const ctx = mapCtx;
  const W = mapCanvas.width;
  const H = mapCanvas.height;
  const cols = MAP_GRID.cols;
  const rows = MAP_GRID.rows;
  const cellW = W / cols;
  const cellH = H / rows;

  // 草地底色（带噪点）
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, W, H);
  // 草地噪点
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillStyle = Math.random() > 0.5 ? COLORS.grassDark : COLORS.grass;
    ctx.fillRect(x, y, 2, 2);
  }

  // 边界绿篱（四周一圈）
  ctx.fillStyle = COLORS.border;
  ctx.fillRect(0, 0, W, 4);
  ctx.fillRect(0, H - 4, W, 4);
  ctx.fillRect(0, 0, 4, H);
  ctx.fillRect(W - 4, 0, 4, H);

  // 道路：十字路（横向连接 market，纵向连接各点）
  const roadY = 1.5 * cellH; // 横向主路（经过 market/shop/yamen 一排）
  const roadX = 4.5 * cellW; // 纵向主路（连接 hideout→market）

  // 横向道路（从 yamen 到 shop 整排）
  ctx.fillStyle = COLORS.road;
  ctx.fillRect(0, roadY - 6, W, 12);
  // 纵向道路（market 到 hideout）
  ctx.fillRect(roadX - 6, roadY - 6, 12, H);
  // 道路接缝线
  ctx.fillStyle = COLORS.roadLine;
  ctx.fillRect(0, roadY - 1, W, 2);
  ctx.fillRect(roadX - 1, roadY - 6, 2, H);

  // 各地点建筑块
  for (const [locId, pos] of Object.entries(GRID_POS)) {
    const colors = COLORS[locId];
    const cx = (pos.c + 0.5) * cellW;
    const cy = (pos.r + 0.5) * cellH;
    const bw = cellW * 0.86;
    const bh = cellH * 0.7;
    const bx = cx - bw / 2;
    const by = cy - bh / 2;

    // 地面阴影
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(bx - 3, by + 3, bw, bh);

    // 墙体
    ctx.fillStyle = colors.wall;
    ctx.fillRect(bx, by + bh * 0.3, bw, bh * 0.7);

    // 屋顶
    ctx.fillStyle = colors.roof;
    ctx.fillRect(bx, by, bw, bh * 0.5);
    // 屋顶轮廓线
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx, by + bh * 0.5 - 1, bw, 2);

    // 地点名（挂在建筑上方）
    ctx.fillStyle = colors.name;
    ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(LOCATION_NAMES[locId], cx, by - 6);

    // 门（建筑下方小黑块）
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cx - 5, by + bh * 0.75, 10, bh * 0.25);
  }
}

// 在地图上绘角色（头像 → 放在对应地点建筑前）
function drawCharactersOnMap(characters, avatarLoader) {
  const ctx = mapCtx;
  const W = mapCanvas.width;
  const H = mapCanvas.height;
  const cols = MAP_GRID.cols;
  const rows = MAP_GRID.rows;
  const cellW = W / cols;
  const cellH = H / rows;

  // 按地点分组，避免重叠
  const byLoc = {};
  for (const c of characters) {
    if (!byLoc[c.locationId]) byLoc[c.locationId] = [];
    byLoc[c.locationId].push(c);
  }

  for (const [locId, list] of Object.entries(byLoc)) {
    const pos = GRID_POS[locId];
    if (!pos) continue;
    const cx = (pos.c + 0.5) * cellW;
    const baseY = (pos.r + 0.5) * cellH;

    list.forEach((c, i) => {
      const offset = (i - (list.length - 1) / 2) * 34;
      const img = avatarLoader.get(c.id);
      if (!img) return;
      const w = 40;
      const h = 48;
      const x = cx + offset - w / 2;
      const y = baseY + 16;
      // 头像阴影
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h - 2, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 头像
      ctx.drawImage(img, x, y, w, h);
      // 名字
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(c.name, x + w / 2, y - 2);
      ctx.fillText(c.name, x + w / 2, y - 2);
    });
  }
}

// 绘制对话标记（可选）
function drawActionMarkers(characters) {
  // 头顶显示当前动作 emoji（简单版：跳过，用标题）
}