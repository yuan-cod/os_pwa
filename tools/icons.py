# -*- coding: utf-8 -*-
"""生成 os_pwa 图标：绿色渐变圆角方块 + “操”字（与 icons/icon.svg 一致，WorkBuddy 绿色系）"""
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:\PersonalDownload\408\os_pwa\icons"
C1, C2 = (5, 159, 78), (43, 217, 119)  # #059f4e -> #2bd977

FONT = r"C:\Windows\Fonts\msyhbd.ttc"
import os
if not os.path.exists(FONT):
    FONT = r"C:\Windows\Fonts\msyh.ttc"

def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(C1, C2))
    return img

def make(size, rounded_ratio, text_ratio, out):
    base = gradient(size)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * rounded_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)
    td = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(size * text_ratio))
    bb = td.textbbox((0, 0), "操", font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    td.text(((size - w) / 2 - bb[0], (size - h) / 2 - bb[1]), "操",
            font=font, fill=(255, 255, 255, 255))
    img.save(out)

make(512, 112 / 512, 0.42, os.path.join(OUT, "icon-512.png"))
make(192, 112 / 512, 0.42, os.path.join(OUT, "icon-192.png"))
# maskable：全出血渐变，文字略小居中于安全区
make(512, 0, 0.36, os.path.join(OUT, "maskable-512.png"))
print("icons ok")
