/* 拦截机制 + 狩猎者级-战术(B) 武器 回归
   验证点：
   ① 数据落库：hunter-B 的 M3 防御火炮系统；5 处拦截率的来源字段
   ② 开战实例的拦截率由【所装模块】合成（含 moduleGroup 变体）
   ③ 切换模块 → 拦截率随之变化（否则切模块对拦截无效）
   ④ 拦截真的生效：同一套编队，只把拦截率置 0 / 27 做对照，比较承受的投射伤害
   ⑤ hunter-B 现在能打出伤害（补武器前为 0）
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(n, ok, d) { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? '  → ' + d : '')); } }

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const R = await p.evaluate(() => {
    const out = {};

    /* ===== ① 数据落库 ===== */
    const hb = SHIP_DATABASE['hunter-B'];
    const w = hb && hb.modules && hb.modules.M3 && hb.modules.M3.weapons && hb.modules.M3.weapons[0];
    out.hunterB = w ? { name: w.name, singleDmg: w.singleDmg, ammo: w.ammo, cooldown: w.cooldown, src: w._src } : null;
    // 单个武器的"标称每分钟伤害" = 单发 × 发数 × 60 ÷ 周期
    out.hunterB标称DPM = w ? Math.round(w.singleDmg * (w.ammo * (w.attacks || 1)) * 60 / w.cooldown) : null;
    const grab = (id, slot, vk) => {
      const m = SHIP_DATABASE[id].modules[slot];
      const o = vk ? m.variants[vk] : m;
      return { rate: o.interceptRate, type: o.interceptType, src: o._interceptSrc };
    };
    out.数据 = {
      雷火之星B2: grab('thunder-star', 'B', 'B2'),
      雷火之星B1: grab('thunder-star', 'B', 'B1'),
      光锥B_M1: grab('lightcone-B', 'M1'),
      大盾B3: grab('plutus-shield', 'B', 'B3'),
      太阳鲸C3: grab('sun-whale', 'C', 'C3'),
      CV3000_A2: grab('CV3000', 'A', 'A2')
    };

    /* ===== 编队工具（沿用其它回归的写法） ===== */
    const mk = (id, cnt, uid, mods) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE[id]));
      e.uid = uid; e.count = cnt; e.position = e.position || '中排';
      e.selectedModules = Object.assign({}, mods || {}); e.aircraft = [];
      recalcAircraftSlots(e); return e;
    };
    const setup = (ally, enemy) => {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
      fleetData['ally-escort'].main = ally;
      fleetData['enemy-escort'].main = enemy;
      refreshFleetViews(); prepareBattle();
    };

    /* ===== ② 实例拦截率由模块合成 ===== */
    setup([mk('lightcone-B', 1, 'a1', {})], [mk('lightcone-B', 1, 'e1', {})]);
    const lc = battleState.allyShips[0];
    out.实例_光锥 = { rate: +lc.interceptRate.toFixed(2), type: lc.interceptType };

    // 雷火之星：B1 无拦截 / B2 有 27%
    setup([mk('thunder-star', 1, 'a2', { B: 'B1' })], [mk('thunder-star', 1, 'e2', { B: 'B2' })]);
    out.实例_雷火B1 = { rate: +battleState.allyShips[0].interceptRate.toFixed(2), type: battleState.allyShips[0].interceptType };
    out.实例_雷火B2 = { rate: +battleState.enemyShips[0].interceptRate.toFixed(2), type: battleState.enemyShips[0].interceptType };

    /* ===== ③ 切换模块即时更新拦截率 ===== */
    const ts = battleState.allyShips[0];
    switchModuleVariant(ts, 'B', 'B2');
    out.切模块后 = { rate: +ts.interceptRate.toFixed(2), type: ts.interceptType };
    switchModuleVariant(ts, 'B', 'B1');
    out.切回后 = { rate: +ts.interceptRate.toFixed(2), type: ts.interceptType };

    /* ===== ④ 拦截生效对照：同一编队，只改拦截率 =====
       攻方/受方都用 开阳级（A 槽 = ET-190A型鱼雷，投射武器 —— 只有投射才会被拦截；
       该舰无维修模块，HP 损失可直接当"承受伤害"）。
       两次运行编队完全相同，唯一差别是受方拦截率 0 vs 50% → 差异只能来自拦截。 */
    const 打一轮 = (拦截率) => {
      setup([mk('kaiyang-A', 2, 'r1', {})], [mk('kaiyang-A', 2, 'p1', {})]);
      battleState.allyShips.forEach(s => { s.interceptRate = 拦截率; s.interceptType = 'sameRow'; });
      battleLogs = [];
      let t = 0; while (!battleState.ended && t < 900) { processBattleTick(0.1); t += 0.1; }
      const 承受 = battleState.allyShips.reduce((a, s) => a + (s.maxHp - Math.max(0, s.hp)), 0);
      const 拦截日志 = battleLogs.filter(l => (l.msg || l.text || '').indexOf('被拦截') >= 0).length;
      return { 承受伤害: Math.round(承受), 时长: +t.toFixed(0), 拦截日志数: 拦截日志 };
    };
    const noInt = 打一轮(0);
    const withInt = 打一轮(50);   // 2 艘 50% 同排 → 总拦截 1-(1-0.5)^2 = 75%
    out.对照_无拦截 = noInt;
    out.对照_有拦截 = withInt;

    /* ===== ⑤ hunter-B 能打出伤害（补武器前是 0） =====
       目标用护卫舰：hunter-B 的攻击序列里有「护卫舰 50%~70%」，
       打其它舰种会落到兜底分支、命中率不同，量出来的 DPM 不可比。 */
    setup([mk('hunter-B', 1, 'h1', {})], [mk('ruby-A', 1, 'x1', {})]);
    const hh = battleState.enemyShips[0];
    const h0 = hh.maxHp;
    let ht = 0; while (!battleState.ended && ht < 60) { processBattleTick(0.1); ht += 0.1; }
    const 打出的伤害 = h0 - Math.max(0, hh.hp);
    out.hunterB输出 = {
      造成伤害: Math.round(打出的伤害), 时长: +ht.toFixed(0),
      实测DPM: Math.round(打出的伤害 * 60 / ht),
      标称DPM: Math.round(SHIP_DATABASE['hunter-B'].modules.M3.weapons[0].singleDmg * 4 * 60 / SHIP_DATABASE['hunter-B'].modules.M3.weapons[0].cooldown),
      武器数: battleState.allyShips[0].weaponStates.length
    };

    return out;
  });

  console.log(JSON.stringify(R, null, 1));

  /* ===== 断言 ===== */
  check('hunter-B 新增 M3 防御火炮系统', !!R.hunterB && R.hunterB.singleDmg === 20 && R.hunterB._src === undefined || (R.hunterB && R.hunterB.src === '舰船资料65.md'), R.hunterB ? R.hunterB.name + ' cooldown=' + R.hunterB.cooldown + ' src=' + R.hunterB.src : '缺失');
  check('hunter-B 标称 DPM ≈ 资料面板 600', Math.abs(R.hunterB标称DPM - 600) <= 6, '实测 ' + R.hunterB标称DPM + ' /分');
  check('雷火之星 B2 拦截 27% 同排', R.数据.雷火之星B2.rate === 27 && R.数据.雷火之星B2.type === 'sameRow');
  check('雷火之星 B1 无拦截', !R.数据.雷火之星B1.rate, 'rate=' + R.数据.雷火之星B1.rate);
  check('光锥级-区域防空 拦截 23% 同排', R.数据.光锥B_M1.rate === 23 && R.数据.光锥B_M1.type === 'sameRow');
  check('大盾 B3 拦截 12.8% 同排', Math.abs(R.数据.大盾B3.rate - 12.8) < 0.01);
  check('太阳鲸 C3 拦截 5% 同排', R.数据.太阳鲸C3.rate === 5 && R.数据.太阳鲸C3.type === 'sameRow');
  check('CV3000 A2 拦截 12% 自身', R.数据.CV3000_A2.rate === 12 && R.数据.CV3000_A2.type === 'self');
  check('5 处拦截值都带出处', [R.数据.雷火之星B2, R.数据.光锥B_M1, R.数据.大盾B3, R.数据.太阳鲸C3, R.数据.CV3000_A2].every(o => !!o.src));
  check('开战实例：光锥级拦截率=23 同排', Math.abs(R.实例_光锥.rate - 23) < 0.01 && R.实例_光锥.type === 'sameRow', JSON.stringify(R.实例_光锥));
  check('开战实例：雷火之星 B1 → 0', R.实例_雷火B1.rate === 0, JSON.stringify(R.实例_雷火B1));
  check('开战实例：雷火之星 B2 → 27 同排', Math.abs(R.实例_雷火B2.rate - 27) < 0.01 && R.实例_雷火B2.type === 'sameRow', JSON.stringify(R.实例_雷火B2));
  check('切换模块 B1→B2 拦截率跟着变', Math.abs(R.切模块后.rate - 27) < 0.01, '切到 B2 → ' + JSON.stringify(R.切模块后));
  check('切回 B1 拦截率归零', R.切回后.rate === 0, JSON.stringify(R.切回后));
  check('拦截真的生效（有拦截承受的伤害显著更低）', R.对照_有拦截.承受伤害 < R.对照_无拦截.承受伤害 * 0.5,
    '无拦截承受 ' + R.对照_无拦截.承受伤害 + ' → 有拦截承受 ' + R.对照_有拦截.承受伤害 + '（压到 ' + (R.对照_有拦截.承受伤害 / R.对照_无拦截.承受伤害 * 100).toFixed(0) + '%，理论 25%）');
  check('拦截日志在无拦截时为零、有拦截时出现', R.对照_无拦截.拦截日志数 === 0 && R.对照_有拦截.拦截日志数 > 0,
    '无拦截 ' + R.对照_无拦截.拦截日志数 + ' 条 / 有拦截 ' + R.对照_有拦截.拦截日志数 + ' 条');
  check('hunter-B 补武器后能打出伤害', R.hunterB输出.造成伤害 > 0,
    '打护卫舰 60 秒造成 ' + R.hunterB输出.造成伤害 + '，实测约 ' + R.hunterB输出.实测DPM + '/分（标称 ' + R.hunterB输出.标称DPM + '/分；差额来自命中率与调校系数）');

  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
