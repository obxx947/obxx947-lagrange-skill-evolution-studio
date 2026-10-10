/* ============================================================
   AI 战斗推演专用 Worker（给 chat 页的 battle_simulate 工具用）
   ------------------------------------------------------------
   做法：复用神经元训练已经打包好的引擎（worker_bundle.js 里内联了
   simulator.html 的引擎本体 + 导出块 + FleetCheck），在它之上只加一种消息：
     { type:'battle', id, opt:{ A,B,AEscorted,BEscorted, AFlagship..., AAddPoints,BAddPoints,
                                 seed, maxSec, dt, stallSec } }
   跑完回：
     { type:'battleResult', id, ok:true, ms, 胜负, 时长, 结束, 僵局, 我方, 敌方, 逐型号 }
   训练消息（start/pause/resume/stop）原样转交回给 bundle 自带的胶水处理。
   ★ 不改引擎、不重建 bundle；本文件只是包装层。
   ============================================================ */
importScripts('worker_bundle.js');

const __trainHandler = self.onmessage;      // bundle 末尾胶水赋的（训练用），包装层在其后覆盖
let __initP = null;

self.onmessage = async function (ev) {
    const m = ev.data || {};
    if (m.type !== 'battle') { return __trainHandler.apply(self, arguments); }
    const id = m.id;
    try {
        const E = self.LagrangeEngine;
        if (!E || !E.runBattle) throw new Error('引擎未加载（worker_bundle 未就绪）');
        __initP = __initP || Promise.resolve(E.init());
        await __initP;
        const opt = m.opt || {};
        /* 加点树要预载：不载的话系统级节点会被当成舰船级整船生效（口径会偏） */
        if (opt.AAddPoints) { try { await E.loadBpTrees(Object.keys(opt.AAddPoints)); } catch (e) { } }
        if (opt.BAddPoints) { try { await E.loadBpTrees(Object.keys(opt.BAddPoints)); } catch (e) { } }
        /* ★ 2026-10-07：自定义舰船 —— spec 里带 _ship 快照的条目，现场登记进引擎舰船库（E.ships 就是 SHIP_DATABASE 本体），
           这样 buildSide 能按 id 找到它；condEffects 由重建后的 createShipInstance 拷到实例。 */
        ['A', 'AEscorted', 'B', 'BEscorted'].forEach(k => {
            (opt[k] || []).forEach(e => {
                if (e && e._ship && e._ship.id) { try { E.ships[e.id] = e._ship; } catch (x) { } }
            });
        });
        /* 载机补位：主线程只给了 {id,qty}，这里按模块真实载机位把 slot/kind 补上（载机位权威口径 FleetCheck） */
        ['A', 'AEscorted', 'B', 'BEscorted'].forEach(k => { if (opt[k]) opt[k] = (opt[k] || []).map(__fixAir).filter(Boolean); });
        const t0 = Date.now();
        const r = E.runBattle(opt);
        if (!r) { self.postMessage({ type: 'battleResult', id: id, ok: false, error: 'runBattle 返回空（配置问题）' }); return; }
        /* ★ 机制触发统计（自定义舰机制有没有真的跑起来，一眼可见） */
        const __all = [].concat((r._bs && r._bs.allyShips) || [], (r._bs && r._bs.enemyShips) || []);
        const 机制触发数 = __all.reduce((n, x) => n + (x && x._condFired || 0), 0);
        const 带机制实例数 = __all.filter(x => x && (x.condEffects || []).length).length;
        self.postMessage({
            type: 'battleResult', id: id, ok: true, ms: Date.now() - t0,
            胜负: E.outcome(r), 时长: r.时长, 结束: r.结束, 僵局: r.僵局,
            我方: r.我方, 敌方: r.敌方, 机制触发数: 机制触发数, 带机制实例数: 带机制实例数,
            逐型号: { 我方: __rows(r._bs && r._bs.allyShips, r.时长), 敌方: __rows(r._bs && r._bs.enemyShips, r.时长) }
        });
    } catch (e) {
        self.postMessage({ type: 'battleResult', id: id, ok: false, error: String(e && e.message || e).substring(0, 300) });
    }
};

/* 一侧的逐型号汇总（按舰名合并同型多条实例；载机单独成行） */
function __rows(arr, t) {
    if (!arr) return [];
    const by = {};
    arr.forEach(x => {
        const isAir = x.position === 'aircraft';
        const name = (x.name || x.id || '?') + (isAir ? '（载机）' : '');
        const o = by[name] || (by[name] = { 舰船: name, 数量: 0, 存活: 0, 对舰: 0, 对空: 0, 承伤: 0, 维修: 0, 生存秒: 0 });
        o.数量++; if (x.alive) o.存活++;
        o.对舰 += x._dealtShip || 0; o.对空 += x._dealtAir || 0;
        o.承伤 += x._taken || 0; o.维修 += x._healOut || 0; o.生存秒 += x._aliveSec || 0;
    });
    return Object.keys(by).map(k => {
        const o = by[k];
        return { 舰船: o.舰船, 数量: o.数量, 存活: o.存活, 对舰: Math.round(o.对舰), 对空: Math.round(o.对空),
                 承伤: Math.round(o.承伤), 维修: Math.round(o.维修), 生存占比: t > 0 ? +(o.生存秒 / (o.数量 * t)).toFixed(3) : 0 };
    }).sort((a, b) => (b.对舰 + b.对空) - (a.对舰 + a.对空)).slice(0, 32);
}

/* 载机位补齐：{id,qty,slot?,kind?} → 按该舰实际载机位（含所选模块）认领槽位 */
function __fixAir(e) {
    if (!e) return null;
    const E = self.LagrangeEngine;
    const DB = E && E.ships, FC = E && E.FleetCheck;
    const list = (e.air || []);
    if (!list.length || !DB || !FC) { e.air = list.map(a => ({ id: a.id, qty: a.qty || 1, slot: a.slot, kind: a.kind })); return e; }
    let slots = [];
    try { slots = (FC.airSlots(DB[e.id], e.mods || {}, e.count || 1) || []).filter(x => x.cap > 0); } catch (x) { }
    const used = {};
    const keep = [];
    for (const a of list) {
        const t = DB[a.id]; if (!t) continue;
        const kind = ((t.aircraftType || t.type) === 'corvette') ? 'corvette' : 'fighter';
        const q = a.qty || 1;
        let hit = slots.find(x => x.key === a.slot && x.kind === kind && (used[x.key] || 0) + q <= x.cap)
            || slots.find(x => x.kind === kind && (used[x.key] || 0) + q <= x.cap);
        if (!hit) continue;                 // 没有对应载机位 → 该载机不带（不硬塞）
        used[hit.key] = (used[hit.key] || 0) + q;
        keep.push({ id: a.id, qty: q, slot: hit.key, kind: kind });
    }
    e.air = keep;
    return e;
}
