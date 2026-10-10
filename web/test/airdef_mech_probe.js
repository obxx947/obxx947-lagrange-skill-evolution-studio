/* ============================================================
   防空三类新机制探针（第62轮）
   · 防空网络I  —— 静海区 302030603 / 枪骑兵 408030503 / 狩猎者级-防空 510030701
       「舰载机力量居于劣势时，舰队内具备防空能力的武器优先攻击载机，命中 +1/5/10/15%」
   · 火力校准   —— 枪骑兵 408030502（旗舰生效）
       「本公司舰船或载机搭载的防空武器有 5/10% 额外概率对命中目标造成额外 80/160% 伤害」

   为什么用浏览器直调而不是跑战斗：
     跑战斗验证会被"载机大部分时间在机库里（往复式）→ 根本锁不到"挡住，测出来恒为 0，
     那是【测试自身的错】不是机制没生效。这里先 prepareBattle 拿到真实实例，再直接调引擎函数。
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, bad = 0;
const chk = (n, got, want) => { const p = got === want; p ? ok++ : bad++; console.log((p ? '  ✅ ' : '  ❌ ') + n + '  得到=' + got + ' 期望=' + want); };

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(4500);

    const out = await p.evaluate(async () => {
        const R = { err: null };
        try {
            await loadBlueprintData();
            const cdn = BP_MAP['qiangqibing-C'].cdnId;
            await loadBpTree(cdn);
            R.cdn = cdn;
            localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
                { name: '__PROBE_MECH', addpoints: { [cdn]: { lv: { '408030503': 4, '408030502': 2 }, manual: {} } } }
            ]));
            const mk = (id, count, extra) => {
                const t = SHIP_DATABASE[id]; const e = JSON.parse(JSON.stringify(t));
                e.count = count; e.selectedModules = Object.assign({}, (extra || {}).mods || {});
                recalcAircraftSlots(e); e.aircraft = [];
                ((extra || {}).air || []).forEach(a => {
                    const at = SHIP_DATABASE[a.id];
                    const sl = (e.simSlots || []).find(x => x.kind === a.kind) || (e.simSlots || [])[0];
                    if (!sl) return;
                    const inst = JSON.parse(JSON.stringify(at)); inst.count = a.qty; inst.slot = sl.key;
                    e.aircraft.push(inst);
                });
                return e;
            };
            const A = [mk('qiangqibing-C', 3, {})];
            const B = [mk('sun-whale', 1, { mods: { M: 'M2', B: 'B2' }, air: [{ id: 'lizhi', qty: 8, kind: 'fighter' }] })];
            A[0].apSet = '__PROBE_MECH';
            FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
            fleetData['ally-escort'].main = A;
            fleetData['enemy-escort'].main = B;
            fleetData['ally-escort'].flagship = 'qiangqibing-C';   // 火力校准要旗舰才生效
            R.built = { ally: A.length, enemy: B.length, enemyAir: (B[0].aircraft || []).length };
            if (!prepareBattle()) { R.err = 'prepareBattle failed'; return R; }
            const bs = battleState;
            const q = bs.allyShips.find(u => u.id === 'qiangqibing-C');
            R.kinds = (q.fleetMechs || []).map(x => x.fm.kind + '@' + x.lv);
            R.disFlag = airPowerDisadvantage(bs, 'ally');
            R.netDis = aaNetOf(q, bs);
            /* 造出"我方载机多"的假象 → 应该回到 0 */
            bs.allyShips.push({ position: 'aircraft', alive: true, hp: 100, maxHp: 100, id: 'mistral', name: '假载机', weaponStates: [] });
            for (let i = 0; i < 40; i++) bs.allyShips.push({ position: 'aircraft', alive: true, hp: 100, maxHp: 100, id: 'mistral', name: '假载机' + i,
                weaponStates: [{ weapon: { dpm: { antiShip: 9999, antiAir: 9999 } } }] });
            bs._airAdvT = -1;
            R.advFlag = airPowerDisadvantage(bs, 'ally');
            R.netAdv = aaNetOf(q, bs);
            /* 火力校准：统计 4000 次掷骰 */
            let hit = 0, sum = 0;
            for (let i = 0; i < 4000; i++) { const v = aaCalibRoll(q, bs); if (v > 0) { hit++; sum += v; } }
            R.calibRate = hit / 4000; R.calibVal = hit ? sum / hit : 0;
            /* 对照：没点这两个节点的太阳鲸 */
            const whale = bs.enemyShips.find(u => u.id === 'sun-whale');
            R.whaleNet = aaNetOf(whale, bs);
            let wl = 0; for (let i = 0; i < 2000; i++) if (aaCalibRoll(whale, bs) > 0) wl++;
            R.whaleCalib = wl;
            return R;
        } catch (e) { R.err = String((e && e.message) || e); return R; }
    });

    if (out.err) { console.log('  ❌ 页面内异常: ' + out.err); bad++; }
    console.log('== 落库与解析 ==');
    console.log('  枪骑兵 cdnId = ' + out.cdn + ' | 编成 = ' + JSON.stringify(out.built) + ' | 机制 = ' + JSON.stringify(out.kinds || []));
    chk('加点解析出 aaNet', (out.kinds || []).some(k => k.startsWith('aaNet')), true);
    chk('加点解析出 aaCalib', (out.kinds || []).some(k => k.startsWith('aaCalib')), true);
    console.log('== 防空网络I ==');
    chk('我方 0 架 vs 敌方 8 架 → 判定为劣势', out.disFlag, true);
    chk('劣势时命中加成 = 15（满级）', out.netDis, 15);
    chk('我方 41 架 vs 敌方 8 架 → 不再是劣势', out.advFlag, false);
    chk('非劣势时命中加成 = 0', out.netAdv, 0);
    console.log('== 火力校准 ==');
    chk('触发概率 ≈ 10%（实测 ' + (out.calibRate * 100).toFixed(2) + '%）', out.calibRate > 0.07 && out.calibRate < 0.13, true);
    chk('额外伤害 = 160（满级）', Math.round(out.calibVal), 160);
    console.log('== 对照（没点这两个节点的太阳鲸）==');
    chk('太阳鲸 防空网络加成 = 0', out.whaleNet, 0);
    chk('太阳鲸 火力校准 2000 次一次不触发', out.whaleCalib, 0);
    if (errs.length) console.log('  ⚠ pageerror: ' + errs.slice(0, 3).join(' | '));
    console.log('');
    console.log('== 防空机制探针 ' + ok + '/' + (ok + bad) + ' ==' + (bad ? '  ❌ 有失败' : '  ✅ 全通过'));
    await b.close();
    process.exit(bad ? 1 : 0);
})();
