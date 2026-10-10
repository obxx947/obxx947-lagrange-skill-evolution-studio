#ifndef LAGRANGE_BATTLE_H
#define LAGRANGE_BATTLE_H

/**
 * lagrange_battle.h - C 完整战斗引擎的对外接口（2026-10-11 新建）
 *
 * 引擎本体 lagrange_battle.c 是"单文件自带一切"的设计（结构体都在 .c 里），
 * 本头只暴露【给其它语言/模块调用】的简化入口 —— 不依赖内部结构体，纯 C ABI。
 *
 * 用 Python 调用的例子见 cpp_simcore/bridge_py.py（ctypes）。
 */
#ifdef __cplusplus
extern "C" {
#endif

/**
 * 简化战斗入口（N 舰 vs M 舰）。
 *
 * 每艘舰用 4 个 double 描述：
 *   [0] 结构值(hp)  [1] 物理护甲  [2] 能量护盾%  [3] 单发伤害
 * （武器统一按：直射/不可拦截/2轮×3发/锁定3s/冷却12s/命中50-70%/可暴击15%×1.5）
 *
 * out_report 至少 8 个 double，写回：
 *   [0] winner(1=我方 2=敌方 0=未决)   [1] 战斗时长(秒)
 *   [2] 我方总伤害                     [3] 敌方总伤害
 *   [4] 我方损失舰数                   [5] 敌方损失舰数
 *   [6] 我方剩余总HP                   [7] 敌方剩余总HP
 *
 * @return 写入元素个数（=8）；参数非法返回 -1。
 */
int lagrange_battle_simple(int ally_n, const double* ally_stats,
                            int enemy_n, const double* enemy_stats,
                            double max_time, double* out_report);

#ifdef __cplusplus
}
#endif

#endif /* LAGRANGE_BATTLE_H */
