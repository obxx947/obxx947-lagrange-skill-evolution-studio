//! 拉格朗日战斗引擎 · 基准测试
//!
//! 运行：`cargo bench`（需要先 `cargo build` 通过）
//! 说明：criterion 基准，输出到 target/criterion/。这里只测已在模块树里的 damage 公式；
//!       lagrange_battle 完整引擎的基准在它接入 lib.rs 后再补。
use battle_engine_rs::damage;
use criterion::{criterion_group, criterion_main, Criterion};

fn bench_damage_formulas(c: &mut Criterion) {
    c.bench_function("energy_damage", |b| {
        b.iter(|| damage::calc_energy_damage(500.0, 10.0, 0.15, 1.0))
    });
    c.bench_function("physical_damage", |b| {
        b.iter(|| damage::calc_physical_damage(300.0, 20.0, 0.0, 1.0, 0.0))
    });
    c.bench_function("estimate_dps", |b| {
        b.iter(|| {
            damage::estimate_dps(400.0, 2, 3, 12.0, 3.0, 0.75, 0.15, 1.5, false, 20.0, 0.0)
        })
    });
    c.bench_function("crit_and_cooldown", |b| {
        b.iter(|| {
            let r = damage::calc_crit_rate(0.15, 0.10);
            let cd = damage::calc_final_cooldown(12.0, 0.20, 1.0);
            r + cd
        })
    });
}

criterion_group!(benches, bench_damage_formulas);
criterion_main!(benches);
