# -*- coding: utf-8 -*-
"""
站内 GLM 服务端 LLM 代理（OpenAI 兼容）
-------------------------------------
为前端 web/ 与安卓 APK 提供「免自配 key」的 LLM 调用：
- 只走 GLM-4.7-Flash（免费），不读取/不启用 DeepSeek 或其它个人 key。
- 多 key 轮换 + 429 退避重试，规避单 key 限流。
- CORS 由主应用开启（*），无鉴权（供前端/APP 内部使用）。
"""
import asyncio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import httpx
from config import GLM_API_KEYS, GLM_BASE_URL, GLM_MODEL

llm_proxy_router = APIRouter(tags=["LLM代理"])

_glm_key_idx = 0

def _next_key():
    global _glm_key_idx
    keys = GLM_API_KEYS or []
    if not keys:
        return None
    k = keys[_glm_key_idx % len(keys)]
    _glm_key_idx += 1
    return k

def _is429(status: int, text: str) -> bool:
    s = str(text).lower()
    return status == 429 or ("访问量过大" in s) or ("rate" in s) or ("too many" in s)

@llm_proxy_router.post("/v1/chat/completions")
async def v1_chat_completions(req: Request):
    try:
        body = await req.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "invalid json body"}})

    model = body.get("model") or GLM_MODEL
    messages = body.get("messages") or []
    tools = body.get("tools")
    temperature = body.get("temperature", 0.3)
    max_tokens = min(int(body.get("max_tokens", 4096) or 4096), 8192)  # 免费 GLM 稳妥上限

    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if tools:
        payload["tools"] = tools

    last_err = "未知错误"
    for attempt in range(4):
        key = _next_key()
        if not key:
            return JSONResponse(status_code=500, content={"error": {"message": "未配置 GLM API Key（请在 .env 设置 GLM_API_KEYS）"}})
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    f"{GLM_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=payload,
                )
            if r.status_code == 200:
                return JSONResponse(content=r.json())
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            if _is429(r.status_code, r.text) or r.status_code >= 500:
                await asyncio.sleep([0, 5, 10, 20][attempt])
                continue
            return JSONResponse(status_code=r.status_code, content={"error": {"message": last_err}})
        except Exception as e:
            last_err = str(e)
            await asyncio.sleep(2)

    return JSONResponse(status_code=503, content={"error": {"message": f"GLM 代理重试仍失败：{last_err}"}})
