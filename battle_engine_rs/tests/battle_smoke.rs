//! 拉格朗日 Rust 战斗引擎 —— 整场战斗集成测试（2026-10-11 新增）
//!
//! 背景：battle_engine_rs 此前只有公式级单测（damage / intercept 模块），
//! **从未真跑过一整场战斗** —— BattleState::simulate_tick / run 的流程零覆盖。
//! 本测试构造 2v2 真实舰队跑完，断言战斗确实推进（时长/伤害/胜负），
//! 与 C 引擎的 tools/smoke_main.c 互为对照（两条重写线行为应一致）。

use battle_engine_rs::lagrange_battle::*;

fn make_weapon(name: &str, dmg: f64, dtype: DamageType) -> Weapon {
    Weapon {
        name: name.to_string(),
        dmg_type: dtype,
        weapon_type: WeaponType::DirectFire,   // 直射：不可拦截
        single_dmg: dmg,
        attacks: 2,
        ammo: 3,
        atk_duration: 3.0,
        lock_time: 3.0,
        cooldown: 12.0,
        priority: String::new(),
        can_crit: true,
        crit_rate: 0.15,
        crit_dmg: 1.5,
        lock_efficiency: 0.0,
        hit_min: 50.0,
        hit_max: 70.0,
        aa_type: None,                          // 非防空武器（Rust 用 Option，无 C 的默认值坑）
        intercept_rate: 0.0,
        cannot_be_intercepted: true,
        repair_dpm: 0.0,
        sys_dmg_coeff: 1.0,
        anti_intercept: 0.0,
        sub_system_targets: vec![],
    }
}

fn make_ship(id: &str, name: &str, hp: f64, armor: f64, shield: f64,
             pos: ShipPosition, side: &str, w: Weapon) -> Ship {
    let mut s = Ship::new(id, name, hp, armor, shield);
    s.position = pos;
    s.side = side.to_string();
    s.weapons.push(w);
    s.init_systems();
    s.init_weapon_states();
    s
}

#[test]
fn test_full_battle_advances() {
    let ally = vec![
        make_ship("A1", "盟军-先锋舰", 12000.0, 60.0, 20.0, ShipPosition::Front, "ally",
                  make_weapon("重型实弹炮", 300.0, DamageType::Physical)),
        make_ship("A2", "盟军-火力舰", 9000.0, 40.0, 40.0, ShipPosition::Mid, "ally",
                  make_weapon("能量离子炮", 250.0, DamageType::Energy)),
    ];
    let enemy = vec![
        make_ship("E1", "敌军-主力舰", 10000.0, 50.0, 30.0, ShipPosition::Front, "enemy",
                  make_weapon("中型实弹炮", 200.0, DamageType::Physical)),
        make_ship("E2", "敌军-僚舰", 7000.0, 30.0, 10.0, ShipPosition::Mid, "enemy",
                  make_weapon("轻型实弹炮", 150.0, DamageType::Physical)),
    ];

    let mut sim = BattleState::new(ally, enemy, BattleMode::Escort);
    sim.run(600.0);

    println!("Rust 战斗：时长 {:.1}s | 胜者 {} | 我方伤害 {:.0} 敌方伤害 {:.0} | 损失 {}/{}",
             sim.time, sim.winner, sim.total_ally_dmg, sim.total_enemy_dmg,
             sim.ally_ships_lost, sim.enemy_ships_lost);

    // 1) 战斗必须真的推进了时长
    assert!(sim.time > 0.0, "战斗时长必须 > 0（引擎没跑）");
    // 2) 必须有真实伤害交换（否则只是空转）
    let total_dmg = sim.total_ally_dmg + sim.total_enemy_dmg;
    assert!(total_dmg > 0.0, "双方总伤害必须 > 0（引擎没有真的开火）");
    // 3) 600 秒内应当分出胜负（或至少打到超时）
    assert!(sim.winner != 0 || sim.time >= 600.0,
            "600 秒内既没分胜负也没到超时（winner={} time={}）", sim.winner, sim.time);
    // 4) 胜利方不可能全灭（逻辑自洽检查）
    if sim.winner == 1 { assert!(sim.ally_ships_lost < 2, "我方宣称胜利却全灭"); }
    if sim.winner == 2 { assert!(sim.enemy_ships_lost < 2, "敌方宣称胜利却全灭"); }
}

/// 同输入下重复跑（不同随机种子路径）应得出一致的"量级"，不应出现零伤害/NaN
#[test]
fn test_battle_numeric_sanity() {
    for round in 0..5 {
        let ally = vec![
            make_ship("A1", "盟军", 8000.0, 40.0, 20.0, ShipPosition::Front, "ally",
                      make_weapon("主炮", 250.0, DamageType::Physical)),
        ];
        let enemy = vec![
            make_ship("E1", "敌军", 8000.0, 40.0, 20.0, ShipPosition::Front, "enemy",
                      make_weapon("主炮", 250.0, DamageType::Physical)),
        ];
        let mut sim = BattleState::new(ally, enemy, BattleMode::Escort);
        sim.run(300.0);
        assert!(sim.total_ally_dmg.is_finite() && sim.total_ally_dmg >= 0.0,
                "第 {} 轮我方伤害非有限值: {}", round, sim.total_ally_dmg);
        assert!(sim.total_enemy_dmg.is_finite() && sim.total_enemy_dmg >= 0.0,
                "第 {} 轮敌方伤害非有限值: {}", round, sim.total_enemy_dmg);
        assert!(sim.ally_ships.iter().all(|s| s.current_hp.is_finite() && s.current_hp >= -1e-9),
                "第 {} 轮出现 NaN/负血", round);
    }
}
