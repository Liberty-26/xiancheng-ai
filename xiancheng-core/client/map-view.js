// ============================================================
// 清河县 · 俯视地图渲染（参照 WorldX 设计模式）
// 背景图(1280×800) + 区域缩进定位 + 角色头像
// ============================================================

// 7 个区域矩形（像素坐标，来自 TMJ regions 图层）
const REGION_RECTS = {
  yamen:     { x: 96, y: 48, w: 264, h: 168 },
  market:    { x: 400, y: 48, w: 472, h: 200 },
  shop:      { x: 912, y: 48, w: 280, h: 168 },
  warehouse: { x: 96, y: 304, w: 248, h: 184 },
  houses:    { x: 944, y: 304, w: 248, h: 184 },
  hideout:   { x: 352, y: 528, w: 392, h: 184 },
  gate:      { x: 800, y: 704, w: 296, h: 72 },
};
const LOCATION_NAMES = {
  yamen: '县衙', market: '街市', shop: '商铺',
  warehouse: '仓库', houses: '民宅', hideout: '地下据点', gate: '城门',
};

let mapBg = null;
let mapCharacters = [];
let scale = 1;

function initMapView() {
  const container = document.getElementById('map-view');
  if (!container) return;
  mapBg = new Image();
  mapBg.onload = () => { calcScale(); renderMapView(); };
  mapBg.src = 'map/bg.png';
}

function calcScale() {
  const container = document.getElementById('map-view');
  if (!container) return;
  const maxW = container.clientWidth || 1280;
  const maxH = 600;
  scale = Math.min(maxW / 1280, maxH / 800, 1.5);
}

function renderMapView() {
  const container = document.getElementById('map-view');
  if (!container) return;
  calcScale();
  const sw = 1280 * scale, sh = 800 * scale;

  let html = mapBg && mapBg.complete
    ? `<img src="map/bg.png" style="width:${sw}px;height:${sh}px;position:absolute;left:0;top:0;border-radius:8px">`
    : `<div style="width:${sw}px;height:${sh}px;background:#2a3a2a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#8892b0">加载地图...</div>`;

  for (const [id, r] of Object.entries(REGION_RECTS)) {
    const cx = (r.x + r.w / 2) * scale;
    const cy = (r.y + 6) * scale;
    const count = mapCharacters.filter(c => c.locationId === id).length;
    html += `<div class="map-region-label" style="left:${cx}px;top:${cy}px" onclick="showLocationChars('${id}')">${LOCATION_NAMES[id]}${count > 0 ? ' (' + count + ')' : ''}</div>`;
  }

  for (const c of mapCharacters) {
    const pos = getCharStandPos(c);
    if (!pos) continue;
    const px = pos.x * scale;
    const py = pos.y * scale;
    html += `<div class="map-char" style="left:${px}px;top:${py}px" onclick="openCharModal('${c.id}')" title="${(c.goal || '思考中').slice(0, 30)}">`;
    html += `<img src="avatars/${c.id}.png" class="map-char-avatar" onerror="this.style.visibility='hidden'">`;
    html += `<span class="map-char-name">${c.name}</span>`;
    html += '</div>';
  }

  container.innerHTML = html;
  container.style.position = 'relative';
  container.style.width = sw + 'px';
  container.style.height = sh + 'px';
  container.style.margin = '0 auto';
}

// 区域缩进定位（16% inset，参照 WorldX 的 getInsetBounds）
function getCharStandPos(c) {
  const r = REGION_RECTS[c.locationId];
  if (!r) return null;
  const insetX = Math.max(10, r.w * 0.16);
  const insetY = Math.max(10, r.h * 0.16);
  const minX = r.x + insetX;
  const maxX = r.x + r.w - insetX;
  const minY = r.y + insetY;
  const maxY = r.y + r.h - insetY;
  const seed = hash(c.id);
  const x = minX + (seed % 1000) / 1000 * (maxX - minX);
  const y = minY + ((seed * 31) % 1000) / 1000 * (maxY - minY);
  return { x, y };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

function updateMapView(characters) {
  mapCharacters = characters;
  renderMapView();
}

function showLocationChars(id) {
  const chars = mapCharacters.filter(c => c.locationId === id);
  if (chars.length > 0) openCharModal(chars[0].id);
}
