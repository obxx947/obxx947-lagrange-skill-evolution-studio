// ============================================================
// 阿里云函数计算 · 自定义运行时 代理：智谱 GLM 免费 API
// ------------------------------------------------------------
// 模式：自定义运行时（Debian 10 / Node.js 任意版本），
//       本文件启动一个 HTTP 服务监听 9000 端口，FC 转发请求进来。
// 启动命令：node app.js      监听端口：9000
// 环境变量：GLM_API_KEY = 你的智谱免费 Key
// 零依赖（仅 Node 内置 http/https 模块）
// ============================================================

'use strict';

const http = require('http');
const https = require('https');

const GLM_HOST = 'open.bigmodel.cn';
const GLM_PATH = '/api/paas/v4/chat/completions';
const PORT = Number(process.env.PORT || 9000);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...corsHeaders() });
  res.end(JSON.stringify(obj));
}

// 转发到智谱（隐藏 Key）
function forwardToZhipu(rawBody, key) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: GLM_HOST,
      path: GLM_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(rawBody),
      },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('上游超时')); });
    req.write(rawBody);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const method = String(req.method || '').toUpperCase();

  // CORS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (method !== 'POST') {
    sendJson(res, 404, { error: { message: 'Not Found' } });
    return;
  }

  const key = process.env.GLM_API_KEY;
  if (!key) {
    sendJson(res, 500, { error: { message: 'GLM_API_KEY 未配置（请在函数环境变量中添加）' } });
    return;
  }

  try {
    // 读取请求体
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });

    const up = await forwardToZhipu(rawBody, key);
    res.writeHead(up.statusCode, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(up.body);
  } catch (e) {
    sendJson(res, 502, { error: { message: '代理转发失败: ' + String(e.message || e).substring(0, 200) } });
  }
});

server.listen(PORT, () => {
  console.log('[lagrange-glm-proxy] listening on port ' + PORT);
});
