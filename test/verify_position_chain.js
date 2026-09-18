/* 站位链路终检：知识库站位文件 ↔ 舰船库 ↔ AI查询包 三方逐条一致 */
const fs=require('fs');
const J=JSON.parse(fs.readFileSync('data/ship_database.json','utf8'));
const arr=Array.isArray(J)?J:(J.ships||[]);
const dbPos={}; arr.forEach(s=>{ dbPos[s.name]=s.position; });

// 1) 语料（AI 实际检索用的块）
const corpus=JSON.parse(fs.readFileSync('data/kb_corpus.json','utf8'));
const posChunks=corpus.chunks.filter(c=>/^舰船站位/.test(c.source||''));
console.log('语料总块数: '+corpus.chunks.length+'   站位文件块: '+posChunks.length);

let total=0, wrong=[], seen={};
posChunks.forEach(c=>{
    c.content.split('\n').forEach(ln=>{
        const m=ln.match(/^(.+?)—(前排|中排|后排|aircraft)\s*$/);
        if(!m) return;
        const [_,name,pos]=m;
        total++;
        if(seen[name]) wrong.push(name+' 在语料里出现多次');
        seen[name]=pos;
        if(dbPos[name]!==pos) wrong.push(name+': 语料='+pos+' 库='+dbPos[name]);
    });
});
console.log('语料里解析出站位条目: '+total);
const nonAir=arr.filter(s=>s.type!=='fighter'&&s.type!=='corvette');
const missing=nonAir.map(s=>s.name).filter(n=>!seen[n]);
const airInCorpus=Object.keys(seen).filter(n=>seen[n]==='aircraft');
console.log('库中非战机/护航艇: '+nonAir.length+'   语料覆盖: '+(nonAir.length-missing.length));
console.log('缺漏: '+(missing.length?missing.join(', '):'（无）'));
console.log('语料里误收战机/护航艇: '+(airInCorpus.length?airInCorpus.join(', '):'（无）'));
console.log('不一致: '+(wrong.length?wrong.join('\n  '):'（无）'));

// 2) 向量索引
const rag=JSON.parse(fs.readFileSync('data/rag_index.json','utf8'));
const rp=(rag.chunks||[]).filter(c=>/^舰船站位/.test(c.source||''));
console.log('\n向量索引: dim='+rag.dim+' chunks='+rag.chunk_count+'  站位块='+rp.length
    +'  各维度='+rp.map(c=>c.vector.length).join(','));

// 3) kb.js 兜底清单
const kbjs=fs.readFileSync('js/kb.js','utf8');
const inList=posChunks.filter(c=>kbjs.indexOf("'"+c.source.replace(/^.*\//,'')+".md'")>=0);
console.log('kb.js FILE_LIST 已含: '+inList.length+'/4');

// 4) AI 查询包
const D='C:\\Users\\Administrator\\Desktop\\拉格朗日_舰船人口服役_AI查询\\';
const sd=JSON.parse(fs.readFileSync(D+'ship_data.json','utf8'));
let packBad=[];
sd.forEach(e=>{ const s=arr.find(x=>x.id===e.id); if(s && e.pos!==s.position) packBad.push(e.id); });
const mdtxt=fs.readFileSync(D+'00_全部舰船_人口服役对比表.md','utf8');
const mdRows=(mdtxt.match(/｜\s*站位\s*(前排|中排|后排|aircraft)/g)||[]).length;
console.log('\nAI查询包 ship_data.json: '+sd.length+' 条, 站位不符 '+packBad.length+' 条');
console.log('对比表 md 带站位行: '+mdRows+'  应为 196');

// 5) 三副本
const files=['data/ship_database.json','data/kb_corpus.json','data/rag_index.json','js/kb.js',
             'data/knowledge/舰船站位-超主力.md','data/knowledge/舰船站位-巡洋舰.md',
             'data/knowledge/舰船站位-驱逐舰.md','data/knowledge/舰船站位-护卫舰.md'];
const crypto=require('crypto');
const h=p=>crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
let diffFiles=[];
files.forEach(f=>{
    const a=h(f), b=h('C:/Users/Administrator/Desktop/lglr.html/'+f), c=h('C:/Users/Administrator/Desktop/拉格朗日智能体/web/'+f);
    if(!(a===b&&a===c)) diffFiles.push(f);
});
console.log('\n三副本一致性: '+(diffFiles.length? ('不一致 → '+diffFiles.join(', ')) : '全部一致 ('+files.length+' 个文件)'));

const okAll = !wrong.length && !missing.length && !airInCorpus.length && rp.length===4
    && rp.every(c=>c.vector.length===512) && inList.length===4 && !packBad.length
    && mdRows===196 && !diffFiles.length && nonAir.length===total;
console.log('\n' + (okAll ? '✅ 全部一致' : '⚠️ 见上方异常'));
