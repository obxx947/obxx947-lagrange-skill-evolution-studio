/**
 * lagrange_battle.c - 无尽的拉格朗日 完整战斗引擎 (C语言实现)
 * 
 * 基于《战斗机制.txt》全文719行的每一个公式精确实现。
 * 包括：双伤害体系、舰载机空战、防空、拦截、系统HP、修理、分伤
 * 
 * 作者: Lagrange AI Team
 * 版本: 2.0.0
 * 许可: MIT
 */

#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>

#include "lagrange_battle.h"   /* 对外接口声明（保证与实现一致） */

/* ==================== 全局常量（来自战斗机制.txt） ==================== */

/* ★ 2026-10-11 对齐 JS 引擎：tuningCoeff 1.3 → 1.0
   （JS 在 2026-09-26 决定：面板数值本身就是游戏真值，核对式里没有调校项；
     原 1.3 会让所有伤害系统性偏高 30%） */
#define TUNE            1.0     /* 调校系数（JS 现行 = 1.0） */
#define MIN_DMG_RATIO   0.10    /* 实弹不破防保底10% */
#define CRIT_BASE_RATE  0.15    /* 基础暴击率15% */
#define SYS_DMG_CHANCE  0.10    /* 系统破坏触发概率 */
#define PLUTUS_REDUCTION 0.30   /* 普鲁图斯之盾旗舰减伤30% */
#define BOMB_BASE_DIST  15.0    /* 轰炸距离基准(吉米) */
#define BOMB_PENALTY    0.02    /* 每吉米命中修正2%（★ JS 2026-10-03 已停用） */
#define HIT_MIN         0.10    /* 命中率下限（JS: HIT_MIN） */
#define HIT_MAX         0.95    /* 命中率上限（JS: HIT_MAX） */
#define FLIGHT_PER_JIMI 2.0     /* 每吉米飞行时间2秒 */
#define REPAIR_ARMOR_BONUS 0.0025 /* 1点物理护甲=0.25%维修加成 */
#define REPAIR_MAX_BONUS 2.5    /* 维修加成上限150% */
#define DMG_DIST_DIVISOR 2.5    /* 分伤机制除数 */
#define COUNTER_AA_SHIP 0.15    /* 舰载防空武器基础命中 */
#define COUNTER_AA_AIRCRAFT 0.60 /* 机载防空武器基础命中 */
#define MAX_FLEET_CV     500    /* 主舰队总人口上限 */
#define MAX_REINFORCE    9      /* 增援舰船数量上限 */

/* 系统HP占舰船总HP比例 */
#define SYS_MAIN_WEAPON_RATIO 0.12
#define SYS_HANGAR_RATIO      0.10
#define SYS_COMMAND_RATIO     0.08
#define SYS_PROPULSION_RATIO  0.06

/* 系统修理上限次数 */
#define SYS_MAIN_WEAPON_REPAIRS 2
#define SYS_HANGAR_REPAIRS      2
#define SYS_COMMAND_REPAIRS     3
#define SYS_PROPULSION_REPAIRS  0   /* 动力系统不可修理 */

/* 系统瞄准效率 */
#define SYS_EFF_HIGH    0.60
#define SYS_EFF_MEDIUM  0.40
#define SYS_EFF_LOW     0.20

/* 系统伤害系数（战斗机制.txt §2） */
#define SYS_COEFF_STANDARD 1.25
#define SYS_COEFF_ENHANCED 1.50
#define SYS_COEFF_HEAVY    3.00

/* ==================== 枚举定义 ==================== */

typedef enum { PHYSICAL = 0, ENERGY = 1 } DamageType;
typedef enum { DIRECT_FIRE = 0, PROJECTILE = 1 } WeaponType;
typedef enum { FRONT = 0, MID = 1, BACK = 2, AIR = 3 } ShipPosition;
typedef enum { MAIN_WEAPON = 0, HANGAR = 1, COMMAND = 2, PROPULSION = 3 } SystemType;
typedef enum { INDEPENDENT = 0, RECIPROCATING = 1 } AircraftMode;
/* ★ 2026-10-11：加 AA_NONE=0 并把它放在首值 —— 原来 AA_COUNTER=0 是首值，
   memset 默认构造的武器全部变成"防空反击"（process_antiair 会把它们拿去打敌舰）。 */
typedef enum { AA_NONE = 0, AA_COUNTER = 1, AA_AREA = 2, AA_ACTIVE = 3 } AAType;
typedef enum { BATTLE_ESCORT = 0, BATTLE_BOMB = 1 } BattleMode;

/* ==================== 数据结构 ==================== */

/** 武器定义 */
typedef struct {
    char name[64];
    DamageType dmg_type;
    WeaponType weapon_type;
    double single_dmg;          /* 单发基础伤害 */
    int attacks;                /* 攻击轮次 */
    int ammo;                   /* 每轮弹药数 */
    double atk_duration;        /* 攻击持续时间(秒) */
    double lock_time;           /* 锁定时间(秒) */
    double cooldown;            /* 冷却时间(秒) */
    char priority[32];          /* 优先目标 */
    int can_crit;               /* 可暴击 */
    double crit_rate;           /* 暴击率 */
    double crit_dmg;            /* 暴击倍率 */
    double lock_efficiency;     /* 锁定效率 */
    double hit_min;             /* 最小命中率 */
    double hit_max;             /* 最大命中率 */
    AAType aa_type;             /* 防空类型 */
    double intercept_rate;      /* 拦截率 */
    int cannot_be_intercepted;  /* 不可被拦截 */
    double repair_dpm;          /* 维修DPM */
    double sys_dmg_coeff;       /* 系统伤害系数 */
    double anti_intercept;      /* 反拦截系数 */
    double dmg_bonus_pct;       /* 伤害加成% */
} Weapon;

/** 子系统状态 */
typedef struct {
    SystemType type;
    char name[32];
    double max_hp;
    double current_hp;
    int destroyed;
    int permanent_destroyed;    /* 超过修理上限 */
    int repair_count;
    double repair_timer;        /* 25秒修复计时 */
} SubSystem;

/** 舰船战斗实例 */
typedef struct {
    char id[32];
    char name[64];
    char ship_type[32];         /* cruiser/destroyer/frigate/... */
    ShipPosition position;
    double max_hp;
    double current_hp;
    double physical_armor;
    double energy_shield_pct;   /* 0-100 */
    double evasion;             /* 闪避率% */
    int is_super_capital;
    int is_flagship;
    int is_carrier;
    int is_escort;
    int is_escorted;
    int alive;
    char side[8];               /* "ally" or "enemy" */

    /* 武器系统 */
    int weapon_count;
    Weapon* weapons;

    /* 子系统（数值HP） */
    SubSystem subsystems[4];

    /* 舰载机相关 */
    AircraftMode aircraft_mode;
    int squadron_size;
    int current_squadron;
    double flight_out_time;     /* 去程飞行时间 */
    double flight_back_time;    /* 返程飞行时间 */
    int is_aircraft;            /* 自身是否为舰载机 */
    char mother_ship_id[32];    /* 母舰ID */
    int in_hangar;              /* 是否在机库内（受保护） */

    /* 强化 */
    double strengthen_dmg;      /* 武器伤害加成% */
    double strengthen_lock;     /* 锁定缩减% */
    double strengthen_cd;       /* 冷却缩减% */
    double strengthen_crit;     /* 暴击率加成% */
    double strengthen_critdmg;  /* 暴击伤害加成% */

    /* 统计 */
    double total_dmg_dealt;
    double total_dmg_taken;
    int shots_fired;
    int shots_hit;

    /* 运行时武器状态 */
    int* ws_phase;              /* 0=cooldown, 1=lock, 2=attack */
    double* ws_cd_remain;
    double* ws_lock_remain;
    double* ws_atk_remain;
    int* ws_shots_fired;
    int* ws_total_shots;
    int* ws_target_idx;         /* 目标索引 */
} ShipInstance;

/** 战斗全局状态 */
typedef struct {
    ShipInstance* ally_ships;
    int ally_count;
    ShipInstance* enemy_ships;
    int enemy_count;
    double time;
    int ended;
    int winner;                 /* 0=none, 1=ally, 2=enemy */
    BattleMode mode;
    double bomb_distance;
    int ally_escort_alive;
    int enemy_escort_alive;
    double total_ally_dmg;
    double total_enemy_dmg;
    int ally_ships_lost;
    int enemy_ships_lost;
    int ally_aircraft_lost;
    int enemy_aircraft_lost;

    /* 战斗日志 */
    char** logs;
    int log_count;
    int log_capacity;
} BattleState;

/* ==================== 核心战斗公式 ==================== */

/**
 * 能量结构伤害 (§1.1.1, 战斗机制.txt L387-389)
 * 公式: (基础+科技+策略-基础×护甲%) × (1+调校)
 * 验证: 爱奥(600+120-510)×1.3=273 ✓
 */
static double calc_energy_damage(double base, double tech, double strategy,
                                  double shield_pct) {
    if (shield_pct >= 100.0) return 0.0;
    double shield_reduction = base * (shield_pct / 100.0);
    return fmax(0.0, (base + tech + strategy - shield_reduction) * TUNE);
}

/**
 * 实弹结构伤害 - 可破防 (§1.1.1, L387)
 * 公式: (基础+科技+策略)×(1+调校) - 护甲
 * 验证: 阋神重炮(300+60)×1.3-140=328 ✓
 */
static double calc_physical_penetrating(double base, double tech, double strategy,
                                         double armor) {
    return fmax(0.0, (base + tech + strategy) * TUNE - armor);
}

/**
 * 实弹结构伤害 - 不破防 (§1.1.3, L453-457)
 * 公式: (基础+科技+策略)/10 × (1+调校)
 * 验证: 阋神300炮(300+60)/10×1.3=46 ✓
 */
static double calc_physical_nonpenetrating(double base, double tech, double strategy) {
    return fmax(0.0, (base + tech + strategy) / 10.0 * TUNE);
}

/**
 * 实弹伤害判定 (完整)
 * 破防判定: (base+tech+strategy)×TUNE - armor > 0
 */
static double calc_physical_damage(double base, double tech, double strategy,
                                    double armor) {
    double raw = (base + tech + strategy) * TUNE;
    if (raw > armor) {
        return raw - armor;  /* 可破防 */
    }
    return (base + tech + strategy) / 10.0 * TUNE;  /* 不破防保底 */
}

/**
 * 命中率计算 (L183, L274)
 * 公式: 基础命中区间 × (1 - 闪避%) + 轰炸距离修正
 */
static double calc_hit_chance(double hit_min, double hit_max, double evasion,
                               double bomb_distance) {
    (void)bomb_distance;   /* ★ JS 2026-10-03 已停用轰炸距离修正，此处同步停用 */
    double base = (hit_min + (double)rand() / RAND_MAX * (hit_max - hit_min)) / 100.0;
    base *= (1.0 - evasion / 100.0);
    return fmax(HIT_MIN, fmin(HIT_MAX, base));   /* ★ 10%~95%（JS 口径；原 1%~99% 不符） */
}

/**
 * 三层拦截率计算 (L280-282)
 * 公式: 1 - (1-self) × Π(1-same_row)^b × Π(1-global)^a
 */
static double calc_intercept_rate(double self_rate, double* same_row_rates,
                                   int same_row_count, double* global_rates,
                                   int global_count, double anti_intercept) {
    double total = 1.0 - fmax(0.0, fmin(1.0, self_rate));
    int i;
    for (i = 0; i < same_row_count; i++) {
        total *= (1.0 - fmax(0.0, fmin(1.0, same_row_rates[i])));
    }
    for (i = 0; i < global_count; i++) {
        total *= (1.0 - fmax(0.0, fmin(1.0, global_rates[i])));
    }
    double intercept = 1.0 - total;
    /* 反拦截修正 (L282) */
    intercept *= (1.0 - fmax(0.0, fmin(1.0, anti_intercept)));
    return fmax(0.0, fmin(1.0, intercept));
}

/**
 * 暴击伤害 (L189, L277)
 * 暴击直接作用于最终单发伤害
 */
static double calc_crit_damage(double base_crit_dmg, double crit_bonus,
                                double target_reduction) {
    return fmax(1.0, base_crit_dmg * (1.0 + crit_bonus - target_reduction));
}

/**
 * 最终冷却时间 (L185, L276)
 * 公式: 基础冷却 × (1 - 冷却加成) × (1 - 策略系数)
 */
static double calc_final_cooldown(double base_cd, double cd_reduction,
                                   double strategy_coeff) {
    return fmax(0.5, base_cd * (1.0 - cd_reduction) * (1.0 - strategy_coeff));
}

/**
 * 锁定时间 (L187)
 * 公式: 基础锁定 × (1 - 锁定减少 + 敌方锁定延长)
 */
static double calc_final_lock_time(double base_lock, double lock_reduction,
                                    double enemy_extension) {
    return fmax(0.2, base_lock * (1.0 - lock_reduction + enemy_extension));
}

/**
 * 系统伤害 (§2.1, L515-517)
 * 公式: (基础+科技+策略) × (1+调校) × 系统伤害系数
 * 系数: 1.25(标准), 1.5(强化), 3.0(重型)
 */
static double calc_system_damage(double base, double tech, double strategy,
                                  double sys_coeff) {
    return (base + tech + strategy) * TUNE * sys_coeff;
}

/**
 * 维修量计算 (L170)
 * 公式: 面板维修量/60 × (1+受维修加成%) × dt
 * 每1点物理护甲=0.25%维修加成 (上限150%)
 */
static double calc_repair_amount(double repair_dpm, double target_armor,
                                  double dt, double repair_bonus_pct) {
    double base_per_sec = repair_dpm / 60.0;
    double armor_bonus = 1.0 + target_armor * REPAIR_ARMOR_BONUS;
    if (armor_bonus > REPAIR_MAX_BONUS) armor_bonus = REPAIR_MAX_BONUS;
    return base_per_sec * armor_bonus * (1.0 + repair_bonus_pct / 100.0) * dt;
}

/**
 * 分伤机制 (L339)
 * 公式: 可被攻击目标数 = 总目标数 / 2.5 (取整)
 */
static int calc_attackable_targets(int total_targets) {
    int result = (int)(total_targets / DMG_DIST_DIVISOR);
    return result > 0 ? result : 1;
}

/**
 * 轰炸距离命中修正 (L338)
 */
static double calc_bomb_hit_modifier(double bomb_distance) {
    if (bomb_distance > BOMB_BASE_DIST) {
        return -(bomb_distance - BOMB_BASE_DIST) * BOMB_PENALTY;
    }
    return (BOMB_BASE_DIST - bomb_distance) * BOMB_PENALTY;
}

/**
 * 舰载机飞行时间 (L338)
 * 每1吉米 = 2秒飞行时间
 */
static double calc_flight_time(double bomb_distance) {
    return bomb_distance * FLIGHT_PER_JIMI;
}

/* ==================== 武器状态机 ==================== */

/**
 * 攻击循环三阶段 (L22-34):
 * 1. 目标选择(锁定) — 可在冷却阶段同时进行
 * 2. 开火射击 — 按攻击次数执行
 * 3. 冷却 — 可同时进行目标选择
 * 首轮攻击不需要冷却
 * 攻击过程中目标死亡→不进入冷却→带剩余攻击重新锁敌
 */
static void init_weapon_states(ShipInstance* ship) {
    ship->ws_phase = malloc(ship->weapon_count * sizeof(int));
    ship->ws_cd_remain = malloc(ship->weapon_count * sizeof(double));
    ship->ws_lock_remain = malloc(ship->weapon_count * sizeof(double));
    ship->ws_atk_remain = malloc(ship->weapon_count * sizeof(double));
    ship->ws_shots_fired = malloc(ship->weapon_count * sizeof(int));
    ship->ws_total_shots = malloc(ship->weapon_count * sizeof(int));
    ship->ws_target_idx = malloc(ship->weapon_count * sizeof(int));

    int i;
    for (i = 0; i < ship->weapon_count; i++) {
        Weapon* w = &ship->weapons[i];
        ship->ws_phase[i] = 0;  /* 首轮攻击不需要冷却 */
        ship->ws_cd_remain[i] = 0;
        ship->ws_lock_remain[i] = w->lock_time;
        ship->ws_atk_remain[i] = 0;
        ship->ws_shots_fired[i] = 0;
        ship->ws_total_shots[i] = w->attacks * w->ammo;
        ship->ws_target_idx[i] = -1;
    }
}

/**
 * ★ 2026-10-11 新增：舰船实例初始化（公开入口）
 *
 * 此前 init_weapon_states 是 static、且 subsystems[] 从没被初始化过 ——
 * simulate_tick 会读到未初始化的 destroyed/max_hp 垃圾值（影响指挥系统判定与维修）。
 * 调用前请先设置好：weapon_count/weapons、max_hp、position 等基础字段。
 */
void ship_instance_init(ShipInstance* ship) {
    init_weapon_states(ship);

    /* 子系统按比例初始化（比例常量见文件头 #define） */
    const double ratios[4] = {
        SYS_MAIN_WEAPON_RATIO, SYS_HANGAR_RATIO,
        SYS_COMMAND_RATIO, SYS_PROPULSION_RATIO
    };
    const SystemType types[4] = { MAIN_WEAPON, HANGAR, COMMAND, PROPULSION };
    const char* names[4] = { "主武器系统", "机库系统", "指挥系统", "动力系统" };
    int i;
    for (i = 0; i < 4; i++) {
        ship->subsystems[i].type = types[i];
        snprintf(ship->subsystems[i].name, sizeof(ship->subsystems[i].name), "%s", names[i]);
        ship->subsystems[i].max_hp = ship->max_hp * ratios[i];
        ship->subsystems[i].current_hp = ship->subsystems[i].max_hp;
        ship->subsystems[i].destroyed = 0;
        ship->subsystems[i].permanent_destroyed = 0;
        ship->subsystems[i].repair_count = 0;
        ship->subsystems[i].repair_timer = 0.0;
    }
}

/* ==================== 战斗模拟核心 ==================== */

/**
 * 执行单发射击的完整伤害管线：
 * 命中→拦截→护航保护→伤害计算→暴击→旗舰减伤→系统破坏→死亡
 */
static void execute_shot(ShipInstance* attacker, ShipInstance* target,
                          Weapon* weapon, BattleState* bs, double* out_dmg) {
    *out_dmg = 0;

    /* 1. 命中判定 */
    double hit = calc_hit_chance(weapon->hit_min, weapon->hit_max,
                                  target->evasion, bs->bomb_distance);
    if ((double)rand() / RAND_MAX > hit) return;

    /* 2. 拦截判定（三层） */
    if (!weapon->cannot_be_intercepted) {
        ShipInstance* friends = (target->side[0] == 'a') ?
            bs->ally_ships : bs->enemy_ships;
        int f_count = (target->side[0] == 'a') ?
            bs->ally_count : bs->enemy_count;

        double self_rate = weapon->intercept_rate / 100.0;
        double same_row_rates[100];  int src = 0;
        double global_rates[100];    int grc = 0;
        int j;
        for (j = 0; j < f_count; j++) {
            if (!friends[j].alive) continue;
            if (friends[j].weapon_count == 0) continue;
            int k;
            for (k = 0; k < friends[j].weapon_count; k++) {
                double ir = friends[j].weapons[k].intercept_rate / 100.0;
                if (ir <= 0) continue;
                if (&friends[j] == target) {
                    self_rate = fmax(self_rate, ir);
                } else if (friends[j].position == target->position) {
                    same_row_rates[src++] = ir;
                } else {
                    global_rates[grc++] = ir;
                }
            }
        }
        double intercept_p = calc_intercept_rate(self_rate, same_row_rates, src,
                                                  global_rates, grc,
                                                  weapon->anti_intercept);
        if ((double)rand() / RAND_MAX < intercept_p) return;
    }

    /* 3. 护航保护 */
    if (target->is_escorted) {
        int esc_alive = (target->side[0] == 'a') ?
            bs->ally_escort_alive : bs->enemy_escort_alive;
        if (esc_alive) return;
    }

    /* 4. 伤害计算 */
    double tech = weapon->single_dmg * (attacker->strengthen_dmg / 100.0);
    double strategy = 0; /* 策略项 */
    double dmg;

    if (weapon->dmg_type == ENERGY) {
        if (target->energy_shield_pct >= 100) return;
        dmg = calc_energy_damage(weapon->single_dmg, tech, strategy,
                                  target->energy_shield_pct);
    } else {
        dmg = calc_physical_damage(weapon->single_dmg, tech, strategy,
                                    target->physical_armor);
    }

    /* 5. 暴击 */
    if (weapon->can_crit) {
        double crit_rate = CRIT_BASE_RATE + attacker->strengthen_crit / 100.0;
        if ((double)rand() / RAND_MAX < crit_rate) {
            double crit_mult = calc_crit_damage(1.5, attacker->strengthen_critdmg / 100.0, 0);
            dmg *= crit_mult;
        }
    }

    /* 6. 旗舰减伤（普鲁图斯之盾） */
    {
        ShipInstance* friends = (target->side[0] == 'a') ?
            bs->ally_ships : bs->enemy_ships;
        int f_count = (target->side[0] == 'a') ?
            bs->ally_count : bs->enemy_count;
        int j;
        for (j = 0; j < f_count; j++) {
            if (friends[j].alive && friends[j].is_flagship &&
                strstr(friends[j].name, "普鲁图斯")) {
                if (!friends[j].subsystems[COMMAND].destroyed) {
                    dmg *= (1.0 - PLUTUS_REDUCTION);
                }
                break;
            }
        }
    }

    dmg = fmax(0.0, round(dmg));
    *out_dmg = dmg;

    /* 7. 应用伤害 */
    target->current_hp -= dmg;
    attacker->total_dmg_dealt += dmg;
    target->total_dmg_taken += dmg;
    attacker->shots_hit++;
    /* ★ 2026-10-11：BattleState 级总伤害此前从未累加（smoke 打印恒 0） */
    if (attacker->side[0] == 'a') bs->total_ally_dmg += dmg;
    else bs->total_enemy_dmg += dmg;

    /* 8. 系统破坏判定 (10%概率) */
    if ((double)rand() / RAND_MAX < SYS_DMG_CHANCE) {
        int j;
        for (j = 0; j < 4; j++) {
            if (!target->subsystems[j].destroyed &&
                !target->subsystems[j].permanent_destroyed &&
                j != PROPULSION) {
                target->subsystems[j].destroyed = 1;
                target->subsystems[j].repair_timer = 25.0;
                target->current_hp -= target->max_hp * 0.05; /* 5%HP惩罚 */
                break;
            }
        }
    }

    /* 9. 死亡检查 */
    if (target->current_hp <= 0) {
        target->current_hp = 0;
        target->alive = 0;
        if (target->side[0] == 'a') bs->ally_ships_lost++;
        else bs->enemy_ships_lost++;
        /* 母舰被毁→舰载机全部摧毁 */
        if (target->is_carrier) {
            ShipInstance* aircraft = (target->side[0] == 'a') ?
                bs->ally_ships : bs->enemy_ships;
            int ac = (target->side[0] == 'a') ?
                bs->ally_count : bs->enemy_count;
            int j;
            for (j = 0; j < ac; j++) {
                if (aircraft[j].is_aircraft &&
                    strcmp(aircraft[j].mother_ship_id, target->id) == 0) {
                    aircraft[j].alive = 0;
                    if (target->side[0] == 'a') bs->ally_aircraft_lost++;
                    else bs->enemy_aircraft_lost++;
                }
            }
        }
    }
}

/**
 * 处理单舰所有武器的攻击循环
 */
static void process_ship_weapons(ShipInstance* ship, ShipInstance* enemies,
                                  int enemy_count, BattleState* bs, double dt) {
    if (!ship->alive || ship->is_aircraft) return;
    int i;
    for (i = 0; i < ship->weapon_count; i++) {
        Weapon* w = &ship->weapons[i];

        if (ship->ws_phase[i] == 0) { /* cooldown */
            ship->ws_cd_remain[i] -= dt;
            if (ship->ws_cd_remain[i] <= 0) {
                ship->ws_phase[i] = 1; /* lock */
                ship->ws_lock_remain[i] = calc_final_lock_time(
                    w->lock_time, ship->strengthen_lock / 100.0, 0);
            }
        } else if (ship->ws_phase[i] == 1) { /* lock */
            ship->ws_lock_remain[i] -= dt;
            /* 选择目标 */
            if (enemy_count > 0) {
                /* 直射武器按前中后排顺序 */
                if (w->weapon_type == DIRECT_FIRE) {
                    int pos_order[] = {FRONT, MID, BACK};
                    int p;
                    for (p = 0; p < 3; p++) {
                        int j;
                        for (j = 0; j < enemy_count; j++) {
                            if (enemies[j].alive && enemies[j].position == pos_order[p]) {
                                ship->ws_target_idx[i] = j;
                                break;
                            }
                        }
                        if (ship->ws_target_idx[i] >= 0) break;
                    }
                } else {
                    /* 投射武器随机选择 */
                    int alive_count = 0;
                    int j;
                    for (j = 0; j < enemy_count; j++) {
                        if (enemies[j].alive) alive_count++;
                    }
                    if (alive_count > 0) {
                        int pick = rand() % alive_count;
                        int idx = 0;
                        for (j = 0; j < enemy_count; j++) {
                            if (enemies[j].alive) {
                                if (idx == pick) { ship->ws_target_idx[i] = j; break; }
                                idx++;
                            }
                        }
                    }
                }
            }
            if (ship->ws_lock_remain[i] <= 0 && ship->ws_target_idx[i] >= 0) {
                ship->ws_phase[i] = 2; /* attack */
                ship->ws_atk_remain[i] = w->atk_duration;
                ship->ws_shots_fired[i] = 0;
                if (w->atk_duration <= 0) {
                    /* 0持续时间立即发射全部 */
                    ShipInstance* target = &enemies[ship->ws_target_idx[i]];
                    int k;
                    for (k = 0; k < ship->ws_total_shots[i]; k++) {
                        if (!target->alive) break;
                        double dmg;
                        execute_shot(ship, target, w, bs, &dmg);
                    }
                    ship->ws_phase[i] = 0; /* cooldown */
                    ship->ws_cd_remain[i] = calc_final_cooldown(
                        w->cooldown, ship->strengthen_cd / 100.0, 0);
                    ship->ws_target_idx[i] = -1;
                }
            }
        } else if (ship->ws_phase[i] == 2) { /* attack */
            ship->ws_atk_remain[i] -= dt;
            ShipInstance* target = (ship->ws_target_idx[i] >= 0) ?
                &enemies[ship->ws_target_idx[i]] : NULL;
            if (target && target->alive && w->atk_duration > 0) {
                /* 在攻击持续时间内均匀分批次输出 (L288-289) */
                int shots_this_tick = fmax(1,
                    (int)(ship->ws_total_shots[i] * (dt / fmax(0.01, w->atk_duration))));
                int remaining = ship->ws_total_shots[i] - ship->ws_shots_fired[i];
                shots_this_tick = fmin(shots_this_tick, remaining);
                int k;
                for (k = 0; k < shots_this_tick; k++) {
                    if (!target->alive) break;
                    double dmg;
                    execute_shot(ship, target, w, bs, &dmg);
                    ship->ws_shots_fired[i]++;
                }
            }
            if (ship->ws_atk_remain[i] <= 0 ||
                ship->ws_shots_fired[i] >= ship->ws_total_shots[i]) {
                /* 攻击完成或目标死亡→冷却 */
                ship->ws_phase[i] = 0;
                ship->ws_cd_remain[i] = calc_final_cooldown(
                    w->cooldown, ship->strengthen_cd / 100.0, 0);
                ship->ws_target_idx[i] = -1;
            }
        }
    }
}

/**
 * 处理舰载机作战
 */
static void process_aircraft(ShipInstance* aircraft, ShipInstance* enemies,
                              int enemy_count, BattleState* bs, double dt) {
    if (!aircraft->alive || !aircraft->is_aircraft) return;

    /* 独立作战模式 (L309-319):
     * 除开局首次锁敌外，视为在对方阵型内持续攻击
     * 遵循"锁敌-攻击-冷却"循环直到被击毁 */
    if (aircraft->aircraft_mode == INDEPENDENT) {
        if (aircraft->in_hangar) {
            /* 首次出击 */
            aircraft->in_hangar = 0;
            aircraft->ws_phase[0] = 1; /* 开始锁定 */
            aircraft->ws_lock_remain[0] = aircraft->weapons[0].lock_time;
        }
        process_ship_weapons(aircraft, enemies, enemy_count, bs, dt);
    }
    /* 往复打击模式 (L321-337):
     * 攻击→返航→装填→锁定→再出击
     * 在机库内等待冷却和锁定期间不受防空攻击 */
    else {
        if (aircraft->in_hangar) {
            /* 在机库内锁定+冷却同时进行 */
            aircraft->ws_cd_remain[0] -= dt;
            aircraft->ws_lock_remain[0] -= dt;
            if (aircraft->ws_cd_remain[0] <= 0 && aircraft->ws_lock_remain[0] <= 0) {
                /* 冷却和锁定同时完成→出舱 */
                aircraft->in_hangar = 0;
                aircraft->ws_phase[0] = 2; /* 直接攻击 */
                aircraft->ws_atk_remain[0] = aircraft->weapons[0].atk_duration;
                aircraft->ws_shots_fired[0] = 0;
            }
        } else {
            process_ship_weapons(aircraft, enemies, enemy_count, bs, dt);
            /* 攻击完成后返航 */
            if (aircraft->ws_phase[0] == 0 && aircraft->ws_cd_remain[0] > 0) {
                aircraft->in_hangar = 1;
                aircraft->ws_cd_remain[0] = aircraft->weapons[0].cooldown;
                aircraft->ws_lock_remain[0] = aircraft->weapons[0].lock_time;
            }
        }
    }
}

/**
 * 防空系统处理
 */
static void process_antiair(ShipInstance* defender, ShipInstance* enemy_aircraft,
                             int ac_count, BattleState* bs, double dt) {
    if (!defender->alive || ac_count == 0) return;
    int i;
    for (i = 0; i < defender->weapon_count; i++) {
        Weapon* w = &defender->weapons[i];
        if (w->aa_type != AA_NONE) {
            /* 防空武器基础命中率 (L105) */
            double base_hit = (defender->is_aircraft) ?
                COUNTER_AA_AIRCRAFT : COUNTER_AA_SHIP;
            /* 选择空中目标攻击
               ★ 2026-10-11 修复：调用方传入的是【全部敌舰数组】，这里必须过滤
               is_aircraft —— 否则敌舰会被当载机打（不走伤害管线/不 clamp/不统计）。 */
            int j;
            for (j = 0; j < ac_count; j++) {
                if (!enemy_aircraft[j].alive || enemy_aircraft[j].in_hangar) continue;
                if (!enemy_aircraft[j].is_aircraft) continue;   /* ★ 只打载机 */
                if ((double)rand() / RAND_MAX < base_hit) {
                    double dmg = w->single_dmg * TUNE;
                    enemy_aircraft[j].current_hp -= dmg;
                    if (enemy_aircraft[j].current_hp <= 0) {
                        enemy_aircraft[j].current_hp = 0;       /* ★ clamp，原来会打穿成负数 */
                        enemy_aircraft[j].alive = 0;
                        if (enemy_aircraft[j].side[0] == 'a') bs->ally_aircraft_lost++;
                        else bs->enemy_aircraft_lost++;
                    }
                }
            }
        }
    }
}

/**
 * 维修系统处理
 * 1点护甲=0.25%维修加成 (上限150%)
 */
static void process_repairs(ShipInstance* ship, ShipInstance* friendlies,
                             int friend_count, double dt) {
    if (!ship->alive) return;
    int i;
    for (i = 0; i < ship->weapon_count; i++) {
        Weapon* w = &ship->weapons[i];
        if (w->repair_dpm <= 0) continue;
        /* 找最低血量友军 */
        ShipInstance* target = NULL;
        double lowest_pct = 2.0;
        int j;
        for (j = 0; j < friend_count; j++) {
            if (!friendlies[j].alive) continue;
            double pct = friendlies[j].current_hp / friendlies[j].max_hp;
            if (pct < lowest_pct && pct < 1.0) {
                lowest_pct = pct;
                target = &friendlies[j];
            }
        }
        if (target) {
            double heal = calc_repair_amount(w->repair_dpm, target->physical_armor, dt, 0);
            target->current_hp = fmin(target->max_hp, target->current_hp + heal);
        }
    }
}

/**
 * 系统修复计时器 - 25秒后恢复
 * 主武器2次/机库2次/指挥3次/推进0次 (L55-62)
 */
static void process_system_repairs(ShipInstance* ship, double dt) {
    int i;
    for (i = 0; i < 4; i++) {
        if (ship->subsystems[i].destroyed && !ship->subsystems[i].permanent_destroyed) {
            ship->subsystems[i].repair_timer -= dt;
            if (ship->subsystems[i].repair_timer <= 0) {
                ship->subsystems[i].repair_count++;
                int max_repairs;
                switch (i) {
                    case MAIN_WEAPON: max_repairs = SYS_MAIN_WEAPON_REPAIRS; break;
                    case HANGAR:      max_repairs = SYS_HANGAR_REPAIRS; break;
                    case COMMAND:     max_repairs = SYS_COMMAND_REPAIRS; break;
                    case PROPULSION:  max_repairs = SYS_PROPULSION_REPAIRS; break;
                    default: max_repairs = 1;
                }
                if (ship->subsystems[i].repair_count <= max_repairs) {
                    ship->subsystems[i].destroyed = 0;
                    ship->subsystems[i].current_hp = ship->subsystems[i].max_hp;
                } else {
                    ship->subsystems[i].permanent_destroyed = 1;
                }
            }
        }
    }
}

/**
 * 分伤机制分配 (L339)
 */
static int get_attackable_targets(ShipInstance* enemies, int enemy_count) {
    int alive = 0;
    int i;
    for (i = 0; i < enemy_count; i++) if (enemies[i].alive) alive++;
    return calc_attackable_targets(alive);
}

/**
 * 执行一个时间步长 (0.1秒)
 */
static int simulate_tick(BattleState* bs, double dt) {
    if (bs->ended) return 1;

    bs->time += dt;

    /* 更新护航状态 */
    bs->ally_escort_alive = 0;
    bs->enemy_escort_alive = 0;
    int i;
    for (i = 0; i < bs->ally_count; i++) {
        if (bs->ally_ships[i].alive && bs->ally_ships[i].is_escort)
            bs->ally_escort_alive = 1;
    }
    for (i = 0; i < bs->enemy_count; i++) {
        if (bs->enemy_ships[i].alive && bs->enemy_ships[i].is_escort)
            bs->enemy_escort_alive = 1;
    }

    /* 收集存活舰船 */
    ShipInstance* ally_alive = malloc(bs->ally_count * sizeof(ShipInstance));
    int ally_alive_count = 0;
    for (i = 0; i < bs->ally_count; i++) {
        if (bs->ally_ships[i].alive && !bs->ally_ships[i].is_aircraft)
            ally_alive[ally_alive_count++] = bs->ally_ships[i];
    }
    ShipInstance* enemy_alive = malloc(bs->enemy_count * sizeof(ShipInstance));
    int enemy_alive_count = 0;
    for (i = 0; i < bs->enemy_count; i++) {
        if (bs->enemy_ships[i].alive && !bs->enemy_ships[i].is_aircraft)
            enemy_alive[enemy_alive_count++] = bs->enemy_ships[i];
    }

    /* 处理每艘舰船的武器 */
    for (i = 0; i < bs->ally_count; i++) {
        if (bs->ally_ships[i].is_aircraft)
            process_aircraft(&bs->ally_ships[i], bs->enemy_ships, bs->enemy_count, bs, dt);
        else
            process_ship_weapons(&bs->ally_ships[i], bs->enemy_ships, bs->enemy_count, bs, dt);
    }
    for (i = 0; i < bs->enemy_count; i++) {
        if (bs->enemy_ships[i].is_aircraft)
            process_aircraft(&bs->enemy_ships[i], bs->ally_ships, bs->ally_count, bs, dt);
        else
            process_ship_weapons(&bs->enemy_ships[i], bs->ally_ships, bs->ally_count, bs, dt);
    }

    /* 防空处理 */
    for (i = 0; i < bs->ally_count; i++) {
        if (!bs->ally_ships[i].is_aircraft)
            process_antiair(&bs->ally_ships[i], bs->enemy_ships, bs->enemy_count, bs, dt);
    }
    for (i = 0; i < bs->enemy_count; i++) {
        if (!bs->enemy_ships[i].is_aircraft)
            process_antiair(&bs->enemy_ships[i], bs->ally_ships, bs->ally_count, bs, dt);
    }

    /* 维修处理 */
    for (i = 0; i < bs->ally_count; i++)
        process_repairs(&bs->ally_ships[i], bs->ally_ships, bs->ally_count, dt);
    for (i = 0; i < bs->enemy_count; i++)
        process_repairs(&bs->enemy_ships[i], bs->enemy_ships, bs->enemy_count, dt);

    /* 系统修复 */
    for (i = 0; i < bs->ally_count; i++)
        process_system_repairs(&bs->ally_ships[i], dt);
    for (i = 0; i < bs->enemy_count; i++)
        process_system_repairs(&bs->enemy_ships[i], dt);

    free(ally_alive);
    free(enemy_alive);

    /* 检查胜负 */
    int ally_has = 0, enemy_has = 0;
    for (i = 0; i < bs->ally_count; i++) {
        if (bs->ally_ships[i].alive && !bs->ally_ships[i].is_aircraft)
            ally_has = 1;
    }
    for (i = 0; i < bs->enemy_count; i++) {
        if (bs->enemy_ships[i].alive && !bs->enemy_ships[i].is_aircraft)
            enemy_has = 1;
    }
    if (!ally_has) { bs->ended = 1; bs->winner = 2; }
    if (!enemy_has) { bs->ended = 1; bs->winner = 1; }
    return bs->ended;
}

/**
 * 运行完整模拟
 */
void run_battle(BattleState* bs, double max_time, double dt) {
    while (!bs->ended && bs->time < max_time) {
        simulate_tick(bs, dt);
    }
}

/* ==================== 外部语言调用接口（C ABI） ==================== */

/*
 * ★ 2026-10-11 新增：简化战斗入口，给 Python ctypes / 其它语言直接调用。
 * 每艘舰用 4 个 double 描述：hp, physical_armor, shield_pct, single_dmg
 * （武器统一构造为：直射/不可拦截/2轮×3发/锁定3s/冷却12s/命中50-70%/可暴击15%×1.5）
 *
 * out_report 至少 8 个 double，写回：
 *   [0] winner(1=ally 2=enemy 0=未决)   [1] 战斗时长(秒)
 *   [2] 我方总伤害                      [3] 敌方总伤害
 *   [4] 我方损失舰数                    [5] 敌方损失舰数
 *   [6] 我方剩余总HP                    [7] 敌方剩余总HP
 *
 * 返回 8（写入的元素个数）；参数非法返回 -1。
 */
int lagrange_battle_simple(int ally_n, const double* ally_stats,
                            int enemy_n, const double* enemy_stats,
                            double max_time, double* out_report) {
    if (ally_n <= 0 || enemy_n <= 0 || !ally_stats || !enemy_stats || !out_report)
        return -1;
    if (ally_n > 64 || enemy_n > 64) return -1;

    ShipInstance allies[64], enemies[64];
    int i, k;
    for (i = 0; i < ally_n; i++) {
        memset(&allies[i], 0, sizeof(ShipInstance));
        snprintf(allies[i].id, sizeof(allies[i].id), "A%d", i + 1);
        snprintf(allies[i].name, sizeof(allies[i].name), "ally-%d", i + 1);
        snprintf(allies[i].side, sizeof(allies[i].side), "%s", "ally");
        allies[i].position = (i == 0) ? FRONT : MID;
        allies[i].max_hp = ally_stats[i * 4 + 0];
        allies[i].current_hp = allies[i].max_hp;
        allies[i].physical_armor = ally_stats[i * 4 + 1];
        allies[i].energy_shield_pct = ally_stats[i * 4 + 2];
        allies[i].evasion = 5.0;
        allies[i].alive = 1;
    }
    for (i = 0; i < enemy_n; i++) {
        memset(&enemies[i], 0, sizeof(ShipInstance));
        snprintf(enemies[i].id, sizeof(enemies[i].id), "E%d", i + 1);
        snprintf(enemies[i].name, sizeof(enemies[i].name), "enemy-%d", i + 1);
        snprintf(enemies[i].side, sizeof(enemies[i].side), "%s", "enemy");
        enemies[i].position = (i == 0) ? FRONT : MID;
        enemies[i].max_hp = enemy_stats[i * 4 + 0];
        enemies[i].current_hp = enemies[i].max_hp;
        enemies[i].physical_armor = enemy_stats[i * 4 + 1];
        enemies[i].energy_shield_pct = enemy_stats[i * 4 + 2];
        enemies[i].evasion = 5.0;
        enemies[i].alive = 1;
    }

    /* 每舰一门统一武器（单发值取输入的第 4 个字段） */
    Weapon ally_w[64], enemy_w[64];
    for (i = 0; i < ally_n; i++) {
        memset(&ally_w[i], 0, sizeof(Weapon));
        snprintf(ally_w[i].name, sizeof(ally_w[i].name), "main-gun");
        ally_w[i].dmg_type = PHYSICAL;
        ally_w[i].weapon_type = DIRECT_FIRE;
        ally_w[i].single_dmg = ally_stats[i * 4 + 3];
        ally_w[i].attacks = 2; ally_w[i].ammo = 3;
        ally_w[i].atk_duration = 3.0; ally_w[i].lock_time = 3.0; ally_w[i].cooldown = 12.0;
        ally_w[i].hit_min = 50; ally_w[i].hit_max = 70;
        ally_w[i].can_crit = 1; ally_w[i].crit_rate = 0.15; ally_w[i].crit_dmg = 1.5;
        ally_w[i].cannot_be_intercepted = 1; ally_w[i].sys_dmg_coeff = 1.0;
        allies[i].weapon_count = 1;
        allies[i].weapons = &ally_w[i];
        ship_instance_init(&allies[i]);
    }
    for (i = 0; i < enemy_n; i++) {
        memset(&enemy_w[i], 0, sizeof(Weapon));
        snprintf(enemy_w[i].name, sizeof(enemy_w[i].name), "main-gun");
        enemy_w[i].dmg_type = PHYSICAL;
        enemy_w[i].weapon_type = DIRECT_FIRE;
        enemy_w[i].single_dmg = enemy_stats[i * 4 + 3];
        enemy_w[i].attacks = 2; enemy_w[i].ammo = 3;
        enemy_w[i].atk_duration = 3.0; enemy_w[i].lock_time = 3.0; enemy_w[i].cooldown = 12.0;
        enemy_w[i].hit_min = 50; enemy_w[i].hit_max = 70;
        enemy_w[i].can_crit = 1; enemy_w[i].crit_rate = 0.15; enemy_w[i].crit_dmg = 1.5;
        enemy_w[i].cannot_be_intercepted = 1; enemy_w[i].sys_dmg_coeff = 1.0;
        enemies[i].weapon_count = 1;
        enemies[i].weapons = &enemy_w[i];
        ship_instance_init(&enemies[i]);
    }

    BattleState bs;
    memset(&bs, 0, sizeof(bs));
    bs.ally_ships = allies; bs.ally_count = ally_n;
    bs.enemy_ships = enemies; bs.enemy_count = enemy_n;
    bs.mode = BATTLE_ESCORT;
    bs.bomb_distance = 15.0;

    run_battle(&bs, max_time > 0 ? max_time : 600.0, 0.1);

    double ally_hp_left = 0.0, enemy_hp_left = 0.0;
    for (k = 0; k < ally_n; k++) ally_hp_left += allies[k].current_hp;
    for (k = 0; k < enemy_n; k++) enemy_hp_left += enemies[k].current_hp;

    out_report[0] = (double)bs.winner;
    out_report[1] = bs.time;
    out_report[2] = bs.total_ally_dmg;
    out_report[3] = bs.total_enemy_dmg;
    out_report[4] = (double)bs.ally_ships_lost;
    out_report[5] = (double)bs.enemy_ships_lost;
    out_report[6] = ally_hp_left;
    out_report[7] = enemy_hp_left;
    return 8;
}
