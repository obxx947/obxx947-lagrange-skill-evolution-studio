# -*- coding: utf-8 -*-
"""
拉格朗日智能体 · 神经网络（Python 版）—— 第 2 步：进化训练
================================================================
把原来"在浏览器里点训练"的进化循环**重写到 Python**（电脑上跑得快、可脚本化、
可挂任意评估函数），产出与前端兼容的网络 JSON（浏览器照常加载，无需改前端）。

· 网络表示与推理语义 = `js/neuron/neuron_core.js` 完全一致
  （nodes/conns 格式；见 nn_py/neuron.py 与 parity_test.py：逐节点对拍 2.78e-17）
· 进化机制（NEAT 式，自洽实现）：
    权值扰动 / 新增连接 / 新增节点（拆连接）/ 激活函数变异 / 禁用连接 /
    交叉（同键对齐）/ 精英保留 + 锦标赛选择
· 适应度可插拔：内置两个 demo
    1) xor   —— 冒烟（学会异或，快速验证进化闭环）
    2) battle —— **用 C 战斗引擎当裁判**（cpp_simcore 的 lagrange_battle_simple）：
       网络输出 → 我方配舰参数（结构/护甲/单发/闪避倍率）→ 跑一场 → 伤害差当适应度。
       （三条重写线在此闭环：Python 进化的网络，评估交给 C++ 引擎。）

用法：
    python evolve.py --demo xor    --gens 60  --pop 40
    python evolve.py --demo battle --gens 40  --pop 30
    python evolve.py --demo xor --export best.json     # 把冠军网络存成前端可加载 JSON
    python neuron.py forward --net best.json --inputs "0,1,0.5"   # 回读验证
"""
import argparse
import copy
import json
import math
import os
import random
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 让 evolve.py 能 import 同目录的 neuron.py（推理引擎）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from neuron import forward as nn_forward, ACT   # noqa: E402

ACT_NAMES = list(ACT.keys())


# ==================== 网络构造 ====================

def new_net(n_in, n_out, seed=None, hidden=2):
    """新建网络：n_in 输入 + hidden 个隐藏（tanh） + n_out 输出。
    连接：全连输入→隐藏→输出 + 输入→输出直连，随机小权重。"""
    rng = random.Random(seed)
    nodes = []
    conns = []
    for i in range(n_in):
        nodes.append({"id": "i%d" % i, "type": "in", "act": "identity"})
    for h in range(hidden):
        nodes.append({"id": "h%d" % h, "type": "hidden", "act": "tanh"})
    for o in range(n_out):
        nodes.append({"id": "o%d" % o, "type": "out", "act": "tanh"})
    def add(a, b, w):
        conns.append({"in": a, "out": b, "w": w, "enabled": True})
    for i in range(n_in):
        for h in range(hidden):
            add("i%d" % i, "h%d" % h, rng.uniform(-1.0, 1.0))
        for o in range(n_out):
            add("i%d" % i, "o%d" % o, rng.uniform(-1.0, 1.0))
    for h in range(hidden):
        for o in range(n_out):
            add("h%d" % h, "o%d" % o, rng.uniform(-1.0, 1.0))
    return {"nodes": nodes, "conns": conns}


# ==================== 变异 / 交叉 ====================

def mutate(net, rng, w_rate=0.25, w_pow=0.5, add_conn=0.15, add_node=0.06,
           act_rate=0.05, toggle_rate=0.05):
    """就地变异（返回新对象，不改原网络）。"""
    net = copy.deepcopy(net)
    nodes = net["nodes"]
    conns = net["conns"]
    ids = [n["id"] for n in nodes]
    non_in = [n for n in nodes if n["type"] != "in"]

    # 1) 权值扰动
    for c in conns:
        if rng.random() < w_rate:
            c["w"] += rng.gauss(0.0, w_pow)
            c["w"] = max(-8.0, min(8.0, c["w"]))

    # 2) 新增连接（随机 in/hidden → hidden/out）
    if rng.random() < add_conn and len(conns) < 400:
        src = [n for n in nodes if n["type"] in ("in", "hidden")]
        dst = [n for n in nodes if n["type"] in ("hidden", "out")]
        if src and dst:
            a = rng.choice(src)["id"]
            b = rng.choice(dst)["id"]
            if a != b and not any(c["in"] == a and c["out"] == b for c in conns):
                conns.append({"in": a, "out": b, "w": rng.gauss(0, 1), "enabled": True})

    # 3) 新增节点：拆一条已有连接 a→b 为 a→new→b
    if rng.random() < add_node and len(nodes) < 120 and conns:
        c = rng.choice(conns)
        nid = "n%d" % (len(nodes) + 1)
        while nid in ids:
            nid += "x"
        nodes.append({"id": nid, "type": "hidden", "act": rng.choice(ACT_NAMES)})
        conns.append({"in": c["in"], "out": nid, "w": 1.0, "enabled": True})
        conns.append({"in": nid, "out": c["out"], "w": c["w"], "enabled": True})
        c["enabled"] = False   # 老连接禁用（NEAT 做法）

    # 4) 激活函数变异
    for n in non_in:
        if rng.random() < act_rate:
            n["act"] = rng.choice(ACT_NAMES)

    # 5) 开关连接
    for c in conns:
        if rng.random() < toggle_rate:
            c["enabled"] = not c["enabled"]
    return net


def crossover(pa, pb, rng):
    """同键（in->out）对齐交叉；键只在一边时按 50% 保留。"""
    key = lambda c: (c["in"], c["out"])
    ma = {key(c): c for c in pa["conns"]}
    mb = {key(c): c for c in pb["conns"]}
    child_conns = []
    for k, ca in ma.items():
        if k in mb:
            cb = mb[k]
            c = copy.deepcopy(ca if rng.random() < 0.5 else cb)
            c["w"] = (ca["w"] + cb["w"]) / 2.0 if rng.random() < 0.3 else c["w"]
            c["enabled"] = ca["enabled"] or cb["enabled"]
            child_conns.append(c)
        elif rng.random() < 0.5:
            child_conns.append(copy.deepcopy(ca))
    for k, cb in mb.items():
        if k not in ma and rng.random() < 0.5:
            child_conns.append(copy.deepcopy(cb))
    # 节点取并集（按 id 去重；同名节点随机取一边的 act）
    seen = {}
    for n in pa["nodes"] + pb["nodes"]:
        if n["id"] not in seen or rng.random() < 0.5:
            seen[n["id"]] = copy.deepcopy(n)
    return {"nodes": list(seen.values()), "conns": child_conns}


# ==================== 适应度（两个 demo） ====================

def fitness_xor(net):
    """冒烟任务：学会 XOR（输入 0/1，输出 >0.5 为 1）。返回 0~1 准确率。"""
    cases = [([0.0, 0.0], 0.0), ([0.0, 1.0], 1.0), ([1.0, 0.0], 1.0), ([1.0, 1.0], 0.0)]
    ok = 0
    err = 0.0
    for xs, want in cases:
        out = nn_forward(net, xs, nout=1)["out"][0]
        hit = 1.0 if (out > 0.0) == (want > 0.5) else 0.0
        ok += hit
        err += (out - (1.0 if want > 0.5 else -1.0)) ** 2
    return ok / len(cases) + (1.0 - err / (4 * 4.0)) * 0.1


def _load_c_engine():
    """复用 cpp_simcore/bridge_py.py 的 ctypes 封装（C 战斗引擎）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.join(here, "..", "cpp_simcore")
    sys.path.insert(0, os.path.abspath(cand))
    import bridge_py   # noqa
    return bridge_py


_C_BRIDGE = None


def fitness_battle(net, verbose=False):
    """把网络输出当"我方配舰参数"，用 C 战斗引擎跑一场，伤害差当适应度。

    输出映射（o0..o3，tanh 输出 ∈ [-1,1]）：
      o0 → 结构值倍率  0.5 ~ 2.0
      o1 → 护甲倍率    0.5 ~ 2.0
      o2 → 单发倍率    0.5 ~ 2.0
      o3 → 闪避        0 ~ 30（百分点）
    输入固定特征 [1.0, 0.5, 0.3]（偏置 + 敌方护甲/100 + 敌方HP/10000）。
    """
    global _C_BRIDGE
    if _C_BRIDGE is None:
        _C_BRIDGE = _load_c_engine()

    o = nn_forward(net, [1.0, 0.5, 0.3], nout=9)["out"]
    hp_mul = 1.0 + max(-0.5, min(1.0, o[0]))
    ar_mul = 1.0 + max(-0.5, min(1.0, o[1]))
    dm_mul = 1.0 + max(-0.5, min(1.0, o[2]))
    ev = max(0.0, min(30.0, (o[3] + 1.0) * 15.0))

    # 敌方固定（"靶子"）：2 舰
    enemy = [(10000, 50, 30, 200), (7000, 30, 10, 150)]
    # 我方：2 舰，成本约束——参数越高越"贵"，从适应度里扣，防止无脑拉满
    ally = [(12000 * hp_mul, 60 * ar_mul, 20, 300 * dm_mul),
            (9000 * hp_mul, 40 * ar_mul, 40, 250 * dm_mul)]
    r = _C_BRIDGE.run_battle(ally, enemy, max_time=600.0)

    cost = (hp_mul - 1.0) * 4000 + (ar_mul - 1.0) * 2000 + (dm_mul - 1.0) * 5000 + ev * 100
    fit = (r["ally_dmg"] - r["enemy_dmg"]) + (1.0 if r["winner"] == "我方" else 0.0) * 3000 - cost
    if verbose:
        print("    参数: hp×%.2f 甲×%.2f 单发×%.2f 闪避%.1f | %s %.1fs 伤差 %.0f 扣费 %.0f → %.0f"
              % (hp_mul, ar_mul, dm_mul, ev, r["winner"], r["duration"],
                 r["ally_dmg"] - r["enemy_dmg"], cost, fit))
    return fit


# ==================== 进化主循环 ====================

def evolve(demo, gens, pop, n_in, n_out, seed=42, export=None, elite=4, verbose=True):
    rng = random.Random(seed)
    fitness = fitness_xor if demo == "xor" else fitness_battle

    # 初始种群
    population = [new_net(n_in, n_out, seed=rng.randrange(10 ** 9), hidden=2)
                  for _ in range(pop)]

    best = None
    best_fit = -1e18
    for gen in range(1, gens + 1):
        scored = [(fitness(ind), ind) for ind in population]
        scored.sort(key=lambda t: -t[0])
        if scored[0][0] > best_fit:
            best_fit = scored[0][0]
            best = scored[0][1]

        if verbose and (gen == 1 or gen % 10 == 0 or gen == gens):
            print("  第 %3d 代 | 最好 %.4f | 平均 %.4f | 冠军规模 %d节点/%d连接"
                  % (gen, scored[0][0],
                     sum(s for s, _ in scored) / len(scored),
                     len(scored[0][1]["nodes"]), len(scored[0][1]["conns"])))

        # 选择：精英 + 锦标赛
        survivors = [copy.deepcopy(ind) for _, ind in scored[:elite]]
        def tournament():
            a = rng.choice(scored)
            b = rng.choice(scored)
            return a[1] if a[0] >= b[0] else b[1]
        while len(survivors) < pop:
            if rng.random() < 0.75:
                child = crossover(tournament(), tournament(), rng)
            else:
                child = copy.deepcopy(tournament())
            child = mutate(child, rng)
            survivors.append(child)
        population = survivors

    if verbose:
        print("  最优适应度: %.4f" % best_fit)
        if demo == "battle":
            print("  —— 冠军打一场（明细）——")
            fitness_battle(best, verbose=True)

    if export:
        with open(export, "w", encoding="utf-8") as f:
            json.dump(best, f, ensure_ascii=False)
        print("  已导出冠军网络 →", export, "（前端 neuron 可直接加载；"
              "回读验证: python neuron.py forward --net %s）" % export)
    return best, best_fit


def main():
    ap = argparse.ArgumentParser(description="拉格朗日神经网络 · Python 进化训练（重写版）")
    ap.add_argument("--demo", choices=["xor", "battle"], default="xor")
    ap.add_argument("--gens", type=int, default=60)
    ap.add_argument("--pop", type=int, default=40)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--export", default="", help="把冠军网络存成 JSON（前端可加载）")
    a = ap.parse_args()

    n_in, n_out = (2, 1) if a.demo == "xor" else (3, 9)
    print("=== Python 进化训练 | demo=%s | %d 代 × %d 个体 ===" % (a.demo, a.gens, a.pop))
    evolve(a.demo, a.gens, a.pop, n_in, n_out, seed=a.seed, export=a.export)


if __name__ == "__main__":
    main()
