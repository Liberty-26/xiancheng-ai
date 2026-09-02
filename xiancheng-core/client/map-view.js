// ============================================================
// 清河县 · 俯视地图渲染 v2（WorldX 碰撞感知版）
// 碰撞网格定位 + 平滑移动 + 名字气泡 + BFS 路径行走
// ============================================================

// ── 地点邻接图（与 src/types.ts MAP_LOCATIONS 同步）──
const LOCATION_GRAPH = {
  gate:      { name: '城门',     connections: ['market', 'houses'],                 x: 6, y: 0 },
  yamen:     { name: '县衙',     connections: ['market'],                            x: 0, y: 2 },
  market:    { name: '街市',     connections: ['gate', 'yamen', 'shop', 'warehouse'], x: 3, y: 2 },
  shop:      { name: '商铺',     connections: ['market'],                            x: 6, y: 2 },
  warehouse: { name: '仓库',     connections: ['market', 'hideout'],                 x: 1, y: 4 },
  houses:    { name: '民宅',     connections: ['market', 'gate'],                    x: 5, y: 4 },
  hideout:   { name: '地下据点', connections: ['warehouse'],                         x: 2, y: 6 },
};

// ── 地图常量 ──
const MAP_TILE = 8;
const MAP_COLS = 160;
const MAP_ROWS = 100;
const MAP_W = 1280;
const MAP_H = 800;

// ── 状态 ──
let collision = null;          // Uint8Array 碰撞网格
let regionRects = {};          // { id: {x,y,w,h}, ... }
let mapBgLoaded = false;
let scale = 1;
let pendingCharacters = null;  // 地图数据加载前的缓存

// 角色 DOM 状态
const charState = {}; // charId -> { el, avatar, nameEl, bubbleEl, x, y, locationId, timer }

// ═══════════════════════════════════════════════════════════════
// 碰撞工具
// ═══════════════════════════════════════════════════════════════

/** 判断某格是否可行走 */
function isWalkable(col, row) {
  if (!collision) return false;
  if (row < 0 || col < 0 || row >= MAP_ROWS || col >= MAP_COLS) return false;
  return collision[row * MAP_COLS + col] === 0;
}

/** 曼哈顿螺旋搜索：从 (cx,cy) 找最近的可行走格 */
function nearestWalkable(cx, cy) {
  if (!collision) return { x: cx, y: cy };
  const cCol = Math.floor(cx / MAP_TILE);
  const cRow = Math.floor(cy / MAP_TILE);
  if (isWalkable(cCol, cRow)) {
    return { x: cCol * MAP_TILE + MAP_TILE / 2, y: cRow * MAP_TILE + MAP_TILE / 2 };
  }
  for (let r = 1; r < 30; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const col = cCol + dc, row = cRow + dr;
        if (isWalkable(col, row)) {
          return { x: col * MAP_TILE + MAP_TILE / 2, y: row * MAP_TILE + MAP_TILE / 2 };
        }
      }
    }
  }
  return { x: cx, y: cy };
}

/** 区域 inset 内随机可行走格（WorldX 风格） */
function getRandomWalkablePointInLocation(locationId, opts = {}) {
  const r = regionRects[locationId];
  if (!r || !collision) return null;
  const preferInset = opts.preferInset !== false;
  const col0 = Math.floor(r.x / MAP_TILE);
  const row0 = Math.floor(r.y / MAP_TILE);
  const cols = Math.floor(r.w / MAP_TILE);
  const rows = Math.floor(r.h / MAP_TILE);
  const insetX = preferInset ? Math.max(1, Math.floor(cols * 0.16)) : 0;
  const insetY = preferInset ? Math.max(1, Math.floor(rows * 0.16)) : 0;

  // 多次随机尝试
  for (let i = 0; i < 60; i++) {
    const col = col0 + insetX + Math.floor(Math.random() * Math.max(1, cols - 2 * insetX));
    const row = row0 + insetY + Math.floor(Math.random() * Math.max(1, rows - 2 * insetY));
    if (isWalkable(col, row)) {
      return { x: col * MAP_TILE + MAP_TILE / 2, y: row * MAP_TILE + MAP_TILE / 2 };
    }
  }
  // 兜底：全区域扫描
  for (let row = row0 + insetY; row < row0 + rows - insetY; row++) {
    for (let col = col0 + insetX; col < col0 + cols - insetX; col++) {
      if (isWalkable(col, row)) {
        return { x: col * MAP_TILE + MAP_TILE / 2, y: row * MAP_TILE + MAP_TILE / 2 };
      }
    }
  }
  // 最终 fallback
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// ═══════════════════════════════════════════════════════════════
// BFS 寻路（地点级）
// ═══════════════════════════════════════════════════════════════

function findLocationPath(from, to) {
  if (from === to) return [to];
  const prev = {};
  const q = [from];
  const visited = new Set([from]);
  while (q.length) {
    const cur = q.shift();
    const node = LOCATION_GRAPH[cur];
    if (!node) continue;
    for (const nb of node.connections) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let p = to;
        while (prev[p] !== undefined) { p = prev[p]; path.unshift(p); }
        return path;
      }
      q.push(nb);
    }
  }
  return [to]; // 不连通时直接跳到目标
}

// ═══════════════════════════════════════════════════════════════
// 渲染
// ═══════════════════════════════════════════════════════════════

function calcScale() {
  const container = document.getElementById('map-view');
  if (!container) return;
  const maxW = container.clientWidth || MAP_W;
  const maxH = 600;
  scale = Math.min(maxW / MAP_W, maxH / MAP_H, 1.5);
}

/** 渲染静态层（背景图 + 区域标签），只调用一次 */
function renderStaticLayer() {
  const container = document.getElementById('map-view');
  if (!container) return;
  calcScale();
  const sw = MAP_W * scale, sh = MAP_H * scale;

  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.width = sw + 'px';
  container.style.height = sh + 'px';
  container.style.margin = '0 auto';

  // 背景图
  const bg = document.createElement('img');
  bg.src = 'map/bg.png';
  bg.style.cssText = `width:${sw}px;height:${sh}px;position:absolute;left:0;top:0;border-radius:8px;pointer-events:none`;
  container.appendChild(bg);

  // 区域标签
  for (const [id, r] of Object.entries(regionRects)) {
    const label = document.createElement('div');
    label.className = 'map-region-label';
    label.style.left = ((r.x + r.w / 2) * scale) + 'px';
    label.style.top = ((r.y + 6) * scale) + 'px';
    label.textContent = LOCATION_GRAPH[id]?.name || id;
    label.dataset.locationId = id;
    label.onclick = () => showLocationChars(id);
    container.appendChild(label);
  }
}

/** 更新区域标签的人数 */
function updateRegionCounts(characters) {
  const container = document.getElementById('map-view');
  if (!container) return;
  const labels = container.querySelectorAll('.map-region-label');
  for (const lbl of labels) {
    const id = lbl.dataset.locationId;
    const count = characters.filter(c => c.locationId === id).length;
    const name = LOCATION_GRAPH[id]?.name || id;
    lbl.textContent = count > 0 ? `${name} (${count})` : name;
  }
}

/** 创建单个角色的 DOM 元素 */
function createCharEl(c) {
  const el = document.createElement('div');
  el.className = 'map-char';
  el.style.position = 'absolute';
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.zIndex = 3;
  el.dataset.charId = c.id;
  el.dataset.locationId = c.locationId;
  el.onclick = () => { if (typeof openCharModal === 'function') openCharModal(c.id); };

  // 气泡（hover 显示）
  const bubble = document.createElement('div');
  bubble.className = 'map-char-bubble';
  bubble.textContent = `${c.role || ''}｜${c.goal || '思考中'}`;

  // 头像
  const avatar = document.createElement('img');
  avatar.className = 'map-char-avatar';
  avatar.src = `avatars/${c.id}.png`;
  avatar.draggable = false;
  avatar.onerror = () => { avatar.style.visibility = 'hidden'; };

  // 名字
  const nameEl = document.createElement('span');
  nameEl.className = 'map-char-name';
  nameEl.textContent = c.name;

  el.appendChild(bubble);
  el.appendChild(avatar);
  el.appendChild(nameEl);
  return { el, avatar, nameEl, bubbleEl: bubble, x: 0, y: 0, locationId: c.locationId, timer: null };
}

/** 放置角色到指定像素位置（带过渡动画） */
function placeChar(st, durMs) {
  const px = st.x * scale;
  const py = st.y * scale;
  const el = st.el;
  if (durMs > 0) {
    el.style.transition = `left ${durMs}ms ease-in-out, top ${durMs}ms ease-in-out`;
  } else {
    el.style.transition = 'none';
  }
  el.style.left = px + 'px';
  el.style.top = py + 'px';
}

/** 角色沿路径行走动画 */
function walkTo(st, fromLocId, targetLocId) {
  if (st.timer) { clearTimeout(st.timer); st.timer = null; }

  const path = findLocationPath(fromLocId, targetLocId);
  if (path.length <= 1) {
    // 相同地点或相邻，直接跳转
    const pos = getRandomWalkablePointInLocation(targetLocId, { preferInset: true });
    if (pos) { st.x = pos.x; st.y = pos.y; }
    st.locationId = targetLocId;
    st.el.dataset.locationId = targetLocId;
    placeChar(st, 400);
    return;
  }

  // 路径上的排头兵：当前 location 已经在 path[0]，但我们要从当前位置出发
  // 如果 path[0] === fromLocId，从 index 1 开始
  const startIdx = path[0] === fromLocId ? 1 : 0;
  const waypoints = path.slice(startIdx);
  let idx = 0;
  const stepMs = 500;

  const moveNext = () => {
    if (idx >= waypoints.length) { st.timer = null; return; }
    const locId = waypoints[idx];
    const isLast = idx === waypoints.length - 1;
    let pos;
    if (isLast) {
      // 终点：随机 inset 可行走格
      pos = getRandomWalkablePointInLocation(locId, { preferInset: true });
    } else {
      // 中间途经点：区域中心附近最近可行走格
      const r = regionRects[locId];
      if (r) {
        pos = nearestWalkable(r.x + r.w / 2, r.y + r.h / 2);
      } else {
        pos = getRandomWalkablePointInLocation(locId, { preferInset: false });
      }
    }
    if (pos) { st.x = pos.x; st.y = pos.y; }
    st.locationId = locId;
    st.el.dataset.locationId = locId;
    placeChar(st, stepMs);
    idx++;
    st.timer = setTimeout(moveNext, stepMs + 20);
  };

  moveNext();
}

/** 同步角色数据到 DOM */
function syncCharacter(container, c) {
  let st = charState[c.id];

  if (!st) {
    // 创建新角色
    st = createCharEl(c);
    charState[c.id] = st;
    container.appendChild(st.el);
    // 初始定位
    const pos = getRandomWalkablePointInLocation(c.locationId, { preferInset: true });
    if (pos) { st.x = pos.x; st.y = pos.y; }
    st.locationId = c.locationId;
    placeChar(st, 0);
  } else {
    // 更新气泡/名字（内容可能变化）
    st.nameEl.textContent = c.name;
    st.bubbleEl.textContent = `${c.role || ''}｜${c.goal || '思考中'}`;
    st.avatar.src = `avatars/${c.id}.png`;

    // 检测位置变化 → 路径行走
    if (c.locationId !== st.locationId) {
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      const fromLocId = st.locationId;
      st.locationId = c.locationId; // 先更新状态，避免重复触发
      walkTo(st, fromLocId, c.locationId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 外部接口
// ═══════════════════════════════════════════════════════════════

function updateMapView(characters) {
  const container = document.getElementById('map-view');
  if (!container) return;
  if (!collision) {
    // 地图数据还没加载好，缓存
    pendingCharacters = characters;
    return;
  }

  const seen = new Set();
  for (const c of characters) {
    seen.add(c.id);
    syncCharacter(container, c);
  }
  // 清理离开的角色
  for (const id of Object.keys(charState)) {
    if (!seen.has(id)) {
      if (charState[id].timer) { clearTimeout(charState[id].timer); }
      charState[id].el.remove();
      delete charState[id];
    }
  }
  updateRegionCounts(characters);
}

function showLocationChars(id) {
  const chars = Object.values(charState).filter(st => st.locationId === id);
  if (chars.length > 0 && typeof openCharModal === 'function') {
    // 从 DOM 元素找 char id
    const el = chars[0].el;
    const handler = el.onclick;
    if (handler) handler();
  }
}

/** 窗口尺寸变化时重新缩放 */
function handleResize() {
  const container = document.getElementById('map-view');
  if (!container) return;
  calcScale();
  // 重新设容器尺寸
  const sw = MAP_W * scale, sh = MAP_H * scale;
  container.style.width = sw + 'px';
  container.style.height = sh + 'px';
  // 背景图
  const bg = container.querySelector('img');
  if (bg) bg.style.cssText = `width:${sw}px;height:${sh}px;position:absolute;left:0;top:0;border-radius:8px;pointer-events:none`;
  // 区域标签
  for (const [id, r] of Object.entries(regionRects)) {
    const labels = container.querySelectorAll('.map-region-label');
    for (const lbl of labels) {
      if (lbl.dataset.locationId === id) {
        lbl.style.left = ((r.x + r.w / 2) * scale) + 'px';
        lbl.style.top = ((r.y + 6) * scale) + 'px';
      }
    }
  }
  // 重放所有角色位置（无过渡）
  for (const st of Object.values(charState)) {
    placeChar(st, 0);
  }
}

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

async function initMapView() {
  if (initMapView._done) return;
  initMapView._done = true;
  try {
    const res = await fetch('map/map-data.json');
    const data = await res.json();
    collision = new Uint8Array(data.collision);
    for (const r of data.regions) regionRects[r.id] = r;
  } catch (e) {
    console.error('地图数据加载失败:', e);
  }

  renderStaticLayer();

  // 处理缓存的角色数据
  if (pendingCharacters) {
    updateMapView(pendingCharacters);
    pendingCharacters = null;
  }

  // 窗口 resize 监听
  window.addEventListener('resize', handleResize);
}

// ── 页面加载后自动初始化 ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMapView);
} else {
  initMapView();
}