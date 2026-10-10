// 检查 chat.html / skills.html 中 onclick 引用的函数是否都已定义
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

for (const file of ['chat.html', 'skills.html']) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    let js = '';
    blocks.forEach(b => {
        const inner = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
        if (!/^\s*$/.test(inner)) js += inner + '\n';
    });
    // onclick="..." 属性值里的函数名
    const used = new Set();
    const attrRe = /on(?:click|input|change|keydown|keyup|keypress)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(html))) {
        const fnRe = /([a-zA-Z_]\w*)\s*\(/g;
        let fm;
        while ((fm = fnRe.exec(m[1]))) used.add(fm[1]);
    }
    // 定义
    const defined = new Set();
    const re2 = /(?:function\s+([A-Za-z_]\w*)|const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:function|\())/g;
    while ((m = re2.exec(js))) { if (m[1]) defined.add(m[1]); if (m[2]) defined.add(m[2]); }
    const missing = [...used].filter(f => !defined.has(f));
    console.log(file + ': onclick 引用 ' + used.size + ' 个函数, 未定义: ' + (missing.length ? missing.join(', ') : '无'));
}
