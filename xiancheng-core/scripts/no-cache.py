import sys
sys.stdout.reconfigure(encoding='utf-8')
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/src/index-v2.ts'
src = open(path, encoding='utf-8').read()

old = "app.use(express.static(join(__dirname, '..', 'client')));"
new = """// 前端静态文件禁用缓存（开发期，避免浏览器用旧文件）
app.use(express.static(join(__dirname, '..', 'client'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  },
}));"""
assert old in src, 'static line not found'
src = src.replace(old, new)
open(path, 'w', encoding='utf-8').write(src)
print('index-v2.ts: 前端静态文件已禁用缓存')