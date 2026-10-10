/* ============================================================
   神经元实验室 · IndexedDB 存储层（页面 / Worker 共用）
   ------------------------------------------------------------
   为什么用 IndexedDB 而不是 localStorage：
     · 快照（完整基因组 + 战果统计）每份 ~200KB，localStorage 只有 ~5MB 且是同步接口；
     · 训练在 Worker 里跑，Worker 和页面都能访问同一个 IndexedDB（同源共享）；
     · 每 5 代存一次快照 → 刷新/断网/关浏览器后能【从最近一次快照无损续跑】。
   库结构：lagrange_neuron
     kv  : 通用键值（'snap:<isle>' 快照 / 'arc:<isle>' 行为档案 / 'e8:<isle>' E8图 /
           'champ:<isle>' 岛冠军 / 'log:<isle>' 逐代日志 / 'run:<isle>' 运行状态）
     reports : 战报库（神经网络的实战结果，供发给 AI 分析）
   ============================================================ */
(function (root) {
    'use strict';
    const DB_NAME = 'lagrange_neuron';
    const DB_VER = 1;
    let _dbp = null;

    function open() {
        if (_dbp) return _dbp;
        _dbp = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VER); }
            catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
        });
        return _dbp;
    }

    function tx(store, mode, fn) {
        return open().then(db => new Promise((resolve, reject) => {
            const t = db.transaction(store, mode);
            const s = t.objectStore(store);
            let out;
            try { out = fn(s); } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
            t.onerror = () => reject(t.error || new Error('idb tx error'));
            t.onabort = () => reject(t.error || new Error('idb tx abort'));
        }));
    }

    const Store = {
        DB_NAME,
        open,
        /** 写：put('kv', key, value) / put('reports', key, value) */
        put(store, key, val) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, 'readwrite');
                t.objectStore(store).put(val, key);
                t.oncomplete = () => resolve();
                t.onerror = () => reject(t.error || new Error('idb put error'));
                t.onabort = () => reject(t.error || new Error('idb put abort'));
            }));
        },
        /** 读一个键（不存在 → undefined） */
        get(store, key) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, 'readonly');
                const r = t.objectStore(store).get(key);
                t.oncomplete = () => resolve(r.result);
                t.onerror = () => reject(t.error || new Error('idb get error'));
                t.onabort = () => reject(t.error || new Error('idb get abort'));
            }));
        },
        /** 删一个键 */
        del(store, key) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, 'readwrite');
                t.objectStore(store).delete(key);
                t.oncomplete = () => resolve();
                t.onerror = () => reject(t.error || new Error('idb del error'));
            }));
        },
        /** 列全部键（可选前缀） */
        keys(store, prefix) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, 'readonly');
                const r = t.objectStore(store).getAllKeys();
                t.oncomplete = () => resolve(r.result.filter(k => !prefix || String(k).indexOf(prefix) === 0));
                t.onerror = () => reject(t.error || new Error('idb keys error'));
            }));
        },
        /** 按前缀取 [key, value] 列表 */
        entries(store, prefix) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, 'readonly');
                const o = t.objectStore(store);
                const ks = o.getAllKeys(), vs = o.getAll();
                t.oncomplete = () => {
                    const out = [];
                    for (let i = 0; i < ks.result.length; i++) {
                        if (!prefix || String(ks.result[i]).indexOf(prefix) === 0) out.push([ks.result[i], vs.result[i]]);
                    }
                    resolve(out);
                };
                t.onerror = () => reject(t.error || new Error('idb entries error'));
            }));
        },
        /** 清掉某前缀的所有键（键多时逐个删） */
        async clearPrefix(store, prefix) {
            const ks = await Store.keys(store, prefix);
            for (const k of ks) await Store.del(store, k);
            return ks.length;
        },
        /* ---------- 战报库（神经网络实战结果，供发给 AI 分析） ---------- */
        async addReport(rep) {
            const key = 'r' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const rec = Object.assign({ key, savedAt: new Date().toISOString() }, rep);
            await Store.put('reports', key, rec);
            /* 只留最近 30 条（防库无限膨胀） */
            const ks = await Store.keys('reports');
            if (ks.length > 30) { ks.sort(); for (const k of ks.slice(0, ks.length - 30)) await Store.del('reports', k); }
            return rec;
        },
        async listReports(limit) {
            const es = await Store.entries('reports');
            es.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
            return es.slice(0, limit || 20).map(x => x[1]);
        }
    };
    root.NeuronStore = Store;
    if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof self !== 'undefined' ? self : this);
