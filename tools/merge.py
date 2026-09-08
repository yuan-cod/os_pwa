# -*- coding: utf-8 -*-
"""合并答案与解析到 data/chN.json，并做全面校验（题库暂无答案；以后补答案时使用）
用法：把每章答案写成 tools/ans/ans-NN.json，格式 {"题号": ["答案字母", "解析文字"], ...}
然后运行本脚本。a/x 为空的题目保留空（无答案模式）。"""
import json, os, sys

BASE = r"D:\PersonalDownload\408\os_pwa"
DATA = os.path.join(BASE, "data")
ANS = os.path.join(BASE, "tools", "ans")

fixups = json.load(open(os.path.join(BASE, "tools", "fixups.json"), encoding="utf-8"))
chapters = json.load(open(os.path.join(DATA, "chapters.json"), encoding="utf-8"))

errors, warnings, merged = [], [], 0
for ch in chapters:
    i = ch["idx"]
    items = json.load(open(os.path.join(DATA, f"ch{i}.json"), encoding="utf-8"))
    try:
        answers = json.load(open(os.path.join(ANS, f"ans-{i:02d}.json"), encoding="utf-8"))
    except FileNotFoundError:
        warnings.append(f"ch{i}: 暂无答案文件，跳过")
        continue
    for it in items:
        key = f"{i}-{it['id']}"
        mp = it.pop("_mp", False)
        if mp and key in fixups:
            it["o"] = fixups[key]["o"]
        a = answers.get(str(it["id"]))
        if a is None:
            warnings.append(f"ch{i} Q{it['id']}: 无答案，保留空")
            continue
        it["a"], it["x"] = a[0], a[1]
        merged += 1
        if it["a"] not in it["o"]:
            errors.append(f"ch{i} Q{it['id']}: 答案{it['a']}不在选项{sorted(it['o'])}中")
        if not it["x"].strip():
            errors.append(f"ch{i} Q{it['id']}: 解析为空")
        if not it["q"].strip() or any(not v.strip() for v in it["o"].values()):
            errors.append(f"ch{i} Q{it['id']}: 题干或选项为空")
    ch["count"] = len(items)
    with open(os.path.join(DATA, f"ch{i}.json"), "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)

with open(os.path.join(DATA, "chapters.json"), "w", encoding="utf-8") as f:
    json.dump(chapters, f, ensure_ascii=False, indent=1)

print(f"总题数: {sum(c['count'] for c in chapters)}，本次合并答案: {merged}")
if warnings:
    print("提示:\n" + "\n".join(warnings))
if errors:
    print(f"错误 {len(errors)} 个:\n" + "\n".join(errors))
    sys.exit(1)
print("校验通过：已合并的答案/选项/解析齐备")
