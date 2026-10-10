/**
 * smoke_main.c - C 战斗引擎冒烟测试：真实跑一场战斗
 *
 * 2026-10-11 新增。此前 run_battle() 从未被任何代码调用过（只有编译验证）。
 * 本程序构造 己方2舰 vs 敌方2舰 打一场，打印战报（胜负/时长/伤害/剩余HP）。
 *
 * 说明：lagrange_battle.c 是"单文件自带一切"的引擎（没有配套头文件），
 *       故这里用 unity build 直接引入源码；将来拆出 lagrange_battle.h 后改回 #include 头。
 *
 * 编译：随 CMake（target: smoke_battle），或手工：
 *   gcc -std=c11 -I include tools/smoke_main.c -o smoke_battle -lm
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../src/lagrange_battle.c"   /* unity build */

static ShipInstance make_ship(const char* id, const char* name, double hp,
                              double armor, double shield, ShipPosition pos,
                              const char* side, Weapon* weapons, int wcount) {
    ShipInstance s;
    memset(&s, 0, sizeof(s));          /* ★ 先清零，防未初始化字段 */
    snprintf(s.id, sizeof(s.id), "%s", id);
    snprintf(s.name, sizeof(s.name), "%s", name);
    s.position = pos;
    s.max_hp = hp;
    s.current_hp = hp;
    s.physical_armor = armor;
    s.energy_shield_pct = shield;
    s.alive = 1;
    snprintf(s.side, sizeof(s.side), "%s", side);
    s.weapon_count = wcount;
    s.weapons = weapons;
    s.aircraft_mode = INDEPENDENT;
    ship_instance_init(&s);            /* 分配 ws_* 数组 + 初始化子系统 */
    return s;
}

static Weapon make_weapon(const char* name, DamageType t, double dmg,
                          int attacks, int ammo, double lock_t, double cd,
                          double hit_min, double hit_max) {
    Weapon w;
    memset(&w, 0, sizeof(w));
    snprintf(w.name, sizeof(w.name), "%s", name);
    w.dmg_type = t;
    w.weapon_type = DIRECT_FIRE;       /* 直射：不被拦截 */
    w.single_dmg = dmg;
    w.attacks = attacks;
    w.ammo = ammo;
    w.atk_duration = 3.0;
    w.lock_time = lock_t;
    w.cooldown = cd;
    w.hit_min = hit_min;
    w.hit_max = hit_max;
    w.can_crit = 1;
    w.crit_rate = 0.15;
    w.crit_dmg = 1.5;
    w.cannot_be_intercepted = 1;
    w.sys_dmg_coeff = 1.0;
    return w;
}

static void print_ship(const char* tag, const ShipInstance* s) {
    printf("    [%s] %-18s HP %8.1f / %8.1f  dealt %9.1f  %s\n",
           tag, s->name, s->current_hp, s->max_hp, s->total_dmg_dealt,
           s->alive ? "alive" : "DESTROYED");
}

int main(void) {
    srand(42);   /* 固定种子：结果可复现 */

    /* ---- 武器 ---- */
    Weapon ally_w[2], enemy_w[2];
    ally_w[0] = make_weapon("重型实弹炮", PHYSICAL, 300.0, 2, 3, 3.0, 12.0, 50, 70);
    ally_w[1] = make_weapon("能量离子炮", ENERGY,   250.0, 1, 2, 2.0, 10.0, 60, 80);
    enemy_w[0] = make_weapon("中型实弹炮", PHYSICAL, 200.0, 2, 3, 3.0, 14.0, 50, 70);
    enemy_w[1] = make_weapon("防空脉冲炮", PHYSICAL, 100.0, 1, 2, 1.5,  8.0, 60, 85);

    /* ---- 舰船 ---- */
    ShipInstance ally[2], enemy[2];
    ally[0] = make_ship("A1", "盟军-先锋舰", 12000, 60, 20, FRONT, "ally", ally_w, 2);
    ally[1] = make_ship("A2", "盟军-火力舰", 9000,  40, 40, MID,   "ally", ally_w, 2);
    enemy[0] = make_ship("E1", "敌军-主力舰", 10000, 50, 30, FRONT, "enemy", enemy_w, 2);
    enemy[1] = make_ship("E2", "敌军-僚舰",   7000, 30, 10, MID,   "enemy", enemy_w, 2);

    /* ---- 战斗 ---- */
    BattleState bs;
    memset(&bs, 0, sizeof(bs));
    bs.ally_ships = ally;
    bs.ally_count = 2;
    bs.enemy_ships = enemy;
    bs.enemy_count = 2;
    bs.mode = BATTLE_ESCORT;
    bs.bomb_distance = 15.0;
    bs.ally_escort_alive = 1;
    bs.enemy_escort_alive = 1;

    printf("=== C 引擎冒烟：2 舰 vs 2 舰（种子 42）===\n");
    run_battle(&bs, 600.0, 0.1);

    printf("--- 结果 ---\n");
    printf("  winner: %s    time: %.1f s    ended: %d\n",
           bs.winner == 1 ? "ALLY" : (bs.winner == 2 ? "ENEMY" : "DRAW/TIMEOUT"),
           bs.time, bs.ended);
    printf("  total dmg: ally %.1f | enemy %.1f\n", bs.total_ally_dmg, bs.total_enemy_dmg);
    printf("  ships lost: ally %d | enemy %d\n", bs.ally_ships_lost, bs.enemy_ships_lost);
    print_ship("ALLY", &ally[0]);
    print_ship("ALLY", &ally[1]);
    print_ship("ENEMY", &enemy[0]);
    print_ship("ENEMY", &enemy[1]);

    /* 冒烟判据：战斗必须真的有推进（不是 0 伤害/0 时长） */
    int ok = (bs.time > 0.0) && (bs.total_ally_dmg + bs.total_enemy_dmg > 0.0);
    printf(ok ? "SMOKE PASS\n" : "SMOKE FAIL（战斗没有任何推进）\n");
    return ok ? 0 : 1;
}
