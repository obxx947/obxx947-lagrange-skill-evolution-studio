import { pipeline, env } from '@huggingface/transformers';
// 走国内镜像下载 bge-small-zh-v1.5（huggingface.co 直连不通）
env.remoteHost = 'https://hf-mirror.com';

const MODEL = 'Xenova/bge-small-zh-v1.5';
const extract = await pipeline('feature-extraction', MODEL, { dtype:'q8' });

function cos(a,b){ let d=0,na=0,nb=0; for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/Math.sqrt(na*nb); }
async function vec(t, isQuery){ const p = isQuery ? '为这个句子生成表示以用于检索相关文章：' : ''; const o = await extract(p+t, {pooling:'mean', normalize:true}); return Array.from(o.data); }

const q = await vec('护卫舰的人口有多少', true);
const dShip = await vec('护卫舰服役上限10，人口3');
const dBattle = await vec('战斗机制的伤害计算');
const dCarm = await vec('航母的机位与编队');
const dAir = await vec('十六鱼配蓝石雷火的战报分析');

console.log('向量维度:', q.length);
console.log('cos(query护卫舰人口, 护卫舰服役上限) =', cos(q,dShip).toFixed(4));
console.log('cos(query护卫舰人口, 战斗伤害机制)   =', cos(q,dBattle).toFixed(4));
console.log('cos(query护卫舰人口, 航母机位)       =', cos(q,dCarm).toFixed(4));
console.log('cos(query护卫舰人口, 十六鱼战报)     =', cos(q,dAir).toFixed(4));
console.log('判断: 护卫舰块 应显著高于 战斗/航母 块 =>', cos(q,dShip) > cos(q,dBattle) && cos(q,dShip) > cos(q,dCarm) ? 'PASS(词汇/语义方向合理)' : '检查');
