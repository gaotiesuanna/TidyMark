#!/usr/bin/env python3
"""生成扩展图标：字母 T，竖笔底部收成书签 V 口。

用法：python3 tools/gen-icon.py        （输出到 public/icons/）

为什么直接画像素而不是用 SVG 光栅化：图标最小要用到 16px，
在那个尺寸上手调几何比缩放矢量清楚得多。8 倍超采样再 LANCZOS 缩小，
边缘干净且不需要额外依赖（只用 Pillow）。

改配色/形状后重新跑一遍即可，四个尺寸会一起更新。
"""
import pathlib

from PIL import Image, ImageDraw

SS = 8  # 超采样倍数
BG = (38, 38, 38, 255)     # neutral-800，与界面里的主按钮同色
FG = (255, 255, 255, 255)
SIZES = (16, 32, 48, 128)

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'icons'


def render(size: int) -> Image.Image:
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)

    bar_h = 0.13
    bar_bottom = 0.22 + bar_h
    # 横笔
    draw.rectangle([0.22 * s, 0.22 * s, 0.78 * s, bar_bottom * s], fill=FG)
    # 竖笔，底部收成书签的 V 口——同一个形既读作字母 T，也读作书签
    x0, x1 = 0.385, 0.615
    draw.polygon([
        (x0 * s, bar_bottom * s), (x1 * s, bar_bottom * s),
        (x1 * s, 0.80 * s), (0.50 * s, 0.665 * s), (x0 * s, 0.80 * s),
    ], fill=FG)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f'icon-{size}.png'
        render(size).save(path)
        print(f'wrote {path.relative_to(OUT_DIR.parent.parent)}')


if __name__ == '__main__':
    main()
