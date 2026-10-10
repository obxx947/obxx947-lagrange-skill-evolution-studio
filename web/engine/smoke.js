/* 独立引擎冒烟测试：跑一场 + 验证同种子可复现 */
const E = require('./lagrange_engine.js');
(async () => {
    const info = await E.init();
    console.log('初始化：', JSON.stringify(info));
    const A = [{ id: 'sun-whale', count: 2, position: '中排' }, { id: 'ST59', count: 4, position: '前排' }];
    const B = [{ id: 'eternal-storm', count: 3, position: '中排' }, { id: 'plutus-shield', count: 3, position: '中排' }];
    const r1 = E.runBattle({ A, B, seed: 12345 });
    const r2 = E.runBattle({ A, B, seed: 12345 });
    const r3 = E.runBattle({ A, B, seed: 999 });
    const fmt = r => r ? ('时长 ' + Math.round(r.时长) + 's 我方对舰 ' + Math.round(r.我方.总输出对舰) + ' 敌方对舰 ' + Math.round(r.敌方.总输出对舰) + ' 结果 ' + E.outcome(r)) : 'null';
    console.log('A:', fmt(r1));
    console.log('B:', fmt(r2), '（应与上一行完全相同）');
    console.log('C:', fmt(r3), '（不同种子应不同）');
    const k = r => r ? [Math.round(r.时长), Math.round(r.我方.总输出对舰), Math.round(r.敌方.总输出对舰)].join('|') : 'x';
    console.log(k(r1) === k(r2) ? '✅ 同种子可复现' : '❌ 同种子结果不一致');
    console.log(k(r1) !== k(r3) ? '✅ 不同种子有区分' : '⚠️ 不同种子结果相同');
})();
