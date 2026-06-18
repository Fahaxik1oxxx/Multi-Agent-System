# CHANGELOG — 多智能体协作系统

> 基于 AG2 框架的多角色协作系统，从 4 角色演进至 8 Agent + 1 Router，支持编程/写作/分析/问答/闲聊 5 种任务自动分流。

---

## 2.3 — 2026-06-18

### 修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | Tester 上下文污染（跨对话引用 LRU Cache） | `clear_history=True` 不清 GroupChat messages | 每次 `_run_slow` 前显式 `mgr.groupchat.messages.clear()` |
| 2 | 临时 .py 脚本残留 | Coder 每次执行写文件 | `_cleanup_temp_files()` 清理 `tmp_code_*` 子目录 |
| 3 | 图片文件损坏导致 st.image 崩溃 | Coder 用 write_file 写空 PNG 文件 | 过滤 < 100 字节图片 + try/except 兜底 |
| 4 | 报告文件不可见 | 报告存到 coding/ 不及时扫描 | 改为保存到 `reports/report_{idx}.md` 并追加到文件列表 |
| 5 | 按钮不展开 UI | button key 与 session_state key 同名 | 分离为 `btn_report_{idx}` / `report_{idx}` |
| 6 | analyze_data 用 eval() 危险 | LLM 生成的表达式含中文导致 GBK 崩溃 | 改为纯 pandas API 的 group_by+agg_col 分组汇总 |
| 7 | visualize_data 中文乱码 | Pillow 默认字体不支持中文 | 加载 `msyh.ttc` 渲染标题/标签 |
| 8 | Coder 生成文件不可见 | `_scan_generated_files` 不递归扫描子目录 | 改为 `coding/**/*.ext` 递归 glob |

### 变更

- **正文输出重构**：编程/分析任务正文自动包含代码块 + 报告，去掉所有 `[:300]`/`[:500]` 截断
- **工具注册按角色分派**：Retriever 仅 `search_knowledge`，Coder 有 `write_file`/`read_file`/`calculate`，Tester 仅 `read_file`
- **文件扫描加入 `.py` 扩展名**：Coder 的 Python 代码产出可被扫描和展示
- **知识库检索加相关性阈值**：`min_score=0.40` 过滤低相关结果
- **KB search 显示相关度**：结果附带 `[第N页, 相关度0.xx]` 便于判断质量
- **库存放路径**: `coding/report_*.md` → `reports/report_*.md`
- **思考卡片改进**：最新消息默认展开，标题显示发言链，滚动高度 400→500px

---

## 2.2 — 2026-06-18

### 新增

- **Pillow 图表工具**：`visualize_data(path, chart_type, save_as)` 纯 Python 绘制柱状图/折线图，自动识别标签列和数值列
- **分组绘图支持**：`group_by`/`agg_col` 参数先分组汇总再绘图
- **CJK 字体加载**：依次尝试 `msyh.ttc`/`simhei.ttf`/`simsun.ttc` 确保中文正常

### 修复

- **Router 全部分类为闲聊**：禁用 DeepSeek thinking 模式 + max_tokens 20→50
- **分析关键词兜底**：chat.py 正则检测「分析」开头强制慢车道
- **编码前缀兼容**：`_resolve_path` 统一处理 `coding/` 前缀和裸路径

---

## 2.1 — 2026-06-17

### 新增

- **用户消息 markdown 转义**：`escape_md(md)` 函数防止 # 标题、**加粗** 等特殊字符被错误渲染
- **Router 搜索规则**：prompt 新增搜索/查资料/检索/查找知识 关键词检测，命中后优先于非Python降级
- **侧边栏对话目录**：最近 10 条聊天记录，点击 JS scrollIntoView 跳转到对应消息
- **搜索任务走 writing lane**：命中搜索关键词时，task_type="写作"，避免 Coder 空转

### 变更

- **思考 UI 重构**：checkbox 开关 → `st.expander` + 独立滚动容器（max-height: 400px），收起按钮始终可见
- **渲染顺序调整**：thinking card 统一渲染在正文前
- **统一 st.markdown**：去掉 `st.code` 判断，所有 Agent 消息用 `.markdown()` 渲染，### 等标识符正常解析
- **删 Summarizer 1500 字截断**：改为 Planner 优先策略，摘要长度提到 800 字
- **搜索检测升级**：优先级高于非Python语言降级

### 修复

- 右对齐 CSS 导致画面错乱（已回退）
- 跳转 JS 的 `document.getElementById` → `window.parent.document.getElementById`（iframe 兼容）

---

## 2.0 — 2026-06-16

### 新增

- **Router 意图分类器**：直接 HTTP API 调用 LLM 进行意图分类，不进入 GroupChat，分类速度 < 0.5s，失败时默认降级为 (闲聊, 轻)
- **快慢车道分离**：Router 判定复杂度，轻量任务（闲聊/问答）→ Bot 秒回（无 thinking card）；重量任务 → GroupChat 全链路协作
- **双 Lane 状态机**：coding lane（编程/分析）与 writing lane（写作/策划）使用不同的 Agent 链和 max_round
- **非 Python 语言降级**：正则检测 C/Java/Rust/Go/Swift/C++/C#/TypeScript，强制降级为 Bot 快车道，避免 coding lane 卡死
- **ChromaDB 知识库**：支持 PDF/TXT 上传，BAAI/bge-small-zh-v1.5 嵌入，相似度检索
- **Streamlit 前端**：st.chat_input 聊天界面 + thinking card 折叠组件 + 报告生成按钮
- **软超时 90s**：慢车道超时后不 kill 线程，收集已有中间结果返回用户
- **MODEL_POOL + ROLE_MODEL 分离**：所有模型配置集中在 config.py，不同设备只需改一个文件
- **按钮触发报告生成**：Summarizer 按需汇总执行过程为结构化 Markdown 报告

### 变更

- 角色数扩展：4 → 8 Agent（Planner/Bot/Retriever/Coder/Writer/Tester/Summarizer/User）+ 1 Router
- 自定义状态机重构：从单条 pipeline 变为 coding/writing 双 Lane，发言规则全部显式定义
- max_round 优化：coding 18→12，writing 14→10（仍保留 2 轮修复余量）
- OpenAI create 方法 patch：自动禁用 DeepSeek thinking 模式 + 增加 NoneType 防护

### 修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | Ollama 502 | 系统代理拦截 localhost | `NO_PROXY=localhost,127.0.0.1` |
| 2 | HF 下载超时 | HuggingFace 被墙 | `HF_ENDPOINT=https://hf-mirror.com` |
| 3 | tqdm OSError | sys.stdout 替换破坏 Streamlit 输出 | 删除 `sys.stdout = open(...)` |
| 4 | Function not found | `_function_map` 注册范围不足 | 注册到全部 8 Agent + 2 Manager |
| 5 | DeepSeek 400 | thinking 模式 reasoning_content 字段冲突 | 换 `deepseek-chat` + create 补丁 |
| 6 | NoneType.replace | Tester 响应 content 为 None | 状态机条件路由 + null guard |
| 7 | C 语言卡死 | 非 Python 语言走 coding lane 无限重试 | 正则拦截 + 软超时 90s |
| 8 | GroupChat 无限循环 | max_round 过大（18/14） | 压缩至 12/10 |

---

## 1.0 — 2026-06-11

- 初始版本，AG2 四角色（Coder/Tester/Optimizer/User）
- 自定义状态机 speaker_selection，exitcode 驱动流程分支，最多 2 轮修复迭代
- 弱写强查：Coder=Qwen 7B（免费），Tester/Optimizer=DeepSeek Flash
- 协作任务：带过期时间的 LRU Cache（set/get/ttl/惰性删除）
- speaking_log 发言顺序记录，运行结束后自动打印
