#!/usr/bin/env bash
# =====================================================================
# 用一张源 PNG 生成 Android 全部尺寸的 launcher icon
#
# 用法:
#   ./scripts/generate-android-icons.sh
#
# 前提:
#   android-app/icon-source.png 存在 (任意尺寸 PNG, 推荐 ≥512×512)
#   python3 + Pillow (pip3 install Pillow)
#
# 输出:
#   android-app/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/
#     ic_launcher.png         (legacy 圆角矩形 launcher, 全图填满)
#     ic_launcher_round.png   (legacy 圆 launcher, 全图填满)
#     ic_launcher_foreground.png (adaptive icon 前景, Android 8+, 中心 66% 留安全裁切区)
#   并改 mipmap-anydpi-v26/ic_launcher.xml 引用 PNG 前景
#
# 为什么 adaptive foreground 要缩到中心 66% ?
#   Android 8+ launcher 把 108dp 的 foreground 跟 background 合成后再裁成
#   圆 / 圆角方 / 水滴 / 等几何形状. 只有中心 66dp×66dp 区域是 OS 保证可见的,
#   外圈 21dp 是裁切余量. 如果业主源图边缘有内容 (logo 贴边), 在圆形 launcher
#   上就会被裁掉. 解决方法是把源图缩小放到中心 66% 区域, 周围留透明.
# =====================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$PROJECT_ROOT/android-app/icon-source.png"
RES_DIR="$PROJECT_ROOT/android-app/app/src/main/res"

if [[ ! -f "$SOURCE" ]]; then
  echo "❌ 找不到源图: $SOURCE"
  echo "请把 logo PNG 保存到这个路径 (任意尺寸, 推荐 ≥512×512, 边缘留 30% 透明更好)"
  exit 1
fi

if ! python3 -c "from PIL import Image" 2>/dev/null; then
  echo "❌ 需要 Python Pillow. 装一下:"
  echo "   pip3 install --user Pillow"
  exit 1
fi

echo "→ 源图: $SOURCE"
echo "  策略: legacy 全图填满, adaptive foreground 缩到中心 66% 留安全裁切区"

python3 - <<PYTHON
from PIL import Image
import os

SRC = "$SOURCE"
RES = "$RES_DIR"

src = Image.open(SRC).convert("RGBA")
print(f"  源图尺寸: {src.size[0]}x{src.size[1]}")

# Android 5 个 density, 每个对应一个 legacy 尺寸 + 一个 adaptive foreground 尺寸 (108dp)
specs = [
    ("mdpi",    48, 108),
    ("hdpi",    72, 162),
    ("xhdpi",   96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi",192, 432),
]

# adaptive icon 中心可见区域比例 — 66/108 ≈ 0.611 是 Android 规范, 这里用 0.66
# (71/108) 给业主 logo 多一点视觉占比, 在最常见的 squircle / round mask 都 fill 满
INNER_RATIO = 0.66

for density, icon_size, fg_size in specs:
    target_dir = os.path.join(RES, f"mipmap-{density}")
    os.makedirs(target_dir, exist_ok=True)

    # 1. legacy ic_launcher (Android 7-): 全图填满, 因为老系统直接按 PNG 形状显示
    legacy = src.resize((icon_size, icon_size), Image.LANCZOS)
    legacy.save(os.path.join(target_dir, "ic_launcher.png"))
    legacy.save(os.path.join(target_dir, "ic_launcher_round.png"))

    # 2. adaptive foreground (Android 8+): 透明 canvas + 缩小源图居中
    inner = round(fg_size * INNER_RATIO)
    canvas = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
    inner_img = src.resize((inner, inner), Image.LANCZOS)
    offset = (fg_size - inner) // 2
    # paste with mask = inner_img itself 保留源图自带 alpha (透明背景的 logo 正确合成)
    canvas.paste(inner_img, (offset, offset), inner_img if inner_img.mode == "RGBA" else None)
    canvas.save(os.path.join(target_dir, "ic_launcher_foreground.png"))

    print(f"  ✓ {density}: legacy {icon_size}×{icon_size} + fg {fg_size}×{fg_size} (inner {inner}, padding {offset})")
PYTHON

# 删旧的 vector ic_launcher_foreground.xml (如果上次 build 留下来)
OLD_VECTOR="$RES_DIR/drawable/ic_launcher_foreground.xml"
if [[ -f "$OLD_VECTOR" ]]; then
  rm "$OLD_VECTOR"
  echo "✓ 删旧 vector drawable: drawable/ic_launcher_foreground.xml"
fi

# 改 mipmap-anydpi-v26/ic_launcher.xml 引用 mipmap 前景 (不是 drawable)
ADAPTIVE_DIR="$RES_DIR/mipmap-anydpi-v26"
mkdir -p "$ADAPTIVE_DIR"
cat > "$ADAPTIVE_DIR/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
cp "$ADAPTIVE_DIR/ic_launcher.xml" "$ADAPTIVE_DIR/ic_launcher_round.xml"
echo "✓ mipmap-anydpi-v26/ic_launcher.xml: foreground 改用 @mipmap/ic_launcher_foreground"

echo ""
echo "✅ 图标生成完毕. 下一步:"
echo "   1. git add android-app/"
echo "   2. git commit -m 'chore(android): 重新生成 launcher icon (修裁切)'"
echo "   3. 升 versionCode + versionName"
echo "   4. git push → 自动 build 新 APK"
echo "   5. 后台 → APP 版本 → 升 versionCode + 改 downloadUrl"
