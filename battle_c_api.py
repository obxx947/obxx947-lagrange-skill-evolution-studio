# -*- coding: utf-8 -*-
"""
battle_c_api.py — 把「C++ 重写的战斗计算」与「Rust 重写的计算核心」接进后端 API。

挂载方式（main.py）：
    from battle_c_api import router as battle_c_router
    app.include_router(battle_c_router)

端点：
    GET  /api/battle_c/health    C 引擎自检（跑一场微缩战斗）
    POST /api/battle_c           用 C 引擎跑一场 NvN 战斗（毫秒级）
    POST /api/calc_rs            用 Rust 模块算公式（能量/实弹/拦截）

设计：全部【惰性加载】—— C 引擎 dll / Rust pyd 缺失时接口返回 ok=false 并给原因，
不影响后端其它功能启动。
"""
import os
import sys

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["battle"])

_ROOT = os.path.dirname(os.path.abspath(__file__))
_bridge = None
_rust = None
_rust_err = None


def _get_bridge():
    """惰性加载 C 引擎桥（cpp_simcore/bridge_py.py）。"""
    global _bridge
    if _bridge is None:
        try:
            if os.path.join(_ROOT, "cpp_simcore") not in sys.path:
                sys.path.insert(0, os.path.join(_ROOT, "cpp_simcore"))
            import bridge_py
            bridge_py.load_lib()   # 立刻验证 dll 可加载
            _bridge = bridge_py
        except Exception:
            return None
    return _bridge


def _get_rust():
    """惰性加载 Rust 模块（rust_lib/battle_engine_rs.pyd）。"""
    global _rust, _rust_err
    if _rust is None and _rust_err is None:
        try:
            p = os.path.join(_ROOT, "rust_lib")
            if os.path.isdir(r"D:\msys64\mingw64\bin"):
                try:
                    os.add_dll_directory(r"D:\msys64\mingw64\bin")
                except Exception:
                    pass
            if p not in sys.path:
                sys.path.insert(0, p)
            import battle_engine_rs as m
            _rust = m
        except Exception as e:
            _rust_err = str(e)
    return _rust


class BattleCRequest(BaseModel):
    ally: list          # [[hp, armor, shield_pct, single_dmg], ...]  1~64 舰
    enemy: list
    max_time: float = 600.0


class CalcRsRequest(BaseModel):
    kind: str                       # energy / physical / intercept
    args: list                      # 与函数签名顺序一致


@router.get("/battle_c/health")
def battle_c_health():
    b = _get_bridge()
    if b is None:
        return {"ok": False, "reason": "C 引擎不可用：cpp_simcore 未编译或 dll 缺失"}
    try:
        r = b.run_battle([(1000, 10, 0, 100)], [(1000, 10, 0, 100)], max_time=120.0)
        return {"ok": True, "sample": r}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


@router.post("/battle_c")
def battle_c(req: BattleCRequest):
    b = _get_bridge()
    if b is None:
        return {"ok": False, "error": "C 引擎不可用（先编译 cpp_simcore：cmake --build D:/cbuild-cpp）"}
    if not (0 < len(req.ally) <= 64 and 0 < len(req.enemy) <= 64):
        return {"ok": False, "error": "双方舰船数须在 1~64"}
    try:
        r = b.run_battle(req.ally, req.enemy, max_time=req.max_time)
        return {"ok": True, "engine": "C (lagrange_battle.dll)", "report": r}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/calc_rs")
def calc_rs(req: CalcRsRequest):
    m = _get_rust()
    if m is None:
        return {"ok": False, "error": "Rust 模块不可用：%s" % (_rust_err or "rust_lib/battle_engine_rs.pyd 缺失")}
    try:
        if req.kind == "energy":
            # (base, shield_pct, bonus, strategy)
            v = m.calc_energy_damage_rs(*[float(x) for x in req.args])
        elif req.kind == "physical":
            # (base, armor, bonus, strategy, penetration)
            v = m.calc_physical_damage_rs(*[float(x) for x in req.args])
        elif req.kind == "intercept":
            # (self_rate, same_row[], global[], anti_intercept)
            self_rate = float(req.args[0])
            same = [float(x) for x in req.args[1]]
            glob = [float(x) for x in req.args[2]]
            anti = float(req.args[3])
            v = m.calc_intercept_rate_rs(self_rate, same, glob, anti)
        else:
            return {"ok": False, "error": "kind 只支持 energy / physical / intercept"}
        return {"ok": True, "engine": "Rust (battle_engine_rs.pyd)", "value": v}
    except Exception as e:
        return {"ok": False, "error": str(e)}
