/**
 * test_calc.c - C 版战斗公式的"锁定测试"（ctest）
 *
 * 作用：把当前实现的数值行为**钉住**，防止未来改代码时无意改变公式。
 *
 * ⚠️ 重要说明（2026-10-11）：
 *   本测试的期望值按【结构 = 当前 JS 引擎（simulator.html）口径】编写，
 *   但 **调校系数 1.3 与 JS 引擎现行值 1.0 尚未对齐**（JS 在 2026-09-26
 *   因"面板即真值"把 tuningCoeff 从 1.3 改为 1.0）。
 *   因此：本测试证明"实现符合设计文档的 1.3 口径"，**不代表与 JS 引擎一致**。
 *   对齐后应把这些期望值一起改（能量 273 → 210 等）。
 *
 * 编译：随 CMake 构建（target: test_battle），或手工：
 *   gcc -std=c11 -I include tests/test_calc.c src/battle_calc.c -o test_calc -lm
 */
#include <math.h>
#include <stdio.h>
#include "battle_calc.h"

static int g_fail = 0;
static int g_total = 0;

static void check(const char *name, double got, double want, double tol) {
    int ok = fabs(got - want) <= tol;
    g_total++;
    if (!ok) g_fail++;
    printf("  %-46s got=%-12.6f want=%-12.6f %s\n",
           name, got, want, ok ? "OK" : "**FAIL**");
}

int main(void) {
    printf("=== 拉格朗日 C 公式锁定测试（系数 1.3 口径；与 JS 1.0 待对齐）===\n");

    /* ---- 能量伤害：(基础 + 加成 − 基础×护盾%) × 调校 ---- */
    /* 爱奥VS电磁ST59(85%盾) → (600 + 120 − 510) × 1.3 = 273 */
    check("能量 (600, 85%盾, +20%, x1.3)",
          calc_energy_damage_c(600.0, 85.0, 0.20, 1.0), 273.0, 1e-6);
    check("能量 100%盾=完全免疫",
          calc_energy_damage_c(600.0, 100.0, 0.20, 1.0), 0.0, 1e-6);
    check("能量 0%盾、无加成",
          calc_energy_damage_c(600.0, 0.0, 0.0, 1.0), 780.0, 1e-6);

    /* ---- 实弹伤害：(基础+加成)×调校 − (装甲−穿甲)，不破防走保底 ---- */
    /* 阋神重炮VS奇美拉(140甲) → (300+60)×1.3 − 140 = 328 */
    check("实弹穿透 (300, 140甲, +20%)",
          calc_physical_damage_c(300.0, 140.0, 0.20, 1.0, 0.0), 328.0, 1e-6);
    /* 穿甲 40 → 有效甲 100 → 468 − 100 = 368 */
    check("实弹含穿甲40",
          calc_physical_damage_c(300.0, 140.0, 0.20, 1.0, 40.0), 368.0, 1e-6);
    /* 重甲 540：不破防 → 保底 = 基础 × 10% × 调校 = 30 × 1.3 = 39 */
    check("实弹不破防保底(10%×1.3)",
          calc_physical_damage_c(300.0, 540.0, 0.20, 1.0, 0.0), 39.0, 1e-6);

    /* ---- 三层拦截叠加：1 − (1−self)·Π(1−同排)·Π(1−全局)，再乘反拦截 ---- */
    {
        double same[2] = {0.05, 0.05};
        double glob[1] = {0.02};
        /* 1 − 0.90×0.95×0.95×0.98 = 0.203995 */
        check("拦截 三层叠加",
              calc_intercept_rate_c(0.10, same, 2, glob, 1, 0.0), 0.203995, 1e-6);
        check("拦截 反拦截减半",
              calc_intercept_rate_c(0.10, same, 2, glob, 1, 0.5), 0.1019975, 1e-6);
        check("拦截 空数组=仅自身",
              calc_intercept_rate_c(0.10, NULL, 0, NULL, 0, 0.0), 0.10, 1e-6);
    }

    /* ---- 暴击率上限 95% / 冷却下限 0.5s ---- */
    check("暴击率 clamp 95%", calc_crit_rate_c(0.15, 0.90), 0.95, 1e-6);
    check("暴击率 基础15%+10%", calc_crit_rate_c(0.15, 0.10), 0.25, 1e-6);
    check("冷却 12s 减20%", calc_final_cooldown_c(12.0, 0.20, 1.0), 9.6, 1e-6);
    check("冷却下限 0.5s", calc_final_cooldown_c(0.4, 0.0, 1.0), 0.5, 1e-6);

    printf("=== %d 项，%d 失败 ===\n", g_total, g_fail);
    return g_fail == 0 ? 0 : 1;
}
