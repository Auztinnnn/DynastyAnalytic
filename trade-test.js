// ── Pure functions extracted from index.html (keep in sync) ──────────────────
const TRADE_TIER_W = { 1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25, 5: 0.1 };
const POS_STARTER_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1 };

function getPosStarterSlots(prof, pos) {
  const ctx = prof.leagueCtx;
  if (!ctx) return POS_STARTER_SLOTS[pos] || 1;
  return { QB: ctx.starterQB, RB: ctx.starterRB, WR: ctx.starterWR, TE: ctx.starterTE }[pos] || 1;
}
function getEffectiveDepth(prof, pos) {
  return (prof.byPos[pos] || []).reduce((s, p) => {
    const w = TRADE_TIER_W[p.tier] || 0.05;
    return s + (p.actionTag === 'Speculative' ? w * 0.75 : w);
  }, 0);
}
function getPosDepthThresh(prof, pos) {
  const ctx = prof.leagueCtx || {};
  const nFlex = ctx.nFlex || 0;
  return {
    QB: { min: ctx.isSF ? 1.1 : 0.9,    str: ctx.isSF ? 2.0 : 1.5  },
    RB: { min: 1.2 + nFlex * 0.15,       str: 2.2 + nFlex * 0.15    },
    WR: { min: 1.2 + nFlex * 0.2,        str: 2.2 + nFlex * 0.2     },
    TE: { min: ctx.isTEP ? 0.9 : 0.75,   str: ctx.isTEP ? 1.75 : 1.5 },
  }[pos] || { min: 0.9, str: 1.5 };
}
function getPositionStrengthState(prof, pos) {
  const depth = getEffectiveDepth(prof, pos);
  const { min, str } = getPosDepthThresh(prof, pos);
  return depth >= str ? 'strength' : depth >= min ? 'neutral' : 'weakness';
}
function getSurplusScore(prof, pos) {
  const arr = prof.byPos[pos] || [];
  return arr.slice(getPosStarterSlots(prof, pos))
            .reduce((s, p) => s + (TRADE_TIER_W[p.tier] || 0.05), 0);
}
function getNeedSeverity(prof, pos, clsLabel) {
  const state = getPositionStrengthState(prof, pos);
  const isContender = clsLabel === 'Contender';
  const isFringe    = clsLabel === 'Fringe';
  const isRebuilder = clsLabel === 'Rebuild' || clsLabel === 'Rebuilding' || clsLabel === 'Retool';
  if (state === 'weakness') {
    if (isRebuilder && pos === 'RB') return 'moderate';
    if (isFringe) return 'moderate';
    return 'strong';
  }
  if (state === 'neutral') return isContender ? 'moderate' : 'optional';
  return 'none';
}
function getFlexOffset(prof) {
  const wrS = getPositionStrengthState(prof, 'WR');
  const rbS = getPositionStrengthState(prof, 'RB');
  const off = {};
  if (wrS === 'strength' && rbS !== 'strength') off.RB = 0.4;
  if (rbS === 'strength' && wrS !== 'strength') off.WR = 0.4;
  return off;
}
function getStarterImpact(player, prof) {
  if (player.isPick) return 0;
  const pos = player.pos;
  const posArr = prof.byPos[pos] || [];
  const slots = getPosStarterSlots(prof, pos);
  const currentStarters = posArr.slice(0, slots);
  const worstStarter = currentStarters.length >= slots ? currentStarters[currentStarters.length - 1] : null;
  if (!worstStarter || player.neutral > worstStarter.neutral) return 1.0;
  const gap = (worstStarter.neutral - player.neutral) / Math.max(worstStarter.neutral, 1);
  return Math.max(0, 0.4 - gap * 0.8);
}
function needFillScore(player, prof, clsLabel, flexOffset) {
  if (player.isPick) return 0;
  const sev = getNeedSeverity(prof, player.pos, clsLabel);
  const sevMap = { strong: 2.5, moderate: 1.5, optional: 0.5, none: 0 };
  const impact = getStarterImpact(player, prof);
  const base = (sevMap[sev] || 0) - (flexOffset[player.pos] || 0);
  return Math.max(0, base * (0.4 + impact * 0.6));
}
function buildTradePool(prof) {
  const clsLabel = prof.classification?.label || 'Mid-Tier';
  const isRebuilder = clsLabel === 'Rebuild' || clsLabel === 'Rebuilding';
  const isFringe    = clsLabel === 'Fringe';
  return prof.all.filter(p => {
    if (p.actionTag === 'Cornerstone' || p.neutral <= 0) return false;
    if (p.actionTag === 'Sell' || p.actionTag === 'Shop') return true;
    const pos = p.pos;
    const posArr = prof.byPos[pos] || [];
    const rank = posArr.indexOf(p) + 1;
    const state = getPositionStrengthState(prof, pos);
    const slots = getPosStarterSlots(prof, pos);
    if (state === 'weakness') return rank > Math.max(slots + 1, 2);
    if (state === 'neutral') {
      if (rank <= slots) return false;  // protect ALL starters — neutral means you need them all
      return true;                      // bench/depth beyond starter line is tradeable
    }
    if (rank === 1 && p.tier === 1 && !isRebuilder) return false;
    if (isFringe && rank <= 2 && p.tier <= 2) return false;
    return true;
  }).sort((a, b) => {
    const tag = { Sell: 0, Shop: 1 };
    return (tag[a.actionTag] ?? 2) - (tag[b.actionTag] ?? 2) || b.neutral - a.neutral;
  });
}
// Rebuild insulation check (mirrors scoreOf penalty logic)
function hasInsulation(sideB) {
  return sideB.some(x =>
    x.isPick ||
    (!x.isPick && (parseInt(x.age) || 99) <= 25) ||
    (!x.isPick && x.actionTag === 'Speculative')
  );
}

// ── Test infrastructure ───────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function expect(label, actual, expected) {
  total++;
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
  }
}

function expectApprox(label, actual, expected, tolerance = 0.05) {
  total++;
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${expected} ± ${tolerance}`);
    console.log(`      actual:   ${actual}`);
  }
}

function suite(name, fn) {
  console.log(`\n── ${name}`);
  fn();
}

// Mock builders
const CTX_1QB   = { isSF:false, isTEP:false, nFlex:0, starterQB:1, starterRB:2, starterWR:3, starterTE:1, teamCount:12 };
const CTX_SF    = { isSF:true,  isTEP:false, nFlex:0, starterQB:2, starterRB:2, starterWR:3, starterTE:1, teamCount:12 };
const CTX_TEP   = { isSF:false, isTEP:true,  nFlex:0, starterQB:1, starterRB:2, starterWR:3, starterTE:1, teamCount:12 };
const CTX_1FLEX = { isSF:false, isTEP:false, nFlex:1, starterQB:1, starterRB:2, starterWR:3, starterTE:1, teamCount:12 };
const CTX_2FLEX = { isSF:false, isTEP:false, nFlex:2, starterQB:1, starterRB:3, starterWR:4, starterTE:1, teamCount:12 };

function pl(pos, tier, neutral, opts = {}) {
  return { pos, tier, neutral, age: opts.age || 25, actionTag: opts.tag || 'Hold', isPick: false,
           name: opts.name || `${pos}${tier}` };
}
function pick(val, age_unused) {
  return { isPick: true, val, age: null, name: 'Pick' };
}
function makeProf(cls, byPos, leagueCtx = CTX_1QB) {
  const all = Object.values(byPos).flat().sort((a, b) => b.neutral - a.neutral);
  return { classification: { label: cls }, byPos, all, leagueCtx };
}

// ── Suite 1: getPositionStrengthState — TE across formats ────────────────────
suite('getPositionStrengthState — TE across formats', () => {
  // T1 TE, 1QB: depth=1.0, min=0.75, str=1.5 → neutral
  expect('T1 TE, 1QB → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',1,8000)] }, CTX_1QB), 'TE'),
    'neutral');

  // T2 TE, 1QB: depth=0.75, min=0.75 → neutral (boundary: 0.75 >= 0.75)
  expect('T2 TE, 1QB → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',2,6000)] }, CTX_1QB), 'TE'),
    'neutral');

  // T3 TE, 1QB: depth=0.5, min=0.75 → weakness
  expect('T3 TE, 1QB → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',3,4000)] }, CTX_1QB), 'TE'),
    'weakness');

  // T1 TE, TEP: depth=1.0, min=0.9, str=1.75 → neutral
  expect('T1 TE, TEP → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',1,8000)] }, CTX_TEP), 'TE'),
    'neutral');

  // T2 TE, TEP: depth=0.75, min=0.9 → weakness (TEP raises min bar)
  expect('T2 TE, TEP → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',2,6000)] }, CTX_TEP), 'TE'),
    'weakness');

  // T1+T3 TE, TEP: depth=1.0+0.5=1.5, min=0.9, str=1.75 → neutral
  expect('T1+T3 TE, TEP → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',1,8000), pl('TE',3,4000)] }, CTX_TEP), 'TE'),
    'neutral');

  // T1+T2 TE, TEP: depth=1.0+0.75=1.75, str=1.75 → strength (boundary: 1.75 >= 1.75)
  expect('T1+T2 TE, TEP → strength',
    getPositionStrengthState(makeProf('Mid-Tier', { TE: [pl('TE',1,8000), pl('TE',2,6000)] }, CTX_TEP), 'TE'),
    'strength');
});

// ── Suite 2: getPositionStrengthState — QB across formats ────────────────────
suite('getPositionStrengthState — QB across formats', () => {
  // T1 QB, 1QB: depth=1.0, min=0.9, str=1.5 → neutral
  expect('T1 QB, 1QB → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,8000)] }, CTX_1QB), 'QB'),
    'neutral');

  // T2 QB, 1QB: depth=0.75, min=0.9 → weakness
  expect('T2 QB, 1QB → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',2,5000)] }, CTX_1QB), 'QB'),
    'weakness');

  // T1+T3 QB, 1QB: depth=1.0+0.5=1.5, str=1.5 → strength (boundary: 1.5 >= 1.5)
  expect('T1+T3 QB, 1QB → strength',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,8000), pl('QB',3,3000)] }, CTX_1QB), 'QB'),
    'strength');

  // T1 QB, SF: depth=1.0, min=1.1 → weakness (SF needs two starters, min raised)
  expect('T1 QB, SF → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,8000)] }, CTX_SF), 'QB'),
    'weakness');

  // T1+T4 QB, SF: depth=1.0+0.25=1.25, min=1.1, str=2.0 → neutral
  expect('T1+T4 QB, SF → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,8000), pl('QB',4,2000)] }, CTX_SF), 'QB'),
    'neutral');

  // T1+T2 QB, SF: depth=1.0+0.75=1.75, str=2.0 → neutral (1.75 < 2.0, still neutral)
  expect('T1+T2 QB, SF → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,8000), pl('QB',2,5000)] }, CTX_SF), 'QB'),
    'neutral');

  // T1+T1 QB, SF: depth=1.0+1.0=2.0, str=2.0 → strength (boundary: 2.0 >= 2.0)
  expect('T1+T1 QB, SF → strength',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',1,9000), pl('QB',1,8000)] }, CTX_SF), 'QB'),
    'strength');

  // T2+T3 QB, SF: depth=0.75+0.5=1.25, min=1.1, str=2.0 → neutral
  expect('T2+T3 QB, SF → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { QB: [pl('QB',2,6000), pl('QB',3,4000)] }, CTX_SF), 'QB'),
    'neutral');
});

// ── Suite 3: getPositionStrengthState — RB/WR across flex formats ─────────────
suite('getPositionStrengthState — RB/WR across flex formats', () => {
  // T3+T3 WR, 1QB (0flex): depth=0.5+0.5=1.0, min=1.2 → weakness
  expect('T3+T3 WR, 1QB(0flex) → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',3,4000), pl('WR',3,3500)] }, CTX_1QB), 'WR'),
    'weakness');

  // T2+T3 WR, 1QB (0flex): depth=0.75+0.5=1.25, min=1.2 → neutral (1.25 >= 1.2)
  expect('T2+T3 WR, 1QB(0flex) → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',2,6000), pl('WR',3,4000)] }, CTX_1QB), 'WR'),
    'neutral');

  // T1+T3 WR, 1QB (0flex): depth=1.0+0.5=1.5, min=1.2, str=2.2 → neutral
  expect('T1+T3 WR, 1QB(0flex) → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',3,4000)] }, CTX_1QB), 'WR'),
    'neutral');

  // T1+T1 WR, 1QB (0flex): depth=1.0+1.0=2.0, str=2.2 → neutral (2.0 < 2.2)
  expect('T1+T1 WR, 1QB(0flex) → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',1,8000)] }, CTX_1QB), 'WR'),
    'neutral');

  // T1+T1+T3 WR, 1QB (0flex): depth=1.0+1.0+0.5=2.5, str=2.2 → strength (2.5 >= 2.2)
  expect('T1+T1+T3 WR, 1QB(0flex) → strength',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',1,8000), pl('WR',3,4000)] }, CTX_1QB), 'WR'),
    'strength');

  // T2+T3 WR, 1flex: depth=1.25, min=1.2+1*0.2=1.4 → weakness (1.25 < 1.4)
  expect('T2+T3 WR, 1flex → weakness',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',2,6000), pl('WR',3,4000)] }, CTX_1FLEX), 'WR'),
    'weakness');

  // T1+T3+T4 WR, 1flex: depth=1.0+0.5+0.25=1.75, min=1.4, str=2.4 → neutral
  expect('T1+T3+T4 WR, 1flex → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',3,4000), pl('WR',4,2000)] }, CTX_1FLEX), 'WR'),
    'neutral');

  // T1+T2+T2 WR, 2flex: depth=1.0+0.75+0.75=2.5, str=2.2+2*0.2=2.6 → neutral (2.5 < 2.6)
  expect('T1+T2+T2 WR, 2flex → neutral',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',2,7000), pl('WR',2,6000)] }, CTX_2FLEX), 'WR'),
    'neutral');

  // T1+T1+T2 WR, 2flex: depth=1.0+1.0+0.75=2.75, str=2.6 → strength (2.75 >= 2.6)
  expect('T1+T1+T2 WR, 2flex → strength',
    getPositionStrengthState(makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',1,8000), pl('WR',2,6000)] }, CTX_2FLEX), 'WR'),
    'strength');
});

// ── Suite 4: getStarterImpact — does player actually start? ──────────────────
// Use CTX_2WR (starterWR=2) to keep WR tests simple and deterministic.
suite('getStarterImpact — does player actually start?', () => {
  const CTX_2WR = { ...CTX_1QB, starterWR: 2 };

  // T1 WR (10000) incoming, team has T3(4000)+T3(3500), 2 slots → beats worst starter → 1.0
  expect('Incoming T1 WR (10000) vs T3+T3, 2 slots → impact 1.0',
    getStarterImpact(
      pl('WR',1,10000),
      makeProf('Mid-Tier', { WR: [pl('WR',3,4000), pl('WR',3,3500)] }, CTX_2WR)
    ),
    1.0);

  // T2 WR (7000) incoming, team has T1(9000)+T3(4000), 2 slots → 7000 > worstStarter(4000) → 1.0
  expect('Incoming T2 WR (7000) vs T1+T3, 2 slots → impact 1.0',
    getStarterImpact(
      pl('WR',2,7000),
      makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',3,4000)] }, CTX_2WR)
    ),
    1.0);

  // T3 WR (4000) incoming, team has T1(9000)+T2(6500), 2 slots → bench
  // worstStarter=6500, gap=(6500-4000)/6500≈0.3846, impact=max(0, 0.4-0.3846*0.8)≈0.092
  expectApprox('Incoming T3 WR (4000) vs T1+T2(6500), 2 slots → impact ≈0.092',
    getStarterImpact(
      pl('WR',3,4000),
      makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',2,6500)] }, CTX_2WR)
    ),
    0.092, 0.005);

  // T4 WR (2500) incoming, team has T1(9000)+T2(6500), 2 slots → deep bench
  // gap=(6500-2500)/6500≈0.615, impact=max(0, 0.4-0.615*0.8)=max(0,-0.092)=0
  expect('Incoming T4 WR (2500) vs T1+T2(6500), 2 slots → impact 0',
    getStarterImpact(
      pl('WR',4,2500),
      makeProf('Mid-Tier', { WR: [pl('WR',1,9000), pl('WR',2,6500)] }, CTX_2WR)
    ),
    0);

  // T1 QB (8000) incoming, team has no QB → worstStarter=null → impact 1.0
  expect('Incoming T1 QB (8000), no existing QB → impact 1.0',
    getStarterImpact(
      pl('QB',1,8000),
      makeProf('Mid-Tier', { QB: [] }, CTX_1QB)
    ),
    1.0);

  // T3 QB (3000) incoming, team has T1 QB (8000), 1 slot → deep bench
  // gap=(8000-3000)/8000=0.625, impact=max(0, 0.4-0.625*0.8)=max(0,-0.1)=0
  expect('Incoming T3 QB (3000) vs T1 QB (8000), 1 slot → impact 0',
    getStarterImpact(
      pl('QB',3,3000),
      makeProf('Mid-Tier', { QB: [pl('QB',1,8000)] }, CTX_1QB)
    ),
    0);

  // T2 QB (5000) incoming, team has T1 QB (8000), 1 slot → fractional impact
  // gap=(8000-5000)/8000=0.375, impact=max(0, 0.4-0.375*0.8)=0.4-0.3=0.1
  expectApprox('Incoming T2 QB (5000) vs T1 QB (8000), 1 slot → impact ≈0.1',
    getStarterImpact(
      pl('QB',2,5000),
      makeProf('Mid-Tier', { QB: [pl('QB',1,8000)] }, CTX_1QB)
    ),
    0.1, 0.005);
});

// ── Suite 5: needFillScore — severity × impact blending ──────────────────────
suite('needFillScore — severity × impact blending', () => {
  // T1 QB incoming, contender, QB weakness (only T3 QB on roster)
  // weakness + contender → strong (2.5); worstStarter=T3(3000), incoming T1(9000)>3000 → impact=1.0
  // score = 2.5 * (0.4 + 1.0*0.6) = 2.5 * 1.0 = 2.5
  expectApprox('T1 QB incoming, contender, QB weakness → score 2.5',
    needFillScore(
      pl('QB',1,9000),
      makeProf('Contender', { QB: [pl('QB',3,3000)] }, CTX_1QB),
      'Contender', {}
    ),
    2.5, 0.05);

  // T3 QB (2500) incoming, contender, QB weakness (T3 QB=3000 on roster)
  // worstStarter=3000, incoming=2500<3000: gap=(3000-2500)/3000≈0.167, impact=max(0, 0.4-0.167*0.8)≈0.267
  // score = 2.5 * (0.4 + 0.267*0.6) = 2.5 * 0.56 = 1.4
  expectApprox('T3 QB (2500) incoming, contender, QB weakness → score ≈1.4',
    needFillScore(
      pl('QB',3,2500),
      makeProf('Contender', { QB: [pl('QB',3,3000)] }, CTX_1QB),
      'Contender', {}
    ),
    1.4, 0.05);

  // T1 WR incoming, contender, WR neutral (T1+T3, depth=1.5; 3 starter slots in CTX_1QB → only 2 WRs → worstStarter=null → impact=1.0)
  // neutral + contender → moderate (1.5); score = 1.5 * (0.4 + 1.0*0.6) = 1.5 * 1.0 = 1.5
  expectApprox('T1 WR incoming, contender, WR neutral → score 1.5',
    needFillScore(
      pl('WR',1,10000),
      makeProf('Contender', { WR: [pl('WR',1,9000), pl('WR',3,4000)] }, CTX_1QB),
      'Contender', {}
    ),
    1.5, 0.05);

  // T1 WR incoming, fringe, WR weakness (T3+T3, depth=1.0<1.2; 3 slots, only 2 WRs → worstStarter=null → impact=1.0)
  // weakness + fringe → moderate (1.5); score = 1.5 * 1.0 = 1.5
  expectApprox('T1 WR incoming, fringe, WR weakness → score 1.5',
    needFillScore(
      pl('WR',1,9000),
      makeProf('Fringe', { WR: [pl('WR',3,4000), pl('WR',3,3500)] }, CTX_1QB),
      'Fringe', {}
    ),
    1.5, 0.05);

  // T1 RB incoming, rebuilder, RB weakness (T4+T5, depth<1.2; slots=2, worst=T4(2000), incoming=9000>2000 → impact=1.0)
  // weakness + rebuilder + RB → moderate (1.5); score = 1.5 * 1.0 = 1.5
  expectApprox('T1 RB incoming, rebuilder, RB weakness → score 1.5',
    needFillScore(
      pl('RB',1,9000),
      makeProf('Rebuild', { RB: [pl('RB',4,2000), pl('RB',5,1000)] }, CTX_1QB),
      'Rebuild', {}
    ),
    1.5, 0.05);

  // T1 WR incoming, contender, WR strength (T1+T1+T3, depth=2.5>=2.2)
  // strength → none (0); score = 0
  expectApprox('T1 WR incoming, contender, WR strength → score 0',
    needFillScore(
      pl('WR',1,10000),
      makeProf('Contender', { WR: [pl('WR',1,9000), pl('WR',1,8000), pl('WR',3,4000)] }, CTX_1QB),
      'Contender', {}
    ),
    0, 0.001);

  // T1 RB incoming, contender with strong WR (T1+T1+T3) but neutral RB (T2+T3, 1.25)
  // WR=strength, RB≠strength → flex offset: off.RB=0.4
  // RB neutral + contender → moderate (1.5); slots=2, worst=T3(4000), incoming=10000>4000 → impact=1.0
  // base = 1.5 - 0.4 = 1.1; score = 1.1 * (0.4 + 1.0*0.6) = 1.1
  const profFlexTest = makeProf('Contender', {
    WR: [pl('WR',1,9000), pl('WR',1,8000), pl('WR',3,4000)],
    RB: [pl('RB',2,6000), pl('RB',3,4000)],
  }, CTX_1QB);
  const flexOff = getFlexOffset(profFlexTest);
  expectApprox('T1 RB incoming, contender with WR strength → flex offset reduces score to 1.1',
    needFillScore(pl('RB',1,10000), profFlexTest, 'Contender', flexOff),
    1.1, 0.05);

  // Ordering check: weakness_contender > weakness_fringe
  // Both same roster (T3+T3 WR, weakness), incoming T1 WR
  const scoreWeakCont = needFillScore(
    pl('WR',1,10000),
    makeProf('Contender', { WR: [pl('WR',3,3000), pl('WR',3,2500)] }, CTX_1QB),
    'Contender', {}
  );
  const scoreWeakFringe = needFillScore(
    pl('WR',1,10000),
    makeProf('Fringe', { WR: [pl('WR',3,3000), pl('WR',3,2500)] }, CTX_1QB),
    'Fringe', {}
  );
  expect('weakness_contender score > weakness_fringe score', scoreWeakCont > scoreWeakFringe, true);

  // Ordering check: neutral_contender > neutral_fringe
  // Both same roster (T1+T2 WR, neutral depth=1.75, 3 slots → worstStarter=null → impact=1.0)
  const scoreNeutCont = needFillScore(
    pl('WR',1,10000),
    makeProf('Contender', { WR: [pl('WR',1,9000), pl('WR',2,6000)] }, CTX_1QB),
    'Contender', {}
  );
  const scoreNeutFringe = needFillScore(
    pl('WR',1,10000),
    makeProf('Fringe', { WR: [pl('WR',1,9000), pl('WR',2,6000)] }, CTX_1QB),
    'Fringe', {}
  );
  expect('neutral_contender score > neutral_fringe score', scoreNeutCont > scoreNeutFringe, true);
});

// ── Suite 6: buildTradePool — protection logic ───────────────────────────────
suite('buildTradePool — protection logic', () => {
  // Rebuilder with T1 WR at WR strength (T1+T1+T3): T1 WR appears in pool
  // state=strength, rank=1, tier=1, isRebuilder=true → rank===1 && tier===1 && !isRebuilder is false → not filtered → in pool
  {
    const wr1 = pl('WR',1,9000); const wr2 = pl('WR',1,8000); const wr3 = pl('WR',3,4000);
    const prof = makeProf('Rebuild', { WR: [wr1, wr2, wr3] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Rebuilder with T1 WR at WR strength: T1 WR (rank 1) is in pool',
      pool.some(x => x === wr1), true);
  }

  // Contender with T1 WR at WR strength (T1+T1+T3): T1 WR NOT in pool (elite anchor protected)
  // state=strength, rank=1, tier=1, isRebuilder=false → rank===1 && tier===1 && !isRebuilder → true → filtered out
  {
    const wr1 = pl('WR',1,9000); const wr2 = pl('WR',1,8000); const wr3 = pl('WR',3,4000);
    const prof = makeProf('Contender', { WR: [wr1, wr2, wr3] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Contender with T1 WR at WR strength: T1 WR (rank 1) NOT in pool',
      pool.some(x => x === wr1), false);
  }

  // Fringe with T1+T2 WR at WR neutral (depth=1.75, 1QB 3-slot): T2 WR NOT in pool
  // state=neutral, rank=2 (T2), slots=3 → rank(2)<=slots(3) && tier(2)<=3 (isFringe check) → filtered out
  {
    const wr1 = pl('WR',1,9000); const wr2 = pl('WR',2,6000);
    const prof = makeProf('Fringe', { WR: [wr1, wr2] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Fringe with T1+T2 WR at WR neutral: T2 WR (rank 2, starter) NOT in pool',
      pool.some(x => x === wr2), false);
  }

  // Team with T4 RB at RB weakness (T4+T4, depth=0.5<1.2): T4 (rank 2) NOT in pool
  // state=weakness, slots=2, rank=2, max(slots+1,2)=3 → rank(2) NOT > 3 → filtered out
  {
    const rb1 = pl('RB',4,2000); const rb2 = pl('RB',4,1500);
    const prof = makeProf('Mid-Tier', { RB: [rb1, rb2] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Team with T4 RB at RB weakness: T4 (rank 2) NOT in pool',
      pool.some(x => x === rb1), false);
  }

  // Team with Sell-tagged T1 RB at RB weakness: Sell-tagged player IS in pool
  // actionTag==='Sell' → short-circuit return true regardless of position state
  {
    const rb1 = pl('RB',1,9000,{tag:'Sell'}); const rb2 = pl('RB',4,1500);
    const prof = makeProf('Mid-Tier', { RB: [rb1, rb2] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Sell-tagged T1 RB at RB weakness IS in pool',
      pool.some(x => x === rb1), true);
  }

  // Cornerstone T1 WR: NOT in pool regardless of anything
  // actionTag==='Cornerstone' → immediately return false
  {
    const wr1 = pl('WR',1,9000,{tag:'Cornerstone'}); const wr2 = pl('WR',2,6000); const wr3 = pl('WR',3,4000);
    const prof = makeProf('Contender', { WR: [wr1, wr2, wr3] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Cornerstone T1 WR NOT in pool regardless of team type',
      pool.some(x => x === wr1), false);
  }

  // Fringe with T1(rank1)+T1(rank2)+T2(rank3) WR at WR strength (depth=2.75>=2.2):
  //   T1 rank-1 NOT in pool: rank===1, tier===1, !isRebuilder(fringe) → filtered
  //   T1 rank-2 NOT in pool: isFringe && rank(2)<=2 && tier(1)<=2 → filtered
  //   T2 rank-3 IS in pool: rank(3) not <=2 for fringe check; rank not ===1; → passes through → in pool
  {
    const wr1 = pl('WR',1,9500); const wr2 = pl('WR',1,9000); const wr3 = pl('WR',2,7000);
    const prof = makeProf('Fringe', { WR: [wr1, wr2, wr3] }, CTX_1QB);
    const pool = buildTradePool(prof);
    expect('Fringe T1+T1+T2 WR strength: T1 rank-1 NOT in pool',
      pool.some(x => x === wr1), false);
    expect('Fringe T1+T1+T2 WR strength: T1 rank-2 NOT in pool',
      pool.some(x => x === wr2), false);
    expect('Fringe T1+T1+T2 WR strength: T2 rank-3 IS in pool',
      pool.some(x => x === wr3), true);
  }
});

// ── Suite 7: Rebuild insulation gate ─────────────────────────────────────────
suite('Rebuild insulation gate — hasInsulation', () => {
  const agingQB   = pl('QB',1,8500,{age:31});
  const youngWR   = pl('WR',2,7000,{age:23});
  const specPlayer = pl('RB',3,4000,{tag:'Speculative'});
  const pk        = pick(2000);

  // Aging T1 QB (age 31), no picks → no player <= 25, no pick, no Speculative → false
  expect('Aging T1 QB (age 31) only → hasInsulation false',
    hasInsulation([agingQB]), false);

  // Pick included → true
  expect('Pick in sideB → hasInsulation true',
    hasInsulation([pk]), true);

  // Young T2 WR (age 23) → age <= 25 → true
  expect('Young WR (age 23) → hasInsulation true',
    hasInsulation([youngWR]), true);

  // Speculative-tagged player → true
  expect('Speculative-tagged player → hasInsulation true',
    hasInsulation([specPlayer]), true);

  // Composite: aging QB alone → false, aging QB + pick → true
  expect('Aging QB + pick → hasInsulation true',
    hasInsulation([agingQB, pk]), true);

  // Proposal A: rebuilder sends T1 WR, receives aging T1 QB (age 31) only → no insulation
  const proposalA_sideB = [pl('QB',1,8500,{age:31})];
  expect('Proposal A (aging QB, no picks/youth) → hasInsulation false',
    hasInsulation(proposalA_sideB), false);

  // Proposal B: rebuilder sends T1 WR, receives young T2 WR (age 22) + pick → has insulation
  const proposalB_sideB = [pl('WR',2,7000,{age:22}), pick(2000)];
  expect('Proposal B (young WR + pick) → hasInsulation true',
    hasInsulation(proposalB_sideB), true);

  // Ranking scenario: proposal B should rank better (lower penalty) than proposal A
  // Both proposals: rebuilder trades elite T1 WR (neutral=9000)
  //   Proposal A: receives aging T1 QB (neutral=8500, age=31) → eliteOut=true, hasInsulation=false → would incur -2.0 penalty
  //   Proposal B: receives young T2 WR (neutral=7000, age=22) + pick (val=2000) → eliteOut=true, hasInsulation=true → no penalty
  // We simulate the penalty delta directly: insulated trade is strictly better
  const eliteOut = true; // both trade away a T1 WR
  const INSULATION_PENALTY = -2.0;
  const penaltyA = eliteOut && !hasInsulation(proposalA_sideB) ? INSULATION_PENALTY : 0;
  const penaltyB = eliteOut && !hasInsulation(proposalB_sideB) ? INSULATION_PENALTY : 0;
  // Lower penalty value is WORSE (more negative = bigger deduction); penaltyA=-2, penaltyB=0 → B is better
  expect('Proposal A incurs insulation penalty (-2.0)',
    penaltyA, -2.0);
  expect('Proposal B incurs no insulation penalty (0)',
    penaltyB, 0);
  expect('Proposal B penalty > Proposal A penalty (B is ranked better)',
    penaltyB > penaltyA, true);
});

// ── Suite 8: Speculative depth discount ──────────────────────────────────────
suite('Speculative depth discount in getEffectiveDepth', () => {
  // T2 Speculative contributes 0.75 * 0.75 = 0.5625, not 0.75
  // This matters when Speculative player is the only real depth piece

  // T3 RB1 (proven) + T2 Speculative RB2 → depth = 0.5 + 0.5625 = 1.0625 < 1.2 → weakness
  // Without discount it would be 0.5 + 0.75 = 1.25 → neutral (wrong)
  const profSpecRB = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',3,5600), pl('RB',2,5200,{tag:'Speculative'})],
    WR: [pl('WR',1,9000), pl('WR',2,6000), pl('WR',3,4000)],
    TE: [pl('TE',1,7000)],
  });
  expect('T3 RB1 + T2 Speculative RB2 → RB weakness (Speculative discounted)',
    getPositionStrengthState(profSpecRB, 'RB'), 'weakness');

  // Without speculative: T1 WR + T2 WR + T2 Speculative WR → 1.0 + 0.75 + 0.5625 = 2.3125
  // vs str=2.2 → strength; Speculative WR doesn't drop this below strength threshold
  const profSpecWR = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',2,6000), pl('RB',3,4000)],
    WR: [pl('WR',1,9500), pl('WR',2,7000), pl('WR',2,6000,{tag:'Speculative'})],
    TE: [pl('TE',1,6000)],
  });
  expect('T1+T2+T2Spec WR room → still strength (elite depth absorbs discount)',
    getPositionStrengthState(profSpecWR, 'WR'), 'strength');

  // T2 Speculative alone at TE in 1QB → 0.75*0.75=0.5625 < 0.75 → weakness
  const profSpecTE = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',2,6000), pl('RB',3,4000)],
    WR: [pl('WR',1,9000), pl('WR',2,6500), pl('WR',3,4500)],
    TE: [pl('TE',2,5500,{tag:'Speculative'})],
  });
  expect('T2 Speculative TE alone in 1QB → weakness (cannot fully anchor TE slot)',
    getPositionStrengthState(profSpecTE, 'TE'), 'weakness');

  // T1 proven TE alone → still neutral (T1 always clears the TE bar)
  const profEliteTE = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',2,6000), pl('RB',3,4000)],
    WR: [pl('WR',1,9000), pl('WR',2,6500), pl('WR',3,4500)],
    TE: [pl('TE',1,8500)],
  });
  expect('T1 proven TE alone in 1QB → neutral (elite TE clears bar unaffected)',
    getPositionStrengthState(profEliteTE, 'TE'), 'neutral');
});

// ── Suite 9: Neutral position protects ALL starters ──────────────────────────
suite('buildTradePool — neutral position protects all starters regardless of tier', () => {
  // T3 RB1 + T2 Speculative: depth=1.0625 → weakness (Speculative discounted)
  // Weakness rule: protect rank ≤ max(slots+1, 2) = 3
  // Both RB1 (rank 1) and Speculative (rank 2) should be protected
  const profSpecRB = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',3,5600,{name:'TreVeyon'}), pl('RB',2,5200,{tag:'Speculative',name:'SpecRB'})],
    WR: [pl('WR',1,9000), pl('WR',2,6000), pl('WR',3,4000)],
    TE: [pl('TE',1,7000)],
  });
  const poolSpecRB = buildTradePool(profSpecRB);
  const rbsInPool = poolSpecRB.filter(p => p.pos === 'RB');
  expect('T3 RB1 (TreVeyon) NOT in pool when RB is weakness', rbsInPool.some(p => p.name==='TreVeyon'), false);
  expect('T2 Speculative RB2 NOT in pool when RB is weakness', rbsInPool.some(p => p.name==='SpecRB'), false);

  // T2 RB1 + T2 proven RB2 → depth=1.5 → neutral; both starters protected (rank≤slots=2)
  const profNeutralRB = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',2,6500,{name:'RB1'}), pl('RB',2,5000,{name:'RB2'})],
    WR: [pl('WR',1,9000), pl('WR',2,6000), pl('WR',3,4000)],
    TE: [pl('TE',1,7000)],
  });
  const poolNeutralRB = buildTradePool(profNeutralRB);
  const rbsNeutral = poolNeutralRB.filter(p => p.pos === 'RB');
  expect('T2 RB1 NOT in pool at neutral (all starters protected)', rbsNeutral.some(p => p.name==='RB1'), false);
  expect('T2 RB2 NOT in pool at neutral (all starters protected)', rbsNeutral.some(p => p.name==='RB2'), false);

  // At strength: RB3 bench piece IS in pool
  const profStrongRB = makeProf('Contender', {
    QB: [pl('QB',1,8000)],
    RB: [pl('RB',1,9000,{name:'RB1'}), pl('RB',2,6500,{name:'RB2'}), pl('RB',3,4000,{name:'RB3bench'})],
    WR: [pl('WR',2,6000), pl('WR',3,4000)],
    TE: [pl('TE',1,7000)],
  });
  // RB depth: 1.0+0.75+0.5=2.25 > 2.2 → strength
  expect('RB room with T1+T2+T3 → strength', getPositionStrengthState(profStrongRB,'RB'), 'strength');
  const poolStrongRB = buildTradePool(profStrongRB);
  expect('T3 RB bench IS in pool at strength', poolStrongRB.some(p => p.name==='RB3bench'), true);
  // T1 anchor still protected at strength for non-rebuilder
  expect('T1 RB anchor NOT in pool at strength (non-rebuilder)', poolStrongRB.some(p => p.name==='RB1'), false);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
