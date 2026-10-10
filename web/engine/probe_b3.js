/* 验证 B3「装甲融化」：安东塔斯(B3) 打高护甲目标 → 目标护甲逐层下降、输出提高 */
const E = require('./lagrange_engine.js');
(async () => {
    await E.init();
    const A = [{ id: 'antontas', count: 2, position: '中排', mods: { B: 'B3' } }];
    const B = [{ id: 'plutus-shield', count: 2, position: '中排' }];
    const r = E.runBattle({ A, B, seed: 4242, maxSec: 600 });
    const bs = r._bs;
    const tgt = bs.enemyShips[0];
    console.log('安东塔斯(B3) vs 普鲁图斯之盾：');
    console.log('  时长 ' + Math.round(r.时长) + 's  我方对舰 ' + Math.round(r.我方.总输出对舰) + '  敌方对舰 ' + Math.round(r.敌方.总输出对舰));
    console.log('  目标护甲（基础） = ' + tgt.physicalArmor);
    const deb = tgt._armorDeb || [];
    console.log('  战后融化层数 = ' + deb.length + ' 层  → 降甲 ' + (deb.length * 5) + ' 点');
    console.log('  ⇒ 有效护甲 = ' + Math.max(0, tgt.physicalArmor - deb.length * 5) + '（原 ' + tgt.physicalArmor + '）');
    /* 对照：不带 B3 */
    const r2 = E.runBattle({ A: A.map(x => ({ ...x, mods: { B: 'B1' } })), B, seed: 4242, maxSec: 600 });
    console.log('\n对照（B1 模块，无融化）：我方对舰 ' + Math.round(r2.我方.总输出对舰) + '  时长 ' + Math.round(r2.时长) + 's');
    console.log('  输出差 ' + (((r.我方.总输出对舰 / (r2.我方.总输出对舰||1)) - 1) * 100).toFixed(1) + '%');
})();
