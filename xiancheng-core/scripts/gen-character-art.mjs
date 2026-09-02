// 千问文生图：生成 7 个角色全身立绘 + 色键抠图
// 输出：client/avatars/{id}.png（透明背景，80×120）

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

dotenv.config({ path: resolve(import.meta.dirname, "..", ".env") });

const API_KEY = process.env.QWEN_IMAGE_API_KEY;
const API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MODEL = process.env.QWEN_IMAGE_MODEL || "qwen-image-3.0";
const TIMEOUT = parseInt(process.env.QWEN_IMAGE_TIMEOUT_MS || "300000", 10);
const OUT_DIR = resolve(import.meta.dirname, "..", "client/avatars");

// 角色立绘定义
const CHARACTERS = [
  {
    id: "char_xianling",
    name: "赵文远",
    prompt: `中国古代县城县令赵文远的全身立绘。他约40岁，面容清瘦，蓄短须，身穿青色圆领官袍，胸前有补子（白鹇图案），腰束革带，头戴乌纱帽，脚穿黑靴。双手交叠于身前，站姿端正，面容严肃但不失温和。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰，人物比例正常。`,
  },
  {
    id: "char_butou",
    name: "张铁",
    prompt: `中国古代县城捕头张铁的全身立绘。他约30岁，身材魁梧，浓眉大眼，面容刚毅。身穿红黑相间的捕快服，腰部系着铁链和令牌，腰间挂一柄单刀，袖口扎紧显精干。头戴黑色圆顶帽，脚穿薄底快靴。双手叉腰，站姿自信有力。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
  {
    id: "char_shangren",
    name: "陈富贵",
    prompt: `中国古代县城商人陈富贵的全身立绘。他约50岁，身材微胖，面圆耳大，留着八字胡，笑容可掬，一副精明模样。身穿绸缎长袍（深蓝色，上有暗纹），腰系钱袋和玉佩，头戴瓜皮帽，手拿算盘。站姿微微前倾，似在与人交谈。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
  {
    id: "char_shimin_jia",
    name: "李老实",
    prompt: `中国古代县城农民李老实的全身立绘。他约35岁，面容朴实憨厚，皮肤黝黑，双手粗糙有力。身穿粗布短褐（灰色），腰系草绳，裤腿挽起，脚穿草鞋。肩上扛着锄头，站姿有些拘谨，面带憨厚笑容。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
  {
    id: "char_shimin_yi",
    name: "王秀才",
    prompt: `中国古代县城书生王秀才的全身立绘。他约25岁，面白无须，清秀文弱，气质儒雅。身穿白色长衫，外罩青色半臂，腰系丝绦，手拿一把折扇。头戴方巾（儒生巾）。站姿端正，面带微笑，眼神明亮。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
  {
    id: "char_xiaotou",
    name: "三指",
    prompt: `中国古代县城小偷三指的全身立绘。他约25岁，身材瘦小，尖嘴猴腮，眼神机警灵活，带一丝狡黠。身穿深灰色短打劲装，袖口紧束，腰系多用途布带，裤脚扎进靴筒。腰间别着一把匕首和一个小布袋。一只手藏在袖中，另一只手自然垂下，站姿微微侧身，像是随时准备溜走。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
  {
    id: "char_player",
    name: "玩家",
    prompt: `中国古代县城青年侠客的全身立绘。他约28岁，英气勃发，面容端正，眼神坚定。身穿青色劲装武士服，外罩半臂皮甲，腰悬长剑，脚穿皂靴。头戴斗笠，斗笠系在背后。双臂抱胸，站姿挺拔，气宇轩昂。背景为纯绿色(#00FF00)。人物在画面中央，从头到脚完整展示。游戏美术风格，色彩鲜明，线条清晰。`,
  },
];

const CHROMA_KEY_GREEN = [0, 255, 0]; // #00FF00

async function generateCharacter({ id, name, prompt }) {
  const outPath = resolve(OUT_DIR, `${id}.png`);
  // 跳过已存在的（除非 --force）
  if (existsSync(outPath) && !process.argv.includes("--force")) {
    console.log(`[SKIP] ${name}(${id}) 已存在`);
    return;
  }

  console.log(`[开始] ${name}(${id}) 生成中...`);
  const body = {
    model: MODEL,
    input: {
      messages: [{ role: "user", content: [{ text: prompt }] }],
    },
    parameters: { size: "1024*1024", n: 1 },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ` + JSON.stringify(data).slice(0, 200));
    const imgUrl = data?.output?.choices?.[0]?.message?.content?.find((p) => p.type === "image")?.image;
    if (!imgUrl) throw new Error("无图片URL: " + JSON.stringify(data).slice(0, 200));

    console.log("  下载中...");
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`下载失败: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());

    // 色键抠图 + 缩放到 80×120
    console.log("  抠图 + 缩放中...");
    const { execSync } = await import("child_process");
    const { writeFileSync, unlinkSync, mkdirSync } = await import("fs");
    mkdirSync(OUT_DIR, { recursive: true });

    // 用 Python PIL 处理
    const tmpIn = resolve(OUT_DIR, `_tmp_${id}.png`);
    const tmpOut = resolve(OUT_DIR, `_tmp_${id}_out.png`);
    writeFileSync(tmpIn, buf);
    const pyScript = `
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGBA")
pixels = img.load()
w, h = img.size
target = (0, 255, 0)
tol = 50
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if a > 0 and abs(r-target[0])<tol and abs(g-target[1])<tol and abs(b-target[2])<tol:
            pixels[x, y] = (r, g, b, 0)
# 缩放到 80x120，保持比例
out_w, out_h = 80, 120
ratio = min(out_w/w, out_h/h)
nw, nh = int(w*ratio), int(h*ratio)
img = img.resize((nw, nh), Image.LANCZOS)
canvas = Image.new("RGBA", (out_w, out_h), (0,0,0,0))
canvas.paste(img, ((out_w-nw)//2, (out_h-nh)//2))
canvas.save(sys.argv[2], "PNG")
`;
    const pyFile = resolve(OUT_DIR, `_tmp_chroma.py`);
    writeFileSync(pyFile, pyScript);
    try {
      execSync(`python3 "${pyFile}" "${tmpIn}" "${tmpOut}"`, { timeout: 30000 });
      const outBuf = readFileSync(tmpOut);
      writeFileSync(outPath, outBuf);
      console.log(`[完成] ${name}(${id}) ${outBuf.length} bytes → ${outPath}`);
    } finally {
      try { unlinkSync(tmpIn); } catch {}
      try { unlinkSync(tmpOut); } catch {}
      try { unlinkSync(pyFile); } catch {}
    }
  } catch (e) {
    console.error(`[失败] ${name}(${id}): ${e.message.slice(0, 150)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`=== 千问文生图 生成 ${CHARACTERS.length} 个角色全身立绘（色键抠图）===\n`);
  for (const ch of CHARACTERS) {
    await generateCharacter(ch);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\n完成！");
  const { readdirSync, statSync } = await import("fs");
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith("_tmp")) continue;
    const s = statSync(resolve(OUT_DIR, f));
    console.log(`  ${f}: ${s.size} bytes`);
  }
}

main().catch((e) => console.error("Fatal:", e));