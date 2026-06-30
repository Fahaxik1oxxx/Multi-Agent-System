# 新增功能：联网搜索（Web Search）开关

基于 `frontend-ui-recovery`（`23d29e1`）→ `feat/web-search-toggle`（`43f9a51`）的全部改动。

---

## 后端（5 个文件）

### 1. `router/router.py`

**`ChatRequest` 新增 web_search_enabled 字段**

```diff
     lane_mode: str = Field(default="auto")
     project_id: str | None = Field(default=None)
     history: list = Field(default_factory=list)
+    web_search_enabled: bool = Field(default=False)
```

原因：前端通过 POST body 告知是否开启联网搜索。

---

### 2. `router/stream.py`

**initial_state 传入 web_search_enabled 和 web_search_results**

```diff
             fix_count=0,
             thinking=[],
             final_output="",
+            web_search_enabled=data.get("web_search_enabled", False),
+            web_search_results="",
```

原因：将前端开关和空搜索结果传给 LangGraph 初始状态。

---

### 3. `router/stream_graph.py`（核心改动）

#### 3a. 新增 import

```diff
+import datetime
+from datetime import timedelta
 from typing import TypedDict, Annotated
```

```diff
 from agents import create_llm, SYSTEM_PROMPTS
-from tools import search_knowledge
+from tools import search_knowledge, web_search
```

原因：`web_search_node` 需要 `datetime` 做日期替换和关键词增强，需要导入 `web_search` 工具。

#### 3b. `StreamWorkflowState` 新增字段

```diff
     fix_count: int
     thinking: Annotated[list, operator.add]
     final_output: str
+    web_search_enabled: bool
+    web_search_results: str
```

原因：LangGraph state 承载开关和搜索结果。

#### 3c. `bot_node` — 搜索开启时注入时间 + 搜索结果 + 约束

```diff
 def bot_node(state: StreamWorkflowState) -> dict:
     session = state["session"]
     logger.info("stream_graph | bot_node | enter | input=%s", state["user_input"][:60])
-    prompt = f"{get_prompt('Bot', state)}\n\n用户输入: {state['user_input']}"
+    prompt = f"{get_prompt('Bot', state)}\n\n"
+    if state.get("web_search_results"):
+        now = datetime.datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
+        prompt += f"当前时间: {now}（北京时间）\n\n"
+        prompt += (
+            "以下为联网搜索结果（每个结果以 [webpage N] 标记）：\n"
+            f"{state['web_search_results']}\n\n"
+            "请严格遵循：\n"
+            "1. 仅基于以上搜索结果回答，不要编造搜索结果中不存在的细节。\n"
+            "2. 如果搜索结果中不包含用户所需信息，请如实告知「未搜索到相关信息」。\n"
+            "3. 在回答中使用 [citation:N] 标注信息来源编号。\n\n"
+        )
+    prompt += f"用户输入: {state['user_input']}"
```

原因：搜索开启时注入搜索结果和严格约束，要求 Bot 基于搜索结果回答并用 `[citation:N]` 标注；关闭时 Bot 用自身知识正常回答。

#### 3d. `planner_node` — 同上

```diff
 def planner_node(state: StreamWorkflowState) -> dict:
     ...
-    prompt = f"{get_prompt('Planner', state)}\n{extra}\n\n用户需求: {state['user_input']}"
+    prompt = f"{get_prompt('Planner', state)}\n{extra}\n\n"
+    if state.get("web_search_results"):
+        now = datetime.datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
+        prompt += f"当前时间: {now}（北京时间）\n\n"
+        prompt += (
+            "以下为联网搜索结果（每个结果以 [webpage N] 标记）：\n"
+            f"{state['web_search_results']}\n\n"
+            "请严格遵循：\n"
+            "1. 仅基于以上搜索结果进行规划，不要编造搜索结果中不存在的细节。\n"
+            "2. 如果搜索结果中不包含用户所需信息，请在计划中注明「未搜索到相关信息」。\n"
+            "3. 可使用 [citation:N] 标注信息来源编号。\n\n"
+        )
+    prompt += f"用户需求: {state['user_input']}"
```

原因：同 bot_node，Planner 在搜索开启时也注入搜索结果。

#### 3e. `retriever_node` — 搜索开启时注入

```diff
         f"知识库检索结果：{kb_result}\n"
+    )
+    if state.get("web_search_results"):
+        prompt += f"联网搜索结果：{state['web_search_results']}\n"
+    prompt += "\n请总结与任务最相关的信息。"
-    f"知识库检索结果：{kb_result}\n\n"
-    f"请总结与任务最相关的信息。"
```

#### 3f. `coder_node` — 搜索开启时注入

```diff
         f"知识库参考：{state.get('knowledge', '')}\n\n"
     )
+    if state.get("web_search_results"):
+        prompt += f"联网搜索结果：{state['web_search_results']}\n\n"
     if state.get("test_result") and "✅" in state.get("test_result", ""):
```

#### 3g. `writer_node` — 搜索开启时注入

```diff
         f"参考资料：{state.get('knowledge', '')}\n\n"
     )
+    if state.get("web_search_results"):
+        prompt += f"联网搜索结果：{state['web_search_results']}\n\n"
     if state.get("test_result") and "✅" in state.get("test_result", ""):
```

#### 3h. 新增 `web_search_node()`（完整函数）

```python
# —— 联网搜索节点 ——
def web_search_node(state: StreamWorkflowState) -> dict:
    enabled = state.get("web_search_enabled", False)
    if not enabled:
        return {"web_search_results": "", "thinking": []}

    session = state["session"]
    push(session, {"type": "agent_start", "name": "WebSearch"})

    now = datetime.datetime.now()
    query = state["user_input"]
    augmented = (
        query.replace("今天", now.strftime("%Y年%m月%d日"))
        .replace("昨天", (now - timedelta(days=1)).strftime("%Y年%m月%d日"))
        .replace("明天", (now + timedelta(days=1)).strftime("%Y年%m月%d日"))
        .replace("现在", now.strftime("%Y年%m月%d日"))
    )

    # 用 LLM 提取搜索关键词
    try:
        llm = create_llm("Bot", temperature=0)
        kw_prompt = (
            "你是一个搜索引擎关键词提取器。将用户的问题转化为 2-4 个搜索引擎关键词，"
            "用空格分隔。只输出关键词，不要任何其他文字。\n"
            f"用户问题：{augmented}"
        )
        extracted = llm.invoke(kw_prompt).content.strip()
        if 3 < len(extracted) < 100:
            augmented = extracted
    except Exception:
        pass

    date_str = now.strftime("%Y年%m月%d日")
    month_str = now.strftime("%Y年%m月")

    search_queries = [augmented]
    if month_str not in augmented:
        search_queries.append(f"{month_str} {query}")
    if date_str not in augmented:
        search_queries.append(f"{date_str} {query}")
    search_queries = list(dict.fromkeys(search_queries))

    seen_urls = set()
    formatted = []
    page_num = 0
    for sq in search_queries[:3]:
        raw = web_search.invoke(sq)
        for line in raw.split("\n\n"):
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            parts = line.split("\n", 1)
            if len(parts) < 2:
                continue
            url = parts[1].rsplit("\n", 1)[-1].strip() if "\n" in parts[1] else ""
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            page_num += 1
            formatted.append(f"[webpage {page_num}]\n{parts[1]}\n[/webpage {page_num}]")
            if page_num >= 8:
                break
        if page_num >= 8:
            break

    results_text = "\n\n".join(formatted) if formatted else "未找到相关结果。"
    push(session, {"type": "token", "name": "WebSearch", "content": results_text})
    push(session, {"type": "agent_end", "name": "WebSearch", "content": results_text})
    logger.info("stream_graph | web_search_node | queries=%s | pages=%d", search_queries, page_num)
    return {
        "web_search_results": results_text,
        "thinking": [{"name": "WebSearch", "content": results_text}],
    }
```

原因：在 LangGraph 入口处新增预搜索节点。开关关闭时直接返回空结果；开启时：替换时间词 → LLM 提取关键词 → 多组搜索词去重 → Bing 搜索 → 结果去重 → `[webpage N]` 格式化 → 推流到前端。

#### 3i. 图入口改为 `__start__ → web_search → _route_lane`

```diff
 def build_stream_workflow() -> StateGraph:
-    logger.info("stream_graph | build_static | 8 agent nodes, 6 conditional edges")
+    logger.info("stream_graph | build_static | 9 agent nodes, 7 conditional edges")
     ...
     wf.add_node("summarizer", summarizer_node)
-    wf.set_conditional_entry_point(_route_lane)
+    wf.add_node("web_search", web_search_node)
+    wf.add_edge("__start__", "web_search")
+    wf.add_conditional_edges("web_search", _route_lane)
```

原因：每条消息先走搜索节点决定是否搜索，再路由到 Bot/Planner。

---

### 4. `tools.py`

**`web_search()` 从 DuckDuckGo 重写为 Bing 网页抓取**

```diff
 def web_search(query: str, max_results: int = 5) -> str:
     try:
-        from duckduckgo_search import DDGS
+        import requests
+        import re
+
+        headers = {
+            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
+            "Accept-Language": "zh-CN,zh;q=0.9",
+        }
+        resp = requests.get(
+            "https://www.bing.com/search",
+            params={"q": query, "count": min(max_results, 10), "mkt": "zh-CN"},
+            headers=headers,
+            timeout=10,
+        )
+        resp.raise_for_status()
+
+        blocks = re.findall(r'<li\s+class="b_algo"[^>]*>(.*?)</li>', resp.text, re.DOTALL)
+        results = []
+        for block in blocks:
+            title_match = re.search(r'<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL)
+            snippet_match = re.search(r'<div class="b_caption"[^>]*><p[^>]*>(.*?)</p>', block, re.DOTALL)
+            if title_match and len(results) < max_results:
+                url = title_match.group(1)
+                title = re.sub(r'<[^>]+>', '', title_match.group(2)).strip()
+                snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip() if snippet_match else ""
+                results.append(f"{len(results)+1}. **{title}**\n   {snippet[:200]}\n   {url}")

-        with DDGS() as ddgs:
-            results = list(ddgs.text(query, max_results=min(max_results, 10)))
         if not results:
             return "未找到相关结果。请尝试更换搜索词。"
-        lines = []
-        for i, r in enumerate(results, 1):
-            lines.append(f"{i}. **{r['title']}**\n   {r['body'][:200]}\n   {r['href']}")
-        return "\n\n".join(lines)
-    except ImportError:
-        return "[错误] duckduckgo_search 未安装"
+        return "\n\n".join(results)
+    except ImportError as e:
+        return f"[错误] 缺少依赖: {e}"
     except Exception as e:
         return f"[搜索失败] {e}"
```

原因：DuckDuckGo 在国内不可用（路由到 Bing 但 HTML 解析失败）；改用 `requests` + `re` 直接抓 Bing。`lxml.cssselect` 无法安装（PEP 668），`re` 是内置模块。

---

### 5. `agents.py`

**删除 Bot 和 Planner 中不存在的 web_search tool 指令**

```diff
     "Planner": (
         ...
         "只规划到「编写代码片段」这一步，编译/运行由用户自行完成，task_type 标为 coding。\n"
-        "如用户提问涉及最新资讯/实时信息/当前事件，首先使用 web_search 工具搜索获取最新数据。\n"
         "分析类任务（数据分析/CSV/Excel/统计/图表）→ task_type: analysis。"
     ),
     "Bot": (
         "你是友好的 AI 助手。用简洁、自然的中文直接回答用户。\n"
         "闲聊时友善亲切；问答时准确清晰，不啰嗦。\n"
-        "如果用户问及最新资讯、实时新闻、当前事件或你不确定的信息，使用 web_search 工具搜索后回答。\n"
         "如果是简单的编程问题（如「Hello World」「怎么写冒泡排序」），"
```

原因：旧提示让 LLM 调用不存在的 `web_search` tool，导致 LLM 假装搜索并编造结果。搜索已改为预搜索节点（`web_search_node`），不需要 LLM 自己调用工具。

---

## 前端（4 个文件）

### 6. `frontend/src/hooks/useStreamChat.ts`

**`startStream()` 新增 `webSearchEnabled` 参数**

```diff
     onComplete?: (reply: string, thinking: Array<{name: string; content: string}>, taskType: string) => void,
+    webSearchEnabled: boolean = false,
   ) => {
```

**POST body 传入 `web_search_enabled`**

```diff
         history: [],
+        web_search_enabled: webSearchEnabled,
       });
```

原因：新增参数（放在 `onComplete` 之后保持向后兼容），POST 时传给后端。

---

### 7. `frontend/src/pages/chat/V3ChatPage.tsx`

**导入 `Globe` 图标**

```diff
-import { Search, MessageSquare, Plus, ChevronLeft, ChevronRight, ChevronDown, Check, ArrowLeft } from 'lucide-react';
+import { Search, MessageSquare, Plus, ChevronLeft, ChevronRight, ChevronDown, Check, ArrowLeft, Globe } from 'lucide-react';
```

**`AGENT_META` / `ICONS` / `COLORS` 新增 `WebSearch`**

```diff
   Executor: { icon: '⚙️', color: '#8b5cf6' },
+  WebSearch: { icon: '🌐', color: '#10b981' },
 };
 
 const ICONS: Record<string, string> = {
   ...
   Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
+  WebSearch: '🌐',
 };
 const COLORS: Record<string, string> = {
   ...
-  Bot: '#10b981', Executor: '#8b5cf6',
+  Bot: '#10b981', Executor: '#8b5cf6', WebSearch: '#10b981',
 };
```

**新增 `webSearchEnabled` 状态**

```diff
   const [laneMode, setLaneMode] = useState<LaneMode>('auto');
+  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
```

**handleSend 传参 + useEffect deps 追加**

```diff
       await startStream(finalText, laneMode, projectId, (reply, thinking) => {
         // onComplete callback
-      });
+      }, webSearchEnabled);
     } catch {
       // handled by streaming.error
     }
-  }, [inputValue, streaming.isStreaming, laneMode, projectId, attachedFiles, startStream]);
+  }, [inputValue, streaming.isStreaming, laneMode, projectId, attachedFiles, startStream, webSearchEnabled]);
```

**欢迎区下方添加 🌐 联网搜索 pill**

```diff
+                    <span className={`text-xs px-2.5 py-1.5 rounded-full cursor-pointer select-none transition-colors flex items-center gap-1 ${webSearchEnabled ? 'bg-[#10b981] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
+                      onClick={() => setWebSearchEnabled(!webSearchEnabled)}>
+                      <Globe size={14} /> 联网搜索
+                    </span>
+                    <div className="w-px h-4 bg-[#e0e4e8]" />
```

**底部输入区上方添加同款 pill**

```diff
+                    <span className={`text-xs px-2.5 py-1.5 rounded-full cursor-pointer select-none transition-colors flex items-center gap-1 ${webSearchEnabled ? 'bg-[#10b981] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
+                      onClick={() => setWebSearchEnabled(!webSearchEnabled)}>
+                      <Globe size={14} /> 联网搜索
+                    </span>
+                    <div className="w-px h-4 bg-[#e0e4e8]" />
```

原因：新增用户可切换的 🌐 联网搜索开关 pill，显示在欢迎区和底部输入区；`handleSend` 携带开关值。

---

### 8. `frontend/src/components/shared/Markdown.tsx`

**解析前替换 `[citation:N]` 为 `<sup>` 上标**

```diff
     try {
-      const raw = marked.parse(text) as string;
+      const withCitations = text.replace(
+        /\[citation:(\d+)\]/g,
+        '<sup class="citation">[$1]</sup>'
+      );
+      const raw = marked.parse(withCitations) as string;
```

原因：LLM 回答中的 `[citation:1]` 引用标记渲染为蓝色上标，避免显示原始文本。

---

### 9. `frontend/src/index.css`

**新增 `.markdown-body sup.citation` 样式**

```diff
 .markdown-body img { max-width: 100%; border-radius: 8px; }
+.markdown-body sup.citation {
+  color: #4f8cff;
+  font-size: 0.75em;
+  font-weight: 600;
+  cursor: default;
+  user-select: none;
+}
```

原因：蓝色 `#4f8cff`、小号加粗，美化 citation 外观。
