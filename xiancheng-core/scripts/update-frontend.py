import re

# 1. index.html: 引入 map-canvas.js
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/index.html'
src = open(path).read()
old = '<script src="app.js"></script>'
new = '<script src="map-canvas.js"></script>\n  <script src="app.js"></script>'
assert old in src, 'script tag not found'
src = src.replace(old, new)
open(path, 'w').write(src)
print('index.html: 引入 map-canvas.js')

# 2. app.js: 调用 map-canvas 渲染（替换 renderMap 的 DOM 方式为 canvas）
path2 = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/app.js'
src2 = open(path2).read()

# 在 refresh() 里调用 canvas 渲染
old2 = "    // ── 地图：角色位置标注 ──\n    renderMap(characters);"
new2 = "    // ── 地图：Canvas 像素渲染（程序化）──\n    if (!mapCanvas) initMapCanvas();\n    drawCharactersOnMap(characters, avatarLoader);"
assert old2 in src2, 'renderMap call not found'
src2 = src2.replace(old2, new2)

# 删除旧的 renderMap DOM 函数（用 canvas 版本替代）
old_fn_start = '// ── 地图渲染：角色头像标记在对应地点上 ──'
old_fn_end = '// ── 角色详情弹窗'
si = src2.find(old_fn_start)
ei = src2.find(old_fn_end)
assert si != -1 and ei != -1, 'renderMap function block not found'
src2 = src2[:si] + '// ── 地图渲染（见 map-canvas.js）──\n\n' + src2[ei:]

# 添加 avatarLoader（预加载头像）
avatar_loader_code = '''
// ── 头像加载器（预加载 7 个角色头像）──
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
'''
# 插到"工具"之前
anchor = '// ── 工具 ──'
idx = src2.find(anchor)
assert idx != -1
src2 = src2[:idx] + avatar_loader_code + '\n' + src2[idx:]

open(path2, 'w').write(src2)
print('app.js: 接入 Canvas 地图渲染 + 头像加载器')