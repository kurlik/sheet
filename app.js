'use strict';
/* =====================================================================
   ЛИСТ ПЕРСОНАЖА — ядро: состояние, расчёты, тексты
   ===================================================================== */
const STORAGE_KEY = 'rpg_character_data';
const PIN_KEY = 'rpg_pin_hash';
const PIN_OFF_KEY = 'rpg_pin_off';
const MAX_LEVEL = 8;
const PIN_SALT = 'dementia-and-valor';
const DEFAULT_PIN_HASH = '1ce0cf06ad7ea2';
const USER_TRAIT_TYPES = ['Пассивка', 'Черта', 'Дар богов', 'Артефакт'];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const BODY_SLOTS = ['head', 'chest', 'arms', 'legs'];
const ARMOR_RANK = { light: 1, medium: 2, heavy: 3 };
const TABS = ['character', 'combat', 'inventory'];

const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n);
const spaced = n => (n >= 0 ? '+ ' : '− ') + Math.abs(n);
const scoreMod = s => Math.floor((s - 10) / 2);
const num1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const kg = n => (n > 0 && n < 0.1 ? Math.round(n * 1000) + ' г' : num1(n) + ' кг');
const meters = n => num1(n) + ' м';
const rarityBonus = r => (RARITIES[r] || RARITIES.common).bonus;
const uid = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const xpNeeded = lvl => 300 * lvl;
const stripTerms = t => String(t).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (a, k, l) => l || k);

function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
function hashPin(pin) { let h = String(pin); for (let i = 0; i < 500; i++) h = cyrb53(PIN_SALT + h, i); return h; }

/* ---------------------------------------------------------------------
   СОСТОЯНИЕ
   --------------------------------------------------------------------- */
function freshState() {
  return {
    version: 4, isLocked: false, activeTab: 'character',
    name: '', race: '', customRaceName: '', raceMutation: null,
    classRole: '', customClassName: '', classCrisis: null,
    background: '', customBgName: '',
    level: 1, xp: { current: 0 }, hp: { current: 10, temp: 0 }, mp: { current: 0 },
    coins: { gold: 0, silver: 0, copper: 0 }, combatLogs: [],
    attributes: STATS.map(s => ({ key: s.key, base: 10 })),
    statMethod: null, statsDone: false, asiBonus: {},
    userTraits: [], inventory: [], effects: [],
    equip: { head: null, chest: null, arms: null, legs: null, main: null, off: null },
    asiGiven: [], asiPending: null, feats: []
  };
}

function normName(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); }

function sanitize(raw) {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  const str = v => (typeof v === 'string' ? v : '');
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  s.isLocked = !!raw.isLocked;
  s.activeTab = TABS.includes(raw.activeTab) ? raw.activeTab : 'character';
  s.name = str(raw.name).slice(0, 60);
  let race = str(raw.race); race = RENAMES.race[race] || race; s.race = RACES[race] ? race : '';
  let cls = str(raw.classRole); cls = RENAMES.classRole[cls] || cls; s.classRole = CLASSES[cls] ? cls : '';
  let bg = str(raw.background); bg = RENAMES.background[bg] || bg; s.background = BACKGROUNDS[bg] ? bg : '';
  s.customRaceName = str(raw.customRaceName).slice(0, 40);
  s.customClassName = str(raw.customClassName).slice(0, 40);
  s.customBgName = str(raw.customBgName).slice(0, 40);

  const pickName = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? str(v.name) : '');
  let mut = pickName(raw.raceMutation); mut = RENAMES.mutation[mut] || mut;
  s.raceMutation = s.race && RACES[s.race].mutations.some(m => m.name === mut) ? mut : null;
  let cr = pickName(raw.classCrisis); cr = RENAMES.mutation[cr] || cr;
  s.classCrisis = s.classRole && CLASSES[s.classRole].crises.some(c => c.name === cr) ? cr : null;

  s.level = Math.min(MAX_LEVEL, Math.max(1, parseInt(raw.level) || 1));
  s.xp.current = Math.max(0, parseInt(raw.xp && raw.xp.current) || 0);
  if (s.level >= MAX_LEVEL) s.xp.current = 0;
  s.hp.current = Math.max(0, num(raw.hp && raw.hp.current, 10));
  s.hp.temp = Math.max(0, num(raw.hp && raw.hp.temp, 0));
  s.mp.current = Math.max(0, num(raw.mp && raw.mp.current, 0));
  ['gold', 'silver', 'copper'].forEach(k => { s.coins[k] = Math.max(0, parseInt(raw.coins && raw.coins[k]) || 0); });

  if (Array.isArray(raw.combatLogs)) {
    s.combatLogs = raw.combatLogs.filter(l => l && typeof l.text === 'string').slice(0, 15)
      .map(l => ({ text: l.text.replace(/КД/g, 'КБ').slice(0, 400), type: str(l.type) || 'info', time: str(l.time) }));
  }
  const hadStats = Array.isArray(raw.attributes);
  if (hadStats) {
    s.attributes = STATS.map(st => {
      const a = raw.attributes.find(x => x && x.key === st.key);
      return { key: st.key, base: Math.min(20, Math.max(1, parseInt(a && a.base) || 12)) };
    });
  }
  s.statMethod = STAT_METHODS[raw.statMethod] ? raw.statMethod : (hadStats ? 'manual' : null);
  s.statsDone = raw.statsDone === undefined ? hadStats : !!raw.statsDone;
  if (raw.asiBonus && typeof raw.asiBonus === 'object') STATS.forEach(st => { const v = parseInt(raw.asiBonus[st.key]); if (v > 0) s.asiBonus[st.key] = Math.min(4, v); });

  const traitsSrc = Array.isArray(raw.userTraits) ? raw.userTraits : Array.isArray(raw.traits) ? raw.traits.filter(t => t && USER_TRAIT_TYPES.includes(t.type)) : [];
  s.userTraits = traitsSrc.filter(t => t && typeof t === 'object').slice(0, 60).map(t => ({
    id: Number(t.id) || uid(), title: str(t.title).slice(0, 60) || 'Свойство',
    type: USER_TRAIT_TYPES.includes(t.type) ? t.type : 'Пассивка', desc: str(t.desc).slice(0, 600)
  }));

  if (Array.isArray(raw.inventory)) {
    const byName = {};
    ITEMS.forEach(i => { byName[normName(i.name)] = i.id; });
    s.inventory = raw.inventory.filter(i => i && typeof i === 'object').slice(0, 200).map((i, n) => {
      const name = str(i.name).slice(0, 80) || 'Предмет';
      let ref = str(i.ref), qty = Math.max(1, parseInt(i.qty) || 1);
      if (ref === 'arrows' || ref === 'bolts' || /^(Стрелы|Арбалетные болты), 20 шт\.$/.test(name)) { ref = /Стрел/.test(name) || ref === 'arrows' ? 'arrow' : 'bolt'; qty *= 20; }
      if (!ITEM_BY_ID[ref]) ref = RENAMES.item[name] || byName[normName(name)] || '';
      const def = ITEM_BY_ID[ref];
      const type = def ? def.type : (ITEM_TYPES.includes(i.type) ? i.type : 'Инструмент');
      const item = {
        id: Number(i.id) || (uid() + n), name: def && (ref === 'arrow' || ref === 'bolt' || name === 'Воровские отмычки') ? def.name : name, ref: def ? ref : '',
        type, rarity: RARITIES[i.rarity] ? i.rarity : 'common', qty,
        weight: def ? def.weight : Math.max(0, parseFloat(i.weight) || 0), fromBackground: !!i.fromBackground
      };
      if (i.fromClass) item.fromClass = true;
      if (i.fromPack) item.fromPack = true;
      if (def && def.charges) item.charges = Math.min(def.charges, Math.max(0, parseInt(i.charges ?? def.charges)));
      return item;
    });
  }
  const invIds = new Set(s.inventory.map(i => i.id));
  if (raw.equip && typeof raw.equip === 'object') {
    Object.keys(s.equip).forEach(k => { const v = Number(raw.equip[k]); s.equip[k] = invIds.has(v) ? v : null; });
  }
  if (Array.isArray(raw.effects)) {
    s.effects = raw.effects.filter(e => e && typeof e.src === 'string').slice(0, 20).map(e => ({
      uid: Number(e.uid) || uid(), src: e.src,
      counter: e.counter == null ? undefined : Math.max(0, parseInt(e.counter) || 0),
      hp: e.hp == null ? undefined : Math.max(0, parseInt(e.hp) || 0),
      max: e.max == null ? undefined : Math.max(1, parseInt(e.max) || 1)
    }));
  }
  s.asiGiven = Array.isArray(raw.asiGiven) ? raw.asiGiven.map(Number).filter(l => l === 4 || l === 8) : [4, 8].filter(l => l <= s.level);
  if (raw.asiPending && typeof raw.asiPending === 'object' && [4, 8].includes(Number(raw.asiPending.lvl))) {
    s.asiPending = { lvl: Number(raw.asiPending.lvl), mode: raw.asiPending.mode === 'feat' ? 'feat' : 'asi', alloc: {}, feat: null };
  }
  if (Array.isArray(raw.statPool)) s.statPool = raw.statPool.map(Number).filter(v => v >= 3 && v <= 18).slice(0, 6);
  s.packGiven = !!raw.packGiven;
  if (Array.isArray(raw.feats)) {
    s.feats = raw.feats.map(f => (f && f.id === 'warcaster' ? { id: 'source', lvl: f.lvl } : f))
      .filter(f => f && FEATS.some(x => x.id === f.id)).map(f => ({ id: f.id, lvl: Number(f.lvl) || 4 }));
  }
  return s;
}

let state;
try { state = sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { state = freshState(); }

function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ } }
function pinHash() { try { return localStorage.getItem(PIN_KEY) || DEFAULT_PIN_HASH; } catch (e) { return DEFAULT_PIN_HASH; } }
function pinRequired() { try { return localStorage.getItem(PIN_OFF_KEY) !== '1'; } catch (e) { return true; } }

/* ---------------------------------------------------------------------
   ОПРЕДЕЛЕНИЯ
   --------------------------------------------------------------------- */
function raceDef() { return RACES[state.race] || null; }
function classDef() { return CLASSES[state.classRole] || null; }
function mutationDef() { const r = raceDef(); return r && state.raceMutation ? r.mutations.find(m => m.name === state.raceMutation) || null : null; }
function crisisDef() { const c = classDef(); return c && state.classCrisis ? c.crises.find(m => m.name === state.classCrisis) || null : null; }
function itemById(id) { return id == null ? null : state.inventory.find(i => i.id === id) || null; }
function defOf(item) { return item && item.ref ? ITEM_BY_ID[item.ref] || null : null; }
function raceLabel() { return state.race === 'Своя раса' ? (state.customRaceName || 'Своя раса') : state.race; }
function classLabel() { return state.classRole === 'Свой класс' ? (state.customClassName || 'Свой класс') : state.classRole; }

/* Все источники эффектов персонажа: мутация, кризис, черты класса, черты уровня, активные приёмы */
function fxSources(lvl) {
  const cls = classDef(), mut = mutationDef(), crisis = crisisDef();
  const feats = state.feats.map(f => FEATS.find(x => x.id === f.id)).filter(Boolean);
  const list = [];
  if (cls) cls.traits.filter(t => t.lvl <= lvl && t.fx).forEach(t => list.push(t.fx));
  feats.forEach(f => f.fx && list.push(f.fx));
  if (mut && mut.fx) list.push(mut.fx);
  if (crisis && crisis.fx) list.push(crisis.fx);
  activeEffects().forEach(e => e.def.effect && e.def.effect.fx && list.push(e.def.effect.fx));
  return { list, feats };
}

/* Все приёмы, откуда бы они ни пришли */
function allActionDefs() {
  const out = [];
  const cls = classDef(), mut = mutationDef(), crisis = crisisDef();
  if (cls) cls.actions.forEach(a => out.push(a));
  (RACE_ACTIONS[state.race] || []).forEach(a => out.push({ ...a, source: 'Раса' }));
  [mut, crisis].forEach(m => m && m.fx && (m.fx.addActions || []).forEach(a => out.push({ ...a, source: m === mut ? 'Мутация' : 'Кризис' })));
  BEAST.actions.forEach(a => out.push({ ...a, beastOnly: true }));
  out.push({ id: 'item_antitoxin', lvl: 99, title: 'Противоядие', cost: 0, effect: { title: 'Противоядие', desc: 'Час ваши спасброски от яда с преимуществом. Снимите плашку, когда час пройдёт.' } });
  return out;
}
function findAction(id) { return allActionDefs().find(a => a.id === id) || null; }
function applyOverride(a) {
  const o = [mutationDef(), crisisDef()].map(m => m && m.fx && m.fx.override && m.fx.override[a.id]).find(Boolean);
  return o ? { ...a, ...o } : a;
}
function activeEffects() { return (state.effects || []).map(e => ({ ...e, def: findAction(e.src) || {} })).filter(e => e.def.id); }
function beastEffect() { return activeEffects().find(e => e.def.effect && e.def.effect.beast) || null; }

function derive(levelOverride) {
  const lvl = levelOverride || state.level;
  const race = raceDef(), cls = classDef(), mut = mutationDef();
  const prof = Math.floor((lvl - 1) / 4) + 2;
  const { list: fx, feats } = fxSources(lvl);
  const sumFx = key => fx.reduce((a, f) => a + (Number(f[key]) || 0), 0);
  const anyFx = key => fx.find(f => f[key]) || null;

  const scores = {}, mods = {}, raceB = {}, parts = {};
  STATS.forEach(st => {
    const a = state.attributes.find(x => x.key === st.key);
    const base = a ? a.base : 10;
    const rb = (race && race.bonuses[st.key]) || 0;
    const mb = (mut && mut.fx && mut.fx.stats && mut.fx.stats[st.key]) || 0;
    const asi = state.asiBonus[st.key] || 0;
    raceB[st.key] = rb + mb;
    parts[st.key] = { base, race: rb, mut: mb, asi };
    scores[st.key] = Math.min(20, base + rb + mb + asi);
    mods[st.key] = scoreMod(scores[st.key]);
  });

  const hd = cls ? cls.hitDie : 8;
  let maxHP = Math.max(lvl, hd + mods.CON + (lvl - 1) * (Math.floor(hd / 2) + 1 + mods.CON));
  maxHP += sumFx('hpPerLevel') * lvl + sumFx('hp');
  const lowHp = state.hp.current < maxHP / 2;

  let maxMP = 0;
  if (cls) maxMP = cls.category === 'caster' ? 10 + 4 * lvl : cls.category === 'hybrid' ? 6 + 2 * lvl : cls.category === 'martial' ? 2 + Math.floor(lvl / 2) : 10;
  if (cls && ['caster', 'hybrid'].includes(cls.category)) maxMP += sumFx('mpPerLevel') * lvl;

  const armorProf = new Set(cls ? cls.armor : ['light', 'medium', 'heavy', 'shield']);
  fx.forEach(f => { if (f.armorAdd) armorProf.add(f.armorAdd); });
  for (let i = 0; i < sumFx('armorUp'); i++) {
    if (!armorProf.has('light')) armorProf.add('light');
    else if (!armorProf.has('medium')) { armorProf.add('medium'); armorProf.add('shield'); }
    else armorProf.add('heavy');
  }

  const eq = {};
  Object.keys(state.equip).forEach(slot => { const item = itemById(state.equip[slot]); eq[slot] = item ? { item, def: defOf(item) } : null; });
  const warnings = [];
  let pieceAc = 0, heaviest = 0, rarityBody = 0, strReq = 0, stealth = false, itemInit = 0, itemSpeed = 0, anyArmorAc = false, noProf = false, metal = false;
  const worn = [];
  BODY_SLOTS.forEach(slot => {
    const e = eq[slot]; if (!e || !e.def) return;
    const d = e.def; worn.push(e);
    pieceAc += d.ac || 0; if ((d.ac || 0) > 0 || slot === 'chest') anyArmorAc = true;
    heaviest = Math.max(heaviest, ARMOR_RANK[d.armor] || 0);
    rarityBody = Math.max(rarityBody, rarityBonus(e.item.rarity));
    strReq = Math.max(strReq, d.str || 0); if (d.stealth) stealth = true; if (d.metal) metal = true;
    const f = d.fx || {}; itemInit += f.init || 0; itemSpeed += f.speed || 0;
    if (!armorProf.has(d.armor)) noProf = true;
  });
  const shieldE = ['main', 'off'].map(h => eq[h]).find(e => e && e.def && e.def.armor === 'shield') || null;
  let shieldAc = 0;
  if (shieldE) {
    shieldAc = shieldE.def.ac + rarityBonus(shieldE.item.rarity) + sumFx('shieldAc');
    strReq = Math.max(strReq, shieldE.def.str || 0);
    itemSpeed += (shieldE.def.fx && shieldE.def.fx.speed) || 0;
    if (!armorProf.has('shield')) noProf = true;
  }
  if (noProf) warnings.push('Надето то, чем ваш класс не владеет: все атаки с помехой, заклинания творить нельзя.');
  if (metal && cls && cls.noMetal) warnings.push('Друиды не носят металлические доспехи.');
  const strShort = strReq > scores.STR;
  if (strShort) warnings.push(`Не хватает Силы (нужно ${strReq}): скорость −3 м.`);
  if (stealth) warnings.push('Доспех шумит: прятаться с помехой.');

  const dex = mods.DEX;
  const dexPart = heaviest === 3 ? 0 : heaviest === 2 ? Math.min(dex, 2) : dex;
  const acOptions = [{ v: 10 + dexPart + pieceAc + rarityBody, parts: [['База', 10], [heaviest === 3 ? 'Лов (тяжёлый доспех — не считается)' : heaviest === 2 ? 'Лов (средний доспех, не больше +2)' : 'Лов', dexPart], ...worn.filter(e => e.def.ac).map(e => [e.item.name, e.def.ac]), ...(rarityBody ? [['Редкость доспеха', rarityBody]] : [])] }];
  if (!anyArmorAc) {
    fx.forEach(f => {
      if (f.unarmored === 'CON') acOptions.push({ v: 10 + dex + mods.CON, parts: [['Защита без доспехов', 10], ['Лов', dex], ['Тел', mods.CON]] });
      if (f.unarmored === 'WIS' && !shieldE) acOptions.push({ v: 10 + dex + mods.WIS, parts: [['Защита без доспехов', 10], ['Лов', dex], ['Мдр', mods.WIS]] });
    });
    if (race && race.naturalAc) acOptions.push({ v: race.naturalAc + dex, parts: [['Чешуя', race.naturalAc], ['Лов', dex]] });
  }
  const bestAc = acOptions.reduce((a, b) => (b.v > a.v ? b : a));
  const acParts = [...bestAc.parts];
  if (shieldAc) acParts.push([shieldE.item.name, shieldAc]);
  const mutAc = (mut && mut.fx && mut.fx.ac) || 0;
  if (mutAc) acParts.push(['Мутация', mutAc]);
  activeEffects().forEach(e => { const a = e.def.effect && e.def.effect.fx && e.def.effect.fx.ac; if (a) acParts.push([e.def.effect.title, a]); });
  const lowAc = lowHp ? sumFx('lowHpAc') : 0;
  if (lowAc) acParts.push(['Меньше половины HP', lowAc]);
  const ac = acParts.slice(bestAc.parts.length).reduce((a, p) => a + p[1], bestAc.v);

  const speedParts = [['Раса', race ? race.speed : 9]];
  if (mut && mut.fx && mut.fx.speed) speedParts.push(['Мутация', mut.fx.speed]);
  const featSpeed = feats.reduce((a, f) => a + ((f.fx && f.fx.speed) || 0), 0);
  if (featSpeed) speedParts.push(['Черта', featSpeed]);
  if (itemSpeed) speedParts.push(['Снаряжение', itemSpeed]);
  const monkSpeed = sumFx('monkSpeed');
  if (monkSpeed && !anyArmorAc && !shieldE) speedParts.push(['Быстрый шаг', monkSpeed]);
  if (strShort) speedParts.push(['Не хватает Силы', -3]);
  const speed = Math.max(1.5, speedParts.reduce((a, p) => a + p[1], 0));

  const init = dex + itemInit + feats.reduce((a, f) => a + ((f.fx && f.fx.init) || 0), 0);
  let carry = scores.STR * 5 + ((race && race.carry) || 0) + ((cls && cls.carry) || 0) + ((mut && mut.fx && mut.fx.carry) || 0);
  carry = Math.max(15, carry);
  const load = state.inventory.reduce((a, i) => a + i.qty * i.weight, 0);

  const castKey = cls ? cls.cast : 'INT';
  const castMod = mods[castKey];
  const dc = 8 + prof + castMod + sumFx('dc');
  const attacksPerTurn = Math.max(1, ...fx.map(f => f.attacks || 1));
  const sneak = lvl >= 7 ? '4d6' : lvl >= 5 ? '3d6' : lvl >= 3 ? '2d6' : '1d6';
  const hpNotes = fx.map(f => f.hpNote).filter(Boolean);

  const d = { lvl, prof, scores, mods, raceB, parts, maxHP, maxMP, lowHp, ac, acParts, speed, speedParts, init, carry, load, castKey, castMod, dc, satk: prof + castMod, sneak, attacksPerTurn, warnings, eq, armorProf, feats, fx, sumFx, anyFx, hpNotes };
  d.attacks = buildAttacks(d);
  return d;
}

function weaponProficient(def) {
  const cls = classDef(); if (!cls) return true;
  return (cls.weapons.cats || []).includes(def.cat) || (cls.weapons.ids || []).includes(def.id);
}
function ammoCount(ref) { return state.inventory.filter(i => i.ref === ref).reduce((a, i) => a + i.qty, 0); }

function buildAttacks(d) {
  const cls = classDef(), race = raceDef();
  const list = [];
  const effects = activeEffects();
  const onHit = effects.map(e => e.def.effect && e.def.effect.onHit).filter(Boolean).map(t => fillText(t, d));
  const weaponExtra = effects.map(e => e.def.effect && e.def.effect.weaponExtra).filter(Boolean);
  const meleeFlat = d.sumFx('meleeDmg');
  const lowFlat = d.lowHp ? d.sumFx('lowHpDmg') : 0;
  const attackNotes = d.fx.map(f => f.attackNote).filter(Boolean);
  const bonusMelee = !!d.anyFx('bonusMelee');
  const beast = beastEffect();

  const mk = (o) => {
    const extras = [...(o.weapon ? weaponExtra : []), ...onHit];
    const flat = (o.melee ? meleeFlat : 0) + lowFlat;
    const notes = [...(o.notes || [])];
    if (flat) notes.unshift(`в уроне уже учтено +${flat}${lowFlat ? ' (в том числе +' + lowFlat + ' за HP ниже половины)' : ''}`);
    if (o.melee && bonusMelee) notes.push('ещё один удар бонусным действием — без модификатора к урону');
    return { ...o, dmgMod: o.dmgMod + flat, extras, notes: [...notes, ...attackNotes] };
  };

  if (beast) {
    list.push(mk({ key: 'beast', title: BEAST.attack.title, atk: d.mods.WIS + d.prof, die: '1d8', dmgMod: d.mods.WIS, dmgType: 'рубящий', melee: true, notes: ['звериный облик'], count: 1, disadv: [] }));
    return list;
  }

  const main = d.eq.main, off = d.eq.off;
  const weapons = [];
  if (main && main.def && main.def.type === 'Оружие') weapons.push({ hand: 'main', ...main });
  if (off && off.def && off.def.type === 'Оружие' && !(main && off.item.id === main.item.id && main.def.hands === 2)) weapons.push({ hand: 'off', ...off });
  const armorFx = { melee: 0, ranged: 0 };
  BODY_SLOTS.forEach(sl => { const e = d.eq[sl]; if (e && e.def && e.def.fx) { armorFx.melee += e.def.fx.meleeAtk || 0; armorFx.ranged += e.def.fx.rangedAtk || 0; } });
  const bothLight = weapons.length === 2 && weapons.every(w => w.def.light);

  weapons.forEach(w => {
    const def = w.def;
    const ranged = !!def.ranged;
    const monkWeapon = cls && cls.monk && def.hands === 1 && (def.cat === 'simple' || def.id === 'shortsword');
    const finesse = def.finesse || monkWeapon;
    const abil = ranged ? d.mods.DEX : finesse ? Math.max(d.mods.STR, d.mods.DEX) : d.mods.STR;
    const prof = weaponProficient(def);
    const rb = rarityBonus(w.item.rarity);
    const atk = abil + (prof ? d.prof : 0) + rb + (ranged ? armorFx.ranged : armorFx.melee);
    const otherHand = w.hand === 'main' ? state.equip.off : state.equip.main;
    const twoHanding = def.vers && (otherHand == null);
    const die = twoHanding ? def.vers : def.dmg;
    const offhand = w.hand === 'off' && bothLight;
    const dmgMod = (offhand ? Math.min(0, abil) : abil) + rb;
    const disadv = [];
    if (!prof) disadv.push('ваш класс не владеет этим оружием');
    if (def.heavy && race && race.small) disadv.push('маленький рост');
    if (def.heavy && !ranged && d.scores.STR < 13) disadv.push('тяжёлому оружию нужна Сила 13');
    if (def.heavy && ranged && d.scores.DEX < 13) disadv.push('тяжёлому луку или арбалету нужна Ловкость 13');
    const notes = [];
    if (offhand) notes.push('бонусное действие, без модификатора к урону');
    else if (d.attacksPerTurn > 1 && !def.reload) notes.push(`${d.attacksPerTurn} атаки за ход — нажимайте за каждую`);
    if (def.reload) notes.push('один выстрел за ход');
    if (ranged) notes.push(`дальность ${def.ranged.replace('/', ' / ')} м`);
    if (def.thrown) notes.push(`можно метнуть на ${def.thrown.replace('/', ' / ')} м`);
    if (def.reach) notes.push('достаёт на 3 м');
    if (twoHanding) notes.push('двумя руками');
    if (!prof) notes.push('без БМ');
    if (w.hand === 'main' && weapons.length === 2 && !bothLight) notes.push('удара второй рукой нет: оба оружия должны быть лёгкими');
    const ammo = def.ammo ? { ref: def.ammo, count: ammoCount(def.ammo), name: ITEM_BY_ID[def.ammo].name } : null;
    list.push(mk({ key: w.hand + ':' + w.item.id, title: offhand ? w.item.name + ' (вторая рука)' : w.item.name, atk, die, dmgMod, dmgType: def.dmgType, notes, disadv, ammo, melee: !ranged, weapon: true, count: offhand ? 1 : def.reload ? 1 : d.attacksPerTurn }));
  });

  if (!weapons.length) {
    if (cls && cls.monk) {
      list.push(mk({ key: 'unarmed', title: 'Удар рукой', atk: d.mods.DEX + d.prof, die: d.lvl >= 5 ? '1d6' : '1d4', dmgMod: Math.max(d.mods.STR, d.mods.DEX), dmgType: 'дробящий', melee: true, notes: d.attacksPerTurn > 1 ? [`${d.attacksPerTurn} атаки за ход — нажимайте за каждую`] : [], disadv: [] }));
    } else if (race && race.claws) {
      list.push(mk({ key: 'unarmed', title: 'Когти', atk: d.mods.STR + d.prof, die: '1d6', dmgMod: d.mods.STR, dmgType: 'рубящий', melee: true, notes: [], disadv: [] }));
    } else {
      list.push(mk({ key: 'unarmed', title: 'Удар без оружия', atk: d.mods.STR + d.prof, die: '', dmgMod: 1 + d.mods.STR, dmgType: 'дробящий', melee: true, notes: ['оружие не надето'], disadv: [] }));
    }
  }
  if (state.race === 'Ящеролюд') list.push(mk({ key: 'bite', title: 'Укус', atk: d.mods.STR + d.prof, die: '1d6', dmgMod: d.mods.STR, dmgType: 'колющий', melee: true, notes: ['вместо удара оружием'], disadv: [] }));
  d.fx.forEach(f => (f.addAttacks || []).forEach(a => list.push(mk({ key: a.key, title: a.title, atk: d.mods[a.stat] + d.prof, die: a.die, dmgMod: d.mods[a.stat], dmgType: a.dmgType, melee: true, notes: a.note ? [fillText(a.note, d)] : [], disadv: [] }))));
  return list;
}

/* Подстановки в текстах приёмов */
function fillText(t, d) {
  const lvl = d.lvl, m = d.mods;
  const c = sides => (lvl >= 5 ? '2d' : '1d') + sides;
  const mockN = (lvl >= 5 ? 2 : 1) + (d.sumFx ? d.sumFx('mockPlus') : 0);
  const insp = (d.anyFx && d.anyFx('inspDie') && d.anyFx('inspDie').inspDie) || (lvl >= 5 ? '1d8' : '1d6');
  const markDie = (d.anyFx && d.anyFx('markDie') && d.anyFx('markDie').markDie) || '1d6';
  const map = {
    lvl, prof: d.prof, dc: d.dc, satk: spaced(d.satk), sneak: d.sneak,
    STR: spaced(m.STR), DEX: spaced(m.DEX), CON: spaced(m.CON), INT: spaced(m.INT), WIS: spaced(m.WIS), CHA: spaced(m.CHA),
    c6: c(6), c8: c(8), c10: c(10), mockDie: mockN + 'd6', md: lvl >= 5 ? '1d6' : '1d4', insp, markDie,
    loh: 2 * lvl + 3, grim: 2 * lvl, wild: 5 * lvl, atkDex: spaced(m.DEX + d.prof), bdc: 8 + d.prof + m.CON,
    beams: lvl >= 5 ? 'два луча, для каждого ' : ''
  };
  return String(t).replace(/\{(\w+)\}/g, (all, k) => (k in map ? map[k] : all));
}
function rich(t, d) {
  const filled = d ? fillText(t, d) : String(t);
  return esc(filled).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, key, label) => {
    const k = key.trim();
    if (!GLOSSARY[k]) return esc(label || key);
    return `<span class="term" role="button" tabindex="0" data-act="term" data-term="${esc(k)}">${label || key}</span>`;
  });
}

/* Все черты персонажа */
function allTraits(d) {
  const out = [];
  const race = raceDef(), cls = classDef(), mut = mutationDef(), crisis = crisisDef(), bg = BACKGROUNDS[state.background];
  if (race) race.traits.forEach((t, i) => out.push({ key: 'race' + i, type: 'Раса', title: t.title, desc: t.desc }));
  if (cls) cls.traits.filter(t => t.lvl <= d.lvl).forEach((t, i) => out.push({ key: 'cls' + i + t.title, type: 'Класс', title: t.title, desc: t.desc }));
  if (mut) out.push({ key: 'mut', type: 'Мутация', title: mut.name, pair: [mut.buff, mut.debuff] });
  if (crisis) out.push({ key: 'crisis', type: 'Кризис', title: crisis.name, pair: [crisis.buff, crisis.debuff] });
  if (bg && bg.trait) out.push({ key: 'bg', type: 'Предыстория', title: bg.trait.title, desc: bg.trait.desc });
  d.feats.forEach(f => out.push({ key: 'feat' + f.id, type: 'Черта', title: f.title, desc: f.desc }));
  state.userTraits.forEach(t => out.push({ key: 'user' + t.id, type: t.type, title: t.title, desc: t.desc, userId: t.id, plain: true }));
  return out;
}
function traitBody(t, d) {
  if (t.plain) return esc(t.desc).replace(/\n/g, '<br>');
  if (t.pair) return `<p><b>Дар.</b> ${rich(t.pair[0], d)}</p><p><b>Бремя.</b> ${rich(t.pair[1], d)}</p>`;
  return `<p>${rich(t.desc, d)}</p>`;
}

/* ---------------------------------------------------------------------
   ПОИСК ПРЕДМЕТОВ
   --------------------------------------------------------------------- */
const LAYOUT = { q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё' };
const SEARCH_INDEX = ITEMS.map(it => ({ it, keys: [it.name, ...(it.aliases || [])].map(normName) }));
function toRu(s) { return String(s).toLowerCase().split('').map(ch => LAYOUT[ch] || ch).join(''); }
function editDistance(a, b) {
  const al = a.length, bl = b.length; if (!al) return bl; if (!bl) return al;
  const dp = Array.from({ length: al + 1 }, (_, i) => [i, ...new Array(bl).fill(0)]);
  for (let j = 1; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) for (let j = 1; j <= bl; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
  }
  return dp[al][bl];
}
function matchScore(q, key) {
  if (!q) return 0;
  if (key === q) return 100;
  const at = key.indexOf(q); if (at === 0) return 95; if (at > 0) return 85;
  const qt = q.split(' '), kt = key.split(' ');
  let total = 0;
  for (const t of qt) {
    let best = 0;
    for (const k of kt) {
      if (k.startsWith(t)) { best = Math.max(best, 72); continue; }
      const allowed = t.length <= 3 ? 0 : t.length <= 6 ? 1 : 2;
      if (!allowed) continue;
      const dist = Math.min(editDistance(t, k), editDistance(t, k.slice(0, t.length)), editDistance(t, k.slice(0, t.length + 1)));
      if (dist <= allowed) best = Math.max(best, 64 - dist * 12);
    }
    if (!best) return 0;
    total += best;
  }
  return total / qt.length;
}
function searchItems(query) {
  const variants = [...new Set([normName(query), normName(toRu(query))])].filter(Boolean);
  if (!variants.length) return [];
  return SEARCH_INDEX.map(({ it, keys }) => ({ it, score: Math.max(...variants.flatMap(v => keys.map(k => matchScore(v, k)))) }))
    .filter(r => r.score >= 40).sort((a, b) => b.score - a.score || a.it.name.length - b.it.name.length).slice(0, 5).map(r => r.it);
}
function itemStatLine(def, rarity) {
  if (!def) return '';
  const rb = rarityBonus(rarity || def.rarity || 'common');
  if (def.type === 'Оружие') return `${def.dmg}${def.vers ? ' / ' + def.vers : ''} ${def.dmgType}${rb ? ', +' + rb : ''} · ${def.hands === 2 ? 'две руки' : 'одна рука'}`;
  if (def.armor === 'shield') return `щит, КБ +${def.ac + rb}`;
  if (def.slot) return `${SLOT_NAMES[def.slot].toLowerCase()}, ${ARMOR_TYPE_NAMES[def.armor]}${def.ac || rb ? ', КБ +' + (def.ac + rb) : ''}`;
  if (def.charges) return `${def.type.toLowerCase()}, заряды`;
  return def.type.toLowerCase();
}

/* =====================================================================
   ОКНА, ДЕЙСТВИЯ, УРОВНИ
   ===================================================================== */
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let modalStack = [];
function showModal(renderFn, opts) { modalStack.push({ renderFn, opts: opts || {} }); paintModal(true); }
function paintModal(animate) {
  const top = modalStack[modalStack.length - 1];
  const root = $('modal');
  if (!top) { root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); return; }
  const back = modalStack.length > 1 ? '<button type="button" class="back-link" data-act="modal-back">← Назад</button>' : '';
  const body = $('modal-body');
  const keep = animate ? 0 : body.scrollTop;
  body.innerHTML = back + top.renderFn();
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  body.scrollTop = keep;
  if (animate) unroll();
}
/* Разворачивание: край бумаги всегда ровно под движущимся нижним валиком */
function unroll() {
  const scroll = $('modal-scroll'), roller = $('modal-roller');
  if (motionOff() || typeof requestAnimationFrame !== 'function') { scroll.style.clipPath = ''; roller.style.display = 'none'; return; }
  const R = 36, start = 42, dur = 480, t0 = performance.now();
  const place = y => { scroll.style.clipPath = `inset(-40px -44px calc(100% - ${y + R}px) -44px)`; roller.style.transform = `translateY(${y}px)`; };
  roller.style.display = 'block'; place(start);
  const frame = now => {
    const H = scroll.offsetHeight;                      // высота на каждом кадре
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    const y = start + (H - R - start) * e;
    if (window.__unrollLog) window.__unrollLog.push([Math.round(y + R), H, k]);
    if (k < 1) { place(y); requestAnimationFrame(frame); } else { scroll.style.clipPath = ''; roller.style.display = 'none'; }
  };
  requestAnimationFrame(frame);
}
function leaveDraft(top) {
  if (top && top.renderFn === statDraftHtml && statDraft && !statDraft.touched && !statDraft.redo && statDraft.prev) { state.statMethod = statDraft.prev.m; state.statsDone = statDraft.prev.done; persist(); render(); }
}
function closeModal(all) {
  const top = modalStack[modalStack.length - 1];
  if (top && top.opts.locked && !all) return;
  leaveDraft(top);
  if (all) modalStack = []; else modalStack.pop();
  paintModal(false);
  if (!modalStack.length && top && top.opts.onClose) top.opts.onClose();
}
function refreshModal() { if (modalStack.length) paintModal(false); }
function infoModal(title, tag, bodyHtml, buttonsHtml) {
  showModal(() => `
    ${tag ? `<span class="scroll-tag">${esc(tag)}</span>` : ''}
    <h3 class="scroll-title">${esc(title)}</h3>
    <div class="scroll-text">${bodyHtml}</div>
    <div class="btn-row">${buttonsHtml || ''}<button type="button" class="btn" data-act="modal-close">Закрыть</button></div>`);
}
let confirmResolve = null;
function askConfirm(title, text, okLabel, danger) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    showModal(() => `
      <h3 class="scroll-title">${esc(title)}</h3>
      <div class="scroll-text"><p>${esc(text)}</p></div>
      <div class="btn-row"><button type="button" class="btn" data-act="confirm-no">Отмена</button>
      <button type="button" class="btn ${danger ? 'danger' : ''}" data-act="confirm-yes">${esc(okLabel || 'Да')}</button></div>`,
      { onClose: () => { if (confirmResolve) { confirmResolve(false); confirmResolve = null; } } });
  });
}
function finishConfirm(ok) { const r = confirmResolve; confirmResolve = null; modalStack.pop(); paintModal(false); if (r) r(ok); }

/* ---------- журнал и плашка броска ---------- */
let logExpanded = false, toastTimer = null;
function addLog(text, type) {
  const t = new Date();
  const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  state.combatLogs.unshift({ text, type: type || 'info', time });
  state.combatLogs = state.combatLogs.slice(0, 15);
}
function toast(text, type) {
  const el = $('toast'); if (!el) return;
  el.className = 'toast show toast-' + (type || 'info');
  el.innerHTML = `<span>${esc(text)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, Math.min(9000, 3500 + text.length * 35));
}
function hideToast() { const el = $('toast'); if (el) el.classList.remove('show'); }
function logToast(text, type) { addLog(text, type); toast(text, type); }

/* ---------- опыт и уровни ---------- */
let levelQueue = [];
function snapshot(lvl) { const d = derive(lvl); return { maxHP: d.maxHP, maxMP: d.maxMP, prof: d.prof, dc: d.dc, sneak: d.sneak }; }
function raiseLevel() {
  const before = derive();
  state.level++;
  const after = derive();
  state.hp.current += Math.max(0, after.maxHP - before.maxHP);
  state.mp.current += Math.max(0, after.maxMP - before.maxMP);
  levelQueue.push(state.level);
  addLog(`Новый уровень: ${state.level}.`, 'heal');
}
function addXP(amount) {
  if (state.level >= MAX_LEVEL) { logToast('Персонаж уже на максимальном, 8-м уровне.', 'info'); save(); return; }
  state.xp.current += amount;
  addLog(`Получено ${amount} XP.`, 'info');
  while (state.level < MAX_LEVEL && state.xp.current >= xpNeeded(state.level)) { state.xp.current -= xpNeeded(state.level); raiseLevel(); }
  if (state.level >= MAX_LEVEL) state.xp.current = 0;
  save(); nextLevelUp();
}
function nextLevelUp() {
  if (modalStack.some(m => m.opts.levelUp)) return;
  const q = levelQueue.shift();
  if (q) typeof q === 'object' ? showLevelUp(q.lvl, true) : showLevelUp(q);
  else if (typeof tutRender === 'function') tutRender();
}
function showLevelUp(lvl, asiOnly) {
  if ([4, 8].includes(lvl) && !state.asiGiven.includes(lvl) && !(state.asiPending && state.asiPending.lvl === lvl)) {
    state.asiPending = { lvl, mode: 'asi', alloc: {}, feat: null, asiOnly: !!asiOnly }; persist();
  }
  if (asiOnly) { showModal(() => !state.asiPending ? '' : `<span class="scroll-tag">Прибавка за ${lvl}-й уровень</span><h3 class="scroll-title">Распределите заново</h3><div class="scroll-text">${asiHtml(state.asiPending, derive())}</div><div class="btn-row"><button type="button" class="btn" data-act="levelup-done" ${asiReady(state.asiPending) ? '' : 'disabled'}>Подтвердить</button></div>`, { levelUp: true, locked: true, onClose: () => setTimeout(nextLevelUp, 50) }); return; }
  const prev = snapshot(lvl - 1), next = snapshot(lvl);
  showModal(() => levelUpHtml(lvl, prev, next), {
    levelUp: true,
    get locked() { return !!(state.asiPending && state.asiPending.lvl === lvl); },
    onClose: () => setTimeout(nextLevelUp, 50)
  });
}
function levelUpHtml(lvl, prev, next) {
  const cls = classDef(), d = derive();
  const ba = (a, b) => `${a} → ${b}`;
  const grown = [];
  grown.push([`Максимум HP: ${ba(prev.maxHP, next.maxHP)}`, `<span class="up">+${next.maxHP - prev.maxHP}</span>`]);
  if (next.maxMP > prev.maxMP) grown.push([`Запас MP «${cls ? cls.resource : 'Энергия'}»: ${ba(prev.maxMP, next.maxMP)}`, `<span class="up">+${next.maxMP - prev.maxMP}</span>`]);
  if (next.prof > prev.prof) grown.push(`[[БМ]]: ${ba(signed(prev.prof), signed(next.prof))} — все ваши атаки и заклинания попадают точнее`);
  if (cls && ['caster', 'hybrid'].includes(cls.category) && next.dc > prev.dc) grown.push(`[[Сл]] ваших заклинаний: ${ba(prev.dc, next.dc)} — врагам труднее спастись`);
  if (state.classRole === 'Плут' && next.sneak !== prev.sneak) grown.push(`Скрытая атака: ${ba(prev.sneak, next.sneak)} дополнительного урона`);
  if (lvl === 5 && cls) {
    cls.actions.filter(a => a.cost === 0 && a.dmg && a.lvl <= 5).forEach(a => {
      if (a.id === 'bd_mock') { const n = d.sumFx('mockPlus'); grown.push(`${a.title}: урон ${1 + n}d6 → ${2 + n}d6`); }
      else if (a.id === 'wl_blast') grown.push(`${a.title}: два луча вместо одного, у каждого свой бросок`);
      else { const die = (a.desc.match(/\{c(\d+)\}/) || [])[1]; if (die) grown.push(`${a.title}: урон 1d${die} → 2d${die}`); }
    });
    if (state.classRole === 'Монах') grown.push('Боевые искусства: удар рукой 1d4 → 1d6');
    if (state.classRole === 'Бард' && !d.anyFx('inspDie')) grown.push('Воодушевление: союзник прибавляет к броску 1d8 вместо 1d6');
  }
  const newStuff = [];
  if (cls) {
    cls.actions.filter(a => a.lvl === lvl && !(d.fx.some(f => (f.hide || []).includes(a.id)))).forEach(a => newStuff.push({ title: a.title, tag: 'Приём', desc: applyOverride(a).desc }));
    cls.traits.filter(t => t.lvl === lvl).forEach(t => newStuff.push({ title: t.title, tag: 'Черта класса', desc: t.desc }));
  }
  const pending = state.asiPending && state.asiPending.lvl === lvl ? state.asiPending : null;
  let html = `<span class="scroll-tag">Новый уровень</span><h3 class="scroll-title">Уровень ${lvl}</h3>`;
  html += `<div class="scroll-text"><h4>Что выросло</h4><ul class="plain-list">${grown.map(g => Array.isArray(g) ? `<li>${rich(g[0])} ${g[1]}</li>` : `<li>${rich(g)}</li>`).join('')}</ul>`;
  if (newStuff.length) html += `<h4>Новое</h4>` + newStuff.map(n => `<div class="perk"><b>${esc(n.title)}</b> <span class="perk-tag">${n.tag}</span><p>${rich(n.desc, d)}</p></div>`).join('');
  else if (!pending) html += `<p class="muted">Новых приёмов на этом уровне нет — выросли здоровье${next.maxMP > prev.maxMP ? ' и запас MP' : ''}.</p>`;
  if (pending) html += asiHtml(pending, d);
  html += `</div><div class="btn-row"><button type="button" class="btn" data-act="levelup-done" ${pending && !asiReady(pending) ? 'disabled' : ''}>${pending ? 'Подтвердить' : 'Отлично'}</button></div>`;
  return html;
}
function asiReady(p) { return p.mode === 'feat' ? !!p.feat : Object.values(p.alloc).reduce((a, b) => a + b, 0) === 2; }
function armoredText(d) {
  const has = d.armorProf, names = { light: 'лёгкие доспехи', medium: 'средние доспехи и щиты', heavy: 'тяжёлые доспехи' };
  const next = !has.has('light') ? 'light' : !has.has('medium') ? 'medium' : !has.has('heavy') ? 'heavy' : null;
  if (!next) return null;
  const now = has.has('medium') ? 'лёгкие и средние доспехи' : has.has('light') ? 'лёгкие доспехи' : 'никакие доспехи';
  return `Сейчас вы умеете носить ${now}. С этой чертой сможете носить ${names[next]} без штрафов.`;
}
function featsFor(d) {
  const cls = classDef(), taken = new Set(state.feats.map(f => f.id));
  return FEATS.map(f => {
    if (f.id === 'armored') { const t = armoredText(d); return t ? { ...f, desc: t } : null; }
    if (taken.has(f.id)) return null;
    if (f.only && !(cls && f.only.includes(cls.category))) return null;
    return f;
  }).filter(Boolean);
}
function asiHtml(p, d) {
  const spent = Object.values(p.alloc).reduce((a, b) => a + b, 0);
  let h = p.asiOnly ? '' : `<h4>Выбор уровня</h4><div class="seg">
    <button type="button" class="seg-btn ${p.mode === 'asi' ? 'on' : ''}" data-act="asi-mode" data-mode="asi">+2 к характеристикам</button>
    <button type="button" class="seg-btn ${p.mode === 'feat' ? 'on' : ''}" data-act="asi-mode" data-mode="feat">Черта</button></div>`;
  if (p.mode === 'asi') {
    h += `<p class="muted">Раздайте 2 очка: оба в одну характеристику или по одному в две. Больше 20 поднять нельзя. Осталось: ${2 - spent}.</p><div class="asi-grid">`;
    STATS.forEach(st => {
      const add = p.alloc[st.key] || 0, total = d.scores[st.key] + add, can = spent < 2 && total < 20;
      h += `<button type="button" class="asi-btn ${add ? 'on' : ''}" data-act="asi-add" data-key="${st.key}" ${can ? '' : 'disabled'}><span>${st.short}</span><b>${total}</b>${add ? `<i>+${add}</i>` : ''}</button>`;
    });
    h += `</div>${spent ? '<button type="button" class="link-btn" data-act="asi-reset">Сбросить выбор</button>' : ''}`;
  } else {
    h += `<div class="feat-list">` + featsFor(d).map(f => `<div role="button" tabindex="0" class="feat ${p.feat === f.id ? 'on' : ''}" data-act="asi-feat" data-id="${f.id}"><b>${esc(f.title)}</b><span>${rich(f.desc)}</span></div>`).join('') + `</div>`;
  }
  return h;
}
function confirmLevelUp() {
  const top = modalStack[modalStack.length - 1];
  const p = state.asiPending;
  if (p && top && top.opts.levelUp) {
    if (!asiReady(p)) return;
    const before = derive();
    if (p.mode === 'asi') {
      Object.entries(p.alloc).forEach(([k, v]) => { state.asiBonus[k] = (state.asiBonus[k] || 0) + v; });
      addLog(`Характеристики повышены: ${Object.entries(p.alloc).map(([k, v]) => STATS.find(s => s.key === k).short + ' +' + v).join(', ')}.`, 'heal');
    } else {
      state.feats.push({ id: p.feat, lvl: p.lvl });
      addLog(`Новая черта: ${FEATS.find(f => f.id === p.feat).title}.`, 'heal');
    }
    state.asiGiven.push(p.lvl); state.asiPending = null;
    const after = derive();
    state.hp.current += Math.max(0, after.maxHP - before.maxHP);
    state.mp.current += Math.max(0, after.maxMP - before.maxMP);
    save();
  }
  closeModal(true);
  setTimeout(nextLevelUp, 50);
}

/* ---------- распределение характеристик ---------- */
let statDraft = null;
function statPriority() { return STAT_PRIORITY[state.classRole] || STATS.map(s => s.key); }
function openStats() {
  const canPick = !state.isLocked;
  if (!canPick && (!state.statMethod || state.statsDone)) { infoModal('Характеристики', '', '<p>Способ распределения выбирает мастер в режиме редактирования.</p>'); return; }
  if (canPick) showModal(statMethodsHtml);
  else startMethod(state.statMethod);
}
function statMethodsHtml() {
  return `<span class="scroll-tag">Характеристики</span><h3 class="scroll-title">Способ распределения</h3>
    <div class="scroll-text"><p>Выберите способ, о котором вы договорились с мастером и остальными игроками. Расовые бонусы прибавятся сверху при любом способе, а прибавки за уровни сохранятся.</p>
    ${Object.entries(STAT_METHODS).map(([k, m]) => `<div role="button" tabindex="0" class="option ${state.statMethod === k ? 'on' : ''}" data-act="stat-method" data-m="${k}"><b>${m.title}</b><span>${esc(m.desc)}</span></div>`).join('')}</div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button></div>`;
}
function startMethod(m) {
  const cur = Object.fromEntries(state.attributes.map(a => [a.key, a.base]));
  statDraft = { m, vals: {}, pool: null, rolls: null, touched: false, prev: startMethod.prev || null };
  startMethod.prev = null;
  if (m === 'pointbuy') STATS.forEach(s => { statDraft.vals[s.key] = 8; });
  if (m === 'manual') STATS.forEach(s => { statDraft.vals[s.key] = cur[s.key]; });
  if (m === 'standard') statDraft.pool = STANDARD_ARRAY.slice();
  if (m === 'roll') statDraft.pool = null;
  showModal(statDraftHtml);
}
function pointsLeft() { return 27 - STATS.reduce((a, s) => a + POINT_COST[statDraft.vals[s.key]], 0); }
function draftReady() {
  const m = statDraft.m;
  if (m === 'pointbuy') return pointsLeft() >= 0;
  if (m === 'manual') return STATS.every(s => statDraft.vals[s.key] >= 3 && statDraft.vals[s.key] <= 18);
  return statDraft.pool && STATS.every(s => statDraft.vals[s.key] != null);
}
function statDraftHtml() {
  const m = statDraft.m, meth = STAT_METHODS[m], race = raceDef();
  const rb = k => (race && race.bonuses[k]) || 0;
  let rows = '';
  if (m === 'roll' && !statDraft.pool) {
    return `<span class="scroll-tag">${meth.title}</span><h3 class="scroll-title">Броски кубиков</h3>
      <div class="scroll-text"><p>Бросьте 4d6 шесть раз и отбросьте в каждом броске худший кубик. Можно бросить в приложении или вписать то, что выпало на настоящих кубиках. Всё попадёт в журнал.</p></div>
      <div class="btn-row"><button type="button" class="btn" data-act="stat-roll">Бросить в приложении</button></div>
      <div class="scroll-text form"><p class="muted">Или впишите шесть чисел от 3 до 18:</p><div class="roll-inputs">${[0, 1, 2, 3, 4, 5].map(i => `<input class="paper-input" id="roll-in-${i}" type="number" inputmode="numeric" min="3" max="18" aria-label="Бросок ${i + 1}">`).join('')}</div>
      <p class="form-error hidden" id="roll-err">Нужно шесть чисел от 3 до 18.</p></div>
      <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button><button type="button" class="btn" data-act="stat-roll-manual">Готово</button></div>`;
  }
  const used = Object.values(statDraft.vals).filter(v => v != null);
  STATS.forEach(s => {
    const v = statDraft.vals[s.key];
    let ctrl;
    if (m === 'pointbuy') ctrl = `<div class="qty paper"><button type="button" data-act="pb" data-key="${s.key}" data-v="-1" ${v <= 8 ? 'disabled' : ''}>−</button><span>${v}</span><button type="button" data-act="pb" data-key="${s.key}" data-v="1" ${v >= 15 || POINT_COST[v + 1] - POINT_COST[v] > pointsLeft() ? 'disabled' : ''}>+</button></div>`;
    else if (m === 'manual') ctrl = `<input class="paper-input small" type="number" inputmode="numeric" min="3" max="18" value="${v}" data-field="draft" data-key="${s.key}" aria-label="${s.name}">`;
    else {
      const avail = statDraft.pool.slice();
      used.forEach(u => { const i = avail.indexOf(u); if (i >= 0) avail.splice(i, 1); });
      const opts = [...new Set([v, ...avail].filter(x => x != null))].sort((a, b) => b - a);
      ctrl = `<select class="paper-input small" data-field="draft-pick" data-key="${s.key}" aria-label="${s.name}"><option value="">—</option>${opts.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    }
    const tot = v != null ? v + rb(s.key) : null;
    rows += `<div class="draft-row"><span class="draft-name">${s.name}</span>${ctrl}<span class="draft-tot">${rb(s.key) ? `${signed(rb(s.key))} раса = ` : '= '}<b>${tot == null ? '—' : tot}</b></span></div>`;
  });
  const info = m === 'pointbuy' ? `<p class="muted">Осталось очков: <b>${pointsLeft()}</b> из 27. Шаг до 14 и до 15 стоит 2 очка.</p>`
    : m === 'standard' ? '<p class="muted">Каждое число из набора 15, 14, 13, 12, 10, 8 — ровно в одну характеристику.</p>'
    : m === 'roll' ? `<p class="muted">Выпало: ${statDraft.pool.join(', ')}. Расставьте каждое число в одну характеристику.</p>` : '<p class="muted">Значения от 3 до 18, до расовых бонусов.</p>';
  return `<span class="scroll-tag">${meth.title}</span><h3 class="scroll-title">Распределение</h3>
    <div class="scroll-text">${info}<div class="draft">${rows}</div>
    ${m !== 'manual' ? '<button type="button" class="link-btn" data-act="stat-auto">Разложить по классу</button>' : ''}</div>
    <div class="btn-row">${statDraft.redo ? '' : '<button type="button" class="btn" data-act="modal-close">Отмена</button>'}<button type="button" class="btn" data-act="stat-done" ${draftReady() ? '' : 'disabled'}>Готово</button></div>`;
}
function statAuto() {
  const order = statPriority();
  if (statDraft.m === 'pointbuy') { const arr = [15, 14, 13, 12, 10, 8]; order.forEach((k, i) => { statDraft.vals[k] = arr[i]; }); }
  else { const arr = statDraft.pool.slice().sort((a, b) => b - a); order.forEach((k, i) => { statDraft.vals[k] = arr[i]; }); }
}
function roll4d6() { const r = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => b - a); return { total: r[0] + r[1] + r[2], dice: r }; }
function statDone() {
  if (!draftReady()) return;
  STATS.forEach(s => { state.attributes.find(a => a.key === s.key).base = statDraft.vals[s.key]; });
  state.statMethod = statDraft.m; state.statsDone = true;
  if (statDraft.pool) state.statPool = statDraft.pool.slice();
  const redo = statDraft.redo;
  addLog(`Характеристики распределены (${STAT_METHODS[statDraft.m].title.toLowerCase()}): ${STATS.map(s => s.short + ' ' + statDraft.vals[s.key]).join(', ')}.`, 'info');
  fillToMax(); statDraft = null; closeModal(true); save();
  if (redo) afterRedistribute();
}

/* ---------- приёмы и эффекты ---------- */
function visibleActions(d) {
  const hidden = new Set(d.fx.flatMap(f => f.hide || []));
  const beast = beastEffect();
  return allActionDefs().filter(a => !hidden.has(a.id) && a.lvl <= d.lvl)
    .filter(a => (beast ? a.beastOnly : !a.beastOnly))
    .filter(a => !(beast && a.id === 'd_shape'))
    .map(applyOverride);
}
function useAbility(id) {
  const d = derive(), cls = classDef();
  const a = visibleActions(d).find(x => x.id === id); if (!a) return;
  const resName = cls ? cls.resource : 'Энергия';
  if (a.cost > 0) {
    if (state.mp.current < a.cost) { logToast(`Не хватает ресурса «${resName}»: нужно ${a.cost}, осталось ${state.mp.current}.`, 'error'); save(); return; }
    state.mp.current -= a.cost;
  }
  let text = fillText(a.log, d);
  const extra = d.anyFx('spellExtra');
  if (a.dmg && extra) text += ` Плюс ${extra.spellExtra} (кризис).`;
  if (a.dmg && d.anyFx('lichHeal')) text += ' Четверть нанесённого урона восстановите себе.';
  if (a.heal && d.anyFx('healHalf')) text += ' Союзникам — только половина, округляйте вниз; себе — полностью.';
  if (a.heal && state.level >= 7 && state.classRole === 'Жрец') text += ' Щедрый свет: +2 HP к результату.';
  if (a.cost > 3 && d.anyFx('bloodPrice')) text += ' И бросьте 1d6 — столько HP вы теряете (Разорвавший договор).';
  if (a.cost) text += ` Потрачено ${a.cost} MP.`;
  if (a.tempHp === 'prof') { state.hp.temp = Math.max(state.hp.temp || 0, d.prof); }
  if (a.effect || a.summon) activateEffect(a, d);
  logToast(text, a.cost ? 'spell' : 'info');
  save();
}
function activateEffect(a, d) {
  const e = a.effect || {};
  state.effects = state.effects.filter(x => x.src !== a.id);
  const rec = { uid: uid(), src: a.id };
  if (e.counter) rec.counter = e.counter;
  if (a.summon) { rec.hp = a.summon.hp; rec.max = a.summon.hp; }
  if (e.beast) { rec.hp = 5 * d.lvl; rec.max = 5 * d.lvl; }
  state.effects.push(rec);
}
function endEffect(uidv, reason) {
  const e = activeEffects().find(x => x.uid === uidv); if (!e) return;
  state.effects = state.effects.filter(x => x.uid !== uidv);
  if (e.def.summon) {
    let t = `${e.def.summon.name} исчезает.`;
    if (e.src === 'n_skeleton' && state.level >= 7 && state.classRole === 'Некромант') { const d = derive(); state.mp.current = Math.min(d.maxMP, state.mp.current + 2); t += ' Отголосок души: +2 MP.'; }
    logToast(t, 'info');
  } else if (e.def.effect && e.def.effect.beast) logToast(reason || 'Вы возвращаетесь в свой облик.', 'info');
  else addLog(`Эффект «${e.def.effect.title}» снят.`, 'info');
}
/* Урон: сначала HP зверя, затем временные HP, затем обычные */
function takeDamage(n) {
  let left = n;
  const beast = state.effects.find(x => { const a = findAction(x.src); return a && a.effect && a.effect.beast; });
  if (beast) {
    const used = Math.min(beast.hp, left); beast.hp -= used; left -= used;
    if (beast.hp <= 0) { endEffect(beast.uid, `HP зверя кончились — вы возвращаетесь в свой облик.${left ? ` Лишний урон ${left} переходит на ваши HP.` : ''}`); }
  }
  if (left > 0 && state.hp.temp) { const used = Math.min(state.hp.temp, left); state.hp.temp -= used; left -= used; }
  state.hp.current = Math.max(0, state.hp.current - left);
}
function summonHp(uidv, delta) {
  const s = state.effects.find(x => x.uid === uidv); if (!s) return;
  s.hp = Math.max(0, Math.min(s.max, s.hp + delta));
  if (s.hp <= 0) endEffect(uidv);
}
function summonAttack(uidv) {
  const e = activeEffects().find(x => x.uid === uidv); if (!e || !e.def.summon) return;
  const d = derive(), s = e.def.summon;
  logToast(`${s.name}: бросьте d20 ${spaced(d.prof + 2)} на попадание, урон ${s.die} ${spaced(s.mod)} ${s.dmgType}.`, 'info'); save();
}
function effectTick(uidv) {
  const e = activeEffects().find(x => x.uid === uidv); if (!e || !e.def.effect || !e.def.effect.tick) return;
  const d = derive(); let t = fillText(e.def.effect.tick, d);
  const extra = d.anyFx('spellExtra'); if (extra) t += ` Плюс ${extra.spellExtra} (кризис).`;
  logToast(t, 'spell'); save();
}

function attackRoll(key) {
  const d = derive();
  const at = d.attacks.find(x => x.key === key); if (!at) return;
  if (at.ammo) {
    if (!at.ammo.count) { logToast(`Нет боеприпасов: «${at.ammo.name}» кончились. Добавьте их в инвентаре.`, 'error'); save(); return; }
    const stack = state.inventory.find(i => i.ref === at.ammo.ref);
    stack.qty -= 1; if (stack.qty <= 0) state.inventory = state.inventory.filter(i => i !== stack);
  }
  const dmg = at.die ? `${at.die} ${spaced(at.dmgMod)}` : `${Math.max(1, at.dmgMod)}`;
  let t = `${at.title}: бросьте d20 ${spaced(at.atk)} на попадание${at.disadv && at.disadv.length ? ' с помехой (' + at.disadv.join(', ') + ')' : ''}, урон ${dmg} ${at.dmgType}`;
  if (at.extras.length) t += ` + ${at.extras.join(' + ')}`;
  t += '.';
  if (at.ammo) t += ` Осталось: ${at.ammo.count - 1}.`;
  logToast(t, 'info'); save();
}

function doRest(kind) {
  const d = derive(), cls = classDef();
  if (kind === 'long') {
    state.hp.current = d.maxHP; state.mp.current = d.maxMP; state.hp.temp = 0; state.effects = [];
    logToast('Длинный отдых: HP и MP восстановлены полностью, все эффекты сняты.', 'heal');
  } else {
    const hp = Math.max(1, Math.floor(d.maxHP / 4));
    state.hp.current = Math.min(d.maxHP, state.hp.current + hp);
    const full = cls && (cls.category === 'martial' || cls.restoreShort);
    const mp = full ? d.maxMP - state.mp.current : Math.min(d.maxMP - state.mp.current, Math.floor(d.maxMP / 4));
    state.mp.current += Math.max(0, mp);
    logToast(`Короткий отдых: +${hp} HP и ${full ? 'весь запас MP' : `+${Math.max(0, mp)} MP (четверть запаса)`}.`, 'heal');
  }
  closeModal(true); save();
}

/* ---------- предметы ---------- */
function fillToMax() { const dd = derive(); state.hp.current = dd.maxHP; state.mp.current = dd.maxMP; }
function applyBackground(name) {
  const bg = BACKGROUNDS[name];
  const oldIds = new Set(state.inventory.filter(i => i.fromBackground).map(i => i.id));
  Object.keys(state.equip).forEach(k => { if (oldIds.has(state.equip[k])) state.equip[k] = null; });
  state.inventory = state.inventory.filter(i => !i.fromBackground);
  state.background = name;
  if (!bg || bg.custom) return;
  state.coins = { gold: bg.coins.gold || 0, silver: bg.coins.silver || 0, copper: bg.coins.copper || 0 };
  bg.items.slice().reverse().forEach(([ref, qty], n) => {
    const def = ITEM_BY_ID[ref];
    const it = { id: uid() + n, name: def.name, ref, type: def.type, rarity: def.rarity || 'common', qty, weight: def.weight, fromBackground: true };
    if (def.charges) it.charges = def.charges;
    state.inventory.unshift(it);
  });
}
function removeItem(it) { Object.keys(state.equip).forEach(k => { if (state.equip[k] === it.id) state.equip[k] = null; }); state.inventory = state.inventory.filter(x => x.id !== it.id); }
function unequipItem(id) { Object.keys(state.equip).forEach(k => { if (state.equip[k] === id) state.equip[k] = null; }); }
function equipWarn(def) {
  if (def.type !== 'Оружие') return;
  const d = derive(), w = [];
  if (!weaponProficient(def)) w.push('ваш класс не владеет этим оружием: атака с помехой и без БМ');
  if (def.heavy && !def.ranged && d.scores.STR < 13) w.push('тяжёлому оружию нужна Сила 13: атака с помехой');
  if (def.heavy && def.ranged && d.scores.DEX < 13) w.push('тяжёлому луку или арбалету нужна Ловкость 13: атака с помехой');
  if (def.heavy && raceDef() && raceDef().small) w.push('маленький рост: тяжёлым оружием атака с помехой');
  if (w.length) toast(`${def.name}: ${w.join('; ')}.`, 'error');
}
function equipItem(id, hand) {
  const item = itemById(id), def = defOf(item);
  if (!item || !def) return;
  if (BODY_SLOTS.includes(def.slot)) { state.equip[def.slot] = id; return; }
  if (!(def.type === 'Оружие' || def.slot === 'hand')) return;
  equipWarn(def);
  const eq = state.equip, mainDef = defOf(itemById(eq.main));
  if (def.hands === 2) { eq.main = id; eq.off = id; return; }
  if (mainDef && mainDef.hands === 2) { eq.main = null; eq.off = null; }
  if (hand) { const other = hand === 'main' ? 'off' : 'main'; if (eq[other] === id && item.qty < 2) eq[other] = null; eq[hand] = id; return; }
  const order = def.armor === 'shield' ? ['off', 'main'] : ['main', 'off'];
  for (const h of order) if (eq[h] == null && !(eq[h === 'main' ? 'off' : 'main'] === id && item.qty < 2)) { eq[h] = id; return; }
  showModal(() => `<h3 class="scroll-title">В какую руку?</h3>
    <div class="scroll-text"><p>Обе руки заняты: в правой «${esc((itemById(eq.main) || {}).name || '—')}», в левой «${esc((itemById(eq.off) || {}).name || '—')}». Что заменить?</p></div>
    <div class="btn-row"><button type="button" class="btn" data-act="equip-hand" data-id="${id}" data-hand="main">Правую</button><button type="button" class="btn" data-act="equip-hand" data-id="${id}" data-hand="off">Левую</button></div>`);
}
function useItem(it) {
  const def = defOf(it); if (!def || !def.use) return;
  const d = derive();
  let t = `${it.name}: ${stripTerms(def.use)}`;
  if (/Зелье лечения|Большое зелье лечения/.test(def.name) && d.anyFx('potionHarm')) t = `${it.name}: зелье вас ранит (Ученик лича) — бросьте то же, что лечило бы, и получите столько урона.`;
  if (def.id === 'antitoxin') { state.effects = state.effects.filter(x => x.src !== 'item_antitoxin'); state.effects.push({ uid: uid(), src: 'item_antitoxin' }); }
  it.qty -= 1; if (it.qty <= 0) removeItem(it);
  logToast(t, 'heal'); save();
}
function useCharge(it) {
  const def = defOf(it); if (!def || !def.charges || !it.charges) return;
  it.charges -= 1;
  logToast(`${it.name}: ${def.chargeUse} Осталось ${it.charges} из ${def.charges}${def.chargeUnit ? ' ' + def.chargeUnit : ''}.`, 'info'); save();
}
async function refillItem(it) {
  const def = defOf(it); if (!def || !def.refill) return;
  const stock = state.inventory.find(x => x.ref === def.refill);
  if (!stock) { toast(`Нужны: «${ITEM_BY_ID[def.refill].name}». Добавьте их в инвентарь.`, 'error'); return; }
  if (it.charges > 0 && !(await askConfirm('Заправить заново?', `В «${it.name}» осталось ${it.charges} из ${def.charges}. Старая начинка пропадёт.`, 'Заправить'))) return;
  stock.qty -= 1; if (stock.qty <= 0) removeItem(stock);
  it.charges = def.charges;
  logToast(`${it.name}: заправлено до ${def.charges}.`, 'heal'); save();
}

/* ---------- PIN ---------- */
let pinEntry = '', pinMode = 'unlock', pinFirst = '';
function openPin(mode) { pinEntry = ''; pinMode = mode; pinFirst = ''; showModal(pinHtml); }
function pinHtml() {
  const title = pinMode === 'unlock' ? 'Режим редактирования' : pinFirst ? 'Повторите новый PIN' : 'Новый PIN';
  const hint = pinMode === 'unlock' ? 'Введите PIN, чтобы открыть лист для правки.' : pinFirst ? 'Ещё раз, чтобы не ошибиться.' : 'Придумайте 4 цифры.';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return `<h3 class="scroll-title">${title}</h3><div class="scroll-text"><p>${hint}</p></div>
    <div class="pin-dots" id="pin-dots">${[0, 1, 2, 3].map(i => `<span class="${i < pinEntry.length ? 'on' : ''}"></span>`).join('')}</div>
    <div class="pin-pad">${keys.map(k => k ? `<button type="button" class="btn pin-key" data-act="pin-key" data-key="${k}" aria-label="${k === '⌫' ? 'Стереть' : k}">${k}</button>` : '<span></span>').join('')}</div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button></div>`;
}
function pinKey(k) {
  if (k === '⌫') pinEntry = pinEntry.slice(0, -1); else if (pinEntry.length < 4) pinEntry += k;
  if (pinEntry.length === 4) {
    if (pinMode === 'unlock') {
      if (hashPin(pinEntry) === pinHash()) { state.isLocked = false; modalStack.pop(); paintModal(false); save(); return; }
      return pinFail();
    }
    if (!pinFirst) { pinFirst = pinEntry; pinEntry = ''; refreshModal(); return; }
    if (pinFirst === pinEntry) {
      try { localStorage.setItem(PIN_KEY, hashPin(pinEntry)); } catch (e) { /* ignore */ }
      modalStack.pop(); paintModal(false); toast('PIN изменён и сохранён на этом устройстве.', 'heal'); return;
    }
    pinFirst = ''; return pinFail();
  }
  refreshModal();
}
function pinFail() { pinEntry = ''; refreshModal(); const dots = $('pin-dots'); if (dots) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); } }

/* =====================================================================
   ОТРИСОВКА И ВЗАИМОДЕЙСТВИЕ
   ===================================================================== */
const GLYPH_MUT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5c2.3 3.2 4.5 5.8 4.5 8.4A4.5 4.5 0 0 1 3.5 9.9C3.5 7.3 5.7 4.7 8 1.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8.6 6.2 7.2 8.6l1.9.8-1.5 2.7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const GLYPH_CRISIS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 9.2 6.8M10.6 5.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.4 5.6 10.6 7.8M2.3 11.9l1.8 1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const TYPE_LABEL = { 'Все': 'Все', 'Оружие': 'Оружие', 'Броня': 'Броня', 'Зелье': 'Зелья', 'Расходник': 'Расходники', 'Инструмент': 'Инструменты', 'Квест': 'Квестовые' };

let invFilter = 'Все', pickedRef = null, menuOpen = false;
const openStatCards = new Set();

function save() { persist(); render(); }
function setVal(id, v) { const el = $(id); if (el && document.activeElement !== el && el.value !== String(v)) el.value = v; }
function fillSelect(id, names, current, placeholder) {
  const el = $(id); if (!el) return;
  const html = `<option value="" disabled ${current ? '' : 'selected'}>${placeholder}</option>` + names.map(n => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  el.value = current || '';
}
function barFill(cur, max) { return max > 0 ? Math.min(100, cur / max * 100) : 0; }

function render() {
  const d = derive();
  state.hp.current = Math.min(state.hp.current, d.maxHP);
  state.mp.current = Math.min(state.mp.current, d.maxMP);
  const locked = state.isLocked;
  document.body.classList.toggle('locked', locked);
  placePages(0, true);
  TABS.forEach(t => {
    const b = document.querySelector(`[data-tab="${t}"]`);
    if (b) { b.classList.toggle('active', state.activeTab === t); b.setAttribute('aria-current', state.activeTab === t ? 'page' : 'false'); }
  });
  $('lock-btn').classList.toggle('locked', locked);
  $('lock-btn').setAttribute('aria-label', locked ? 'Режим игры. Нажмите, чтобы редактировать' : 'Режим редактирования. Нажмите, чтобы закрыть лист и начать игру');
  renderMenu(locked);
  renderCharacter(d, locked);
  renderCombat(d);
  renderInventory(d, locked);
  refreshModal();
  if (typeof tutRender === 'function') tutRender();
}

/* ---------- меню ---------- */
function renderMenu(locked) {
  const m = $('menu'); if (!m) return;
  m.classList.toggle('hidden', !menuOpen);
  $('menu-btn').setAttribute('aria-expanded', String(menuOpen));
  const pinOn = pinRequired();
  m.innerHTML = `
    <button type="button" class="menu-item" data-act="kb">Справочник</button>
    <button type="button" class="menu-item" data-act="tut-start">Пройти обучение</button>
    <button type="button" class="menu-item" data-act="settings">Настройки</button>
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" data-act="export">Сохранить в файл</button>
    ${locked ? '' : `<button type="button" class="menu-item" data-act="import">Загрузить из файла</button>
    <button type="button" class="menu-item" data-act="change-pin">Сменить PIN</button>
    <button type="button" class="menu-item" data-act="toggle-pin"><span>Спрашивать PIN при открытии листа</span><i class="switch ${pinOn ? 'on' : ''}" aria-hidden="true"></i></button>
    <div class="menu-sep"></div>
    <button type="button" class="menu-item danger" data-act="reset">Сбросить лист</button>`}
    ${locked ? '<p class="menu-note">Загрузка, PIN и сброс — в режиме редактирования.</p>' : ''}
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" data-act="about">О приложении</button>`;
}

/* ---------- персонаж ---------- */
function renderCharacter(d, locked) {
  setVal('char-name', state.name);
  { const n = ($('char-name').value || state.name).length; $('char-name').style.fontSize = n > 26 ? '15px' : n > 20 ? '17px' : n > 15 ? '19px' : ''; }
  $('char-name').readOnly = locked;
  fillSelect('race-select', Object.keys(RACES), state.race, 'Выберите расу');
  fillSelect('class-select', Object.keys(CLASSES), state.classRole, 'Выберите класс');
  fillSelect('bg-select', Object.keys(BACKGROUNDS), state.background, 'Выберите предысторию');
  ['race-select', 'class-select', 'bg-select'].forEach(id => { $(id).disabled = locked; });
  [['race-custom', 'Своя раса', state.race, state.customRaceName], ['class-custom', 'Свой класс', state.classRole, state.customClassName], ['bg-custom', 'Своя предыстория', state.background, state.customBgName]].forEach(([id, key, cur, val]) => {
    const el = $(id); el.classList.toggle('hidden', cur !== key); el.readOnly = locked; setVal(id, val);
  });
  const mut = mutationDef(), cr = crisisDef(), r = raceDef(), c = classDef();
  $('mut-btn').innerHTML = GLYPH_MUT + `<span>${esc(mut ? mut.name : 'Без мутаций')}</span>`;
  $('crisis-btn').innerHTML = GLYPH_CRISIS + `<span>${esc(cr ? cr.name : 'Обычный путь')}</span>`;
  $('mut-btn').classList.toggle('hidden', !r || !r.mutations.length);
  $('crisis-btn').classList.toggle('hidden', !c || !c.crises.length);

  $('lvl-value').textContent = state.level;
  $('lvl-minus').disabled = state.level <= 1;
  $('lvl-plus').disabled = state.level >= MAX_LEVEL;
  const atMax = state.level >= MAX_LEVEL;
  $('xp-text').textContent = atMax ? 'Максимальный уровень' : `${state.xp.current} / ${xpNeeded(state.level)}`;
  $('xp-fill').style.width = atMax ? '100%' : `${Math.min(100, state.xp.current / xpNeeded(state.level) * 100)}%`;
  $('xp-amount').disabled = atMax; $('xp-add').disabled = atMax;

  const canDistribute = !locked || (state.statMethod && !state.statsDone);
  $('stats-btn').classList.toggle('hidden', !canDistribute);
  $('stats-btn').classList.toggle('glow', !state.statsDone);
  $('stats-method').textContent = state.statsDone && state.statMethod ? `Способ: ${STAT_METHODS[state.statMethod].title.toLowerCase()}` : state.statMethod ? `Способ: ${STAT_METHODS[state.statMethod].title.toLowerCase()} — распределите значения` : 'Характеристики ещё не распределены';
  $('stats-grid').innerHTML = STATS.map(st => {
    const p = d.parts[st.key], done = state.statsDone;
    const lines = [`${p.base} база`, p.race ? `${signed(p.race)} раса` : '', p.mut ? `${signed(p.mut)} мутация` : '', p.asi ? `${signed(p.asi)} уровни` : ''].filter(Boolean);
    return `<div class="stat ${openStatCards.has(st.key) ? 'open' : ''}" data-act="stat-toggle" data-key="${st.key}" role="button" tabindex="0" aria-expanded="${openStatCards.has(st.key)}" aria-label="${st.name}">
      <span class="stat-name">${st.short}</span>
      <span class="stat-total">${done ? d.scores[st.key] : '—'}</span>
      <span class="stat-mod">${done ? `к броску ${signed(d.mods[st.key])}` : 'не задано'}</span>
      <div class="stat-drop"><div class="stat-drop-in">${done ? lines.map(l => `<span>${l}</span>`).join('') : '<span>Нажмите «Распределить»</span>'}
        <span class="stat-more" role="button" tabindex="0" data-act="stat-info" data-key="${st.key}">Подробнее</span></div></div>
    </div>`;
  }).join('');

  const traits = allTraits(d);
  $('traits-list').innerHTML = traits.length ? traits.map(t => `
    <div class="trait-row">
      <button type="button" class="trait-main" data-act="trait-info" data-key="${esc(t.key)}"><span class="trait-title">${esc(t.title)}</span><span class="tag tag-${esc(t.type)}">${esc(t.type)}</span></button>
      ${t.userId && !locked ? `<button type="button" class="x-btn" data-act="trait-del" data-id="${t.userId}" aria-label="Удалить">✕</button>` : ''}
    </div>`).join('') : '<p class="empty">Выберите расу, класс и предысторию — здесь появятся их особенности.</p>';
}

/* ---------- бой ---------- */
function effectsHtml(d) {
  const list = activeEffects();
  if (!list.length) return '';
  return list.map(e => {
    const ef = e.def.effect || {}, s = e.def.summon;
    if (s) return `<div class="plaque summon">
      <div class="plaque-head"><b>${esc(s.name)}</b><span class="plaque-val">${e.hp} / ${e.max} HP</span><button type="button" class="x-btn" data-act="effect-end" data-uid="${e.uid}" aria-label="Убрать">✕</button></div>
      <div class="bar small"><div class="fill fill-hp" style="width:${barFill(e.hp, e.max)}%"></div></div>
      <div class="btn-row"><button type="button" class="btn btn-sm" data-act="summon-hp" data-uid="${e.uid}" data-v="-5">−5</button><button type="button" class="btn btn-sm" data-act="summon-hp" data-uid="${e.uid}" data-v="-1">−1</button><button type="button" class="btn btn-sm" data-act="summon-hp" data-uid="${e.uid}" data-v="1">+1</button><button type="button" class="btn btn-sm" data-act="summon-atk" data-uid="${e.uid}">Атака</button></div></div>`;
    if (ef.beast) return `<div class="plaque beast">
      <div class="plaque-head"><b>${esc(ef.title)}</b><span class="plaque-val">HP зверя ${e.hp} / ${e.max}</span></div>
      <div class="bar small"><div class="fill fill-mp-hybrid" style="width:${barFill(e.hp, e.max)}%"></div></div>
      <p class="plaque-desc">${rich(ef.desc)}</p>
      <div class="btn-row"><button type="button" class="btn btn-sm" data-act="effect-end" data-uid="${e.uid}">Вернуть облик</button></div></div>`;
    return `<div class="plaque">
      <div class="plaque-head"><button type="button" class="plaque-title" data-act="effect-info" data-uid="${e.uid}"><b>${esc(ef.title)}</b></button>
      ${ef.counter ? `<span class="plaque-val">осталось ${e.counter}</span><button type="button" class="btn btn-sm mini" data-act="effect-count" data-uid="${e.uid}">−1</button>` : ''}
      ${ef.tick ? `<button type="button" class="btn btn-sm mini" data-act="effect-tick" data-uid="${e.uid}">${esc(ef.tickLabel || 'Урон')}</button>` : ''}
      <button type="button" class="x-btn" data-act="effect-end" data-uid="${e.uid}" aria-label="Снять">✕</button></div></div>`;
  }).join('');
}

function renderCombat(d) {
  const cls = classDef();
  const cat = cls ? cls.category : 'none';
  const resName = cls ? cls.resource : 'Ресурс';
  const mpBtns = !cls ? '' : cat === 'martial'
    ? `<button type="button" class="btn" data-act="mp" data-v="-1">−1</button><button type="button" class="btn" data-act="mp" data-v="1">+1</button>`
    : `<button type="button" class="btn" data-act="mp" data-v="-3">−3</button><button type="button" class="btn" data-act="mp" data-v="-1">−1</button><button type="button" class="btn" data-act="mp" data-v="1">+1</button><button type="button" class="btn" data-act="mp" data-v="3">+3</button>`;
  $('effects').innerHTML = effectsHtml(d);
  $('effects').classList.toggle('hidden', !activeEffects().length);
  $('hud').innerHTML = `
    <div class="meter">
      <div class="meter-head"><span class="meter-name hp">HP</span><span class="meter-val">${state.hp.current} / ${d.maxHP}${state.hp.temp ? ` <em class="temp">+${state.hp.temp} врем.</em>` : ''}</span></div>
      <div class="bar"><div class="fill fill-hp" style="width:${barFill(state.hp.current, d.maxHP)}%"></div></div>
      ${d.hpNotes.length ? `<p class="hp-note">${d.hpNotes.map(esc).join(' · ')}</p>` : ''}
      <div class="btn-row"><button type="button" class="btn" data-act="hp" data-v="-5">−5</button><button type="button" class="btn" data-act="hp" data-v="-1">−1</button><button type="button" class="btn" data-act="hp" data-v="1">+1</button><button type="button" class="btn" data-act="hp" data-v="5">+5</button></div>
    </div>
    <div class="meter">
      <div class="meter-head"><span class="meter-name mp-${cat}">MP · ${esc(resName)}</span><span class="meter-val">${state.mp.current} / ${d.maxMP}</span></div>
      <div class="bar"><div class="fill fill-mp-${cat}" style="width:${barFill(state.mp.current, d.maxMP)}%"></div></div>
      ${cls ? `<div class="btn-row">${mpBtns}</div>` : '<p class="empty">Выберите класс, чтобы появился ресурс.</p>'}
    </div>
    <div class="hud-stats">
      <button type="button" class="hud-stat" data-act="ac-info"><span>КБ</span><b>${d.ac}</b></button>
      <button type="button" class="hud-stat" data-act="speed-info"><span>Скорость</span><b>${meters(d.speed)}</b></button>
      <button type="button" class="hud-stat" data-act="term" data-term="Инициатива"><span>Инициатива</span><b>${signed(d.init)}</b></button>
      <button type="button" class="hud-stat" data-act="term" data-term="БМ"><span>БМ</span><b>${signed(d.prof)}</b></button>
    </div>
    <div class="btn-row"><button type="button" class="btn" data-act="rest">Отдых</button></div>`;

  $('attacks').innerHTML = d.attacks.map(a => {
    const noAmmo = a.ammo && !a.ammo.count;
    const dmg = a.die ? `${a.die} ${spaced(a.dmgMod)}` : Math.max(1, a.dmgMod);
    return `<div class="card ${noAmmo ? 'dim' : ''}">
      <div class="card-main"><b>${esc(a.title)}</b>
        <span class="card-sub">Попадание ${signed(a.atk)} · урон ${dmg}${a.extras.length ? ' + ' + esc(a.extras.join(' + ')) : ''}, ${esc(a.dmgType)}</span>
        ${a.disadv && a.disadv.length ? `<span class="card-warn">Помеха: ${esc(a.disadv.join(', '))}</span>` : ''}
        ${a.ammo ? `<span class="card-note ${noAmmo ? 'bad' : ''}">${esc(a.ammo.name)}: ${a.ammo.count ? a.ammo.count + ' шт.' : 'нет — добавьте в инвентаре'}</span>` : ''}
        ${a.notes.length ? `<span class="card-note">${esc(a.notes.join(' · '))}</span>` : ''}</div>
      <button type="button" class="btn" data-act="attack" data-key="${esc(a.key)}" ${noAmmo ? 'disabled' : ''}>Атака</button>
    </div>`;
  }).join('');

  const acts = visibleActions(d).sort((a, b) => a.lvl - b.lvl || a.cost - b.cost);
  if (!cls && !acts.length) $('abilities').innerHTML = '<p class="empty">Выберите класс на вкладке «Персонаж».</p>';
  else $('abilities').innerHTML = acts.length ? acts.map(a => {
    const afford = state.mp.current >= a.cost;
    const kind = { bonus: 'бонусное действие', reaction: 'реакция', free: 'без действия', action: 'действие' }[a.kind] || 'действие';
    const price = a.cost ? `${a.cost} MP${a.cost > 3 && d.anyFx('bloodPrice') ? ' + 1d6 HP' : ''}` : 'Бесплатно';
    const active = state.effects.some(x => x.src === a.id);
    return `<div class="card ${afford ? '' : 'dim'}">
      <button type="button" class="card-main as-link" data-act="ability-info" data-id="${a.id}"><b>${esc(a.title)}${a.source ? ` <span class="src">${esc(a.source)}</span>` : ''}</b>
        <span class="card-sub">${price} · ${kind}${active ? ' · <em class="on">действует</em>' : ''}</span></button>
      <button type="button" class="btn" data-act="ability" data-id="${a.id}" ${afford ? '' : 'disabled'}>Применить</button>
    </div>`;
  }).join('') : '<p class="empty">У этого класса нет приёмов.</p>';

  const logs = logExpanded ? state.combatLogs : state.combatLogs.slice(0, 3);
  $('log').innerHTML = logs.length ? logs.map(l => `<div class="log-line log-${esc(l.type)}"><time>${esc(l.time)}</time><span>${esc(l.text)}</span></div>`).join('') : '<p class="empty">Пока пусто. Нажмите «Атака» или «Применить» — здесь появится, что бросать.</p>';
  $('log-toggle').classList.toggle('hidden', state.combatLogs.length <= 3);
  $('log-toggle').textContent = logExpanded ? 'Свернуть' : `Показать всё (${state.combatLogs.length})`;
  const traits = allTraits(d);
  $('passives').innerHTML = traits.length ? traits.map(t => `<button type="button" class="chip" data-act="trait-info" data-key="${esc(t.key)}">${esc(t.title)}</button>`).join('') : '<p class="empty">Черт пока нет.</p>';
}

/* ---------- инвентарь ---------- */
function renderInventory(d, locked) {
  const slot = k => {
    const item = itemById(state.equip[k]);
    const twoH = k === 'off' && state.equip.main != null && state.equip.main === state.equip.off && (defOf(item) || {}).hands === 2;
    return `<button type="button" class="slot ${item ? 'filled' : ''}" data-act="slot-info" data-slot="${k}">
      <span class="slot-name">${SLOT_NAMES[k]}</span><span class="slot-item rar-${item ? item.rarity : 'common'}">${item ? esc(item.name) + (twoH ? ' (двумя руками)' : '') : 'пусто'}</span></button>`;
  };
  $('equip').innerHTML = `<div class="slots">${['head', 'chest', 'arms', 'legs', 'main', 'off'].map(slot).join('')}</div>
    <div class="equip-sum"><button type="button" class="hud-stat" data-act="ac-info"><span>КБ</span><b>${d.ac}</b></button><button type="button" class="hud-stat" data-act="speed-info"><span>Скорость</span><b>${meters(d.speed)}</b></button></div>
    ${d.warnings.length ? `<ul class="warn-list">${d.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
  const over = d.load > d.carry;
  $('load').innerHTML = `<div class="meter-head"><span class="meter-name">Нагрузка</span><span class="meter-val">${kg(d.load)} / ${kg(d.carry)}</span></div>
    <div class="bar"><div class="fill ${over ? 'fill-hp' : 'fill-xp'}" style="width:${barFill(d.load, d.carry)}%"></div></div>
    ${over ? '<p class="warn">Перегруз: скорость и спасброски Силы и Ловкости с помехой, пока не избавитесь от лишнего.</p>' : ''}`;
  ['gold', 'silver', 'copper'].forEach(k => setVal('coin-' + k, state.coins[k]));

  const def = pickedRef ? ITEM_BY_ID[pickedRef] : null;
  $('item-ref').classList.toggle('hidden', !def);
  if (def) $('item-ref').innerHTML = `<span>Из базы: <b>${esc(def.name)}</b> · ${esc(itemStatLine(def))} · ${kg(def.weight)}</span><button type="button" class="x-btn" data-act="unpick" aria-label="Не из базы">✕</button>`;
  const typeSel = $('item-type');
  if (typeSel.options.length !== ITEM_TYPES.length) typeSel.innerHTML = ITEM_TYPES.map(t => `<option ${t === 'Инструмент' ? 'selected' : ''}>${t}</option>`).join('');
  typeSel.disabled = !!def; $('item-weight').disabled = !!def;
  if (def) { typeSel.value = def.type; setVal('item-weight', def.weight); }
  $('item-rarity').disabled = locked;
  if (locked) $('item-rarity').value = def && def.rarity ? def.rarity : 'common';
  $('rarity-note').classList.toggle('hidden', !locked);

  $('inv-filters').innerHTML = ['Все', ...ITEM_TYPES].map(t => `<button type="button" class="filter ${invFilter === t ? 'on' : ''}" data-act="filter" data-t="${t}">${TYPE_LABEL[t]}</button>`).join('');
  const equippedIds = new Set(Object.values(state.equip).filter(v => v != null));
  const items = state.inventory.filter(i => invFilter === 'Все' || i.type === invFilter);
  $('inv-list').innerHTML = items.length ? items.map(i => {
    const idef = defOf(i);
    const equippable = idef && (idef.type === 'Оружие' || idef.slot);
    const on = equippedIds.has(i.id);
    const charges = idef && idef.charges ? `<div class="charges"><span>Заряды ${i.charges} / ${idef.charges}${idef.chargeUnit ? ' ' + idef.chargeUnit : ''}</span><div class="pips">${Array.from({ length: idef.charges }, (_, n) => `<i class="${n < i.charges ? 'on' : ''}"></i>`).join('')}</div></div>` : '';
    return `<div class="item ${on ? 'equipped' : ''}">
      <button type="button" class="item-main" data-act="item-info" data-id="${i.id}">
        <span class="item-name rar-${i.rarity}">${esc(i.name)}${on ? ' <em>надето</em>' : ''}</span>
        <span class="item-sub">${esc(idef ? itemStatLine(idef, i.rarity) : i.type.toLowerCase())} · ${kg(i.weight * i.qty)}${i.qty > 1 ? ` (${kg(i.weight)} × ${i.qty})` : ''}</span></button>
      ${charges}
      <div class="item-ctrl">
        <div class="qty"><button type="button" data-act="qty" data-id="${i.id}" data-v="-1" aria-label="Меньше">−</button><span>${i.qty}</span><button type="button" data-act="qty" data-id="${i.id}" data-v="1" aria-label="Больше">+</button></div>
        ${equippable ? `<button type="button" class="btn btn-sm" data-act="${on ? 'unequip' : 'equip'}" data-id="${i.id}">${on ? 'Снять' : 'Надеть'}</button>` : ''}
        ${idef && idef.use ? `<button type="button" class="btn btn-sm" data-act="use-item" data-id="${i.id}">Применить</button>` : ''}
        <button type="button" class="x-btn" data-act="item-del" data-id="${i.id}" aria-label="Удалить">✕</button>
      </div>
      ${idef && idef.charges ? `<div class="charge-row"><button type="button" class="btn btn-sm" data-act="use-charge" data-id="${i.id}" ${i.charges ? '' : 'disabled'}>Использовать</button><button type="button" class="btn btn-sm" data-act="refill" data-id="${i.id}" ${state.inventory.some(x => x.ref === idef.refill) ? '' : 'disabled'}>Пополнить</button></div>` : ''}
      ${idef && idef.charges && !state.inventory.some(x => x.ref === idef.refill) ? `<p class="card-note">Для пополнения нужны: ${esc(ITEM_BY_ID[idef.refill].name.toLowerCase())}</p>` : ''}</div>`;
  }).join('') : '<p class="empty">Сумка пуста. Добавьте предмет выше — начните вводить название, и появятся подсказки из базы.</p>';
}
function renderSuggest() {
  const box = $('item-suggest'), q = $('item-name').value;
  const res = slotFilter && !q.trim() ? ITEMS.filter(it => ['main', 'off'].includes(slotFilter) ? (it.type === 'Оружие' || it.slot === 'hand') : it.slot === slotFilter).slice(0, 12) : q.trim().length >= 2 ? searchItems(q) : [];
  if (!res.length || (pickedRef && ITEM_BY_ID[pickedRef] && ITEM_BY_ID[pickedRef].name === q)) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.innerHTML = res.map(it => `<button type="button" class="sugg" data-act="pick" data-ref="${it.id}"><b>${esc(it.name)}</b><span>${esc(itemStatLine(it))} · ${kg(it.weight)}</span></button>`).join('');
  box.classList.remove('hidden');
}

/* ---------- информационные окна ---------- */
function openTerm(k) {
  if (!GLOSSARY[k]) return;
  showModal(() => `<span class="scroll-tag">Словарик</span><h3 class="scroll-title">${esc(k)}</h3><div class="scroll-text"><p>${rich(GLOSSARY[k])}</p></div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Понятно</button></div>`);
}
function breakdownHtml(parts, unit) {
  return `<ul class="plain-list">${parts.map(([n, v]) => `<li>${esc(n)}: <b>${typeof v === 'number' ? (unit ? (v > 0 ? '+' : '') + num1(v) + ' ' + unit : signed(v)) : esc(v)}</b></li>`).join('')}</ul>`;
}
function itemInfo(i, extraBtn) {
  const def = defOf(i);
  let body = '';
  if (def) {
    body += `<p>${rich(def.desc)}</p>`;
    const rows = [];
    if (def.type === 'Оружие') {
      rows.push(['Урон', `${def.dmg}${def.vers ? ` (двумя руками ${def.vers})` : ''}, ${def.dmgType}`]);
      rows.push(['Руки', def.hands === 2 ? 'обе' : 'одна']);
      rows.push(['Тип', def.cat === 'simple' ? 'простое' : 'воинское']);
      rows.push(['Владение', weaponProficient(def) ? 'есть' : 'нет — атака с помехой и без БМ']);
      if (def.heavy) rows.push(['Тяжёлое', def.ranged ? 'нужна Ловкость 13, маленьким расам с помехой' : 'нужна Сила 13, маленьким расам с помехой']);
      if (def.ammo) rows.push(['Боеприпасы', `${ITEM_BY_ID[def.ammo].name.toLowerCase()} — в сумке ${ammoCount(def.ammo)}`]);
    } else if (def.slot) {
      rows.push(['Слот', def.slot === 'hand' ? 'рука' : SLOT_NAMES[def.slot]]);
      rows.push(['Тип', ARMOR_TYPE_NAMES[def.armor]]);
      rows.push(['КБ', signed((def.ac || 0) + rarityBonus(i.rarity))]);
      if (def.str) rows.push(['Нужна Сила', String(def.str)]);
      rows.push(['Владение', derive().armorProf.has(def.armor) ? 'есть' : 'нет — помеха на атаки, колдовать нельзя']);
    }
    if (def.use) rows.push(['Применение', stripTerms(def.use)]);
    if (def.charges) rows.push(['Заряды', `${i.charges} из ${def.charges}`]);
    if (rows.length) body += `<ul class="plain-list">${rows.map(([n, v]) => `<li>${esc(n)}: <b>${esc(v)}</b></li>`).join('')}</ul>`;
  } else body += '<p>Свой предмет. Боевых свойств у него нет — только вес и количество.</p>';
  body += `<p class="muted">Редкость: ${RARITIES[i.rarity].label}${rarityBonus(i.rarity) && def && (def.type === 'Оружие' || def.slot) ? `, +${rarityBonus(i.rarity)} к ${def.type === 'Оружие' ? 'попаданию и урону' : 'КБ'}` : ''}. Вес: ${kg(i.weight)}.</p>`;
  infoModal(i.name, i.type, body, extraBtn);
}
function openMutation(target) {
  const isRace = target === 'race';
  const list = isRace ? (raceDef() || { mutations: [] }).mutations : (classDef() || { crises: [] }).crises;
  const current = isRace ? state.raceMutation : state.classCrisis;
  const d = derive();
  if (state.isLocked) {
    const cur = list.find(m => m.name === current);
    if (cur) infoModal(cur.name, isRace ? 'Мутация' : 'Кризис', `<p><b>Дар.</b> ${rich(cur.buff, d)}</p><p><b>Бремя.</b> ${rich(cur.debuff, d)}</p>`);
    else infoModal(isRace ? 'Без мутаций' : 'Обычный путь', isRace ? 'Мутация' : 'Кризис', '<p>Менять это можно только в режиме редактирования, вместе с мастером.</p>');
    return;
  }
  showModal(() => `<span class="scroll-tag">${isRace ? 'Мутация расы' : 'Кризис класса'}</span>
    <h3 class="scroll-title">${isRace ? esc(raceLabel()) : esc(classLabel())}</h3>
    <div class="scroll-text"><p class="muted">Сюжетное изменение: сильный дар в обмен на бремя. Выбирайте вместе с мастером.</p>
    <div role="button" tabindex="0" class="option ${!current ? 'on' : ''}" data-act="pick-mutation" data-target="${target}" data-name=""><b>${isRace ? 'Без мутаций' : 'Обычный путь'}</b><span>${isRace ? 'Плоть без изменений.' : 'Вы верны канонам своего пути.'}</span></div>
    ${list.map(m => `<div role="button" tabindex="0" class="option ${m.name === current ? 'on' : ''}" data-act="pick-mutation" data-target="${target}" data-name="${esc(m.name)}"><b>${esc(m.name)}</b><span><i>Дар.</i> ${rich(m.buff, d)}</span><span><i>Бремя.</i> ${rich(m.debuff, d)}</span></div>`).join('')}
    </div><div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button></div>`);
}
function openTraitForm() {
  showModal(() => `<h3 class="scroll-title">Своё свойство</h3>
    <div class="scroll-text form">
      <label>Название<input id="tf-title" class="paper-input" maxlength="60"></label>
      <label>Вид<select id="tf-type" class="paper-input">${USER_TRAIT_TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
      <label>Что делает<textarea id="tf-desc" class="paper-input" rows="4" maxlength="600" placeholder="Понятно опишите эффект: что даёт и когда срабатывает."></textarea></label>
      <p class="form-error hidden" id="tf-err">Заполните название и описание.</p></div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button><button type="button" class="btn" data-act="save-trait">Сохранить</button></div>`);
}
function openRest() {
  const cls = classDef(), full = cls && (cls.category === 'martial' || cls.restoreShort);
  showModal(() => `<span class="scroll-tag">Привал</span><h3 class="scroll-title">Отдых</h3>
    <div class="scroll-text"><p>Отдыхайте, когда это объявит мастер.</p>
    <div role="button" tabindex="0" class="option" data-act="rest-do" data-kind="short"><b>Короткий отдых</b><span>Около часа. Восстанавливает четверть HP и ${full ? 'весь запас MP' : 'четверть запаса MP'}. Эффекты не снимаются.</span></div>
    <div role="button" tabindex="0" class="option" data-act="rest-do" data-kind="long"><b>Длинный отдых</b><span>Ночь сна. HP и MP восстанавливаются полностью, временные HP и все эффекты снимаются.</span></div></div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Отмена</button></div>`);
}
function pickItem(ref) {
  const def = ITEM_BY_ID[ref]; if (!def) return;
  pickedRef = ref; $('item-name').value = def.name; $('item-rarity').value = def.rarity || 'common';
  if (def.stack) $('item-qty').value = def.stack;
  $('item-suggest').classList.add('hidden'); render();
}
function addItem() {
  const name = ($('item-name').value || '').trim();
  if (!name) { $('item-name').focus(); return; }
  const def = pickedRef ? ITEM_BY_ID[pickedRef] : null;
  const qty = Math.max(1, parseInt($('item-qty').value) || 1);
  const rarity = state.isLocked ? (def && def.rarity ? def.rarity : 'common') : ($('item-rarity').value || 'common');
  const item = { id: uid(), name, ref: def ? def.id : '', type: def ? def.type : $('item-type').value, rarity, qty,
    weight: def ? def.weight : Math.max(0, parseFloat(String($('item-weight').value).replace(',', '.')) || 0), fromBackground: false };
  if (def && def.charges) item.charges = def.charges;
  const equippedIds = new Set(Object.values(state.equip));
  const same = !(def && def.charges) && state.inventory.find(i => i.name === item.name && i.ref === item.ref && i.rarity === item.rarity && !equippedIds.has(i.id));
  if (same) same.qty += qty; else state.inventory.push(item);
  toast(`Добавлено: ${name}${qty > 1 ? ' × ' + qty : ''}.`, 'heal');
  $('item-name').value = ''; $('item-qty').value = '1'; $('item-weight').value = '0.5';
  pickedRef = null; $('item-suggest').classList.add('hidden');
  save();
}

/* ---------- экспорт и импорт ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `${(state.name || 'персонаж').replace(/[\\/:*?"<>|]+/g, '_')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Файл персонажа сохранён.', 'heal');
}
function importData(file) {
  if (!file || state.isLocked) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const next = sanitize(JSON.parse(ev.target.result));
      next.isLocked = false; next.activeTab = 'character';
      state = next; levelQueue = []; pickedRef = null; save();
      infoModal('Персонаж загружен', '', `<p>«${esc(state.name || 'Без имени')}» готов к игре.</p>`);
    } catch (err) { infoModal('Не удалось загрузить', '', '<p>Файл не похож на сохранение листа. Выберите файл, созданный пунктом «Сохранить в файл».</p>'); }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------
   ОБРАБОТЧИКИ
   --------------------------------------------------------------------- */
function goTab(t) { if (!TABS.includes(t) || t === state.activeTab) return; state.activeTab = t; logExpanded = false; closeStatCards(); save(); }
function closeStatCards() { openStatCards.clear(); document.querySelectorAll('.stat.open').forEach(el => el.classList.remove('open')); }

document.addEventListener('click', async e => {
  if (menuOpen && !e.target.closest('#menu, #menu-btn')) { menuOpen = false; renderMenu(state.isLocked); }
  const el = e.target.closest('[data-act], [data-tab]');
  if (!el) return;
  if (el.dataset.act && el.dataset.act !== 'pick') slotFilter = slotFilter && el.closest('#item-suggest') ? slotFilter : null;
  vibrate();
  if (el.dataset.tab) { goTab(el.dataset.tab); return; }
  const act = el.dataset.act, locked = state.isLocked;
  const idNum = Number(el.dataset.id), uidNum = Number(el.dataset.uid);
  switch (act) {
    case 'toast-hide': hideToast(); break;
    case 'menu': menuOpen = !menuOpen; renderMenu(locked); break;
    case 'modal-close': closeModal(); break;
    case 'modal-back': leaveDraft(modalStack[modalStack.length - 1]); modalStack.pop(); paintModal(false); break;
    case 'modal-backdrop': { const top = modalStack[modalStack.length - 1]; if (top && top.opts.levelUp) { if (!top.opts.locked) confirmLevelUp(); } else if (confirmResolve) finishConfirm(false); else closeModal(); break; }
    case 'confirm-yes': finishConfirm(true); break;
    case 'confirm-no': finishConfirm(false); break;
    case 'term': openTerm(el.dataset.term); break;

    case 'lock':
      if (!locked) { state.isLocked = true; menuOpen = false; save(); toast('Лист закрыт. Режим игры.', 'info'); }
      else if (pinRequired()) openPin('unlock');
      else { state.isLocked = false; save(); }
      break;
    case 'pin-key': pinKey(el.dataset.key); break;
    case 'change-pin': if (!locked) { menuOpen = false; renderMenu(locked); openPin('change'); } break;
    case 'toggle-pin': if (!locked) { try { localStorage.setItem(PIN_OFF_KEY, pinRequired() ? '1' : '0'); } catch (err) { /* ignore */ } renderMenu(locked); toast(pinRequired() ? 'PIN снова спрашивается при открытии листа.' : 'PIN больше не спрашивается: замок открывается одним нажатием.', 'info'); } break;
    case 'export': menuOpen = false; renderMenu(locked); exportData(); break;
    case 'import': if (!locked) { menuOpen = false; renderMenu(locked); $('import-file').click(); } break;
    case 'reset':
      menuOpen = false; renderMenu(locked);
      if (!locked && await askConfirm('Сбросить лист?', 'Все данные персонажа будут стёрты. Это нельзя отменить. Сначала можно сохранить его в файл.', 'Сбросить', true)) { state = freshState(); levelQueue = []; pickedRef = null; save(); }
      break;

    case 'open-mutation': openMutation(el.dataset.target); break;
    case 'pick-mutation':
      if (locked) break;
      if (el.dataset.target === 'race') state.raceMutation = el.dataset.name || null; else state.classCrisis = el.dataset.name || null;
      closeModal(true); save(); break;
    case 'lvl':
      if (locked) break;
      if (Number(el.dataset.v) > 0 && state.level < MAX_LEVEL) { raiseLevel(); state.xp.current = 0; save(); nextLevelUp(); }
      else if (Number(el.dataset.v) < 0 && state.level > 1) { state.level--; state.xp.current = 0; addLog(`Уровень понижен до ${state.level}.`, 'info'); save(); }
      break;
    case 'add-xp': { const v = parseInt($('xp-amount').value); $('xp-amount').value = ''; if (v > 0) addXP(v); break; }
    case 'levelup-done': confirmLevelUp(); break;
    case 'asi-mode': if (state.asiPending) { state.asiPending.mode = el.dataset.mode; persist(); refreshModal(); } break;
    case 'asi-add': { const p = state.asiPending; if (!p || Object.values(p.alloc).reduce((a, b) => a + b, 0) >= 2) break; p.alloc[el.dataset.key] = (p.alloc[el.dataset.key] || 0) + 1; persist(); refreshModal(); break; }
    case 'asi-reset': if (state.asiPending) { state.asiPending.alloc = {}; persist(); refreshModal(); } break;
    case 'asi-feat': if (state.asiPending) { state.asiPending.feat = el.dataset.id; persist(); refreshModal(); } break;

    case 'stats-open': openStats(); break;
    case 'stat-method': if (!locked) { startMethod.prev = { m: state.statMethod, done: state.statsDone }; state.statMethod = el.dataset.m; state.statsDone = false; persist(); startMethod(el.dataset.m); } break;
    case 'pb': statDraft.touched = true; { const k = el.dataset.key, v = statDraft.vals[k] + Number(el.dataset.v); if (v >= 8 && v <= 15) { statDraft.vals[k] = v; if (pointsLeft() < 0) statDraft.vals[k] -= Number(el.dataset.v); } refreshModal(); break; }
    case 'stat-auto': statDraft.touched = true; statAuto(); refreshModal(); break;
    case 'stat-roll': {
      const rolls = STATS.map(() => roll4d6());
      statDraft.touched = true; statDraft.pool = rolls.map(r => r.total); STATS.forEach(s => { statDraft.vals[s.key] = null; });
      addLog(`Броски характеристик (4d6, худший отброшен): ${rolls.map(r => `${r.total} [${r.dice.slice(0, 3).join('+')}, отброшено ${r.dice[3]}]`).join('; ')}.`, 'spell');
      persist(); refreshModal(); break;
    }
    case 'stat-roll-manual': {
      const vals = [0, 1, 2, 3, 4, 5].map(i => parseInt(($(`roll-in-${i}`) || {}).value));
      if (vals.some(v => !(v >= 3 && v <= 18))) { $('roll-err').classList.remove('hidden'); break; }
      statDraft.touched = true; statDraft.pool = vals; STATS.forEach(s => { statDraft.vals[s.key] = null; });
      addLog(`Броски характеристик с настоящих кубиков: ${vals.join(', ')}.`, 'spell'); persist(); refreshModal(); break;
    }
    case 'stat-done': statDone(); break;
    case 'stat-toggle': {
      if (e.target.closest('[data-act="stat-info"]')) break;
      const k = el.dataset.key;
      if (openStatCards.has(k)) openStatCards.delete(k); else openStatCards.add(k);
      el.classList.toggle('open', openStatCards.has(k)); el.setAttribute('aria-expanded', String(openStatCards.has(k)));
      break;
    }
    case 'stat-info': {
      const st = STATS.find(s => s.key === el.dataset.key), dd = derive(), p = dd.parts[st.key];
      infoModal(st.name, 'Характеристика', `<p>${rich(st.hint)}</p>${breakdownHtml([['База', String(p.base)], ['Раса', p.race], ...(p.mut ? [['Мутация', p.mut]] : []), ...(p.asi ? [['Прибавки уровней', p.asi]] : []), ['Итого', String(dd.scores[st.key])], ['Модификатор к броскам', dd.mods[st.key]]])}`);
      break;
    }
    case 'trait-info': { const dd = derive(), t = allTraits(dd).find(x => x.key === el.dataset.key); if (t) infoModal(t.title, t.type, traitBody(t, dd)); break; }
    case 'trait-del': if (!locked && await askConfirm('Удалить свойство?', 'Своё свойство будет удалено.', 'Удалить', true)) { state.userTraits = state.userTraits.filter(t => t.id !== idNum); save(); } break;
    case 'add-trait': if (!locked) openTraitForm(); break;
    case 'save-trait': {
      const title = ($('tf-title').value || '').trim(), desc = ($('tf-desc').value || '').trim();
      if (!title || !desc) { $('tf-err').classList.remove('hidden'); break; }
      state.userTraits.push({ id: uid(), title, type: $('tf-type').value, desc }); closeModal(); save(); break;
    }

    case 'hp': { const v = Number(el.dataset.v), dd = derive(); if (v < 0) takeDamage(-v); else state.hp.current = Math.min(dd.maxHP, state.hp.current + v); save(); break; }
    case 'mp': { const dd = derive(); state.mp.current = Math.max(0, Math.min(dd.maxMP, state.mp.current + Number(el.dataset.v))); save(); break; }
    case 'rest': openRest(); break;
    case 'rest-do': doRest(el.dataset.kind); break;
    case 'ac-info': { const dd = derive(); infoModal(`КБ ${dd.ac}`, 'Класс брони', `<p>${rich(GLOSSARY['КБ'])}</p>${breakdownHtml(dd.acParts)}${dd.warnings.length ? `<ul class="warn-list">${dd.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`); break; }
    case 'speed-info': { const dd = derive(); infoModal(`Скорость ${meters(dd.speed)}`, 'За один ход', `<p>Сколько метров вы проходите за ход.</p>${breakdownHtml(dd.speedParts, 'м')}`); break; }
    case 'attack': attackRoll(el.dataset.key); break;
    case 'ability': useAbility(el.dataset.id); break;
    case 'ability-info': {
      const dd = derive(), a = visibleActions(dd).find(x => x.id === el.dataset.id); if (!a) break;
      const kind = { bonus: 'Бонусное действие', reaction: 'Реакция', free: 'Без действия', action: 'Действие' }[a.kind];
      infoModal(a.title, a.source || 'Приём', `<p>${rich(a.desc, dd)}</p><p class="muted">Стоимость: ${a.cost ? a.cost + ' MP' : 'бесплатно'}. ${kind}.</p>`);
      break;
    }
    case 'effect-end': endEffect(uidNum); save(); break;
    case 'effect-count': { const x = state.effects.find(f => f.uid === uidNum); if (x) { x.counter = Math.max(0, (x.counter || 0) - 1); if (!x.counter) endEffect(uidNum); } save(); break; }
    case 'effect-tick': effectTick(uidNum); break;
    case 'effect-info': { const x = activeEffects().find(f => f.uid === uidNum); if (x) infoModal(x.def.effect.title, 'Действует', `<p>${rich(x.def.effect.desc, derive())}</p>`); break; }
    case 'summon-hp': summonHp(uidNum, Number(el.dataset.v)); save(); break;
    case 'summon-atk': summonAttack(uidNum); break;
    case 'toggle-log': logExpanded = !logExpanded; render(); break;
    case 'clear-log': if (state.combatLogs.length && await askConfirm('Очистить журнал?', 'Все записи боя будут удалены.', 'Очистить')) { state.combatLogs = []; save(); } break;

    case 'filter': invFilter = el.dataset.t; render(); break;
    case 'pick': pickItem(el.dataset.ref); break;
    case 'unpick': pickedRef = null; render(); break;
    case 'add-item': addItem(); break;
    case 'qty': { const it = itemById(idNum); if (!it) break; it.qty += Number(el.dataset.v); if (it.qty <= 0) removeItem(it); save(); break; }
    case 'item-del': { const it = itemById(idNum); if (it && await askConfirm('Выбросить предмет?', `«${it.name}» будет удалён из инвентаря.`, 'Выбросить', true)) { removeItem(it); save(); } break; }
    case 'item-info': { const it = itemById(idNum); if (it) itemInfo(it); break; }
    case 'equip': equipItem(idNum); save(); break;
    case 'equip-hand': equipItem(idNum, el.dataset.hand); closeModal(); save(); break;
    case 'unequip': unequipItem(idNum); save(); break;
    case 'slot-info': openSlot(el.dataset.slot); break;
    case 'unequip-close': unequipItem(idNum); closeModal(true); save(); break;
    case 'use-item': { const it = itemById(idNum); if (it) useItem(it); break; }
    case 'use-charge': { const it = itemById(idNum); if (it) useCharge(it); break; }
    case 'refill': { const it = itemById(idNum); if (it) refillItem(it); break; }
    default: break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'char-name' && !state.isLocked) { state.name = t.value.slice(0, 60); persist(); }
  else if (t.id === 'race-custom' && !state.isLocked) { state.customRaceName = t.value.slice(0, 40); persist(); }
  else if (t.id === 'class-custom' && !state.isLocked) { state.customClassName = t.value.slice(0, 40); persist(); }
  else if (t.id === 'bg-custom' && !state.isLocked) { state.customBgName = t.value.slice(0, 40); persist(); }
  else if (t.id && t.id.startsWith('coin-')) { state.coins[t.id.slice(5)] = Math.max(0, parseInt(t.value) || 0); persist(); }
  else if (t.id === 'item-name') renderSuggest();
});
document.addEventListener('change', async e => {
  const t = e.target;
  if ((t.dataset.field === 'draft' || t.dataset.field === 'draft-pick') && statDraft) statDraft.touched = true;
  if (t.dataset.field === 'draft' && statDraft) { statDraft.vals[t.dataset.key] = Math.min(18, Math.max(3, parseInt(t.value) || 3)); refreshModal(); return; }
  if (t.dataset.field === 'draft-pick' && statDraft) { statDraft.vals[t.dataset.key] = t.value === '' ? null : Number(t.value); refreshModal(); return; }
  if (state.isLocked) return;
  if (t.id === 'race-select') { changeRace(t.value, state.race); }
  else if (t.id === 'class-select') { changeClass(t.value, state.classRole);
  } else if (t.id === 'bg-select') {
    if (state.background && state.background !== t.value && !(await askConfirm('Сменить предысторию?', 'Вещи из прошлой предыстории исчезнут, а монеты заменятся на новые.', 'Сменить'))) { render(); return; }
    applyBackground(t.value); save();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Tab') document.body.classList.add('kbd');
  if (e.key === 'Escape') { if (menuOpen) { menuOpen = false; renderMenu(state.isLocked); } else if (modalStack.length) { const top = modalStack[modalStack.length - 1]; if (confirmResolve) finishConfirm(false); else if (!top.opts.levelUp) closeModal(); } }
  if (e.key === 'Enter' && e.target.id === 'xp-amount') $('xp-add').click();
  if (e.key === 'Enter' && e.target.id === 'item-name') { const first = document.querySelector('#item-suggest .sugg'); if (first && !pickedRef) first.click(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.dataset.act) { e.preventDefault(); e.target.click(); }
  if (modalStack.length && /^[0-9]$/.test(e.key) && modalStack[modalStack.length - 1].renderFn === pinHtml) pinKey(e.key);
});

/* ---------- нажатие и вибрация ---------- */
const PRESSABLE = '.btn, .qty button, .hud-stat, .chip, .filter, .slot, .option, .feat, .asi-btn, .seg-btn, .nav button, .stat, .menu-item, .trait-main, .item-main, .icon-btn, .lock-btn, .pin-key, .sugg, .plaque-title';
function vibrate() { try { if (settings.vibro && navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignore */ } }
document.addEventListener('pointerdown', e => {
  document.body.classList.remove('kbd');
  const el = e.target.closest(PRESSABLE); if (!el || el.disabled) return;
  el.classList.add('pressed');
  const t0 = Date.now();
  const up = () => { setTimeout(() => el.classList.remove('pressed'), Math.max(0, 110 - (Date.now() - t0))); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});

/* ---------- страницы и свайпы ---------- */
function placePages(dx, animate) {
  const i0 = TABS.indexOf(state.activeTab);
  TABS.forEach((t, i) => {
    const p = $('tab-' + t); if (!p) return;
    p.style.transition = animate && !motionOff() ? '' : 'none';
    p.style.transform = `translateX(calc(${(i - i0) * 100}% + ${dx}px))`;
    const on = i === i0;
    p.setAttribute('aria-hidden', String(!on));
    if (on) p.removeAttribute('inert'); else p.setAttribute('inert', '');
  });
}
function initSwipe() {
  const root = $('pages'); if (!root) return;
  let sx = 0, sy = 0, dx = 0, axis = null, t0 = 0, active = false;
  root.addEventListener('touchstart', e => {
    if (modalStack.length || e.touches.length !== 1 || tut.active || !$('kb').classList.contains('hidden')) return;
    const t = e.touches[0], W = window.innerWidth;
    if (t.clientX < 24 || t.clientX > W - 24) return;
    if (e.target.closest('input, select, textarea, .filters, .suggest, .no-swipe')) return;
    sx = t.clientX; sy = t.clientY; dx = 0; axis = null; t0 = Date.now(); active = true;
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    if (!active) return;
    const t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
    if (!axis) { if (Math.abs(mx) < 10 && Math.abs(my) < 10) return; axis = Math.abs(mx) > Math.abs(my) * 1.2 ? 'x' : 'y'; if (axis === 'x') closeStatCards(); }
    if (axis !== 'x') return;
    e.preventDefault();
    const i = TABS.indexOf(state.activeTab), edge = (mx > 0 && i === 0) || (mx < 0 && i === TABS.length - 1);
    dx = edge ? Math.sign(mx) * Math.min(70, Math.abs(mx) * 0.3) : mx;
    placePages(dx, false);
  }, { passive: false });
  const end = () => {
    if (!active) return; active = false;
    if (axis !== 'x') return;
    const i = TABS.indexOf(state.activeTab), W = window.innerWidth, v = Math.abs(dx) / Math.max(1, Date.now() - t0);
    let ni = i;
    if ((Math.abs(dx) > W * 0.22 || v > 0.5) && Math.abs(dx) > 30) ni = dx < 0 ? Math.min(TABS.length - 1, i + 1) : Math.max(0, i - 1);
    if (ni !== i) { state.activeTab = TABS[ni]; logExpanded = false; vibrate(); save(); }
    else placePages(0, true);
  };
  root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
}

/* ---------- запуск ---------- */
function init() {
  $('import-file').addEventListener('change', e => { importData(e.target.files[0]); e.target.value = ''; });
  initSwipe();
  render();
  levelQueue = [4, 8].filter(l => l <= state.level && !state.asiGiven.includes(l));
  nextLevelUp();
  let fresh = !state.name && !state.race && !state.classRole, done = false;
  try { done = localStorage.getItem(TUT_KEY) === '1'; } catch (e) { /* ignore */ }
  if (fresh && !done) setTimeout(tutStart, 2800);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

/* =====================================================================
   ЧАСТЬ 2: наборы, смена класса/расы, слоты, справочник, обучение, настройки
   ===================================================================== */
const SETTINGS_KEY = 'rpg_settings', TUT_KEY = 'rpg_tutorial_done', APP_VERSION = '2.0';
let settings = { vibro: true, anim: true, bigFont: false };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { /* ignore */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } applySettings(); }
function applySettings() { document.body.classList.toggle('no-anim', !settings.anim); document.body.classList.toggle('big-font', !!settings.bigFont); }
function motionOff() { return REDUCED || !settings.anim; }

/* ---------- стартовые наборы ---------- */
function addKitItem(ref, qty, flag) {
  const def = ITEM_BY_ID[ref];
  const it = { id: uid() + Math.floor(Math.random() * 999), name: def.name, ref, type: def.type, rarity: def.rarity || 'common', qty, weight: def.weight, [flag]: true };
  if (def.charges) it.charges = def.charges;
  state.inventory.push(it); return it;
}
function openKit() {
  const kits = CLASS_KITS[state.classRole]; if (!kits) return;
  showModal(() => `<span class="scroll-tag">${esc(state.classRole)}</span><h3 class="scroll-title">Стартовое снаряжение</h3>
    <div class="scroll-text"><p>Выберите набор. Броня и оружие сразу наденутся.</p>
    ${kits.map((k, i) => `<div role="button" tabindex="0" class="option" data-act="kit-pick" data-i="${i}"><b>${esc(k.title)}</b><span>${k.items.map(([r, q]) => esc(ITEM_BY_ID[r].name) + (q > 1 ? ' × ' + q : '')).join(', ')}</span></div>`).join('')}
    ${state.packGiven ? '' : `<p class="muted">Плюс походный минимум: ${ADVENTURER_PACK.map(([r, q]) => ITEM_BY_ID[r].name.toLowerCase() + (q > 1 ? ' × ' + q : '')).join(', ')}.</p>`}</div>`, { locked: true });
}
function pickKit(i) {
  const kit = CLASS_KITS[state.classRole][i]; if (!kit) return;
  state.inventory = state.inventory.filter(x => !x.fromClass);
  const added = kit.items.map(([r, q]) => addKitItem(r, q, 'fromClass'));
  if (!state.packGiven) { ADVENTURER_PACK.forEach(([r, q]) => addKitItem(r, q, 'fromPack')); state.packGiven = true; }
  let weaponDone = false;
  added.forEach(it => {
    const def = defOf(it);
    if (def.slot && def.slot !== 'hand') state.equip[def.slot] = it.id;
    else if (def.armor === 'shield') state.equip.off = it.id;
    else if (def.type === 'Оружие' && !weaponDone) {
      weaponDone = true;
      if (def.hands === 2) { state.equip.main = it.id; state.equip.off = it.id; }
      else { state.equip.main = it.id; if (it.qty >= 2 && def.light && state.equip.off == null) state.equip.off = it.id; }
    }
  });
  addLog(`Стартовое снаряжение: ${kit.title.toLowerCase()}.`, 'heal');
  modalStack = modalStack.filter(m => !m.opts.locked || m.opts.levelUp); paintModal(false);
  save(); tutRender();
}

/* ---------- смена класса и расы ---------- */
async function changeClass(next, prevValue) {
  const hasProgress = state.level > 1 || state.feats.length || Object.keys(state.asiBonus).length || state.effects.length || state.classCrisis;
  if (state.classRole && hasProgress && !(await askConfirm('Сменить класс?', `Персонаж начнёт путь заново с 1-го уровня: сбросятся опыт, прибавки и черты уровней, кризис и эффекты. Характеристики, вещи, монеты и имя останутся. Снаряжение прошлого класса уйдёт вместе с ним.`, 'Сменить'))) { $('class-select').value = prevValue; render(); return; }
  Object.assign(state, { level: 1, xp: { current: 0 }, asiGiven: [], asiPending: null, asiBonus: {}, feats: [], effects: [], classCrisis: null, classRole: next });
  state.inventory.filter(i => i.fromClass).forEach(removeItem);
  state.hp.temp = 0; fillToMax(); save();
  if (CLASS_KITS[next]) openKit();
}
async function changeRace(next, prevValue) {
  if (state.raceMutation && !(await askConfirm('Сменить расу?', 'Выбранная мутация будет сброшена.', 'Сменить'))) { $('race-select').value = prevValue; render(); return; }
  const oldB = JSON.stringify((raceDef() || {}).bonuses || {});
  state.race = next; state.raceMutation = null; fillToMax(); save();
  if (state.statsDone && state.statMethod && oldB !== JSON.stringify((raceDef() || {}).bonuses || {})) {
    showModal(() => `<span class="scroll-tag">Новая раса</span><h3 class="scroll-title">Раса сменилась</h3>
      <div class="scroll-text"><p>Её бонусы теперь дают прибавку к другим характеристикам. Распределить характеристики и прибавки уровней заново?</p>
      <p class="muted">Способ останется тем же: «${esc(STAT_METHODS[state.statMethod].title.toLowerCase())}». ${state.statMethod === 'roll' ? 'Выпавшие при бросках числа сохранены — перебросить нельзя. ' : ''}Черты, выбранные за уровни, останутся.</p></div>
      <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Оставить как есть</button><button type="button" class="btn" data-act="redistribute">Распределить заново</button></div>`);
  }
}
function redistribute() {
  modalStack.pop(); paintModal(false);
  const m = state.statMethod;
  statDraft = { m, vals: {}, pool: null, redo: true };
  STATS.forEach(s => { statDraft.vals[s.key] = state.attributes.find(a => a.key === s.key).base; });
  if (m === 'standard') statDraft.pool = STANDARD_ARRAY.slice();
  if (m === 'roll') statDraft.pool = (state.statPool && state.statPool.length === 6) ? state.statPool.slice() : STATS.map(s => statDraft.vals[s.key]);
  const featLv = new Set(state.feats.map(f => f.lvl));
  const asiLevels = state.asiGiven.filter(l => !featLv.has(l));
  state.asiBonus = {}; state.asiGiven = state.asiGiven.filter(l => featLv.has(l));
  redoAsi = asiLevels; persist();
  showModal(statDraftHtml, { locked: true });
}
let redoAsi = [];
function afterRedistribute() { levelQueue.push(...redoAsi.map(l => ({ lvl: l, asiOnly: true }))); redoAsi = []; nextLevelUp(); }

/* ---------- выбор вещи в слот ---------- */
let slotFilter = null;
function slotCandidates(slot) {
  return state.inventory.filter(i => {
    const d = defOf(i); if (!d) return false;
    return ['main', 'off'].includes(slot) ? (d.type === 'Оружие' || d.slot === 'hand') : d.slot === slot;
  });
}
function avgDmg(a) { const m = (a.die || '').match(/(\d+)d(\d+)/); return (m ? m[1] * (Number(m[2]) + 1) / 2 : 0) + a.dmgMod; }
function cmp(label, a, b, fmt, higherBetter) {
  if (a === b) return '';
  const better = higherBetter ? b > a : b < a;
  return `<span class="cmp ${better ? 'good' : 'bad'}">${label} ${fmt(a)} → <b>${better ? '▲' : '▼'} ${fmt(b)}</b></span>`;
}
function previewEquip(id, slot) {
  const saved = JSON.stringify(state.equip), before = derive();
  const item = itemById(id), def = defOf(item), eq = state.equip;
  let note = '';
  if (BODY_SLOTS.includes(def.slot)) eq[def.slot] = id;
  else if (def.hands === 2) { const gone = [eq.main, eq.off].filter(v => v != null && v !== id).map(v => itemById(v).name); eq.main = id; eq.off = id; note = 'займёт обе руки' + (gone.length ? ', снимет ' + [...new Set(gone)].join(' и ') : ''); }
  else { const h = slot === 'off' || (slot !== 'main' && def.armor === 'shield') ? 'off' : 'main'; const mainDef = defOf(itemById(eq.main)); if (mainDef && mainDef.hands === 2) { eq.off = null; note = 'снимет ' + itemById(eq.main).name; } if (eq[h] != null && eq[h] !== id) note = note || 'снимет ' + itemById(eq[h]).name; eq[h] = id; }
  const after = derive();
  state.equip = JSON.parse(saved);
  const lines = [cmp('КБ', before.ac, after.ac, v => v, true), cmp('скорость', before.speed, after.speed, v => num1(v) + ' м', true)];
  if (def.type === 'Оружие') {
    const cur = before.attacks[0], nw = after.attacks.find(a => a.title.startsWith(item.name)) || after.attacks[0];
    if (cur && nw) { lines.push(cmp('попадание', cur.atk, nw.atk, signed, true)); lines.push(cmp('урон ≈', avgDmg(cur), avgDmg(nw), v => num1(v), true)); }
    if (nw && nw.disadv.length) lines.push(`<span class="cmp bad">помеха: ${esc(nw.disadv.join(', '))}</span>`);
  }
  const warn = [];
  if (def.str && def.str > after.scores.STR) warn.push(`нужна Сила ${def.str}`);
  if (def.armor && !after.armorProf.has(def.armor)) warn.push('нет владения — помеха на атаки, колдовать нельзя');
  return { html: lines.filter(Boolean).join(''), note, warn };
}
function slotHtml(slot) {
  const cur = itemById(state.equip[slot]);
  const list = slotCandidates(slot).filter(i => !Object.values(state.equip).includes(i.id) || (i.qty > 1 && state.equip.main === i.id && slot === 'off'));
  const noun = { head: 'шлемов', chest: 'нагрудников', arms: 'наручей', legs: 'поножей', main: 'оружия и щитов', off: 'оружия и щитов' }[slot];
  let h = `<span class="scroll-tag">Снаряжение</span><h3 class="scroll-title">${SLOT_NAMES[slot]}</h3><div class="scroll-text">`;
  if (cur) h += `<div class="slot-cur"><b class="rar-${cur.rarity}">${esc(cur.name)}</b> <span class="muted">надето</span><div class="btn-row"><button type="button" class="btn btn-sm" data-act="slot-unequip" data-slot="${slot}">Снять</button><button type="button" class="btn btn-sm" data-act="item-info" data-id="${cur.id}">Подробнее</button></div></div>`;
  if (list.length) {
    h += `<h4>${cur ? 'Заменить на' : 'Надеть'}</h4>` + list.map(i => {
      const p = previewEquip(i.id, slot), d = defOf(i);
      return `<div class="pick-row"><div class="pick-main"><b class="rar-${i.rarity}">${esc(i.name)}</b><span class="muted">${esc(itemStatLine(d, i.rarity))}</span>
        <div class="cmps">${p.html || '<span class="muted">числа не изменятся</span>'}</div>
        ${p.note ? `<span class="pick-note">${esc(p.note)}</span>` : ''}${p.warn.map(w => `<span class="cmp bad">${esc(w)}</span>`).join('')}</div>
        <button type="button" class="btn btn-sm" data-act="slot-equip" data-id="${i.id}" data-slot="${slot}">Надеть</button></div>`;
    }).join('');
  } else if (!cur) h += `<p>В сумке нет ${noun}.</p><p class="muted">Когда вещь появится у героя, добавьте её в разделе «Добавить предмет» ниже.</p>`;
  h += `</div><div class="btn-row"><button type="button" class="btn" data-act="modal-close">Закрыть</button></div>`;
  return h;
}
function openSlot(slot) { showModal(() => slotHtml(slot)); }
function slotEquip(id, slot) {
  const def = defOf(itemById(id));
  if (['main', 'off'].includes(slot) && def.hands !== 2 && def.type === 'Оружие' || def.armor === 'shield') equipItem(id, ['main', 'off'].includes(slot) ? slot : undefined);
  else equipItem(id);
  save();
}
function findInBase(slot) {
  closeModal(true); slotFilter = slot; goTab('inventory');
  setTimeout(() => { const el = $('item-name'); el.value = ''; el.scrollIntoView({ block: 'center', behavior: motionOff() ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); renderSuggest(); }, 350);
}

/* ---------- справочник ---------- */
let kbStack = [];
const KB_SECTIONS = [
  ['articles', 'Как играть'], ['glossary', 'Словарик'], ['races', 'Расы'], ['classes', 'Классы'], ['backgrounds', 'Предыстории'],
  ['mutations', 'Мутации и кризисы'], ['items', 'Предметы'], ['builds', 'Готовые герои'], ['shop', 'Цены в лавке'], ['gen', 'Имя и причуда'], ['tips', 'Советы новичку']
];
function openKb(view) {
  menuOpen = false; renderMenu(state.isLocked);
  kbStack = [view || { t: 'home' }]; $('kb').classList.remove('hidden'); $('kb-q').value = '';
  try { history.pushState({ kb: 1 }, ''); } catch (e) { /* ignore */ }
  kbPaint();
}
function kbPush(v) { kbStack.push(v); kbPaint(); $('kb-body').scrollTop = 0; }
function kbBack() { if (kbStack.length > 1) { kbStack.pop(); kbPaint(); } else closeKb(); }
function closeKb() { $('kb').classList.add('hidden'); kbStack = []; }
function kbLink(t, key, title, sub) { return `<button type="button" class="kb-link" data-act="kb-open" data-t="${t}" data-key="${esc(key)}"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`; }
function kbPaint() {
  const v = kbStack[kbStack.length - 1]; if (!v) return;
  const d = derive();
  let title = 'Справочник', h = '';
  if (v.t === 'home') {
    h = `<button type="button" class="btn kb-tut" data-act="tut-start">Пройти обучение заново</button><div class="kb-grid">${KB_SECTIONS.map(([k, n]) => `<button type="button" class="kb-sec" data-act="kb-open" data-t="sec" data-key="${k}">${n}</button>`).join('')}</div>`;
  } else if (v.t === 'search') { title = 'Поиск'; h = kbSearchHtml(v.q); }
  else if (v.t === 'sec') { title = KB_SECTIONS.find(s => s[0] === v.key)[1]; h = kbSectionHtml(v.key, d); }
  else { const r = kbEntryHtml(v.t, v.key, d); title = r.title; h = r.html; }
  $('kb-title').textContent = title;
  $('kb-back').setAttribute('aria-label', kbStack.length > 1 ? 'Назад' : 'Закрыть справочник');
  $('kb-body').innerHTML = h;
}
function kbSectionHtml(k, d) {
  if (k === 'articles') return ARTICLES.map(a => kbLink('article', a.id, a.title)).join('');
  if (k === 'glossary') return Object.keys(GLOSSARY).sort().map(g => kbLink('term', g, g, stripTerms(GLOSSARY[g]).slice(0, 70) + '…')).join('');
  if (k === 'races') return Object.keys(RACES).map(r => kbLink('race', r, r, RACES[r].desc)).join('');
  if (k === 'classes') return Object.keys(CLASSES).map(c => kbLink('class', c, c, CLASSES[c].desc)).join('');
  if (k === 'backgrounds') return Object.keys(BACKGROUNDS).map(b => kbLink('bg', b, b, (BACKGROUNDS[b].trait || {}).title || '')).join('');
  if (k === 'mutations') return `<h3 class="kb-h">Мутации рас</h3>` + Object.entries(RACES).flatMap(([r, x]) => x.mutations.map(m => kbLink('mut', m.name, m.name, r))).join('') +
    `<h3 class="kb-h">Кризисы классов</h3>` + Object.entries(CLASSES).flatMap(([c, x]) => x.crises.map(m => kbLink('mut', m.name, m.name, c))).join('');
  if (k === 'items') return ITEM_TYPES.map(t => `<h3 class="kb-h">${TYPE_LABEL[t]}</h3>` + ITEMS.filter(i => i.type === t).map(i => kbLink('item', i.id, i.name, `${itemStatLine(i)} · ${kg(i.weight)}`)).join('')).join('');
  if (k === 'builds') return Object.keys(BUILD_RACE).map(c => kbLink('build', c, c, BUILD_RACE[c])).join('');
  if (k === 'shop') return `<p class="muted">Ориентировочные цены. Точные назначает мастер — у каждого торговца свои аппетиты.</p><table class="kb-table">${PRICES.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table><p class="muted">1 золотой = 10 серебряных = 100 медных.</p>`;
  if (k === 'gen') return `<p>Не знаете, как назвать героя или чем он запомнится? Нажмите — приложение предложит.</p>
    <label class="kb-label">Раса<select id="gen-race" class="pick">${Object.keys(LORE_RACES).filter(r => LORE_RACES[r].names.length).map(r => `<option ${r === state.race ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
    <div class="btn-row"><button type="button" class="btn" data-act="gen-name">Придумать имя</button><button type="button" class="btn" data-act="gen-quirk">Придумать причуду</button></div>
    <div id="gen-out" class="kb-gen"></div>`;
  if (k === 'tips') return `<ul class="kb-list">${TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  return '';
}
function levelTable(c, d) {
  let h = '<table class="kb-table lv">';
  for (let l = 1; l <= 8; l++) {
    const bits = [...c.actions.filter(a => a.lvl === l).map(a => `<span class="kb-act">${esc(a.title)}</span>`), ...c.traits.filter(t => t.lvl === l).map(t => `<span>${esc(t.title)}</span>`)];
    if ([4, 8].includes(l)) bits.push('<span class="muted">+2 к характеристикам или черта</span>');
    if (l === 5 && c.actions.some(a => a.cost === 0 && a.dmg)) bits.push('<span class="muted">бесплатные заклинания бьют двумя кубиками</span>');
    h += `<tr><td>${l}</td><td>${bits.join(', ') || '<span class="muted">растут HP и MP</span>'}</td></tr>`;
  }
  return h + '</table>';
}
function kbEntryHtml(t, key, d) {
  const profName = { light: 'лёгкие доспехи', medium: 'средние', heavy: 'тяжёлые', shield: 'щиты' };
  if (t === 'article') { const a = ARTICLES.find(x => x.id === key); return { title: a.title, html: `<p>${rich(a.text)}</p>` }; }
  if (t === 'term') return { title: key, html: `<p>${rich(GLOSSARY[key])}</p>` };
  if (t === 'race') {
    const r = RACES[key], L = LORE_RACES[key] || {};
    const bon = Object.entries(r.bonuses).map(([k, v]) => `${STATS.find(s => s.key === k).name} ${signed(v)}`).join(', ') || 'нет';
    return { title: key, html: `<p>${esc(L.lore || r.desc)}</p>${L.play ? `<p><b>Как отыгрывать.</b> ${esc(L.play)}</p>` : ''}
      <h3 class="kb-h">В игре</h3><ul class="kb-list"><li>Бонусы: ${esc(bon)}</li><li>Скорость: ${meters(r.speed)}</li>${r.small ? '<li>Маленький рост: тяжёлое оружие с помехой</li>' : ''}${r.carry ? `<li>Груз: ${r.carry > 0 ? '+' : ''}${r.carry} кг</li>` : ''}</ul>
      ${r.traits.map(x => `<div class="perk"><b>${esc(x.title)}</b><p>${rich(x.desc)}</p></div>`).join('')}
      ${r.mutations.length ? `<h3 class="kb-h">Мутации</h3>${r.mutations.map(m => kbLink('mut', m.name, m.name)).join('')}` : ''}
      ${L.names && L.names.length ? `<h3 class="kb-h">Имена</h3><p>${esc(L.names.join(', '))}</p>` : ''}` };
  }
  if (t === 'class') {
    const c = CLASSES[key], L = LORE_CLASSES[key] || {};
    const res = { martial: 'несколько зарядов, короткий отдых возвращает все', caster: 'большой запас маны', hybrid: 'средний запас', custom: 'настраивает мастер' }[c.category];
    const weapons = [...(c.weapons.cats || []).map(x => x === 'simple' ? 'простое оружие' : 'воинское оружие'), ...(c.weapons.ids || []).map(id => ITEM_BY_ID[id].name.toLowerCase())].join(', ');
    return { title: key, html: `<p>${esc(L.lore || c.desc)}</p>${L.play ? `<p><b>Как играть.</b> ${esc(L.play)}</p>` : ''}${L.tip ? `<p class="muted">${esc(L.tip)}</p>` : ''}
      <h3 class="kb-h">В игре</h3><ul class="kb-list"><li>Кубик здоровья: d${c.hitDie}</li><li>Ресурс: «${esc(c.resource)}» — ${res}</li><li>Главная характеристика: ${STATS.find(s => s.key === c.cast).name}</li>
      <li>Доспехи: ${c.armor.map(a => profName[a]).join(', ') || 'нет'}</li><li>Оружие: ${esc(weapons || 'нет')}</li></ul>
      <h3 class="kb-h">По уровням</h3>${levelTable(c, d)}
      ${c.actions.length ? `<h3 class="kb-h">Приёмы</h3>${c.actions.slice().sort((a, b) => a.lvl - b.lvl).map(a => `<div class="perk"><b>${esc(a.title)}</b> <span class="perk-tag">${a.lvl} ур. · ${a.cost ? a.cost + ' MP' : 'бесплатно'}</span><p>${rich(a.desc, { ...d, lvl: a.lvl < 5 ? Math.max(d.lvl, a.lvl) : d.lvl })}</p></div>`).join('')}` : ''}
      ${c.crises.length ? `<h3 class="kb-h">Кризис</h3>${c.crises.map(m => kbLink('mut', m.name, m.name)).join('')}` : ''}
      ${CLASS_KITS[key] ? `<h3 class="kb-h">Стартовые наборы</h3>${CLASS_KITS[key].map(k => `<p><b>${esc(k.title)}:</b> ${k.items.map(([r, q]) => esc(ITEM_BY_ID[r].name.toLowerCase()) + (q > 1 ? ' × ' + q : '')).join(', ')}</p>`).join('')}` : ''}` };
  }
  if (t === 'bg') {
    const b = BACKGROUNDS[key];
    return { title: key, html: `<p>${esc(LORE_BACKGROUNDS[key] || '')}</p>${b.trait ? `<div class="perk"><b>${esc(b.trait.title)}</b><p>${rich(b.trait.desc)}</p></div>` : ''}
      ${b.items.length ? `<h3 class="kb-h">Вещи</h3><ul class="kb-list">${b.items.map(([r, q]) => `<li>${esc(ITEM_BY_ID[r].name)}${q > 1 ? ' × ' + q : ''}</li>`).join('')}</ul>` : ''}
      <p class="muted">Монеты: ${b.coins.gold || 0} зол.${b.coins.silver ? ', ' + b.coins.silver + ' сер.' : ''}</p>` };
  }
  if (t === 'mut') {
    const m = [...Object.values(RACES).flatMap(r => r.mutations), ...Object.values(CLASSES).flatMap(c => c.crises)].find(x => x.name === key);
    return { title: key, html: `<p><b>Дар.</b> ${rich(m.buff)}</p><p><b>Бремя.</b> ${rich(m.debuff)}</p><p class="muted">Выбирается вместе с мастером, когда в истории случилось что-то важное.</p>` };
  }
  if (t === 'item') { const i = ITEM_BY_ID[key]; return { title: i.name, html: `<p>${rich(i.desc)}</p><p class="muted">${esc(itemStatLine(i))} · ${kg(i.weight)}</p>` }; }
  if (t === 'build') {
    const race = BUILD_RACE[key], r = RACES[race], order = STAT_PRIORITY[key];
    const vals = Object.fromEntries(order.map((k, i) => [k, STANDARD_ARRAY[i]]));
    const kit = CLASS_KITS[key][0];
    return { title: `${key}: готовый герой`, html: `<p>Хороший старт для новичка: ${esc(race.toLowerCase())}-${esc(key.toLowerCase())}. Можно просто повторить.</p>
      <ul class="kb-list"><li>Раса: ${esc(race)}</li><li>Характеристики (стандартный набор): ${STATS.map(s => `${s.short} ${vals[s.key] + (r.bonuses[s.key] || 0)}`).join(', ')}</li><li>Набор: ${esc(kit.title.toLowerCase())} — ${kit.items.map(([x, q]) => esc(ITEM_BY_ID[x].name.toLowerCase()) + (q > 1 ? ' × ' + q : '')).join(', ')}</li></ul>
      <p>${esc((LORE_CLASSES[key] || {}).play || '')}</p>` };
  }
  return { title: '', html: '' };
}
let kbIndex = null;
function buildKbIndex() {
  const ix = [];
  ARTICLES.forEach(a => ix.push({ t: 'article', key: a.id, title: a.title, text: a.text }));
  Object.entries(GLOSSARY).forEach(([k, v]) => ix.push({ t: 'term', key: k, title: k, text: v }));
  Object.keys(RACES).forEach(r => ix.push({ t: 'race', key: r, title: r, text: ((LORE_RACES[r] || {}).lore || '') + RACES[r].traits.map(x => x.title + ' ' + x.desc).join(' ') }));
  Object.keys(CLASSES).forEach(c => ix.push({ t: 'class', key: c, title: c, text: ((LORE_CLASSES[c] || {}).lore || '') + CLASSES[c].actions.map(a => a.title + ' ' + a.desc).join(' ') + CLASSES[c].traits.map(a => a.title).join(' ') }));
  Object.keys(BACKGROUNDS).forEach(b => ix.push({ t: 'bg', key: b, title: b, text: (LORE_BACKGROUNDS[b] || '') + ((BACKGROUNDS[b].trait || {}).title || '') }));
  [...Object.values(RACES).flatMap(r => r.mutations), ...Object.values(CLASSES).flatMap(c => c.crises)].forEach(m => ix.push({ t: 'mut', key: m.name, title: m.name, text: m.buff + ' ' + m.debuff }));
  ITEMS.forEach(i => ix.push({ t: 'item', key: i.id, title: i.name, text: (i.aliases || []).join(' ') + ' ' + i.desc }));
  Object.values(CLASSES).forEach(c => c.actions.forEach(a => ix.push({ t: 'class', key: Object.keys(CLASSES).find(k => CLASSES[k] === c), title: a.title, text: a.desc, sub: 'приём' })));
  return ix.map(x => ({ ...x, nt: normName(x.title), nx: normName(stripTerms(x.text)) }));
}
function kbSearchHtml(q) {
  if (!kbIndex) kbIndex = buildKbIndex();
  const variants = [...new Set([normName(q), normName(toRu(q))])].filter(Boolean);
  if (!variants.length) return '';
  const res = kbIndex.map(x => ({ x, s: Math.max(...variants.map(v => Math.max(matchScore(v, x.nt) * 1.2, x.nx.includes(v) ? 50 : 0, v.split(' ').every(w => w.length > 2 && x.nx.includes(w)) ? 42 : 0))) }))
    .filter(r => r.s >= 40).sort((a, b) => b.s - a.s).slice(0, 25);
  const tl = { article: 'правила', term: 'словарик', race: 'раса', class: 'класс', bg: 'предыстория', mut: 'мутация', item: 'предмет' };
  return res.length ? res.map(({ x }) => kbLink(x.t, x.key, x.title, x.sub ? `приём · ${x.key}` : tl[x.t])).join('') : '<p class="empty">Ничего не нашлось. Попробуйте другое слово.</p>';
}

/* ---------- обучение ---------- */
const TUT = [
  { tab: 'character', sel: '#char-name', text: 'Как зовут вашего героя? Впишите имя в золотую табличку.', wait: () => state.name.trim().length > 0 },
  { tab: 'character', sel: '#race-select', text: 'Выберите расу. Она даёт бонусы к характеристикам и особые черты.', wait: () => !!state.race },
  { tab: 'character', sel: '#mut-btn', text: 'Это мутация — особое сюжетное изменение. Выбирается только вместе с мастером, когда в истории что-то случилось. Пока можно не трогать.', skip: () => $('mut-btn').classList.contains('hidden') },
  { tab: 'character', sel: '#class-select', text: 'Выберите класс — он определяет, как вы сражаетесь и что умеете. Сразу после выбора предложат стартовое снаряжение.', wait: () => !!state.classRole },
  { tab: 'character', sel: '#crisis-btn', text: 'Кризис — поворот пути класса. Тоже выбирается только вместе с мастером.', skip: () => $('crisis-btn').classList.contains('hidden') },
  { tab: 'character', sel: '#bg-select', text: 'Предыстория — кем герой был до приключений. Даёт вещи, монеты и особую черту.', wait: () => !!state.background },
  { tab: 'character', sel: '#stats-btn', text: 'Выберите способ распределения характеристик, о котором вы договорились с мастером и остальными игроками.', wait: () => state.statsDone },
  { tab: 'character', sel: '#traits-list', text: 'Здесь всё, что умеет ваш герой. Нажмите на строку, чтобы прочитать подробнее.' },
  { tab: 'combat', sel: '#hud', text: 'Вкладка «Бой». Здесь HP, MP и главные числа. Кнопки «−» и «+» меняют HP и MP. «Отдых» — когда мастер объявит привал.' },
  { tab: 'combat', sel: '#attacks', text: 'Нажмите «Атака» или «Применить» — внизу появится плашка: что бросать и сколько урона. Кнопки можно жать сколько угодно, но за свой ход вы делаете одно действие. Следит за этим мастер.' },
  { tab: 'inventory', sel: '#equip', text: 'Инвентарь. Нажмите на слот — откроется список подходящих вещей и сравнение: что станет лучше, что хуже.' },
  { tab: 'inventory', sel: '.search-wrap', text: 'Добавляйте предметы: начните вводить название, и появятся подсказки из базы. Опечатки не страшны.' },
  { tab: 'inventory', sel: '#nav', text: 'Между вкладками можно переходить и свайпом влево-вправо по странице.' },
  { tab: 'character', sel: '#lock-btn', text: 'Персонаж готов! Нажмите на замок, чтобы начать игру. Лист закроется, и менять расу, класс и характеристики сможет только мастер по PIN.', wait: () => state.isLocked, final: true }
];
const tut = { active: false, i: 0 };
function tutStart() {
  closeKb(); menuOpen = false; modalStack = []; paintModal(false);
  if (state.isLocked) { state.isLocked = false; }
  tut.active = true; tut.i = 0; save(); tutGo(0);
}
function tutGo(i) {
  while (i < TUT.length && TUT[i].skip && TUT[i].skip()) i++;
  tut.i = i;
  if (i >= TUT.length) return tutEnd(true);
  const s = TUT[i];
  if (state.activeTab !== s.tab) { state.activeTab = s.tab; save(); }
  setTimeout(() => { const el = document.querySelector(s.sel); if (el) el.scrollIntoView({ block: 'center', behavior: motionOff() ? 'auto' : 'smooth' }); tutRender(); }, 350);
  tutRender();
}
function tutEnd(finished) {
  tut.active = false; $('coach').classList.add('hidden');
  try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { /* ignore */ }
  if (finished) infoModal('Игра началась!', 'Обучение пройдено', '<p>Опыт, HP, вещи и монеты меняются как обычно. Справочник и повтор обучения — в меню «три полоски» на вкладке «Персонаж».</p>');
}
function tutRender() {
  const box = $('coach'); if (!box) return;
  if (!tut.active || modalStack.length || !$('kb').classList.contains('hidden')) { box.classList.add('hidden'); return; }
  const s = TUT[tut.i]; const el = s && document.querySelector(s.sel);
  if (!el) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const r = el.getBoundingClientRect(), pad = 6, hole = $('coach-hole'), bub = $('coach-bubble');
  Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  const L = r.left - pad, T = r.top - pad, R = r.right + pad, B = r.bottom + pad, W = window.innerWidth, H = window.innerHeight;
  const put = (id, x, y, w, h) => Object.assign($(id).style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
  put('cb-t', 0, 0, W, T); put('cb-b', 0, B, W, H - B); put('cb-l', 0, T, L, B - T); put('cb-r', R, T, W - R, B - T);
  const ready = !s.wait || s.wait();
  const canSkip = !s.final || state.statsDone;
  bub.innerHTML = `<p>${esc(s.text)}</p><div class="coach-btns">${canSkip && !s.final ? '<button type="button" class="link-btn" data-act="tut-skip">Пропустить обучение</button>' : '<span></span>'}
    ${s.final ? '' : `<button type="button" class="btn btn-sm" data-act="tut-next" ${ready ? '' : 'disabled'}>${s.wait ? 'Готово' : 'Далее'}</button>`}</div>`;
  const below = r.bottom + 14 + 150 < window.innerHeight;
  bub.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 14 - bub.offsetHeight)) + 'px';
  if (s.wait && ready && s.final) { tutEnd(true); }
}
document.addEventListener('click', e => {
  if (!tut.active || modalStack.length || !$('kb').classList.contains('hidden')) return;
  const s = TUT[tut.i]; if (!s) return;
  if (e.target.closest('#coach-bubble') || e.target.closest(s.sel) || e.target.closest('#modal')) return;
  e.preventDefault(); e.stopPropagation();
}, true);
document.addEventListener('input', () => { if (tut.active) tutRender(); });
['pointerdown', 'touchstart', 'mousedown'].forEach(ev => document.addEventListener(ev, e => { if (e.target.classList && e.target.classList.contains('coach-block')) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, passive: false }));
window.addEventListener('resize', () => tut.active && tutRender());
document.addEventListener('scroll', () => tut.active && tutRender(), true);

/* ---------- настройки и «О приложении» ---------- */
function openSettings() {
  menuOpen = false; renderMenu(state.isLocked);
  const row = (k, t, sub) => `<div role="button" tabindex="0" class="option set-row" data-act="set-toggle" data-k="${k}"><span><b>${t}</b><span>${sub}</span></span><i class="switch ${settings[k] ? 'on' : ''}"></i></div>`;
  showModal(() => `<span class="scroll-tag">Настройки</span><h3 class="scroll-title">Настройки</h3><div class="scroll-text">
    ${row('vibro', 'Вибрация при нажатии', 'Короткий отклик на кнопки. Работает на Android.')}
    ${row('anim', 'Анимации', 'Разворачивание свитков и перелистывание вкладок.')}
    ${row('bigFont', 'Крупный шрифт', 'Весь текст чуть крупнее.')}
    <p class="muted">Настройки хранятся на этом телефоне и в файл персонажа не попадают.</p></div>
    <div class="btn-row"><button type="button" class="btn" data-act="modal-close">Готово</button></div>`);
}
function openAbout() {
  menuOpen = false; renderMenu(state.isLocked);
  infoModal('Слабоумие & Отвага', 'О приложении', `<p>Лист персонажа и инвентарь для настольной ролевой игры в духе D&D, уровни с 1-го по 8-й.</p>
    <p class="muted">Версия ${APP_VERSION}. Работает без интернета. Все данные хранятся на этом устройстве; перенести персонажа можно через «Сохранить в файл».</p>`);
}

/* ---------- обработчики части 2 ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  switch (el.dataset.act) {
    case 'kit-pick': pickKit(Number(el.dataset.i)); break;
    case 'redistribute': redistribute(); break;
    case 'slot-equip': slotEquip(Number(el.dataset.id), el.dataset.slot); break;
    case 'slot-unequip': state.equip[el.dataset.slot] = null; if (el.dataset.slot === 'main' || el.dataset.slot === 'off') { const other = el.dataset.slot === 'main' ? 'off' : 'main'; const it = itemById(state.equip[other]); if (it && defOf(it).hands === 2) state.equip[other] = null; } save(); break;
    case 'kb': openKb(); break;
    case 'kb-back': kbBack(); break;
    case 'kb-open': kbPush(el.dataset.t === 'sec' ? { t: 'sec', key: el.dataset.key } : { t: el.dataset.t, key: el.dataset.key }); break;
    case 'gen-name': { const L = LORE_RACES[$('gen-race').value]; const n = L.names[Math.floor(Math.random() * L.names.length)]; $('gen-out').innerHTML = `<b>${esc(n)}</b>${!state.isLocked ? ` <button type="button" class="link-btn" data-act="gen-use" data-v="${esc(n)}">Взять это имя</button>` : ''}`; break; }
    case 'gen-use': state.name = el.dataset.v; save(); toast(`Теперь героя зовут ${el.dataset.v}.`, 'heal'); break;
    case 'gen-quirk': $('gen-out').innerHTML = `<p>${esc(QUIRKS[Math.floor(Math.random() * QUIRKS.length)])}</p>`; break;
    case 'tut-start': tutStart(); break;
    case 'tut-next': tutGo(tut.i + 1); break;
    case 'tut-skip': tutEnd(false); break;
    case 'settings': openSettings(); break;
    case 'about': openAbout(); break;
    case 'set-toggle': settings[el.dataset.k] = !settings[el.dataset.k]; saveSettings(); refreshModal(); break;
    default: break;
  }
});
window.addEventListener('popstate', () => { if (!$('kb').classList.contains('hidden')) { if (kbStack.length > 1) { kbStack.pop(); kbPaint(); try { history.pushState({ kb: 1 }, ''); } catch (e) { /* ignore */ } } else closeKb(); } });
document.addEventListener('input', e => {
  if (e.target.id === 'kb-q') { const q = e.target.value.trim(); if (q.length >= 2) { kbStack = [{ t: 'home' }, { t: 'search', q }]; } else kbStack = [{ t: 'home' }]; kbPaint(); }
  if (e.target.id === 'item-name' && e.target.value) slotFilter = null;
});
applySettings();
