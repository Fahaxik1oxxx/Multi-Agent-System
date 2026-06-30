"""
ChromaDB 知识库封装 —— 建库、检索、文档管理。

依赖：langchain-community, chromadb, sentence-transformers
首次运行会自动下载 BAAI/bge-small-zh-v1.5 嵌入模型。

自 Task 4 起，所有函数均需 user_id 参数，实现按用户物理隔离存储。
"""

import os
import shutil
import threading
import logging
import time

_logger = logging.getLogger(__name__)
_locks: dict[str, threading.Lock] = {}

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_embeddings = None
_vectorstores: dict[str, tuple] = {}  # 按 user_id 缓存 (Chroma 实例, last_access_timestamp)
_VS_TTL = 30 * 60  # 30 minutes


def _get_user_dirs(user_id: str):
    """返回 (documents_dir, chroma_db_dir)，按 user_id 物理隔离。
    目录不存在时自动创建。"""
    docs = os.path.join(BASE_DIR, "rag", "documents", user_id)
    db = os.path.join(BASE_DIR, "rag", "chroma_db", user_id)
    os.makedirs(docs, exist_ok=True)
    os.makedirs(db, exist_ok=True)
    return docs, db


def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-small-zh-v1.5",
            model_kwargs={"local_files_only": True},
        )
    return _embeddings


def _get_lock(user_id: str) -> threading.Lock:
    """返回 user_id 对应的互斥锁，不存在时创建。"""
    if user_id not in _locks:
        _locks[user_id] = threading.Lock()
    return _locks[user_id]


def _evict_cached_vs(user_id: str):
    """安全淘汰缓存的 vectorstore 实例。"""
    global _vectorstores
    old_vs = _vectorstores.pop(user_id, None)
    if old_vs is not None:
        if isinstance(old_vs, tuple):
            old_vs = old_vs[0]
        if hasattr(old_vs, "_client"):
            try:
                old_vs._client.close()
                if hasattr(old_vs._client, "_system"):
                    old_vs._client._system.stop()
            except Exception:
                pass


def _get_vectorstore(user_id: str):
    """按 user_id 加载向量库，带 TTL 缓存淘汰。"""
    now = time.time()

    global _vectorstores
    # 淘汰过期条目
    expired = [uid for uid, (_, ts) in _vectorstores.items() if now - ts > _VS_TTL]
    for uid in expired:
        _evict_cached_vs(uid)

    if user_id in _vectorstores:
        vs, _ = _vectorstores[user_id]
        _vectorstores[user_id] = (vs, now)
        return vs

    docs_dir, persist_dir = _get_user_dirs(user_id)
    emb = _get_embeddings()
    if os.path.exists(os.path.join(persist_dir, "chroma.sqlite3")):
        vs = Chroma(persist_directory=persist_dir, embedding_function=emb)
        _vectorstores[user_id] = (vs, now)
        return vs
    return None


def build_index(user_id: str) -> int:
    """扫描用户文档目录下所有 PDF/TXT，重建索引（线程安全，事务性）。"""
    with _get_lock(user_id):
        return _build_index_locked(user_id)


def _load_and_chunk_documents(user_id: str) -> list:
    """遍历文档目录，加载并切分。损坏文件跳过并记录警告。"""
    docs_dir, _ = _get_user_dirs(user_id)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )

    all_chunks = []
    errors = []

    for fname in sorted(os.listdir(docs_dir)):
        fpath = os.path.join(docs_dir, fname)
        try:
            if fname.endswith(".pdf"):
                loader = PyPDFLoader(fpath)
                pages = loader.load()
            elif fname.endswith(".txt"):
                loader = TextLoader(fpath, encoding="utf-8")
                pages = loader.load()
            else:
                continue

            chunks = splitter.split_documents(pages)
            valid = [c for c in chunks if c.page_content and c.page_content.strip()]
            all_chunks.extend(valid)
        except Exception as e:
            _logger.warning(f"跳过损坏文件 {fname}: {e}")
            errors.append({"file": fname, "error": str(e)})

    if not all_chunks and errors:
        raise RuntimeError(f"所有文件处理失败: {errors}")

    return all_chunks


def _build_index_locked(user_id: str) -> int:
    """带锁的实际重建逻辑：先建到临时目录，成功后原子替换。"""
    docs_dir, persist_dir = _get_user_dirs(user_id)
    tmp_dir = persist_dir + "_tmp"

    # 1. 清理残留临时目录
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 2. 加载并切分文档（单文件异常隔离）
    chunks = _load_and_chunk_documents(user_id)
    if not chunks:
        return 0

    # 3. 建到临时目录
    emb = _get_embeddings()
    vs = Chroma.from_documents(documents=chunks, embedding=emb, persist_directory=tmp_dir)
    vs.persist()

    # 4. 淘汰旧缓存并关闭连接
    _evict_cached_vs(user_id)

    # 5. 原子替换（Windows: os.rename 对已存在目录返回 PermissionError）
    if os.path.exists(persist_dir):
        shutil.rmtree(persist_dir)
    try:
        os.rename(tmp_dir, persist_dir)
    except OSError:
        # Windows 回退：跨驱动器或目标残留时用 copytree
        shutil.copytree(tmp_dir, persist_dir)
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return len(chunks)


def search(query: str, user_id: str, k: int = 3, min_score: float = 0.40) -> list[str]:
    """检索用户知识库，返回前 k 条结果（含页码 + 相关度），低于 min_score 的结果被丢弃"""
    vs = _get_vectorstore(user_id)
    if vs is None:
        return []
    docs_with_scores = vs.similarity_search_with_relevance_scores(query, k=k)
    result = []
    for d, score in docs_with_scores:
        if score < min_score:
            continue
        page = d.metadata.get("page", "?")
        content = d.page_content[:300]  # 截断避免过长
        result.append(f"[第{page + 1}页, 相关度{score:.2f}] {content}")
    return result


def get_document_list(user_id: str) -> list[str]:
    """列出用户 documents/ 下的文件名"""
    docs_dir, _ = _get_user_dirs(user_id)
    if not os.path.exists(docs_dir):
        return []
    return [f for f in os.listdir(docs_dir) if f.endswith((".pdf", ".txt"))]


def get_stats(user_id: str) -> dict:
    """返回用户知识库统计信息（不触发模型下载）"""
    docs = get_document_list(user_id)
    _, persist_dir = _get_user_dirs(user_id)
    db_path = os.path.join(persist_dir, "chroma.sqlite3")
    if not os.path.exists(db_path):
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    vs = _get_vectorstore(user_id)
    if vs is None:
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    return {"文档数": len(docs), "切片数": vs._collection.count(), "就绪": True}
