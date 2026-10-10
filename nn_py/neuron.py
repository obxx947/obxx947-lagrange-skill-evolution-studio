# -*- coding: utf-8 -*-
"""
拉格朗日智能体 · 神经网络（Python 版）—— 第 1 步：推理引擎
================================================================
目标（用户定的方向）：**神经网络层用 Python 重写**（训练/进化在 Python 里跑，
最终产出与前端兼容的 JSON 网络，浏览器照常加载、无需改前端）。

本文件 = 与 `web/js/neuron/neuron_core.js` 的 `forward()` **完全同语义**的推理实现：
  · 节点：{id, type:'in'|'hidden'|'out', act:激活函数名}
  · 连接：{in, out, w, enabled}   （只算 enabled=true）
  · 输入：i0..i(N-1)（缺省按 0）；输出：o0..o(NOUT-1)
  · 传播：对所有非输入节点做【两趟】全量刷新（与 JS 一致，允许反馈/深层连接）
  · 激活函数 9 种：identity/tanh/sigmoid/relu/step/abs/sin/gauss/square

用法：
  python neuron.py forward --net champ.json [--inputs "0.1,0.2,..."] [--seed 42]
  python neuron.py info    --net champ.json
  python neuron.py selfcheck
"""
import argparse
import json
import math
import sys


def clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


# ★ 与 neuron_core.js 第 61 行 ACT 表逐项一致
ACT = {
    'identity': lambda x: x,
    'tanh': math.tanh,
    'sigmoid': lambda x: 1.0 / (1.0 + math.exp(-clamp(x, -30, 30))),
    'relu': lambda x: x if x > 0 else 0.0,
    'step': lambda x: 1.0 if x > 0 else 0.0,
    'abs': abs,
    'sin': math.sin,
    'gauss': lambda x: math.exp(-x * x),
    'square': lambda x: clamp(x * x, -1e6, 1e6),
}


def forward(net, inputs, nout=9):
    """与 JS forward(net, inputs) 同语义。返回 {'out': [...], 'vals': {节点id: 值}, 'ops': n}"""
    nodes = net.get('nodes') or []
    conns = net.get('conns') or []
    vals = {}
    ops = 0
    for n in nodes:
        if n.get('type') == 'in':
            try:
                idx = int(str(n['id'])[1:])
            except (ValueError, KeyError):
                idx = -1
            vals[n['id']] = inputs[idx] if (0 <= idx < len(inputs)) else 0.0
            ops += 1
        else:
            vals[n['id']] = 0.0
    for _pass in range(2):                      # ★ 两趟（JS 也是 2）
        for n in nodes:
            if n.get('type') == 'in':
                continue
            s = 0.0
            for c in conns:
                if not c.get('enabled', True) or c.get('out') != n['id']:
                    continue
                s += vals.get(c.get('in'), 0.0) * c.get('w', 0.0)
                ops += 1
            fn = ACT.get(n.get('act') or 'identity')
            if fn is None:
                raise KeyError('未知激活函数: %r（JS 端会抛同样性质的错）' % n.get('act'))
            vals[n['id']] = fn(s)
            ops += 1
    out = [vals.get('o' + str(j), 0.0) for j in range(nout)]
    return {'out': out, 'vals': vals, 'ops': ops}


def load_net(path, side='A'):
    """支持三种输入：① champ/snapshot 格式 {A:{net:...},B:{...}} ② {net:...} ③ 裸 {nodes,conns}"""
    with open(path, 'r', encoding='utf-8') as f:
        j = json.load(f)
    if isinstance(j, dict) and isinstance(j.get('net'), dict):
        return j['net'], j
    if isinstance(j, dict) and isinstance(j.get(side), dict) and isinstance(j[side].get('net'), dict):
        return j[side]['net'], j
    if isinstance(j, dict) and 'nodes' in j and 'conns' in j:
        return j, j
    raise ValueError('这个 JSON 里没找到网络（既不是 {A:{net}} 也不是 {net} / {nodes,conns}）')


def make_inputs(n, seed=42):
    """确定性随机输入（Python 的 random 与 JS 不同 → 奇偶测试用"同一份输入文件"两边跑）"""
    import random
    r = random.Random(seed)
    return [round(r.uniform(-1.0, 1.0), 6) for _ in range(n)]


def main():
    ap = argparse.ArgumentParser(description='拉格朗日神经网络 · Python 版（第 1 步：推理）')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p1 = sub.add_parser('forward', help='跑一次前向传播')
    p1.add_argument('--net', required=True)
    p1.add_argument('--inputs', default='', help='逗号分隔；留空则用 --seed 生成')
    p1.add_argument('--n', type=int, default=87, help='输入维度（默认 87，与引擎动作接口一致）')
    p1.add_argument('--nout', type=int, default=9)
    p1.add_argument('--seed', type=int, default=42)

    p2 = sub.add_parser('info', help='看网络规模')
    p2.add_argument('--net', required=True)

    sub.add_parser('selfcheck', help='内置自检（手搓小网 + 已知答案）')

    a = ap.parse_args()

    if a.cmd == 'forward':
        net, _ = load_net(a.net)
        xs = ([float(x) for x in a.inputs.split(',')] if a.inputs.strip()
              else make_inputs(a.n, a.seed))
        r = forward(net, xs, a.nout)
        print(json.dumps({'out': r['out'], 'ops': r['ops']}, ensure_ascii=False))
        return

    if a.cmd == 'info':
        net, meta = load_net(a.net)
        nodes = net.get('nodes') or []
        conns = net.get('conns') or []
        print(json.dumps({
            '节点': len(nodes), '连接': len(conns),
            '启用连接': sum(1 for c in conns if c.get('enabled', True)),
            '隐藏节点': sum(1 for n in nodes if n.get('type') == 'hidden'),
            '代': (meta.get('gen') if isinstance(meta, dict) else None),
        }, ensure_ascii=False))
        return

    if a.cmd == 'selfcheck':
        # 小网（覆盖 relu/tanh/gauss 三种激活 + 隐藏节点多跳）：
        #   o0 = relu( i0*2.0 + i0*(-0.5) )        —— 两条同向连接相加当"偏置"
        #   h0 = gauss(i1*1.0)；o1 = tanh(h0*1.0)  —— 多跳：i1→h0→o1
        net = {'nodes': [
            {'id': 'i0', 'type': 'in', 'act': 'identity'},
            {'id': 'i1', 'type': 'in', 'act': 'identity'},
            {'id': 'h0', 'type': 'hidden', 'act': 'gauss'},
            {'id': 'o0', 'type': 'out', 'act': 'relu'},
            {'id': 'o1', 'type': 'out', 'act': 'tanh'},
        ], 'conns': [
            {'in': 'i0', 'out': 'o0', 'w': 2.0, 'enabled': True},
            {'in': 'i0', 'out': 'o0', 'w': -0.5, 'enabled': True},
            {'in': 'i1', 'out': 'h0', 'w': 1.0, 'enabled': True},
            {'in': 'h0', 'out': 'o1', 'w': 1.0, 'enabled': True},
        ]}
        r = forward(net, [1.0, 0.5], nout=2)
        exp = [max(0.0, 1.0 * (2.0 - 0.5)), math.tanh(math.exp(-0.25))]
        ok = abs(r['out'][0] - exp[0]) < 1e-12 and abs(r['out'][1] - exp[1]) < 1e-12
        # 关闭连接不应被计入
        net2 = json.loads(json.dumps(net))
        net2['conns'][0]['enabled'] = False
        r2 = forward(net2, [1.0, 0.5], nout=2)
        ok = ok and abs(r2['out'][0] - max(0.0, -0.5)) < 1e-12
        print(('✅ selfcheck 通过' if ok else '❌ selfcheck 失败') + '  out=' + json.dumps(r['out']))
        sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
