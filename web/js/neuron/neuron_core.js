/* ============================================================
   神经元实验室 · 训练核心（浏览器 Worker / Node 自测 共用）
   ------------------------------------------------------------
   移植自另一台设备的「方案二A · 神经元对打」demo/evolve_duel_neuron.js（2026-10-05 完整状态）。
   算法逐段对照移植（NEAT 网络 / 双轨选择 / 新颖性档案 / E8 行为空间 / 岛间迁移 / 可进化目标向量），
   差异只在【I/O】与【运行形态】：
     · 文件读写（jsonl / 快照 / 桌面产出）→ IndexedDB（NeuronStore）/ 内存 + postMessage 上报
     · argv → cfg 对象；主进程 spawn 多岛 → 页面开 N 个 Worker，每 Worker 一个岛
     · 新增：单方固定（打指定对手）/ 双方进化（自对弈）/ 纯规则（方案一）
     · 新增：暂停 / 停止 / 每 N 代存档（默认 5）/ 断点续跑 / 舰船库约束（可选）
   ============================================================ */
(function (root) {
    'use strict';

    /* 纯函数工具 */
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const clamp01 = x => Math.max(0, Math.min(1, isFinite(x) ? x : 0));

    function start(E, cfg0, post) {
        const cfg = Object.assign({
            isle: 0, seedBase: 20261004, pop: 6, oppEval: 2, oppSample: 3,
            maxSec: 9000, stallSec: 90, dt: 0.5, throttle: 1.0,
            minCV: 390, cvCap: 420, reinfCap: 5,
            saveEvery: 5, gens: 999999,
            pure: false,                       // 纯规则模式（无网络；方案一）
            evolve: { A: true, B: true },      // 哪一方参与进化（另一方=给定固定）
            warmNet: null, welcome: null,      // 热启动网络 / 预训练
            lib: null,                          // 舰船库约束（null=不限制）
            store: (typeof self !== 'undefined' && self.NeuronStore) || null,
            tag: ''
        }, cfg0 || {});
        const Store = cfg.store;
        const ISLE = cfg.isle;
        const TAG = '[I' + String(ISLE).padStart(2, '0') + '] ';
        const SIZE_LAMBDA_NODE = 25, SIZE_LAMBDA_CONN = 0.8;
        const CV_CAP = cfg.cvCap, REINF_CAP = cfg.reinfCap, MIN_CV = cfg.minCV;
        const OPP_POOL = 5, OPP_FRESH = 2, OPP_TOP = OPP_POOL - OPP_FRESH;
        const OPP_EVAL = cfg.oppEval;
        const CROSS_RATE = 0.35, MAP_PARENT_RATE = 0.25;
        const ELITE_BAR = 0.75;
        const ARCH_K = 15, ARCH_MAX_ENTER = 4, ARCH_RARE_GENS = 500;
        const HOLD_BIAS = 0.5;

        /* ---------- 随机数（可复现） ---------- */
        let _s = ((cfg.seedBase + ISLE * 7919) >>> 0) || 1;
        const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const pick = a => a[Math.floor(rnd() * a.length)];
        const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

        /* ---------- 控制（暂停/继续/停止） ---------- */
        let _pause = false, _stop = false, _resumeResolve = null;
        const control = {
            pause() { _pause = true; },
            stop() { _stop = true; if (_resumeResolve) { _resumeResolve(); _resumeResolve = null; } },
            resume() { _pause = false; if (_resumeResolve) { _resumeResolve(); _resumeResolve = null; } },
            get paused() { return _pause; },
            get stopped() { return _stop; }
        };

        /* ---------- 网络（NEAT 式） ---------- */
        const ACT = { identity: x => x, tanh: Math.tanh, sigmoid: x => 1 / (1 + Math.exp(-clamp(x, -30, 30))), relu: x => x > 0 ? x : 0, step: x => x > 0 ? 1 : 0, abs: Math.abs, sin: Math.sin, gauss: x => Math.exp(-x * x), square: x => clamp(x * x, -1e6, 1e6) };
        const ACT_NAMES = Object.keys(ACT);
        let NEXT_INNOV = 1; const INNOV_MAP = new Map();
        const innovOf = (a, b) => { const k = a + '>' + b; if (!INNOV_MAP.has(k)) INNOV_MAP.set(k, NEXT_INNOV++); return INNOV_MAP.get(k); };
        const NIN = () => E.actionStateSize(), NOUT = () => 9;
        function newNetwork() {
            const nodes = [];
            for (let i = 0; i < NIN(); i++) nodes.push({ id: 'i' + i, type: 'in', act: 'identity' });
            for (let j = 0; j < NOUT(); j++) nodes.push({ id: 'o' + j, type: 'out', act: 'tanh' });
            const conns = [];
            for (let i = 0; i < NIN(); i++) for (let j = 0; j < NOUT(); j++) if (rnd() < 0.35) conns.push({ in: 'i' + i, out: 'o' + j, w: gauss() * 0.5, enabled: true, innov: innovOf('i' + i, 'o' + j) });
            return { nodes, conns, hidSeq: 1 };
        }
        function forward(net, inputs) {
            const val = new Map(); let ops = 0;
            for (const n of net.nodes) { if (n.type === 'in') { val.set(n.id, inputs[parseInt(n.id.slice(1), 10)] || 0); ops++; } else val.set(n.id, 0); }
            for (let p = 0; p < 2; p++) for (const n of net.nodes) {
                if (n.type === 'in') continue;
                let sum = 0;
                for (const c of net.conns) { if (!c.enabled || c.out !== n.id) continue; sum += (val.get(c.in) || 0) * c.w; ops++; }
                val.set(n.id, ACT[n.act](sum)); ops++;
            }
            const out = []; for (let j = 0; j < NOUT(); j++) out.push(val.get('o' + j) || 0);
            return { out, ops, val };
        }
        function mutateNet(src, rate) {
            const net = { nodes: src.nodes.map(n => Object.assign({}, n)), conns: src.conns.map(c => Object.assign({}, c)), hidSeq: src.hidSeq };
            const k = 1 + (rnd() < rate * 2 ? 1 : 0) + (rnd() < rate ? 1 : 0);
            for (let t = 0; t < k; t++) {
                const a = pick(['addConn', 'addConn', 'addNode', 'addNode', 'w', 'w', 'w', 'act']);
                if (a === 'w') { for (const c of net.conns) { if (rnd() < 0.35) c.w += gauss() * (0.2 + rate); if (rnd() < 0.02) c.w = gauss(); c.w = clamp(c.w, -8, 8); } }
                else if (a === 'act') { const n = pick(net.nodes.filter(x => x.type !== 'in')); if (n) n.act = pick(ACT_NAMES); }
                else if (a === 'addConn') { const ia = pick(net.nodes.filter(x => x.type === 'in')), ib = pick(net.nodes.filter(x => x.type !== 'in')); if (ia && ib && !net.conns.some(c => c.in === ia.id && c.out === ib.id)) net.conns.push({ in: ia.id, out: ib.id, w: gauss() * 0.5, enabled: true, innov: innovOf(ia.id, ib.id) }); }
                else if (a === 'addNode') { const live = net.conns.filter(c => c.enabled); if (!live.length) continue; const c = pick(live); c.enabled = false; const id = 'h' + (net.hidSeq++); net.nodes.push({ id, type: 'hidden', act: pick(ACT_NAMES) }); net.conns.push({ in: c.in, out: id, w: 1, enabled: true, innov: innovOf(c.in, id) }); net.conns.push({ in: id, out: c.out, w: c.w, enabled: true, innov: innovOf(id, c.out) }); }
            }
            return net;
        }
        const netSize = net => net
            ? { nodes: net.nodes.filter(n => n.type !== 'in').length, conns: net.conns.filter(c => c.enabled).length }
            : { nodes: 0, conns: 0 };

        /* ---------- 数据库 & 池 ---------- */
        let DB = null, POOL = [], POOL_AIR = [], TP_LIB = null, LIB = null;

        /* ---------- 配队基础 ---------- */
        const cvOf = (id, db) => (db[id] && db[id].commandValue) || 0;
        const fleetCV = (fl, db) => fl.reduce((a, e) => a + cvOf(e.id, db) * (e.count || 1), 0);
        function trimToCap(fl, db, cap) {
            const out = fl.map(e => Object.assign({}, e));
            let guard = 0;
            while (fleetCV(out, db) > cap && guard++ < 200) {
                const i = out.length - 1 - Math.floor(rnd() * Math.min(3, out.length));
                if (out[i].count > 1) out[i].count--;
                else out.splice(i, 1);
                if (!out.length) break;
            }
            return out;
        }
        const reinfShips = re => (re || []).reduce((n, e) => n + (e.count || 1), 0);
        function trimReinf(re) {
            const out = (re || []).map(e => Object.assign({}, e));
            let guard = 0;
            while (reinfShips(out) > REINF_CAP && out.length && guard++ < 100) {
                const last = out[out.length - 1];
                if ((last.count || 1) > 1) last.count--;
                else out.pop();
            }
            return out;
        }
        /* 配队页格式 → 基因组（战报/配队页导出的 {main:[{id,name,pos,qty,mods,air}],reinforcement,flagship}） */
        function sideFromFleet(f0) {
            const sideArr = a => (a || []).map(s => ({ id: s.id, count: s.qty || s.count || 1, mods: Object.assign({}, s.mods || {}), position: s.pos || s.position, air: (s.air || []).map(x => ({ id: x.id, qty: x.qty || 1, slot: x.slot, kind: x.kind })) }));
            const reinf = trimReinf(sideArr(f0.reinforce || f0.reinforcement));
            let fl = f0.flagship || null;
            if (typeof fl === 'string') {
                const m = fl.match(/^reinforce\|(\d+)$/);
                if (m) { const idx = parseInt(m[1], 10); fl = (reinf[idx] && reinf[idx].id) || null; }
            }
            if (!fl) fl = (reinf[0] && reinf[0].id) || null;
            return { main: trimToCap(sideArr(f0.main), DB, CV_CAP), reinf, fl };
        }

        /* ---------- 载机 ↔ 模块联动（走项目自己的 FleetCheck） ---------- */
        const airKind = t => ((t && (t.aircraftType || t.type)) === 'corvette') ? 'corvette' : 'fighter';
        function slotsOf(e) {
            const FC = E.FleetCheck; if (!FC) return [];
            try { return (FC.airSlots(DB[e.id], e.mods || {}, e.count || 1) || []).filter(x => x.cap > 0); } catch (x) { return []; }
        }
        const usedInSlot = (e, key) => (e.air || []).filter(a => a.slot === key).reduce((n, a) => n + (a.qty || 1), 0);
        function reconcileAir(e) {
            const sl = slotsOf(e);
            const used = {};
            const keep = [];
            for (const a of (e.air || [])) {
                const t = DB[a.id]; if (!t) continue;
                const kind = airKind(t), q = a.qty || 1;
                let hit = sl.find(x => x.key === a.slot && x.kind === kind && (used[x.key] || 0) + q <= x.cap)
                    || sl.find(x => x.kind === kind && (used[x.key] || 0) + q <= x.cap);
                if (!hit) continue;
                used[hit.key] = (used[hit.key] || 0) + q;
                keep.push({ id: a.id, qty: q, slot: hit.key, kind });
            }
            e.air = keep;
            return e;
        }
        function mutateAir(e, rate, fl) {
            const sl = slotsOf(e); if (!sl.length) return e;
            const k = 1 + (rnd() < rate ? 1 : 0);
            for (let i = 0; i < k; i++) {
                const a = pick(['add', 'add', 'del', 'qty', 'swap']);
                if (a === 'add') {
                    const slot = pick(sl);
                    const pool = POOL_AIR.filter(t => airKind(t) === slot.kind
                        && !(slot.kind === 'fighter' && slot.allow !== 'ALL' && t.airSize === 'large'));
                    if (!pool.length) continue;
                    const room = slot.cap - usedInSlot(e, slot.key);
                    if (room <= 0) continue;
                    const q = 1 + Math.floor(rnd() * Math.min(room, 5));
                    const at = pick(pool);
                    if (fl && !LEGAL.canAddAir(fl, e, at.id, q)) continue;
                    e.air = (e.air || []).concat([{ id: at.id, qty: q, slot: slot.key, kind: slot.kind }]);
                } else if (a === 'del' && (e.air || []).length) {
                    e.air.splice(Math.floor(rnd() * e.air.length), 1);
                } else if ((e.air || []).length) {
                    const idx = Math.floor(rnd() * e.air.length);
                    if (a === 'qty') {
                        const cur = e.air[idx].qty || 1;
                        const nq = clamp(cur + (rnd() < 0.5 ? -1 : 1), 1, 30);
                        const rest = usedInSlot(e, e.air[idx].slot) - cur;
                        const cap = (sl.find(x => x.key === e.air[idx].slot) || {}).cap || 0;
                        const servOK = (nq <= cur) || !fl || LEGAL.canAddAir(fl, e, e.air[idx].id, nq - cur);
                        if (rest + nq <= cap && servOK) e.air[idx].qty = nq;
                    } else {
                        const slotNow = sl.find(x => x.key === e.air[idx].slot) || sl[0];
                        const pool = POOL_AIR.filter(t => airKind(t) === e.air[idx].kind
                            && !(e.air[idx].kind === 'fighter' && slotNow && slotNow.allow !== 'ALL' && t.airSize === 'large'));
                        if (!pool.length) continue;
                        const at = pick(pool);
                        if (at.id !== e.air[idx].id && fl && !LEGAL.canAddAir(fl, e, at.id, e.air[idx].qty || 1)) continue;
                        e.air[idx].id = at.id;
                    }
                }
            }
            return reconcileAir(e);
        }
        function toSpecAir(s) {
            return { id: s.id, count: s.count || 1, mods: Object.assign({}, s.mods || {}), position: s.position,
                air: (s.air || []).map(a => ({ id: a.id, qty: a.qty || 1, slot: a.slot, kind: a.kind })) };
        }
        const specOf = f => ({ main: f.main.map(toSpecAir), reinf: f.reinf.map(toSpecAir) });

        /* ---------- 合法性（项目 FleetCheck 的浏览器移植：_fleet_legal.js 同款口径） ---------- */
        const LEGAL = (function makeLegal() {
            const D = () => E.ships || {};
            const FC = E.FleetCheck;
            try {
                if (typeof window !== 'undefined') {
                    if (!window.SHIP_DB || typeof window.SHIP_DB.get !== 'function')
                        window.SHIP_DB = { get: id => D()[id], all: () => Object.values(D()) };
                }
            } catch (e) { }
            const ready = !!(FC && FC.check && FC.airSlots);
            const nm = id => (D()[id] && D()[id].name) || id;
            const toFC = fl => ({
                main: (fl.main || []).map(e => ({ id: e.id, qty: Math.max(1, e.count || 1), pos: e.position, mods: Object.assign({}, e.mods || {}),
                    air: (e.air || []).map(a => ({ id: a.id, qty: Math.max(1, a.qty || 1), slot: a.slot, kind: a.kind })) })),
                reinforcement: (fl.reinf || []).map(e => ({ id: e.id, qty: Math.max(1, e.count || 1), pos: '增援', mods: Object.assign({}, e.mods || {}), air: [] })),
                flagship: fl.fl || ''
            });
            const fromFC = f => ({
                main: (f.main || []).map(s => ({ id: s.id, count: s.qty, position: s.pos, mods: s.mods || {}, air: s.air || [] })),
                reinf: (f.reinforcement || []).map(s => ({ id: s.id, count: s.qty, position: '中排', mods: s.mods || {}, air: [] })),
                fl: f.flagship || ((f.main && f.main[0]) ? f.main[0].id : null)
            });
            function check(fl) {
                if (!ready) return { ok: true, errors: [], note: '引擎没有 FleetCheck，跳过' };
                try {
                    const r = FC.check(toFC(fl), { checkUser: false });
                    return { ok: (r.errors || []).length === 0, errors: r.errors || [], fixed: r.fixed };
                } catch (e) { return { ok: true, errors: [], note: 'FleetCheck 抛错：' + e.message }; }
            }
            function legalize(fl) {
                if (!ready) return { fleet: fl, notes: [], ok: true };
                let cur = toFC(fl);
                const notes = [];
                for (let round = 0; round < 8; round++) {
                    const r = FC.check(cur, { checkUser: false });
                    cur = r.fixed || cur;
                    const errs = r.errors || [];
                    if (!errs.length) break;
                    const cnt = {};
                    ['main', 'reinforcement'].forEach(sec => (cur[sec] || []).forEach(s => { cnt[s.id] = (cnt[s.id] || 0) + s.qty; }));
                    let acted = false;
                    for (const e of errs) {
                        const m = /^「(.+?)」服役超上限/.exec(e);
                        if (!m) continue;
                        const id = Object.keys(D()).find(x => D()[x] && D()[x].name === m[1]);
                        if (!id) continue;
                        const lim = D()[id].serviceLimit || 99;
                        let excess = (cnt[id] || 0) - lim;
                        if (excess <= 0) continue;
                        for (const sec of ['reinforcement', 'main']) {
                            if (excess <= 0) break;
                            const arr = cur[sec] || [];
                            for (let i = arr.length - 1; i >= 0 && excess > 0; i--) {
                                const s = arr[i];
                                if (s.id !== id) continue;
                                const floor = (sec === 'main') ? 1 : 0;
                                const cut = Math.min(excess, s.qty - floor);
                                if (cut > 0) { s.qty -= cut; excess -= cut; acted = true; notes.push('削 ' + nm(id) + '（' + (sec === 'main' ? '主舰队' : '增援') + '）−' + cut); }
                            }
                            if (sec === 'main' && excess > 0) {
                                for (let i = arr.length - 1; i >= 0 && excess > 0; i--) {
                                    if (arr[i].id !== id) continue;
                                    const q = arr[i].qty; arr.splice(i, 1); excess -= q; acted = true;
                                    notes.push('删 ' + nm(id) + '（主舰队）−' + q);
                                }
                            }
                        }
                    }
                    if (!acted) break;
                }
                cur.main = (cur.main || []).filter(s => s.qty >= 1);
                cur.reinforcement = (cur.reinforcement || []).filter(s => s.qty >= 1);
                const out = fromFC(cur);
                const r2 = check(out);
                return { fleet: out, notes: notes, ok: r2.ok, errors: r2.errors || [] };
            }
            function usedOf(fl, id) {
                return (fl.main || []).concat(fl.reinf || []).reduce((a, e) => a + (e.id === id ? Math.max(1, e.count || 1) : 0), 0);
            }
            function canAdd(fl, id, n) {
                if (!ready) return true;
                const lim = (D()[id] && D()[id].serviceLimit) || 99;
                return usedOf(fl, id) + (n || 1) <= lim;
            }
            function canAddAir(fl, shipEntry, airId, qty) {
                if (!ready) return true;
                const t = D()[airId]; if (!t) return false;
                const q = Math.max(1, qty || 1);
                const kind = (t.aircraftType === 'corvette' || t.type === 'corvette') ? 'corvette' : 'fighter';
                const slots = (FC.airSlots(D()[shipEntry.id], shipEntry.mods || {}, shipEntry.count || 1) || []).filter(x => x.kind === kind);
                if (!slots.length) return false;
                const okSlots = slots.filter(x => !(kind === 'fighter' && x.allow !== 'ALL' && t.airSize === 'large'));
                if (!okSlots.length) return false;
                const cap = okSlots.reduce((a, x) => a + x.cap, 0);
                const usedInSlots = (shipEntry.air || []).filter(a => a.kind === kind).reduce((a, x) => a + (x.qty || 1), 0);
                if (usedInSlots + q > cap) return false;
                const lim = t.serviceLimit || 99;
                const usedAll = (fl.main || []).concat(fl.reinf || []).reduce((a, e) => a + (e.air || []).filter(x => x.id === airId).reduce((b, x) => b + (x.qty || 1), 0), 0);
                return usedAll + q <= lim;
            }
            function topUp(fl, minCV, maxCV) {
                const cap = maxCV || CV_CAP;
                const out = { main: (fl.main || []).map(e => Object.assign({}, e)), reinf: (fl.reinf || []).map(e => Object.assign({}, e)), fl: fl.fl };
                let guard = 0;
                const cvOfE = e => ((D()[e.id] && D()[e.id].commandValue) || 0);
                const fCV = () => out.main.reduce((a, e) => a + cvOfE(e) * (Math.max(1, e.count || 1)), 0);
                while (fCV() < minCV && guard++ < 60) {
                    const room = cap - fCV();
                    let acted = false;
                    const cands = out.main.slice().sort((a, b) => cvOfE(a) - cvOfE(b));
                    for (const e of cands) {
                        if (cvOfE(e) > room) continue;
                        if (!canAdd(out, e.id, 1)) continue;
                        e.count = (e.count || 1) + 1; acted = true; break;
                    }
                    if (acted) continue;
                    const pool = Object.keys(D()).filter(id => {
                        const t = D()[id];
                        return t && t.hp > 0 && t.position !== 'aircraft' && (t.commandValue || 0) > 0 && (t.commandValue || 0) <= room && canAdd(out, id, 1);
                    }).sort((a, b) => (D()[a].commandValue || 0) - (D()[b].commandValue || 0));
                    if (pool.length) {
                        const id = pool[0];
                        const ex = out.main.find(x => x.id === id);
                        if (ex) ex.count++;
                        else out.main.push({ id: id, count: 1, position: D()[id].position || '中排', mods: {}, air: [] });
                        acted = true;
                    }
                    if (!acted) break;
                }
                return out;
            }
            return { check, legalize, topUp, canAdd, canAddAir, usedOf, ready, toFC, fromFC };
        })();

        /* ---------- 变异：加点（只能重分配，不可追加）/ 配队 / 增援 ---------- */
        function allApNodes(ap) {
            const out = [];
            Object.keys(ap || {}).forEach(cdn => { const lv = (ap[cdn] && ap[cdn].lv) || {}; Object.keys(lv).forEach(nd => out.push([cdn, nd])); });
            return out;
        }
        function mutateAp(ap, rate) {
            const out = {};
            const budget = {};
            Object.keys(ap || {}).forEach(c => {
                out[c] = { lv: Object.assign({}, (ap[c] || {}).lv || {}) };
                budget[c] = Object.values(out[c].lv).reduce((a, b) => a + (b || 0), 0);
                /* ★ 舰船库模式：这艘船的可花点数上限 = min(原有点数, 用户填的蓝点) */
                if (TP_LIB && TP_LIB[c] && budget[c] > TP_LIB[c]) budget[c] = TP_LIB[c];
            });
            const nodes = allApNodes(out);
            if (!nodes.length) return out;
            const spent = c => Object.values(out[c].lv).reduce((a, b) => a + (b || 0), 0);
            const k = 1 + (rnd() < rate ? 1 : 0);
            for (let i = 0; i < k; i++) {
                const [c, nd] = pick(nodes);
                const cur = out[c].lv[nd] || 0;
                let nv = cur + (rnd() < 0.5 ? -1 : 1);
                if (nv > cur && spent(c) + (nv - cur) > budget[c]) nv = cur;
                out[c].lv[nd] = clamp(nv, 0, 12);
            }
            return out;
        }
        function mutateFleet(fl, db, rate) {
            const out = fl.map(e => Object.assign({}, e, { air: (e.air || []).map(a => Object.assign({}, a)) }));
            const acts = ['add', 'del', 'count', 'mod', 'pos', 'swap', 'air', 'air'];
            const k = 1 + (rnd() < rate * 2 ? 1 : 0);
            for (let i = 0; i < k; i++) {
                const a = pick(acts);
                if (a === 'add') {
                    const t = pick(POOL), n = 1 + Math.floor(rnd() * 2);
                    if (fleetCV(out, db) + cvOf(t.id, db) * n > CV_CAP) continue;
                    if (!LEGAL.canAdd({ main: out, reinf: fl.reinf || [] }, t.id, n)) continue;
                    const ex = out.find(x => x.id === t.id);
                    if (ex) ex.count += n; else out.push({ id: t.id, count: n, position: t.position || '中排', mods: {}, air: [] });
                } else if (a === 'del' && out.length > 1) {
                    const i2 = Math.floor(rnd() * out.length);
                    const after = out.filter((_, j) => j !== i2);
                    if (fleetCV(after, db) >= MIN_CV) out.splice(i2, 1);
                }
                else if (a === 'swap' && out.length) {
                    const t = pick(POOL), i2 = Math.floor(rnd() * out.length);
                    const after = fleetCV(out, db) - cvOf(out[i2].id, db) * out[i2].count + cvOf(t.id, db) * out[i2].count;
                    const keep = { main: out.filter((_, k) => k !== i2), reinf: fl.reinf || [] };
                    if (after <= CV_CAP && after >= MIN_CV && LEGAL.canAdd(keep, t.id, out[i2].count))
                        out[i2] = { id: t.id, count: out[i2].count, position: t.position || '中排', mods: {}, air: [] };
                }
                else if (out.length) {
                    const e = out[Math.floor(rnd() * out.length)];
                    if (a === 'count') {
                        const nn = clamp(e.count + (rnd() < 0.5 ? -1 : 1), 1, 8);
                        const after = fleetCV(out, db) - cvOf(e.id, db) * e.count + cvOf(e.id, db) * nn;
                        const servOK = (nn <= e.count) || LEGAL.canAdd({ main: out, reinf: fl.reinf || [] }, e.id, nn - e.count);
                        if (after <= CV_CAP && after >= MIN_CV && servOK) { e.count = nn; reconcileAir(e); }
                    }
                    else if (a === 'pos') e.position = pick(['前排', '中排', '后排']);
                    else if (a === 'mod') {
                        const m = (DB[e.id] || {}).modules || {};
                        let ks = Object.keys(m).filter(x => !x.startsWith('_') && m[x] && m[x].variants && Object.keys(m[x].variants).length);
                        /* ★ 舰船库模式：只允许用库里拥有的模块变体 */
                        if (LIB && LIB.ships[e.id] && LIB.ships[e.id].mods) {
                            const allowed = LIB.ships[e.id].mods;
                            ks = ks.filter(x => allowed[x] && allowed[x].length && allowed[x].some(v => m[x].variants[v]));
                        }
                        if (ks.length) {
                            const kk = pick(ks);
                            let vs = Object.keys(m[kk].variants);
                            if (LIB && LIB.ships[e.id] && LIB.ships[e.id].mods && LIB.ships[e.id].mods[kk])
                                vs = LIB.ships[e.id].mods[kk].filter(v => m[kk].variants[v]);
                            if (vs.length) { e.mods = Object.assign({}, e.mods, { [kk]: pick(vs) }); reconcileAir(e); }
                        }
                    }
                    else if (a === 'air') mutateAir(e, rate, { main: out, reinf: fl.reinf || [] });
                }
            }
            out.forEach(e => reconcileAir(e));
            return out.length ? out : fl;
        }
        function mutateReinf(re, db, rate, main) {
            const out = (re || []).map(e => Object.assign({}, e));
            let guard = 0;
            while (reinfShips(out) < REINF_CAP && guard++ < 60) {
                const t = pick(POOL);
                if (!LEGAL.canAdd({ main: main || [], reinf: out }, t.id, 1)) continue;
                out.push({ id: t.id, count: 1, position: '中排', mods: {}, air: [] });
            }
            while (reinfShips(out) > REINF_CAP && out.length && guard++ < 160) {
                const last = out[out.length - 1];
                if ((last.count || 1) > 1) last.count--; else out.pop();
            }
            if (rnd() < rate * 2 && out.length) {
                const i = Math.floor(rnd() * out.length);
                const t = pick(POOL);
                const rest = { main: main || [], reinf: out.filter((_, k) => k !== i) };
                if (LEGAL.canAdd(rest, t.id, out[i].count || 1))
                    out[i] = { id: t.id, count: out[i].count || 1, position: '中排', mods: {}, air: [] };
            }
            return out;
        }
        /* ---------- 基因组 ---------- */
        let WARM_NET = cfg.warmNet || null;
        const PURE = !!cfg.pure;
        function randGenome(base0, light) {
            const g = {
                escort: { main: light ? base0.escort.main.map(e => Object.assign({}, e)) : mutateFleet(base0.escort.main, DB, 0.6), reinf: light ? base0.escort.reinf.slice() : mutateReinf(base0.escort.reinf, DB, 1, base0.escort.main), fl: null },
                escorted: { main: light ? base0.escorted.main.map(e => Object.assign({}, e)) : mutateFleet(base0.escorted.main, DB, 0.6), reinf: light ? base0.escorted.reinf.slice() : mutateReinf(base0.escorted.reinf, DB, 1, base0.escorted.main), fl: null },
                ap: light ? mutateAp(base0.ap, 0) : mutateAp(base0.ap, 0.8),
                net: PURE ? null : (WARM_NET ? JSON.parse(JSON.stringify(WARM_NET)) : newNetwork()),
                mutRate: clamp(0.05 + rnd() * 0.25, 0.01, 0.6), opBudget: 6000000 + Math.floor(rnd() * 34000000)
            };
            g.escort.fl = pickFrom(g.escort.main) || base0.escort.fl || null;
            g.escorted.fl = pickFrom(g.escorted.main) || base0.escorted.fl || null;
            [g.escort, g.escorted].forEach(f => f.main.forEach(reconcileAir));
            return g;
        }
        function pickFrom(main) { return main && main.length ? pick(main).id : null; }
        function mutate(g) {
            const rate = clamp(g.mutRate * (0.75 + rnd() * 0.58), 0.01, 0.6);
            const opBudget = clamp(Math.round(g.opBudget * (0.75 + rnd() * 0.58)), 2000000, 400000000);
            const nm = {
                escort: { main: mutateFleet(g.escort.main, DB, rate), reinf: mutateReinf(g.escort.reinf, DB, rate, g.escort.main), fl: g.escort.fl },
                escorted: { main: mutateFleet(g.escorted.main, DB, rate), reinf: mutateReinf(g.escorted.reinf, DB, rate, g.escorted.main), fl: g.escorted.fl },
                ap: mutateAp(g.ap, rate), net: (PURE || !g.net) ? null : mutateNet(g.net, rate), mutRate: rate, opBudget
            };
            if (rnd() < 0.35) nm.escort.fl = pickFrom(nm.escort.main) || nm.escort.fl;
            if (rnd() < 0.35) nm.escorted.fl = pickFrom(nm.escorted.main) || nm.escorted.fl;
            return nm;
        }

        /* ---------- 决策钩子（网络 ↔ 引擎） ---------- */
        let CA = null, CB = null;
        function newStat() {
            return { hist: new Array(9).fill(0), hold: 0, phase: { early: 0, mid: 0, late: 0 },
                tgt: { aircraft: 0, superCap: 0, cruiser: 0, escorted: 0, other: 0 },
                tgtHpSum: 0, tgtHpN: 0, calls: 0, reused: 0 };
        }
        function bumpTarget(st, e) {
            if (!e) return;
            st.tgtHpSum += (e.hp || 0) / Math.max(1, e.maxHp || 1); st.tgtHpN++;
            if (e.position === 'aircraft') st.tgt.aircraft++;
            else if (['battleship', 'aircraftcarrier', 'battlecruiser', 'support'].indexOf(e.type) >= 0) st.tgt.superCap++;
            else if (e.type === 'cruiser') st.tgt.cruiser++;
            else if (e.isEscorted) st.tgt.escorted++;
            else st.tgt.other++;
        }
        E.setActionHook((st, info) => {
            const s = (info.ship && info.ship.side === 'ally') ? CA : CB;
            if (!s) return undefined;
            if (s.used >= s.budget) { s.starved = true; return undefined; }
            const K = Math.min(info.K, 8);
            const fr = forward(s.net, st);
            s.used += fr.ops;
            let bi = K, bv = fr.out[K] - HOLD_BIAS;
            for (let i = 0; i < K; i++) if (fr.out[i] > bv) { bv = fr.out[i]; bi = i; }
            if (s.stat) {
                s.stat.calls++;
                s.stat.hist[bi >= K ? 8 : bi]++;
                if (bi >= K) s.stat.hold++;
                else bumpTarget(s.stat, info.enemies[bi]);
                const ph = st[20] || 0;
                if (ph < 0.34) s.stat.phase.early++; else if (ph < 0.67) s.stat.phase.mid++; else s.stat.phase.late++;
            }
            s.lastVal = fr.val;      // 供 3D 页面看"这一发激活了哪些节点"
            return bi >= K ? -1 : bi;
        });

        /* ---------- 行为向量 / 新颖性 / E8 / 选择 / 繁殖 ---------- */
        let ARCHIVE = [];
        let ARCH_THRESHOLD = 0.15;
        let ARCH_ENTERED = 0, ARCH_LAST_ENTER_GEN = 0;
        function behVec(g, m) {
            const all = [].concat(g.escort.main || [], g.escorted.main || []);
            let cvTot = 0, cvFront = 0, cvBack = 0, dmgTot = 0, dmgEnergy = 0;
            all.forEach(e => {
                const cv = (cvOf(e.id, DB) || 0) * (e.count || 1);
                cvTot += cv;
                if (e.position === '前排') cvFront += cv; else cvBack += cv;
                const t = DB[e.id] || {};
                const wpns = [].concat(t.weapons || []);
                Object.values(t.modules || {}).forEach(mm => { if (mm && mm.weapons) wpns.push.apply(wpns, mm.weapons); });
                wpns.forEach(w => {
                    const d = ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0);
                    dmgTot += d;
                    const at = String(w.attr || w.attribute || w.damageType || '');
                    if (/能量|离子|energy|ion/i.test(at)) dmgEnergy += d;
                });
            });
            const st = m.stat || { hist: new Array(9).fill(0), tgt: { aircraft: 0, superCap: 0, cruiser: 0, escorted: 0, other: 0 }, calls: 0, tgtHpN: 0, tgtHpSum: 0 };
            const calls = Math.max(1, st.calls);
            const hooked = st.calls > 0;
            const hold = (st.hist[8] || 0) / calls;
            const gtT = Math.max(1, st.tgt.aircraft + st.tgt.superCap + st.tgt.cruiser + st.tgt.escorted + st.tgt.other);
            const airRatio = st.tgt.aircraft / gtT;
            const dmgAll = Math.max(1, (m.dmgOut || 0));
            const repairRatio = (m.repairOut || 0) / dmgAll;
            const airShare = (m.airOut || 0) / dmgAll;
            return [
                clamp01(cvTot ? cvFront / cvTot : 0),
                clamp01(dmgTot ? dmgEnergy / dmgTot : 0),
                clamp01(repairRatio),
                clamp01(hooked && st.tgtHpN ? st.tgtHpSum / st.tgtHpN : airShare),
                clamp01(hooked ? airRatio : (m.myRemain || 0)),
                clamp01(hooked ? hold : (m.foeRemain || 0)),
                clamp01(cvTot ? cvBack / cvTot : 0),
                clamp01(m.avgAliveRatio || 0)
            ];
        }
        const behDist = (a, b) => { let s = 0; for (let i = 0; i < 8; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
        function novelty(v) {
            if (!ARCHIVE.length) return 1;
            const d = ARCHIVE.map(a => behDist(a.v, v)).sort((x, y) => x - y);
            const k = Math.min(ARCH_K, d.length);
            let s = 0; for (let i = 0; i < k; i++) s += d[i];
            return s / k;
        }
        function archiveUpdate(v, gen) {
            const nv = novelty(v);
            if (nv > ARCH_THRESHOLD) { ARCHIVE.push({ v: v, g: gen }); ARCH_ENTERED++; ARCH_LAST_ENTER_GEN = gen; }
            return nv;
        }
        function archiveAdjust(gen) {
            if (ARCH_ENTERED > ARCH_MAX_ENTER) ARCH_THRESHOLD *= 1.25;
            else if (gen - ARCH_LAST_ENTER_GEN > ARCH_RARE_GENS && ARCH_THRESHOLD > 0.005) ARCH_THRESHOLD *= 0.95;
            ARCH_ENTERED = 0;
        }
        function crossover(pa, pb) {
            if (!pa.net || !pb.net) {
                const swap = rnd() < 0.5;
                const c = {
                    escort: JSON.parse(JSON.stringify(swap ? pb.escort : pa.escort)),
                    escorted: JSON.parse(JSON.stringify(swap ? pa.escorted : pb.escorted)),
                    ap: JSON.parse(JSON.stringify(rnd() < 0.5 ? pa.ap : pb.ap)),
                    net: null, mutRate: rnd() < 0.5 ? pa.mutRate : pb.mutRate, opBudget: pa.opBudget
                };
                c.escort.fl = pickFrom(c.escort.main) || c.escort.fl;
                c.escorted.fl = pickFrom(c.escorted.main) || c.escorted.fl;
                [c.escort, c.escorted].forEach(f => f.main.forEach(reconcileAir));
                return mutate(c);
            }
            const child = { net: { nodes: [], conns: [], hidSeq: Math.max(pa.net.hidSeq || 1, pb.net.hidSeq || 1) },
                mutRate: pa.mutRate, opBudget: pa.opBudget,
                escort: JSON.parse(JSON.stringify(pa.escort)), escorted: JSON.parse(JSON.stringify(pa.escorted)),
                ap: JSON.parse(JSON.stringify(rnd() < 0.5 ? pa.ap : pb.ap)) };
            child.escort.fl = pickFrom(child.escort.main) || child.escort.fl;
            child.escorted.fl = pickFrom(child.escorted.main) || child.escorted.fl;
            const byInno = new Map(); (pb.net.conns || []).forEach(c => byInno.set(c.innov, c));
            (pa.net.conns || []).forEach(c => {
                const o = byInno.get(c.innov);
                child.net.conns.push(o ? Object.assign({}, (rnd() < 0.5 ? c : o)) : Object.assign({}, c));
            });
            const ids = new Set(); child.net.conns.forEach(c => { ids.add(c.in); ids.add(c.out); });
            (pa.net.nodes || []).forEach(n => { if (n.type === 'in' || n.type === 'out' || ids.has(n.id)) child.net.nodes.push(Object.assign({}, n)); });
            return child;
        }
        function dualSelect(scored, gen, POP) {
            const ranked = scored.slice().sort((a, b) => b.fit - a.fit);
            const frac = gen <= 200 ? 0.6 : 0.8;
            const N = Math.max(1, Math.round(POP * frac));
            const M = Math.max(0, POP - N);
            const elites = ranked.slice(0, N);
            const eliteSet = new Set(elites.map(e => e.idx));
            const novels = ranked.filter(e => !eliteSet.has(e.idx)).sort((a, b) => b.nov - a.nov).slice(0, M);
            return { base: elites.concat(novels), N: N, M: novels.length };
        }
        function tournament(base, k) {
            let best = null;
            for (let i = 0; i < k; i++) { const c = base[Math.floor(rnd() * base.length)]; if (!best || c.fit > best.fit) best = c; }
            return best.g;
        }
        /* E8 行为空间（240 根向量 × 强度 3 档 = 720 格） */
        const E8_ROOTS = (() => {
            const R = [];
            for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++)
                for (const a of [1, -1]) for (const b of [1, -1]) { const v = new Array(8).fill(0); v[i] = a; v[j] = b; R.push(v); }
            for (let m = 0; m < 256; m++) {
                let neg = 0; const v = new Array(8);
                for (let k = 0; k < 8; k++) { const s = (m >> k) & 1; if (s) neg++; v[k] = s ? -0.5 : 0.5; }
                if (neg % 2 === 0) R.push(v);
            }
            return R;
        })();
        const E8_MAG_BINS = 3;
        const E8_MAXLEN = 0.5 * Math.sqrt(8);
        const E8_CELLS = E8_ROOTS.length * E8_MAG_BINS;
        const e8Cell = (v) => {
            let n = 0; const c = new Array(8);
            for (let i = 0; i < 8; i++) { c[i] = (v[i] || 0) - 0.5; n += c[i] * c[i]; }
            const len = Math.sqrt(n);
            n = len || 1;
            let best = 0, bestDot = -1e9;
            for (let r = 0; r < E8_ROOTS.length; r++) {
                const R = E8_ROOTS[r]; let d = 0;
                for (let i = 0; i < 8; i++) d += (c[i] / n) * R[i];
                if (d > bestDot) { bestDot = d; best = r; }
            }
            const mag = Math.min(E8_MAG_BINS - 1, Math.floor((len / E8_MAXLEN) * E8_MAG_BINS));
            return best * E8_MAG_BINS + mag;
        };
        let E8_MAP = new Map();
        const cvOK = g => !!(g && g.escort && g.escort.main && g.escorted && g.escorted.main) &&
            Math.min(fleetCV(g.escort.main, DB), fleetCV(g.escorted.main, DB)) >= MIN_CV &&
            Math.max(fleetCV(g.escort.main, DB), fleetCV(g.escorted.main, DB)) <= CV_CAP &&
            LEGAL.check(g.escort).ok && LEGAL.check(g.escorted).ok;
        function mapElitesUpdate(v, fit, g, gen) {
            if (!v) return false;
            const c = e8Cell(v), cur = E8_MAP.get(c);
            if (!cur || fit > cur.fit) { E8_MAP.set(c, { v: v, fit: fit, g: g, gen: gen }); return true; }
            return false;
        }
        const sampleOpps = (pool, k) => {
            if (pool.length <= k) return pool;
            const c = pool.slice(), out = [];
            for (let i = 0; i < k && c.length; i++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
            return out;
        };
        function makeOppPool(top3, base) {
            const pool = [];
            for (const g of (top3 || []).slice(0, OPP_TOP)) { try { pool.push(mutate(g)); } catch (e) { } }
            while (pool.length < OPP_POOL) pool.push(randGenome(base, false));
            return pool.slice(0, OPP_POOL);
        }
        /* ★ 固定方（用户给定）专用的对手池：主体是【给定配队本身】，其余是它的少量变异体
           （不带网络 = 走引擎默认规则）—— 训练目标始终是"击败这一套"。 */
        function makeOppPoolFixed(keep) {
            const pool = [keep];
            for (let i = 0; i < OPP_POOL - 1; i++) { try { const m = mutate(keep); m.net = null; pool.push(m); } catch (e) { } }
            return pool;
        }
        function breed(base, pop, elite) {
            const out = [elite];
            let guard = 0;
            const cells = [...E8_MAP.keys()];
            while (out.length < pop && guard++ < pop * 30) {
                if (!base.length) { out.push(mutate(elite)); continue; }
                if (cells.length >= 2 && rnd() < MAP_PARENT_RATE) {
                    const g1 = E8_MAP.get(cells[Math.floor(rnd() * cells.length)]).g;
                    const g2 = E8_MAP.get(cells[Math.floor(rnd() * cells.length)]).g;
                    const ch = crossover(g1, g2);
                    if (ch && cvOK(ch)) { out.push(ch); continue; }
                }
                const pa = tournament(base, 3);
                const child = (base.length > 1 && rnd() < CROSS_RATE) ? crossover(pa, tournament(base, 3)) : mutate(pa);
                if (child && cvOK(child)) out.push(child);
            }
            while (out.length < pop) out.push(mutate(elite));
            return out;
        }

        /* ---------- 适应度（可进化目标向量 + 冻结标尺） ---------- */
        const FIT0 = { kw: 10000, kt: 5000, km: 2000, dw: 1.0, dt: 0.1 };
        const FIT = { A: Object.assign({}, FIT0), B: Object.assign({}, FIT0) };
        const FIT_BOUND = { kw: [4000, 20000], kt: [500, 12000], km: [200, 6000], dw: [0.05, 3], dt: [0.01, 1] };
        function mutateFit(f) {
            const o = {};
            for (const k of Object.keys(FIT0)) {
                const b = FIT_BOUND[k];
                o[k] = clamp(f[k] * (0.85 + rnd() * 0.30), b[0], b[1]);
            }
            return o;
        }
        function scoreUnder(m, fit) {
            const s = m && m.stats;
            if (!s || !s.n) return -1e9;
            const sum = fit.kw * s.nWin - fit.dw * s.durWin
                - fit.dw * s.durLose
                + fit.kt * s.nTimeout + fit.km * s.diffTimeout - fit.dt * s.durTimeout
                - s.n * s.sp;
            return sum / s.n;
        }
        function fight(gA, gB, seed, fit) {
            const A = specOf(gA.escort), Ae = specOf(gA.escorted), B = specOf(gB.escort), Be = specOf(gB.escorted);
            CA = gA.net ? { net: gA.net, used: 0, budget: gA.opBudget, starved: false, stat: newStat() } : null;
            CB = gB.net ? { net: gB.net, used: 0, budget: gB.opBudget, starved: false, stat: newStat() } : null;
            const r = E.runBattle({
                A: A.main, AEscorted: Ae.main, B: B.main, BEscorted: Be.main,
                AAddPoints: gA.ap, BAddPoints: gB.ap,
                AFlagship: gA.escort.fl, AEscortedFlagship: gA.escorted.fl,
                BFlagship: gB.escort.fl, BEscortedFlagship: gB.escorted.fl,
                seed: seed, maxSec: cfg.maxSec, dt: cfg.dt, stallSec: cfg.stallSec
            });
            const opsA = CA ? CA.used : 0, opsB = CB ? CB.used : 0, starA = CA ? CA.starved : false, starB = CB ? CB.starved : false;
            const statA = CA ? CA.stat : newStat(), statB = CB ? CB.stat : newStat();
            const valA = CA ? CA.lastVal : null;
            CA = null; CB = null;
            if (!r) return null;
            const myS = r.我方.存活舰船 + r.我方.存活载机, foS = r.敌方.存活舰船 + r.敌方.存活载机;
            const myr = (r.我方.剩余结构值 || 0) / Math.max(1, r.我方.总结构值 || 1);
            const for_ = (r.敌方.剩余结构值 || 0) / Math.max(1, r.敌方.总结构值 || 1);
            const f = fit || FIT0;
            let score, scoreFixed, kind;
            if (myS > 0 && foS === 0) { score = f.kw - f.dw * r.时长; scoreFixed = FIT0.kw - FIT0.dw * r.时长; kind = 'win'; }
            else if (myS === 0 && foS > 0) { score = -f.dw * r.时长; scoreFixed = -FIT0.dw * r.时长; kind = 'lose'; }
            else if (myS === 0 && foS === 0) { score = 0; scoreFixed = 0; kind = 'draw'; }
            else { score = f.kt + (myr - for_) * f.km - r.时长 * f.dt; scoreFixed = FIT0.kt + (myr - for_) * FIT0.km - FIT0.dt * r.时长; kind = 'timeout'; }
            const sz = gA.net ? netSize(gA.net) : { nodes: 0, conns: 0 };
            const sizePenalty = SIZE_LAMBDA_NODE * sz.nodes + SIZE_LAMBDA_CONN * sz.conns;
            score -= sizePenalty; scoreFixed -= sizePenalty;
            return { score, scoreFixed, kind, dur: r.时长, stalled: !!r.僵局, ops: opsA, starved: starA, myAlive: myS, foeAlive: foS, myr, foer: for_, stat: statA, valA: valA, sizePenalty,
                dmgOut: ((r.我方.总输出对舰 || 0) + (r.我方.总输出对空 || 0)),
                airOut: (r.我方.总输出对空 || 0),
                myRemain: myr, foeRemain: for_,
                repairOut: (r.我方.总维修 || 0),
                avgAliveRatio: (r.我方.平均生存时间占比 || 0),
                tgtHpAvg: (statA && statA.tgtHpN) ? (statA.tgtHpSum / statA.tgtHpN) : 0.5 };
        }
        function evaluate(g, opps, seed0, fit) {
            let sum = 0, fsum = 0, n = 0, ops = 0, star = 0, wins = 0, durs = 0;
            let dmgOut = 0, repairOut = 0, aliveR = 0, tgtHp = 0, myrS = 0, foerS = 0;
            const hist = new Array(9).fill(0); let calls = 0;
            const st = { n: 0, nWin: 0, durWin: 0, nLose: 0, durLose: 0, nDraw: 0, nTimeout: 0, durTimeout: 0, diffTimeout: 0, sp: 0 };
            const tgt = { aircraft: 0, superCap: 0, cruiser: 0, escorted: 0, other: 0 };
            const phase = { early: 0, mid: 0, late: 0 };
            const kinds = { win: 0, lose: 0, draw: 0, timeout: 0 };
            let lastVal = null;
            for (let i = 0; i < opps.length; i++) {
                const r = fight(g, opps[i], seed0 + i * 7919, fit);
                if (!r) continue;
                sum += r.score; fsum += (r.scoreFixed !== undefined ? r.scoreFixed : r.score); n++; ops += r.ops; star += r.starved ? 1 : 0;
                kinds[r.kind] = (kinds[r.kind] || 0) + 1;
                if (r.kind === 'win') { wins++; durs += r.dur; st.nWin++; st.durWin += r.dur; }
                else if (r.kind === 'lose') { st.nLose++; st.durLose += r.dur; }
                else if (r.kind === 'draw') { st.nDraw++; }
                else if (r.kind === 'timeout') { st.nTimeout++; st.durTimeout += r.dur; st.diffTimeout += (r.myr - r.foer); }
                st.sp = r.sizePenalty || 0;
                dmgOut += r.dmgOut || 0; repairOut += r.repairOut || 0; aliveR += r.avgAliveRatio || 0; tgtHp += r.tgtHpAvg || 0;
                myrS += r.myr || 0; foerS += r.foer || 0;
                if (r.valA) lastVal = r.valA;
                if (r.stat) {
                    r.stat.hist.forEach((v, k) => hist[k] += v);
                    calls += r.stat.calls;
                    Object.keys(tgt).forEach(k => tgt[k] += r.stat.tgt[k]);
                    Object.keys(phase).forEach(k => phase[k] += r.stat.phase[k]);
                }
            }
            const m = { score: n ? sum / n : -1e9, fscore: n ? fsum / n : -1e9, ops: n ? ops / n : 0, starved: n ? star / n : 0, wins: n ? wins / n : 0, winDur: wins ? durs / wins : 0, hist, calls, tgt, phase, kinds, n,
                dmgOut: n ? dmgOut / n : 0, repairOut: n ? repairOut / n : 0, avgAliveRatio: n ? aliveR / n : 0, tgtHpAvg: n ? tgtHp / n : 0.5,
                myRemain: n ? myrS / n : 0, foeRemain: n ? foerS / n : 0 };
            st.n = n;
            m.stats = st;
            m.beh = behVec(g, m);
            m.lastVal = lastVal;
            return m;
        }

        /* ---------- 存档 / 续跑（IndexedDB） ---------- */
        const K = k => k + ':' + ISLE;
        const leanM = m => ({
            score: m.score, fscore: m.fscore, wins: m.wins, winDur: m.winDur, ops: m.ops, starved: m.starved,
            beh: m.beh, stats: m.stats, kinds: m.kinds, n: m.n, calls: m.calls, hist: m.hist, tgt: m.tgt, phase: m.phase,
            dmgOut: m.dmgOut, repairOut: m.repairOut, avgAliveRatio: m.avgAliveRatio, myRemain: m.myRemain, foeRemain: m.foerRemain === undefined ? m.foeRemain : m.foeRemain
        });
        let SAVE_AT = 0, END_GEN = null;
        async function saveSnapshot(gen, bestA, bestB, mA, mB, frz, born) {
            if (!Store) return;
            try {
                await Store.put('kv', K('snap'), { gen, A: bestA, B: bestB, mA: leanM(mA), mB: leanM(mB), fit: FIT, frz: frz, born: born, savedAt: Date.now() });
                await Store.put('kv', K('run'), { isle: ISLE, gen, of: (END_GEN != null ? END_GEN : cfg.gens), updatedAt: Date.now(), paused: _pause });
                SAVE_AT = gen;
                post({ type: 'saved', isle: ISLE, gen });
            } catch (e) { post({ type: 'log', isle: ISLE, msg: '存档失败：' + e.message }); }
        }
        async function saveAux() {
            if (!Store) return;
            try {
                if (ARCHIVE.length) await Store.put('kv', K('arc'), { threshold: ARCH_THRESHOLD, archive: ARCHIVE.slice(-4000) });
                if (E8_MAP.size) {
                    const arr = [...E8_MAP.entries()].sort((a, b) => b[1].fit - a[1].fit).slice(0, 240)
                        .map(kv => ({ c: kv[0], v: kv[1].v, fit: +kv[1].fit.toFixed(1), gen: kv[1].gen, g: kv[1].g }));
                    await Store.put('kv', K('e8'), arr);
                }
            } catch (e) { }
        }
        async function loadAux() {
            if (!Store) return;
            try {
                const a = await Store.get('kv', K('arc'));
                if (a) { ARCHIVE = a.archive || []; ARCH_THRESHOLD = a.threshold || 0.15; }
                const e8 = await Store.get('kv', K('e8'));
                if (e8 && e8.length) {
                    let drop = 0; const keep = [];
                    for (const e of e8) { if (cvOK(e.g)) keep.push([e.c, { v: e.v, fit: e.fit, gen: e.gen, g: e.g }]); else drop++; }
                    E8_MAP = new Map(keep);
                    log('★ E8 行为空间已恢复：' + E8_MAP.size + ' / ' + E8_CELLS + ' 格' + (drop ? '（丢掉 ' + drop + ' 个不合规旧个体）' : ''));
                }
            } catch (e) { }
        }
        function log(msg) { post({ type: 'log', isle: ISLE, msg: TAG + msg }); }

        /* ---------- 主循环 ---------- */
        let LOG_LINES = [];
        async function run() {
            post({ type: 'hello', isle: ISLE, nin: NIN(), nout: NOUT() });
            await E.init();
            DB = E.ships || {};
            POOL = Object.values(DB).filter(t => t && t.hp > 0 && t.position !== 'aircraft' && (t.commandValue || 0) > 0);
            POOL_AIR = Object.values(DB).filter(t => t && t.position === 'aircraft' && t.hp > 0);
            /* 舰船库约束 */
            if (cfg.lib) {
                LIB = cfg.lib;
                POOL = POOL.filter(t => LIB.ships[t.id]);
                const airOwned = POOL_AIR.filter(t => LIB.ships[t.id]);
                if (airOwned.length >= 5) POOL_AIR = airOwned;
                else log('★ 舰船库里几乎没有载机条目 → 载机暂不按库过滤（其余都按库）');
                TP_LIB = {};
                Object.keys(LIB.ships).forEach(id => { const c = E.cdnOf(id); const tp = LIB.ships[id].tp; if (c && tp > 0) TP_LIB[c] = tp; });
                log('★ 舰船库模式：可用舰船 ' + POOL.length + ' 型、载机 ' + POOL_AIR.length + ' 型；加点只能重分配且 ≤ 蓝点');
            }
            if (!POOL.length) { post({ type: 'error', isle: ISLE, msg: '舰船池为空（舰船库模式选得太少？）' }); return; }
            if (E.setActionThrottle) E.setActionThrottle(cfg.throttle);
            log('决策节流 = ' + cfg.throttle + ' 秒；每代 ' + cfg.pop + ' 个体 × 抽 ' + OPP_EVAL + ' 对手；上限 ' + cfg.maxSec + 's / 僵局 ' + cfg.stallSec + 's');

            /* 战报/给定配队：cfg.given 传【配队页格式】原始对象（{main:[{id,pos,qty,mods,air}],reinforcement,flagship}），
               这里统一转成基因组格式（main:[{id,count,position,mods,air}] + reinf + fl） */
            if (!cfg.given) { post({ type: 'error', isle: ISLE, msg: '缺少给定配队（given）' }); return; }
            const wr = {
                A: { escort: sideFromFleet(cfg.given.A.escort), escorted: sideFromFleet(cfg.given.A.escorted), ap: Object.assign({}, cfg.given.A.ap || {}) },
                B: { escort: sideFromFleet(cfg.given.B.escort), escorted: sideFromFleet(cfg.given.B.escorted), ap: Object.assign({}, cfg.given.B.ap || {}) }
            };
            for (const side of ['A', 'B']) {
                const l1 = LEGAL.legalize(wr[side].escort), l2 = LEGAL.legalize(wr[side].escorted);
                const notes = l1.notes.concat(l2.notes);
                if (notes.length) log('★ ' + side + ' 方配队超服役上限 → 已按战舰配队页口径修正（' + notes.slice(0, 4).join('；') + (notes.length > 4 ? ' 等' : '') + '）');
                wr[side].escort = LEGAL.topUp(l1.fleet, MIN_CV, CV_CAP);
                wr[side].escorted = LEGAL.topUp(l2.fleet, MIN_CV, CV_CAP);
            }
            const evA = !PURE && cfg.evolve.A !== false, evB = !PURE && cfg.evolve.B !== false;
            log('模式：A ' + (evA ? '进化' : '固定(给定)') + ' ｜ B ' + (evB ? '进化' : '固定(给定)') + (PURE ? ' ｜ 纯规则（方案一）' : ''));

            let popA = [randGenome(wr.A, true)]; while (popA.length < cfg.pop) popA.push(mutate(popA[0]));
            let popB = [randGenome(wr.B, true)]; while (popB.length < cfg.pop) popB.push(mutate(popB[0]));
            /* ★ 固定的一方：【没有网络】（决策交回引擎默认规则，即"正常打"）。
               否则"给定对手"会被一个随机初始网络乱指挥（该不乱开火时它乱开火），对比就失去意义。 */
            if (!evA) { popA = [popA[0]]; popA[0].net = null; }
            if (!evB) { popB = [popB[0]]; popB[0].net = null; }
            let bestA = popA[0], bestB = popB[0];
            let mA = evaluate(bestA, popB.slice(0, cfg.oppSample), 1000, FIT.A), mB = evaluate(bestB, popA.slice(0, cfg.oppSample), 2000, FIT.B);
            let START_GEN = 1, frzA = 0, frzB = 0, bornA = 1, bornB = 1;

            if (cfg.resume && Store) {
                try {
                    const s = await Store.get('kv', K('snap'));
                    if (s && s.A && s.B && s.A.escort && s.B.escort) {
                        const cvOfG = g => Math.min(fleetCV(g.escort.main, DB), fleetCV(g.escorted.main, DB));
                        const repair = (G, W, who) => {
                            const l1 = LEGAL.legalize(G.escort), l2 = LEGAL.legalize(G.escorted);
                            if (l1.notes.length || l2.notes.length) {
                                G.escort = l1.fleet; G.escorted = l2.fleet;
                                log('★ 快照里的 ' + who + ' 方配队服役超限 → 已修正');
                            }
                            if (cvOfG(G) >= MIN_CV && l1.ok && l2.ok) return G;
                            log('★ 快照里的 ' + who + ' 方配队已退化/不合法 → 只把配队换回给定，网络与参数保留');
                            G.escort = W.escort; G.escorted = W.escorted; G.ap = W.ap;
                            return G;
                        };
                        s.A = repair(s.A, wr.A, 'A'); s.B = repair(s.B, wr.B, 'B');
                        if (!evA) { s.A.net = null; s.A.escort = wr.A.escort; s.A.escorted = wr.A.escorted; s.A.ap = wr.A.ap; }
                        if (!evB) { s.B.net = null; s.B.escort = wr.B.escort; s.B.escorted = wr.B.escorted; s.B.ap = wr.B.ap; }
                        bestA = s.A; bestB = s.B;
                        if (s.fit && s.fit.A && s.fit.B) { Object.assign(FIT.A, s.fit.A); Object.assign(FIT.B, s.fit.B); }
                        if (s.born) { bornA = s.born.A || 1; bornB = s.born.B || 1; }
                        {
                            const lastGen = s.gen || 0;
                            bornA = Math.max(1, Math.min(bornA, lastGen)); bornB = Math.max(1, Math.min(bornB, lastGen));
                        }
                        START_GEN = (s.gen || 0) + 1;
                        frzA = Math.max(0, (START_GEN - 1) - bornA); frzB = Math.max(0, (START_GEN - 1) - bornB);
                        for (let i = 0; i < cfg.pop; i++) { popA[i] = (i === 0 || !evA) ? bestA : mutate(bestA); popB[i] = (i === 0 || !evB) ? bestB : mutate(bestB); }
                        if (!evA) popA = [bestA]; if (!evB) popB = [bestB];
                        mA = evaluate(bestA, popB.slice(0, cfg.oppSample), 1000, FIT.A);
                        mB = evaluate(bestB, popA.slice(0, cfg.oppSample), 2000, FIT.B);
                        log('★ 断点续跑：从快照第 ' + (s.gen || 0) + ' 代恢复，接着跑第 ' + START_GEN + ' 代');
                    } else log('（要续跑但本岛没有快照，从第 1 代开始）');
                } catch (e) { log('★ 快照读取失败，从第 1 代重新开始：' + e.message); }
            }
            if (cfg.resume) await loadAux();
            if (cfg.resume && Store) {
                /* ★ 恢复逐代日志（页面做收敛判定要用；没有它就相当于从第 N 代零历史开始） */
                try {
                    const lg = await Store.get('kv', K('log'));
                    if (lg && lg.length) { LOG_LINES = lg; post({ type: 'logback', isle: ISLE, recs: lg.slice(-600) }); }
                } catch (e) { }
            }

            let top3A = popA.slice(0, 3), top3B = popB.slice(0, 3);
            let lastNovA = 0, lastNA = 0, lastMA = 0;
            const t0 = Date.now();
            let bestEver = -1e9, G = START_GEN - 1;
            /* ★ "本次再跑多少代" 语义（页面用）：END = 起点 + N − 1。
               兼容旧语义（cfg.gens = 绝对代数上限）：没给 gensCount 时按老办法。
               —— 修一个真实坑：续跑时岛可能已经在第 1100 代，而绝对上限是 999 ⇒ 循环当场结束
               （表现像"卡住不动"，其实是 worker 早已 done 退出）。 */
            const END = END_GEN = (cfg.gensCount != null) ? (START_GEN - 1 + cfg.gensCount) : cfg.gens;
            log('本次目标：跑到第 ' + END + ' 代（从第 ' + START_GEN + ' 代起，本次再跑 ' + (END - START_GEN + 1) + ' 代）');

            for (let g = START_GEN; ; g++) {
                /* ---- 暂停/停止闸门：只在"每代之间"检查（代内不中断，保证快照一致） ---- */
                if (_stop) { await saveSnapshot(G, bestA, bestB, mA, mB, { A: frzA, B: frzB }, { A: bornA, B: bornB }); await saveAux(); post({ type: 'stopped', isle: ISLE, gen: G }); return; }
                if (_pause) {
                    await saveSnapshot(G, bestA, bestB, mA, mB, { A: frzA, B: frzB }, { A: bornA, B: bornB });
                    await saveAux();
                    post({ type: 'paused', isle: ISLE, gen: G });
                    await new Promise(r => { _resumeResolve = r; if (!_pause) r(); });
                    if (_stop) continue;
                    post({ type: 'resumed', isle: ISLE, gen: G });
                }
                if (!cfg.forever && g > END) break;
                G = g;

                if (mA.stats) { mA.score = scoreUnder(mA, FIT.A); mA.fscore = scoreUnder(mA, FIT0); }
                if (mB.stats) { mB.score = scoreUnder(mB, FIT.B); mB.fscore = scoreUnder(mB, FIT0); }
                const fitLogA = Object.assign({}, FIT.A), fitLogB = Object.assign({}, FIT.B);

                const oppB = evB ? makeOppPool(top3B, wr.B) : makeOppPoolFixed(bestB);
                const oppA = evA ? makeOppPool(top3A, wr.A) : makeOppPoolFixed(bestA);
                const scoredA = popA.map((ind, i) => { const m = evaluate(ind, sampleOpps(oppB, OPP_EVAL), 3000 + g * 13, FIT.A); m.idx = i; m.g = ind; return m; });
                const scoredB = popB.map((ind, i) => { const m = evaluate(ind, sampleOpps(oppA, OPP_EVAL), 4000 + g * 17, FIT.B); m.idx = i; m.g = ind; return m; });

                scoredA.forEach(s => archiveUpdate(s.beh || [], g));
                scoredB.forEach(s => archiveUpdate(s.beh || [], g));
                archiveAdjust(g);

                scoredA.forEach(s => { s.nov = novelty(s.beh || []); });
                scoredB.forEach(s => { s.nov = novelty(s.beh || []); });
                scoredA.forEach(s => mapElitesUpdate(s.beh, s.score, s.g, g));
                scoredB.forEach(s => mapElitesUpdate(s.beh, s.score, s.g, g));

                const selA = dualSelect(scoredA.map(s => ({ fit: s.score, nov: s.nov, idx: s.idx, g: s.g, m: s })), g, evA ? cfg.pop : 1);
                const selB = dualSelect(scoredB.map(s => ({ fit: s.score, nov: s.nov, idx: s.idx, g: s.g, m: s })), g, evB ? cfg.pop : 1);
                const topA = scoredA.reduce((a, b) => (!a || b.score > a.score) ? b : a, null);
                const topB = scoredB.reduce((a, b) => (!a || b.score > a.score) ? b : a, null);
                const barA = mA.score * ELITE_BAR, barB = mB.score * ELITE_BAR;
                if (evA) {
                    if (topA && topA.score >= barA) { if (topA.g !== bestA) { bestA = topA.g; bornA = g; } mA = topA; }
                } else { mA = topA || mA; }
                if (evB) {
                    if (topB && topB.score >= barB) { if (topB.g !== bestB) { bestB = topB.g; bornB = g; } mB = topB; }
                } else { mB = topB || mB; }
                frzA = g - bornA; frzB = g - bornB;
                if (evA && !cvOK(bestA)) { log('★ 强制修复 A 方配队（不满足指挥值 ≥' + MIN_CV + '）'); bestA.escort = wr.A.escort; bestA.escorted = wr.A.escorted; bestA.ap = wr.A.ap; mA = evaluate(bestA, popB.slice(0, cfg.oppSample), 1000, FIT.A); }
                if (evB && !cvOK(bestB)) { log('★ 强制修复 B 方配队（不满足指挥值 ≥' + MIN_CV + '）'); bestB.escort = wr.B.escort; bestB.escorted = wr.B.escorted; bestB.ap = wr.B.ap; mB = evaluate(bestB, popA.slice(0, cfg.oppSample), 2000, FIT.B); }
                lastNovA = topA ? (topA.nov || 0) : 0;
                lastNA = selA.N; lastMA = selA.M;

                FIT.A = mutateFit(FIT.A); FIT.B = mutateFit(FIT.B);

                let nA = null, nB = null;
                if (evA) {
                    nA = breed(selA.base, cfg.pop, bestA);
                    top3A = selA.base.slice(0, 3).map(e => e.g);
                    if (!top3A.length) top3A = popA.slice(0, 3);
                }
                if (evB) {
                    nB = breed(selB.base, cfg.pop, bestB);
                    top3B = selB.base.slice(0, 3).map(e => e.g);
                    if (!top3B.length) top3B = popB.slice(0, 3);
                }
                /* 岛间迁移（经 IndexedDB 交换冠军；每 10 代导出、错开 5 代引入） */
                if (Store) {
                    if (g % 10 === 0 && evA) { try { await Store.put('kv', K('champ'), { gen: g, A: bestA, B: evB ? bestB : null }); } catch (e) { } }
                    if (g % 10 === 5 && evA) {
                        try {
                            const es = await Store.entries('kv', 'champ:');
                            const others = es.filter(x => x[0] !== K('champ'));
                            if (others.length) {
                                const w = others[Math.floor(rnd() * others.length)][1];
                                if (w && w.A && w.A.net && cvOK(w.A)) { nA[cfg.pop - 1] = w.A; nA[cfg.pop - 1]._immigrant = true; }
                            }
                        } catch (e) { }
                    }
                }
                if (evA && nA) for (let i = 0; i < cfg.pop; i++) popA[i] = nA[i];
                if (evB && nB) for (let i = 0; i < cfg.pop; i++) popB[i] = nB[i];

                const szA = netSize(bestA.net), szB = netSize(bestB.net);
                const cvTA = fleetCV(bestA.escort.main, DB) + fleetCV(bestA.escorted.main, DB);
                const lossA = Math.max(0, 1 - (mA.myRemain || 0)), killA = Math.max(0, 1 - (mA.foeRemain || 0));
                const xchgA = killA > 1e-6 ? +(lossA / killA).toFixed(3) : (lossA > 1e-6 ? 99 : 1);
                const rec = {
                    gen: g,
                    fitA: { kw: +fitLogA.kw.toFixed(0), kt: +fitLogA.kt.toFixed(0), km: +fitLogA.km.toFixed(0), dw: +fitLogA.dw.toFixed(2), dt: +fitLogA.dt.toFixed(3) },
                    fitB: { kw: +fitLogB.kw.toFixed(0), kt: +fitLogB.kt.toFixed(0), km: +fitLogB.km.toFixed(0), dw: +fitLogB.dw.toFixed(2), dt: +fitLogB.dt.toFixed(3) },
                    A: { score: +mA.score.toFixed(1), fscore: +(mA.fscore || mA.score).toFixed(1), wins: +(mA.wins * 100).toFixed(0), winDur: +mA.winDur.toFixed(0), ops: Math.round(mA.ops), starved: +mA.starved.toFixed(2), nodes: szA.nodes, conns: szA.conns, cv: [fleetCV(bestA.escort.main, DB), fleetCV(bestA.escorted.main, DB)], flagships: [bestA.escort.fl, bestA.escorted.fl],
                        nov: +(lastNovA || 0).toFixed(4), N: lastNA, M: lastMA, arch: ARCHIVE.length, thr: +ARCH_THRESHOLD.toFixed(4),
                        e8: E8_MAP.size, e8cell: (mA.beh ? e8Cell(mA.beh) : -1),
                        bar: +barA.toFixed(0), frozen: frzA, evolve: evA,
                        effOut: cvTA ? +(mA.dmgOut / cvTA).toFixed(1) : 0, effRep: cvTA ? +(mA.repairOut / cvTA).toFixed(1) : 0, xchg: xchgA },
                    B: { score: +mB.score.toFixed(1), fscore: +(mB.fscore || mB.score).toFixed(1), wins: +(mB.wins * 100).toFixed(0), winDur: +mB.winDur.toFixed(0), ops: Math.round(mB.ops), starved: +mB.starved.toFixed(2), nodes: szB.nodes, conns: szB.conns, cv: [fleetCV(bestB.escort.main, DB), fleetCV(bestB.escorted.main, DB)], flagships: [bestB.escort.fl, bestB.escorted.fl],
                        bar: +barB.toFixed(0), frozen: frzB, evolve: evB },
                    t: Math.round((Date.now() - t0) / 1000)
                };
                LOG_LINES.push(rec);
                if (LOG_LINES.length > 4000) LOG_LINES = LOG_LINES.slice(-3000);
                bestEver = Math.max(bestEver, mA.score);

                /* ---- 每代上报（页面看板 + 3D） ---- */
                post({
                    type: 'gen', isle: ISLE, rec: rec,
                    best: {
                        A: { fleet: fleetJSON(bestA), sz: szA, beh: mA.beh, nov: lastNovA },
                        B: { fleet: fleetJSON(bestB), sz: szB, beh: mB.beh }
                    },
                    net: bestA.net ? { side: 'A', nodes: bestA.net.nodes, conns: bestA.net.conns.filter(c => c.enabled) } : (bestB.net ? { side: 'B', nodes: bestB.net.nodes, conns: bestB.net.conns.filter(c => c.enabled) } : null),
                    acts: valToArr(mA.lastVal || mB.lastVal),
                    evA: evA, evB: evB
                });

                if (g % cfg.saveEvery === 0) {
                    await saveSnapshot(g, bestA, bestB, mA, mB, { A: frzA, B: frzB }, { A: bornA, B: bornB });
                    if (Store) { try { await Store.put('kv', K('log'), LOG_LINES.slice(-600)); } catch (e) { } }
                }
                if (g % 20 === 0) await saveAux();
            }
            await saveSnapshot(G, bestA, bestB, mA, mB, { A: frzA, B: frzB }, { A: bornA, B: bornB });
            post({ type: 'done', isle: ISLE, gen: G, bestEver: bestEver });
        }

        /* ---------- 给页面用的结构化配队 ---------- */
        function fleetJSON(g) {
            const nm = id => (DB[id] && DB[id].name) || id;
            const one = (f, label) => ({
                label: label,
                cv: fleetCV(f.main, DB), flagship: f.fl, flagshipName: f.fl ? nm(f.fl) : null,
                main: f.main.map(e => ({ id: e.id, name: nm(e.id), count: e.count, cv: cvOf(e.id, DB), position: e.position,
                    mods: Object.assign({}, e.mods || {}), air: (e.air || []).map(a => ({ id: a.id, name: nm(a.id), qty: a.qty, slot: a.slot, kind: a.kind })) })),
                reinf: (f.reinf || []).map(e => ({ id: e.id, name: nm(e.id), count: e.count })),
                reinfShips: reinfShips(f.reinf)
            });
            return { escort: one(g.escort, '护航队'), escorted: one(g.escorted, '被护航队'), ap: g.ap || {}, net: netSize(g.net), mutRate: g.mutRate, opBudget: g.opBudget };
        }
        function valToArr(v) {
            if (!v || !v.forEach) return null;
            const out = [];
            v.forEach((val, id) => out.push({ id, v: (typeof val === 'number' && isFinite(val)) ? +val.toFixed(4) : 0 }));
            return out;
        }

        return { run: run, control: control, get isle() { return ISLE; } };
    }

    root.NeuronCore = { start: start };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.NeuronCore;
})(typeof self !== 'undefined' ? self : this);
