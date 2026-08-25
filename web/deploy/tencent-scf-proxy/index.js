// ============================================================
// 腾讯云函数（SCF）代理：智谱 GLM 免费 API（隐藏 Key + CORS）
// ------------------------------------------------------------
// 零依赖（仅用 Node 内置 https 模块，Node 16/18 均可用）
// 用途：workers.dev 在国内不可达时的国内替代。Key 藏云函数环境变量。
// 部署：控制台「上传 zip」创建，见 部署说明.md
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

function jsonRes(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...corsHeaders() }, body: JSON.stringify(obj) };
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

// 腾讯云函数入口（HTTP 触发，Web 函数 / API 网关）
exports.main_handler = async (event, context) => {
  const method = event.httpMethod || '';

  // CORS 预检
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (method !== 'POST') {
    return jsonRes(404, { error: { message: 'Not Found' } });
  }

  const key = process.env.GLM_API_KEY;
  if (!key) {
    return jsonRes(500, { error: { message: 'GLM_API_KEY 未配置（请在云函数环境变量中添加）' } });
  }

  try {
    const body = event.body || '';
    const rawBody = event.isBase64Encoded
      ? Buffer.from(body, 'base64').toString('utf-8')
      : body;

    const up = await forwardToZhipu(rawBody, key);
    return {
      statusCode: up.statusCode,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: up.body,
      isBase64Encoded: false,
    };
  } catch (e) {
    return jsonRes(502, { error: { message: '代理转发失败: ' + String(e.message || e).substring(0, 200) } });
  }
};
