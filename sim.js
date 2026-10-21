// live/sim.js — FRIENDPOCALYPSE: deterministic co-op survivor-like sim, fixed 120 Hz, 1–8 players (humans or bots).
// Contract (engine.md §6): create / step / at / spawn / respawn / outOfPlay / scriptInput; events in S.ev.
// Host-authoritative: the host steps S with every player's input ({ players: { id: inp } }) and ships S to clients.
// Every reaction (whips, clouds, cards, rockets, revives, combos, voice lines) lives here so all clients see the same.
(function (root) {
  const DT = 1 / 120, L = 36.0;
  const VIEW = { W: 1920, H: 1080 }, WORLD = { x0: 0, y0: 0, x1: 5200, y1: 3800 };
  // the current level (useMap swaps the whole set: Парк → Мелеуз); plaza centre + radii (3/4 view squash)
  let C = [2600, 1900], PLAZA = [600, 500], PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, WALLS, LV;
  const HINT = 'WASD — бег · Q — способность · R — ульта · E — ларёк / встать · 1/2/3 — улучшение';
  let SEED = 0;                                                              // «Забег дня»: everyone gets the same seed
  const h1 = (n) => { const v = Math.sin((n + SEED) * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const h2 = (a, b) => h1(a * 12.9898 + b * 78.233);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------------- heroes ----------------
  const HEROES = {
    hasan: { name: 'ХАСАН', hp: 105, spd: 227, col: [0.85, 0.55, 0.25], pick: 1.2 },
    danil: { name: 'ДАНИЛ', hp: 100, spd: 218, col: [1.0, 0.35, 0.75], pick: 1.0 },
    vitya: { name: 'ВИТЯ', hp: 100, spd: 220, col: [0.55, 0.95, 0.25], pick: 1.0 },
    leha: { name: 'ЛЁХА', hp: 140, spd: 194, col: [0.6, 0.7, 0.35], pick: 1.0 },
  };
  const ORDER = ['hasan', 'danil', 'vitya', 'leha'];
  const QCD = { hasan: 16, danil: 20, vitya: 18, leha: 22 };
  const LEHA_GUNS = ['ПИСТОЛЕТ', 'ПП «КЕДР»', 'ДРОБОВИК', 'ПУЛЕМЁТ', 'РПГ'];

  // ---------------- enemies ----------------
  // map: which level spawns them; skin: the art (scene); elite: the type an elite of that level uses
  const ETYPES = {
    ghoul: { hp: 22, spd: 99, r: 22, dmg: 9, xp: 1, sc: 1.0, from: 1, w: 1, map: 'park' },
    sprinter: { hp: 12, spd: 180, r: 18, dmg: 6, xp: 1, sc: 0.8, from: 2, w: 0.35, map: 'park' },
    brute: { hp: 130, spd: 63, r: 38, dmg: 16, xp: 5, sc: 1.65, from: 3, w: 0.1, map: 'park' },
    spitter: { hp: 28, spd: 79, r: 22, dmg: 7, xp: 2, sc: 1.05, from: 4, ranged: 1, w: 0.14, map: 'park' },
    bomber: { hp: 18, spd: 132, r: 22, dmg: 18, xp: 2, sc: 1.0, from: 5, bomb: 1, w: 0.12, map: 'park' },
    // Мелеуз: the town folk, possessed by the same shadow
    gopnik: { hp: 26, spd: 104, r: 22, dmg: 10, xp: 1, sc: 1.0, from: 11, w: 1, map: 'meleuz' },
    dog: { hp: 14, spd: 196, r: 18, dmg: 7, xp: 1, sc: 0.8, from: 11, w: 0.45, map: 'meleuz', pack: 1 },
    alkash: { hp: 30, spd: 72, r: 22, dmg: 11, xp: 2, sc: 1.0, from: 12, ranged: 1, lob: 1, w: 0.15, map: 'meleuz' },
    starshiy: { hp: 140, spd: 64, r: 38, dmg: 18, xp: 5, sc: 1.6, from: 13, w: 0.1, map: 'meleuz' },
    mom: { hp: 46, spd: 88, r: 30, dmg: 20, xp: 3, sc: 1.05, from: 14, charge: 1, w: 0.1, map: 'meleuz' },
    alpha: { hp: 110, spd: 168, r: 30, dmg: 15, xp: 5, sc: 1.45, from: 999, w: 0, map: 'meleuz', howl: 1 },    // «Вожак стаи»: elites only
    // bosses (BOSSES.md): hp is the wave-1 base, scaled by hpScale like everyone else
    vlad: { hp: 1400, spd: 0, r: 46, dmg: 14, xp: 60, sc: 1, from: 999, w: 0, map: 'park', boss: 1 },
    lenin: { hp: 2000, spd: 0, r: 95, dmg: 16, xp: 120, sc: 1, from: 999, w: 0, map: 'meleuz', boss: 1 },
    komissar: { hp: 900, spd: 0, r: 26, dmg: 0, xp: 0, sc: 1, from: 999, w: 0, map: 'meleuz', mini: 1 },
  };
  const ELITES = { park: ['brute'], meleuz: ['starshiy', 'alpha'] };      // «Батя района» (a starshiy elite) and «Вожак стаи»
  const WAVE_LEN = 60, BREAK = 9, WAVES = 10, LASH_HIT = 0.21;
  // «Споры»: one optional rule per run, chosen in the room; x = score multiplier
  const SPORS = {
    glass: { n: 'Хрустальный', d: 'Любой удар кладёт', x: 1.6 },
    turbo: { n: 'Турбо', d: 'Всё в 1.5 раза быстрее', x: 1.4 },
    smol: { n: 'Мелкий', d: 'Герой меньше, урон и бег ×0.8', x: 1.3 },
    pacifist: { n: 'Пацифист', d: 'Без общих оружий, только своё', x: 1.5 },
    oh1: { n: 'Ой', d: 'Враги: здоровье и урон ×1.25', x: 1.3, k: 1.25 },
    oh2: { n: 'Ой-ой', d: 'Враги: здоровье и урон ×1.5', x: 1.6, k: 1.5 },
    oh3: { n: 'Ну всё', d: 'Враги: здоровье и урон ×2', x: 2, k: 2 },
    crowd: { n: 'Толпа', d: 'Врагов вдвое больше', x: 1.4 },
    chonk: { n: 'Жиробасы', d: 'Враги вдвое толще и крупнее', x: 1.4 },
    nokettle: { n: 'Без котла', d: 'Котлы не падают', x: 1.3 },
    speedrun: { n: 'Спидран', d: 'Парк за 13 минут', x: 1.3 },
  };
  // «Дела»: milestones that open items for good (S.unlock → the page saves them); rewards are weapons / passives only
  const QUESTS = [
    { id: 'icecream', n: 'Дожить до 5-й волны', r: ['icecream'] },
    { id: 'pigeon', n: 'Открыть 3 рецепта в котле', r: ['pigeon'] },
    { id: 'meleuz', n: 'Доехать до Мелеуза', r: ['sugar', 'tractor'], d: 'Рафинад и Трактор появятся и в парке' },
    { id: 'condensed', n: 'Пройти Мелеуз (20 волн)', r: ['condensed'] },
    { id: 'kumys', n: 'Выиграть любой спор (доехать до Мелеуза)', r: ['kumys'], d: 'Кумыс появится и в парке' },
  ];              // Hasan's whip: snap 0.21 s after the swing starts (scene LASH)
  // ability sizes (kept compact so 4–8 players don't paint the whole screen)
  const ULT_STAGE = 5, ULT_GAS = 230, TORNADO = { r: 140, ttl: 4, spd: 150 }, CHARM = { r: 360, half: 0.62, ttl: 2.5 }, JET = { r: 380, half: 0.45 };
  const stageCard = (p, ua, k) => { const a = ua * 1.6 + k * Math.PI / 4, R = 150 * p.m.area; return [p.x + Math.cos(a) * R, p.y - 30 + Math.sin(a) * R * 0.72]; };
  const inCone = (p, e, ang, r, half) => { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy); if (d > r + e.r) return false; if (d < 30) return true;
    const da = Math.atan2(dy, dx) - ang; return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) < half; };
  const COOP = [1, 1, 1.65, 2.2, 2.7, 3.15, 3.55, 3.95, 4.3], COOP_HP = [1, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];

  // ---------------- progression: «Бабушкин котёл» (BALL x PIT-style alchemy) ----------------
  // Every item has 3 levels. Slots: the hero's own weapon + 3 shared weapons + 4 passives. Level-ups offer new items / +1 level.
  // Elites drop a cauldron with a choice: Fission (+1 level to 3 random items), Fusion (two level-3 weapons share one slot, both keep
  // firing) or an Evolution: a fixed recipe of two level-3 items → a new item (a slot is freed; tier 2 recipes need an evolved one).
  // Recipes show as "???" until made once; the almanac (cfg.meta.found, saved by the page) remembers them between runs, and some
  // weapons stay locked until the meta unlocks them (cfg.meta.unlock).
  const MAXL = 3, MAXW = 3, MAXP = 4;
  // Хасан's mustaches grow at the barber (HASAN.md), not from level-ups: how many whips, damage per whip by that count, reach per good cut
  const MUST_MAX = 6, MUST_DMG = [1, 1.12, 0.98, 0.88, 0.8, 0.74], MUST_R = 0.08;
  const SIG = {
    hasan: { n: 'Усы-хлысты', lv: ['Два уса хлещут ближайших', 'Два хлыста за удар, +25% урона', '+25% радиус, чаще связывает усами'], evo: 'pick', evoN: 'Усатый вихрь', evoD: 'Пробуждение: усы крутятся вокруг, режут и связывают толпу' },
    danil: { n: 'Фотокарточки', lv: ['Карты с рикошетом', '+1 карта, +1 рикошет', '+30% урона, +1 карта, карты пробивают'], evo: 'crit', evoN: 'Коллекция ультраредок', evoD: 'Пробуждение: кольцо карт вращается вокруг и бьёт само' },
    vitya: { n: 'Тихий, но смертельный', lv: ['Облако позади себя', 'Облако больше, пукает чаще', '+30% урона, два облака за раз'], evo: 'hp', evoN: 'Насрал в штаны', evoD: 'Пробуждение: больше не пукает — за ним тянется сплошной газовый след' },
    leha: { n: 'Оружейная лицензия', lv: ['Пушки — у барыги за гильзы', '+12% урона любой пушке', '+24% урона любой пушке'], evo: 'armor', evoN: 'Карманный апокалипсис', evoD: 'Пробуждение: РПГ, залп из 3 ракет' },
  };
  // shared weapons: b = behaviour (gearStep), el = element, mods = what its hits add (burn / chill / freeze / shock / boom …), mult = power
  const LVUP = ['', '+25% урона, +1 снаряд', '+25% урона, быстрее и дальше'];
  const WEAPONS = {
    tapok: { n: 'Тапок', el: 'удар', b: 'tapok', lv: ['Бумеранг летит и возвращается', ...LVUP.slice(1)] },
    petard: { n: 'Петарды', el: 'огонь', b: 'petard', mods: { burn: 1 }, lv: ['Петарды взрываются и поджигают', ...LVUP.slice(1)] },
    can: { n: 'Энергетик', el: 'ток', b: 'can', mods: { shock: 2 }, lv: ['Банка взрывается, ток бьёт по цепи', '+1 банка, +25% урона', 'Цепь молнии длиннее'] },
    icecream: { n: 'Пломбир', el: 'холод', b: 'icecream', mods: { chill: 1, freeze: 1, freezeP: 0.15 }, lock: 'icecream', lv: ['Шарики замедляют, иногда морозят', ...LVUP.slice(1)] },
    speaker: { n: 'Колонка', el: 'звук', b: 'speaker', lv: ['Бас бьёт волной вокруг', '+20% радиус, +25% урона', 'Волна оглушает'] },
    pigeon: { n: 'Голуби', el: 'стая', b: 'pigeon', lock: 'pigeon', lv: ['Голубь кружит и клюёт врагов', '+1 голубь, +25% урона', 'Клюют чаще и больнее'] },
    // Мелеуз: in the pool on the second map (and everywhere once «Доехать до Мелеуза» is done)
    sugar: { n: 'Рафинад', el: 'сахар', b: 'sugar', lock: 'meleuz', map: 'meleuz', lv: ['Кубик скачет от врага к врагу', '+1 кубик, +2 отскока', 'Каждый отскок бьёт на 20% сильнее'] },
    tractor: { n: 'Трактор «Универсал»', el: 'таран', b: 'tractor', lock: 'meleuz', map: 'meleuz', lv: ['Трактор таранит толпу по прямой', '+25% урона, трактор шире', 'Два трактора за раз'] },
    condensed: { n: 'Сгущёнка', el: 'липкость', b: 'condensed', lock: 'condensed', lv: ['Липкая лужа: враги вязнут и получают +25% урона', '+25% урона, лужа больше', 'Две банки за раз'] },
    // evolutions — tier 1: two level-3 base weapons; tier 2: an evolved one + a base one
    fried: { n: 'Жареное мороженое', b: 'icecream', from: ['petard', 'icecream'], mult: 1.5, mods: { burn: 1, chill: 1, freeze: 1, freezeP: 0.3, boom: 70 }, d: 'Шарики взрываются огнём и льдом' },
    salute: { n: 'Салют', b: 'petard', from: ['petard', 'can'], mult: 1.5, mods: { burn: 1, shock: 3, boom: 85, sky: 1 }, d: 'Фейерверки падают с неба, искры бьют током' },
    rave: { n: 'Рейв', b: 'speaker', from: ['can', 'speaker'], mult: 1.4, mods: { shock: 4 }, d: 'Каждый бас бьёт молниями по цепи' },
    icetapok: { n: 'Ледяной тапок', b: 'tapok', from: ['tapok', 'icecream'], mult: 1.4, mods: { chill: 1, freeze: 1, freezeP: 0.45 }, d: 'Тапки замораживают всех на пути' },
    shocktapok: { n: 'Тапок-шокер', b: 'tapok', from: ['tapok', 'can'], mult: 1.4, mods: { shock: 3 }, d: 'Тапки бьют током по цепочке' },
    kamikaze: { n: 'Голуби-камикадзе', b: 'pigeon', from: ['pigeon', 'petard'], mult: 1.6, mods: { boom: 80, burn: 1 }, d: 'Голуби пикируют и взрываются' },
    coo: { n: 'Курлык-хор', b: 'pigeon', from: ['pigeon', 'speaker'], mult: 1.3, mods: { coo: 1 }, d: 'Голуби курлычут: всех вокруг оглушает' },
    aurora: { n: 'Северное сияние', b: 'petard', from: ['salute', 'icecream'], tier: 2, mult: 2.2, mods: { burn: 1, chill: 1, freeze: 1, freezeP: 0.4, boom: 110, sky: 1, shock: 2 }, d: 'Небо сыплет огнём, льдом и током' },
    nuke: { n: 'Ядерные голуби', b: 'pigeon', from: ['kamikaze', 'can'], tier: 2, mult: 2.4, mods: { boom: 130, burn: 2, shock: 3 }, d: 'Голуби-боеголовки' },
    caramel: { n: 'Жжёный сахар', b: 'sugar', from: ['sugar', 'petard'], mult: 1.5, mods: { burn: 2, boom: 55 }, d: 'Кубики горят и лопаются карамелью' },
    etractor: { n: 'Электротрактор', b: 'tractor', from: ['tractor', 'can'], mult: 1.5, mods: { shock: 3 }, d: 'Трактор бьёт током всех, кого сбил' },
  };
  // the hero's own weapon evolves with a shared one: the shared slot is freed, the hero's weapon takes the element
  const HEVO = {
    hasan_shock: { hero: 'hasan', n: 'Усы-электрошокер', from: ['sig', 'can'], mods: { shock: 3 }, d: 'Щелчок уса бьёт молнией по цепи' },
    hasan_fire: { hero: 'hasan', n: 'Огненные усы', from: ['sig', 'petard'], mods: { burn: 2 }, d: 'Усы поджигают всех, кого хлестнули' },
    danil_mail: { hero: 'danil', n: 'Голубиная почта', from: ['sig', 'pigeon'], mods: { home: 1 }, d: 'Карты сами находят цель, +1 карта' },
    danil_fan: { hero: 'danil', n: 'Фанмитинг', from: ['sig', 'speaker'], mods: { charm: 1.2 }, d: 'Каждая карта очаровывает врага' },
    vitya_boom: { hero: 'vitya', n: 'Газовая петарда', from: ['sig', 'petard'], mods: { ignite: 1 }, d: 'Облака вспыхивают и взрываются' },
    vitya_frost: { hero: 'vitya', n: 'Ледяной туман', from: ['sig', 'icecream'], mods: { frost: 1 }, d: 'Газ морозит тех, кто в нём' },
    leha_rail: { hero: 'leha', n: 'Рельсотрон', from: ['sig', 'can'], mods: { pierce: 4, shock: 1 }, d: 'Пули прошивают насквозь и бьют током' },
    leha_inc: { hero: 'leha', n: 'Зажигательные патроны', from: ['sig', 'petard'], mods: { burn: 2 }, d: 'Каждое попадание поджигает' },
  };
  const PASSIVES = {
    dmg: { n: 'Злость', d: '+12% урона' }, as: { n: 'Кофеин', d: '+10% скорости атаки' }, area: { n: 'Размах', d: '+12% радиус атак' },
    hp: { n: 'Шаурма', d: '+20 к макс. HP, лечит' }, spd: { n: 'Кроссовки', d: '+7% скорости бега' }, pick: { n: 'Магнит', d: '+35% радиус сбора' },
    armor: { n: 'Толстокожий', d: '-7% входящего урона' }, regen: { n: 'Чай с мёдом', d: '+0.4 HP в секунду' }, crit: { n: 'Везунчик', d: '+6% шанс крита' },
    cd: { n: 'Без перерыва', d: '-9% перезарядки Q и ульты' },
    kumys: { n: 'Кумыс', d: 'Вампиризм: лечит 2% от урона', lock: 'kumys', map: 'meleuz' },
    deo: { n: 'Дезодорант', d: 'Витя: на 15% меньше урона друзьям', hero: 'vitya' }, plate: { n: 'Бронеплита', d: 'Лёха: щит +1.6 с, -5% урона', hero: 'leha' },
    // passive evolutions (two level-3 passives → one; single level)
    fury: { n: 'Ярость везунчика', from: ['dmg', 'crit'], max: 1, d: '+45% урона, крит 25%, криты ×2.5' },
    scooter: { n: 'Самокат', from: ['spd', 'pick'], max: 1, d: '+25% к бегу, сбор опыта ×3' },
    lunch: { n: 'Бабушкин обед', from: ['hp', 'regen'], max: 1, d: '+70 к HP, +2 HP в секунду' },
    espresso: { n: 'Двойной эспрессо', from: ['as', 'cd'], max: 1, d: '+35% скорости атак, -30% перезарядки' },
  };
  // «Бабушкины гостинцы»: endless stacking boosts once every item is maxed and every slot is taken (Megabonk-style)
  const GIFTS = {
    g_dmg: { n: 'Бабушкин пирожок', d: '+8% урона', k: 0.08 }, g_as: { n: 'Крепкий чай', d: '+7% скорости атаки', k: 0.07 },
    g_area: { n: 'Широкая душа', d: '+8% радиус атак', k: 0.08 }, g_hp: { n: 'Домашние котлеты', d: '+15 к макс. HP', k: 15 },
    g_crit: { n: 'Счастливый билет', d: '+3% шанс крита', k: 0.03 }, g_pick: { n: 'Бабкина авоська', d: '+15% радиус сбора', k: 0.15 },
  };
  // every recipe in one list: { id, from: [a, b], kind: 'w' | 'h' | 'p' | 'awake', hero? }
  const RECIPES = [
    ...Object.keys(WEAPONS).filter((id) => WEAPONS[id].from).map((id) => ({ id, from: WEAPONS[id].from, kind: 'w' })),
    ...Object.keys(HEVO).map((id) => ({ id, from: HEVO[id].from, kind: 'h', hero: HEVO[id].hero })),
    ...Object.keys(PASSIVES).filter((id) => PASSIVES[id].from).map((id) => ({ id, from: PASSIVES[id].from, kind: 'p' })),
    ...Object.keys(SIG).map((h) => ({ id: 'awake_' + h, from: ['sig', SIG[h].evo], kind: 'awake', hero: h })),
  ];
  const rname = (id) => id.startsWith('awake_') ? SIG[id.slice(6)].evoN : (WEAPONS[id] || HEVO[id] || PASSIVES[id]).n;
  const rdesc = (id) => id.startsWith('awake_') ? SIG[id.slice(6)].evoD : (WEAPONS[id] || HEVO[id] || PASSIVES[id]).d;
  const iname = (p, id) => id === 'sig' ? SIG[p.hero].n : (WEAPONS[id] || HEVO[id] || PASSIVES[id]).n;
  const lv = (p, id) => (p.items && p.items[id]) || 0;
  const pmax = (id) => (PASSIVES[id] && PASSIVES[id].max) || MAXL;
  const sharedW = (p) => Object.keys(p.items).filter((id) => WEAPONS[id] && p.items[id]);
  const usedW = (p) => sharedW(p).length - (p.fused || []).length;
  const ownedP = (p) => Object.keys(p.items).filter((id) => PASSIVES[id] && p.items[id]);
  const isFused = (p, id) => (p.fused || []).some((f) => f.includes(id));
  // in the pool: a Meleuz item on its own map, any locked item once its «дело» is done
  const unlocked = (S, id) => { const q = WEAPONS[id] || PASSIVES[id]; return !q.lock || (q.map && q.map === S.map) || !!(S.unlock && S.unlock[q.lock]); };
  const gift = (p, id) => (p.gifts && p.gifts[id]) || 0;
  // derived stats from item levels (recomputed on every pick: no drifting multipliers)
  function recalc(p) {
    const H = HEROES[p.hero], m = p.m, L = (id) => lv(p, id), fury = L('fury'), sc = L('scooter'), lu = L('lunch'), es = L('espresso');
    const gf = (id) => gift(p, id) * GIFTS[id].k, smol = p.smol ? 0.8 : 1;
    Object.assign(m, { dmg: (1 + 0.12 * L('dmg') + 0.45 * fury + gf('g_dmg')) * smol, as: 1 + 0.1 * L('as') + 0.35 * es + gf('g_as'), area: 1 + 0.12 * L('area') + gf('g_area'),
      spd: (1 + 0.07 * L('spd') + 0.25 * sc) * smol, leech: 0.02 * L('kumys'),
      pick: H.pick * (1 + 0.35 * L('pick') + gf('g_pick')) * (sc ? 3 : 1), armor: (1 - 0.07 * L('armor')) * (1 - 0.05 * L('plate')), regen: 0.4 * L('regen') + 2 * lu,
      crit: 0.04 + 0.06 * L('crit') + (fury ? 0.21 : 0) + gf('g_crit'), critX: fury ? 2.5 : 2, cd: (1 - 0.09 * L('cd')) * (es ? 0.7 : 1),
      deo: Math.pow(0.85, L('deo')), shield: 1.6 * L('plate'), extra: 0, rico: 1, pullN: 3, ttl: 1, sdmg: 1, sarea: 1, srate: 1, pierce: 0, double: 0, smods: null });
    const g = L('sig');
    if (p.hero === 'hasan') { const n = p.must || 1; m.extra = n - 1; m.sdmg = MUST_DMG[n - 1]; m.sarea = 1 + MUST_R * (p.mustR || 0); m.pullN = n >= 3 ? 2 : 3; }
    if (p.hero === 'danil') { if (g >= 2) { m.extra = 1; m.rico = 2; } if (g >= 3) { m.sdmg = 1.3; m.extra = 2; m.pierce = 1; } }
    if (p.hero === 'vitya') { if (g >= 2) { m.sarea = 1.2; m.srate = 0.8; } if (g >= 3) { m.sdmg = 1.3; m.double = 1; } }
    if (p.hero === 'leha') { p.tier = p.gun || 0; m.sdmg = 1 + 0.12 * Math.max(0, g - 1); const A = p.att || {}, G = { rate: 0, dmg: 0, pel: 0, tight: 0, blast: 0 };
      for (const a of GATT[p.gun || 0]) if (A[a.id]) for (const k in a.fx) { if (k === 'crit') m.crit += a.fx[k]; else if (k === 'pierce') m.pierce += a.fx[k]; else G[k] += a.fx[k]; }
      m.sdmg *= 1 + G.dmg; m.gun = G; m.armor *= 1 - 0.1 * (A.vest || 0); }
    if (p.sigEvo) { const E = HEVO[p.sigEvo]; m.smods = E.mods; m.sdmg *= 1 + 0.2 * L(p.sigEvo); if (E.mods.home) m.extra += 1; if (E.mods.pierce) m.pierce += E.mods.pierce; }
    p.hpMax = H.hp + 20 * L('hp') + 70 * lu + gift(p, 'g_hp') * GIFTS.g_hp.k; p.hp = Math.min(p.hp, p.hpMax);
  }
  // cards: { id, kind: 'sig' | 'w' | 'p' | 'heal' | 'reroll' | 'fission' | 'fusion' | 'recipe', n, d, tag, ... }
  function cardFor(p, id) {
    if (id === 'heal') return { id, kind: 'heal', n: 'Перекус', d: 'Лечит 40% HP', tag: '' };
    if (id === 'reroll') return { id, kind: 'reroll', n: 'Перебросить', d: `Новые карты (осталось ${p.rerolls})`, tag: '' };
    if (GIFTS[id]) { const g = GIFTS[id], n = gift(p, id); return { id, kind: 'gift', n: g.n, d: g.d, tag: n ? 'ГОСТИНЕЦ ×' + (n + 1) : 'ГОСТИНЕЦ' }; }
    if (id === 'sig') { const l = lv(p, 'sig'); return { id, kind: 'sig', n: SIG[p.hero].n, d: SIG[p.hero].lv[Math.min(l, MAXL - 1)], tag: 'Ур. ' + (l + 1) }; }
    if (HEVO[id]) { const l = lv(p, id); return { id, kind: 'sig', n: HEVO[id].n, d: '+20% урона', tag: 'Ур. ' + (l + 1) }; }
    if (WEAPONS[id]) { const w = WEAPONS[id], l = lv(p, id); return { id, kind: 'w', n: w.n, d: w.from ? (l ? '+25% урона' : w.d) : w.lv[l], tag: l ? 'Ур. ' + (l + 1) : 'НОВОЕ', el: w.el }; }
    const q = PASSIVES[id], l = lv(p, id); return { id, kind: 'p', n: q.n, d: q.d, tag: l ? 'Ур. ' + (l + 1) : 'НОВОЕ' };
  }
  const cardRecipe = (S, p, r) => { const found = S.found.includes(r.id), a = iname(p, r.from[0]), b = iname(p, r.from[1]);
    return { id: 'r:' + r.id, kind: 'recipe', rid: r.id, a: r.from[0], b: r.from[1], found: found ? 1 : 0, n: found ? rname(r.id) : '???',
      d: found ? rdesc(r.id) : `${a} + ${b} = ?`, tag: found ? 'ЭВОЛЮЦИЯ' : 'НОВЫЙ РЕЦЕПТ?' }; };
  // recipes whose two ingredients are both at max level right now (fused items are locked in their pair)
  // the hero's own weapon evolves ONCE: either the awakening (with its partner passive) or an element evolution (with a shared weapon)
  const sigMaxed = (p) => p.hero === 'hasan' ? (p.must || 1) >= 3 : lv(p, 'sig') >= MAXL;
  const readyRecipes = (p) => RECIPES.filter((r) => (!r.hero || r.hero === p.hero) && !(r.hero === 'danil' && (p.album || []).length < PHOTOCARDS.length)
    && r.from.every((id) => id === 'sig' ? sigMaxed(p) && !p.sigEvo && !p.evo : lv(p, id) >= pmax(id) && !isFused(p, id)));
  const kettleCards = (S, p) => {
    const cards = [{ id: 'fission', kind: 'fission', n: 'Деление', d: '+1 уровень двум случайным предметам', tag: 'КОТЁЛ' }];
    const rr = readyRecipes(p); for (let k = 0; k < 2 && rr.length; k++) cards.push(cardRecipe(S, p, rr.splice(Math.floor(h2(S.steps + k, p.id) * rr.length), 1)[0]));
    const maxed = sharedW(p).filter((id) => lv(p, id) >= MAXL && !isFused(p, id)), inRecipe = (a, b) => RECIPES.some((r) => r.from.includes(a) && r.from.includes(b));
    for (let i = 0; i < maxed.length && cards.length < 4; i++) for (let j = i + 1; j < maxed.length; j++) if (!inRecipe(maxed[i], maxed[j])) {
      cards.push({ id: 'fuse:' + maxed[i] + '+' + maxed[j], kind: 'fusion', a: maxed[i], b: maxed[j], n: 'Сплав', d: `${iname(p, maxed[i])} + ${iname(p, maxed[j])} в одном слоте`, tag: 'СПЛАВ' }); i = maxed.length; break; }
    return cards; };
  // icon texture per item / recipe result (HUD, cards, almanac)
  const iconOf = (id, hero) => id === 'sig' ? `ic_${hero}_base` : id.startsWith('awake_') ? `ic_${id.slice(6)}_evo` : id === 'evo' ? `ic_${hero}_evo` : GIFTS[id] ? 'it_' + id.slice(2)
    : (WEAPONS[id] && !WEAPONS[id].from) || (PASSIVES[id] && !PASSIVES[id].from) ? 'it_' + id : 'ic_' + id;
  // what the hero is, for the build panel (Tab): role, Q, R
  const HINFO = {
    hasan: { role: 'Ближний бой, хрупкий. Хлысты связывают врагов; усы растут в барбершопе', q: 'Подкрутил усы: усы-лезвия крутятся вокруг 4 с, отбивают плевки', r: 'Усатое торнадо: смерч тянет и рубит толпу' },
    danil: { role: 'Дальний бой. Карточки рикошетят; фотокарточки с элиток', q: 'Фан-чант: конус очаровывает врагов, друзья рядом быстрее', r: 'Камбэк года: кольцо гигантских карт вокруг' },
    vitya: { role: 'Газ задевает и своих. Один — газ сильнее', q: 'Залп по ветру: струя газа назад отталкивает и травит', r: 'Катастрофа: огромное облако через секунду' },
    leha: { role: 'Танк. Гильзы за убийства — пушки и обвесы у барыги', q: 'Прикрыл!: щит спереди блокирует плевки', r: 'До зубов: 7 с с ракетницей' } };
  // «Фотокарточки»: Данил's album of K-pop idol photocards (art + his pickup lines: see DANIL_CARDS.md)
  // r: the friend who answers Данил's line about this card (voiced dc_<id>_0 / _1; no answer when that friend isn't in the party)
  const PHOTOCARDS = [{ id: 'lisa', n: 'Лиса', g: 'BLACKPINK', r: 'hasan' }, { id: 'jennie', n: 'Дженни', g: 'BLACKPINK', r: 'vitya' }, { id: 'rose', n: 'Розэ', g: 'BLACKPINK', r: 'leha' },
    { id: 'jisoo', n: 'Джису', g: 'BLACKPINK', r: 'leha' }, { id: 'nayeon', n: 'Наён', g: 'TWICE', r: 'hasan' }, { id: 'karina', n: 'Карина', g: 'aespa', r: 'vitya' },
    { id: 'wonyoung', n: 'Вонён', g: 'IVE', r: 'leha' }, { id: 'hanni', n: 'Ханни', g: 'NewJeans', r: 'hasan' }];
  const CARD_P = 0.45, ALBUM_BONUS = 0.04;                                  // drop chance per elite (a miss raises the next one), +4% card damage per card
  const UPG = { WEAPONS, PASSIVES, SIG, HEVO, RECIPES, GIFTS, HINFO, MAXL, MAXW, MAXP, rname, rdesc, iconOf };

  // ---------------- the levels, as data (useMap swaps the current one in) ----------------
  // paved areas (drawn + spawn-safe): rects [cx, cy, w, h, rot] and sub-plazas [x, y, rx, ry, kind]; props [kind, x, y, scale, flip]
  const FOOT = { lamp: 13, bench: 0, tree: 26, cypress: 18, autumn: 24, bush: 46, flowers: 0, fence: 0, bin: 16, statue: 85, gazebo: 175, pergola: 0,
    mlamp: 14, bollard: 12, spruce: 30, thuja: 18, glory: 120, lenin: 60, tmonument: 125, kiosk: 62, rail: 0 };
  // buildings block a footprint rect (WALLS); the scene draws set pieces at a fixed world width (sizes.js)
  const onPaveM = (M, x, y) => {
    if (((x - M.C[0]) / M.PLAZA[0]) ** 2 + ((y - M.C[1]) / M.PLAZA[1]) ** 2 < 1) return true;
    for (const [sx, sy, rx, ry] of M.SUBS) if (((x - sx) / rx) ** 2 + ((y - sy) / ry) ** 2 < 1) return true;
    for (const [cx, cy, w, h, r] of M.PATHS) { const dx = x - cx, dy = y - cy, c = Math.cos(-r), s = Math.sin(-r);
      if (Math.abs(dx * c - dy * s) < w / 2 && Math.abs(dx * s + dy * c) < h / 2) return true; }
    return false;
  };
  function buildMap(id) {
    const mz = id === 'meleuz', C = [2600, 1900], PLAZA = mz ? [640, 520] : [600, 500];
    const M = { id, C, PLAZA, PROPS: [], WALLS: [] }, PROPS = M.PROPS;
    const addP = (k, x, y, s = 1, f = 0) => PROPS.push([k, Math.round(x), Math.round(y), s, f]), onPave = (x, y) => onPaveM(M, x, y);
    const near0 = (x, y, d) => PROPS.some((p) => dist(p[1], p[2], x, y) < d);
    if (!mz) {
      M.PATHS = [[C[0], 950, 330, 1900, 0], [C[0], 2850, 330, 1900, 0], [1150, C[1], 2300, 300, 0], [4050, C[1], 2300, 300, 0],
        [1950, 1400, 1300, 220, 0.66], [3250, 1400, 1300, 220, -0.66], [1950, 2400, 1300, 220, -0.66], [3250, 2400, 1300, 220, 0.66]];
      M.SUBS = [[1250, 820, 330, 270, 'statue'], [3950, 820, 360, 290, 'gazebo'], [1250, 2980, 330, 270, 'pergola'], [3950, 2980, 400, 300, 'pond']];
      M.POND = [M.SUBS[3][0], M.SUBS[3][1] + 20, 300, 190];
      M.BUS = [4840, C[1] + 60]; M.KIOSK = [3830, 1675];
      // lamps ring the plaza (the reference's light pools) and line the paths
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; addP('lamp', C[0] + Math.cos(a) * (PLAZA[0] + 70), C[1] + Math.sin(a) * (PLAZA[1] + 60)); }
      for (const d of [-1, 1]) for (let k = 1; k <= 3; k++) { const off = PLAZA[1] + 380 * k; addP('lamp', C[0] - 210, C[1] + d * off); addP('lamp', C[0] + 210, C[1] + d * off); }
      for (const d of [-1, 1]) for (let k = 1; k <= 3; k++) { const off = PLAZA[0] + 420 * k; addP('lamp', C[0] + d * off, C[1] - 190); addP('lamp', C[0] + d * off, C[1] + 210); }
      for (const [x, y, rx, ry] of M.SUBS) for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * Math.PI * 2; addP('lamp', x + Math.cos(a) * (rx + 40), y + Math.sin(a) * (ry + 40)); }
      // benches face the plaza from its rim, between the lamps
      for (let i = 0; i < 8; i++) { if (i % 2) continue; const a = i / 8 * Math.PI * 2 + 0.05; addP('bench', C[0] + Math.cos(a) * (PLAZA[0] + 95), C[1] + Math.sin(a) * (PLAZA[1] + 75)); }
      // hedges + fences frame the garden beds along the plaza (gaps where the paths enter)
      for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * Math.PI * 2, n = ((a / (Math.PI / 4)) % 2 + 2) % 2;
        if (n < 0.45 || n > 1.55) continue;                                       // path openings at the 8 path directions
        addP(i % 3 ? 'bush' : 'fence', C[0] + Math.cos(a) * (PLAZA[0] + 190), C[1] + Math.sin(a) * (PLAZA[1] + 170), i % 3 ? 0.9 : 1); }
      // landmarks
      addP('statue', M.SUBS[0][0], M.SUBS[0][1] + 20, 1); addP('gazebo', M.SUBS[1][0], M.SUBS[1][1] + 60, 1); addP('pergola', M.SUBS[2][0], M.SUBS[2][1] + 30, 1);
      addP('kiosk', M.KIOSK[0], M.KIOSK[1]);
      // trees and flower beds scattered over the gardens (deterministic, off the paving, not crowding)
      for (let i = 0, n = 0; i < 900 && n < 70; i++) { const x = 120 + h2(i, 1) * (WORLD.x1 - 240), y = 200 + h2(i, 2) * (WORLD.y1 - 300);
        if (onPave(x, y) || onPave(x, y + 60) || onPave(x + 90, y) || onPave(x - 90, y)) continue;
        if (PROPS.some((p) => dist(p[1], p[2], x, y) < (p[0] === 'tree' ? 230 : 160))) continue;
        const r = h2(i, 3); addP(r < 0.42 ? 'tree' : r < 0.6 ? 'cypress' : r < 0.72 ? 'autumn' : r < 0.86 ? 'bush' : 'flowers', x, y, 0.85 + 0.3 * h2(i, 4), h2(i, 5) > 0.5); n++; }
      for (let i = 0; i < 12; i++) { const a = h2(i, 9) * 6.28, r = 900 + h2(i, 10) * 1300, x = C[0] + Math.cos(a) * r, y = C[1] + Math.sin(a) * r * 0.8;
        if (!onPave(x, y) && x > 100 && y > 150 && x < WORLD.x1 - 100 && y < WORLD.y1 - 100 && !near0(x, y, 140)) addP('bin', x, y); }
    } else {
      // Мелеуз: the central square (kurai flower), the administration with its flags (top right), the Monument of Glory with
      // the eternal flame (top left), the church up the boulevard, Lenin and the tractor on the lawns, the mosque (bottom left),
      // the Belaya embankment (bottom right), the bus stop at the end of the east boulevard
      M.PATHS = [[C[0], 1270, 360, 1260, 0], [C[0], 2850, 360, 1900, 0], [1150, C[1], 2300, 320, 0], [4050, C[1], 2300, 320, 0],
        [1850, 1400, 1250, 240, 0.62], [3350, 1400, 1250, 240, -0.62], [1900, 2500, 1300, 240, -0.62], [3300, 2450, 1300, 240, 0.62]];
      M.SUBS = [[1150, 980, 420, 260, 'glory'], [4020, 1010, 480, 230, 'admin'], [1200, 3290, 400, 170, 'mosque'], [3720, 2860, 400, 220, 'emb'],
        [1730, 1610, 170, 110, 'lenin'], [3480, 1600, 210, 120, 'tractor'], [C[0], 700, 300, 120, 'church']];
      M.POND = [4320, 3500, 820, 400];                                          // the Belaya bend
      M.BUS = [4840, C[1] + 60]; M.KIOSK = [3870, 1665]; M.FLAME = [1150, 1150]; M.LENIN = [1730, 1610];
      addP('church', C[0], 600); M.WALLS.push([C[0] - 250, 360, C[0] + 250, 590]);
      addP('admin', 4020, 780); M.WALLS.push([3560, 300, 4480, 760]);
      addP('mosque', 1200, 3150); M.WALLS.push([920, 2860, 1480, 3130]);
      addP('glory', 1150, 960); addP('lenin', 1730, 1600); addP('tmonument', 3480, 1600); addP('kiosk', M.KIOSK[0], M.KIOSK[1]);
      // white bollards around the memorial square, triple-globe lamps on the square and the boulevards
      for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * Math.PI * 2; if (Math.sin(a) > 0.55) continue; addP('bollard', 1150 + Math.cos(a) * 450, 980 + Math.sin(a) * 285); }
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; addP('mlamp', C[0] + Math.cos(a) * (PLAZA[0] + 70), C[1] + Math.sin(a) * (PLAZA[1] + 60)); }
      for (const d of [-1, 1]) for (let k = 1; k <= 3; k++) { const off = PLAZA[0] + 420 * k; addP('mlamp', C[0] + d * off, C[1] - 210); addP('mlamp', C[0] + d * off, C[1] + 230); }
      for (let k = 1; k <= 2; k++) { addP('mlamp', C[0] - 230, C[1] - PLAZA[1] - 360 * k); addP('mlamp', C[0] + 230, C[1] - PLAZA[1] - 360 * k); }
      for (let k = 1; k <= 3; k++) { addP('mlamp', C[0] - 230, C[1] + PLAZA[1] + 380 * k); addP('mlamp', C[0] + 230, C[1] + PLAZA[1] + 380 * k); }
      for (const [x, y, rx, ry, k] of M.SUBS) if (k === 'admin' || k === 'emb' || k === 'mosque') for (const sd of [-1, 1]) addP('mlamp', x + sd * (rx + 30), y + 10);
      // the square's rim: benches and thujas between the boulevards
      for (let i = 0; i < 8; i++) { if (i % 2) continue; const a = (i + 0.22) / 8 * Math.PI * 2; addP('bench', C[0] + Math.cos(a) * (PLAZA[0] + 95), C[1] + Math.sin(a) * (PLAZA[1] + 75)); }
      for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * Math.PI * 2, n = ((a / (Math.PI / 4)) % 2 + 2) % 2;
        if (n < 0.45 || n > 1.55) continue; addP(i % 2 ? 'thuja' : 'flowers', C[0] + Math.cos(a) * (PLAZA[0] + 190), C[1] + Math.sin(a) * (PLAZA[1] + 170), 0.9); }
      // the embankment railing along the river bank
      for (let i = 0; i < 9; i++) { const a = Math.PI * (1.05 + 0.1 * i), x = M.POND[0] + Math.cos(a) * (M.POND[2] + 40), y = M.POND[1] + Math.sin(a) * (M.POND[3] + 40);
        if (x > 120 && x < WORLD.x1 - 60 && y < WORLD.y1 - 60) addP('rail', x, y); }
      // blue spruces, thujas and flower beds over the lawns
      for (let i = 0, n = 0; i < 1200 && n < 72; i++) { const x = 120 + h2(i, 21) * (WORLD.x1 - 240), y = 200 + h2(i, 22) * (WORLD.y1 - 300);
        if (onPave(x, y) || onPave(x, y + 60) || onPave(x + 90, y) || onPave(x - 90, y)) continue;
        if (M.WALLS.some(([x0, y0, x1, y1]) => x > x0 - 80 && x < x1 + 80 && y > y0 - 40 && y < y1 + 120)) continue;
        if (((x - M.POND[0]) / (M.POND[2] + 90)) ** 2 + ((y - M.POND[1]) / (M.POND[3] + 90)) ** 2 < 1) continue;
        if (PROPS.some((p) => dist(p[1], p[2], x, y) < (p[0] === 'spruce' ? 220 : 160))) continue;
        const r = h2(i, 23); addP(r < 0.45 ? 'spruce' : r < 0.66 ? 'thuja' : r < 0.8 ? 'tree' : r < 0.9 ? 'bush' : 'flowers', x, y, 0.85 + 0.3 * h2(i, 24), h2(i, 25) > 0.5); n++; }
      for (let i = 0; i < 10; i++) { const a = h2(i, 29) * 6.28, r = 900 + h2(i, 30) * 1300, x = C[0] + Math.cos(a) * r, y = C[1] + Math.sin(a) * r * 0.8;
        if (!onPave(x, y) && x > 100 && y > 150 && x < WORLD.x1 - 100 && y < WORLD.y1 - 100 && !near0(x, y, 140)) addP('bin', x, y); }
    }
    M.SOLIDS = [];
    for (const [k, x, y, s] of PROPS) { if (FOOT[k]) M.SOLIDS.push({ x, y: y - 6, r: FOOT[k] * s });
      if (k === 'bench') { M.SOLIDS.push({ x: x - 44, y: y - 10, r: 22 }, { x: x + 44, y: y - 10, r: 22 }); }
      if (k === 'fence' || k === 'rail') { for (const o of [-80, 0, 80]) M.SOLIDS.push({ x: x + o, y: y - 6, r: 20 }); }
      if (k === 'pergola') { M.SOLIDS.push({ x: x - 95, y: y - 6, r: 24 }, { x: x + 95, y: y - 6, r: 24 }); }
 }
    M.LAMPS = PROPS.filter((p) => p[0] === 'lamp' || p[0] === 'mlamp').map((p) => [p[1], p[2]]);
    return M;
  }
  const MAPS = { park: buildMap('park'), meleuz: buildMap('meleuz') };
  const MAPN = { park: 'Парк', meleuz: 'Мелеуз' };
  const useMap = (id) => { LV = MAPS[id] || MAPS.park; ({ C, PLAZA, PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, WALLS } = LV);
    if (root.SIM) Object.assign(root.SIM, { C, PLAZA, PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, WALLS, LV }); return LV; };
  useMap('park');
  const onPave = (x, y) => onPaveM(LV, x, y);
  const inWall = (x, y, r) => { for (const [x0, y0, x1, y1] of WALLS) if (x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r) return true; return false; };
  const blocked = (x, y, r) => { if (((x - POND[0]) / (POND[2] + r)) ** 2 + ((y - POND[1]) / (POND[3] + r)) ** 2 < 1) return true;
    if (inWall(x, y, r)) return true;
    for (const o of SOLIDS) if (Math.abs(x - o.x) < o.r + r && dist(x, (y - o.y) * 1.4 + o.y, o.x, o.y) < o.r + r) return true; return false; };
  const collide = (o, r) => {
    for (const s of SOLIDS) { if (Math.abs(o.x - s.x) > s.r + r + 4 || Math.abs(o.y - s.y) > s.r + r + 4) continue;
      const dx = o.x - s.x, dy = (o.y - s.y) * 1.4, d = Math.hypot(dx, dy), R = s.r + r;
      if (d < R && d > 0) { o.x = s.x + dx / d * R; o.y = s.y + dy / d * R / 1.4; } }
    for (const [x0, y0, x1, y1] of WALLS) if (o.x > x0 - r && o.x < x1 + r && o.y > y0 - r && o.y < y1 + r) {      // out through the nearest side
      const l = o.x - (x0 - r), rr = x1 + r - o.x, t = o.y - (y0 - r), b = y1 + r - o.y, m = Math.min(l, rr, t, b);
      if (m === l) o.x = x0 - r; else if (m === rr) o.x = x1 + r; else if (m === t) o.y = y0 - r; else o.y = y1 + r; }
    const ex = (o.x - POND[0]) / (POND[2] + r), ey = (o.y - POND[1]) / (POND[3] + r), e = Math.hypot(ex, ey);
    if (e < 1 && e > 0) { o.x = POND[0] + ex / e * (POND[2] + r); o.y = POND[1] + ey / e * (POND[3] + r); }
    o.x = clamp(o.x, WORLD.x0 + 60, WORLD.x1 - 60); o.y = clamp(o.y, WORLD.y0 + 140, WORLD.y1 - 50);
  };

  // ---------------- state ----------------
  const mkPlayer = (id, hero, bot, i) => { const H = HEROES[hero], a = i / 4 * Math.PI * 2 + 0.6;
    return { id, hero, bot: bot ? 1 : 0, x: C[0] + Math.cos(a) * 110, y: C[1] + Math.sin(a) * 90, vx: 0, vy: 0, fx: 0, fy: 1, dir: 0, dist: 0,
      hp: H.hp, hpMax: H.hp, down: 0, downT: 0, revP: 0, out: 0, inv: 0, hurtT: -9, dashT: -9, dashCD: 0, qT: -99, qOn: 0, qCD: 0, ult: 0, ultT: -99,
      atkT: 0, atkN: 0, atkSide: 1, lastAtk: -9, tier: 0, tokens: [], set: -1, hitN: 0, hitSet: [], fastT: -9, stillT: 0,
      m: { dmg: 1, as: 1, area: 1, spd: 1, pick: H.pick, armor: 1, regen: 0, crit: 0.04, cd: 1, extra: 0, rico: 1, pullN: 3, ttl: 1, deo: 1, shield: 0 },
      pick: null, pickT: 0, items: { sig: 1 }, fused: [], sigEvo: null, rerolls: 2, kq: 0, queue: 0, petN: 0, evo: 0, ultLock: 0, wcd: {}, vcd: 0, gasT: -9, buffT: -9, selfRes: 1,
      inBus: 0, gifts: {}, smol: 0, lsB: 0, album: [], shells: 0, gun: 0, att: {}, shop: 0, nadeT: -9, must: 1, mustR: 0, trim: null,
      st: { dmg: 0, ally: 0, allyHit: 0, rev: 0, downs: 0, xp: 0, kills: 0, gasIn: 0 },
      prev: {}, cam: [C[0] - VIEW.W / 2, C[1] - VIEW.H / 2], camV: [0, 0] }; };
  const newPlayer = (id, hero, bot, i) => { const p = mkPlayer(id, hero, bot, i); recalc(p); return p; };

  function create(cfg = {}) {
    SEED = (cfg.seed || 0) % 9973; useMap(cfg.map || 'park');
    const heroes = cfg.heroes || ORDER, S = { t: 0, steps: 0, wt0: 0, mode: cfg.mode || 'play', seed: cfg.seed || 0,
      map: LV.id, spor: SPORS[cfg.spor] ? cfg.spor : null, daily: cfg.daily ? 1 : 0, bus: null, endless: 0, swarmT: 0, score: 0, drinks: 0, kioskNext: 3, sporWon: 0,
      players: [], enemies: [], proj: [], eproj: [], clouds: [], zones: [], gems: [], marks: [], booms: [], nid: 1, rt: 0, pause: 0, pend: [], clear: 0, clearT: 0,
      wave: 1, waveT: 0, brk: 0, xp: 0, lvl: 1, xpNext: 6, eliteT: 20, chests: [], food: [], spawnAcc: 0, over: 0, won: 0, freeze: 0, kills: 0,
      comboT: -9, comboK: {}, sayT: -9, banter: 0, ev: [], awards: null, me: 0, solo: 0, cards: [], cardMiss: 0, barkQ: [], dealer: null, barber: null, barberW: 0, boss: null, cut: null, traps: [], bossWave: 0,
      found: ((cfg.meta && cfg.meta.found) || []).slice(), unlock: Object.assign({}, cfg.meta && cfg.meta.unlock) };
    heroes.forEach((h, i) => S.players.push(newPlayer(i, h, cfg.humans ? !cfg.humans.includes(i) : 1, i)));
    S.solo = S.players.filter((p) => !p.bot).length <= 1 && S.players.length === 1 ? 1 : 0;
    if (S.spor === 'smol') for (const p of S.players) { p.smol = 1; recalc(p); }
    S.xpNext = xpNeed(S, 1);
    return S;
  }
  // play mode: the local human is player 0 (hero from cfg), the other heroes are bots unless cfg.heroes says otherwise
  const spawn = (worldT, cfg = {}) => { const me = cfg.hero || 'hasan', rest = cfg.solo ? [] : ORDER.filter((h) => h !== me);
    const S = create({ heroes: [me, ...rest], humans: [0], meta: cfg.meta, spor: cfg.spor, seed: cfg.seed, daily: cfg.daily }); S.wt0 = worldT; S.solo = cfg.solo ? 1 : 0; return S; };
  const respawn = (S, worldT) => spawn(worldT, { hero: S.players[0].hero, solo: S.solo, meta: { found: S.found, unlock: S.unlock }, spor: S.spor, seed: S.seed, daily: S.daily });
  const outOfPlay = () => false;

  // ---------------- helpers ----------------
  const ev = (S, o) => { o.t = S.t; S.ev.push(o); };
  const alive = (p) => !p.down && !p.out && !p.inBus && !p.nat;
  // risk → reward: the spor's enemy factor, the night kiosk's energy drinks, the endless night's compounding waves
  const sporK = (S) => (SPORS[S.spor] && SPORS[S.spor].k) || 1;
  const scoreX = (S) => ((SPORS[S.spor] && SPORS[S.spor].x) || 1) * (1 + 0.1 * S.drinks);
  const enemyX = (S) => sporK(S) * (1 + 0.1 * S.drinks) * (S.endless ? Math.pow(1.12, S.wave - 2 * WAVES) : 1);
  const mkEnemy = (S, ty, x, y, hp, extra) => Object.assign({ id: S.nid++, type: ty, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp, hpMax: hp, r: ETYPES[ty].r * (S.spor === 'chonk' ? 1.4 : 1),
    hitT: -9, atkT: 0, slowT: -9, poisT: -9, born: S.t, dist: 0, face: 1, flee: 0, shotT: S.t + 2 + h1(S.nid) * 2, spawnT: S.t }, extra);
  const DOOR = [30, -14];                                                    // the bus's open door, from its base centre (bus_paz faces right)
  const GRID = 96;
  let grid = new Map();
  const buildGrid = (S) => { grid = new Map(); for (const e of S.enemies) { const k = Math.floor(e.x / GRID) * 4096 + Math.floor(e.y / GRID);
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(e); } };
  const near = (x, y, r, fn) => { const x0 = Math.floor((x - r) / GRID), x1 = Math.floor((x + r) / GRID), y0 = Math.floor((y - r) / GRID), y1 = Math.floor((y + r) / GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const a = grid.get(gx * 4096 + gy); if (a) for (const e of a) if (e.hp > 0 && dist(e.x, e.y, x, y) < r + e.r) fn(e); } };
  const nearest = (S, x, y, r, skip) => { let b = null, bd = r; near(x, y, r, (e) => { if (skip && skip.includes(e.id)) return; const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; b = e; } }); return b; };
  const inGas = (S, x, y, ownerSkip) => { for (const c of S.clouds) if (c.owner !== ownerSkip && S.t < c.t0 + c.ttl && S.t > c.t0 + 0.15 &&
    ((x - c.x) / c.r) ** 2 + ((y - c.y) / (c.r * 0.75)) ** 2 < 1) return c; return null; };
  // voice lines: a player speaks at most every ~20 s, the team at most every ~5 s, each category has its own chance and cooldown
  const SAY_P = { gas: 0.5, q: 0.35, lvl: 0.5, low: 0.7, wave: 0.6, revive: 0.8, ally_down: 0.8, cant_revive: 0.6, gas_reply: 1, banter: 1 };
  const SAY_CD = { gas: 25, low: 30, q: 30, cant_revive: 30 };
  const say = (S, p, cat, force) => {
    if (!p || p.out || (p.down && cat !== 'down')) return; p.ccd = p.ccd || {};             // knocked-out / downed heroes stay quiet
    // fewer heroes in the run → each one talks more (two friends should hear about as much chatter as four)
    const f = clamp(S.players.filter((q) => !q.out).length / 4, 0.4, 1);
    if (!force && (S.t < p.vcd || S.t - S.sayT < 5 || S.t < (p.ccd[cat] || 0) || h2(S.steps, p.id + 3) > (SAY_P[cat] ?? 0.8) / f)) return;
    if (force && S.t - S.sayT < 1.5) return;
    p.vcd = S.t + (16 + 10 * h2(S.steps, p.id)) * f; p.ccd[cat] = S.t + (SAY_CD[cat] || (cat.startsWith('combo') ? 60 : 12)) * f; S.sayT = S.t; ev(S, { k: 'say', who: p.hero, cat, v: Math.floor(h2(S.steps, p.id + 7) * 4), x: p.x, y: p.y, pid: p.id });
  };
  const combo = (S, key, x, y, p, bonus) => {
    if (S.t - (S.comboK[key] || -9) < 7) return; S.comboK[key] = S.t; S.comboT = S.t;
    ev(S, { k: 'combo', key, x, y, pid: p ? p.id : -1 }); if (p) { p.st.combo++; say(S, p, 'combo_' + key); }
    for (let i = 0; i < bonus; i++) S.gems.push({ id: S.nid++, x: x + 60 * (h2(S.steps, i) - 0.5), y: y + 50 * (h2(S.steps, i + 9) - 0.5), v: 2, t0: S.t });
  };
  let KB_T = 0; const kb = (e) => e.elite || e.boss || e.type === 'komissar' || KB_T < (e.rootT || 0) ? 0 : ETYPES[e.type].sc >= 1.5 ? 0.3 : 0.6;
  const hurtEnemy = (S, e, dmg, p, kind, kx = 0, ky = 0) => {
    if (e.hp <= 0 || S.t < (e.inv || 0)) return;
    if (e.boss && S.t < S.boss.vuln) dmg *= 2; if (S.t < (e.shieldT || 0)) dmg *= 0.25; if (p && S.t < (p.crisisT || 0)) dmg *= 0.8;
    if (e.boss) { bossHit(S, e, dmg); if (S.boss.ph < 3 && e.hp - dmg <= 1) { e.hitT = S.t; if (p) p.st.dmg += Math.max(0, e.hp - 1); e.hp = 1; return; } }   // a phase ends, the boss doesn't
    if (e.type === 'komissar' && e.hp - dmg <= 0) { e.hitT = S.t; if (p) p.st.dmg += dmg; freeLeha(S, e, 1); return; }
    if (S.marks.length && S.marks.some((m) => m.id === e.id && S.t < m.until)) dmg *= 1.5;
    if (S.t < (e.gooT || -9)) dmg *= 1.25;                                    // stuck in condensed milk
    let crit = 0; if (p && h2(S.steps + e.id, dmg) < p.m.crit) { dmg *= p.m.critX || 2; crit = 1; }
    KB_T = S.t; const k = kb(e); e.hp -= dmg; e.hitT = S.t; e.kx += kx * k; e.ky += ky * k; e.lastHit = p ? p.id : -1; e.lastKind = kind;
    if (p) { p.st.dmg += dmg; const kd = p.st.kd || (p.st.kd = {}); kd[kind] = (kd[kind] || 0) + dmg;     // kd: damage per source (balance telemetry)
      if (p.m.leech && alive(p) && p.lsB > 0) { const h = Math.min(dmg * p.m.leech, p.lsB, p.hpMax - p.hp); if (h > 0) { p.hp += h; p.lsB -= h; } }   // Кумыс
      if (p.hero === 'hasan' && !p.hitSet.includes(e.id)) { p.hitSet.push(e.id); if (p.hitSet.length > 8) p.hitSet.shift(); } }
    if (crit) ev(S, { k: 'crit', x: e.x, y: e.y });
    if (e.hp <= 0) killEnemy(S, e, p, kind);
  };
  const killEnemy = (S, e, p, kind) => {
    const T = ETYPES[e.type]; S.kills++; if (T.boss) { bossDead(S, e); for (const q of S.players) if (q.hero === 'leha') q.shells += 50; }
    if (p && p.hero === 'leha' && (kind === 'bullet' || kind === 'pellet' || kind === 'rocket')) { p.shellF = (p.shellF || 0) + (e.elite ? 12 : 0.6); const w = Math.floor(p.shellF); p.shells += w; p.shellF -= w; } if (p) { p.st.kills++; if (S.t > p.ultLock) p.ult = Math.min(1, p.ult + 0.0032 * T.xp); }
    S.score += Math.round(T.xp * 10 * (e.elite ? 10 : 1) * scoreX(S));
    ev(S, { k: 'kill', x: e.x, y: e.y, type: e.type, kind, pid: p ? p.id : -1, sc: T.sc });
    if (!e.run) S.gems.push({ id: S.nid++, x: e.x, y: e.y - 4, v: T.xp * (S.map === 'meleuz' ? 1.3 : 1), t0: S.t });     // stampede rats: no crystals
    if (e.elite || h2(e.id, S.steps) < 0.015) S.food.push({ id: S.nid++, x: e.x + 20, y: e.y + 10, t0: S.t });
    if (T.bomb) explode(S, e.x, e.y, 100, 0, null, 'bomb');
    { const dn = S.players.find((q) => q.hero === 'danil' && !q.out), have = dn ? [...dn.album, ...S.cards.map((c) => c.card)] : [];
      const left = PHOTOCARDS.filter((c) => !have.includes(c.id));
      if (e.elite && dn && left.length) { S.cardMiss = (S.cardMiss || 0); if (h2(e.id, S.steps + 7) < CARD_P + 0.25 * S.cardMiss) { S.cardMiss = 0;
          S.cards.push({ id: S.nid++, x: e.x - 50, y: e.y + 20, t0: S.t, card: left[Math.floor(h2(e.id, S.steps) * left.length)].id }); ev(S, { k: 'carddrop', x: e.x, y: e.y }); } else S.cardMiss++; } }
    // a cauldron every other wave
    if (e.elite && S.wave - (S.kettleW || -9) >= 2 && S.spor !== 'nokettle') { S.kettleW = S.wave; S.chests.push({ id: S.nid++, x: e.x, y: e.y, t0: S.t }); }
    if (e.elite) { for (let i = 0; i < 6; i++) S.gems.push({ id: S.nid++, x: e.x + 80 * (h2(S.steps, i) - 0.5), y: e.y + 60 * (h2(S.steps, i + 3) - 0.5), v: 3, t0: S.t }); }
  };
  const explode = (S, x, y, r, dmg, p, kind, M) => {
    ev(S, { k: 'boom', x, y, r, kind }); let first = null; const M0 = M ? Object.assign({}, M, { shock: 0 }) : null;
    if (dmg > 0) near(x, y, r, (e) => { const d = dist(e.x, e.y, x, y) || 1; hurtEnemy(S, e, dmg * (1 - 0.4 * d / r), p, kind, (e.x - x) / d * 260, (e.y - y) / d * 260);
      if (M0 && e.hp > 0) { applyMods(S, e, p, M0, dmg); if (!first) first = e; } });
    if (M && M.shock && first) zap(S, first, p, M.shock, dmg * 0.5);
    if (kind === 'bomb') for (const q of S.players) if (alive(q) && dist(q.x, q.y, x, y) < r) hurtPlayer(S, q, 18 * (1 + 0.06 * (S.wave - 1)) * enemyX(S), null);
  };
  // element effects on a hit: burn (damage over time), chill (slow), freeze (stop), charm, shock (chain lightning)
  const applyMods = (S, e, p, M, base) => { if (!M || !e) return; const t = S.t, big = ETYPES[e.type].sc >= 1.5 || e.elite;
    if (M.burn && e.hp > 0) { e.burnT = t + 3; e.burnD = Math.max(e.burnD || 0, (2.5 + 2 * M.burn) * (p ? p.m.dmg : 1)); e.burnBy = p ? p.id : -1; }
    if (M.chill) e.slowT = Math.max(e.slowT, t + 2);
    if (M.freeze && e.hp > 0 && h2(e.id, S.steps) < (M.freezeP || 0.3)) { e.freezeT = Math.max(e.freezeT || 0, t + (big ? 0.5 : 1.3)); ev(S, { k: 'freeze', x: e.x, y: e.y }); }
    if (M.charm && e.hp > 0) e.charmT = Math.max(e.charmT || 0, t + M.charm * (big ? 0.5 : 1));
    if (M.shock) zap(S, e, p, M.shock, base * 0.5); };
  const zap = (S, e0, p, n, dmg, fx, fy) => { const hit = [e0.id]; let a = e0;
    if (fx !== undefined) { ev(S, { k: 'zap', x: fx, y: fy, x2: e0.x, y2: e0.y - 40 }); hurtEnemy(S, e0, dmg, p, 'zap'); }
    for (let k = 0; k < n; k++) { const b = nearest(S, a.x, a.y, 230, hit); if (!b) break; hit.push(b.id); ev(S, { k: 'zap', x: a.x, y: a.y - 40, x2: b.x, y2: b.y - 40 }); hurtEnemy(S, b, dmg, p, 'zap'); a = b; } };
  const hurtPlayer = (S, p, dmg, src, ally) => {
    if (!alive(p) || (!ally && S.t < p.inv)) return;
    let d = dmg * p.m.armor; if (p.hero === 'leha') { if (p.stillT > 2) d *= 0.75; if (S.t - p.qT < 4 + p.m.shield) d *= 0.4; }
    if (S.spor === 'glass' && !ally) d = Math.max(d, p.hp);                   // «Хрустальный»: any hit puts you down
    if (ally) { d = Math.min(d, p.hp - 1); if (d <= 0) return; } else p.inv = S.t + 0.45;
    p.hp -= d; p.hurtT = S.t; p.hurtBy = ally ? 'gas' : src ? src.type : 'boom/spit'; ev(S, { k: 'hurt', x: p.x, y: p.y, pid: p.id, ally: ally ? 1 : 0 });
    if (p.hp <= 0) { p.hp = 0; p.down = 1; p.downT = 30; p.revP = 0; p.st.downs++; ev(S, { k: 'down', x: p.x, y: p.y, pid: p.id, by: p.hurtBy });
      say(S, p, 'down', true); const helper = S.players.find((q) => q !== p && alive(q) && q.hero !== 'vitya'); if (helper) S.allyDownSay = [S.t + 2.2, helper.id]; }
    else if (p.hp < p.hpMax * 0.25 && !ally) say(S, p, 'low');
  };
  const addCloud = (S, p, x, y, r, ttl, big, quiet) => { S.clouds.push({ id: S.nid++, owner: p.id, x, y, r, ttl: ttl * p.m.ttl, t0: S.t, big: big ? 1 : 0, trail: quiet ? 1 : 0, tick: 0, atick: 0,
      ign: p.m.smods && p.m.smods.ignite && (!quiet || (p.trN = (p.trN || 0) + 1) % 5 === 0) ? S.t + 0.9 : 0 });   // a trail flares every 3rd puff                  // «Газовая петарда»: the cloud flares up a moment later
    if (S.clouds.length > 48) S.clouds.shift(); if (!quiet) ev(S, { k: 'fart', x, y, pid: p.id, big: big ? 1 : 0 }); };

  // ---------------- hero attacks ----------------
  const every2 = (p, id, period) => { p.wcd[id] = (p.wcd[id] || 0) - DT; if (p.wcd[id] > 0) return false; p.wcd[id] = period; return true; };
  function heroStep(S, p, inp, t) {
    const as = p.m.as * (S.t < p.buffT ? 1.4 : 1), area = p.m.area;
    const tgt = nearest(S, p.x, p.y - 40, p.hero === 'hasan' ? 230 * area : p.hero === 'vitya' ? 0 : 760);
    if (tgt) { const d = dist(tgt.x, tgt.y, p.x, p.y) || 1; p.ax = (tgt.x - p.x) / d; p.ay = (tgt.y - p.y) / d; } else { p.ax = p.fx; p.ay = p.fy; }
    p.atkT -= DT;
    if (p.hero === 'hasan') {
      if (p.atkT <= 0 && tgt) { p.atkT = 0.62 / as; p.atkN++; p.atkSide = -p.atkSide; p.lastAtk = t;
        const ang = Math.atan2(p.ay, p.ax), R = 190 * area * p.m.sarea, pull = p.atkN % p.m.pullN === 0, n = 1 + p.m.extra;
        ev(S, { k: 'whip', pid: p.id, x: p.x, y: p.y, ang, side: p.atkSide, pull: pull ? 1 : 0, n, R });
        p.lash = { t: t + LASH_HIT, ang, R, pull, n }; }                 // the lash winds up over his head; damage lands on the snap
      if (p.lash && t >= p.lash.t) { const { ang, R, pull, n } = p.lash; p.lash = null;
        for (let k = 0; k < n; k++) { const a0 = ang + (k - (n - 1) / 2) * 0.55;
          near(p.x, p.y - 40, R, (e) => { const da = Math.atan2(e.y - (p.y - 40), e.x - p.x) - a0, dd = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
            if (dd > 0.75) return; const ex = p.x + Math.cos(a0) * 70, ey = p.y - 40 + Math.sin(a0) * 70;
            // «связал усами»: every lash may tie them up (the charged one — every pullN-th — much likelier); big ones and elites shake it off sooner
            if (h2(e.id, S.steps) < (pull ? 0.6 : 0.25)) { const big = ETYPES[e.type].sc >= 1.5 || e.elite; e.rootT = Math.max(e.rootT || 0, t + (big ? 0.7 : 1.6)); }
            hurtEnemy(S, e, 14 * p.m.dmg * p.m.sdmg, p, 'whip', Math.cos(a0) * 120, Math.sin(a0) * 120);
            if (p.m.smods && e.hp > 0) { const M = Object.assign({}, p.m.smods); if (p.lashZ) M.shock = 0; else if (M.shock) p.lashZ = 1; applyMods(S, e, p, M, 14 * p.m.dmg * p.m.sdmg); } }); }
        p.lashZ = 0;
        if (p.hitSet.length >= 5 && t - p.fastT > 6) { p.fastT = t; p.hitSet = []; } }
      // Q «Подкрутил усы»: two mustache blades spin close around him — a melee blender that shoves out and swats spit away (eproj loop)
      if (t - p.qT < 4) { if (Math.floor((t - p.qT) / 0.25) !== Math.floor((t - p.qT - DT) / 0.25))
        near(p.x, p.y - 30, 150 * area, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 8 * p.m.dmg, p, 'twirl', (e.x - p.x) / d * 300, (e.y - p.y) / d * 300); }); }
      // R «Усатое торнадо» is a travelling zone (S.zones, zoneStep)
    }
    if (p.hero === 'danil') {
      if (p.atkT <= 0 && tgt) { p.atkT = 0.55 / as * (p.set === 0 ? 0.85 : 1); p.lastAtk = t; const n = 1 + p.m.extra, ang = Math.atan2(p.ay, p.ax);
        for (let k = 0; k < n; k++) { const a = ang + (k - (n - 1) / 2) * 0.16;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: p.x + p.ax * 24, y: p.y - 50, vx: Math.cos(a) * 920, vy: Math.sin(a) * 920, dmg: 6.5 * p.m.dmg * p.m.sdmg * (1 + ALBUM_BONUS * p.album.length), ttl: 0.9, rico: p.m.rico + (p.set === 2 ? 1 : 0), pierce: p.m.pierce || 0, hit: [], tox: 0, c: (p.atkN + k) % 4,
            mods: p.m.smods, home: p.m.smods && p.m.smods.home ? 1 : 0 }); }
        p.atkN++; ev(S, { k: 'throw', pid: p.id, x: p.x, y: p.y }); }
      // R «Камбэк года»: a stage of 8 giant idol cards orbits him for 5 s — a fence that hits and shoves out whoever touches it, then the cards fly out
      const ua = t - p.ultT;
      if (ua < ULT_STAGE && Math.floor(ua / 0.12) !== Math.floor((ua - DT) / 0.12))
        for (let k = 0; k < 8; k++) { const [cx, cy] = stageCard(p, ua, k);
          near(cx, cy, 44, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 9 * p.m.dmg, p, 'card', (e.x - p.x) / d * 480, (e.y - p.y) / d * 480); }); }
      if (ua >= ULT_STAGE && ua - DT < ULT_STAGE)
        for (let k = 0; k < 8; k++) { const [cx, cy] = stageCard(p, ua, k), a = Math.atan2(cy - (p.y - 30), cx - p.x);
          S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: cx, y: cy - 20, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, dmg: 18 * p.m.dmg, ttl: 0.8, rico: 1, hit: [], tox: 0, c: k % 4 }); }
    }
    if (p.hero === 'vitya') {
      const solo = S.players.filter((q) => q !== p && alive(q) && dist(q.x, q.y, p.x, p.y) < 320).length;
      p.zone = 1 + 0.3 * Math.max(0, 1 - solo / 2);
      if (p.evo) { const moved = Math.hypot(p.x - (p.trX ?? 1e9), p.y - (p.trY ?? 1e9));
        if (moved > 46 || t - (p.trT || -9) > 0.6) { p.trX = p.x; p.trY = p.y; p.trT = t; p.lastAtk = t;
          addCloud(S, p, p.x - p.fx * 20, p.y - 10 - p.fy * 14, 98 * area * p.m.sarea, 2.8, 0, 1);
          const tr = S.clouds.filter((c) => c.trail && c.owner === p.id); if (tr.length > 7) S.clouds = S.clouds.filter((c) => !tr.slice(0, tr.length - 7).includes(c)); } }     // the trail: 7 puffs at most
      else if (p.atkT <= 0) { p.atkT = 3.4 * p.m.srate / as; p.lastAtk = t; addCloud(S, p, p.x - p.fx * 30, p.y - 10 - p.fy * 20, 85 * area * p.m.sarea, 4.2);
        if (p.m.double) addCloud(S, p, p.x + p.fy * 110, p.y - 10 - p.fx * 80, 75 * area * p.m.sarea, 4.2); }
      if (t - p.ultT > 0.95 && t - p.ultT - DT <= 0.95) addCloud(S, p, p.ux, p.uy, ULT_GAS * area, 6, 1);
    }
    if (p.hero === 'leha') {
      const g = S.t - p.ultT < 7 ? 5 : p.gun || 0, GA = p.m.gun || {}, rate = [0.5, 0.13, 1.0, 0.085, 1.4, 0.35][g] / (1 + (GA.rate || 0));
      if (S.t < p.nadeT && every2(p, 'nade', 1.1)) { const e2 = nearest(S, p.x, p.y, 520, []); if (e2) S.proj.push({ id: S.nid++, own: p.id, kind: 'petard', lob: 1, x: p.x, y: p.y - 50, vx: (e2.x - p.x) / 0.6, vy: (e2.y - 45 - p.y + 50) / 0.6, t0: t, ttl: 0.6, ttl0: 0.6, hit: [], r: 90 * area, dmg: 30 * p.m.dmg, mods: {}, wid: 'nade' }); }
      if (p.atkT <= 0 && tgt) { p.atkT = rate / as; p.lastAtk = t; p.atkN++; const ang = Math.atan2(p.ay, p.ax);
        const shot = (a, sp, dmg, kind, ttl) => S.proj.push({ id: S.nid++, own: p.id, kind, x: p.x + Math.cos(a) * 46, y: p.y - 52 + Math.sin(a) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: dmg * 1.2 * p.m.dmg * p.m.sdmg, ttl, rico: 0, hit: [], mods: p.m.smods, pierce: p.m.pierce });
        if (g === 0) shot(ang, 1300, 13, 'bullet', 0.6);
        if (g === 1) shot(ang + (h2(S.steps, 3) - 0.5) * 0.22 * (1 - (GA.tight || 0)), 1400, 6.5, 'bullet', 0.55);
        if (g === 2) { const n = 6 + (GA.pel || 0), sp = 0.11 * (1 - (GA.tight || 0)) * 6 / n; for (let k = 0; k < n; k++) shot(ang + (k - (n - 1) / 2) * sp + (h2(S.steps, k) - 0.5) * 0.06, 1150, 8, 'pellet', 0.32 * (1 + (GA.tight || 0) * 0.5)); }
        if (g === 3) shot(ang + (h2(S.steps, 5) - 0.5) * (p.stillT > 0.3 ? 0.06 : 0.2), 1500, 6, 'bullet', 0.6);
        if (g >= 4) shot(ang, 820, g === 5 ? 52 : 34, 'rocket', 1.1);
        if (p.evo) { if (g === 4 || g === 5) { shot(ang - 0.2, 800, 30, 'rocket', 1.1); shot(ang + 0.2, 800, 30, 'rocket', 1.1); } else if (p.atkN % 2 === 0) { shot(ang - 0.18, 1300, 9, 'bullet', 0.5); shot(ang + 0.18, 1300, 9, 'bullet', 0.5); } }
        ev(S, { k: 'shot', pid: p.id, x: p.x, y: p.y, ang, g }); }
    }
  }

  // weapon power from its level; evolved weapons start from a higher base (mult)
  const wpow = (p, id) => (WEAPONS[id].mult || 1) * (1 + 0.25 * (lv(p, id) - 1));
  function gearStep(S, p, t) {
    const as = p.m.as, area = p.m.area, every = (id, period) => { p.wcd[id] = (p.wcd[id] || 0) - DT; if (p.wcd[id] > 0) return false; p.wcd[id] = period; return true; };
    const crowd = (r) => { const list = []; near(p.x, p.y, r, (e) => list.push(e)); return list; };
    const lob = (kind, e, ttl, extra) => S.proj.push(Object.assign({ id: S.nid++, own: p.id, kind, lob: 1, x: p.x, y: p.y - 50, vx: (e.x - p.x) / ttl, vy: (e.y - 45 - p.y + 50) / ttl, t0: t, ttl, ttl0: ttl, hit: [] }, extra));
    p.petN = 0;
    for (const id of sharedW(p)) { const W = WEAPONS[id], l = lv(p, id), pw = wpow(p, id) * p.m.dmg, M = W.mods || {}, evo = W.from ? 1 : 0;
      // Тапок: a boomerang out and back, hitting on both passes
      if (W.b === 'tapok' && every(id, 2.4 / as)) { const n = 1 + (l >= 2) + evo, sp = l >= 3 ? 820 : 660;
        for (let k = 0; k < n; k++) { const e = nearest(S, p.x, p.y, 650, []); const a = e ? Math.atan2(e.y - p.y, e.x - p.x) + (k - (n - 1) / 2) * 0.6 : (k / n) * Math.PI * 2 + t;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'tapok', wid: id, mods: M, x: p.x, y: p.y - 50, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, t0: t, out: l >= 3 ? 0.65 : 0.55, dmg: 12 * pw, ttl: 3, hit: [], back: 0 }); }
        ev(S, { k: 'throw', pid: p.id, x: p.x, y: p.y }); }
      // Петарды: firecrackers lobbed at random enemies nearby (Салют / Северное сияние: fireworks falling out of the sky)
      if (W.b === 'petard' && every(id, (M.sky ? 1.7 : 2.1) / as)) { const list = crowd(M.sky ? 720 : 460), n = 2 + (l >= 2) + evo;
        for (let k = 0; k < Math.max(1, n - 1) && list.length; k++) { const e = list[Math.floor(h2(S.steps, k + p.id * 3) * list.length)];
          if (M.sky) S.proj.push({ id: S.nid++, own: p.id, kind: 'firework', lob: 1, sky: 1, x: e.x, y: e.y - 45, vx: 0, vy: 0, t0: t + k * 0.12, ttl: 0.6 + k * 0.12, ttl0: 0.6 + k * 0.12, hit: [], r: (M.boom || 85) * area, dmg: 14 * pw * n / Math.max(1, n - 1), mods: M, wid: id });
          else lob('petard', e, 0.5, { r: (M.boom || 50 + 8 * l) * area, dmg: 11 * pw * n / Math.max(1, n - 1), mods: M, wid: id }); } }
      // Энергетик: a can lobbed into the crowd: blast + chain lightning
      if (W.b === 'can' && every(id, 3.0 / as)) { const list = crowd(560), n = 1 + (l >= 2);
        for (let k = 0; k < n && list.length; k++) lob('can', list[Math.floor(h2(S.steps, k + p.id) * list.length)], 0.6, { r: 80 * area, dmg: 16 * pw, mods: { shock: 2 + (l >= 3 ? 2 : 0) }, wid: id }); }
      // Пломбир: scoops at the nearest enemies — chill, sometimes freeze (Жареное мороженое: they burst in fire and frost)
      if (W.b === 'icecream' && every(id, 1.15 / as)) { const n = 1 + (l >= 2) + evo, used = [];
        for (let k = 0; k < n; k++) { const e = nearest(S, p.x, p.y, 620, used); if (!e) break; used.push(e.id); const d = dist(e.x, e.y, p.x, p.y) || 1, sp = l >= 3 ? 760 : 620;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'scoop', x: p.x, y: p.y - 50, vx: (e.x - p.x) / d * sp, vy: (e.y - p.y) / d * sp, ttl: 1, hit: [], dmg: 9 * pw, mods: Object.assign({}, M, { freezeP: (M.freezeP || 0.15) + (l >= 3 ? 0.15 : 0) }), wid: id }); } }
      // Колонка: a bass pulse around the hero (Рейв: every beat throws lightning)
      if (W.b === 'speaker' && every(id, 1.7 / as)) { const R = 150 * area * (l >= 2 ? 1.2 : 1), hits = [];
        near(p.x, p.y - 30, R, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 8 * pw, p, 'bass', (e.x - p.x) / d * 220, (e.y - p.y) / d * 220); hits.push(e);
          if (l >= 3) e.freezeT = Math.max(e.freezeT || 0, t + 0.35); });
        if (M.shock) for (const e of hits.slice(0, 3)) zap(S, e, p, M.shock, 9 * pw, p.x, p.y - 60);
        ev(S, { k: 'bass', pid: p.id, x: p.x, y: p.y, r: R, wid: id }); }
      // Рафинад: a sugar cube ricocheting from enemy to enemy (lv 3: every bounce hits 20% harder; Жжёный сахар: burns and pops)
      if (W.b === 'sugar' && every(id, 1.6 / as)) { const n = 1 + (l >= 2) + evo, used = [];
        for (let k = 0; k < n; k++) { const e = nearest(S, p.x, p.y, 640, used); if (!e) break; used.push(e.id); const d = dist(e.x, e.y, p.x, p.y) || 1;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'sugar', wid: id, x: p.x, y: p.y - 50, vx: (e.x - p.x) / d * 860, vy: (e.y - p.y) / d * 860, ttl: 0.9, hit: [], dmg: 10 * pw,
            rico: 3 + (l >= 2 ? 2 : 0) + evo * 2, ramp: l >= 3 ? 1.2 : 1, mods: M }); } }
      // Трактор «Универсал»: drives through the crowd in a straight line and throws everyone aside (Электротрактор: shocks them)
      if (W.b === 'tractor' && every(id, 4.4 / as)) { const e = nearest(S, p.x, p.y, 700, []), a = e ? Math.atan2(e.y - p.y, e.x - p.x) : Math.atan2(p.fy, p.fx), n = l >= 3 ? 2 : 1, ca = Math.cos(a), sa = Math.sin(a);
        for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 130;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'tractor', wid: id, x: p.x - ca * 260 - sa * off, y: p.y - sa * 200 + ca * off, vx: ca * 560, vy: sa * 480, ttl: 2.0, hit: [], dmg: 22 * pw, r: (l >= 2 ? 70 : 56) * area, mods: M }); }
        ev(S, { k: 'tractor', pid: p.id, x: p.x, y: p.y }); }
      // Сгущёнка: a can lobbed into the crowd → a sticky puddle: enemies wade through it and take +25% from everything
      if (W.b === 'condensed' && every(id, 3.4 / as)) { const list = crowd(560), n = 1 + (l >= 3);
        for (let k = 0; k < n && list.length; k++) lob('condensed', list[Math.floor(h2(S.steps, k + p.id * 5) * list.length)], 0.6, { r: (l >= 2 ? 130 : 105) * area, dmg: 5 * pw, wid: id }); }
      // Голуби: pigeons circle the hero and dive at enemies (камикадзе: they blow up; Курлык-хор: their cooing stuns)
      if (W.b === 'pigeon') { const n = 1 + (l >= 2) + evo, out = S.proj.filter((b) => b.kind === 'pigeon' && b.own === p.id && b.wid === id).length;
        p.petN += Math.max(0, n - out);
        if (out < n && every(id, (l >= 3 ? 1.0 : 1.4) / as / n)) { const e = nearest(S, p.x, p.y, 440, S.proj.filter((b) => b.kind === 'pigeon').map((b) => b.tgt));
          if (e) S.proj.push({ id: S.nid++, own: p.id, kind: 'pigeon', wid: id, tgt: e.id, x: p.x + 40, y: p.y - 90, vx: 0, vy: -200, ttl: 2, hit: [], dmg: 14 * pw, r: (M.boom || 0) * area, mods: M }); }
        if (M.coo && every(id + ':coo', 2.4 / as)) { near(p.x, p.y - 30, 150 * area, (e) => { e.freezeT = Math.max(e.freezeT || 0, t + 0.8); hurtEnemy(S, e, 6 * pw, p, 'coo'); }); ev(S, { k: 'coo', pid: p.id, x: p.x, y: p.y, r: 150 * area }); } }
    }
    if (!p.evo) return;
    if (p.hero === 'hasan' && every('evo', 0.3)) near(p.x, p.y - 30, 170 * area, (e) => { if (h2(e.id, S.steps) < 0.04) e.rootT = Math.max(e.rootT || 0, t + 1); hurtEnemy(S, e, 7 * p.m.dmg * p.m.sdmg, p, 'twirl'); });
    if (p.hero === 'danil' && every('evo', 0.2)) for (let k = 0; k < 6; k++) { const a = t * 2.4 + k * Math.PI / 3, cx = p.x + Math.cos(a) * 130, cy = p.y - 40 + Math.sin(a) * 100;
      near(cx, cy, 34, (e) => hurtEnemy(S, e, 9 * p.m.dmg * p.m.sdmg, p, 'card')); }
  }

  function useQ(S, p, t) {
    // aim: Danil at the nearest crowd (charm cone), everyone else where he faces
    p.qa = p.hero === 'danil' && p.ax !== undefined ? Math.atan2(p.ay, p.ax) : p.hero === 'vitya' ? Math.atan2(-p.fy, -p.fx) : Math.atan2(p.fy, p.fx);
    p.qT = t; p.qCD = QCD[p.hero] * p.m.cd; ev(S, { k: 'q', pid: p.id, hero: p.hero, x: p.x, y: p.y, ang: p.qa }); say(S, p, 'q');
    const area = p.m.area, ca = Math.cos(p.qa), sa = Math.sin(p.qa);
    // Danil «Фан-чант»: a megaphone cone of hearts — enemies in it are charmed (stop, wander, take +50%), friends nearby get the fan buff
    if (p.hero === 'danil') { near(p.x, p.y, CHARM.r * area, (e) => { if (!inCone(p, e, p.qa, CHARM.r * area, CHARM.half)) return;
        const big = ETYPES[e.type].sc >= 1.5 || e.elite; e.charmT = t + CHARM.ttl * (big ? 0.5 : 1); S.marks.push({ id: e.id, until: e.charmT, by: p.id }); });
      for (const q of S.players) if (alive(q) && dist(q.x, q.y, p.x, p.y) < 320) q.buffT = Math.max(q.buffT, t + 4); }
    // Vitya «Залп по ветру»: a gas jet — shoves the cone back, poisons it and leaves a short trail of small clouds along the line
    if (p.hero === 'vitya') { near(p.x, p.y, JET.r * area, (e) => { if (!inCone(p, e, p.qa, JET.r * area, JET.half)) return; const d = dist(e.x, e.y, p.x, p.y);
        KB_T = t; const f = (1 - 0.5 * d / (JET.r * area)) * kb(e); e.kx += ca * 420 * f; e.ky += sa * 420 * f; e.poisT = t + 4; e.slowT = Math.max(e.slowT, t + 1.2); hurtEnemy(S, e, 6 * p.m.dmg * p.m.sdmg, p, 'gas'); });
      [[110, 55], [200, 62], [290, 70]].forEach(([d, r]) => addCloud(S, p, p.x + ca * d * area, p.y - 10 + sa * d * 0.75 * area, r * area, 5)); }
    // Лёха «Прикрыл!»: a riot shield in front — a bash on raise, then it blocks spit from the front while he walks behind it
    if (p.hero === 'leha') near(p.x + ca * 60, p.y - 20 + sa * 45, 110, (e) => { hurtEnemy(S, e, 10 * p.m.dmg, p, 'bash', ca * 560, sa * 560); e.slowT = Math.max(e.slowT, t + 1); });
  }
  function useUlt(S, p, t) {
    p.ult = 0; p.ultT = t; p.ultLock = t + 35 * p.m.cd; ev(S, { k: 'ult', pid: p.id, hero: p.hero, x: p.x, y: p.y }); say(S, p, 'ult', true);
    if (p.hero === 'vitya') { p.ux = p.x; p.uy = p.y - 10; ev(S, { k: 'warn', x: p.ux, y: p.uy, r: ULT_GAS * p.m.area, until: t + 0.95 }); }
    if (p.hero === 'danil') for (const q of S.players) if (alive(q) && dist(q.x, q.y, p.x, p.y) < 320) q.buffT = t + 6;
    if (p.hero === 'hasan') S.zones.push({ id: S.nid++, kind: 'tornado', owner: p.id, x: p.x + p.fx * 110, y: p.y + p.fy * 80, vx: p.fx * TORNADO.spd, vy: p.fy * TORNADO.spd * 0.75,
      t0: t, ttl: TORNADO.ttl, r: TORNADO.r * p.m.area });
  }
  // travelling zones: Hasan's tornado drifts where he faced, sucks small enemies into a spin, chips them, flings them at the end
  function zoneStep(S, t) {
    for (const z of S.zones) { const p = S.players.find((q) => q.id === z.owner); if (!p) { z.ttl = 0; continue; }
      if (z.kind === 'goo') { near(z.x, z.y, z.r, (e) => { e.slowT = Math.max(e.slowT, t + 0.25); e.gooT = t + 0.25; if ((S.steps + z.id) % 60 === 0) hurtEnemy(S, e, z.dmg, p, 'goo'); }); continue; }
      z.x += z.vx * DT; z.y += z.vy * DT; const zx = z.x, zy = z.y; collide(z, 20); if (z.x !== zx) z.vx *= -1; if (z.y !== zy) z.vy *= -1;
      const a = t - z.t0, R = z.r, end = a + DT >= z.ttl;
      near(z.x, z.y, R * 1.8, (e) => { const dx = e.x - z.x, dy = e.y - z.y, d = Math.hypot(dx, dy) || 1, big = ETYPES[e.type].sc >= 1.5 || e.elite;
        if (end) { if (d < R * 1.3) hurtEnemy(S, e, 34 * p.m.dmg, p, 'tornado', dx / d * 900, dy / d * 900); return; }
        if (!big) { const inw = d > R * 0.55 ? 1 : -0.4, k = d < R ? 1 : 0.55; e.kx += (-dy / d * 9 - dx / d * 5 * inw) * 30 * k; e.ky += (dx / d * 9 - dy / d * 5 * inw) * 30 * k; e.pullT = t; e.pullBy = p.id; }
        else e.slowT = t + 0.5;
        if (d < R && S.steps % 12 === 0) hurtEnemy(S, e, 6 * p.m.dmg, p, 'tornado'); });
      if (end) ev(S, { k: 'boom', x: z.x, y: z.y, r: R * 1.2, kind: 'tornado' }); }
    S.zones = S.zones.filter((z) => t < z.t0 + z.ttl);
  }

  // ---------------- bots (attract demo, empty co-op slots) ----------------
  function botInput(S, p) {
    const inp = {}; let mx = 0, my = 0;
    near(p.x, p.y, 330, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1, w = (330 - d) / 330; mx -= (e.x - p.x) / d * w * 2.2; my -= (e.y - p.y) / d * w * 2.2; });
    const team = S.players.filter((q) => q !== p && alive(q)); let cx = C[0], cy = C[1];
    if (team.length) { cx = team.reduce((a, q) => a + q.x, 0) / team.length; cy = team.reduce((a, q) => a + q.y, 0) / team.length; }
    const keep = p.hero === 'vitya' ? 380 : 190, dt = dist(cx, cy, p.x, p.y);
    if (dt > keep) { mx += (cx - p.x) / dt * 0.8; my += (cy - p.y) / dt * 0.8; } else if (p.hero === 'vitya' && dt < 260 && dt > 1) { mx -= (cx - p.x) / dt; my -= (cy - p.y) / dt; }
    for (const q of S.players) { if (q === p || q.out) continue; const d = dist(q.x, q.y, p.x, p.y) || 1; if (d < 170) { mx -= (q.x - p.x) / d * (170 - d) / 170 * 2.5; my -= (q.y - p.y) / d * (170 - d) / 170 * 2.5; } }
    const be = S.boss && S.boss.go && !S.boss.dead && !S.boss.hide && bossE(S);
    if (be) { const d = dist(be.x, be.y, p.x, p.y) || 1, want = (p.hero === 'hasan' ? 170 : 360) + be.r;      // a boss fight: hold a ring around the boss
      const k = d > want + 60 ? 1.6 : d < want - 60 ? -1.2 : 0; mx += (be.x - p.x) / d * k; my += (be.y - p.y) / d * k; }
    else { const dc = dist(C[0], C[1], p.x, p.y); if (dc > 900 && !S.bus) { mx += (C[0] - p.x) / dc * 0.6; my += (C[1] - p.y) / dc * 0.6; } }
    const down = S.players.find((q) => q.down && !q.out && p.hero !== 'vitya'); if (down) { const d = dist(down.x, down.y, p.x, p.y) || 1; if (d > 40) { mx += (down.x - p.x) / d * 2.4; my += (down.y - p.y) / d * 2.4; } }
    // the bus: pick friends up first; home only once the humans are aboard
    if (S.bus && !down && (S.bus.to === 'meleuz' || S.players.every((q) => q.bot || q.out || q.inBus))) {
      const bx = S.bus.x + DOOR[0], by = S.bus.y + DOOR[1], d = dist(bx, by, p.x, p.y) || 1; mx += (bx - p.x) / d * 7; my += (by - p.y) / d * 7; }
    let gb = null, gd = 260; for (const g of S.gems) { const d = dist(g.x, g.y, p.x, p.y); if (d < gd) { gd = d; gb = g; } }
    if (p.hero === 'hasan' && S.barber && !down) { const d = dist(S.barber.x, S.barber.y + 40, p.x, p.y) || 1; mx += (S.barber.x - p.x) / d * 3; my += (S.barber.y + 40 - p.y) / d * 3; }
    if (p.hero === 'leha' && S.dealer && !down && botWant(S, p) >= 0) { const d = dist(S.dealer.x, S.dealer.y, p.x, p.y) || 1; if (d > 90) { mx += (S.dealer.x - p.x) / d * 3; my += (S.dealer.y - p.y) / d * 3; } }
    for (const c of S.cards) { const d = dist(c.x, c.y, p.x, p.y); if (d < 600 && !down) { mx += (c.x - p.x) / d * 1.6; my += (c.y - p.y) / d * 1.6; break; } }   // photocards: worth a detour
    if (gb && !down) { mx += (gb.x - p.x) / gd * 0.7; my += (gb.y - p.y) / gd * 0.7; }
    if (p.hp < p.hpMax * 0.6) for (const f of S.food) { const d = dist(f.x, f.y, p.x, p.y); if (d < 500) { mx += (f.x - p.x) / d * 1.5; my += (f.y - p.y) / d * 1.5; break; } }
    const wob = Math.sin(S.t * 0.9 + p.id * 2.1); mx += wob * 0.25; my += Math.cos(S.t * 0.7 + p.id) * 0.25;
    if (Math.abs(mx) > 0.25) inp[mx > 0 ? 'right' : 'left'] = 1; if (Math.abs(my) > 0.25) inp[my > 0 ? 'down' : 'up'] = 1;
    let cnt = 0; near(p.x, p.y, 240, () => cnt++);
    if (cnt >= 4 && p.qCD <= 0) inp.q = 1;
    if (p.ult >= 1 && cnt >= 6) inp.r = 1;
    return inp;
  }
  const botPick = (p) => { const rank = (c) => ({ recipe: 0, fusion: 1, fission: 2, sig: 3, w: c.tag === 'НОВОЕ' ? 5 : 4, p: c.tag === 'НОВОЕ' ? 7 : 6, heal: 8, reroll: 99 })[c.kind];   // bots pick like a sensible player
    let b = 0; p.pick.forEach((c, i) => { if (rank(c) < rank(p.pick[b])) b = i; }); return b + 1; };
  // level-up / chest pick: the whole world waits until every player with a pending pick has chosen (S.t is frozen; S.rt keeps going)
  const PICK_AFK = 30;
  function pauseStep(S, inps) {
    for (const p of S.players) { if (!p.pick || p.out) continue;
      const inp = p.bot ? {} : (inps[p.id] || {});
      let slot = p.bot ? (S.rt - p.pickT > 1.2 ? botPick(p) : 0) : inp.slot;
      if (!(slot >= 1 && slot <= p.pick.length) && S.rt - p.pickT > PICK_AFK) slot = 1;                       // AFK: take the first card
      if (slot >= 1 && slot <= p.pick.length) applyPick(S, p, p.pick[slot - 1].id, S.t); }
  }

  // camera (per player, so every client follows its own hero)
  const camStep = (p) => { const tgx = clamp(p.x - VIEW.W / 2 + p.vx * 0.25, WORLD.x0, WORLD.x1 - VIEW.W), tgy = clamp(p.y - 60 - VIEW.H / 2 + p.vy * 0.2, WORLD.y0, WORLD.y1 - VIEW.H);
    p.camV[0] += (28 * (tgx - p.cam[0]) - 10.5 * p.camV[0]) * DT; p.cam[0] += p.camV[0] * DT;
    p.camV[1] += (28 * (tgy - p.cam[1]) - 10.5 * p.camV[1]) * DT; p.cam[1] += p.camV[1] * DT; };

  // ---------------- bosses (BOSSES.md): Влад — Король крыс (park, wave 10), Владимир Ильич (Мелеуз, wave 20) ----------------
  // A boss is an enemy (ETYPES boss: 1) driven by bossStep; everything the scene must see lives in S.boss (synced whole).
  // Cut-scenes (S.cut) freeze the world like a level-up pick; lines are ids into root.BLINES (live/blines.js, voiced files).
  const BL = root.BLINES || {}, TAU = Math.PI * 2;
  // a line holds for its voice file plus a beat (text-length guess only if it has no voice); E skips only once the voice has finished
  const voiceLen = (id) => (BL[id] && BL[id][2]) || clamp(1.4 + ((BL[id] || ['', ''])[1].length) * 0.06, 2.2, 6.5);
  const lineDur = (id) => voiceLen(id) + 0.6;
  const CUTS = {
    rk_in: ['rk_in_0', 'rk_in_1', 'rk_in_2', 'rk_in_3', 'rk_in_4'], rk_p2: ['rk_p2_0', 'rk_p2_1'], rk_p3: ['rk_p3_0', 'rk_p3_1', 'rk_p3_2'], rk_end: ['rk_end_0', 'rk_end_1'],
    ln_in: ['ln_in_0', 'ln_in_1', 'ln_in_2', 'ln_in_3', 'ln_in_4'], ln_b: ['ln_b_0', 'ln_b_1', 'ln_b_2', 'ln_b_3', 'ln_b_4'], ln_f: ['ln_f_0', 'ln_f_1', 'ln_f_2'],
    ln_p3: ['ln_p3'], ln_end: ['ln_end'], ln_solo: ['ln_b_0', 'ln_solo'],
    ln_npc: ['ln_n_0', 'ln_n_1', 'ln_n_2', 'ln_n_3', 'ln_n_4', 'ln_n_5'], ln_nf: ['ln_nf_0', 'ln_nf_1'] };
  const startCut = (S, key, fx, fy, then) => {
    const ids = CUTS[key].filter((id) => { const who = (BL[id] || [])[0]; return !HEROES[who] || S.players.some((p) => p.hero === who && !p.out); });
    S.cut = { key, ids, i: 0, t0: S.rt, fx, fy, then: then || null }; };
  const bark = (S, id, x, y) => ev(S, { k: 'bark', id, x, y });
  const heroNear = (S, x, y) => { let b = null, bd = 1e9; for (const p of S.players) if (alive(p)) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; b = p; } } return b; };
  const bossE = (S) => S.boss && S.enemies.find((e) => e.id === S.boss.id);
  function cutStep(S, inps) {
    const c = S.cut; let skip = false;
    for (const p of S.players) { if (p.bot || p.out) continue; const inp = inps[p.id] || {}, v = !!(inp.e || inp.act); if (v && !p.prevCut) skip = true; p.prevCut = v; }
    if (S.rt - c.t0 < lineDur(c.ids[c.i]) && !(skip && S.rt - c.t0 > voiceLen(c.ids[c.i]))) return;
    c.i++; c.t0 = S.rt; if (c.i < c.ids.length) return;
    S.cut = null; const then = c.then;
    if (then === 'go') { const e = bossE(S); if (e) e.inv = 0; S.boss.go = 1; S.boss.next = S.t + 1.5; }
    if (then === 'betray') betray(S);
    if (then === 'npc') npcKomissar(S);
    if (then === 'end') { S.bossWave = 0; S.clear = 1; S.clearT = 0; S.boss.gone = 1; ev(S, { k: 'clear', n: S.wave }); }
  }
  function startBoss(S) {
    const kind = S.map === 'park' ? 'vlad' : 'lenin', [x, y] = kind === 'vlad' ? [C[0], C[1] - 40] : LV.LENIN, T = ETYPES[kind];
    S.enemies = S.enemies.filter((e) => dist(e.x, e.y, x, y) > 700);
    const e = mkEnemy(S, kind, x, y, T.hp * hpScale(S), { boss: 1, inv: 9e9 }); S.enemies.push(e);
    S.bossWave = 1; S.traps = [];
    S.boss = { kind, id: e.id, ph: 1, atk: null, next: 9e9, lasers: [], rings: [], tiles: null, vuln: 0, hits: [], scared: 0, scareCD: 0, tauntT: S.t + 12, hide: 0, holeCD: 0,
      dash: null, km: null, n: 0, t0: S.t, said: {} };
    ev(S, { k: 'boss', kind, x, y }); startCut(S, kind === 'vlad' ? 'rk_in' : 'ln_in', x, y, 'go');
  }
  function bossDead(S, e) {
    const B = S.boss; B.dead = S.t; B.atk = null; B.lasers = []; B.rings = []; B.tiles = null; B.dx = e.x; B.dy = e.y;
    S.chests.push({ id: S.nid++, x: e.x + 60, y: e.y + 40, t0: S.t });
    for (const o of S.enemies) if (o.run || o.type === 'komissar') o.hp = 0;
    const km = B.km && S.players.find((p) => p.id === B.km.pid); if (km) { km.nat = 0; km.hp = km.hpMax * 0.5; km.inv = S.t + 2; B.km = null; }
    ev(S, { k: 'bossdead', kind: B.kind, x: e.x, y: e.y }); startCut(S, B.kind === 'vlad' ? 'rk_end' : 'ln_end', e.x, e.y, 'end');
  }
  const bossHit = (S, e, dmg) => { const B = S.boss; if (!B || e.id !== B.id) return; B.hits.push([S.t, dmg]); };
  // a rat stampede / ring: plain rats that run straight and vanish (they bite whoever they cross, once)
  const runner = (S, x, y, dx, dy, sp, ttl) => { if (blocked(x, y, 18)) return;
    S.enemies.push(mkEnemy(S, 'sprinter', x, y, ETYPES.sprinter.hp * hpScale(S) * 0.5, { run: [dx * sp, dy * sp], runEnd: S.t + ttl, hitP: [] })); };
  function runStep(S, e, t) {
    e.vx = e.run[0]; e.vy = e.run[1]; e.x += e.vx * DT; e.y += e.vy * DT; e.dist += Math.hypot(e.vx, e.vy) * DT; e.face = e.vx >= 0 ? 1 : -1;
    for (const p of S.players) if (alive(p) && !e.hitP.includes(p.id) && dist(p.x, p.y, e.x, e.y) < e.r + 26) { e.hitP.push(p.id); e.biteT = t; hurtPlayer(S, p, ETYPES.sprinter.dmg * 1.8 * enemyX(S), e); }
    if (t > e.runEnd || e.x < WORLD.x0 || e.x > WORLD.x1 || e.y < WORLD.y0 || e.y > WORLD.y1) e.hp = 0;
  }
  const lobAt = (S, x0, y0, tx, ty, ttl, kind, r, dmg, extra) => { S.eproj.push(Object.assign({ lob: 1, kind, x: x0, y: y0, vx: (tx - x0) / ttl, vy: (ty - 40 - y0) / ttl, ttl, ttl0: ttl, r, dmg }, extra));
    ev(S, { k: 'bwarn', x: tx, y: ty, r, until: S.t + ttl }); };
  const star = (S, x, y, a, sp, kind, dmg) => S.eproj.push({ kind, x, y: y - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, ttl: 5, dmg });

  function bossStep(S, e, t) {
    const T = ETYPES[e.type]; if (e.run) return runStep(S, e, t);
    if (e.type === 'komissar') return komStep(S, e, t);
    const B = S.boss; if (!B || B.dead) return;
    e.kx = e.ky = 0; B.hits = B.hits.filter((h) => t - h[0] < 2); B.hpf = e.hp / e.hpMax;
    if (!B.go) return;                                                        // waiting for its cut-scene
    if (T.boss && e.type === 'vlad') vladStep(S, e, t, B); else leninStep(S, e, t, B);
    // taunts: whoever is closest gets it (Vlad), Lenin only shouts his attack names
    if (e.type === 'vlad' && t > B.tauntT && !B.hide) { B.tauntT = t + 13 + 6 * h1(S.steps); const p = heroNear(S, e.x, e.y);
      const id = p && h1(S.steps + 3) < 0.55 ? 'rk_t_' + p.hero : 'rk_t_' + Math.floor(h1(S.steps + 5) * 3); bark(S, id, e.x, e.y); B.taunt = t; }
  }

  // ---- Влад ----
  const HOLE_R = [[520, 0], [-520, 0], [0, 400], [0, -400]];
  const holes = () => HOLE_R.map(([dx, dy]) => [C[0] + dx, C[1] + dy]);
  function vladStep(S, e, t, B) {
    const down = e.hp <= 1, refill = () => { e.hp = e.hpMax; B.hits = []; ev(S, { k: 'phase', ph: B.ph, x: e.x, y: e.y }); };
    if (B.ph === 1 && down) { B.ph = 2; refill(); B.atk = null; B.next = t + 2; e.r = 30;                       // the throne falls apart — into rats
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; S.enemies.push(mkEnemy(S, 'ghoul', e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 70, ETYPES.ghoul.hp * hpScale(S))); }
      ev(S, { k: 'boom', x: e.x, y: e.y, r: 170, kind: 'dust' }); startCut(S, 'rk_p2', e.x, e.y); return; }
    if (B.ph === 2 && down) { B.ph = 3; refill(); B.atk = null; B.next = t + 2.5; e.r = 64; B.hide = 0; e.inv = 0; e.vx = e.vy = 0; startCut(S, 'rk_p3', e.x, e.y); return; }
    const tg = heroNear(S, e.x, e.y); if (!tg) return;
    const d = dist(tg.x, tg.y, e.x, e.y) || 1, ux = (tg.x - e.x) / d, uy = (tg.y - e.y) / d;
    // scared: a burst of damage makes him cower for a second (and dive into a sewer when he can)
    const burst = B.hits.reduce((a, h) => a + h[1], 0);
    if (burst > e.hpMax * 0.06 && t > B.scareCD) { B.scareCD = t + 7; B.scared = t + 1.1; bark(S, 'rk_s_' + Math.floor(h1(S.steps) * 3), e.x, e.y); if (B.ph === 2) B.holeCD = Math.min(B.holeCD, t + 1.2); }
    // the sewer: under the ground he can't be hit; he comes out of the manhole farthest from the team
    if (B.hide) { if (t >= B.hide) { let best = null, bd = -1; for (const h of holes()) { const q = heroNear(S, h[0], h[1]), dd = q ? dist(q.x, q.y, h[0], h[1]) : 0; if (dd > bd) { bd = dd; best = h; } }
        e.x = best[0]; e.y = best[1] + 10; B.hide = 0; e.inv = 0; ev(S, { k: 'hole', x: best[0], y: best[1], out: 1 }); } return; }
    if (B.dash) { e.x += B.dash.vx * DT; e.y += B.dash.vy * DT; collide(e, 24);
      for (const p of S.players) if (alive(p) && !B.dash.hit.includes(p.id) && dist(p.x, p.y, e.x, e.y) < 85) { B.dash.hit.push(p.id); hurtPlayer(S, p, 34 * enemyX(S), e); p.vx += B.dash.vx * 0.5; p.vy += B.dash.vy * 0.5; }
      if (t > B.dash.until) B.dash = null; return; }
    if (t < B.scared) return;
    // movement per phase
    let mx = 0, my = 0, sp = 0;
    if (B.ph === 1) { sp = 55; const want = 320; mx = d > want ? ux : -ux; my = d > want ? uy : -uy; if (Math.abs(d - want) < 40) mx = my = 0; }
    if (B.ph === 2) { sp = 215;
      if (d < 190 && t > B.holeCD) { B.holeCD = t + 9; B.hide = t + 1.3; e.inv = t + 99; ev(S, { k: 'hole', x: e.x, y: e.y }); bark(S, 'rk_hole', e.x, e.y); return; }
      const want = 400; mx = (d > want ? ux : -ux) - uy * 0.6; my = (d > want ? uy : -uy) + ux * 0.6; }
    if (B.ph === 3) {                                                         // the rat-king ball: rolls at you, bounces off the square's edge
      e.vx += ux * 520 * DT; e.vy += uy * 520 * DT; const v = Math.hypot(e.vx, e.vy), vm = 430; if (v > vm) { e.vx *= vm / v; e.vy *= vm / v; }
      const ox = e.x, oy = e.y; e.x += e.vx * DT; e.y += e.vy * DT; e.x = clamp(e.x, C[0] - 1100, C[0] + 1100); e.y = clamp(e.y, C[1] - 760, C[1] + 760); collide(e, 50);
      if (e.x !== ox + e.vx * DT) e.vx *= -0.8; if (e.y !== oy + e.vy * DT) e.vy *= -0.8; e.dist += v * DT;
      for (const p of S.players) if (alive(p) && dist(p.x, p.y, e.x, e.y) < e.r + 30 && t > (p.ballT || 0)) { p.ballT = t + 0.8; hurtPlayer(S, p, 36 * enemyX(S), e); p.vx += e.vx * 1.2; p.vy += e.vy * 1.2; } }
    else if (sp) { const l = Math.hypot(mx, my) || 1; e.vx = mx / l * sp; e.vy = my / l * sp; e.x += e.vx * DT; e.y += e.vy * DT; e.dist += sp * DT * (mx || my ? 1 : 0); collide(e, 24);
      e.x = clamp(e.x, C[0] - 1300, C[0] + 1300); e.y = clamp(e.y, C[1] - 900, C[1] + 900); }
    if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
    // attacks
    if (!B.atk && t >= B.next) { const list = B.ph === 1 ? ['lanes', 'cheese', 'summon'] : B.ph === 2 ? ['dash', 'traps', 'cheese', 'dash'] : ['ring', 'cheese', 'lanes'];
      B.atk = { k: list[B.n++ % list.length], t0: t }; const A = B.atk;
      if (A.k === 'lanes') { const a = Math.atan2(uy, ux) + (h1(S.steps) < 0.5 ? Math.PI / 2 : 0), ax = Math.cos(a), ay = Math.sin(a) * 0.75, al = Math.hypot(ax, ay);
        A.ax = ax / al; A.ay = ay / al; A.cx = tg.x - A.ax * 1050; A.cy = tg.y - A.ay * 1050; A.gaps = [0, 1, 2].map((j) => [(h1(S.steps + j * 7) - 0.5) * 900, (h1(S.steps + j * 7 + 3) - 0.5) * 900]);
        ev(S, { k: 'lanes', x: A.cx, y: A.cy, ax: A.ax, ay: A.ay, gaps: A.gaps, until: t + 1.1 }); if (h1(S.steps + 1) < 0.5) bark(S, 'rk_wave', e.x, e.y); }
      if (A.k === 'cheese') { const up = S.players.filter(alive), n = B.ph === 3 ? 6 : 4;
        for (let k = 0; k < n; k++) { const p = up[k % up.length], ox = (h1(S.steps + k) - 0.5) * 240, oy = (h1(S.steps + k + 9) - 0.5) * 180;
          lobAt(S, ...vladHand(e, B), p.x + p.vx * 0.6 + ox, p.y + p.vy * 0.6 + oy, 1.0 + k * 0.15, 'cheese', 110, 16 * enemyX(S), { slow: 1 }); } }
      if (A.k === 'summon') { for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; const x = e.x + Math.cos(a) * 130, y = e.y + Math.sin(a) * 100; if (!blocked(x, y, 20)) S.enemies.push(mkEnemy(S, 'ghoul', x, y, ETYPES.ghoul.hp * hpScale(S))); }
        ev(S, { k: 'summon', x: e.x, y: e.y }); }
      if (A.k === 'dash') { const L = Math.min(800, d + 250); A.tx = e.x + ux * L; A.ty = e.y + uy * L; ev(S, { k: 'bline', x: e.x, y: e.y, x2: A.tx, y2: A.ty, w: 170, until: t + 0.7 }); }
      if (A.k === 'traps') { if (!B.said.trap) { B.said.trap = 1; bark(S, 'rk_trap', e.x, e.y); }
        S.players.filter(alive).forEach((p, k) => { for (let j = 0; j < 2; j++) { const a = Math.atan2(p.fy, p.fx) + (j - 0.5) * 1.1 + (h1(S.steps + k * 3 + j) - 0.5) * 0.6, r = 140 + 90 * h1(S.steps + k + j * 5);
          const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r * 0.75; if (!blocked(x, y, 20)) S.traps.push({ id: S.nid++, x, y, t0: t, arm: t + 0.5, snap: 0 }); } });
        if (S.traps.length > 14) S.traps.splice(0, S.traps.length - 14); }
      if (A.k === 'ring') { const g0 = Math.floor(h1(S.steps) * 18); for (let k = 0; k < 18; k++) { if ((k - g0 + 18) % 6 < 2) continue; const a = k / 18 * TAU; runner(S, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 50, Math.cos(a), Math.sin(a) * 0.75, 400, 3.5); }
        ev(S, { k: 'summon', x: e.x, y: e.y }); } }
    const A = B.atk; if (!A) return;
    if (A.k === 'lanes' && t >= A.t0 + 1.1) { const px = -A.ay, py = A.ax;
      for (let row = 0; row < 3; row++) for (let s = -700; s <= 700; s += 78) { if (Math.abs(s - A.gaps[row][0]) < 110 || Math.abs(s - A.gaps[row][1]) < 110) continue;
        runner(S, A.cx + px * s - A.ax * row * 170, A.cy + py * s - A.ay * row * 170, A.ax, A.ay, 520, 4.6); }
      B.atk = null; B.next = t + 3.4; }
    else if (A.k === 'dash' && t >= A.t0 + 0.7) { const dd = dist(A.tx, A.ty, e.x, e.y) || 1; B.dash = { vx: (A.tx - e.x) / dd * 1150, vy: (A.ty - e.y) / dd * 1150, until: t + dd / 1150, hit: [] }; B.atk = null; B.next = t + 2.6; }
    else if (A.k !== 'lanes' && A.k !== 'dash' && t >= A.t0 + 0.8) { B.atk = null; B.next = t + (B.ph === 3 ? 2.6 : 3.2); }
  }

  // ---- Владимир Ильич ----
  // a shock ring's safe gaps: a fixed walkable width (ground px) whatever the ring's size — narrow, but a hero fits
  const RING_GAP = 72, inGap = (R, a, r) => { const h = Math.min(0.7, RING_GAP / Math.max(1, r)); return R.gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < h); };
  const LAS_W = 30, LAS_GROUND = 280;                    // the beams leave his eyes and hit the paving LAS_GROUND px out from the pedestal
  // where things leave the boss sprites (measured on the art): Ilyich's fist lands in front of the pedestal; Vlad throws from the plunger tip
  const FIST = (e) => [e.x - 27, e.y + 15];
  const vladHand = (e, B) => B.ph === 1 ? [e.x + 54, e.y - 262] : B.ph === 3 ? [e.x + 60, e.y - 256] : [e.x + 30 * e.face, e.y - 118];
  const laserHits = (S, B, e, t) => { for (const L of B.lasers) { if (t < L.on) continue; const ca = Math.cos(L.a), sa = Math.sin(L.a);
      for (const p of S.players) { if (!alive(p)) continue; const dx = p.x - e.x, dy = (p.y - e.y) / 0.75, along = dx * ca + dy * sa, perp = Math.abs(-dx * sa + dy * ca);
        if (along > LAS_GROUND && along < 1700 && perp < LAS_W + 16) hurtPlayer(S, p, 12 * enemyX(S), e); } } };
  function leninStep(S, e, t, B) {
    const down = e.hp <= 1, refill = () => { e.hp = e.hpMax; B.hits = []; ev(S, { k: 'phase', ph: B.ph, x: e.x, y: e.y }); }; e.vx = e.vy = 0; e.x = LV.LENIN[0]; e.y = LV.LENIN[1];
    if (B.ph === 1 && down) { B.ph = 2; refill(); B.atk = null; B.lasers = []; B.next = t + 3; leninSides(S, e); return; }
    if (B.ph === 2 && down) { B.ph = 3; refill(); B.atk = null; B.lasers = []; B.next = t + 3; B.world = t + 2; B.rev = t + 11; startCut(S, 'ln_p3', e.x, e.y); return; }
    // lasers turn; «Революционный поворот» / «Мировая революция»: they stop, show the new way, and turn back
    for (const L of B.lasers) if (t >= L.on && !(L.hold > t)) L.a += L.spin * DT;
    if (B.world && t >= B.world && !B.lasers.some((L) => L.world)) { const a0 = h1(S.steps) * TAU; B.lasers.push({ a: a0, on: t + 1.2, spin: 0.38, world: 1 }, { a: a0 + Math.PI, on: t + 1.2, spin: 0.38, world: 1 }); bark(S, 'ln_laser', e.x, e.y); }
    if (B.world && t >= B.rev) { B.rev = t + 9; for (const L of B.lasers) if (L.world) { L.hold = t + 0.8; L.spin = -L.spin; } }
    laserHits(S, B, e, t);
    // shock rings from the fist: they roll outward; the gaps are where you stand
    for (const R of B.rings) { const r = (t - R.t0) * R.sp; if (r < 0) continue; for (const p of S.players) { if (!alive(p) || R.hit.includes(p.id)) continue;
        const dx = p.x - (R.x ?? e.x), dy = (p.y - (R.y ?? e.y)) / 0.75, d = Math.hypot(dx, dy); if (Math.abs(d - r) > 30) continue; const a = Math.atan2(dy, dx);
        if (inGap(R, a, d)) continue; R.hit.push(p.id); hurtPlayer(S, p, 16 * enemyX(S), e); } }
    B.rings = B.rings.filter((R) => (t - R.t0) * R.sp < 1600);
    // «Красный октябрь»: the paving goes red cell by cell; burning cells hurt, the safe ones move every cycle
    if (B.tiles) { const Tl = B.tiles, a = t - Tl.t0;
      if (a > 2.6) { Tl.n++; Tl.t0 = t; Tl.seed = S.steps; if (Tl.n >= 3) B.tiles = null; }
      else if (a > 1.0) for (const p of S.players) { if (!alive(p)) continue; const cx = Math.floor((p.x - Tl.x0) / Tl.cs), cy = Math.floor((p.y - Tl.y0) / Tl.cs);
        if (cx >= 0 && cy >= 0 && cx < Tl.nx && cy < Tl.ny && hotCell(Tl, cx, cy)) hurtPlayer(S, p, 13 * enemyX(S), e); } }
    // «Пятилетка»: five strikes under the team, each one faster
    const A = B.atk;
    if (A && A.k === 'five') { if (A.i < 5 && t >= A.nextW) { const up = S.players.filter(alive), p = up[A.i % Math.max(1, up.length)];
        if (p) { const dl = [1.0, 0.85, 0.7, 0.55, 0.42][A.i]; A.q.push([p.x + p.vx * 0.3, p.y + p.vy * 0.3, t + dl]); ev(S, { k: 'bwarn', x: p.x + p.vx * 0.3, y: p.y + p.vy * 0.3, r: 115, until: t + dl, red: 1 }); A.nextW = t + dl * 0.75; } A.i++; }
      for (const q of A.q) if (q[2] && t >= q[2]) { q[2] = 0; ev(S, { k: 'boom', x: q[0], y: q[1], r: 115, kind: 'red' }); for (const p of S.players) if (alive(p) && dist(p.x, p.y, q[0], q[1]) < 115) hurtPlayer(S, p, 18 * enemyX(S), e); }
      if (A.i >= 5 && A.q.every((q) => !q[2])) { B.atk = null; B.next = t + 1.8; } return; }
    if (A && A.k === 'coll') { if (t >= A.t0 + 3.2 && !A.hit) { A.hit = 1; B.lasers = B.lasers.filter((L) => !L.coll); const x = e.x + Math.cos(A.a) * 430, y = e.y + Math.sin(A.a) * 430 * 0.75;
        A.sx = x; A.sy = y; ev(S, { k: 'bwarn', x, y, r: 230, until: t + 0.8, red: 1 }); A.boom = t + 0.8; }
      if (A.boom && t >= A.boom) { A.boom = 0; ev(S, { k: 'boom', x: A.sx, y: A.sy, r: 230, kind: 'slam' }); for (const p of S.players) if (alive(p) && dist(p.x, p.y, A.sx, A.sy) < 230) hurtPlayer(S, p, 26 * enemyX(S), e); B.atk = null; B.next = t + 2; }
      return; }
    if (A && A.k === 'fist' && !A.done && t >= A.t0 + 0.9) { A.done = 1; const [fx, fy] = FIST(e); ev(S, { k: 'boom', x: fx, y: fy, r: 200, kind: 'slam' });
      for (let j = 0; j < (B.ph === 3 ? 4 : 3); j++) B.rings.push({ t0: t + j * 0.5, sp: 430, x: fx, y: fy, gaps: [0, 1, 2].map((k) => h1(S.steps + j * 5 + k) * TAU), hit: [] }); }
    if (A && A.k === 'march' && A.i < 3 && t >= A.t0 + A.i * 0.5) { const g0 = Math.floor(h1(S.steps + A.i) * 24), g1 = (g0 + 12) % 24;
      for (let k = 0; k < 24; k++) { if ((k - g0 + 24) % 24 < 3 || (k - g1 + 24) % 24 < 3) continue; star(S, e.x, e.y, k / 24 * TAU + A.i * 0.13, 290, 'star', 11 * enemyX(S)); } A.i++; }
    if (A && t >= A.end) { B.atk = null; B.next = t + (B.ph === 3 ? 1.6 : 2.2); if (A.k === 'decree') { B.vuln = t + 4; ev(S, { k: 'vuln', x: e.x, y: e.y }); B.next = t + 4.5; } }
    if (!B.atk && t >= B.next) { const list = B.ph === 1 ? ['gaze', 'fist', 'march'] : B.ph === 2 ? ['five', 'gaze', 'coll', 'fist', 'turn', 'march'] : ['oct', 'march', 'fist', 'decree'];
      const k = list[B.n++ % list.length], tg = heroNear(S, e.x, e.y), a0 = tg ? Math.atan2((tg.y - e.y) / 0.75, tg.x - e.x) : 0, N = { t0: t, k };
      B.atk = N;
      if (k === 'gaze' || k === 'turn') { const s = h1(S.steps) < 0.5 ? 0.45 : -0.45; B.lasers = [{ a: a0 - 0.6, on: t + 1.3, spin: s }, { a: a0 + 0.6, on: t + 1.3, spin: s }]; N.end = t + 6;
        if (k === 'turn') N.flip = t + 3.4; if (!B.said.laser) { B.said.laser = 1; bark(S, 'ln_laser', e.x, e.y); } }
      if (k === 'fist') { N.end = t + 3.2; const [fx, fy] = FIST(e); ev(S, { k: 'bwarn', x: fx, y: fy, r: 200, until: t + 0.9, red: 1 }); }
      if (k === 'march') { N.i = 0; N.end = t + 1.8; }
      if (k === 'five') { N.i = 0; N.q = []; N.nextW = t + 0.3; bark(S, 'ln_five', e.x, e.y); }
      if (k === 'coll') { N.a = a0; B.lasers.push({ a: a0 - 1.3, on: t + 0.8, spin: 0.43, coll: 1 }, { a: a0 + 1.3, on: t + 0.8, spin: -0.43, coll: 1 }); bark(S, 'ln_coll', e.x, e.y); }
      if (k === 'oct') { B.tiles = { x0: e.x - 900, y0: e.y - 640, cs: 150, nx: 12, ny: 9, t0: t, n: 0, seed: S.steps }; N.end = t + 7.8; bark(S, 'ln_oct', e.x, e.y); }
      if (k === 'decree') { N.end = t + 4.2; N.i = 0; bark(S, 'ln_decree', e.x, e.y);
        B.rings.push({ t0: t + 0.6, sp: 470, gaps: [a0, a0 + 2.1, a0 + 4.2], hit: [] }, { t0: t + 1.6, sp: 470, gaps: [a0 + 1, a0 + 3.1, a0 + 5.2], hit: [] }); N.k2 = 'march'; } }
    if (B.atk && B.atk.flip && t >= B.atk.flip) { B.atk.flip = 0; for (const L of B.lasers) { L.hold = t + 0.7; L.spin = -L.spin; } }
    if (B.atk && B.atk.k === 'gaze' || B.atk && B.atk.k === 'turn') { if (t >= B.atk.end - 0.1) B.lasers = B.lasers.filter((L) => L.world); }
    if (B.atk && B.atk.k === 'decree' && B.atk.i < 3 && t >= B.atk.t0 + 1 + B.atk.i * 0.6) { const i = B.atk.i++; for (let k = 0; k < 20; k++) { if (k % 5 === i) continue; star(S, e.x, e.y, k / 20 * TAU + i * 0.2, 320, 'star', 11 * enemyX(S)); } }
  }
  const hotCell = (Tl, cx, cy) => { const dx = (cx + 0.5) * Tl.cs + Tl.x0 - LV.LENIN[0], dy = (cy + 0.5) * Tl.cs + Tl.y0 - LV.LENIN[1];
    if (Math.hypot(dx, dy) < 170) return false; return h2(Tl.seed + cx * 17, cy * 31 + Tl.n) < 0.5; };

  // ---- Лёха — «Красный комиссар» ----
  function leninSides(S, e) {
    const L = S.players.find((p) => p.hero === 'leha' && !p.out);
    if (!L) { startCut(S, 'ln_npc', LV.LENIN[0], LV.LENIN[1], 'npc'); return; }     // no Лёха in the party (or he's out): the party has its own
    const humans = S.players.filter((p) => !p.bot && !p.out);
    if (!L.bot && humans.length === 1) { startCut(S, 'ln_solo', L.x, L.y); L.crisisT = S.t + 10; return; }      // alone at the keyboard: he stays himself, with a doubt
    startCut(S, 'ln_b', L.x, L.y, 'betray');
  }
  function betray(S) {
    const L = S.players.find((p) => p.hero === 'leha' && !p.out); if (!L || !S.boss) return;
    if (L.down) { L.down = 0; L.hp = L.hpMax; L.revP = 0; ev(S, { k: 'revive', pid: L.id, by: L.id, x: L.x, y: L.y }); }      // the party raises its fallen comrade
    const few = S.players.filter((p) => !p.bot && !p.out).length <= 2;
    const e = mkEnemy(S, 'komissar', L.x, L.y, ETYPES.komissar.hp * hpScale(S) * (few ? 0.55 : 1), {}); S.enemies.push(e);
    L.nat = 1; L.vx = L.vy = 0; S.boss.km = { eid: e.id, pid: L.id, mode: 0, until: S.t + (few ? 25 : 45), atk: null, next: S.t + 1.5, aim: 0 };
    ev(S, { k: 'betray', pid: L.id, x: L.x, y: L.y });
  }
  // the party's own Лёха: a commissar who walks out from behind the monument; beaten, he gives up and leaves
  function npcKomissar(S) {
    const few = S.players.filter((p) => !p.bot && !p.out).length <= 2, x = LV.LENIN[0] + 140, y = LV.LENIN[1] + 160;
    const e = mkEnemy(S, 'komissar', x, y, ETYPES.komissar.hp * hpScale(S) * (few ? 0.55 : 1), {}); S.enemies.push(e);
    S.boss.km = { eid: e.id, pid: -1, npc: 1, mode: 0, until: 9e9, atk: null, next: S.t + 1.5, aim: 0 }; ev(S, { k: 'betray', pid: -1, x, y });
  }
  function freeLeha(S, e, beaten) {
    const B = S.boss, K = B && B.km; if (!K) return; const L = S.players.find((p) => p.id === K.pid); e.hp = 0; B.km = null;
    if (K.npc) { ev(S, { k: 'boom', x: e.x, y: e.y, r: 120, kind: 'dust' }); startCut(S, 'ln_nf', e.x, e.y); return; }
    if (!L) return; L.nat = 0; L.x = e.x; L.y = e.y; L.hp = L.hpMax * 0.5; L.inv = S.t + 2; if (!beaten) L.rootT = S.t + 2;
    ev(S, { k: 'freed', pid: L.id, x: L.x, y: L.y }); if (beaten) startCut(S, 'ln_f', L.x, L.y); else bark(S, 'ln_f_0', LV.LENIN[0], LV.LENIN[1]);
  }
  function komStep(S, e, t) {
    const B = S.boss, K = B && B.km; if (!K || K.eid !== e.id) { e.hp = 0; return; }
    if (t >= K.until) return freeLeha(S, e, 0); K.hpf = e.hp / e.hpMax;
    const L = S.players.find((p) => p.id === K.pid); if ((K.npc || (L && L.bot)) && t > (K.botMode || 0)) { K.botMode = t + 10; K.mode = (K.mode + 1) % 3; }
    const tg = heroNear(S, e.x, e.y); if (!tg) return; const d = dist(tg.x, tg.y, e.x, e.y) || 1, ux = (tg.x - e.x) / d, uy = (tg.y - e.y) / d;
    const A = K.atk, still = A && A.k === 'speech';
    if (!still) { let mx = 0, my = 0;
      if (K.mode === 0) { mx = d > 230 ? ux : 0; my = d > 230 ? uy : 0; }
      if (K.mode === 1) { mx = d > 470 ? ux : d < 380 ? -ux : -uy * 0.5; my = d > 470 ? uy : d < 380 ? -uy : ux * 0.5; }
      if (K.mode === 2) { const gx = LV.LENIN[0] + Math.cos(t * 0.6) * 260, gy = LV.LENIN[1] + 80 + Math.sin(t * 0.6) * 190, gd = dist(gx, gy, e.x, e.y) || 1; mx = (gx - e.x) / gd; my = (gy - e.y) / gd; }
      const l = Math.hypot(mx, my); if (l > 0.01) { e.vx = mx / l * 175; e.vy = my / l * 175; } else { e.vx = e.vy = 0; }
      e.x += e.vx * DT; e.y += e.vy * DT; e.dist += Math.hypot(e.vx, e.vy) * DT; collide(e, 22); }
    else { e.vx = e.vy = 0; }
    e.face = tg.x > e.x ? 1 : -1;
    if (!A && t >= K.next) { const opts = K.mode === 0 ? ['burst', 'nades', 'burst'] : K.mode === 1 ? ['burst', 'burst', 'nades'] : ['speech', 'burst', 'nades'];
      const k = opts[Math.floor(h1(S.steps) * 3)]; K.atk = { k, t0: t, i: 0 }; K.aim = Math.atan2(uy, ux) - 0.7 * (h1(S.steps + 1) < 0.5 ? 1 : -1);
      if (k === 'speech') { e.shieldT = t + 2.5; bark(S, 'km_2', e.x, e.y); } else if (h1(S.steps + 2) < 0.4) bark(S, k === 'burst' ? 'km_0' : 'km_1', e.x, e.y); }
    const N = K.atk; if (!N) return;
    if (N.k === 'burst') { const want = Math.atan2(uy, ux), da = Math.atan2(Math.sin(want - K.aim), Math.cos(want - K.aim)); K.aim += clamp(da, -1.3 * DT, 1.3 * DT);
      if (Math.floor((t - N.t0) / 0.09) !== Math.floor((t - N.t0 - DT) / 0.09)) S.eproj.push({ kind: 'kbul', x: e.x + Math.cos(K.aim) * 70, y: e.y - 58, vx: Math.cos(K.aim) * 620, vy: Math.sin(K.aim) * 620, ttl: 1.3, dmg: 5 * enemyX(S) });
      if (t - N.t0 > 1.5) { K.atk = null; K.next = t + 1.6; } }
    else if (N.k === 'nades') { if (N.i < 3 && t >= N.t0 + N.i * 0.35) { const up = S.players.filter(alive), p = up[N.i % up.length];
        lobAt(S, e.x, e.y - 60, p.x + (h1(S.steps) - 0.5) * 160, p.y + (h1(S.steps + 4) - 0.5) * 120, 1.0, 'nade', 90, 16 * enemyX(S)); N.i++; }
      if (t - N.t0 > 1.6) { K.atk = null; K.next = t + 1.6; } }
    else if (N.k === 'speech' && t - N.t0 > 2.5) { K.atk = null; K.next = t + 1.2; }
  }


  // ---------------- «Барбершоп» (HASAN.md): Хасан's own weapon grows at the barber, not from level-ups ----------------
  // one shop per wave at a random empty spot, gone at the break or after one try. Хасан walks in → the mini-game: scissors sweep left→right
  // over his mustache, Space on the mark. A good cut: +1 mustache, +reach; a miss: −1 mustache, −reach
  const CUT_IN = 0.6, CUT_PASS = 1.4 / 1.175, CUT_W = 0.065 * 2 / 3, BOT_CUT = 0.65;      // intro (s), one sweep (s), half-width of the mark (share of the bar), bots' hit rate
  const trimPos = (c, t) => (t - c.t0 - CUT_IN) / (c.pass || CUT_PASS);
  function barberStep(S, t) {
    const H = S.players.find((p) => p.hero === 'hasan' && !p.out), busy = S.players.some((p) => p.trim);
    if (!H || S.bus || S.brk > 0 || S.bossWave || S.bossAt || S.boss) { if (S.barber && !busy) S.barber = null; return; }
    if (!S.barber && S.barberW !== S.wave) { const sp = parkSpot(S, 71 + S.wave * 13, S.dealer); S.barberW = S.wave;
      if (sp) { S.barber = { x: sp[0], y: sp[1], t0: t }; ev(S, { k: 'barber', x: sp[0], y: sp[1] }); } }
  }
  // Хасан at the barber: true while he's inside (no moving, no fighting, untouchable)
  function hasanTrim(S, p, inp, t) {
    const B = S.barber;
    if (!p.trim) { if (!B || dist(p.x, p.y, B.x, B.y + 40) > 95) return false;
      const mark = 0.3 + h2(S.wave, 61) * 0.55, good = h2(S.wave, 62) < BOT_CUT, extra = clamp((p.must || 1) - 1, 0, MUST_MAX - 1), width = CUT_W * (1 - 0.03 * extra);
      // Each extra mustache adds 5% speed and removes 3% target width; caps: +25% / -15%.
      p.trim = { t0: t, mark, pass: CUT_PASS / (1 + 0.05 * extra), width, aim: good ? mark + (h2(S.wave, 63) - 0.5) * width : mark + (h2(S.wave, 63) < 0.5 ? -0.25 : 0.25) };
      p.x = B.x; p.y = B.y + 40; ev(S, { k: 'trimin', pid: p.id, x: B.x, y: B.y }); }
    const c = p.trim, pos = trimPos(c, t); p.vx = p.vy = 0; p.inv = Math.max(p.inv, t + 0.3);
    // a person's client sends where it saw the scissors (+10) — its view runs behind the host, so the host's clock would be late
    let at = null; if (p.bot) { if (pos >= c.aim) at = pos; } else if (inp.trim) at = Math.min(inp.trim - 10, pos + 0.05);
    if (at === null && pos < 1.08) return true;
    const ok = at !== null && Math.abs(at - c.mark) <= (c.width || CUT_W);
    p.must = clamp((p.must || 1) + (ok ? 1 : -1), 1, MUST_MAX); p.mustR = clamp((p.mustR || 0) + (ok ? 1 : -1), 0, MUST_MAX - 1); recalc(p);
    p.trim = null; p.inv = t + 1; p.y += 30; S.barber = null;
    ev(S, { k: 'trim', pid: p.id, ok: ok ? 1 : 0, at: at === null ? -1 : at, mark: c.mark, n: p.must, x: p.x, y: p.y });
    bark(S, ok ? 'hz_cut_ok' : 'hz_cut_fail', p.x, p.y - 150);
    return true;
  }

  // ---------------- «Чёрный рынок» (LEHA_MARKET.md): Лёха earns shell casings and buys guns, attachments and supplies from a dealer ----------------
  // guns go in order: the next one only once the gun in hand wears its full kit; a gun bought replaces the old one, kit and all (each gun has its own)
  const GUNS = [{ n: 'ПМ' },
    { k: 'gun', gun: 1, n: 'ПП «Кедр»', d: 'Очередь: быстро, пули слабые', cost: 50, icon: 'gun_smg' },
    { k: 'gun', gun: 2, n: 'Дробовик «Сайга»', d: 'Веер дроби в упор', cost: 150, icon: 'gun_shotgun' },
    { k: 'gun', gun: 3, n: 'Пулемёт «Печенег»', d: 'Длинная очередь, стоя точнее', cost: 280, icon: 'gun_mg' },
    { k: 'gun', gun: 4, n: 'РПГ', d: 'Медленно, взрыв по площади', cost: 450, icon: 'gun_rpg' }];
  // fx: rate / dmg (+share), crit (+chance), pierce (+enemies), pel (+pellets), tight (narrower spread), blast (+radius)
  const GATT = [
    [{ id: 'pm_mag', n: 'Удлинённый магазин', d: '+30% скорострельности', cost: 20, icon: 'mk_mag', fx: { rate: 0.3 } },
      { id: 'pm_lcu', n: 'Лазерный целеуказатель', d: '+12% шанс крита', cost: 25, icon: 'mk_sight', fx: { crit: 0.12 } },
      { id: 'pm_exp', n: 'Экспансивные патроны', d: '+30% урона', cost: 30, icon: 'mk_ap', fx: { dmg: 0.3 } }],
    [{ id: 'kd_mag', n: 'Спаренные магазины', d: '+25% скорострельности', cost: 45, icon: 'mk_mag', fx: { rate: 0.25 } },
      { id: 'kd_comp', n: 'Компенсатор', d: 'Очередь кучнее, +15% урона', cost: 50, icon: 'mk_sight', fx: { tight: 0.6, dmg: 0.15 } },
      { id: 'kd_ap', n: 'Бронебойные 9×18', d: 'Пули пробивают +1 врага', cost: 55, icon: 'mk_ap', fx: { pierce: 1 } }],
    [{ id: 'sg_drum', n: 'Барабан на 12', d: '+30% скорострельности', cost: 85, icon: 'mk_mag', fx: { rate: 0.3 } },
      { id: 'sg_choke', n: 'Чок', d: 'Дробь кучнее и дальше, +20% урона', cost: 90, icon: 'mk_sight', fx: { tight: 0.4, dmg: 0.2 } },
      { id: 'sg_buck', n: 'Крупная картечь', d: '+3 дробины в выстреле', cost: 95, icon: 'mk_ap', fx: { pel: 3 } }],
    [{ id: 'pk_box', n: 'Короб на 200', d: '+25% скорострельности', cost: 130, icon: 'mk_mag', fx: { rate: 0.25 } },
      { id: 'pk_pso', n: 'Прицел ПСО', d: '+15% шанс крита', cost: 135, icon: 'mk_sight', fx: { crit: 0.15 } },
      { id: 'pk_ap', n: 'Бронебойная лента', d: 'Пули пробивают +2 врага', cost: 140, icon: 'mk_ap', fx: { pierce: 2 } }],
    [{ id: 'rp_tan', n: 'Тандемная БЧ', d: '+35% урона', cost: 180, icon: 'mk_ap', fx: { dmg: 0.35 } },
      { id: 'rp_frag', n: 'Осколочная рубашка', d: '+30% радиус взрыва', cost: 190, icon: 'mk_nades', fx: { blast: 0.3 } },
      { id: 'rp_fast', n: 'Быстрая перезарядка', d: '+30% скорострельности', cost: 200, icon: 'mk_mag', fx: { rate: 0.3 } }]];
  const SUPPLY = [{ k: 'vest', id: 'vest', max: 3, n: 'Трофейная разгрузка', d: '-10% входящего урона', cost: [50, 100, 150], icon: 'mk_vest' },
    { k: 'med', n: 'Аптечка', d: 'Лечит 50% HP', cost: 30, icon: 'mk_med' },
    { k: 'nades', n: 'Ящик гранат', d: '20 с кидает гранаты', cost: 45, icon: 'mk_nades' }];
  // the counter for each gun in hand: its 3 attachments, the next gun, supplies (keys 1–7)
  const SHOP = GATT.map((A, g) => [...A.map((a, i) => Object.assign({ k: 'a' + i, att: 1, max: 1 }, a)), ...(GUNS[g + 1] ? [GUNS[g + 1]] : []), ...SUPPLY]);
  const shopList = (p) => SHOP[p.gun || 0];
  const SALES = ['a0', 'a1', 'a2', 'gun', 'vest', 'med', 'nades'], SALE = 0.6;
  const priceOf = (p, it, S) => { const base = Array.isArray(it.cost) ? it.cost[(p.att[it.id] || 0)] : it.cost; if (base === undefined) return null;
    return Math.round(base * (S.dealer && S.dealer.sale === it.k ? SALE : 1)); };
  // can Лёха buy it right now: null = yes, else why not
  const whyNot = (S, p, it) => { if (it.max && (p.att[it.id] || 0) >= it.max) return it.max > 1 ? 'МАКС' : 'КУПЛЕНО';
    if (it.gun && GATT[p.gun || 0].some((a) => !p.att[a.id])) return 'СНАЧАЛА ОБВЕС'; if (it.k === 'med' && p.hp >= p.hpMax) return 'HP ПОЛНОЕ';
    return priceOf(p, it, S) > p.shells ? 'МАЛО ГИЛЬЗ' : null; };
  // what a bot Лёха saves for: the next gun, then the kit, then the vest
  const botWant = (S, p) => { const L = shopList(p); for (const k of ['gun', 'a0', 'a1', 'a2', 'vest']) { const i = L.findIndex((it) => it.k === k); if (i >= 0 && !whyNot(S, p, L[i])) return i; } return -1; };
  function buy(S, p, i) {
    const it = shopList(p)[i]; if (!it || whyNot(S, p, it)) return; const c = priceOf(p, it, S); p.shells -= c;
    if (it.gun) { p.gun = p.tier = it.gun; p.att = { vest: p.att.vest || 0 }; recalc(p); ev(S, { k: 'gunup', pid: p.id, g: it.gun, x: p.x, y: p.y }); }
    else if (it.max) { p.att[it.id] = (p.att[it.id] || 0) + 1; recalc(p); }
    else if (it.k === 'med') p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.5);
    else if (it.k === 'nades') p.nadeT = S.t + 20;
    ev(S, { k: 'buy', pid: p.id, id: it.id || it.k, x: p.x, y: p.y, cost: c });
  }
  // a free spot for a set piece (the dealer's car, the barbershop): on grass, off the plaza but not out at the edge, clear of props and of `avoid`
  const LOWP = ['bench', 'bush', 'flowers', 'bin', 'bollard', 'fence', 'rail'];
  function parkSpot(S, salt, avoid) {
    const grass = (x, y) => [-130, 0, 130].every((dx) => [10, -90].every((dy) => !onPave(x + dx, y + dy)))
      && !PROPS.some((q) => { const low = LOWP.includes(q[0]); return Math.abs(q[1] - x) < (low ? 210 : 250) && q[2] > y - 170 && q[2] < y + (low ? 90 : 320); });     // it's drawn up from (x, y); nothing tall in front
    for (let k = 0; k < 2000; k++) { const a = h2(k, salt) * 6.283, r = 500 + h2(k, salt + 1) * 1000, x = C[0] + Math.cos(a) * r, y = C[1] + Math.sin(a) * r * 0.75;
      if (x > WORLD.x0 + 200 && x < WORLD.x1 - 200 && y > WORLD.y0 + 260 && y < WORLD.y1 - 120 && !blocked(x, y, 90) && (k >= 1600 || grass(x, y))
        && !(avoid && dist(x, y, avoid.x, avoid.y) < 500)) return [x, y]; }
    return null; }
  // the dealer parks once per map on an empty patch of grass and stays there all game; a new sale every wave
  function dealerStep(S, t) {
    const L = S.players.find((p) => p.hero === 'leha' && !p.out);
    if (!L || S.bus) { if (S.dealer) for (const p of S.players) p.shop = 0; S.dealer = null; return; }
    if (!S.dealer) { const [x, y] = parkSpot(S, 41, S.barber) || [C[0], C[1] + 600]; S.dealer = { x, y, t0: t, w: -1, sale: 'med' }; ev(S, { k: 'dealer', x, y }); }
    const E = S.dealer; if (E && E.w !== S.wave) { E.w = S.wave; E.sale = SALES[Math.floor(h1(S.wave * 13) * SALES.length)]; }
  }


  // test hook: hit an enemy through the normal damage path (tools/*.cjs)
  const debugHit = (S, e, dmg) => { buildGrid(S); hurtEnemy(S, e, dmg, S.players[1] || S.players[0], 'card'); };
  // ---------------- step ----------------
  function step(S, inpAll) {
    if (S.over) { S.t += DT; S.steps++; if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96); return S; }
    const inps = (inpAll && inpAll.players) || { 0: inpAll || {} };
    S.rt = (S.rt || 0) + DT; S.steps++;
    S.pend = S.players.filter((p) => p.pick && !p.out).map((p) => p.id); S.pause = S.pend.length ? 1 : 0;
    if (S.pause) { pauseStep(S, inps); if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96); return S; }
    if (S.cut) { cutStep(S, inps); return S; }
    if (LV.id !== S.map) useMap(S.map);
    const t = S.t + DT; S.t = t;
    buildGrid(S);
    // ---- waves: 1–10 in the park → the bus to Meleuz → 11–20 → the bus home waits while the endless night goes on ----
    if (S.bus) { S.swarmT += DT;
      if (S.endless) { S.waveT += DT; if (S.waveT >= WAVE_LEN) { S.waveT = 0; S.wave++; S.score += Math.round(250 * S.wave * scoreX(S)); ev(S, { k: 'wave', n: S.wave }); checkUnlocks(S); } } }
    else if (S.brk > 0) { S.brk -= DT; if (S.brk <= 0) { S.wave++; S.waveT = 0; ev(S, { k: 'wave', n: S.wave }); checkUnlocks(S); const p = S.players[Math.floor(h1(S.wave) * S.players.length)]; say(S, p, 'wave');
        if ((S.wave === WAVES && S.map === 'park') || (S.wave === 2 * WAVES && S.map === 'meleuz')) S.bossAt = t + 2.5; } }
    else if (S.bossAt) { if (t >= S.bossAt) { S.bossAt = 0; startBoss(S); } }
    else if (S.bossWave) { S.waveT = Math.min(S.waveT + DT, WAVE_LEN - 1); }
    // the wave timer runs out → no more spawns; the break starts only once the last enemy of the wave is dead
    else if (S.clear) { S.clearT += DT;
      // a straggler stuck behind props must never hold the wave: after 25 s, far ones are brought in (just off-screen of the nearest hero)
      if (S.clearT > 25 && Math.floor(S.clearT) !== Math.floor(S.clearT - DT)) for (const e of S.enemies) {
        let q = null, qd = 1e9; for (const o of S.players) if (alive(o)) { const d = dist(o.x, o.y, e.x, e.y); if (d < qd) { qd = d; q = o; } }
        const moved = dist(e.x, e.y, e.sx ?? 1e9, e.sy ?? 1e9); e.sx = e.x; e.sy = e.y;
        if (!q || (qd < 750 && (moved > 25 || qd < 300))) continue;                // far away, or stuck against a wall
        for (let k = 0; k < 8; k++) { const a = Math.atan2(e.y - q.y, e.x - q.x) + k * 0.8, x = clamp(q.x + Math.cos(a) * 700, 80, WORLD.x1 - 80), y = clamp(q.y + Math.sin(a) * 520, 180, WORLD.y1 - 60);
          if (!blocked(x, y, e.r)) { e.x = x; e.y = y; break; } } }
      if (!S.enemies.length) { S.clear = 0; S.score += Math.round(250 * S.wave * scoreX(S));
        if (S.wave === WAVES && S.map === 'park') busArrive(S, 'meleuz');
        else if (S.wave >= 2 * WAVES) { S.won = 1; S.endless = 1; busArrive(S, 'home'); checkUnlocks(S); }
        else { S.brk = BREAK; ev(S, { k: 'break', n: S.wave }); for (const p of S.players) { p.tokens = []; if (p.down && !p.out) { p.down = 0; p.hp = p.hpMax * 0.5; } p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.3); }
          S.banter = t + 2; } } }
    else { S.waveT += DT; if (S.waveT >= WAVE_LEN) { S.waveT = WAVE_LEN; S.clear = 1; S.clearT = 0; ev(S, { k: 'clear', n: S.wave }); } }
    if (S.spor === 'speedrun' && S.map === 'park' && t > 780) { ev(S, { k: 'timeout' }); S.over = t; S.won = 0; finishRun(S); return S; }
    if (S.banter && t > S.banter) { S.banter = 0; const up = S.players.filter(alive), a = up[Math.floor(h1(S.wave + 3) * up.length)]; if (a) { S.sayT = -9; a.vcd = 0; say(S, a, 'banter'); } }
    if (S.allyDownSay && t > S.allyDownSay[0]) { const a = S.players.find((q) => q.id === S.allyDownSay[1]); S.allyDownSay = 0; if (a && alive(a)) { a.vcd = 0; say(S, a, 'ally_down'); } }
    // ---- spawning: hold a target count around the team, outside every camera ----
    const n = S.players.length, coop = COOP[Math.min(8, n)], humans = Math.max(1, n);
    const swarm = S.bus && !S.endless ? 1 + S.swarmT / 25 : 1, crowdX = S.spor === 'crowd' ? 2 : 1;      // waiting for the bus: the swarm only grows
    // crowd size: the park ramps 1 → 10; Meleuz starts again at a mid-park crowd and only creeps up — its waves get tougher, not bigger
    const wN = S.map === 'meleuz' ? Math.min(9, 4 + (S.wave - 11) * 0.5) : S.wave;
    const want = S.brk > 0 || S.clear ? 0 : (S.bossWave ? 0.35 : 1) * Math.min(190 * crowdX * (swarm > 1 ? 1.25 : 1), Math.round((7 + wN * 5 + S.waveT * (0.08 + wN * 0.025)) * coop * (S.solo ? 0.7 : 1) * swarm * crowdX));
    S.spawnAcc += DT * (2 + wN * 0.8) * coop * swarm * crowdX * (S.spor === 'turbo' ? 1.5 : 1);
    const live = S.players.filter(alive);
    while (S.spawnAcc >= 1 && S.enemies.length < want && live.length) { S.spawnAcc -= 1;
      const k = S.steps * 13 + S.enemies.length, p = live[Math.floor(h1(k) * live.length)], a = h1(k + 1) * Math.PI * 2, r = 1150 + 250 * h1(k + 2);
      let x = clamp(p.x + Math.cos(a) * r, 80, WORLD.x1 - 80), y = clamp(p.y + Math.sin(a) * r * 0.75, 180, WORLD.y1 - 60);
      if (blocked(x, y, 30) || S.players.some((q) => dist(q.x, q.y, x, y) < 900)) continue;
      const types = Object.keys(ETYPES).filter((ty) => ETYPES[ty].map === S.map && ETYPES[ty].w > 0 && ETYPES[ty].from <= S.wave);
      const nR = S.enemies.filter((o) => ETYPES[o.type].ranged).length, nB = S.enemies.filter((o) => ETYPES[o.type].sc >= 1.5).length;
      const wts = types.map((ty) => (ETYPES[ty].ranged && nR > Math.max(3, S.enemies.length * 0.12)) || (ETYPES[ty].sc >= 1.5 && nB > Math.max(2, S.enemies.length * 0.1)) ? 0 : ETYPES[ty].w);
      let rw = h1(k + 3) * wts.reduce((a, b) => a + b, 0), ty = types[0]; for (let i = 0; i < types.length; i++) { rw -= wts[i]; if (rw <= 0) { ty = types[i]; break; } }
      const T = ETYPES[ty], hp = T.hp * hpScale(S) * (S.spor === 'chonk' ? 2 : 1);
      S.enemies.push(mkEnemy(S, ty, x, y, hp));
      for (let j = 0; j < (T.pack || 0); j++) { const ox = x + 60 * (h1(k + 7 + j) - 0.5) * 2, oy = y + 50 * (h1(k + 11 + j) - 0.5) * 2;       // stray dogs run in packs
        if (!blocked(ox, oy, 24)) S.enemies.push(mkEnemy(S, ty, ox, oy, hp)); }
    }
    if (S.spawnAcc > 3) S.spawnAcc = 3;
    // an elite every ~25 s from wave 2: a golden brute that drops a chest (a free upgrade for whoever opens it)
    if (S.brk <= 0 && !S.clear && !S.bossWave && S.wave >= 2 && live.length && (S.eliteT -= DT) <= 0) { S.eliteT = Math.max(22, 38 - S.wave * 1.5);
      const p = live[Math.floor(h1(S.steps) * live.length)], a = h1(S.steps + 5) * Math.PI * 2;
      const x = clamp(p.x + Math.cos(a) * 1200, 80, WORLD.x1 - 80), y = clamp(p.y + Math.sin(a) * 900, 180, WORLD.y1 - 60);
      if (!blocked(x, y, 40)) { const L2 = ELITES[S.map], ty = L2[Math.floor(h1(S.steps + 9) * L2.length)], hp = ETYPES[ty].hp * 6 * hpScale(S) * (S.spor === 'chonk' ? 2 : 1);
        S.enemies.push(mkEnemy(S, ty, x, y, hp, { elite: 1, r: ETYPES[ty].r * 1.2, shotT: 9e9 }));
        ev(S, { k: 'elite', x, y, type: ty }); } }
    dealerStep(S, t); barberStep(S, t);
    // ---- players ----
    for (const p of S.players) {
      const inp = p.bot ? botInput(S, p) : (inps[p.id] || {});
      const edge = (k) => { const v = !!inp[k], e = v && !p.prev[k]; p.prev[k] = v; return e; };
      const qE = edge('q'), rE = edge('r'), eE = edge('e');
      if (p.out || p.inBus) continue;
      if (p.nat) { const K = S.boss && S.boss.km, e = K && S.enemies.find((o) => o.id === K.eid);
        if (!e) { p.nat = 0; continue; } p.x = e.x; p.y = e.y; if (!p.bot && inp.slot >= 1 && inp.slot <= 3) K.mode = inp.slot - 1; camStep(p); continue; }
      if (p.down) { const g = inGas(S, p.x, p.y); p.downT -= DT * (g ? 1.5 : 1); if (g) p.gasDown = t;
        if (S.solo && p.selfRes > 0 && (eE || p.bot)) { p.selfRes--; p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 2; ev(S, { k: 'revive', pid: p.id, by: p.id, x: p.x, y: p.y }); }
        const helpers = S.players.filter((q) => q !== p && alive(q) && q.hero !== 'vitya' && dist(q.x, q.y, p.x, p.y) < 85);
        if (helpers.length) { p.revP += DT / 2.4; if (p.revP >= 1) { p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 1.5; p.revP = 0; helpers[0].st.rev++; helpers[0].ult = Math.min(1, helpers[0].ult + 0.12);
          ev(S, { k: 'revive', pid: p.id, by: helpers[0].id, x: p.x, y: p.y }); say(S, helpers[0], 'revive'); } }
        else p.revP = Math.max(0, p.revP - DT * 0.3);
        const vt = S.players.find((q) => q.hero === 'vitya' && alive(q) && dist(q.x, q.y, p.x, p.y) < 85); if (vt && S.t - (p.cantT || -9) > 4) { p.cantT = S.t; say(S, vt, 'cant_revive'); }
        if (p.downT <= 0) { p.out = 1; ev(S, { k: 'out', pid: p.id, x: p.x, y: p.y }); }
        continue; }
      // «Ночной ларёк»: an energy drink for the whole team — enemies tougher, XP and score up, for the rest of the run
      if (p.hero === 'leha') { const dd = S.dealer ? dist(p.x, p.y, S.dealer.x, S.dealer.y) : 1e9;
        if (eE && dd < 140) p.shop = p.shop ? 0 : 1; if (dd > 200) p.shop = 0;
        if (p.shop && !p.pick && inp.slot >= 1 && inp.slot <= shopList(p).length) buy(S, p, inp.slot - 1);
        if (p.bot && dd < 140 && t > (p.botBuyT || 0)) { p.botBuyT = t + 0.6; const i = botWant(S, p); if (i >= 0) buy(S, p, i); else if (p.hp < p.hpMax * 0.5) buy(S, p, shopList(p).findIndex((it) => it.k === 'med')); } }
      if (p.hero === 'hasan' && hasanTrim(S, p, inp, t)) { camStep(p); continue; }
      if (eE && LV.KIOSK && !S.bus && S.wave >= S.kioskNext && dist(p.x, p.y, LV.KIOSK[0], LV.KIOSK[1] + 50) < 120) {
        S.drinks++; S.kioskNext = S.wave + 3; ev(S, { k: 'drink', pid: p.id, x: p.x, y: p.y, n: S.drinks }); }
      if (p.m.leech) { const cap = 4 * lv(p, 'kumys'); p.lsB = Math.min(cap, p.lsB + cap * DT); }
      // move
      const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), il = Math.hypot(ix, iy) || 1;
      const slowLeha = p.hero === 'leha' ? 1 - 0.04 * p.tier : 1, fast = t - p.fastT < 2 ? 1.25 : 1;
      const spd = HEROES[p.hero].spd * p.m.spd * slowLeha * fast * (t - p.qT < 4 && p.hero === 'hasan' ? 1.1 : 1) * (S.spor === 'turbo' ? 1.3 : 1);
      const held = t < (p.rootT || 0), slow = t < (p.slowT || 0) ? 0.6 : 1;
      const tx = held ? 0 : ix / il * spd * slow, ty = held ? 0 : iy / il * spd * slow, acc = 2600 * DT;
      p.vx += clamp(tx - p.vx, -acc, acc); p.vy += clamp(ty - p.vy, -acc, acc);
      if (ix || iy) { p.fx = ix / il; p.fy = iy / il; p.dir = Math.abs(iy) > Math.abs(ix) * 1.2 ? (iy > 0 ? 0 : 2) : (ix > 0 ? 1 : 3); p.stillT = 0; } else p.stillT += DT;
      p.qCD = Math.max(0, p.qCD - DT);
      const mx = p.vx, my = p.vy;
      p.x += mx * DT; p.y += my * DT; collide(p, 24);
      for (const tr of S.traps) if (!tr.snap && t > tr.arm && dist(p.x, p.y, tr.x, tr.y) < 50) { tr.snap = t; p.rootT = t + 1.0; hurtPlayer(S, p, 10 * enemyX(S), null); ev(S, { k: 'snap', x: tr.x, y: tr.y, pid: p.id }); }
      if (S.bus && dist(p.x, p.y, S.bus.x + DOOR[0], S.bus.y + DOOR[1]) < 95) { p.inBus = 1; p.vx = p.vy = 0; ev(S, { k: 'board', pid: p.id, x: p.x, y: p.y }); continue; }
      const moved = Math.hypot(mx, my) * DT; if (moved > 0.05) { const b = Math.floor(p.dist / 62); p.dist += moved; if (Math.floor(p.dist / 62) !== b) ev(S, { k: 'step', pid: p.id, x: p.x, y: p.y }); }
      if (qE && p.qCD <= 0) useQ(S, p, t);
      if (rE && p.ult >= 1) useUlt(S, p, t);
      if (p.m.regen) p.hp = Math.min(p.hpMax, p.hp + p.m.regen * DT);
      if (t > p.ultLock) p.ult = Math.min(1, p.ult + DT / 300);                // about one ultimate per 1.5-2 min of fighting
      heroStep(S, p, inp, t); gearStep(S, p, t);
      // in Vitya's gas: allies take small damage (never lethal) and complain
      if (p.hero !== 'vitya') { const g = inGas(S, p.x, p.y);
        if (g) { const v = S.players.find((q) => q.id === g.owner); if (Math.floor((t - g.t0)) !== Math.floor((t - DT - g.t0)) || t - p.gasT > 1.0) {
            if (t - p.gasT > 0.95) { p.gasT = t; const d = (g.big ? 9 : 6) * (v ? v.m.deo : 1); hurtPlayer(S, p, d, v, true); p.st.gasIn++; if (v) { v.st.ally += d; v.st.allyHit++; }
              if (!p.inGas) { say(S, p, 'gas'); if (v && S.sayT === t && h2(S.steps, 11) < 0.5) { S.banterV = t + 2.2; S.banterW = v.id; } } } } }
        p.inGas = g ? 1 : 0; }
      camStep(p);
    }
    S.traps = S.traps.filter((tr) => (tr.snap ? t - tr.snap < 1.5 : t - tr.t0 < 25));
    for (const p of S.players) if (p.out || p.down) { p.camV[0] *= 0.9; p.camV[1] *= 0.9; }
    // everyone left is on the bus: to Meleuz, or home (the run ends, the endless night's score counts)
    if (S.bus) { const act = S.players.filter((p) => !p.out);
      if (act.length && act.every((p) => p.inBus)) { if (S.bus.to === 'meleuz') travel(S, 'meleuz'); else { S.over = t; S.won = 1; S.home = 1; finishRun(S); return S; } } }
    if (S.banterV && t > S.banterV) { const v = S.players.find((q) => q.id === S.banterW); S.banterV = 0; if (v) { S.sayT = -9; v.vcd = 0; say(S, v, 'gas_reply'); } }
    // ---- enemies ----
    const targets = S.players.filter(alive);
    for (const e of S.enemies) {
      const T = ETYPES[e.type]; let tg = null, td = 1e9;
      for (const p of targets) { const d = dist(p.x, p.y, e.x, e.y); if (d < td) { td = d; tg = p; } }
      if (T.boss || T.mini || e.run) bossStep(S, e, t); else {
      const frozen = t < (e.freezeT || 0), rooted = t < (e.rootT || 0); if (rooted) { e.kx = e.ky = 0; }
      let spd = (frozen || rooted ? 0 : 1) * T.spd * (t < e.slowT ? 0.45 : 1) * (t < e.poisT ? 0.8 : 1) * (inGas(S, e.x, e.y) ? 0.8 : 1) * (S.clear && S.clearT > 8 ? 1.9 : 1) * (S.spor === 'turbo' ? 1.5 : 1);
      let dx = 0, dy = 0; const charmed = t < (e.charmT || -9);
      // «Яжемать»: stops, revs up the pram, then rams in a straight line
      if (T.charge && !charmed && !frozen) {
        if (e.chg === 1) { spd = 0; if (t - e.chgT > 0.7) { e.chg = 2; e.chgT = t; } }
        else if (e.chg === 2) { if (t - e.chgT > 0.75) { e.chg = 0; e.chgCD = t + 3; } }
        else if (tg && td < 460 && td > 110 && t > (e.chgCD || 0)) { e.chg = 1; e.chgT = t; e.cdx = (tg.x - e.x) / td; e.cdy = (tg.y - e.y) / td; ev(S, { k: 'rev', x: e.x, y: e.y, id: e.id }); } }
      // «Батя района» slams the ground (a wind-up ring first); «Вожак стаи» howls the yard dogs in
      if (e.elite && tg && !charmed && !frozen) {
        if (e.type === 'starshiy') { if (e.slamT && t >= e.slamT) { e.slamT = 0; ev(S, { k: 'boom', x: e.x, y: e.y, r: 190, kind: 'slam' });
            for (const q of S.players) if (alive(q) && dist(q.x, q.y, e.x, e.y) < 190) { hurtPlayer(S, q, T.dmg * 1.4 * enemyX(S), e); const d = dist(q.x, q.y, e.x, e.y) || 1; q.vx += (q.x - e.x) / d * 700; q.vy += (q.y - e.y) / d * 700; } }
          else if (!e.slamT && td < 230 && t > (e.slamCD || 0)) { e.slamT = t + 0.7; e.slamCD = t + 4.5; ev(S, { k: 'warn', x: e.x, y: e.y, r: 190, until: t + 0.7, slam: 1 }); }
          if (e.slamT) spd = 0; }
        if (T.howl && t > (e.howlT || e.born + 2)) { e.howlT = t + 7; ev(S, { k: 'howl', x: e.x, y: e.y, id: e.id });
          for (let j = 0; j < 2; j++) { const a = j * 2.1 + h1(e.id + j), ox = e.x + Math.cos(a) * 90, oy = e.y + Math.sin(a) * 70;
            if (!blocked(ox, oy, 24)) S.enemies.push(mkEnemy(S, 'dog', ox, oy, ETYPES.dog.hp * hpScale(S))); } } }
      if (charmed) { dx = Math.sin(t * 1.7 + e.id) * 0.35; dy = Math.cos(t * 1.3 + e.id * 2) * 0.35; }
      else if (e.flee) { const p = tg || { x: C[0], y: C[1] }; const d = dist(p.x, p.y, e.x, e.y) || 1; dx = (e.x - p.x) / d; dy = (e.y - p.y) / d; spd *= 1.4; e.hp -= DT * 30; }
      else if (e.chg === 2) { dx = e.cdx; dy = e.cdy; spd = T.spd * 4.4; }
      else if (tg) { dx = (tg.x - e.x) / (td || 1); dy = (tg.y - e.y) / (td || 1);
        if (T.ranged && td < 520 && !(S.clear && S.clearT > 8)) { dx *= -0.5; dy *= -0.5; if (td < 380) { dx *= 2; dy *= 2; } } }
      // separation from neighbours
      near(e.x, e.y, e.r * 1.6, (o) => { if (o === e) return; const ox = e.x - o.x, oy = e.y - o.y, d = Math.hypot(ox, oy) || 0.1, R = e.r + o.r;
        if (d < R) { dx += ox / d * (R - d) / R * 1.6; dy += oy / d * (R - d) / R * 1.6; } });
      const sp = Math.min(1.6, Math.hypot(dx, dy)) || 1, nl = Math.hypot(dx, dy) || 1;
      e.vx = dx / nl * spd * Math.min(1, sp); e.vy = dy / nl * spd * Math.min(1, sp);
      e.x += (e.vx + e.kx) * DT; e.y += (e.vy + e.ky) * DT; const kd = Math.exp(-9 * DT); e.kx *= kd; e.ky *= kd;
      const mv = Math.hypot(e.vx, e.vy) * DT; e.dist += mv; if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
      collide(e, e.r * 0.6);
      if (e.hp <= 0) continue;
      if (tg && !e.flee && !charmed && !frozen) {
        if (td < e.r + 30 && t > e.atkT) { e.atkT = t + 0.7; e.biteT = t;
          if (T.bomb) { e.hp = 0; killEnemy(S, e, null, 'self'); } else { hurtPlayer(S, tg, T.dmg * (1 + 0.07 * (S.wave - 1)) * (e.elite ? 1.5 : 1) * enemyX(S), e);
            if (e.chg === 2) { tg.vx += e.cdx * 650; tg.vy += e.cdy * 650; e.chg = 0; e.chgCD = t + 3; } } }      // the pram knocks you flying
        if (T.ranged && td < 640 && t > e.shotT) { e.shotT = t + 3.6 + h2(e.id, S.steps) * 2; const d = td || 1;
          if (T.lob) { S.eproj.push({ lob: 1, x: e.x, y: e.y - 40, vx: (tg.x - e.x) / 0.9, vy: (tg.y - e.y) / 0.9, ttl: 0.9, ttl0: 0.9, r: 62, dmg: T.dmg * enemyX(S) }); ev(S, { k: 'toss', x: e.x, y: e.y }); }   // Алкаш: a bottle in an arc
          else { S.eproj.push({ x: e.x, y: e.y - 40, vx: (tg.x - e.x) / d * 340, vy: (tg.y - 40 - e.y + 40) / d * 340, ttl: 2.4, dmg: T.dmg * enemyX(S) }); ev(S, { k: 'spit', x: e.x, y: e.y }); } }
      }
      }
      // gas damage
      const g = inGas(S, e.x, e.y); if (g && Math.floor((t - g.t0) / 0.5) !== Math.floor((t - DT - g.t0) / 0.5)) { const v = S.players.find((q) => q.id === g.owner);
        hurtEnemy(S, e, (g.big ? 48 : 15) * (g.cyc ? 1.5 : 1) * (v ? v.m.dmg * v.m.sdmg * (v.zone || 1) : 1), v, 'gas'); e.poisT = t + 1.5; if (v && lv(v, 'sig') >= 3) e.slowT = Math.max(e.slowT, t + 0.6);
        if (v && v.m.smods && v.m.smods.frost) { e.slowT = Math.max(e.slowT, t + 1); if (e.hp > 0 && h2(e.id, S.steps) < 0.2) { e.freezeT = t + 1; ev(S, { k: 'freeze', x: e.x, y: e.y }); } } }
      if (t < (e.burnT || 0) && e.hp > 0 && Math.floor(t * 2) !== Math.floor((t - DT) * 2)) hurtEnemy(S, e, e.burnD * 0.5, S.players.find((q) => q.id === e.burnBy), 'burn');
    }
    S.enemies = S.enemies.filter((e) => e.hp > 0 && !(e.flee && dist(e.x, e.y, C[0], C[1]) > 3000));
    // ---- projectiles ----
    for (const b of S.proj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT;
      const p = S.players.find((q) => q.id === b.own);
      if (b.lob) { if (b.ttl <= 0 && p) { if (b.kind === 'condensed') { S.zones.push({ id: S.nid++, kind: 'goo', owner: p.id, x: b.x, y: b.y + 45, vx: 0, vy: 0, r: b.r, t0: S.t, ttl: 4.5, dmg: b.dmg }); ev(S, { k: 'splat', x: b.x, y: b.y + 45, r: b.r }); }
        else explode(S, b.x, b.y + 45, b.r, b.dmg, p, b.kind, b.mods); } continue; }     // can / petard / firework land
      if (b.ttl <= 0) continue;
      if (b.kind === 'pigeon') { const e = S.enemies.find((o) => o.id === b.tgt && o.hp > 0) || nearest(S, b.x, b.y + 45, 300, []);   // homing dive
        if (!e) { b.ttl = Math.min(b.ttl, 0.3); continue; } b.tgt = e.id;
        const dx = e.x - b.x, dy = e.y - 45 - b.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, 8 * DT); b.vx += (dx / d * 760 - b.vx) * k; b.vy += (dy / d * 760 - b.vy) * k;
        if (d < 30 && p) { hurtEnemy(S, e, b.dmg, p, 'peck', b.vx * 0.1, b.vy * 0.1); if (e.hp > 0) applyMods(S, e, p, Object.assign({}, b.mods, { boom: 0 }), b.dmg);
          if (b.r) explode(S, e.x, e.y, b.r, b.dmg, p, 'kamikaze', { burn: (b.mods || {}).burn }); else ev(S, { k: 'hit', x: e.x, y: e.y, kind: 'peck' }); b.ttl = 0; }
        continue; }
      if (b.kind === 'tractor') { if (p) near(b.x, b.y, b.r, (e) => { if (b.hit.includes(e.id)) return; b.hit.push(e.id);
          const d = Math.hypot(b.vx, b.vy) || 1, nx = -b.vy / d, ny = b.vx / d, sd = (e.x - b.x) * nx + (e.y - b.y) * ny >= 0 ? 1 : -1, k = ETYPES[e.type].sc >= 1.5 || e.elite ? 0.3 : 1;
          hurtEnemy(S, e, b.dmg, p, 'tractor', (nx * sd * 520 + b.vx * 0.4) * k, (ny * sd * 520 + b.vy * 0.4) * k);
          if (b.mods && e.hp > 0) applyMods(S, e, p, b.hit.length % 3 === 1 ? b.mods : Object.assign({}, b.mods, { shock: 0 }), b.dmg); }); continue; }
      if (b.home) { const h = nearest(S, b.x, b.y + 45, 320, b.hit); if (h) { const dx = h.x - b.x, dy = h.y - 45 - b.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, 6 * DT); b.vx += (dx / d * 920 - b.vx) * k; b.vy += (dy / d * 920 - b.vy) * k; } }
      if (b.kind === 'tapok' && p) { if (!b.back && t - b.t0 > b.out) { b.back = 1; b.hit = []; }
        if (b.back) { const dx = p.x - b.x, dy = p.y - 50 - b.y, d = Math.hypot(dx, dy) || 1; b.vx = dx / d * b.sp * 1.1; b.vy = dy / d * b.sp * 1.1; if (d < 30) { b.ttl = 0; continue; } } }
      const e = nearest(S, b.x, b.y + 45, b.kind === 'rocket' ? 34 : 26, b.hit);
      if (e) { b.hit.push(e.id);
        if (b.kind === 'rocket') { explode(S, b.x, b.y + 45, (S.t - p.ultT < 7 ? 150 : 130) * p.m.area * (1 + ((p.m.gun && p.m.gun.blast) || 0)), b.dmg, p, 'rocket', b.mods); b.ttl = 0; continue; }
        hurtEnemy(S, e, b.dmg, p, b.kind, b.vx * 0.15, b.vy * 0.15); ev(S, { k: 'hit', x: b.x, y: b.y + 45, kind: b.kind, tox: b.tox || 0 });
        if (b.mods && e.hp > 0) applyMods(S, e, p, b.mods, b.dmg);
        if (b.kind === 'sugar' && b.mods && b.mods.boom) explode(S, e.x, e.y, b.mods.boom * p.m.area, b.dmg * 0.6, p, 'caramel', { burn: b.mods.burn });
        if (b.kind === 'scoop') { if (b.mods && b.mods.boom) explode(S, e.x, e.y, b.mods.boom * p.m.area, b.dmg * 0.8, p, 'fried', Object.assign({}, b.mods, { boom: 0 })); b.ttl = 0; continue; }
        if (b.rico > 0) { const n2 = nearest(S, e.x, e.y, 300, b.hit); if (n2) { const d = dist(n2.x, n2.y, e.x, e.y) || 1; b.vx = (n2.x - e.x) / d * 900; b.vy = (n2.y - e.y) / d * 900; b.x = e.x; b.y = e.y - 45; b.rico--; b.dmg *= b.ramp || 0.65; b.ttl = 0.5; continue; } }
        if (b.kind === 'tapok') continue;
        if (b.pierce && b.hit.length <= b.pierce) continue;
        if (b.kind !== 'pellet' || b.hit.length > 1) b.ttl = 0; }
      if (b.kind === 'rocket' && b.ttl <= DT && b.ttl > 0) explode(S, b.x, b.y + 45, 130 * p.m.area, b.dmg, p, 'rocket');
    }
    S.proj = S.proj.filter((b) => b.ttl > 0);
    for (const b of S.eproj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT;
      // Лёха's shield stops spit from the front; Hasan's mustache spin swats it from any side
      const lh = S.players.find((q) => q.hero === 'leha' && alive(q) && t - q.qT < 4 + q.m.shield && dist(q.x, q.y - 40, b.x, b.y) < 150 && (b.x - q.x) * q.fx + (b.y - q.y + 40) * q.fy > 10);
      const hz = S.players.find((q) => q.hero === 'hasan' && alive(q) && t - q.qT < 4 && dist(q.x, q.y - 30, b.x, b.y) < 150 * q.m.area);
      if (lh || hz) { b.ttl = 0; ev(S, { k: 'block', x: b.x, y: b.y, by: lh ? 'leha' : 'hasan' }); continue; }
      if (b.lob) { if (b.ttl <= 0) { ev(S, b.kind ? { k: 'boom', x: b.x, y: b.y + 40, r: b.r, kind: b.kind } : { k: 'shatter', x: b.x, y: b.y + 40 });
          for (const p of S.players) if (alive(p) && dist(p.x, p.y, b.x, b.y + 40) < b.r) { hurtPlayer(S, p, b.dmg, null); if (b.slow) p.slowT = t + 1.5; } } continue; }
      for (const p of S.players) { if (!alive(p)) continue;
        if (dist(p.x, p.y - 40, b.x, b.y) < 30) { hurtPlayer(S, p, b.dmg, null); b.ttl = 0; break; } } }
    S.eproj = S.eproj.filter((b) => b.ttl > 0);
    zoneStep(S, t);
    for (const c of S.clouds) if (c.ign && t >= c.ign) { c.ign = 0; const o = S.players.find((q) => q.id === c.owner);
      if (o) explode(S, c.x, c.y, c.r, 20 * o.m.dmg * o.m.sdmg, o, 'ignite', { burn: 2 }); }
    for (const c of S.clouds) if (c.follow !== undefined) { const o = S.players.find((q) => q.id === c.follow); if (o && !o.out) { c.x += (o.x - c.x) * 2.5 * DT; c.y += (o.y - 10 - c.y) * 2.5 * DT; } }
    S.clouds = S.clouds.filter((c) => t < c.t0 + c.ttl);
    S.marks = S.marks.filter((m) => t < m.until);
    // ---- gems: magnet, team XP, level ups ----
    for (const g of S.gems) { let best = null, bd = 1e9;
      for (const p of S.players) { if (!alive(p)) continue; const d = dist(p.x, p.y - 30, g.x, g.y); const R = 95 * p.m.pick * (t - p.qT < 4 && p.hero === 'hasan' ? 3 : 1); if (d < R && d < bd) { bd = d; best = p; } }
      if (best) { const sp = 700 + 900 * (1 - bd / 400); g.x += (best.x - g.x) / bd * sp * DT; g.y += (best.y - 30 - g.y) / bd * sp * DT;
        if (bd < 26) { g.got = 1; S.xp += g.v * (1 + 0.15 * S.drinks); best.st.xp += g.v; ev(S, { k: 'gem', x: g.x, y: g.y, pid: best.id, v: g.v }); } } }
    S.gems = S.gems.filter((g) => !g.got && t - g.t0 < 60);
    for (const c of S.chests) for (const p of S.players) if (alive(p) && !c.got && dist(p.x, p.y, c.x, c.y) < 70) { c.got = 1;
      S.kettleBy = p.id; for (const q of S.players) if (!q.out) { q.kq = (q.kq || 0) + 1; if (!q.pick) openNext(S, q); }
      ev(S, { k: 'chest', pid: p.id, x: c.x, y: c.y }); say(S, p, 'lvl'); }
    S.chests = S.chests.filter((c) => !c.got);
    for (const c of S.cards) for (const p of S.players) if (alive(p) && !c.got && dist(p.x, p.y, c.x, c.y) < 60) { const dn = S.players.find((q) => q.hero === 'danil'); c.got = 1; if (!dn) break;
      dn.album.push(c.card); ev(S, { k: 'photocard', pid: dn.id, by: p.id, card: c.card, n: dn.album.length, full: dn.album.length >= PHOTOCARDS.length ? 1 : 0, x: c.x, y: c.y });
      const scene = [[dn.id, 'dc_' + c.card + '_0'], [PHOTOCARDS.find((q) => q.id === c.card).r, 'dc_' + c.card + '_1']];
      if (dn.album.length >= PHOTOCARDS.length) scene.push([dn.id, 'dc_full_0'], ['vitya', 'dc_full_1']);
      let at = S.t; for (const [who, id] of scene) { const sp = typeof who === 'number' ? S.players.find((q) => q.id === who) : S.players.find((q) => q.hero === who && !q.out);
        if (!sp) continue; S.barkQ.push({ t: at, id, pid: sp.id }); at += voiceLen(id) + 0.35; } }
    S.cards = S.cards.filter((c) => !c.got);
    while (S.barkQ.length && t >= S.barkQ[0].t) { const b = S.barkQ.shift(), sp = S.players.find((q) => q.id === b.pid); if (sp) { bark(S, b.id, sp.x, sp.y); S.sayT = t; } }
    for (const f of S.food) for (const p of S.players) if (alive(p) && !f.got && p.hp < p.hpMax && dist(p.x, p.y, f.x, f.y) < 55) { f.got = 1; p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.25); ev(S, { k: 'food', pid: p.id, x: f.x, y: f.y }); }
    S.food = S.food.filter((f) => !f.got && t - f.t0 < 40);
    if (S.gems.length > 260) S.gems.splice(0, S.gems.length - 260);
    while (S.xp >= S.xpNext) { S.xp -= S.xpNext; S.lvl++; S.xpNext = xpNeed(S, S.lvl); ev(S, { k: 'lvl', n: S.lvl });
      for (const p of S.players) { if (p.out) continue; p.queue = (p.queue || 0) + 1; if (!p.pick) openNext(S, p); }
      const p = S.players[Math.floor(h1(S.lvl) * S.players.length)]; say(S, p, 'lvl'); }
    // ---- defeat ----
    { const outside = S.players.filter((p) => !p.out && !p.inBus && !p.nat);
      if (outside.length ? outside.every((p) => p.down) : S.players.every((p) => p.out)) { S.over = t; finishRun(S); } }    // S.won stays 1 in the endless night
    if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96);
    return S;
  }
  const xpNeed = (S, l) => Math.round((6 + 6 * l + 1.5 * l * l) * (0.1 + 0.35 * S.players.length));   // solo ~lvl 18, four players ~lvl 24 by the end
  const openNext = (S, p) => { p.pickT = S.rt;
    if (p.kq > 0) { p.kq--; p.pick = kettleCards(S, p); } else if (p.queue > 0) { p.queue--; p.pick = rollPick(S, p); } else p.pick = null; };
  const hpScale = (S) => { const w1 = S.wave - 1; return (1 + 0.12 * w1 + 0.012 * w1 * w1) * COOP_HP[Math.min(8, S.players.length)] * enemyX(S) * (S.map === 'meleuz' ? 1.3 : 1); };
  // «Дела» → S.unlock (the page keeps them between runs)
  const QDONE = { icecream: (S) => S.wave >= 5, pigeon: (S) => S.found.length >= 3, meleuz: (S) => S.map === 'meleuz', condensed: (S) => S.endless, kumys: (S) => S.sporWon };
  const checkUnlocks = (S) => { for (const q of QUESTS) if (!S.unlock[q.id] && QDONE[q.id](S)) { S.unlock[q.id] = 1; ev(S, { k: 'unlock', id: q.id }); } };
  const busArrive = (S, to) => { S.bus = { x: LV.BUS[0], y: LV.BUS[1], to, t0: S.t }; S.swarmT = 0; S.waveT = 0;
    for (const p of S.players) { if (p.down && !p.out) { p.down = 0; p.hp = p.hpMax * 0.5; } p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.3); }
    ev(S, { k: 'bus', to, x: S.bus.x, y: S.bus.y }); };
  // the PAZik drives off: a fresh level, everyone at its square, a breather before wave 11
  function travel(S, to) {
    useMap(to); S.map = to; S.bus = null; S.swarmT = 0; S.boss = null; S.traps = []; S.bossWave = 0;
    for (const k of ['enemies', 'proj', 'eproj', 'clouds', 'zones', 'gems', 'chests', 'food', 'marks', 'cards']) S[k] = [];
    S.players.forEach((p, i) => { if (p.out) return; const a = i / 4 * Math.PI * 2 + 0.6; p.inBus = 0; p.x = C[0] + Math.cos(a) * 110; p.y = C[1] + Math.sin(a) * 90; p.vx = p.vy = 0;
      p.cam = [p.x - VIEW.W / 2, p.y - 60 - VIEW.H / 2]; p.camV = [0, 0]; p.trX = undefined; p.lash = null; });
    S.brk = BREAK; S.kioskNext = S.wave + 2; S.score += Math.round(5000 * scoreX(S)); if (S.spor) S.sporWon = 1;
    ev(S, { k: 'arrive', map: to }); checkUnlocks(S); }
  function applyPick(S, p, id, t) {
    const tier0 = p.tier, c = (p.pick || []).find((x) => x.id === id) || {};
    if (id === 'reroll') { if (p.rerolls > 0) { p.rerolls--; p.pick = rollPick(S, p); p.pickT = S.rt; } return; }
    if (id === 'heal') p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.4);
    else if (id === 'fission') {                                      // +1 level to up to three random items below their cap
      const own = p.hero !== 'hasan', up = [...(own && lv(p, 'sig') < MAXL ? ['sig'] : []), ...(own && p.sigEvo && lv(p, p.sigEvo) < MAXL ? [p.sigEvo] : []), ...sharedW(p).filter((w) => lv(p, w) < MAXL), ...ownedP(p).filter((q) => lv(p, q) < pmax(q))];
      const got = []; for (let k = 0; k < 2 && up.length; k++) { const w = up.splice(Math.floor(h2(S.steps + k * 5, p.id) * up.length), 1)[0]; p.items[w]++; got.push(w); }
      if (!got.length) { const gl = Object.keys(GIFTS); for (let k = 0; k < 3; k++) { const g = gl[Math.floor(h2(S.steps + k * 7, p.id + 5) * gl.length)]; p.gifts[g] = gift(p, g) + 1; got.push(g); } }   // all maxed: three gifts
      ev(S, { k: 'fission', pid: p.id, x: p.x, y: p.y, ids: got }); }
    else if (id.startsWith('fuse:')) { p.fused.push([c.a, c.b]); ev(S, { k: 'fusion', pid: p.id, x: p.x, y: p.y, a: c.a, b: c.b }); }
    else if (id.startsWith('r:')) { const r = RECIPES.find((x) => x.id === c.rid);
      if (r.kind === 'awake') p.evo = 1;
      else { for (const f of r.from) if (f !== 'sig') { delete p.items[f]; delete p.wcd[f]; } if (r.kind === 'h') p.sigEvo = r.id; p.items[r.id] = 1; }
      const fresh = !S.found.includes(r.id); if (fresh) S.found.push(r.id);
      ev(S, { k: 'upgrade', pid: p.id, id: r.id, x: p.x, y: p.y, evo: 1, fresh: fresh ? 1 : 0 });
      if (fresh) ev(S, { k: 'discover', pid: p.id, id: r.id }); checkUnlocks(S); }
    else if (GIFTS[id]) { p.gifts[id] = gift(p, id) + 1; if (id === 'g_hp') p.hp += GIFTS.g_hp.k; }
    else { p.items[id] = lv(p, id) + 1; if (id === 'hp') p.hp += 20; }
    recalc(p); if (!id.startsWith('r:')) ev(S, { k: 'upgrade', pid: p.id, id, x: p.x, y: p.y, evo: 0 });
    openNext(S, p);
  }
  // a level-up: +1 level to something owned, or something new while a slot is free (locked weapons stay out until the meta opens them)
  function rollPick(S, p) {
    const cand = [];
    if (p.hero !== 'hasan' && !p.sigEvo && lv(p, 'sig') < MAXL) cand.push(['sig', 4]);           // Хасан's mustaches level at the barber
    if (p.hero !== 'hasan' && p.sigEvo && lv(p, p.sigEvo) < MAXL) cand.push([p.sigEvo, 4]);
    for (const id of Object.keys(WEAPONS)) { const l = lv(p, id); if (l) { if (l < MAXL && !isFused(p, id)) cand.push([id, 3]); }
      else if (!WEAPONS[id].from && usedW(p) < MAXW && unlocked(S, id) && S.spor !== 'pacifist') cand.push([id, WEAPONS[id].map === S.map ? 2.2 : 1.4]); }   // the town's own items show up more
    for (const id of Object.keys(PASSIVES)) { const q = PASSIVES[id]; if (q.hero && q.hero !== p.hero) continue; const l = lv(p, id);
      if (l) { if (l < pmax(id)) cand.push([id, 2.5]); } else if (!q.from && ownedP(p).length < MAXP && unlocked(S, id)) cand.push([id, q.map === S.map ? 2 : 1.3]); }
    const out = [];
    for (let k = 0; out.length < 3 && cand.length && k < 50; k++) { const tot = cand.reduce((a, c) => a + c[1], 0); let r = h2(S.steps + k * 17, p.id * 7 + S.lvl) * tot;
      for (let i = 0; i < cand.length; i++) { r -= cand[i][1]; if (r <= 0) { out.push(cand[i][0]); cand.splice(i, 1); break; } } }
    const gl = Object.keys(GIFTS);                                             // nothing left to level: «Бабушкины гостинцы», endless
    for (let k = 0; out.length < 3 && k < 30; k++) { const g = gl[Math.floor(h2(S.steps + k * 3, p.id + 31) * gl.length)]; if (!out.includes(g)) out.push(g); }
    if (p.hp < p.hpMax * 0.5 && GIFTS[out[2]]) out[2] = 'heal';
    if (p.rerolls > 0) out.push('reroll');
    return out.map((id) => cardFor(p, id));
  }
  // funny awards for the results screen
  function finishRun(S) {
    const P = S.players, top = (f) => P.reduce((a, b) => (f(b) > f(a) ? b : a)), A = [];
    const v = P.find((p) => p.hero === 'vitya'); if (v && v.st.allyHit > 0) A.push({ pid: v.id, t: 'Главный токсик', d: `${v.st.allyHit} раз окурил своих` });
    const gs = top((p) => p.st.gasIn); if (gs.st.gasIn > 2) A.push({ pid: gs.id, t: 'Любитель ароматов', d: `${gs.st.gasIn} сек в облаке Вити` });
    const r = top((p) => p.st.rev); if (r.st.rev > 0) A.push({ pid: r.id, t: 'Ангел-хранитель', d: `поднял друзей ${r.st.rev} раз` });
    const d = top((p) => p.st.downs); if (d.st.downs > 0) A.push({ pid: d.id, t: 'Профессиональный лежун', d: `падал ${d.st.downs} раз` });
    const x = top((p) => p.st.xp); A.push({ pid: x.id, t: x.hero === 'hasan' ? 'Пылесос усов' : 'Пылесос', d: `собрал ${Math.round(x.st.xp)} опыта` });
    const k = top((p) => p.st.dmg); A.push({ pid: k.id, t: S.map === 'meleuz' ? 'Мясник Мелеуза' : 'Мясник парка', d: `${Math.round(k.st.dmg)} урона` });
    S.awards = A; ev(S, { k: S.won ? 'win' : 'lose' });
  }

  // ---------------- attract demo: four bots fighting through a sped-up wave ----------------
  const scriptInput = () => ({});
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) { const S0 = create({ mode: 'demo' }); S0.wt0 = loop * L; S0.wave = 3; S0.lvl = 4; cache = { loop, S: S0 };
      for (const p of S0.players) { p.ult = 0.55 + 0.1 * p.id; p.items.sig = 3; p.items[['tapok', 'can', 'speaker', 'tapok'][p.id]] = 2; recalc(p); } }
    const S = cache.S; while (S.steps < n) step(S, {});
    return Object.assign({}, S, { loop, q });
  }
  const demoCheck = (S) => S.kills > 30 && S.players.every((p) => !p.out);
  const selfCheck = () => { const f = []; S0check(f); return f; };
  const S0check = (f) => { const S = create(); for (const p of S.players) if (blocked(p.x, p.y, 24)) f.push('player spawn blocked ' + p.hero);
    for (const [x, y] of LAMPS) if (onPave(x, y) && dist(x, y, C[0], C[1]) < 200) f.push('lamp in plaza centre'); };

  root.SIM = { DT, L, VIEW, WORLD, HINT, C, PLAZA, PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, WALLS, LV, HEROES, ORDER, ETYPES, UPG, QCD, LEHA_GUNS, WAVE_LEN, BREAK, WAVES,
    MAPS, MAPN, SPORS, QUESTS, DOOR, useMap, scoreX, PHOTOCARDS, debugHitRaw: debugHit, GUNS, GATT, shopList, priceOf, whyNot, trimPos, CUT_W, MUST_MAX, CUTS, lineDur, startBoss, HOLE_R, hotCell, LAS_W, LAS_GROUND, RING_GAP,
    onPave, inGas, collide, cardFor, kettleCards, recalc, lv, create, spawn, respawn, outOfPlay, step, at, scriptInput, demoCheck, selfCheck, botInput };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
