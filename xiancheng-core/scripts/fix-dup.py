import sys, re
sys.stdout.reconfigure(encoding='utf-8')

path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/app.js'
src = open(path, encoding='utf-8').read()

# map-canvas.js 的顶层全局名（避免冲突）
mc = open('/Users/libaodian/Desktop/小县城/xiancheng-core/client/map-canvas.js', encoding='utf-8').read()
mc_names = set(re.findall(r'^(?:const|let)\s+(\w+)', mc, re.M))
print('map-canvas 顶层:', mc_names)

# app.js 顶层名
app_names = set(re.findall(r'^(?:const|let)\s+(\w+)', src, re.M))
print('app.js 顶层:', app_names)

# 冲突名
conflicts = app_names & mc_names
print('冲突:', conflicts)

# 把 app.js 里的冲突名加前缀 app_
for name in conflicts:
    new_name = 'app_' + name
    # 词边界替换（只在该文件内）
    src = re.sub(r'\b' + re.escape(name) + r'\b', new_name, src)
    print(f'  重命名 {name} -> {new_name}')

open(path, 'w', encoding='utf-8').write(src)
print('app.js 已修复')