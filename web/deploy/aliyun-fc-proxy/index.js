// ============================================================
// 阿里云函数计算（FC）代理：智谱 GLM 免费 API（隐藏 Key + CORS）
// ------------------------------------------------------------
// 零依赖（仅 Node 内置 https 模块）。Key 藏函数环境变量。
// 必须创建为「HTTP 函数（Web 函数）」模式，入口 index.handler
// 部署：控制台「上传代码」zip，见下方部署说明
// ============================================================

'use strict';

const https = require('https');

const GLM_HOST = 'open.bigmodel.cn';
const GLM_PATH = '/api/paas/v4/chat/completions';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function applyHeaders(resp, headers) {
  for (const [k, v] of Object.entries(headers)) resp.setHeader(k, v);
}

function sendJson(resp, statusCode, obj) {
  resp.setStatusCode(statusCode);
  resp.setHeader('Content-Type', 'application/json');
  applyHeaders(resp, corsHeaders());
  resp.send(JSON.stringify(obj));
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

// 阿里云 FC Web 函数（HTTP 函数）入口
exports.handler = async (req, resp, context) => {
  const method = String(req.method || '').toUpperCase();

  // CORS 预检
  if (method === 'OPTIONS') {
    resp.setStatusCode(204);
    applyHeaders(resp, corsHeaders());
    resp.send('');
    return;
  }
  if (method !== 'POST') {
    sendJson(resp, 404, { error: { message: 'Not Found' } });
    return;
  }

  const key = process.env.GLM_API_KEY;
  if (!key) {
    sendJson(resp, 500, { error: { message: 'GLM_API_KEY 未配置（请在函数环境变量中添加）' } });
    return;
  }

  try {
    // req.body 可能是 Buffer / string / 已解析对象
    let rawBody = '';
    if (Buffer.isBuffer(req.body)) rawBody = req.body.toString('utf-8');
    else if (typeof req.body === 'string') rawBody = req.body;
    else if (req.body && typeof req.body === 'object') rawBody = JSON.stringify(req.body);
    else rawBody = String(req.body || '');

    const up = await forwardToZhipu(rawBody, key);
    resp.setStatusCode(up.statusCode);
    resp.setHeader('Content-Type', 'application/json');
    applyHeaders(resp, corsHeaders());
    resp.send(up.body);
  } catch (e) {
    sendJson(resp, 502, { error: { message: '代理转发失败: ' + String(e.message || e).substring(0, 200) } });
  }
};
