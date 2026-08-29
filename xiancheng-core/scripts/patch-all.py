# 一次性补丁：map-canvas.js 加 drawBaseMapIfNeeded
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/map-canvas.js'
src = open(path, encoding='utf-8').read()

old = '''// 初始化画布
function initMapCanvas() {
  const canvas = document.getElementById('game-map');
  if (!canvas) return;
  mapCanvas = canvas;
  mapCtx = canvas.getContext('2d');
  // 绘制静态地图（草地+道路+建筑）
  drawBaseMap();
}'''

new = '''let baseMapDrawn = false;

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
}'''

assert old in src, 'initMapCanvas not found in map-canvas.js'
src = src.replace(old, new)
open(path, 'w', encoding='utf-8').write(src)
print('1/3 map-canvas.js 已加 drawBaseMapIfNeeded')

# 2) index.html 引入 map-canvas.js
html_path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/index.html'
html = open(html_path, encoding='utf-8').read()
old_script = '<script src="app.js"></script>'
new_script = '<script src="map-canvas.js"></script>\n  <script src="app.js"></script>'
assert old_script in html, 'app.js script tag not found'
html = html.replace(old_script, new_script)
open(html_path, 'w', encoding='utf-8').write(html)
print('2/3 index.html 已引入 map-canvas.js')

# 3) app.js 重写渲染逻辑
app_path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/app.js'
app = open(app_path, encoding='utf-8').read()

# 3a) DOM 加 canvas 引用
old_dom = "const mapOverlay = $('#map-overlay');"
new_dom = """const mapOverlay = $('#map-overlay');
const gameMap = document.getElementById('game-map');
const gameCtx = gameMap ? gameMap.getContext('2d') : null;"""
assert old_dom in app, 'mapOverlay dom not found'
app = app.replace(old_dom, new_dom)

# 3b) 头像加载器（插到渲染区前）
avatar_code = """
// ── 头像加载器 ──
const avatarLoader = {
  cache: {},
  get(id) { return this.cache[id] || null; },
  loadAll() {
    const ids = ['char_xianling','char_butou','char_shangren','char_shimin_jia','char_shimin_yi','char_xiaotou','char_player'];
    for (const id of ids) {
      const img = new Image();
      img.src = `avatars/${id}.png`;
      this.cache[id] = img;
    }
  },
};
avatarLoader.loadAll();
"""
anchor = "// ── 渲染 ──"
assert anchor in app, 'render anchor not found'
app = app.replace(anchor, avatar_code + "\n" + anchor)

# 3c) renderMap 改为 canvas 调用
old_render = """// ── 地图渲染：角色头像标记在对应地点上 ──
function renderMap(characters) {
  mapOverlay.innerHTML = '';
  // 地点标签
  for (const [locId, pos] of Object.entries(LOCATION_POS)) {
    const label = document.createElement('div');
    label.className = 'map-loc-label';
    label.style.left = pos.x + 'px';
    label.style.top = pos.y + 'px';
    label.textContent = LOCATION_NAMES[locId] || locId;
    mapOverlay.appendChild(label);
  }
  // 角色头像（按地点聚合摆放）
  const byLoc = {};
  for (const c of characters) {
    if (!byLoc[c.locationId]) byLoc[c.locationId] = [];
    byLoc[c.locationId].push(c);
  }
  for (const [locId, list] of Object.entries(byLoc)) {
    const pos = LOCATION_POS[locId];
    if (!pos) continue;
    list.forEach((c, i) => {
      const offset = (i - (list.length - 1) / 2) * 26;
      const el = document.createElement('div');
      el.className = 'map-char';
      el.title = `${c.name}：${c.goal || '思考中'}`;
      el.style.left = (pos.x + offset - 20) + 'px';
      el.style.top = (pos.y + 30) + 'px';
      const img = document.createElement('img');
      img.src = `avatars/${c.id}.png`;
      img.alt = c.name;
      el.appendChild(img);
      el.onclick = () => openCharModal(c.id);
      mapOverlay.appendChild(el);
    });
  }
}"""

new_render = """// ── 地图渲染：Canvas 像素风（调用 map-canvas.js）──
function renderMap(characters) {
  if (gameMap && gameCtx) {
    drawBaseMapIfNeeded();
    drawCharactersOnMap(characters, avatarLoader);
  }
}"""

assert old_render in app, 'renderMap not found in app.js'
app = app.replace(old_render, new_render)

open(app_path, 'w', encoding='utf-8').write(app)
print('3/3 app.js 已接入 Canvas 像素地图渲染')