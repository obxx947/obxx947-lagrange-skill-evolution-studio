# -*- coding: utf-8 -*-
"""
bridge_py.py — 用 Python 调用 C 战斗引擎（"C++ 重写战斗计算"的可调用出口）

加载 liblagrange_battle.dll，通过 ctypes 调 lagrange_battle_simple() 跑一场 NvN 战斗。
后端（FastAPI）、进化训练（nn_py/evolve.py 的 battle 适应度）或任何 Python 脚本
都能这样把战斗计算直接交给 C 引擎。

作为模块用：
    import bridge_py
    r = bridge_py.run_battle([(12000, 60, 20, 300), ...], [(10000, 50, 30, 200), ...])

作为脚本用（跑演示）：
    python bridge_py.py [dll路径]
默认 dll：D:\\cbuild-cpp\\liblagrange_battle.dll
（重新编译：cmake --build D:/cbuild-cpp）
"""
import ctypes
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DEFAULT_DLL = r"D:\cbuild-cpp\liblagrange_battle.dll"

# MinGW 运行库（libgcc_s_seh-1.dll / libwinpthread-1.dll）在 msys64 里
if os.path.isdir(r"D:\msys64\mingw64\bin"):
    try:
        os.add_dll_directory(r"D:\msys64\mingw64\bin")
    except Exception:
        pass

_lib = None          # 惰性加载（import 本模块不会因 dll 缺失而失败）


def load_lib(dll_path=None):
    """显式加载/切换 dll；返回 ctypes 库对象。"""
    global _lib
    path = dll_path or DEFAULT_DLL
    if not os.path.exists(path):
        raise FileNotFoundError(
            "找不到 dll: %s\n（先编译：cmake --build D:/cbuild-cpp）" % path)
    lib = ctypes.CDLL(path)
    lib.lagrange_battle_simple.argtypes = [
        ctypes.c_int, ctypes.POINTER(ctypes.c_double),   # ally_n, ally_stats
        ctypes.c_int, ctypes.POINTER(ctypes.c_double),   # enemy_n, enemy_stats
        ctypes.c_double,                                  # max_time
        ctypes.POINTER(ctypes.c_double),                  # out_report
    ]
    lib.lagrange_battle_simple.restype = ctypes.c_int
    _lib = lib
    return lib


def _ensure_lib():
    return _lib if _lib is not None else load_lib()


def make_stats(ships):
    """ships: [(hp, armor, shield_pct, single_dmg), ...] → c_double 数组"""
    flat = []
    for s in ships:
        assert len(s) == 4, "每舰 4 个字段: (hp, armor, shield_pct, single_dmg)"
        flat.extend(float(x) for x in s)
    return (ctypes.c_double * len(flat))(*flat)


def run_battle(ally_ships, enemy_ships, max_time=600.0):
    """调 C 引擎跑一场，返回 dict 战报。"""
    lib = _ensure_lib()
    ally = make_stats(ally_ships)
    enemy = make_stats(enemy_ships)
    out = (ctypes.c_double * 8)()
    n = lib.lagrange_battle_simple(len(ally_ships), ally,
                                   len(enemy_ships), enemy,
                                   float(max_time), out)
    if n != 8:
        raise RuntimeError("引擎返回 %d（应为 8）——参数非法？" % n)
    return {
        "winner": {0: "未决", 1: "我方", 2: "敌方"}[int(out[0])],
        "duration": out[1],
        "ally_dmg": out[2],
        "enemy_dmg": out[3],
        "ally_lost": int(out[4]),
        "enemy_lost": int(out[5]),
        "ally_hp_left": out[6],
        "enemy_hp_left": out[7],
    }


if __name__ == "__main__":
    dll_path = sys.argv[1] if len(sys.argv) > 1 else None
    load_lib(dll_path)

    # 演示：2 舰 vs 2 舰（hp, 护甲, 护盾%, 单发）
    ally = [(12000, 60, 20, 300), (9000, 40, 40, 250)]
    enemy = [(10000, 50, 30, 200), (7000, 30, 10, 100)]

    print("=== Python → C 引擎（ctypes）2 舰 vs 2 舰 ===")
    r = run_battle(ally, enemy)
    for k, v in r.items():
        print("  %-14s %s" % (k, v))

    ok = r["duration"] > 0 and (r["ally_dmg"] + r["enemy_dmg"]) > 0
    print("BRIDGE PASS" if ok else "BRIDGE FAIL")
    sys.exit(0 if ok else 1)
