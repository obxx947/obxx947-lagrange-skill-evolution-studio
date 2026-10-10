# -*- coding: utf-8 -*-
"""
nn_py/parity_test.py —— Python 推理 与 JS 推理 的逐节点奇偶校验
================================================================
做法（不信任"我手抄的 JS"，直接验**仓库里真实的**实现）：
  1. 从 web/js/neuron/neuron_core.js 里【按大括号配对】抽出真实的 `const ACT = {...}` 与 `function forward(net, inputs){...}`
  2. 生成同一批输入（Python 端确定性生成，写文件两边共用）
  3. Node 跑真实 JS forward → 输出全节点值；Python 跑 nn_py/neuron.py 的实现 → 输出全节点值
  4. 逐节点比对（容差 1e-9；tanh/exp 的末位差异允许 ~1e-16 级）

用法：python parity_test.py [--net web/data/neuron/champ_example.json] [--k 5]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # 拉格朗日智能体
sys.path.insert(0, HERE)
from neuron import forward, load_net, make_inputs  # noqa: E402


def extract_js(nc_path):
    """从 neuron_core.js 抽出真实的 ACT 表与 forward 函数（大括号配对，避免手抄走样）"""
    src = open(nc_path, 'r', encoding='utf-8').read()

    # —— ACT：从 'const ACT = {' 到第一个 '};'
    i0 = src.index('const ACT = {')
    i1 = src.index('};', i0) + 2
    act_line = src[i0:i1]

    # —— forward：从 'function forward(net, inputs)' 起做括号配对
    i2 = src.index('function forward(net, inputs)')
    j = src.index('{', i2)
    depth = 0
    k = j
    while k < len(src):
        ch = src[k]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                break
        k += 1
    fwd = src[i2:k + 1]
    assert 'ACT[' in fwd and 'return' in fwd, '抽出的 forward 看起来不对'
    return act_line, fwd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--net', default=os.path.join(ROOT, 'web', 'data', 'neuron', 'champ_example.json'))
    ap.add_argument('--k', type=int, default=5)
    ap.add_argument('--n', type=int, default=87)
    a = ap.parse_args()

    nc = os.path.join(ROOT, 'web', 'js', 'neuron', 'neuron_core.js')
    if not os.path.exists(a.net):
        print('✗ 找不到网络文件：' + a.net)
        sys.exit(1)
    if not os.path.exists(nc):
        print('✗ 找不到 neuron_core.js：' + nc)
        sys.exit(1)

    act_line, fwd = extract_js(nc)
    net, meta = load_net(a.net)
    n_nodes = len(net.get('nodes') or [])
    n_conns = len(net.get('conns') or [])
    print('网络：节点 %d / 连接 %d（第 %s 代）' % (n_nodes, n_conns, (meta or {}).get('gen', '?')))

    inputs_list = [make_inputs(a.n, seed=1000 + i) for i in range(a.k)]

    with tempfile.TemporaryDirectory() as td:
        net_p = os.path.join(td, 'net.json')
        in_p = os.path.join(td, 'inputs.json')
        js_p = os.path.join(td, 'run.js')
        json.dump(net, open(net_p, 'w', encoding='utf-8'), ensure_ascii=False)
        json.dump(inputs_list, open(in_p, 'w', encoding='utf-8'))
        js = ('const fs = require("fs");\n'
              'function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }\n'
              'const NOUT = () => 9;\n'
              + act_line + '\n'
              + fwd + '\n'
              'const net = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));\n'
              'const xs  = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));\n'
              'const res = xs.map(x => { const r = forward(net, x); const o = {}; r.val.forEach((v, k) => o[k] = v); return { out: r.out, vals: o }; });\n'
              'process.stdout.write(JSON.stringify(res));\n')
        open(js_p, 'w', encoding='utf-8').write(js)
        proc = subprocess.run(['node', js_p, net_p, in_p], capture_output=True, text=True, encoding='utf-8')
        if proc.returncode != 0:
            print('✗ Node 跑真实 JS forward 失败：\n' + (proc.stderr or '')[:600])
            sys.exit(1)
        js_out = json.loads(proc.stdout)

    worst = 0.0
    worst_at = ''
    for i, xs in enumerate(inputs_list):
        py = forward(net, xs, 9)
        for j in range(9):
            d = abs(py['out'][j] - js_out[i]['out'][j])
            if d > worst:
                worst, worst_at = d, '第%d组 输出 o%d（py=%.12g js=%.12g）' % (i + 1, j, py['out'][j], js_out[i]['out'][j])
        for k_, v in js_out[i]['vals'].items():
            d = abs(py['vals'].get(k_, 0.0) - v)
            if d > worst:
                worst, worst_at = d, '第%d组 节点 %s（py=%.12g js=%.12g）' % (i + 1, k_, py['vals'].get(k_, 0.0), v)

    ok = worst < 1e-9
    print('逐节点比对 %d 组×（9 输出 + 全节点）→ 最大偏差 %.3g  %s' % (len(inputs_list), worst, ('（' + worst_at + '）') if worst_at else ''))
    print('✅ parity 通过：Python 推理与 JS 完全一致' if ok else '❌ parity 失败：偏差超过 1e-9')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
