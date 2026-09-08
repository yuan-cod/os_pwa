# -*- coding: utf-8 -*-
"""把 os题目.txt 解析为 os_pwa/data/chN.json 草稿（a/x 留空——题库暂无答案与解析，
多小题选项做成组合形式，组合定义在 tools/fixups.json，解析时直接套用）"""
import re, json, os, sys

SRC = r"D:\PersonalDownload\408\os题目.txt"
OUT = r"D:\PersonalDownload\408\os_pwa\data"
os.makedirs(OUT, exist_ok=True)

NAMES = [
    "1.1 操作系统的基本概念", "1.2 操作系统发展历程", "1.3 操作系统的运行环境",
    "2.1 进程的概念和特征", "2.2 CPU调度", "2.3 同步与互斥", "2.4 死锁",
    "3.1 内存管理概念", "3.2 虚拟内存管理",
    "4.1 文件系统基础", "4.2 目录与文件", "4.3 文件系统",
    "5.1 I/O管理概述", "5.2 设备独立性软件", "5.3 磁盘和固态硬盘",
]

text = open(SRC, encoding="utf-8").read()
text = text.replace("\ufeff", "")
# 源文本定点修复：\(2^7\) 是被 LaTeX 化的 "27"（题号 27 与页面序列中的 27）；
# 真正的数学式 2^7 用的是 $...$ 写法（如 $2^7$），不受影响
text = text.replace("\\(2^7\\)", "27")
text = text.replace("\\\\(", "\\(")   # 源文本个别位置双反斜杠（如 \\min 所在选项）

LATEX_CMDS = {
    "min": "min", "max": "max", "mu": "μ", "times": "×", "div": "÷", "pm": "±",
    "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠",
    "approx": "≈", "cdot": "·", "lfloor": "⌊", "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉",
}

def strip_latex(s: str) -> str:
    s = s.replace("\u2011", "-")                     # 非断行连字符
    for _ in range(5):                               # 嵌套 LaTeX 需多轮才能剥净
        prev = s
        s = re.sub(r"\\text\{([^{}]*)\}", r"\1", s)
        s = re.sub(r"\\mathrm\{([^{}]*)\}", r"\1", s)
        s = re.sub(r"\\\((.+?)\\\)", r"\1", s)
        s = re.sub(r"\$([^$]*)\$", r"\1", s)
        if s == prev:
            break
    # LaTeX 命令替换并吞掉其后紧跟的一个空格（如 \mu s -> μs）
    s = re.sub(r"\\([a-zA-Z]+) ?", lambda m: LATEX_CMDS.get(m.group(1), m.group(1)), s)
    s = re.sub(r"\^\{([^}]*)\}", r"^(\1)", s)        # ^{...}
    s = re.sub(r"_\{([^}]*)\}", r"_(\1)", s)         # _{...}
    return s

def clean(s: str) -> str:
    s = strip_latex(s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s

def code_clean(line: str) -> str:
    """代码行：剥 LaTeX 后把空格换成不换行空格，保留缩进"""
    return strip_latex(line).replace(" ", "\u00a0").replace("\t", "\u00a0\u00a0\u00a0\u00a0").rstrip()

QNUM = re.compile(r"^(\d{1,2})[．.]\s*(.*)$")
OPT = re.compile(r"^([A-D])[．.、]\s*(.*)$")
SUB = re.compile(r"^[①②③④⑤]\s*$")
SUBINLINE = re.compile(r"^[①②③④⑤][\s　]")

def split_opts(rest: str):
    """一行里 A.xx B.yy C.zz D.ww -> 按空格前的 B/C/D. 拆分"""
    return re.split(r"\s+(?=[B-D][．.])", rest)

sections = []   # list of {"title", "lines"}
cur = None
for rawline in text.splitlines():
    line = rawline.rstrip()
    if line.startswith("# "):
        title = line[2:].strip()
        if any(s["title"] == title for s in sections):   # 文件尾部整段重复的 5.2.8，只保留第一份
            cur = None
            continue
        cur = {"title": title, "lines": []}
        sections.append(cur)
        continue
    if cur is not None and not line.startswith("##"):
        cur["lines"].append(line)

parsed_sections = []
for sec in sections:
    questions = []
    q = None  # dict: num, stem[], opts[], multipart, table[]
    for line in sec["lines"]:
        if not line.strip():
            if q is not None and q["code_on"]:
                q["stem"].append("")                 # 代码块内的空行保留
            continue
        if line.strip() == "---":
            continue
        # 代码围栏
        if line.strip().startswith("```"):
            if q is None:
                continue
            q["code_on"] = not q["code_on"]
            continue
        if q is not None and q["code_on"]:
            q["stem"].append(code_clean(line))       # 按原位置并入题干，保持代码顺序
            continue
        m = QNUM.match(line)
        if m and (q is None or not line.startswith("|")):
            if q is not None:
                questions.append(q)
            q = {"num": int(m.group(1)), "stem": [clean(m.group(2))],
                 "opts": [], "multipart": False, "code_on": False}
            continue
        if q is None:
            continue
        # 表格行（跳过分隔行 | ---- |），按原位置并入题干
        if line.startswith("|"):
            if not re.match(r"^\|[\s:|\-]+\|$", line.strip()):
                q["stem"].append(clean(line))
            continue
        if line.startswith(">"):
            q["stem"].append(clean(line[1:].strip()))
            continue
        # ①/② 单独一行或多小题标记行（其选项文本并入题干，正式选项由 fixups 组合提供）
        if SUB.match(line.strip()) or SUBINLINE.match(line):
            q["multipart"] = True
            q["stem"].append(clean(line))
            continue
        if q["multipart"]:
            q["stem"].append(clean(line))
            continue
        mo = OPT.match(line)
        if mo:
            letter = mo.group(1)
            rest = mo.group(2)
            pieces = split_opts(rest)
            q["opts"].append((letter, clean(pieces[0])))
            for extra in pieces[1:]:
                em = re.match(r"([B-D])[．.、]\s*(.*)$", extra.strip())
                if em:
                    q["opts"].append((em.group(1), clean(em.group(2))))
            continue
        # 普通续行并入题干
        q["stem"].append(clean(line))
    if q is not None:
        questions.append(q)
    parsed_sections.append({"title": sec["title"], "questions": questions})

assert len(parsed_sections) == len(NAMES), f"章节数不符: {len(parsed_sections)}"

# 个别源文本题目的定点修正：(章, 题号) -> {字段: 值}
PATCH = {
    # 1.2 Q13 是四空选择题（分时/批处理/实时/微机），原选项只是四个词无法作答，组合化
    (1, 13): {"o": {
        "A": "分时操作系统、批处理操作系统、实时操作系统、微型计算机操作系统",
        "B": "批处理操作系统、分时操作系统、实时操作系统、微型计算机操作系统",
        "C": "分时操作系统、实时操作系统、批处理操作系统、微型计算机操作系统",
        "D": "分时操作系统、批处理操作系统、微型计算机操作系统、实时操作系统",
    }},
    # 2.1 Q22 是六空选择题（C 程序内容位于进程实体的哪一段），组合化；正确顺序：堆/栈/栈/堆/正文段/PCB
    (3, 22): {"o": {
        "A": "堆段、栈段、栈段、堆段、正文段、PCB",
        "B": "栈段、栈段、栈段、堆段、正文段、PCB",
        "C": "堆段、堆段、栈段、栈段、正文段、PCB",
        "D": "堆段、栈段、栈段、堆段、PCB、正文段",
    }},
    # 2.2 Q16 是四空选择题，原选项 E（剥夺式优先级）混入题干，组合化并清理题干
    (4, 16): {
        "q": "若每个作业只能建立一个进程，为了照顾短作业用户，应采用（）；为了照顾紧急作业用户，应采用（）；为了能实现人机交互，应采用（）；而能使短作业、长作业和交互作业用户都满意，应采用（）。",
        "o": {
            "A": "短作业优先调度算法、剥夺式优先级调度算法、时间片轮转调度算法、多级反馈队列调度算法",
            "B": "先来先服务调度算法、剥夺式优先级调度算法、时间片轮转调度算法、多级反馈队列调度算法",
            "C": "短作业优先调度算法、先来先服务调度算法、时间片轮转调度算法、多级反馈队列调度算法",
            "D": "短作业优先调度算法、剥夺式优先级调度算法、先来先服务调度算法、多级反馈队列调度算法",
        },
    },
}

# 多小题组合选项（与 net_pwa 同套路，键为 "章-题号"）
FIXUPS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixups.json")
fixups = json.load(open(FIXUPS_PATH, encoding="utf-8")) if os.path.exists(FIXUPS_PATH) else {}

chapters = []
report = []
for i, (sec, name) in enumerate(zip(parsed_sections, NAMES)):
    items = []
    seen = set()
    for qq in sec["questions"]:
        if qq["num"] in seen:
            # 源文件同一节里第二组题重新从 10 编号（如 1.3 的外核/引导/虚拟机组），顺延编号保证唯一
            new_num = max(seen) + 1
            report.append(f"[ch{i}] 题号 {qq['num']} 重复，顺延为 {new_num}")
            qq["num"] = new_num
        seen.add(qq["num"])
        stem = "<br>".join(qq["stem"])
        o = {}
        for letter, val in qq["opts"]:
            if letter in o:
                report.append(f"[ch{i}] Q{qq['num']} 选项 {letter} 重复: {val}")
            o[letter] = val
        key = f"{i}-{qq['num']}"
        if qq["multipart"] and key in fixups:
            o = fixups[key]["o"]
        patch = PATCH.get((i, qq["num"]), {})
        if patch.get("o"):
            o = patch["o"]
        if patch.get("q"):
            stem = patch["q"]
        items.append({"id": qq["num"], "q": stem, "o": o,
                      "a": "", "x": "", "_mp": qq["multipart"]})
    chapters.append({"idx": i, "name": name, "count": len(items)})
    with open(os.path.join(OUT, f"ch{i}.json"), "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT, "chapters.json"), "w", encoding="utf-8") as f:
    json.dump(chapters, f, ensure_ascii=False, indent=1)

# ---------- 体检 ----------
total = sum(c["count"] for c in chapters)
print("章节:", len(chapters), "总题数:", total)
for c in chapters:
    print(f'  ch{c["idx"]:>2} {c["name"]}  {c["count"]}题')
print("---- 警告 ----")
issues = []
for i in range(len(parsed_sections)):
    for it in json.load(open(os.path.join(OUT, f"ch{i}.json"), encoding="utf-8")):
        tag = f"[ch{i}] Q{it['id']}"
        if not it["q"].strip():
            issues.append(f"{tag} 题干为空")
        if not it["o"]:
            issues.append(f"{tag} 无选项")
        for k, v in it["o"].items():
            if not v.strip():
                issues.append(f"{tag} 选项 {k} 为空")
            if k not in "ABCD":
                issues.append(f"{tag} 非法选项键 {k}")
        for field, val in (("q", it["q"]),) + tuple(("o" + k, v) for k, v in it["o"].items()):
            for bad in ("\\", "$", "\\(", "\\text", "\\mathrm"):
                if bad in val:
                    issues.append(f"{tag} {field} 残留 {bad!r}: {val[:70]}")
issues += report
print("\n".join(issues) if issues else "(无)")
mps = [(i, it["id"]) for i in range(len(parsed_sections))
       for it in json.load(open(os.path.join(OUT, f"ch{i}.json"), encoding="utf-8")) if it["_mp"]]
print("多小题(组合选项):", mps if mps else "(无)")
missing_fix = [k for k in mps if f"{k[0]}-{k[1]}" not in fixups]
if missing_fix:
    print("!! 多小题缺少 fixups 组合选项:", missing_fix)
