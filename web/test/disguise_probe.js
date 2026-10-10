/* ============================================================
   伪装机制探针（第61轮）
   依据：知识库2/lagrange_docs/护航艇资料2.txt 第127行
        「CV-M011型-高速导弹艇 C：高速动力系统 · 调校策略【信息伪装】：
          战斗开局120秒内，自身被敌方识别为战机。」
        A资料149「B3模块+点满战场信号伪装 → 被判定为【小型舰船】，吸引反小火力」
   验证点：
     1. 伪装舰对【伪装目标舰种】匹配 = true（伪装生效期内）
     2. 超过 disguiseSec（120s）后 = false（恢复真实舰种）
     3. 真实舰种在伪装期内仍然 = true（伪装是"额外可被识别"，不是替换）
     4. 落库数据实际存在（CVM011-C：disguiseAs=战机 / disguiseSec=120）
     5. 未伪装的同型船（CVM011-A）对 '战机' = false（对照，防假通过）
   ⚠ battleState 是 let 变量、不挂 window（本项目踩过 3 次）——必须真开一场战斗才能拿到对象。
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, bad = 0;
const chk = (name, got, want) => { const pass = got === want; pass ? ok++ : bad++; console.log((pass ? '  ✅ ' : '  ❌ ') + name + '  得到=' + got + ' 期望=' + want); };

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(4000);

    // --- 数据落库校验（走页面里的 SHIP_DATABASE） ---
    const db = await p.evaluate(() => {
        const c = SHIP_DATABASE['CVM011-C'], a = SHIP_DATABASE['CVM011-A'];
        return {
            cHas: !!c, cDis: c && c.disguiseAs, cSec: c && c.disguiseSec,
            aDis: a ? (a.disguiseAs || null) : 'NOTFOUND', aType: a && a.type
        };
    });
    console.log('== 数据落库 ==');
    chk('CVM011-C 存在', db.cHas, true);
    chk('CVM011-C disguiseAs', db.cDis, '战机');
    chk('CVM011-C disguiseSec', db.cSec, 120);
    chk('CVM011-A 无伪装（对照）', db.aDis, null);

    // --- 开一场最小战斗，让 battleState 真实存在 ---
    const mkEntry = `(function(id, extra){
        const t = SHIP_DATABASE[id]; const e = JSON.parse(JSON.stringify(t));
        e.count = 1; e.selectedModules = {}; recalcAircraftSlots(e); e.aircraft = [];
        Object.assign(e, extra || {}); return e;
    })`;

    const r = await p.evaluate((mkSrc) => {
        const mk = eval(mkSrc);
        // 清空所有舰队 → 只放两艘最小的船，让 prepareBattle 能过
        FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
        fleetData['ally-escort'].main = [mk('CVM011-C', {})];
        fleetData['enemy-escort'].main = [mk('CVM011-A', {})];
        if (!prepareBattle()) return { err: 'prepareBattle failed' };
        const bs = battleState;
        // 找实例（并确认实例上确实带 disguiseAs / disguiseSec）
        const ally = (bs.allyShips || []).concat(bs.enemyShips || []);
        const cInst = ally.find(u => u.id === 'CVM011-C');
        const out = { instHasAs: cInst ? (cInst.disguiseAs || null) : 'NO-INST', instSec: cInst ? (cInst.disguiseSec || 0) : 'NO-INST' };
        const probe = (t, type) => { bs.time = t; return matchesType(cInst, type); };
        out.t0_fighter = probe(0, '战机');
        out.t0_corvette = probe(0, '护航艇');
        out.t119_fighter = probe(119, '战机');
        out.t121_fighter = probe(121, '战机');
        out.t121_corvette = probe(121, '护航艇');
        out.t0_aircraftClass = probe(0, '舰载机');
        // 无时限伪装（FSV830 形态，走假对象——不依赖 battleState.time）
        const fake = { type: 'support', name: 'FSV3800-快速战术支援舰', disguiseAs: '驱逐舰' };
        bs.time = 9999;
        out.forever = matchesType(fake, '驱逐舰');
        // 对照：不伪装的同型船
        const ctrl = mk('CVM011-A', {});
        out.ctrl_fighter = matchesType(ctrl, '战机');
        out.ctrl_corvette = matchesType(ctrl, '护航艇');
        return out;
    }, mkEntry);

    if (r.err) { console.log('  ❌ 战斗准备失败: ' + r.err); bad++; }
    console.log('== 实例传递 ==');
    chk('实例上带 disguiseAs', r.instHasAs, '战机');
    chk('实例上带 disguiseSec', r.instSec, 120);
    console.log('== matchesType 行为 ==');
    chk('0s  伪装成战机 → 被「战机」判定命中', r.t0_fighter, true);
    chk('0s  真实舰种仍认「护航艇」', r.t0_corvette, true);
    chk('119s 伪装仍生效', r.t119_fighter, true);
    chk('121s 伪装失效（不再算战机）', r.t121_fighter, false);
    chk('121s 恢复真实舰种「护航艇」', r.t121_corvette, true);
    chk('伪装不影响「舰载机」大类判定', r.t0_aircraftClass, true);
    chk('无时限伪装在 9999s 仍生效（FSV3800→驱逐舰）', r.forever, true);
    chk('对照：CVM011-A 不伪装 → 不算战机', r.ctrl_fighter, false);
    chk('对照：CVM011-A 不伪装 → 算护航艇', r.ctrl_corvette, true);

    if (errs.length) console.log('  ⚠ pageerror: ' + errs.slice(0, 3).join(' | '));
    console.log('');
    console.log('== 伪装探针 ' + ok + '/' + (ok + bad) + ' ==' + (bad ? '  ❌ 有失败' : '  ✅ 全通过'));
    await b.close();
    process.exit(bad ? 1 : 0);
})();
