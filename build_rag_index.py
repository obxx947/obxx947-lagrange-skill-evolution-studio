#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
离线预处理：把前端知识库文档向量化，生成静态向量库 data/rag_index.json。
前端(js/rag_client.js)加载该文件即可用"完整向量检索"，用户无需本地做语义分析。

用法（提供可用 embedding 后再跑）：
    python build_rag_index.py --api-key <KEY> [--api-url <URL>] [--model <M>] [--fb <桌面前端目录>]

- 默认读: <fb>/拉格朗日智能体3/data/knowledge(*.md) + data/knowledge_backup(*.txt,含子目录)
- 默认写: 一份到 <fb>/拉格朗日智能体3/data/rag_index.json, 一份到 <fb>/lglr.html/data/rag_index.json
- embedding 走 OpenAI 兼容 /embeddings（智谱 base 含 /api/paas/v4 -> +/embeddings；其它补 /v1/embeddings）
- query_source 记录为 'api'，前端据此选择 query 向量来源
"""
import os, json, sys, time, argparse, urllib.request, urllib.error

def norm(s): return str(s).replace("\\","/")

def chunk_text(text, size=500, overlap=0, chunk_index=0):
    """与 kb.js 一致的简单字符滑动分块"""
    chunks=[]; text=text or ""
    i=0
    step=max(1, size-overlap)
    while i < len(text):
        seg=text[i:i+size]
        if not seg.strip(): break
        chunks.append({"content": seg, "chunkIndex": len(chunks)})
        i += step
    return chunks

def collect_docs(fb):
    """返回 [(source, text)]，source 与 kb.js 一致：备份加 backup/ 前缀"""
    docs=[]
    base1=os.path.join(fb,"拉格朗日智能体3","data","knowledge")
    base2=os.path.join(fb,"拉格朗日智能体3","data","knowledge_backup")
    for d,label in ((base1,''), (base2,'backup/')):
        if not os.path.isdir(d): print("跳过不存在目录:",d); continue
        for dp,_,fns in os.walk(d):
            for fn in sorted(fns):
                if not fn.lower().endswith(('.md','.txt')): continue
                full=os.path.join(dp,fn)
                rel=os.path.relpath(full,d).replace("\\","/")
                try:
                    txt=open(full,encoding='utf-8',errors='replace').read()
                except Exception as e:
                    print("读取失败",full,e); continue
                docs.append((label+rel, txt))
    return docs

def chunk_all(docs, size=500):
    out=[]
    for source,txt in docs:
        for c in chunk_text(txt, size=size):
            out.append({"content": c["content"], "source": source, "chunkIndex": c["chunkIndex"]})
    return out

def embed_batch(url, key, model, texts):
    """返回 list[list[float]]（L2归一化）"""
    if not url or not key:
        raise RuntimeError("需要提供 --api-url 与 --api-key（当前无可用 embedding 资源）")
    u = (url.rstrip('/').rstrip('/embeddings'))
    endpoint = u+'/embeddings' if u.endswith('/v4') else u+'/v1/embeddings'
    body=json.dumps({"model":model,"input":texts}).encode('utf-8')
    req=urllib.request.Request(endpoint, data=body, headers={
        "Content-Type":"application/json","Authorization":"Bearer "+key})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d=json.loads(r.read().decode('utf-8'))
            vecs=[x["embedding"] for x in d.get("data",[])]
            # L2 归一化
            import math
            normed=[]
            for v in vecs:
                s=math.sqrt(sum(x*x for x in v)); normed.append([x/s if s else x for x in v])
            return normed
        except urllib.error.HTTPError as e:
            body_s=e.read().decode('utf-8','replace')
            if e.code==429 and attempt<3:
                print("  embedding 429, 等待重试..."); time.sleep(5*(attempt+1)); continue
            raise RuntimeError(f"embedding HTTP {e.code}: {body_s[:200]}")
    raise RuntimeError("embedding 重试耗尽")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--api-key", default=os.environ.get("EMBED_API_KEY",""))
    ap.add_argument("--api-url", default=os.environ.get("EMBED_API_URL","https://open.bigmodel.cn/api/paas/v4"))
    ap.add_argument("--model", default=os.environ.get("EMBED_MODEL","embedding-3"))
    ap.add_argument("--fb", default="C:/Users/Administrator/Desktop")
    ap.add_argument("--size", type=int, default=500)
    ap.add_argument("--batch", type=int, default=8)
    args=ap.parse_args()

    if not args.api_key:
        print("[ERROR] 未提供 embedding API Key（当前无可用 embedding 资源）。请在获取可用 key 后运行：")
        print("  python build_rag_index.py --api-key <KEY> [--api-url <URL>] [--model <MODEL>]")
        sys.exit(2)

    print("[1/4] 收集文档 ...")
    docs=collect_docs(args.fb)
    print("     文档数", len(docs))
    chunks=chunk_all(docs, args.size)
    print("     分块数", len(chunks))
    if not chunks: print("[ERROR] 无文档"); sys.exit(1)

    print("[2/4] 生成向量（model=%s, url=%s, batch=%d）..."%(args.model, args.api_url, args.batch))
    vecs=[]
    for i in range(0, len(chunks), args.batch):
        batch=chunks[i:i+args.batch]
        out=embed_batch(args.api_url, args.api_key, args.model, [c["content"][:800] for c in batch])
        vecs.extend(out)
        if (i//args.batch)%5==0: print("     %d/%d"%(min(i+args.batch,len(chunks)),len(chunks)))
    dim=len(vecs[0]) if vecs else 0
    payload={
        "model": args.model, "dim": dim, "query_source": "api",
        "generatedAt": int(time.time()), "chunk_count": len(chunks),
        "chunks": [{"content":c["content"],"source":c["source"],"chunkIndex":c["chunkIndex"],"vector":v}
                   for c,v in zip(chunks,vecs)]
    }

    print("[3/4] 写出 rag_index.json（源1=拉格朗日智能体3, 源2=lglr.html）...")
    outs=[
        os.path.join(args.fb,"拉格朗日智能体3","data","rag_index.json"),
        os.path.join(args.fb,"lglr.html","data","rag_index.json"),
    ]
    for o in outs:
        os.makedirs(os.path.dirname(o), exist_ok=True)
        with open(o,"w",encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        print("     ", o, "->", os.path.getsize(o)//1024, "KB")

    print("[4/4] 完成: dim=%d, chunks=%d, query_source=%s"%(dim, len(chunks), payload["query_source"]))

if __name__=="__main__":
    main()
