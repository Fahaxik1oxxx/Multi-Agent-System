"""
ChromaDB 知识库封装 —— 建库、检索、文档管理。

依赖：langchain-community, chromadb, sentence-transformers
首次运行会自动下载 BAAI/bge-small-zh-v1.5 嵌入模型。
"""

import os
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCUMENTS_DIR = os.path.join(BASE_DIR, "rag", "documents")
PERSIST_DIR = os.path.join(BASE_DIR, "rag", "chroma_db")

_embeddings = None
_vectorstore = None


def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-small-zh-v1.5",
            model_kwargs={"local_files_only": True},
        )
    return _embeddings


def _get_vectorstore():
    global _vectorstore
    if _vectorstore is None:
        emb = _get_embeddings()
        if os.path.exists(os.path.join(PERSIST_DIR, "chroma.sqlite3")):
            _vectorstore = Chroma(
                persist_directory=PERSIST_DIR,
                embedding_function=emb,
            )
    return _vectorstore


def build_index():
    """扫描 documents/ 下所有 PDF/TXT，重建索引"""
    emb = _get_embeddings()
    docs = []
    for fname in os.listdir(DOCUMENTS_DIR):
        fpath = os.path.join(DOCUMENTS_DIR, fname)
        if fname.endswith(".pdf"):
            loader = PyPDFLoader(fpath)
            docs.extend(loader.load())
        elif fname.endswith(".txt"):
            loader = TextLoader(fpath, encoding="utf-8")
            docs.extend(loader.load())
    if not docs:
        return 0
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    Chroma.from_documents(
        documents=chunks,
        embedding=emb,
        persist_directory=PERSIST_DIR,
    )
    return len(chunks)


def search(query: str, k: int = 3, min_score: float = 0.40) -> list[str]:
    """检索知识库，返回前 k 条结果（含页码 + 相关度），低于 min_score 的结果被丢弃"""
    vs = _get_vectorstore()
    if vs is None:
        return []
    docs_with_scores = vs.similarity_search_with_relevance_scores(query, k=k)
    result = []
    for d, score in docs_with_scores:
        if score < min_score:
            continue
        page = d.metadata.get("page", "?")
        content = d.page_content[:300]  # 截断避免过长
        result.append(f"[第{page+1}页, 相关度{score:.2f}] {content}")
    return result


def get_document_list() -> list[str]:
    """列出 documents/ 下的文件名"""
    return [f for f in os.listdir(DOCUMENTS_DIR)
            if f.endswith((".pdf", ".txt"))]


def get_stats() -> dict:
    """返回知识库统计信息（不触发模型下载）"""
    docs = get_document_list()
    db_path = os.path.join(PERSIST_DIR, "chroma.sqlite3")
    if not os.path.exists(db_path):
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    vs = _get_vectorstore()
    if vs is None:
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    return {"文档数": len(docs), "切片数": vs._collection.count(), "就绪": True}
