"""
工具系统 —— 供 AG2 角色调用的函数。

read_file / write_file / search_knowledge 通过
autogen.register_function 注册给各角色。
"""

import os

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(PROJECT_DIR, "coding")


def _resolve_path(path: str) -> str:
    """兼容 coding/ 前缀：如果路径已以 coding/ 开头，直接用 PROJECT_DIR；
    否则拼接到 WORK_DIR 下。"""
    if path.startswith("coding/"):
        return os.path.join(PROJECT_DIR, path)
    return os.path.join(WORK_DIR, path)


def read_file(path: str) -> str:
    """读取 coding/ 下的文件"""
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"
    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path: str, content: str) -> str:
    """写文件到 coding/ 目录"""
    full_path = _resolve_path(path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"[成功] 已写入 {path}"


def search_knowledge(query: str) -> str:
    """从知识库检索相关文档内容，自动过滤低相关性结果"""
    try:
        from rag.knowledge_base import search
        results = search(query)
        if not results:
            return "知识库中未找到相关信息，请使用自身知识完成任务。"
        # 过滤掉过短/明显不相关的内容（如只有一个词的碎片）
        filtered = [r for r in results if len(r.strip()) > 50]
        if not filtered:
            return "知识库中未找到相关信息，请使用自身知识完成任务。"
        return "\n\n---\n\n".join(filtered[:3])  # 最多返回前 3 条
    except Exception as e:
        return f"[检索失败] {e}"


def calculate(expression: str) -> str:
    """安全执行数学表达式，返回计算结果。仅支持常数、四则运算、abs/round/min/max/pow"""
    import ast
    import operator as _op

    _SAFE_BUILTINS = {"abs": abs, "round": round, "min": min, "max": max,
                      "pow": pow, "int": int, "float": float, "len": len}
    _SAFE_OPS = {
        ast.Add: _op.add, ast.Sub: _op.sub, ast.Mult: _op.mul,
        ast.Div: _op.truediv, ast.FloorDiv: _op.floordiv,
        ast.Mod: _op.mod, ast.Pow: _op.pow, ast.USub: _op.neg,
    }

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.BinOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"不支持的操作符: {type(node.op).__name__}")
            return op(_eval(node.left), _eval(node.right))
        if isinstance(node, ast.UnaryOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"不支持的操作符: {type(node.op).__name__}")
            return op(_eval(node.operand))
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in _SAFE_BUILTINS:
                args = [_eval(a) for a in node.args]
                return _SAFE_BUILTINS[node.func.id](*args)
            raise ValueError("仅支持内置函数: abs, round, min, max, pow, int, float, len")
        raise ValueError(f"不支持的表达式类型: {type(node).__name__}")

    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _eval(tree)
        return str(result)
    except Exception as e:
        return f"[计算错误] {e}"


def analyze_data(path: str, group_by: str = "", agg_col: str = "") -> str:
    """
    自动分析 CSV/Excel 文件：自动检测文本列（分组）和数值列（汇总），
    按指定列分组求和，返回降序排列的结果。
    
    参数：
      path:     文件路径（相对于 coding/）
      group_by: 分组列名（留空则自动选第一列文本列）
      agg_col:  汇总列名（留空则自动选第一列数值列）
    """
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"
    try:
        import pandas as pd
    except ImportError:
        return "[错误] pandas 未安装，请执行 pip install pandas"
    try:
        if path.endswith(".csv"):
            df = pd.read_csv(full_path)
        elif path.endswith((".xlsx", ".xls")):
            df = pd.read_excel(full_path)
        else:
            return "[错误] 仅支持 .csv / .xlsx / .xls 文件"

        # 打印列名供参考
        col_info = f"列名: {list(df.columns)}（共 {len(df)} 行）\n"

        # 自动检测文本列和数值列
        num_cols = df.select_dtypes(include=["number"]).columns.tolist()
        obj_cols = df.select_dtypes(exclude=["number"]).columns.tolist()

        # 使用指定的或自动选择的列
        gb = group_by if group_by in df.columns else (obj_cols[0] if obj_cols else "")
        ac = agg_col if agg_col in df.columns else (num_cols[0] if num_cols else "")

        if not gb or not ac:
            return col_info + "[提示] 未能自动识别分组列和数值列，请指定 group_by 和 agg_col 参数"

        result = df.groupby(gb)[ac].sum().sort_values(ascending=False)
        lines = [f"{k}: {v}" for k, v in result.items()]
        return col_info + "\n".join(lines[:50])  # 最多显示 50 行
    except Exception as e:
        return f"[分析错误] {e}"


def visualize_data(path: str, chart_type: str = "bar", save_as: str = "chart.png",
                   group_by: str = "", agg_col: str = "") -> str:
    """
    读取 coding/ 下的 CSV，自动识别标签列和数值列，
    支持按 group_by 分组汇总 agg_col 后再绘图（留空则用自动识别），
    用 Pillow 绘制统计图表并保存。

    path:      文件路径
    chart_type: bar(柱状图) / line(折线图)
    save_as:   输出文件名（保存到 coding/ 下）
    group_by:  分组列名（留空自动选）
    agg_col:   汇总列名（留空自动选）
    返回保存路径，供报告引用。
    """
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"

    try:
        import pandas as pd
    except ImportError:
        return "[错误] pandas 未安装"
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return "[错误] Pillow 未安装，请执行 pip install Pillow"

    # 加载中文字体
    _FONT_PATHS = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    _cjk_font = None
    _title_font = None
    _label_font = None
    _font_file = ""
    for fp in _FONT_PATHS:
        if os.path.exists(fp):
            try:
                _cjk_font = ImageFont.truetype(fp, 14)
                _title_font = ImageFont.truetype(fp, 22)
                _label_font = ImageFont.truetype(fp, 12)
                _font_file = fp
                break
            except Exception:
                continue

    try:
        df = pd.read_csv(full_path)
    except Exception as e:
        return f"[错误] 无法读取 CSV: {e}"

    # 先做分组汇总（如果指定了 group_by 和 agg_col）
    if group_by and group_by in df.columns and agg_col and agg_col in df.columns:
        df = df.groupby(group_by, as_index=False)[agg_col].sum().sort_values(agg_col, ascending=False)

    # 自动选择标签列和数值列
    num_cols = df.select_dtypes(include=["number"]).columns
    obj_cols = df.select_dtypes(exclude=["number"]).columns
    if len(obj_cols) == 0 or len(num_cols) == 0:
        return "[错误] CSV 需至少包含一列文本和一列数值"

    label_col = obj_cols[0]
    val_col = num_cols[0]
    labels = df[label_col].astype(str).tolist()
    values = df[val_col].tolist()
    max_val = max(values) if values else 1
    n = len(labels)

    W, H = 800, 500                      # 画布
    ML, MR = 80, 40                      # 左右边距
    MT, MB = 60, 80                      # 上下边距
    CW = W - ML - MR                     # 图表宽
    CH = H - MT - MB                     # 图表高

    img = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    font = _cjk_font  # 简写

    # 标题
    title = f"{label_col} × {val_col}" if group_by else f"{label_col} 汇总"
    if _title_font:
        draw.text((ML, 10), title, fill=(30, 30, 30), font=_title_font)

    if chart_type == "line":
        # ====== 折线图 ======
        draw.line([ML, MT, ML, H - MB], fill="black", width=2)
        draw.line([ML, H - MB, W - MR, H - MB], fill="black", width=2)
        for i in range(6):
            y_val = max_val * i / 5
            y = H - MB - int(CH * i / 5)
            draw.line([ML - 5, y, ML, y], fill="black")
            draw.text((5, y - 8), f"{y_val:.0f}", fill="black", font=font)
        pts = []
        for i, (label, val) in enumerate(zip(labels, values)):
            x = ML + i * CW // (n - 1) if n > 1 else ML + CW // 2
            y = H - MB - int((val / max_val) * CH)
            pts.append((x, y))
            draw.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(66, 133, 244))
            draw.text((x - 12, H - MB + 5), label[:6], fill="black", font=font)
        for i in range(1, len(pts)):
            draw.line([pts[i - 1], pts[i]], fill=(66, 133, 244), width=3)
    else:
        # ====== 柱状图 ======
        step = CW // n if n > 0 else CW
        bar_w = min(step // 3, 36)
        draw.line([ML, MT, ML, H - MB], fill="black", width=2)
        draw.line([ML, H - MB, W - MR, H - MB], fill="black", width=2)
        for i in range(6):
            y_val = max_val * i / 5
            y = H - MB - int(CH * i / 5)
            draw.line([ML - 5, y, ML, y], fill="black")
            draw.text((5, y - 8), f"{y_val:.0f}", fill="black", font=font)
        for i, (label, val) in enumerate(zip(labels, values)):
            x_c = ML + i * step + step // 2
            bh = int((val / max_val) * CH)
            x0, y0 = x_c - bar_w // 2, H - MB - bh
            x1, y1 = x_c + bar_w // 2, H - MB
            draw.rectangle([x0, y0, x1, y1], fill=(66, 133, 244), outline=(40, 100, 200))
            draw.text((x_c - 10, H - MB + 5), label[:6], fill="black", font=font)

    # 保存
    full_save = os.path.join(WORK_DIR, save_as)
    img.save(full_save)
    return f"[成功] 图表已保存至 {save_as}（{len(labels)} 条{chart_type}图）"
