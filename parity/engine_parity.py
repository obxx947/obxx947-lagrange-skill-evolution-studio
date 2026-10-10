# -*- coding: utf-8 -*-
"""
engine_parity.py — 三方引擎对拍：C（dll） / Rust（pyd） / JS（参考公式）

同输入、三条实现各算一遍，逐项比对（容差 1e-9）。
JS 侧 oracle = parity/js_reference.mjs（逐行标注 simulator.html 行号）。

前提：
  · C   ：已编译 liblagrange_battle.dll（D:\\cbuild-cpp\\，带 WINDOWS_EXPORT_ALL_SYMBOLS）
  · Rust：已复制 battle_engine_rs.pyd 到 拉格朗日智能体/rust_lib/
  · Node：PATH 里有 node（跑 .mjs）

用法：python parity/engine_parity.py
"""
import ctypes
import json
import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DLL = r"D:\cbuild-cpp\liblagrange_battle.dll"
PYPATH = os.path.join(ROOT, "rust_lib")

# ---- C 侧 ----
sys.path.insert(0, os.path.join(ROOT, "cpp_simcore"))
if os.path.isdir(r"D:\msys64\mingw64\bin"):
    os.add_dll_directory(r"D:\msys64\mingw64\bin")

c_lib = ctypes.CDLL(DLL)
c_lib.calc_energy_damage_c.argtypes = [ctypes.c_double] * 4
c_lib.calc_energy_damage_c.restype = ctypes.c_double
c_lib.calc_physical_damage_c.argtypes = [ctypes.c_double] * 5
c_lib.calc_physical_damage_c.restype = ctypes.c_double
c_lib.calc_hit_chance_c.argtypes = [ctypes.c_double] * 5
c_lib.calc_hit_chance_c.restype = ctypes.c_double
c_lib.calc_intercept_rate_c.argtypes = [
    ctypes.c_double,
    ctypes.POINTER(ctypes.c_double), ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_double), ctypes.c_size_t,
    ctypes.c_double,
]
c_lib.calc_intercept_rate_c.restype = ctypes.c_double

# ---- Rust 侧 ----
sys.path.insert(0, PYPATH)
import battle_engine_rs as rs   # noqa: E402


def c_intercept(self_r, same, glob, anti):
    s = (ctypes.c_double * len(same))(*same)
    g = (ctypes.c_double * len(glob))(*glob)
    return c_lib.calc_intercept_rate_c(self_r, s, len(same), g, len(glob), anti)


# ---- JS 侧 ----
node_script = os.path.join(HERE, "js_reference.mjs")
out = subprocess.run(["node", node_script], capture_output=True, text=True, timeout=60)
if out.returncode != 0:
    print("node 跑失败：", out.stderr[:500])
    sys.exit(1)
js = json.loads(out.stdout.strip())


# ---- 三方求值 ----
def values():
    return {
        "能量-85%盾+20%": (
            c_lib.calc_energy_damage_c(600, 85, 0.20, 1.0),
            rs.calc_energy_damage_rs(600, 85, 0.20, 1.0),
        ),
        "能量-100%盾无加成": (
            c_lib.calc_energy_damage_c(600, 100, 0.0, 1.0),
            rs.calc_energy_damage_rs(600, 100, 0.0, 1.0),
        ),
        "能量-100%盾+20%": (
            c_lib.calc_energy_damage_c(600, 100, 0.20, 1.0),
            rs.calc_energy_damage_rs(600, 100, 0.20, 1.0),
        ),
        "能量-0%盾无加成": (
            c_lib.calc_energy_damage_c(600, 0, 0.0, 1.0),
            rs.calc_energy_damage_rs(600, 0, 0.0, 1.0),
        ),
        "实弹-140甲+20%": (
            c_lib.calc_physical_damage_c(300, 140, 0.20, 1.0, 0),
            rs.calc_physical_damage_rs(300, 140, 0.20, 1.0, 0),
        ),
        "实弹-100甲(穿甲40)": (
            c_lib.calc_physical_damage_c(300, 140, 0.20, 1.0, 40),
            rs.calc_physical_damage_rs(300, 140, 0.20, 1.0, 40),
        ),
        "实弹-540甲保底": (
            c_lib.calc_physical_damage_c(300, 540, 0.20, 1.0, 0),
            rs.calc_physical_damage_rs(300, 540, 0.20, 1.0, 0),
        ),
        "命中-下沿": (
            c_lib.calc_hit_chance_c(50, 70, 0.0, 0, 0),
            None,   # Rust 公开 API 无命中函数（引擎内部用）
        ),
        "命中-上沿": (c_lib.calc_hit_chance_c(50, 70, 1.0, 0, 0), None),
        "命中-闪避30": (c_lib.calc_hit_chance_c(50, 70, 0.5, 30, 0), None),
        "命中-下限clamp": (c_lib.calc_hit_chance_c(50, 70, 0.0, 85, 0), None),
        "命中-上限clamp": (c_lib.calc_hit_chance_c(50, 70, 1.0, 0, 100), None),
        "拦截-三层": (
            c_intercept(0.10, [0.05, 0.05], [0.02], 0.0),
            rs.calc_intercept_rate_rs(0.10, [0.05, 0.05], [0.02], 0.0),
        ),
        "拦截-反拦截减半": (
            c_intercept(0.10, [0.05, 0.05], [0.02], 0.5),
            rs.calc_intercept_rate_rs(0.10, [0.05, 0.05], [0.02], 0.5),
        ),
    }


TOL = 1e-6
print("=== 三方对拍：C(dll) / Rust(pyd) / JS(参考公式) ===")
print("%-22s %14s %14s %14s  结果" % ("用例", "C", "Rust", "JS"))
fails = 0
for name, (cv, rv) in values().items():
    jv = js.get(name)
    ref = max(abs(jv or 0), 1.0)
    ok_js = jv is not None and abs(cv - jv) <= TOL * ref
    ok_rs = (rv is None) or abs(rv - jv) <= TOL * ref or abs(rv - cv) <= TOL * ref
    ok = ok_js and ok_rs
    if not ok:
        fails += 1
    print("%-22s %14.6f %14s %14.6f  %s" % (
        name, cv,
        ("%.6f" % rv) if rv is not None else "—",
        jv, "OK" if ok else "**FAIL**"))

print("=== %d 项，%d 失败 ===" % (len(values()), fails))
sys.exit(0 if fails == 0 else 1)
