const E = require('./lagrange_engine.js');
(async () => {
  await E.init();
  const A = [{ id:'kaiyang-A', count:6, position:'前排' }];            // 开阳（ET-190A 带溶解弹）
  const B = [{ id:'plutus-shield', count:2, position:'中排' }];        // 高血量靶
  const r = E.runBattle({ A, B, seed: 31337, maxSec: 900 });
  const t = r._bs.enemyShips[0];
  console.log('开阳级×6（溶解弹） vs 普鲁图斯×2：');
  console.log('  时长 ' + Math.round(r.时长) + 's  我方对舰 ' + Math.round(r.我方.总输出对舰));
  const dis = t._dissolve || [];
  console.log('  战后目标溶解层数 = ' + dis.length + '  → DOT ' + (dis.length*10) + ' 结构值/秒');
  const r2 = E.runBattle({ A: A.map(x=>({...x, mods:{}})), B, seed: 31337, maxSec: 900 });
  console.log('  对照（同配队）：我方对舰 ' + Math.round(r2.我方.总输出对舰));
})();
