// ============================================================
// Cloudflare Worker：智谱 GLM 免费 API 代理（隐藏 Key + CORS）
// ------------------------------------------------------------
// 用途：把智谱免费 Key 藏在 Worker 服务端，静态页（GitHub Pages /
//       安卓 APP WebView）只暴露 Worker 地址，公开部署也安全。
// 部署步骤（约 15 分钟，一次性）：
//   1. 注册 Cloudflare 免费账号：https://dash.cloudflare.com
//   2. Workers & Pages → Create → 粘贴本代码 → Deploy
//   3. 设置 → 变量与环境变量：GLM_API_KEY = 你的智谱免费 Key（见 open.bigmodel.cn）
//   4. 部署完成后得到 https://<worker名>.workers.dev
//   5. 静态页设置 → 连接方式选「Cloudflare Worker 代理」→ 填入上面的地址
// 说明：Worker 免费档每天约 10 万次请求，个人使用绰绰有余。
//       国内网络访问 *.workers.dev 可能不稳定，可绑定自己的域名（可选）。
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 只接受 POST 且路径以 /chat/completions 结尾（兼容 /v1/chat/completions）
    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return new Response(
        JSON.stringify({ error: { message: 'Not Found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    const key = env.GLM_API_KEY;
    if (!key) {
      return new Response(
        JSON.stringify({ error: { message: 'GLM_API_KEY 未配置（请在 Worker 设置→变量中添加）' } }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    // 原样转发到智谱（隐藏 Key）
    const body = await request.text();
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body,
    });

    // 转发响应 + 附加 CORS 头
    const headers = new Headers(resp.headers);
    for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
    return new Response(resp.body, { status: resp.status, headers });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
