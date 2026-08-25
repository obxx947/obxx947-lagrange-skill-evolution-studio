# -*- coding: utf-8 -*-
# ============================================================
# 阿里云函数计算 · 自定义运行时（Python）代理：智谱 GLM 免费 API
# ------------------------------------------------------------
# 启动命令：python3 app.py    监听端口：9000
# 环境变量：GLM_API_KEY = 你的智谱免费 Key
# 零依赖（仅标准库 http.server / urllib）
# ============================================================

import os
import json
import urllib.request
import urllib.error
import http.server
import socketserver

GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
PORT = int(os.environ.get('PORT', 9000))

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body=b'', ctype='application/json'):
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS 预检
        self._send(204, b'')

    def do_POST(self):
        key = os.environ.get('GLM_API_KEY', '')
        if not key:
            self._send(500, json.dumps({'error': {'message': 'GLM_API_KEY 未配置（请在环境变量中添加）'}}).encode('utf-8'))
            return
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            body = self.rfile.read(length)
            req = urllib.request.Request(
                GLM_URL,
                data=body,
                method='POST',
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                self._send(resp.status, resp.read())
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read())
        except Exception as e:
            self._send(502, json.dumps({'error': {'message': '代理转发失败: ' + str(e)[:200]}}).encode('utf-8'))

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
        print('[lagrange-glm-proxy] listening on port ' + str(PORT), flush=True)
        httpd.serve_forever()
