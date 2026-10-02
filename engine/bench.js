const E = require('./lagrange_engine.js');
(async () => {
  await E.init();
  const A = [{ id: 'sun-whale', count: 2, position: '中排' }, { id: 'ST59', count: 4, position: '前排' }];
  const B = [{ id: 'eternal-storm', count: 3, position: '中排' }, { id: 'plutus-shield', count: 3, position: '中排' }];
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) E.runBattle({ A, B, seed: 1000 + i });
  const ms = (Date.now() - t0) / 10;
  console.log('单场平均 ' + ms.toFixed(0) + ' ms  →  1000 场约 ' + (ms * 1000 / 60000).toFixed(1) + ' 分钟');
})();
