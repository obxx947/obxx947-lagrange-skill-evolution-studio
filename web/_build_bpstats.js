/* 生成 data/blueprint_stats.json（v4）
   ---------------------------------------------------------------
   v4 相比 v3 的变化（2026-09-19）：把几个「一个桶装好几种语义」的属性拆开。
   起因：全量复核发现这些桶里的说明方向/对象根本不同，合成一个数字再用是错的。

     hitBonus(789)    → hitBonus 我方命中提升(648) / enemyHitDown 被命中率下降(77) / 其他
                        ⚠️ 原来 77 个防御向被当成「我方命中」用，方向是反的
     lockEfficiency   → lockEfficiency 系统内防空锁定效率↑ / aaLockDown 自身受防空锁定效率↓
     hangarModule(475)→ 按效果拆成 6 个：伤害 / 命中 / 闪避 / 锁定目标时间 / 武器冷却 / 飞行时间
                        （原来 6 种效果全塞进一个 hangarModule）
     hangarBonus(264) → 同样按效果拆成 本舰船机库 的 6 个 + 受防空锁定下降
     repairBonus(84)  → repairEff 维修效率(%) / repairArmor 一次性维修装甲(+N 点，不是百分比!)

   ⚠️ 分组的唯一定义在下面的 GROUPS，写进 blueprint_stats.json 的 groups 字段。
      addpoint.html 与 simulator.html 都【读这个字段】，不再各自硬编码 —— v3 之前
      「新增字段要同时改三处、漏一处静默失效」的坑就是这么来的。

   v3 保留：
     ① 人工确认译表 DECODED（{EDxxxx} 术语代号）
     ② 多参数解析：数值数组里【已在说明文字出现过的】数（硬编码阈值/轮数/秒数）先剔除，
        剩下的按顺序配给占位符，再按属性关键词找它附近那个占位符取数。
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const bp = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_all.json', 'utf8'));

/* ===== 人工确认译表 ===== */
const DECODED = {
  '{ED9142}': {
    text: '本系统机库内舰载机有{A}%的概率造成{B}%的暴击伤害',
    cols: ['hangarModuleCritRate', 'hangarModuleCritDmg'],
    scope: 'hangarModule',
    confirmedBy: '玩家口述 2026-09-19'
  }
};

/* 顺序敏感：机库/载机 必须排在 命中/伤害/闪避 之前，否则会被抢走 */
const RULES = [
  /* ================= 非战斗：舰队/星系/补给/运营 =================
     这些跟"1v1 战斗"无关（星系航行、战略打击、资源运营、登陆接管），
     不统计进战斗分母，也不该被后面的"伤害/命中/冷却"规则抢走。
     ⚠️ 必须排在最前面。 */
  [/补给速度|自持指挥值|引导目标数|打击距离|战略打击|封锁|驻守|视野增加|行动力|计划圈|吉米|作业效率|仓储|采集|采矿|对接权限|同小队|联合体|巡游|每日|资源点|主目标之外|副目标|支援舰生产/, 'fleetOps'],
  [/常规移动速度|亚光速|曲率速度|航行速度|前进速度提升|移动速度提升/, 'speed'],
  /* ---- 「优先派出载机/无人机攻击，并缩短其攻击持续时间」：效果落在武器持续 ---- */
  [/(载机|舰载机|无人机)[^，。]{0,20}攻击持续时间(缩短|降低|减少)/, 'weaponDuration'],
  /* 「舰队指挥值低于X」「指挥值规模超出」是编队/星系层面；但「舰队内XX舰船…」在 1v1 里就是自己，属战斗 */
  [/舰队指挥值低于|指挥值规模超出|无法主动撤退/, 'fleetOps'],
  /* ---- 两列型：机库内载机主武器「X%概率额外造成Y%暴击伤害」---- */
  [/攻击将有(\{[^}]+\}|\d+)%概率额外造成(\{[^}]+\}|\d+)%暴击伤害/, 'critPair'],
  /* ---- 支援舰生产的舰载机 —— 运营层，非战斗 ---- */
  [/生产的舰载机/, 'fleetOps'],
  /* ---- 指挥舰「协同指挥」 ---- */
  [/指挥舰队中(\{[^}]+\}|\d+)个[^，。]*主武器/, 'cmdAssist'],
  /* ---- 三种「打击」 ---- */
  [/选择敌方防空能力最高/, 'strikeAA'],
  [/选择敌方血量较低/, 'strikeWeak'],
  [/选择敌方物理抵挡最高/, 'strikeTank'],
  /* ================= 机库：先按【作用域】再按【效果】拆 =================
     本舰船机库 = 全舰所有载机；本系统机库 = 只有该模块机位上的载机
     ⚠️ 必须带「机库内」限定：不然「来自舰载机的攻击对自身的命中率下降」这种
        描述敌方攻击的句子会被吞进机库（v4 第一版就踩了，47 个节点判错）。 */
  [/本系统机库内|本系统.{0,4}机库/, '__HK__'],
  [/本舰船机库内|本舰船.{0,4}机库/, '__HS__'],
  [/机库内(载机|舰载机|无人机)/, '__HS__'],
  /* 兜底：只说「载机/舰载机/无人机」且是在讲【它们的属性】时，才算本舰船机库 */
  [/(载机|舰载机|无人机)[^，。]{0,10}(伤害|命中|闪避|冷却|飞行时间|选择目标|锁定)/, '__HS__'],
  [/提升本舰船|本舰船.{0,4}(载机|无人机)/, '__HS__'],
  /* ---- 武器分散/集中打击：⚠️ 文本里是 {101} 占位符，不是阿拉伯数字，\d+ 匹配不到 ---- */
  [/分散打击(\{[^}]+\}|\d+)个目标/, 'multiTarget'],
  [/集中打击(\{[^}]+\}|\d+)个目标/, 'focusTargets'],
  [/下一轮(?:可)?额外对(\{[^}]+\}|\d+)个目标/, 'multiTarget'],
  /* ---- 武器持续时间 / 攻击次数（⚠️ 原文用「延长/缩短」，不止「提升」）
         ⚠️ 不能只写「持续时间提升」—— 会把「干扰效果/护盾效果/防护效果持续时间提升」也吞进来，
            那是状态持续时间，不是武器攻击持续时间。必须限定到 攻击/打击/射击/系统武器。 */
  [/系统内武器输出时间降低|系统武器输出时间降低/, 'atkReduction'],
  [/(?:缩短|降低|减少)[^，。]{0,24}(?:攻击|打击)持续时间|(?:攻击|打击|射击)持续时间(?:延长|缩短|降低|提升)|系统(?:内)?武器持续时间/, 'weaponDuration'],
  [/攻击次数(?:增加|提升|\+)/, 'weaponDuration'],
  /* ---- 被拦截概率降低 / 反拦截 ---- */
  [/被拦截概率降低|被拦截率下降|拦截率下降/, 'antiIntercept'],
  /* ---- 锁定效率 ≠ 锁定减免；且要区分「提升我方」与「被敌方锁定下降」 ---- */
  [/受防空武器锁定效率影响下降/, 'aaLockDown'],
  [/锁定效率/, 'lockEfficiency'],
  /* 掩护 */
  [/掩护时间延长|掩护目标数上限|掩护所有前排|提供掩护/, 'cover'],
  /* 周期性爆发 */
  [/每.{0,4}秒时?，缩短系统主武器/, 'burst'],
  /* 两列型暴击 */
  [/概率额外造成.{0,6}暴击伤害/, 'critPair'],
  /* ---- 其它明确可做的机制 ---- */
  [/攻击次数[×x]2|系统内武器攻击次数|密集射击/, 'denseFire'],
  [/对导弹\/鱼雷拦截率|获得对导弹.{0,4}拦截率/, 'sysIntercept'],
  [/攻城/, 'siege'],
  /* 维修：先分「装甲点数」和「效率百分比」 */
  [/一次性维修装甲/, 'repairArmor'],
  [/维修/, 'repairEff'],
  /* ★ 被命中率下降必须在「命中」之前判，否则会被 hitBonus 抢走（原来 77 个就是这么错的） */
  [/被.{0,6}命中率下降|被.{0,6}命中率降低|降低被.{0,6}命中率|命中率下降|命中率降低/, 'enemyHitDown'],
  [/命中/, 'hitBonus'],
  [/闪避/, 'evasion'],
  [/拦截/, 'interceptRate'],
  [/冷却时间下降|冷却时间减少|冷却时间降低|冷却缩减|武器冷却/, 'cooldownReduction'],
  [/锁定|选择目标时间/, 'lockReduction'],
  [/暴击/, 'crit'],
  [/物理伤害抵抗|物理抵抗|物理护甲/, 'physResist'],
  [/能量伤害抵抗|能量抵抗|能量抗性|护盾值/, 'energyResist'],
  [/舰船血量|血量提升|血量提高|结构值|装甲防御效果/, 'hp'],
  [/系统血量/, 'sysHp'],
  [/(火炮|导弹|鱼雷|脉冲炮|离子炮|轨道炮|伤害提升|伤害提高|炮伤害|武器伤害|单发)/, 'singleDmg'],
  [/受到系统伤害降低/, 'sysDmgReduce'],
  [/本舰船主武器优先打击|主武器优先打击/, 'targetPriority'],
  [/站位调整为|舰船站位调整|优先锁定前排/, 'positionFix'],
  [/系统伤害降低|受到系统伤害/, 'sysDamageReduce'],
  [/打击间隔|打击和冷却/, 'atkReduction'],
  [/弹药|多目标|优先攻击|攻击次数/, 'tactics'],
  [/指挥值|指挥系统|舰队/, 'fleet'],
  [/侦察|探测|隐身|隐蔽|伪装|识别为战机/, 'scout'],
  [/维修效果|自动维修效率|受维修/, 'repairEff'],
  [/速度/, 'speed'],
  [/掩护|仓储|站位|撤退|护盾|作业效率|溶解|干扰效果|防护效果/, 'special'],
];

/* 机库效果细分：把一条机库说明判到「哪一个效果」上。
   ⚠️ 认不出就返回空数组，让上层归到「未归类」——不许默认当成伤害。
      （v4 第一版就是兜底 return ['Dmg']，把「基础移速提升」「编队均摊伤害」都当成了伤害。） */
function hangarEffect(t) {
  if (/主武器冷却时间减少|武器冷却时间减少|冷却时间减少/.test(t) && /飞行时间/.test(t)) return ['Cd', 'Flight'];
  if (/飞行时间/.test(t) && !/冷却/.test(t)) return ['Flight'];
  if (/冷却时间减少|冷却时间下降|冷却时间降低/.test(t)) return ['Cd'];
  if (/选择目标时间|锁定目标速度|锁定时间/.test(t)) return ['Lock'];
  if (/闪避/.test(t)) return ['Evasion'];
  if (/命中率提升|命中提升|命中率提高/.test(t)) return ['Hit'];
  if (/受防空武器锁定效率影响下降|无视敌方防空武器提前锁定/.test(t)) return ['AaResist'];
  if (/伤害提高|伤害提升|伤害增加|攻城伤害/.test(t)) return ['Dmg'];
  return [];                                  // 移速 / 编队 / 其它没实现的 → 不猜
}
/* 机库 + 效果 → 具体属性名 */
function hangarStat(scopeTag, eff) {
  const pre = scopeTag === '__HK__' ? 'hangarModule' : 'hangar';
  if (eff === 'Dmg' && scopeTag === '__HS__') return 'hangarDmg';
  if (eff === 'AaResist') return 'hangarAaResist';
  return pre + eff;                      // hangarModuleHit / hangarHit / hangarModuleCd ...
}

/* ===== 分组的唯一定义（写进 json，页面与引擎都读它）===== */
const GROUPS = {
  /* 舰船级·攻击向：作用于本舰武器 */
  attack: ['singleDmg', 'cooldownReduction', 'crit', 'critDmg', 'lockReduction', 'atkReduction',
           'hitBonus', 'lockEfficiency', 'antiIntercept'],
  /* 舰船级·防御向：作用于本舰受击 */
  defense: ['hp', 'physResist', 'energyResist', 'evasion', 'interceptRate', 'enemyHitDown', 'aaLockDown', 'sysDmgReduce'],
  /* 只作用于【本系统的武器】 */
  moduleOnly: ['multiTarget', 'focusTargets', 'denseFire', 'sysIntercept', 'positionFix'],
  /* 本舰船机库（全舰载机） */
  hangar: ['hangarDmg', 'hangarHit', 'hangarEvasion', 'hangarLock', 'hangarCd', 'hangarFlight',
           'hangarAaResist', 'hangarCritRate', 'hangarCritDmg'],
  /* 本系统机库（仅该模块机位上的载机） */
  hangarModule: ['hangarModuleDmg', 'hangarModuleHit', 'hangarModuleEvasion', 'hangarModuleLock',
                 'hangarModuleCd', 'hangarModuleFlight', 'hangarModuleCritRate', 'hangarModuleCritDmg'],
  /* 其它（不进自动汇总，但也不算未实现） */
  misc: ['siege', 'repairEff', 'repairArmor', 'sysHp', 'weaponDuration'],
  /* 非战斗：星系/航行/运营 —— 不统计进战斗分母 */
  noncombat: ['speed', 'fleetOps'],
  /* 手填覆盖位（玩家在加点页手动追加） */
  manual: ['siege', 'repairBonus', 'hitBonus', 'hangarBonus', 'repairEff', 'hp', 'physResist',
           'energyResist', 'dmgBonus', 'crit', 'lockReduction', 'cooldownReduction', 'singleDmg',
           'evasion', 'interceptRate', 'hitBonus', 'enemyHitDown', 'lockEfficiency', 'aaLockDown',
           'sysDmgReduce', 'antiIntercept', 'multiTarget', 'atkReduction'],
};
const ALL_NUM = new Set([].concat(GROUPS.attack, GROUPS.defense, GROUPS.moduleOnly, GROUPS.hangar,
  GROUPS.hangarModule, GROUPS.misc));

const CN = {
  hp: '结构值', physResist: '物理抵抗', energyResist: '能量抗性', dmgBonus: '伤害加成', crit: '暴击',
  critDmg: '暴击伤害', lockReduction: '锁定减免', cooldownReduction: '冷却减免', singleDmg: '单发伤害',
  evasion: '闪避', interceptRate: '拦截率', siege: '攻城伤害', repairBonus: '维修量加成(手填)',
  hitBonus: '命中加成', hangarBonus: '机库加成(手填)',
  enemyHitDown: '被命中率下降', aaLockDown: '受防空锁定效率影响下降',
  antiIntercept: '反拦截', sysDmgReduce: '受系统伤害降低', lockEfficiency: '锁定效率(加命中)',
  denseFire: '密集射击(攻击次数翻倍)', sysIntercept: '系统内导弹获得拦截率',
  multiTarget: '武器分散打击', atkReduction: '打击间隔缩短', positionFix: '站位调整',
  repairEff: '维修效率', repairArmor: '一次性维修装甲', sysHp: '系统血量', weaponDuration: '攻击持续时间',
  hangarDmg: '本舰船机库·载机伤害', hangarHit: '本舰船机库·载机命中', hangarEvasion: '本舰船机库·载机闪避',
  hangarLock: '本舰船机库·载机锁定时间', hangarCd: '本舰船机库·载机武器冷却',
  hangarFlight: '本舰船机库·载机飞行时间', hangarAaResist: '本舰船机库·载机抗防空锁定',
  hangarCritRate: '机库暴击率', hangarCritDmg: '机库暴击伤害',
  hangarModuleDmg: '本系统机库·伤害', hangarModuleHit: '本系统机库·命中', hangarModuleEvasion: '本系统机库·闪避',
  hangarModuleLock: '本系统机库·锁定时间', hangarModuleCd: '本系统机库·武器冷却',
  hangarModuleFlight: '本系统机库·飞行时间',
  hangarModuleCritRate: '本系统机库·暴击率', hangarModuleCritDmg: '本系统机库·暴击伤害',
  focusTargets: '武器集中打击', fleetOps: '舰队/星系/运营（非战斗）', targetPriority: '主武器优先打击', speed: '速度', sysDamageReduce: '系统减伤', interval: '打击间隔',
  tactics: '战术/弹药', fleet: '舰队/指挥', scout: '侦察/隐身', special: '特殊机制', unmapped: '未归类',
};

function classify(d) {
  if (!d) return null;
  for (const [re, t] of RULES) if (re.test(d)) return t;
  return 'unmapped';
}
/* ★ 一句话里写了【多个机制】的节点（用户 2026-09-25）：
   例「本系统机库内载机/无人机飞行时间和主武器冷却时间减少{101}%」
   —— 原来 RULES 首个匹配就返回，只拿到"飞行时间"，"主武器冷却"被丢掉。
   这里的规则是：**说明里出现的每个机制都吃同一个 {数值}**（太阳鲸那类原文就是"…和…减少{101}%"）。
   返回除主 stat 之外还要一并生效的那些。 */
const SIBLING = [
  [/(?=.*飞行时间)(?=.*冷却)/, { hangarFlight: 'hangarCd', hangarModuleFlight: 'hangarModuleCd' }],
  [/(?=.*(?:打击间隔|输出时间))(?=.*冷却)/, { atkReduction: 'cooldownReduction' }],
];
function extraStats(d, primary) {
  if (!d || !primary) return [];
  /* ⚠️ 只在【整句只有一个 {数值位}】时才按"同值"处理。
     反例：「主武器冷却时间减少{101}%，飞行时间减少{201}%」—— 两个机制、两个不同的数，
     按同值写会把其中一个写错。这类（含 2 个以上 {} 位）交给"多参数节点"那条路，这里不碰。 */
  if ((d.match(/\{[^}]+\}/g) || []).length > 1) return [];
  const out = [];
  for (const [re, map] of SIBLING) {
    if (!re.test(d)) continue;
    const sib = map[primary];
    if (sib && sib !== primary && out.indexOf(sib) < 0) out.push(sib);
  }
  return out;
}

const KEY = {
  hitBonus: /命中(?:率)?[^，。,；]{0,6}?(\{[^}]+\})/,
  enemyHitDown: /(?:命中率)[^，。,；]{0,4}?(\{[^}]+\})/,
  singleDmg: /(?:伤害|单发)[^，。,；]{0,6}?(\{[^}]+\})/,
  cooldownReduction: /冷却[^，。,；]{0,8}?(\{[^}]+\})/,
  lockReduction: /(?:锁定|选择目标时间)[^，。,；]{0,8}?(\{[^}]+\})/,
  evasion: /闪避(?:率)?[^，。,；]{0,6}?(\{[^}]+\})/,
  interceptRate: /拦截(?:率)?[^，。,；]{0,6}?(\{[^}]+\})/,
  crit: /暴击[^，。,；]{0,8}?(\{[^}]+\})/,
  repairEff: /维修[^，。,；]{0,10}?(\{[^}]+\})/,
  repairArmor: /装甲[^，。,；]{0,6}?(\{[^}]+\})/,
  siege: /攻城[^，。,；]{0,8}?(\{[^}]+\})/,
  hp: /(?:血量|结构)[^，。,；]{0,8}?(\{[^}]+\})/,
  physResist: /物理[^，。,；]{0,8}?(\{[^}]+\})/,
  energyResist: /能量[^，。,；]{0,8}?(\{[^}]+\})/,
  aaLockDown: /(?:\{[^}]+\})[^，。,；]{0,4}(?:下降|降低)|锁定效率[^，。,；]{0,8}?(\{[^}]+\})/,
  lockEfficiency: /锁定效率[^，。,；]{0,8}?(\{[^}]+\})/,
  /* --- v4 新拆出来的机库/武器类属性的取值位置 --- */
  hangarDmg: /伤害[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarModuleDmg: /伤害[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarHit: /命中[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarModuleHit: /命中[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarEvasion: /闪避[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarModuleEvasion: /闪避[^，。,；]{0,8}?(\{[^}]+\})/,
  hangarLock: /(?:选择目标时间|锁定目标速度|锁定时间)[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarModuleLock: /(?:选择目标时间|锁定目标速度|锁定时间)[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarCd: /冷却[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarModuleCd: /冷却[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarFlight: /飞行时间[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarModuleFlight: /飞行时间[^，。,；]{0,10}?(\{[^}]+\})/,
  hangarAaResist: /(?:\{[^}]+\})[^，。,；]{0,6}(?:下降|降低)|锁定效率[^，。,；]{0,10}?(\{[^}]+\})/,
  atkReduction: /(?:打击间隔|输出时间|打击和冷却时间)[^，。,；]{0,8}?(\{[^}]+\})/,
  antiIntercept: /被拦截率(?:下降|降低)[^，。,；]{0,8}?(\{[^}]+\})/,
  sysDmgReduce: /受到系统伤害降低[^，。,；]{0,8}?(\{[^}]+\})/,
  sysIntercept: /拦截率[^，。,；]{0,8}?(\{[^}]+\})/,
  multiTarget: /分散打击[^，。,；]{0,8}?(\{[^}]+\})/,
  denseFire: /装填冷却时间延长[^，。,；]{0,8}?(\{[^}]+\})/,
  sysHp: /(?:系统血量|系统耐久)[^，。,；]{0,8}?(\{[^}]+\})/,
  weaponDuration: /攻击次数(?:增加|提升)[^，。,；]{0,6}?(\{[^}]+\})|(?:攻击|打击|射击)?持续时间(?:延长|提升|缩短|降低)[^，。,；]{0,6}?(\{[^}]+\})|持续时间[^，。,；]{0,8}?(\{[^}]+\})/,
};
const num = v => { const f = parseFloat(v); return isNaN(f) ? null : f; };

/* ============ 条件触发识别 ============
   这批节点的效果不是开场就永久生效，而是【满足条件才触发】。识别不到就会算错
   （例：「自身结构比例降至50%时闪避+20%持续10秒，一场只触发一次」会被当成开局永久+20%）。
   kind：
     hpBelow      自身血量/结构比例低于 X%     → threshold
     enemyHpBelow 目标血量低于 X%（打敌方时）   → threshold
     battleStartSec 战斗开始后 X 秒内          → sec
     firstRounds  战斗开始后前 N 轮            → rounds
     everyRounds  每运行 P 轮后下一轮…         → every
     battleStart  战斗开始后（整场）            → 无参
   注意顺序：必须先判「前N轮」再判「战斗开始后」兜底，否则会被兜底抢走。 */
/* 条件里的数量可能是：{xxx} 占位符 / 阿拉伯数字 / 中文数字（"每运行一轮"）。都要吃。 */
const CN_NUM = { '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
const TOK = '(\\{[^}]+\\}|\\d+(?:\\.\\d+)?|[一两二三四五六七八九十])';

function detectCond(desc) {
  let m;
  if (m = desc.match(new RegExp('(?:自身)?(?:血量|结构(?:值)?比例)(?:首次)?(?:低于|下降至|降至)\\s*' + TOK + '\\s*%')))
    return { kind: 'hpBelow', tok: m[1] };
  if (m = desc.match(new RegExp('目标(?:结构比例|血量)(?:首次)?(?:低于|降至|下降至)\\s*' + TOK + '\\s*%')))
    return { kind: 'enemyHpBelow', tok: m[1] };
  if (m = desc.match(new RegExp('战斗开始(?:后|时)\\s*' + TOK + '\\s*秒')))
    return { kind: 'battleStartSec', tok: m[1] };
  if (m = desc.match(new RegExp('前\\s*' + TOK + '\\s*轮')))
    return { kind: 'firstRounds', tok: m[1] };
  if (m = desc.match(new RegExp('每(?:运行|连续对同一目标打击|隔|经过|工作|轮工作)?\\s*' + TOK + '\\s*轮')))
    return { kind: 'everyRounds', tok: m[1] };
  if (m = desc.match(new RegExp('每\\s*' + TOK + '\\s*秒')))
    return { kind: 'everySec', tok: m[1] };
  if (/战斗开始(?:后|时)/.test(desc)) return { kind: 'battleStart', tok: null };
  return null;
}
/* 条件持续时间 + 是否一场只触发一次 */
function detectCondMeta(desc) {
  const d = desc.match(/持续\s*(\{[^}]+\}|\d+(?:\.\d+)?)\s*秒/);
  const r = desc.match(/持续\s*(\{[^}]+\}|\d+(?:\.\d+)?)\s*轮/);
  return {
    durTok: d ? d[1] : null,
    durRoundTok: r ? r[1] : null,
    once: /一场战斗只|单场战斗只|只触发一次|只生效一次/.test(desc)
  };
}
/* ============ 舰队级机制识别 ============
   我们的模拟器有 4 个舰队：敌方护航A / 敌方被护航B / 我方护航C / 我方被护航D。
   「被多支舰队同时攻击」在这个结构里是真实存在的：
     被护航舰队被完全摧毁前，一般先打护航舰队 → C 是主目标、D 是副目标（我方同理）。
   所以「每存在1个副目标舰队…」= 敌方护航/被护航两支都还有船时算 1。
   玩家口述确认（2026-09-21）：
     · 多目标反击辅助  雷火在 A 被 C+D 打 → 副目标数 1 → 对主力舰命中 +25%
     · 多目标反击      雷火在 B 被 C+D 打 → 除完整打 C，还向 D 打 20/30/40%
     · 庇护作战        普鲁图斯在 A 被 C+D 打 → 减少来自 D 的 10/20/30% 伤害
     · 天权防线        同上逻辑，效果是维修效果提升
     · 切入作战        舰队不是主目标（即在被护航舰队里）→ 优先选血量最低的 N 个目标
   ⚠️ 前四类【必须是指定为旗舰才生效】，且该舰【指挥系统被摧毁后失效】。 */
function detectFleetMech(desc) {
  let m;
  if (m = desc.match(/舰队在被多支舰队同时攻击时，每存在1个副目标舰队，系统内武器对(.{2,4})命中提升/))
    return { kind: 'subTargetHit', vs: m[1], flagshipOnly: true };
  if (/舰队在被多支舰队同时攻击时，可对.{0,4}个副目标舰队发起反击/.test(desc))
    return { kind: 'counterSub', flagshipOnly: true };
  if (/当舰队同时受到多支舰队攻击时，所受作战主目标之外的.{0,4}支舰队伤害，将减少/.test(desc))
    return { kind: 'protectFromSub', flagshipOnly: true };
  if (/舰队被多支舰队同时攻击时，每多一支作战主目标之外的舰队/.test(desc))
    return { kind: 'repairBoost', flagshipOnly: true };
  if (/舰队不成为作战对象的主目标时/.test(desc))
    return { kind: 'cutInSub', flagshipOnly: false };
  return null;
}
/* 把条件里的 token 解成数值：写死的数字直接用；{xxx} 按"剔除文中已有数字后按顺序配位"的规则取 */
function condValue(desc, row, tok) {
  if (!tok) return null;
  const s = String(tok);
  if (CN_NUM[s] != null) return CN_NUM[s];           // 中文数字
  const lit = s.match(/^(\d+(?:\.\d+)?)$/);
  if (lit) return parseFloat(lit[1]);                // 写死的阿拉伯数字
  const phs = [...new Set(desc.match(/\{[^}]+\}/g) || [])];
  const i = phs.indexOf(s);
  if (i < 0) return null;
  const rest = stripInText(desc, row);
  if (rest.length !== phs.length) return null;
  return num(rest[i]);
}

function stripInText(desc, row) {
  const pool = (desc.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const rest = [];
  row.forEach(v => {
    const i = pool.indexOf(Number(v));
    if (i >= 0) pool.splice(i, 1); else rest.push(v);
  });
  return rest;
}
function statValueAt(node, stat, level) {
  const row = (node.levelValue || [])[level];
  if (!row || !row.length) return null;
  const desc = node.baseDesc || '';
  const phs = [...new Set(desc.match(/\{[^}]+\}/g) || [])];
  if (!phs.length) return null;
  if (phs.length === 1 && row.length === 1) return num(row[0]);
  const rest = stripInText(desc, row);
  if (rest.length !== phs.length) return null;
  const map = {}; phs.forEach((p, i) => { map[p] = rest[i]; });
  const re = KEY[stat]; if (!re) return null;
  const m = desc.match(re); if (!m) return null;
  const tok = m[1] || m[2];
  return (tok in map) ? num(map[tok]) : null;
}

const out = { generatedAt: Date.now(), version: 4, groups: GROUPS, labels: CN, decoded: DECODED, nodes: {} };
let stat = {}, multiOk = 0, multiFail = 0, singleOk = 0, pureRef = 0, decodedCnt = 0, hangarSplit = {}, condCnt = 0;

bp.forEach(r => r.systems.forEach(y => y.nodes.forEach(n => {
  if (!n.name) { out.nodes[n.id] = { empty: true }; return; }
  let s = classify(n.baseDesc);
  /* ★ 一句说明写多个机制的，除主 stat 外再补上（吃同一个 {数值}）——用户 2026-09-25 */
  const _extra = extraStats(String(n.baseDesc || ''), s);
  const desc = n.baseDesc || '';
  /* 机库类：按作用域 + 效果算出具体属性名；认不出效果就不归类 */
  if (s === '__HK__' || s === '__HS__') {
    const effs = hangarEffect(desc);
    if (!effs.length) s = /移速|移动速度/.test(desc) ? 'speed' : 'unmapped';
    else if (effs.length === 2) s = hangarStat(s, effs[1]);
    else s = hangarStat(s, effs[0]);
  }
  stat[s] = (stat[s] || 0) + 1;

  let tok = null, decoded = null;
  if (/^\{[A-Za-z]+\d+\}$/.test(desc.trim())) {
    tok = desc.trim();
    decoded = DECODED[tok] || null;
    if (decoded) decodedCnt++; else pureRef++;
  }

  const addable = decoded ? true : (ALL_NUM.has(s) && !tok);
  const per = (n.levelValue || []).map(v => (Array.isArray(v) ? num(v[0]) : null));
  const rec = {
    stat: decoded ? decoded.cols[0] : s,
    addable: addable,
    perLevel: per,
    multi: (n.levelValue && n.levelValue[0] && n.levelValue[0].length > 1) ? n.levelValue[0].length : 1
  };
  if (tok && !decoded) { rec.pureRef = tok; rec.addable = false; }

  const d = rec.stat;
  if (decoded) {
    const m = {};
    decoded.cols.forEach((col, ci) => {
      m[col] = (n.levelValue || []).map(v => (Array.isArray(v) && typeof num(v[ci]) === 'number') ? num(v[ci]) : null);
    });
    rec.statMap = m; rec.decodedText = decoded.text;
  } else if (s === 'cover') {
    const v = ((n.levelValue || [])[1] || [])[0];
    const vn = num(v);
    if (/掩护所有|掩护前排/.test(desc)) rec.mechanic = { kind: 'coverBase', dur: vn, all: true, text: desc.slice(0, 34) };
    else if (/掩护时间延长/.test(desc)) rec.mechanic = { kind: 'coverDurAdd', add: vn, text: desc.slice(0, 24) };
    else if (/掩护目标数上限/.test(desc)) rec.mechanic = { kind: 'coverTargetsAdd', add: vn, text: desc.slice(0, 24) };
    else rec.mechanic = { kind: 'coverMisc', text: desc.slice(0, 34) };
    rec.addable = false; rec.isMechanic = true;
  } else if (s === 'burst') {
    const lv1 = (n.levelValue || [])[1] || [];
    rec.mechanic = {
      kind: 'burst', cut: num(lv1[0]), dur: num(lv1[1]), cd: num(lv1[2]),
      every: (desc.match(/每\s*\{?[^}\s]{1,6}\}?\s*秒时/) ? num(lv1[3]) : null), text: desc.slice(0, 40)
    };
    rec.addable = false; rec.isMechanic = true;
  } else if (s === 'critPair') {
    const m = {};
    m.crit = (n.levelValue || []).map(v => Array.isArray(v) ? num(v[0]) : null);
    m.critDmg = (n.levelValue || []).map(v => Array.isArray(v) ? num(v[1]) : null);
    rec.statMap = m; rec.stat = 'crit'; rec.addable = true;
  } else if (s === 'targetPriority') {
    rec.mechanic = {
      kind: 'targetPriority',
      pick: /超主力舰/.test(desc) ? 'superCapital' : /小型主力舰/.test(desc) ? 'smallCapital'
        : /战列巡洋舰/.test(desc) ? 'battlecruiser' : 'unknown',
      text: desc.slice(0, 40)
    };
    rec.addable = false; rec.isMechanic = true;
  } else if (s === 'cmdAssist' || String(s).indexOf('strike') === 0) {
    const lv1 = (n.levelValue || [])[1] || [];
    if (s === 'cmdAssist') {
      const mm = desc.match(/指挥舰队中\d+个([^，。]*?)主武器/);
      rec.mechanic = {
        kind: 'cmdAssist', count: num(lv1[0]) !== null ? num(lv1[0]) : 0,
        every: num(lv1[1]) !== null ? num(lv1[1]) : 3, matchText: mm ? mm[1] : ''
      };
    } else {
      rec.mechanic = { kind: 'strike', mode: s.replace('strike', ''), dur: num(lv1[0]), cd: num(lv1[1]) };
    }
    rec.addable = false; rec.isMechanic = true;
  } else if (addable) {
    /* 飞行时间 + 冷却 两列 */
    if (s === 'hangarModuleCd' || s === 'hangarCd') {
      const flight = s.replace('Cd', 'Flight');
      const m = {};
      m[s] = (n.levelValue || []).map(v => Array.isArray(v) ? num(v[0]) : null);
      m[flight] = (n.levelValue || []).map(v => Array.isArray(v) ? num(v[1]) : null);
      if (m[s].some(v => typeof v === 'number') || m[flight].some(v => typeof v === 'number')) {
        rec.statMap = m; rec.addable = true; multiOk++;
      } else { rec.addable = false; rec.needsManual = true; multiFail++; }
      cond = detectCond(desc);
      if (cond) { rec.cond = cond; rec.condMeta = detectCondMeta(desc); condCnt++; }
      /* ★ 多机制补充：说明里写了多个机制、且共用同一个 {数值} 时，全部生效 */
      if (rec && rec.stat && rec.addable !== false) {
        const _e = extraStats(String(n.baseDesc || ''), rec.stat);
        if (_e.length) rec.stats = [rec.stat].concat(_e);
      }
      out.nodes[n.id] = rec; return;
    }
    if (rec.multi === 1) singleOk++;
    else {
      const byLevel = (n.levelValue || []).map((_, L) => statValueAt(n, rec.stat, L));
      if (byLevel.some(v => typeof v === 'number')) { rec.statValues = byLevel; multiOk++; }
      else { rec.addable = false; rec.needsManual = true; multiFail++; }
    }
  }
  /* ★ 条件触发：识别出条件就记下来（引擎要按"满足条件才生效"处理，不能当常量） */
  if (rec.addable && !rec.statMap) {
    const cd = detectCond(desc);
    if (cd) {
      const meta = detectCondMeta(desc);
      const val0 = (n.levelValue || [])[1] || [];
      cd.threshold = condValue(desc, val0, cd.tok);
      cd.dur = condValue(desc, val0, meta.durTok);
      cd.once = meta.once;
      if (cd.kind === 'battleStartSec') cd.sec = condValue(desc, val0, cd.tok);
      if (cd.kind === 'firstRounds' || cd.kind === 'everyRounds') cd.rounds = condValue(desc, val0, cd.tok);
      rec.cond = cd; condCnt++;
    }
  }
  /* ★ 舰队级机制（多舰队场景）—— 单独标记，引擎按旗舰+指挥系统判定 */
  if (!rec.empty) {
    const fm = detectFleetMech(desc);
    if (fm) {
      fm.stat = rec.stat;
      fm.vals = (n.levelValue || []).map(v => Array.isArray(v) ? num(v[0]) : null);
      fm.multi = rec.multi;
      fm.perLevel = rec.perLevel;
      fm.lvRaw = n.levelValue || [];            // 原始每级数组（多列时引擎按列取）
      rec.fleetMech = fm;
      rec.addable = false;                      // 不再当普通数值累加
      delete rec.statValues;
    }
  }
  /* ★ 多机制补充：说明里写了多个机制、且共用同一个 {数值} 时，全部生效 */
      if (rec && rec.stat && rec.addable !== false) {
        const _e = extraStats(String(n.baseDesc || ''), rec.stat);
        if (_e.length) rec.stats = [rec.stat].concat(_e);
      }
      out.nodes[n.id] = rec;
})));

fs.writeFileSync(ROOT + '/data/blueprint_stats.json', JSON.stringify(out), 'utf8');

console.log('节点 ' + Object.keys(out.nodes).length);
console.log('\n=== 归类分布 ===');
Object.entries(stat).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
  console.log('  ' + String(v).padStart(5) + '  ' + (CN[k] || k)));
console.log('\n=== 数值解析结果 ===');
console.log('  单参数节点（直接取 perLevel）      : ' + singleOk);
console.log('  多参数节点 → 已解出该属性的值      : ' + multiOk);
console.log('  多参数节点 → 解不出，标记需手填     : ' + multiFail);
console.log('  术语代号：已译 ' + decodedCnt + ' 个 / 仍无译文 ' + pureRef + ' 个');
const addable = Object.values(out.nodes).filter(x => x.addable).length;
console.log('\n  可自动汇总的节点总数: ' + addable);
console.log('  文件: ' + (fs.statSync(ROOT + '/data/blueprint_stats.json').size / 1024).toFixed(0) + ' KB');
