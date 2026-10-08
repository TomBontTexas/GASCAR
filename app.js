/* GASCAR — application logic (vanilla JS, no build step).
   GASCAR = Galactic Association for Spaceship Competitive Astro-Racing,
   the in-world racing league depicted in the tabletop game Warp Space: GASCAR.

   Race rules follow Circus Astralis (see RULE_CHANGES.md 2026-10-05): ships
   take turns one at a time in Thrust order. Each turn shifts gear, rolls
   movement (gear dice + Thrust), makes a Control Task Check when that roll
   exceeds the Leg TN, then walks the path hex by hex. Racers in the way
   prompt straight on or a Slip left/right around them (the nth Slip of the
   Leg costs n movement points); entering an occupied hex needs a Control
   check. A Gunner attack is optional along the way. Fumbles roll the 2D10 Fumble Chart. Ship classes,
   crewmen (Pilot/Gunner/Engineer), sponsors, and the hex-grid Circular Track engine
   (resolveSlipPath, circTrackGeometry, etc.) are shared by every rule set. */

// App version (see APP_CHANGES.md): bump the middle number for a new feature
// or features, the last number for a bug fix. Shown at the top of the
// Instructions tab. Source of truth lives in version.js (loaded before this
// file in index.html) so startUpdateCheck() can re-check it cheaply.
const APP_VERSION = LATEST_APP_VERSION;

/* ============================== Utilities ============================== */
let _uidN = 1;
function uid(prefix) { return prefix + "_" + (_uidN++) + "_" + Math.random().toString(36).slice(2, 7); }
function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function clampInt(v, lo, hi, fallback) { const n = parseInt(v, 10); if (isNaN(n)) return fallback; return Math.max(lo, Math.min(hi, n)); }
// Right-pad with non-breaking spaces so <option> text keeps its columns (native
// options collapse ordinary runs of whitespace). Pair with a monospace font.
function padNbsp(s, n) { s = String(s); return s + " ".repeat(Math.max(0, n - s.length)); }
// Wraps an existing <input type="number" ...> tag string with a -/+ button on
// either side, replacing the browser's native spin arrows everywhere in the
// app (see style.css's .numstep) -- used by every number input. The buttons
// call App.stepNum(), which finds the input inside the same wrapper and
// dispatches real 'input'/'change' events, so each input's own existing
// onchange/oninput handler (passed through unchanged here) still fires.
function numStepper(inputHtml) {
  return `<span class="numstep"><button type="button" class="ghost numstep-btn" onclick="App.stepNum(this,-1)">−</button>${inputHtml}<button type="button" class="ghost numstep-btn" onclick="App.stepNum(this,1)">+</button></span>`;
}

/* Core Task Check: roll (|net|+1) d20s, keep highest (net>=0) or lowest (net<0), add score.
   Returns success/critical/fumble info per the book's Advantage/Disadvantage rules.
   The ONE dice mechanic in the game -- the Control check, the Gunner check,
   obstacle checks -- just with a different score/net/TN fed in each time. */
function rollCheck(score, net, tn) {
  const diceCount = Math.abs(net) + 1;
  const dice = Array.from({ length: diceCount }, () => rollD(20));
  const chosen = net >= 0 ? Math.max(...dice) : Math.min(...dice);
  const total = chosen + score;
  const perDie = dice.map(d => d + score);
  const successCount = perDie.filter(t => t >= tn).length;
  const failCount = diceCount - successCount;
  const success = total >= tn;
  const critLevels = net >= 0 ? Math.max(0, successCount - 1) : 0;
  const fumbleLevels = net < 0 ? Math.max(0, failCount - 1) : 0;
  return { dice, chosen, total, tn, success, successCount, failCount, critLevels, fumbleLevels, isCrit: critLevels > 0, isFumble: fumbleLevels > 0, net };
}
// Circus Astralis: each extra success under Advantage (critLevels) is one
// bonus hex of movement on a Control check; each Fumble (fumbleLevels: a
// failed die beyond the first under Disadvantage) rolls the Fumble Chart once.
function outcomeLabel(rc) {
  if (rc.isFumble) return rc.fumbleLevels + " Fumble" + (rc.fumbleLevels === 1 ? "" : "s");
  if (rc.isCrit) return rc.critLevels + " Critical" + (rc.critLevels === 1 ? "" : "s") + " (no bonus)";
  return rc.success ? "Success" : "Failure";
}
function formatMk(score, net) {
  if (!net) return String(score);
  return score + (net > 0 ? "A".repeat(net) : "D".repeat(-net));
}
function netLabel(net) {
  if (!net) return "—";
  // Repeated letters (A/AA/D/DD), matching formatMk()'s on-a-skill notation
  // -- "+1A" read too easily as "+1 AND Advantage" (a numeric bonus on top
  // of Advantage) rather than "1 Level of Advantage". No leading +/- either:
  // the letter itself (A vs D) already says which direction it is.
  return net > 0 ? "A".repeat(net) : "D".repeat(-net);
}
var MAX_ADV = 5; // House rule: the effective Leg Skill caps at AAAAA. Disadvantage has no floor.

/* ============================== State ============================== */
const STORAGE_KEY = "gascar_state_v1";

function defaultState() {
  return { ships: [], shipClasses: [], crewmen: [], courses: [], race: null };
}
let STATE = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const state = Object.assign(defaultState(), JSON.parse(raw));
      migrateState(state);
      return state;
    }
  } catch (e) { console.warn("Could not load saved state", e); }
  return defaultState();
}
/* ONE-TIME migration (see RULE_CHANGES.md 2026-10-03): the Circus Maximus
   conversion replaced the entire Ship Class / 4-crew-position / Resistance /
   straight-Legs-course system with single-entity cars, a Circus-Maximus-style
   gear die, and one Skill Check per Leg -- the old saved shapes don't
   correspond to anything meaningful under the new rules. Same precedent as
   the earlier breaking migrations (_builtinShipClassesRemoved,
   _circularTrackHexed): clear ships/courses/crew/race and start fresh. */
/* Second breaking migration (see RULE_CHANGES.md 2026-10-03): Ship Class and
   Crewman reintroduced. A Ship built under the first Circus Maximus
   conversion carried its six stats directly; it now carries a classId/
   crewmanId instead, which don't correspond to anything -- same clear-and-
   restart precedent as _circusMaximusConversion above. */
function migrateState(state) {
  (state.shipClasses || []).forEach(cls => { if (cls.range === undefined) cls.range = GDATA.STAT_BASE.range; });
  (state.shipClasses || []).forEach(cls => { if (cls.damageControl === undefined) cls.damageControl = GDATA.STAT_BASE.damageControl; });
  // New Engineer skill (see RULE_CHANGES.md 2026-10-08): a Crewman saved
  // before it existed just gets it at the same free baseline as Pilot/Gunner.
  (state.crewmen || []).forEach(c => { if (c.engineer === undefined) c.engineer = GDATA.CREWMAN_BASE; });
  // Asteroids reworked into a course-level choice (see RULE_CHANGES.md
  // 2026-10-09): a course saved before that defaults to none, same as a
  // Racemaster who leaves the field at its default.
  (state.courses || []).forEach(c => { if (c.asteroidCount === undefined) c.asteroidCount = 0; });
  // Base-value change (see RULE_CHANGES.md 2026-10-06): Thrust 3->1, Gunner 5->3,
  // Armor 1->0, and crew Pilot/Gunner 5->0. Each saved stat keeps the levels it was
  // bought with, so the ship keeps its build cost and only its free baseline moves.
  if (!state._statBaseLowered) {
    const OLD_BASE = { thrust: 3, points: 10, control: 5, gunner: 5, armor: 1, range: 1 };
    const OLD_CREW_BASE = 5;
    (state.shipClasses || []).forEach(cls => {
      Object.keys(OLD_BASE).forEach(s => { cls[s] = GDATA.STAT_BASE[s] + Math.max(0, (cls[s] || 0) - OLD_BASE[s]); });
    });
    (state.crewmen || []).forEach(c => {
      c.pilot = GDATA.CREWMAN_BASE + Math.max(0, c.pilot - OLD_CREW_BASE);
      c.gunner = GDATA.CREWMAN_BASE + Math.max(0, c.gunner - OLD_CREW_BASE);
    });
    state.race = null;
    state._statBaseLowered = true;
  }
  // Gunner base raised back up (see RULE_CHANGES.md 2026-10-07): Gunner checks
  // were failing too often with Disadvantage once the base dropped to 3. Each
  // saved Ship Class keeps the levels it was bought with, so only its free
  // baseline moves (and its build cost is unchanged).
  if (!state._gunnerBaseRaised) {
    const OLD_GUNNER_BASE = 3;
    (state.shipClasses || []).forEach(cls => { cls.gunner = GDATA.STAT_BASE.gunner + Math.max(0, (cls.gunner || 0) - OLD_GUNNER_BASE); });
    state.race = null;
    state._gunnerBaseRaised = true;
  }
  if (!state._circusMaximusConversion) {
    state.ships = [];
    state.courses = [];
    state.race = null;
    delete state.crew;
    delete state.shipClasses;
    state._circusMaximusConversion = true;
  }
  if (!state._shipClassCrewmanSplit) {
    state.ships = [];
    state.race = null;
    state.shipClasses = [];
    state.crewmen = [];
    state._shipClassCrewmanSplit = true;
  }
  // Third breaking migration (see RULE_CHANGES.md 2026-10-04): Ship Class
  // stats rebuilt -- Attack renamed Gunner, Damage changed from a flat
  // number to a 1D6 bonus, Control added, and every stat now has a nonzero
  // baseline instead of starting at 0. An old-shape Ship Class's numbers
  // don't correspond to anything under the new baselines/costs, and Ships
  // built from one are invalid along with it -- Crewmen are untouched
  // (Skill-only, unaffected by this change).
  if (!state._shipClassStatsRebuilt) {
    state.ships = [];
    state.shipClasses = [];
    state.race = null;
    state._shipClassStatsRebuilt = true;
  }
  // Fourth breaking migration (see RULE_CHANGES.md 2026-10-05): Circus
  // Astralis crew model and turn structure. Crewmen change from a Skill/XP
  // record to a Pilot/Gunner pair built once from 5 split points, so old
  // crewmen and the Ships pointing at them are cleared. Ship Classes are
  // kept -- their stats didn't change shape.
  if (!state._circusAstralisCrew) {
    state.ships = [];
    state.crewmen = [];
    state.race = null;
    state._circusAstralisCrew = true;
  }
  state.shipClasses = state.shipClasses || [];
  state.crewmen = state.crewmen || [];
  // Self-heal a cached race: a car at 0 HP must be out of the race. Early
  // saves (or HP zeroed on a path that didn't flag it) can leave `out`
  // unset while hp is 0, so the wreck keeps racing. Mark it out here, with
  // an outLeg that isn't the current Leg so it's removed from the cards
  // right away rather than lingering (this is a repair, not a fresh kill).
  if (state.race && Array.isArray(state.race.participants)) {
    const legIdx = state.race.legIndex || 0;
    state.race.participants.forEach(p => {
      if (p.hp != null && p.hp <= 0 && !p.out) { p.out = true; p.outLeg = legIdx - 1; }
    });
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}
function getShip(id) { return STATE.ships.find(s => s.id === id); }
function getShipClass(id) { return STATE.shipClasses.find(c => c.id === id); }
function getCrewman(id) { return STATE.crewmen.find(c => c.id === id); }
function getCourse(id) { return STATE.courses.find(c => c.id === id); }
function shipName(shipId) { const s = getShip(shipId); return s ? s.name : "(deleted ship)"; }
function shipDivision(ship) { const cls = ship && getShipClass(ship.classId); return cls ? cls.division : null; }

/* ============================== Cars: Tier, build points, stats ==============================
   See RULE_CHANGES.md 2026-10-04. Division (Flash/Spark/Comet/Meteor/Nova) is
   FLAVOR ONLY -- it just picks a Tier and which Leg Feature flavor pool to
   draw from (GDATA.DIVISION_TIER/DIVISION_ATMOSPHERIC). Tier drives flavor
   crew size and TN/obstacle-damage scaling; a Ship Class's construction-point
   budget is set directly per Division (GDATA.DIVISION_BUILD_POINTS, see
   RULE_CHANGES.md 2026-10-07), since Flash and Spark share Tier 1 but not a
   budget.

   A car is eight Ship Class stats (Thrust/Points/Control/Gunner/Damage
   Control/Damage/Armor/Range) plus a crewman's Pilot, Gunner, and Engineer
   -- see carStats() below, the one place that reads both and (for NPCs, who
   have neither a Class nor a Crewman) its own inline numbers instead. */
const SHIP_STATS = GDATA.SHIP_STATS;
function carTier(division) { return GDATA.DIVISION_TIER[division] || 1; }
function tierCrewCount(tier) { return (GDATA.TIERS[tier] || GDATA.TIERS[1]).crew; }
// Construction points, set directly per Division -- see RULE_CHANGES.md 2026-10-07.
function divisionBuildPoints(division) { return GDATA.DIVISION_BUILD_POINTS[division] || 10; }
// The uniform construction-point cost progression (see RULE_CHANGES.md
// 2026-10-04): raising a stat one point ABOVE ITS OWN BASELINE costs 1
// construction point, the next point costs 2 more (3 total), the next costs
// 3 more (6 total), and so on. mkCumulativeCost(N) is the total spent to
// reach N levels above baseline (a triangular number); mkStepCost(N) is just
// the cost of the next single step from N levels already spent.
function mkStepCost(fromLevel) { return fromLevel + 1; }
function mkCumulativeCost(level) { return level * (level + 1) / 2; }
// ---------- Ship Class (Shipyard) ----------
// A stat's free baseline -- every Ship Class stat has one (GDATA.STAT_BASE)
// except Damage, whose baseline is the flat die 1D6, not a number; cls.damage
// itself is just the bonus above that die, so its own "baseline" for cost
// purposes is 0.
function shipStatBase(stat) { return stat === "damage" ? 0 : GDATA.STAT_BASE[stat]; }
// How many points above baseline a stat currently sits at -- this (not the
// stat's raw value) is what mkStepCost()/mkCumulativeCost() take as input.
function shipStatLevel(cls, stat) { return Math.max(0, (cls[stat] || 0) - shipStatBase(stat)); }
function classBuildPointsSpent(cls) {
  return SHIP_STATS.reduce((sum, stat) => sum + mkCumulativeCost(shipStatLevel(cls, stat)), 0);
}
function classBuildPointsRemaining(cls) { return divisionBuildPoints(cls.division) - classBuildPointsSpent(cls); }
// A compact budget-compliance note for a Ship Class, shown wherever a Class
// is picked outside the Shipyard (Race Setup, NPC drafting) so an over-budget
// Class doesn't quietly slip into a race: "39/40", or "Illegal 41/40" over budget.
function classBudgetNote(cls) {
  const spent = classBuildPointsSpent(cls), budget = divisionBuildPoints(cls.division);
  return spent > budget ? `Illegal ${spent}/${budget}` : `${spent}/${budget}`;
}
function freshClassStats() {
  const out = {};
  SHIP_STATS.forEach(stat => { out[stat] = shipStatBase(stat); });
  return out;
}
// Damage and Damage Control both display as "1D6" (plus their value, if
// any) rather than a bare number -- every other stat just shows its raw value.
function formatStatValue(cls, stat) {
  if (stat !== "damage" && stat !== "damageControl") return String(cls[stat]);
  const bonus = cls[stat] || 0;
  return `1D${GDATA.DAMAGE_BASE_DIE.d}${bonus ? (bonus < 0 ? "-" + -bonus : "+" + bonus) : ""}`;
}
// ---------- Crewman (Cantina) ----------
// Each crewman starts at Pilot/Gunner/Engineer-0, then divides the split
// points among the three, one point per increase (see GDATA.CREWMAN_SKILLS,
// GDATA.CREWMAN_SPLIT_POINTS).
function freshCrewman(name) {
  const c = { id: uid("crew"), name };
  GDATA.CREWMAN_SKILLS.forEach(s => { c[s] = GDATA.CREWMAN_BASE; });
  return c;
}
function crewmanSplitSpent(crewman) { return GDATA.CREWMAN_SKILLS.reduce((sum, s) => sum + (crewman[s] - GDATA.CREWMAN_BASE), 0); }
function crewmanSplitRemaining(crewman) { return GDATA.CREWMAN_SPLIT_POINTS - crewmanSplitSpent(crewman); }
// ---------- NPCs: auto-built, not hand-spent ----------
// An NPC has no Ship Class/Crewman of its own -- its Division's
// construction-point budget is spent automatically, as evenly as the
// triangular cost curve allows (repeatedly bump whichever of the 6 Ship
// stats has the fewest points spent ABOVE ITS OWN baseline so far), and its
// Skill is left at the same free baseline every Crewman starts at (NPCs
// don't earn or spend XP).
function freshNpcStats(division) {
  let budget = divisionBuildPoints(division);
  const out = freshClassStats();
  const levels = {}; SHIP_STATS.forEach(s => { levels[s] = 0; });
  for (;;) {
    const stat = SHIP_STATS.reduce((lowest, s) => levels[s] < levels[lowest] ? s : lowest, SHIP_STATS[0]);
    const cost = mkStepCost(levels[stat]);
    if (cost > budget) break;
    levels[stat] += 1;
    out[stat] += 1;
    budget -= cost;
  }
  out.crewPilot = GDATA.CREWMAN_BASE;
  out.crewGunner = GDATA.CREWMAN_BASE;
  out.crewEngineer = GDATA.CREWMAN_BASE;
  return out;
}
// Sponsor (see RULE_CHANGES.md 2026-10-05, amounts updated 2026-10-07): up to
// 2 bonus points spread over up to 2 stats, plus a -2 penalty on one stat.
// Bonuses/penalty are applied on top of the Ship Class's own stats; a
// non-Damage stat can't drop below 0.
const SPONSOR_BONUS_MAX = 2;
const SPONSOR_PENALTY_MAX = 2;
// Normalized sponsor record: bonus and penalty are per-stat point counts.
// Older saves stored the penalty as a single stat name; that reads as empty.
function sponsorOf(ship) {
  const s = (ship && ship.sponsor) || {};
  return { bonus: s.bonus || {}, penalty: (s.penalty && typeof s.penalty === "object") ? s.penalty : {} };
}
function sponsorBonusTotal(sponsor) { return Object.values(sponsor.bonus || {}).reduce((a, b) => a + (b || 0), 0); }
function sponsorPenaltyTotal(sponsor) { return Object.values(sponsor.penalty || {}).reduce((a, b) => a + (b || 0), 0); }
// Every stat a participant (Hero ship OR NPC) fights with this race --
// unifies the two shapes (a Hero's Ship Class stats live on its Ship's Class
// plus any sponsor adjustment, its Pilot/Gunner/Engineer on its assigned
// Crewman; an NPC carries them inline, see startRace()) so the rest of the engine never has to branch
// on p.type to read a stat.
function carStats(p) {
  const out = {};
  if (p.type === "hero") {
    const ship = getShip(p.shipId);
    const cls = ship && getShipClass(ship.classId);
    const sponsor = sponsorOf(ship);
    SHIP_STATS.forEach(stat => {
      const base = (cls && cls[stat]) || 0;
      const adj = (sponsor.bonus[stat] || 0) - (sponsor.penalty[stat] || 0);
      const v = base + adj;
      out[stat] = stat === "damage" || stat === "damageControl" ? v : Math.max(stat === "range" ? 1 : 0, v);
    });
    const crewman = ship && getCrewman(ship.crewmanId);
    out.crewPilot = crewman ? crewman.pilot : 0;
    out.crewGunner = crewman ? crewman.gunner : 0;
    out.crewEngineer = crewman ? crewman.engineer : 0;
    return out;
  }
  SHIP_STATS.concat(["crewPilot", "crewGunner", "crewEngineer"]).forEach(stat => { out[stat] = p[stat] || 0; });
  return out;
}
// A participant's Division -- lives on its Ship's Class for a Hero, inline
// for an NPC (see startRace()). Needed anywhere Tier has to be looked up for
// a participant directly (e.g. a Maneuver's Tier-scaled self-cost).
function carDivision(p) {
  if (p.type === "hero") {
    const ship = getShip(p.shipId);
    const cls = ship && getShipClass(ship.classId);
    return cls ? cls.division : "Comet";
  }
  return p.division;
}

/* ============================== Hex-grid Circular Track geometry ==============================
   Unchanged from before the Circus Maximus conversion (see RULE_CHANGES.md
   2026-08-24) -- the proven, tested engine for the one track type the app
   now exclusively uses. A real pointy-top axial hex grid: lane N is a hex
   ring at ring-level (innerRing+N) around a shared center -- see
   traceLaneRing() -- with the two straight sides elongated by a fixed
   straightLen so every lane shares the exact same straight length and only
   the curved end-caps grow. Because every lane's ring shares the same
   center and elongation, adjacent rings are ALWAYS perfectly nested by
   construction (standard hex-ring math). Traces each lane COUNTERCLOCKWISE
   starting top-right: left along the top straight, down the left cap,
   right along the bottom straight, up the right cap, back to start. */
// 6 neighbor directions for pointy-top axial hexes, fixed rotational order.
const HEX_DIRS = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
];
// Every lane's hex count for a course spec (used by the Racecourse builder's
// live preview) -- not a chosen number, an exact property of hex-ring math.
function laneHexesArray(course) {
  const { innerRing, straightLen } = hexRingParamsForCourse(course);
  return Array.from({ length: course.lanes || 6 }, (_, i) => 6 * (innerRing + i) + 2 * straightLen);
}
// Derives (innerRing, straightLen) from the course's configurable
// "innerHexes" target -- solves innerHexes ~= 6*innerRing + 2*straightLen
// with straightLen held at 2x innerRing (a track-SHAPE choice, every hex is
// always the exact same regular size regardless of this ratio).
function hexRingParamsForCourse(course) {
  const target = course.innerHexes || 50;
  const innerRing = Math.max(1, Math.round(target / 10));
  const straightLen = 2 * innerRing;
  return { innerRing, straightLen };
}
// Staggered start: each lane out starts this many hexes further ahead than
// the one inside it -- a fixed offset. Shared by startRace() (actual
// gameplay hexPos) and the standings SVG (drawing each lane's own starting
// mark at that same hex).
var STAGGER_PER_LANE = 1;
function laneStartHexPos(laneIdx0) { return laneIdx0 * STAGGER_PER_LANE; }
function hexKey(q, r) { return q + "," + r; }
function hexAdd(h, dir, n) { return { q: h.q + dir.dq * n, r: h.r + dir.dr * n }; }
// Direction order [W,SW,SE,E,NE,NW] (not the "textbook" ring-trace order
// [E,NE,NW,W,SW,SE]) so the walk starts top-right and goes counterclockwise,
// matching this app's existing convention. The W and E legs (indices 3 and
// 0) are the two constant-r directions -- straightaways, elongated by a
// fixed `straightLen` extra hexes on top of `k` (NOT held to a plain
// constant -- see hexStepAdvance()'s own comment below for why that
// seemingly-cleaner alternative actually breaks ring nesting between
// adjacent lanes).
const HEX_RING_ORDER = [3, 4, 5, 0, 1, 2];
function traceLaneRing(k, straightLen) {
  const legLen = dirIdx => (dirIdx === 0 || dirIdx === 3) ? k + straightLen : k;
  let cur = hexAdd({ q: 0, r: 0 }, HEX_DIRS[1], k);
  const hexes = [];
  for (const dirIdx of HEX_RING_ORDER) {
    const isStraight = dirIdx === 0 || dirIdx === 3;
    for (let step = 0; step < legLen(dirIdx); step++) {
      hexes.push({ q: cur.q, r: cur.r, isStraight });
      cur = hexAdd(cur, HEX_DIRS[dirIdx], 1);
    }
  }
  return hexes; // ordered; index = hexPos
}
// Pointy-top axial -> pixel, relative to the track's own (cx,cy) and
// hexSize (center-to-vertex distance).
function hexToPixel(geom, q, r) {
  return { x: geom.cx + geom.hexSize * Math.sqrt(3) * (q + r / 2), y: geom.cy + geom.hexSize * 1.5 * r };
}
// The 6 corner points of a pointy-top hex of the given size, centered at (cx,cy).
function hexCorners(size, cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}
// The two corner points of the hex edge a ship crosses moving from `hex`
// toward `nextHex` -- i.e. that hex's own "front" edge/spine in the
// direction of travel. Each of the 6 HEX_DIRS faces exactly one edge; this
// pairing is fixed by hexCorners()'s own corner angle scheme.
const HEX_EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]]; // indexed by HEX_DIRS
function hexFrontEdge(geom, hex, nextHex) {
  const dq = nextHex.q - hex.q, dr = nextHex.r - hex.r;
  const dirIdx = HEX_DIRS.findIndex(d => d.dq === dq && d.dr === dr);
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  const corners = hexCorners(geom.hexSize * 0.96, x, y);
  const [a, b] = HEX_EDGE_CORNERS[dirIdx >= 0 ? dirIdx : 0];
  return [corners[a], corners[b]];
}
// Shortest wraparound distance between two hexPos values around a lane of
// `circ` hexes (a lap loops back to 0, so the last hex and hex 0 are
// themselves adjacent).
function circularHexDist(a, b, circ) {
  const d = Math.abs(a - b) % circ;
  return Math.min(d, circ - d);
}
// Cube-coordinate hex distance -- the number of hex steps between any two
// hexes, straight-line, regardless of lane.
function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
// An attack targets a car within the attacker's Range in hexes (same lane or a
// nearby one), wrapping a lap in
// the same lane. A different lane's position is compared via real hex
// distance (cube coordinates).
function hexesWithinManeuverRange(geom, pA, pB, range) {
  const laneA = (pA.lane || 1) - 1, laneB = (pB.lane || 1) - 1;
  if (Math.abs(laneA - laneB) > range) return false;
  if (laneA === laneB) {
    const circA = geom.laneHexLists[laneA].length || 1;
    return circularHexDist(pA.hexPos || 0, pB.hexPos || 0, circA) <= range;
  }
  const hexA = geom.laneHexLists[laneA][(pA.hexPos || 0) % geom.laneHexLists[laneA].length];
  const hexB = geom.laneHexLists[laneB][(pB.hexPos || 0) % geom.laneHexLists[laneB].length];
  return hexDistance(hexA, hexB) <= range;
}
// A hex's structural position expressed as (completed legs) + (fraction
// through the current leg) -- used to sanity-check candidate Slip neighbors
// and to SCORE real progress for the Slip longest-path DP (see
// hexStepAdvance()). Since every leg (straight or curve) grows by exactly
// +1 hex per lane step, this value's expected change for "the same real
// structural position" one lane over is tiny (well under 1) everywhere
// except at the ring's own seam, which circTrackGeometry()'s slipNeighbors
// filter excludes as a Slip target.
function hexLegOffset(innerRing, straightLen, laneIdx0, hexPos) {
  const S = straightLen, k = innerRing + laneIdx0;
  const legLens = [k + S, k, k, k + S, k, k];
  let n = hexPos, base = 0;
  for (let leg = 0; leg < 6; leg++) {
    const len = legLens[leg];
    if (n < len) return base + n / len;
    n -= len;
    base += 1;
  }
  return base;
}
function circTrackGeometry(course) {
  const { innerRing, straightLen } = hexRingParamsForCourse(course);
  const lanes = course.lanes || 6;
  const laneHexLists = [];
  const lookup = new Map();
  for (let lane = 0; lane < lanes; lane++) {
    const ring = traceLaneRing(innerRing + lane, straightLen);
    laneHexLists.push(ring);
    ring.forEach((h, idx) => lookup.set(hexKey(h.q, h.r), { lane, index: idx }));
  }
  const slipNeighbors = laneHexLists.map(ring => ring.map(() => ({ outward: [], inward: [] })));
  for (let lane = 0; lane < lanes; lane++) {
    laneHexLists[lane].forEach((h, idx) => {
      const sn = slipNeighbors[lane][idx];
      const fromOffset = hexLegOffset(innerRing, straightLen, lane, idx);
      for (const dir of HEX_DIRS) {
        const hit = lookup.get(hexKey(h.q + dir.dq, h.r + dir.dr));
        if (!hit) continue;
        if (hit.lane !== lane + 1 && hit.lane !== lane - 1) continue;
        // Exclude the ring's own seam artifact (see RULE_CHANGES.md) -- a
        // real corner candidate's offset never drifts more than a fraction
        // of 1; this artifact drifts by nearly a full 6-leg lap.
        const toOffset = hexLegOffset(innerRing, straightLen, hit.lane, hit.index);
        if (Math.abs(toOffset - fromOffset) > 1.5) continue;
        if (hit.lane === lane + 1) sn.outward.push(hit.index);
        else sn.inward.push(hit.index);
      }
    });
  }
  const hexSize = 16;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  laneHexLists.forEach(ring => ring.forEach(h => {
    const x = hexSize * Math.sqrt(3) * (h.q + h.r / 2), y = hexSize * 1.5 * h.r;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  const margin = hexSize + 10;
  const vbW = (maxX - minX) + 2 * margin, vbH = (maxY - minY) + 2 * margin;
  const cx = margin - minX, cy = margin - minY;
  return { lanes, innerRing, straightLen, laneHexLists, lookup, slipNeighbors, hexSize, cx, cy, vbW, vbH, iconSize: hexSize * 1.3 };
}
// Whether hex `hexPos` in lane laneIdx0 is a straight-section hex or a
// curved-cap hex -- tagged once at construction time (traceLaneRing()).
function isHexOnStraight(geom, laneIdx0, hexPos) {
  return geom.laneHexLists[laneIdx0][hexPos].isStraight;
}
// One atomic unit of ordinary forward movement, staying in the same lane --
// used by resolveSlipPath() below.
function stepForward(geom, laneIdx0, hexPos) {
  const circ = geom.laneHexLists[laneIdx0].length;
  const lapGained = hexPos + 1 >= circ ? 1 : 0;
  return { laneIdx0, hexPos: (hexPos + 1) % circ, lapGained };
}
// Real forward advance contributed by ONE atomic step -- scored as the
// change in hexLegOffset() between the two hexes, the same structural
// measure used to filter slipNeighbors.
function hexStepAdvance(geom, fromLaneIdx0, fromHexPos, toLaneIdx0, toHexPos) {
  return hexLegOffset(geom.innerRing, geom.straightLen, toLaneIdx0, toHexPos) -
    hexLegOffset(geom.innerRing, geom.straightLen, fromLaneIdx0, fromHexPos);
}
// A Slip's hexes are interleaved with ordinary forward movement to actually
// maximize the ship's real progress around the track this Leg -- a
// longest-path DP keyed by (k, laneIdx0, hexPos), not a greedy lookahead.
function resolveSlipPath(geom, originLaneIdx0, originHexPos, movement, slipHexes, dir) {
  const maxLaneIdx0 = geom.laneHexLists.length - 1;
  let states = new Array(slipHexes + 1).fill(null).map(() => new Map());
  states[0].set(originLaneIdx0 + "," + originHexPos, { laneIdx0: originLaneIdx0, hexPos: originHexPos, dist: 0, lapsGained: 0, prev: null, step: null });
  for (let i = 0; i < movement; i++) {
    const next = new Array(slipHexes + 1).fill(null).map(() => new Map());
    for (let k = 0; k <= Math.min(i, slipHexes); k++) {
      states[k].forEach(st => {
        const fwd = stepForward(geom, st.laneIdx0, st.hexPos);
        const fwdDist = st.dist + hexStepAdvance(geom, st.laneIdx0, st.hexPos, fwd.laneIdx0, st.hexPos + 1);
        const fwdKey = fwd.laneIdx0 + "," + fwd.hexPos;
        const existingFwd = next[k].get(fwdKey);
        if (!existingFwd || fwdDist > existingFwd.dist) {
          next[k].set(fwdKey, { laneIdx0: fwd.laneIdx0, hexPos: fwd.hexPos, dist: fwdDist, lapsGained: st.lapsGained + fwd.lapGained, prev: st, step: { laneIdx0: fwd.laneIdx0, hexPos: fwd.hexPos, isSlip: false } });
        }
        if (k < slipHexes && st.laneIdx0 + dir >= 0 && st.laneIdx0 + dir <= maxLaneIdx0) {
          const sn = geom.slipNeighbors[st.laneIdx0][st.hexPos];
          const candidates = dir > 0 ? sn.outward : sn.inward;
          const circHere = geom.laneHexLists[st.laneIdx0].length;
          const lapGained = st.hexPos + 1 >= circHere ? 1 : 0;
          const diagLaneIdx0 = st.laneIdx0 + dir;
          candidates.forEach(candHexPos => {
            const diagDist = st.dist + hexStepAdvance(geom, st.laneIdx0, st.hexPos, diagLaneIdx0, candHexPos);
            const diagKey = diagLaneIdx0 + "," + candHexPos;
            const existingDiag = next[k + 1].get(diagKey);
            if (!existingDiag || diagDist > existingDiag.dist) {
              next[k + 1].set(diagKey, { laneIdx0: diagLaneIdx0, hexPos: candHexPos, dist: diagDist, lapsGained: st.lapsGained + lapGained, prev: st, step: { laneIdx0: diagLaneIdx0, hexPos: candHexPos, isSlip: true } });
            }
          });
        }
      });
    }
    states = next;
  }
  let k = slipHexes;
  while (k > 0 && states[k].size === 0) k--;
  let final = null;
  states[k].forEach(st => { if (!final || st.dist > final.dist) final = st; });
  const steps = [];
  for (let cur = final; cur && cur.step; cur = cur.prev) steps.push(cur.step);
  steps.reverse();
  return { steps, finalLaneIdx0: final.laneIdx0, finalHexPos: final.hexPos, lapsGained: final.lapsGained };
}
// Every intermediate hex a racer's <g> should visit while animating through
// each of its Legs (see App.playRaceReplay()) -- walking hex by hex instead
// of one straight-line transition, since a straight chord cuts across a
// curve instead of following the track.
function buildCircularLegWaypoints(p, geom) {
  const h = p.history || [];
  const perLeg = [];
  let fromLane = p.startLane || 1, fromHexPos = p.startHexPos || 0;
  for (let L = 0; L < h.length; L++) {
    const rec = h[L];
    if (rec.path) {
      perLeg.push(rec.path.map(w => ({ lane: w.lane, hexPos: w.hexPos })));
      fromLane = rec.lane; fromHexPos = rec.hexPos;
      continue;
    }
    const toLane = rec.lane, movement = rec.movement || 0;
    const dir = toLane >= fromLane ? 1 : -1;
    const path = resolveSlipPath(geom, fromLane - 1, fromHexPos, movement, rec.slipHexes || 0, dir);
    const waypoints = path.steps.map(s => ({ lane: s.laneIdx0 + 1, hexPos: s.hexPos }));
    if (!waypoints.length) waypoints.push({ lane: toLane, hexPos: rec.hexPos });
    const last = waypoints[waypoints.length - 1];
    if (last.lane !== toLane || last.hexPos !== rec.hexPos) waypoints[waypoints.length - 1] = { lane: toLane, hexPos: rec.hexPos };
    perLeg.push(waypoints);
    fromLane = toLane; fromHexPos = rec.hexPos;
  }
  return perLeg;
}
// One racer's placement on the track for a given (lane, hexPos) snapshot.
function circRacerTransform(geom, p, prevRotDeg) {
  const laneIdx0 = Math.min(Math.max((p.lane || 1) - 1, 0), geom.laneHexLists.length - 1);
  const ring = geom.laneHexLists[laneIdx0];
  const hexPos = ((p.hexPos || 0) % ring.length + ring.length) % ring.length;
  const hex = ring[hexPos];
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  const next = ring[(hexPos + 1) % ring.length];
  const nextPt = hexToPixel(geom, next.q, next.r);
  let rotDeg = Math.atan2(nextPt.y - y, nextPt.x - x) * 180 / Math.PI + 90;
  if (prevRotDeg != null) rotDeg += Math.round((prevRotDeg - rotDeg) / 360) * 360;
  return { laneIdx0, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rotDeg.toFixed(1)})` };
}
// An asteroid's placement -- translate only, no facing rotation (it spins on
// its own via CSS, independent of its position).
function asteroidTransform(geom, lane, hexPos) {
  const laneIdx0 = Math.min(Math.max(lane - 1, 0), geom.laneHexLists.length - 1);
  const ring = geom.laneHexLists[laneIdx0];
  const hex = ring[((hexPos % ring.length) + ring.length) % ring.length];
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  return `translate(${x.toFixed(1)},${y.toFixed(1)})`;
}
// Replays this Leg's asteroid drift (and any ship it shoved) right after the
// board renders at its already-computed final positions (see
// RULE_CHANGES.md 2026-10-09): each moved element is walked back to where it
// started, then stepped forward hex by hex, purely a visual flourish -- the
// actual positions/damage were already applied in driftAsteroids(). Consumes
// race._legStartEvents.
function playLegStartAnimation(race) {
  const events = race._legStartEvents || [];
  race._legStartEvents = [];
  if (!events.length) return;
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const hexStepDelay = 200;
  events.forEach(ev => {
    const el = document.getElementById(ev.kind === "asteroid" ? `asteroid-${ev.id}` : `circracer-${ev.id}`);
    if (!el) return;
    const steps = [ev.from, ...ev.path];
    let i = 0, prevRotDeg = null;
    function tick() {
      if (STATE.race !== race) return;
      if (ev.kind === "asteroid") el.setAttribute("transform", asteroidTransform(geom, steps[i].lane, steps[i].hexPos));
      else {
        const m = /rotate\(([-\d.]+)\)/.exec(el.getAttribute("transform") || "");
        if (m) prevRotDeg = parseFloat(m[1]);
        el.setAttribute("transform", circRacerTransform(geom, steps[i], prevRotDeg).transform);
      }
      i++;
      if (i < steps.length) setTimeout(tick, hexStepDelay);
    }
    tick();
  });
}
function renderCircularTrackSvg(race, course) {
  const geom = circTrackGeometry(course);
  const { vbW, vbH, iconSize } = geom;
  const rotatedBox = `${((vbW - vbH) / 2).toFixed(1)} ${((vbH - vbW) / 2).toFixed(1)} ${vbH.toFixed(1)} ${vbW.toFixed(1)}`;
  let svg = `<svg viewBox="${rotatedBox}" class="circtrack" role="img" aria-label="Circular track standings"><g class="trackrot" transform="rotate(90 ${(vbW / 2).toFixed(1)} ${(vbH / 2).toFixed(1)})">`;
  geom.laneHexLists.forEach((ring, lane) => {
    ring.forEach((hex, hexPos) => {
      const { x, y } = hexToPixel(geom, hex.q, hex.r);
      const pts = hexCorners(geom.hexSize * 0.96, x, y).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      svg += `<polygon class="circcell${hex.isStraight ? "" : " curve"}" id="circcell-${lane}-${hexPos}" points="${pts}"/>`;
    });
  });
  geom.laneHexLists.forEach((ring, laneIdx0) => {
    const hexPos = Math.min(laneStartHexPos(laneIdx0), ring.length - 1);
    const hex = ring[hexPos];
    const next = ring[(hexPos + 1) % ring.length];
    const [p1, p2] = hexFrontEdge(geom, hex, next);
    svg += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" class="circfinish"/>`;
  });
  // Asteroids: rock shapes (no ring, unlike wrecks), spinning in place.
  // Positioned via a transform (not baked into the facet points) so the
  // Leg-start animation can retarget it, the same way a racer's <g> moves.
  (race.asteroids || []).forEach(a => {
    // Scaled well inside the hex's own inscribed circle so it never pokes
    // past the hex edge at any point in its continuous spin.
    const rock = asteroidFacets(a.design, 0, 0, geom.hexSize / 18);
    svg += `<g class="asteroid" id="asteroid-${a.id}" transform="${asteroidTransform(geom, a.lane, a.hexPos)}">
      <g class="asteroid-rock" style="animation-duration:${a.spinDur.toFixed(2)}s;animation-direction:${a.spinDir}">${rock}</g>
    </g>`;
  });
  const turnOf = p => race.legState && race.legState.cars[p.id] ? race.legState.cars[p.id].turn : null;
  // Highlighted in green only while the Take Turn button is showing (no turn
  // started yet) -- not once it's walking the move or waiting on an attack.
  const readyHero = nextTurnParticipant(race);
  race.participants.forEach(p => {
    const t = turnOf(p);
    if (!t) return;
    t.left.forEach(h => {
      const hex = geom.laneHexLists[h.laneIdx0][h.hexPos];
      const { x, y } = hexToPixel(geom, hex.q, hex.r);
      svg += `<circle class="turndot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(geom.hexSize * 0.16).toFixed(1)}"/>`;
    });
  });
  race.participants.forEach(p => {
    const t = turnOf(p);
    const at = t ? { lane: t.cur.laneIdx0 + 1, hexPos: t.cur.hexPos } : p;
    const { laneIdx0, transform } = circRacerTransform(geom, at);
    const iconInfo = participantIconInfo(p);
    const imgHref = iconInfo ? esc(shipIconPath(iconInfo.division, iconInfo.number, iconInfo.color)) : "";
    const isReady = p.type === "hero" && readyHero && p.id === readyHero.id && !t;
    svg += `<g class="circracer${p.out ? " dead" : ""}${isReady ? " active-turn" : ""}" id="circracer-${p.id}" data-racer="${p.id}" transform="${transform}">
      ${isReady ? `<circle r="${(iconSize / 2 * 1.3).toFixed(1)}" class="circracer-ring"/>` : ""}
      ${p.out ? `<circle r="${(iconSize / 2 * 1.3).toFixed(1)}" class="circracer-ring wreck-ring"/>` : ""}
      ${imgHref
        ? `<image href="${imgHref}" x="${(-iconSize / 2).toFixed(1)}" y="${(-iconSize / 2).toFixed(1)}" width="${iconSize.toFixed(1)}" height="${iconSize.toFixed(1)}"/>`
        : `<circle r="${(iconSize / 2).toFixed(1)}" class="circdot"/>`}
    </g>`;
  });
  race.participants.forEach(p => {
    const t = turnOf(p);
    if (!t || !t.choice) return;
    t.choice.options.forEach(o => {
      const hex = geom.laneHexLists[o.dest.laneIdx0][o.dest.hexPos];
      const { x, y } = hexToPixel(geom, hex.q, hex.r);
      const pts = hexCorners(geom.hexSize * 0.96, x, y).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      const occ = occupantAt(race, o.dest.laneIdx0 + 1, o.dest.hexPos, p.id);
      svg += `<polygon class="circstep" points="${pts}"${occ ? ` data-racer="${occ.id}"` : ""} onclick="App.encounterChoice('${p.id}','${o.id}')">${occ ? "" : `<title>${esc(o.label)}</title>`}</polygon>`;
    });
  });
  race.participants.forEach(p => {
    const t = turnOf(p);
    if (!t || !t.awaiting) return;
    t.awaiting.forEach(id => {
      const target = race.participants.find(x => x.id === id);
      if (!target) return;
      const hex = geom.laneHexLists[target.lane - 1][target.hexPos];
      const { x, y } = hexToPixel(geom, hex.q, hex.r);
      const pts = hexCorners(geom.hexSize * 0.96, x, y).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      svg += `<polygon class="circattack" points="${pts}" data-racer="${target.id}" onclick="App.decideAttack('${p.id}','${target.id}')"></polygon>`;
    });
  });
  svg += `</g></svg>`;
  return svg;
}
// The hover card for a racer on the track: a broadcast-style lower third.
function racerTipHtml(race, p) {
  const course = getCourse(race.courseId);
  const ringParams = hexRingParamsForCourse(course);
  const ordered = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  const pos = ordered.indexOf(p) + 1;
  const info = participantIconInfo(p);
  const img = info ? esc(shipIconPath(info.division, info.number, info.color)) : "";
  const label = p.type === "hero" ? shipName(p.shipId) : p.name;
  const maxHp = p.maxHp != null ? p.maxHp : 0, hp = p.hp != null ? p.hp : maxHp;
  const pct = maxHp ? Math.max(0, Math.min(100, Math.round(hp / maxHp * 100))) : 0;
  const car = race.legState && race.legState.cars[p.id];
  const pending = car ? car.pendingD : 0;
  const sub = p.type === "npc" ? `NPC · Aggression ${p.aggression || 5}` : "Your ship";
  const cs = carStats(p);
  const hero = p.type === "hero" ? getShip(p.shipId) : null;
  const crewman = hero ? STATE.crewmen.find(c => c.id === hero.crewmanId) : null;
  const crewName = p.type === "npc" ? "NPC" : crewman ? crewman.name : "None";
  const tipStats = [["Range", cs.range], ["Thrust", cs.thrust], ["Hit Points", cs.points], ["Control", `${cs.control}/${cs.crewPilot}`], ["Gunner", `${cs.gunner}/${cs.crewGunner}`], ["Damage Control", `${cs.damageControl}/${cs.crewEngineer}`], ["Damage", cs.damage], ["Armor", cs.armor]];
  return `<div class="tvtip">
    <div class="tvtip-stripe"><span class="tvtip-pos">P${pos}</span>${info ? `<span class="tvtip-num">${esc(info.number)}</span>` : ""}</div>
    <div class="tvtip-body">
      ${img ? `<img class="tvtip-img" src="${img}" alt="">` : ""}
      <div class="tvtip-name">${esc(label)}</div>
      <div class="tvtip-sub">${esc(sub)}${p.out ? " · OUT" : ""}</div>
      <div class="tvtip-crew">Crew: ${esc(crewName)}</div>
      <div class="tvtip-lap"><div><small>Lap</small>${Math.min(p.laps || 0, course.laps)}/${course.laps}</div><div><small>Lane</small>${p.lane}</div><div><small>Gear</small>${p.gear || 0}</div></div>
      <div class="tvtip-hp"><div class="tvtip-hpbar"><div style="width:${pct}%"></div></div><span>HP ${hp}/${maxHp}</span></div>
      <div class="tvtip-stats">${tipStats.map(([k, v]) => `<div><small>${k}</small>${v}</div>`).join("")}</div>
      ${pending > 0 ? `<div class="tvtip-hit">HIT · ${pending} Disadvantage</div>` : ""}
    </div>
  </div>`;
}
function initTrackTip() {
  const tip = document.createElement("div");
  tip.id = "trackTip";
  document.body.appendChild(tip);
  const place = e => {
    const pad = 18, w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(e.clientX + pad, window.innerWidth - w - 8);
    const y = Math.min(e.clientY + pad, window.innerHeight - h - 8);
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  };
  document.addEventListener("mouseover", e => {
    const el = e.target.closest && e.target.closest("[data-racer]");
    const race = STATE.race;
    const p = el && race ? race.participants.find(x => x.id === el.dataset.racer) : null;
    if (!p) { tip.style.display = "none"; return; }
    tip.innerHTML = racerTipHtml(race, p);
    tip.style.display = "block";
    place(e);
  });
  document.addEventListener("mousemove", e => { if (tip.style.display === "block") place(e); });
  document.addEventListener("mouseout", e => {
    const el = e.target.closest && e.target.closest("[data-racer]");
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) tip.style.display = "none";
  });
}
document.addEventListener("DOMContentLoaded", initTrackTip);
// Real track position: laps completed plus a lane-length-normalized
// fraction through the current lap -- NOT raw cumulative Movement, which
// can diverge from where a car actually sits once lane length, free Slip
// lane changes, and Slingshot bonus Movement are in the mix. One full lap =
// 6 (the hex ring's 6 legs). Shared by standingsPositions() (NPC Leg
// Aggression) and renderStandings() (the board's ordering and bar length).
function trackProgress(p, ringParams) {
  return (p.laps || 0) * 6 + hexLegOffset(ringParams.innerRing, ringParams.straightLen, (p.lane || 1) - 1, p.hexPos || 0);
}
// Standings position among still-active (not destroyed) racers, 1 =
// leading, used to compute each NPC's Leg Aggression. Exact ties are broken
// randomly -- each tied racer gets its own distinct position.
function standingsPositions(race, course) {
  const active = race.participants.filter(p => !p.out);
  const ringParams = hexRingParamsForCourse(course);
  const shuffled = [...active].sort(() => Math.random() - 0.5);
  shuffled.sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  const positions = {};
  shuffled.forEach((p, i) => { positions[p.id] = i + 1; });
  return positions;
}
// An NPC's own Aggression (1-10, public, set at Race Setup) plus its
// current standings position - 1 -- a car further back is more willing to
// gamble, regardless of its base personality.
function legAggressionFor(p, positions) {
  return (p.aggression || 5) + ((positions[p.id] || 1) - 1);
}
// Chance a Control Task Check (score + net A/D vs tn) succeeds -- the exact
// dice-pool math rollCheck() itself uses, computed up front instead of
// rolled, so NPC pathing can weigh a gamble against a guaranteed detour (see
// RULE_CHANGES.md 2026-10-10). `need` is the die result required; with
// Advantage (net >= 0) the check keeps the BEST of (net+1) d20s, with
// Disadvantage the WORST of (|net|+1).
function controlCheckSuccessChance(score, net, tn) {
  const need = tn - score;
  if (need <= 1) return 1;
  if (need >= 21) return 0;
  const perDie = (21 - need) / 20;
  const dice = Math.abs(net) + 1;
  return net >= 0 ? 1 - Math.pow(1 - perDie, dice) : Math.pow(perDie, dice);
}
// Whether (and whom) an NPC hunts this Leg instead of just taking its free
// inward lane shift (see RULE_CHANGES.md 2026-10-10). Needs both a reckless
// personality AND a comfortable lead -- unlike Leg Aggression (which rises
// the further BACK a car is), hunting runs backwards: a trailing car is too
// busy closing the race gap itself to spare a detour, so HuntScore blends
// Aggression with how far toward the front this car is, and a cautious
// leader still won't bother without the Aggression to match.
function npcHuntTarget(race, p, positions) {
  const active = race.participants.filter(x => !x.out);
  if (active.length < 2) return null;
  const leadFactor = (active.length - positions[p.id]) / (active.length - 1);
  const huntScore = Math.round((p.aggression || 5) * leadFactor);
  if (rollD(10) > huntScore) return null;
  // Target: the nearest rival ahead of it in the standings -- the one
  // actually blocking its way forward.
  const ahead = race.participants
    .filter(x => x.id !== p.id && !x.out && positions[x.id] < positions[p.id])
    .sort((a, b) => positions[b.id] - positions[a.id]);
  return ahead[0] || null;
}

/* ============================== Icons ============================== */
function shipIconPath(division, number, color) { return `${GDATA.SHIP_ICON_DIR}${division} ${number} ${color}.png`; }
// A Ship's icon is its Class's White number recolored -- resolves through
// the Class, since the Ship record itself only stores the color. Returns
// null (not a path) if the Class or color isn't picked yet.
function shipIconInfo(ship) {
  const cls = ship && getShipClass(ship.classId);
  if (!cls || !cls.icon || !ship.iconColor) return null;
  return { division: cls.division, number: cls.icon, color: ship.iconColor };
}
// A race participant's icon -- a Hero's resolves through its Ship/Class
// (see shipIconInfo()); an NPC carries its own random pick inline (see
// startRace()). Used by the Standings board and the Circular Track SVG so
// Heroes and NPCs both render correctly, not just NPCs.
function participantIconInfo(p) {
  if (p.type === "hero") return shipIconInfo(getShip(p.shipId));
  if (!p.iconColor || !p.iconNumber) return null;
  return { division: p.iconDivision, number: p.iconNumber, color: p.iconColor };
}
function participantIconPath(p) {
  const info = participantIconInfo(p);
  return info ? shipIconPath(info.division, info.number, info.color) : "";
}
// Thumbnail <img> for a Ship Class (always its own White icon), a Ship (its
// Class's number in the Ship's own color), or a race participant (Hero or
// NPC, via participantIconInfo()) -- dispatches on shape, not on an explicit
// kind flag, matching this file's existing obj.type-sniffing style.
function iconThumbImg(obj, title) {
  if (!obj) return "";
  let info;
  if (obj.classId !== undefined) info = shipIconInfo(obj); // a Ship
  else if (obj.icon !== undefined && obj.division !== undefined) info = obj.icon ? { division: obj.division, number: obj.icon, color: GDATA.SHIP_CLASS_ICON_COLOR } : null; // a Ship Class
  else info = participantIconInfo(obj); // a race participant (Hero or NPC)
  if (!info) return "";
  return `<img class="iconthumb" src="${esc(shipIconPath(info.division, info.number, info.color))}" title="${esc(title || `${info.division} ${info.color} ${info.number}`)}">`;
}
// Picks a uniformly random (color, number) not already in usedKeys (a Set of
// "Color|Number" strings) -- used to give an NPC racer a random, distinct
// icon at race start. Returns null if all 45 are taken.
// An NPC's stats are a copy of one of the player's ships in the course's
// Division, chosen at random (with one ship, every NPC matches it). Falls back
// to an auto-built car when no ship exists for that Division yet.
function npcStatsFromDivision(division) {
  const pool = STATE.ships.filter(s => shipDivision(s) === division);
  if (!pool.length) return freshNpcStats(division);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { ...carStats({ type: "hero", shipId: pick.id }) };
}
// An NPC drafted from a specific Ship Class (Race Setup's NPC Class picker):
// the Class's own stats directly, no sponsor adjustment, Pilot/Gunner at the
// crew baseline (an NPC has no assigned crewman).
function npcStatsFromClass(cls) {
  const out = {};
  SHIP_STATS.forEach(s => { out[s] = cls[s] || 0; });
  out.crewPilot = GDATA.CREWMAN_BASE;
  out.crewGunner = GDATA.CREWMAN_BASE;
  out.crewEngineer = GDATA.CREWMAN_BASE;
  return out;
}
// An NPC icon no class or ship in the Division uses, and no other racer in
// this race has. Class numbers are preferred to be left alone, since every
// ship built from a class shares its number.
function pickNpcIcon(division, raceUsed) {
  const divKeys = usedShipIconKeys(null);
  const classNums = usedClassIconNumbers(null, division);
  const free = (c, n, skipClassNums) => !divKeys.has(`${division}|${c}|${n}`) && (skipClassNums || !classNums.has(n)) && !raceUsed.has(`${c}|${n}`);
  for (const skip of [false, true]) {
    const options = [];
    GDATA.SHIP_ICON_COLORS.forEach(c => GDATA.SHIP_ICON_NUMBERS.forEach(n => { if (free(c, n, skip)) options.push({ color: c, number: n }); }));
    if (options.length) return options[Math.floor(Math.random() * options.length)];
  }
  return null;
}
function pickRandomUnusedIcon(usedKeys) {
  const options = [];
  GDATA.SHIP_ICON_COLORS.forEach(color => GDATA.SHIP_ICON_NUMBERS.forEach(number => {
    const key = `${color}|${number}`;
    if (!usedKeys.has(key)) options.push({ color, number });
  }));
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}
// Which White icon numbers are already taken by another Ship Class in the
// SAME Division (icons are unique per Division, not app-wide -- see
// GDATA.SHIP_ICON_DIR's comment in data.js).
function usedClassIconNumbers(excludeId, division) {
  const used = new Set();
  STATE.shipClasses.forEach(c => { if (c.id !== excludeId && c.division === division && c.icon) used.add(c.icon); });
  return used;
}
// Which "Color|Number" pairs are already taken by another SHIP in the same
// Division (NPCs get their own random pick at race start and never collide
// with a Ship's saved icon, so they're excluded here).
function usedShipIconKeys(excludeId) {
  const used = new Set();
  STATE.ships.forEach(s => {
    if (s.id === excludeId || !s.iconColor) return;
    const cls = getShipClass(s.classId);
    if (!cls || !cls.icon) return;
    used.add(`${cls.division}|${s.iconColor}|${cls.icon}`);
  });
  return used;
}

/* ============================== Name generators ============================== */
function rollRaceName() {
  const d1 = GDATA.RACE_NAME.die1[rollD(10) - 1];
  const d2 = GDATA.RACE_NAME.die2[rollD(10) - 1];
  const d3 = GDATA.RACE_NAME.die3[rollD(10) - 1];
  return `${d1} ${d2} ${d3}`;
}
function rollShipName() {
  let l = GDATA.SHIP_NAME.left[rollD(50) - 1];
  let r = GDATA.SHIP_NAME.right[rollD(50) - 1];
  if (l === "Reroll") l = GDATA.SHIP_NAME.left[rollD(49) - 1];
  if (r === "Reroll") r = GDATA.SHIP_NAME.right[rollD(49) - 1];
  return `${l} ${r}`;
}
function rollHeroName() {
  return `${GDATA.HERO_FIRST_NAMES[rollD(100) - 1]} ${GDATA.HERO_LAST_NAMES[rollD(100) - 1]}`;
}

/* ============================== Racecourse generation ============================== */
// Leg flavor + TN: a fresh Leg is rolled every time one is needed (there's
// no pre-built Leg list -- see RULE_CHANGES.md). Flavor pool is picked by
// the course's Division (Flash = atmospheric, everything else = deep-space)
// -- purely narration, no mechanical difference between the two pools.
function rollLegFeature(division) {
  const table = GDATA.DIVISION_ATMOSPHERIC[division] ? GDATA.FLASH_LEG_FEATURES : GDATA.SPACE_LEG_FEATURES;
  const idx = rollD(50) - 1;
  return { d50: idx + 1, desc: table[idx][0], mod: table[idx][1] };
}
function rollLeg(division) {
  const tier = rollD(5) + rollD(5); // 2d5 -> 2..10, the Leg's OWN difficulty tier, independent of any car's build Tier
  const baseTN = tier * 3;
  const feat = rollLegFeature(division);
  const tnTierMod = (tier + feat.mod) * 3;
  const tnTnMod = baseTN + feat.mod;
  return { tier, baseTN, d50: feat.d50, feature: feat.desc, mod: feat.mod, tnTierMod, tnTnMod, finalTN: tnTierMod, finalMode: "tier" };
}
function rollCircularLeg(course) {
  const leg = rollLeg(course.division);
  const mode = course.legMode || "tier";
  leg.finalMode = mode;
  leg.finalTN = mode === "tier" ? leg.tnTierMod : (mode === "tn" ? leg.tnTnMod : leg.baseTN);
  return leg;
}
// A Leg's TN can never exceed the highest Skill Mk among this race's cars
// (Hero or NPC alike now that they're mechanically identical), plus 18.
function legTNCap(race) {
  const scores = race.participants.map(p => { const s = carStats(p); return s.control + s.crewPilot; });
  return (scores.length ? Math.max(...scores) : 0) + 18;
}
function legNaturalTN(leg) {
  return leg.finalMode === "tier" ? leg.tnTierMod : leg.finalMode === "tn" ? leg.tnTnMod : leg.baseTN;
}

/* ============================== Race engine (Circus Astralis, see RULE_CHANGES.md 2026-10-05) ==============================
   Ships act one at a time, in initiative order (lowest Thrust first, ties
   broken by lowest 1D20). A turn is: shift gear, roll movement (gear dice +
   Thrust), make the Control Task Check if one is triggered, then walk the
   path one clicked hex at a time (straight ahead or a Slip), then at most one
   Gunner attack. Hex geometry is the same proven track engine as before
   (resolveSlipPath, circTrackGeometry, etc.). */
function occupantAt(race, lane, hexPos, exceptId) {
  const p = race.participants.find(x => x.id !== exceptId && x.lane === lane && x.hexPos === hexPos);
  if (p) return p;
  return (race.asteroids || []).find(a => a.id !== exceptId && a.lane === lane && a.hexPos === hexPos) || null;
}
// True for anything a ship can never pass through, Control check or not --
// an asteroid only (see RULE_CHANGES.md 2026-10-09). A wreck or a live racer
// can both still be overtaken with a successful Control Task Check.
function isHardObstacle(occ) { return !!occ && occ.kind === "asteroid"; }
// Initiative: lowest effective Thrust acts first; equal Thrust ties are
// broken by 1D20, lowest first, re-rolled until every tied car is separated.
function initiativeOrder(list) {
  const byThrust = new Map();
  list.forEach(p => {
    const t = carStats(p).thrust;
    if (!byThrust.has(t)) byThrust.set(t, []);
    byThrust.get(t).push(p);
  });
  const out = [];
  [...byThrust.keys()].sort((a, b) => a - b).forEach(t => out.push(...breakInitiativeTie(byThrust.get(t))));
  return out;
}
function breakInitiativeTie(group) {
  if (group.length <= 1) return group;
  const rolled = group.map(p => ({ p, v: rollD(20) })).sort((a, b) => a.v - b.v);
  const out = [];
  let i = 0;
  while (i < rolled.length) {
    let j = i;
    while (j + 1 < rolled.length && rolled[j + 1].v === rolled[i].v) j++;
    if (j === i) out.push(rolled[i].p);
    else out.push(...breakInitiativeTie(rolled.slice(i, j + 1).map(r => r.p)));
    i = j + 1;
  }
  return out;
}
// The up to 3 hexes "ahead" of `cur`: forward (straight), or a forward
// diagonal into the next lane in or out -- the same three hexes a live car's
// own move choice offers. Only real, in-bounds hexes are included (fewer at
// the inner/outermost lane); does NOT filter by occupancy -- callers decide
// what counts as open. Shared by wreck/asteroid drift and the asteroid push
// mechanic (see RULE_CHANGES.md 2026-10-09).
function threeForwardHexes(geom, course, cur) {
  const circ = geom.laneHexLists[cur.laneIdx0].length;
  const ahead = { laneIdx0: cur.laneIdx0, hexPos: (cur.hexPos + 1) % circ };
  const out = [ahead];
  const sn = geom.slipNeighbors[cur.laneIdx0][cur.hexPos];
  const aheadHex = geom.laneHexLists[ahead.laneIdx0][ahead.hexPos];
  [-1, 1].forEach(dir => {
    const lane0 = cur.laneIdx0 + dir;
    if (lane0 < 0 || lane0 >= course.lanes) return; // the track edge -- no lane out here
    const cands = (dir < 0 ? sn.inward : sn.outward).filter(h => hexDistance(geom.laneHexLists[lane0][h], aheadHex) === 1);
    if (cands.length) out.push({ laneIdx0: lane0, hexPos: cands[0] });
  });
  return out;
}
// The open drift destinations from `cur` -- threeForwardHexes() filtered to
// only an open, in-bounds hex.
function wreckDriftOptions(race, p, geom, course, cur) {
  return threeForwardHexes(geom, course, cur).filter(h => !occupantAt(race, h.laneIdx0 + 1, h.hexPos, p.id));
}
// Drifts `obj` (anything with a .id/.lane/.hexPos, 1-based lane) forward 1-2
// hexes, one hex at a time, each hex a random pick among the three hexes
// ahead of it, landing only on an open, in-bounds hex. Boxed in on all three
// sides, it simply stays put. Shared by wrecks and asteroids (see
// RULE_CHANGES.md 2026-10-08: asteroids drift the same way wrecks do).
function driftOne(race, geom, course, obj) {
  const dist = rollD(2); // 1 or 2 hexes
  const path = [];
  for (let i = 0; i < dist; i++) {
    const opts = wreckDriftOptions(race, obj, geom, course, { laneIdx0: obj.lane - 1, hexPos: obj.hexPos });
    if (!opts.length) break;
    const dest = opts[rollD(opts.length) - 1];
    obj.lane = dest.laneIdx0 + 1;
    obj.hexPos = dest.hexPos;
    path.push({ lane: obj.lane, hexPos: obj.hexPos });
  }
  return path;
}
// Derelict wrecks drift every Leg (see RULE_CHANGES.md 2026-10-08). Each
// wreck's drift is recorded into its own history, in the same shape a live
// turn uses, so Show Last Leg / Show Entire Race animate the drift too.
function driftWrecks(race) {
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  race.participants.forEach(p => {
    if (!p.out) return;
    const path = driftOne(race, geom, course, p);
    race.turnSeq = (race.turnSeq || 0) + 1;
    p.history = p.history || [];
    p.history.push({ seq: race.turnSeq, leg: race.legIndex + 1, movement: path.length, path, lane: p.lane, laps: p.laps, hexPos: p.hexPos, slipHexes: 0, gear: p.gear, drift: true });
  });
}
// Asteroids drift 1-2 hexes every Leg but, unlike wrecks, stay in their own
// lane -- never a forward diagonal into another lane (see RULE_CHANGES.md
// 2026-10-09). If the next hex holds an active (non-wrecked) ship, the
// asteroid shoves it forward instead of stopping: pushShip() moves the ship
// and the asteroid takes the ship's old hex. A wreck or another asteroid in
// the way simply blocks the rest of this Leg's drift, same as before. Each
// asteroid's (and any pushed ship's) movement is recorded into both
// race._legStartEvents (for the one-shot Leg-start animation) and its own
// history, in the same shape a wreck's drift uses, so Show Last Leg / Show
// Entire Race replay asteroid movement too (see RULE_CHANGES.md 2026-10-09).
function driftAsteroids(race) {
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const lines = [];
  (race.asteroids || []).forEach(a => {
    const dist = rollD(2); // 1 or 2 hexes
    const from = { lane: a.lane, hexPos: a.hexPos };
    const path = [];
    for (let i = 0; i < dist; i++) {
      const circ = geom.laneHexLists[a.lane - 1].length;
      const nextHexPos = (a.hexPos + 1) % circ;
      const occ = occupantAt(race, a.lane, nextHexPos, a.id);
      if (occ && (occ.kind === "asteroid" || occ.out)) break; // a wreck or another asteroid -- blocked
      if (occ) {
        pushShip(race, occ, a, geom, course, lines);
        // Boxed in, a Fumble roll might not actually move the ship -- if it's
        // still sitting right here, the asteroid can't advance into it either.
        if (occ.lane === a.lane && occ.hexPos === nextHexPos) break;
      }
      a.hexPos = nextHexPos;
      path.push({ lane: a.lane, hexPos: a.hexPos });
    }
    if (path.length) {
      race._legStartEvents.push({ kind: "asteroid", id: a.id, from, path });
      race.turnSeq = (race.turnSeq || 0) + 1;
      a.history = a.history || [];
      a.history.push({ seq: race.turnSeq, leg: race.legIndex + 1, movement: path.length, path, lane: a.lane, laps: 0, hexPos: a.hexPos, slipHexes: 0, gear: 0, drift: true });
    }
  });
  if (lines.length) race.log.push({ legIndex: race.legIndex, name: "Asteroid Field", lines });
}
// A drifting asteroid shoving an active ship out of its hex (see
// RULE_CHANGES.md 2026-10-09): the ship moves to a random open hex among the
// three ahead of IT (straight, or a forward diagonal) and takes 1 HP of
// damage, ignoring Armor. If all three are blocked, there's no push -- the
// ship rolls the Fumble Chart instead (its own effects apply in place of the
// flat 1 HP) and its turn for this Leg is forfeited.
function pushShip(race, ship, asteroid, geom, course, lines) {
  const from = { lane: ship.lane, hexPos: ship.hexPos };
  const candidates = threeForwardHexes(geom, course, { laneIdx0: ship.lane - 1, hexPos: ship.hexPos });
  const open = candidates.filter(h => !occupantAt(race, h.laneIdx0 + 1, h.hexPos, ship.id));
  if (open.length) {
    const dest = open[rollD(open.length) - 1];
    ship.lane = dest.laneIdx0 + 1; ship.hexPos = dest.hexPos;
    lines.push(`${participantLabel(ship)} is shoved by a drifting asteroid.`);
    applyDamage(race, ship, 1, lines);
  } else {
    lines.push(`${participantLabel(ship)} is boxed in by a drifting asteroid -- rolls the Fumble Chart.`);
    rollFumble(race, ship, { movement: 0, stopped: false }, lines);
    const car = race.legState.cars[ship.id];
    if (car) car.turnDone = true;
  }
  race._legStartEvents.push({ kind: "ship", id: ship.id, from, path: [{ lane: ship.lane, hexPos: ship.hexPos }] });
}
// Scatters `count` asteroids around the track at random, keeping clear of
// the whole starting cluster, not just the exact hexes ships occupy (see
// RULE_CHANGES.md 2026-10-09) -- lanes are staggered only 1 hex apart
// (STAGGER_PER_LANE), so a hex nobody's standing on can still sit right in
// the middle of the starting formation. Placement itself isn't
// lane-restricted -- only their later drift is.
function placeAsteroids(race, count) {
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  // Keep every asteroid at least this many real hexes from every ship's
  // starting hex. A per-lane hexPos range isn't enough -- the staggered
  // starting diagonal cuts across lanes, so a hex just past such a range in
  // one lane can still sit hex-adjacent to a ship starting in the lane next
  // to it (see RULE_CHANGES.md 2026-10-10). True hex distance (cube
  // coordinates) doesn't have that gap.
  const MIN_START_DISTANCE = 3;
  const startHexes = race.participants.map(p => geom.laneHexLists[p.lane - 1][p.hexPos]);
  const open = [];
  for (let lane0 = 0; lane0 < course.lanes; lane0++) {
    const circ = geom.laneHexLists[lane0].length;
    for (let hexPos = 0; hexPos < circ; hexPos++) {
      const hex = geom.laneHexLists[lane0][hexPos];
      if (startHexes.some(sh => hexDistance(hex, sh) < MIN_START_DISTANCE)) continue;
      if (!occupantAt(race, lane0 + 1, hexPos, null)) open.push({ lane: lane0 + 1, hexPos });
    }
  }
  for (let i = 0; i < count && open.length; i++) {
    const spot = open.splice(rollD(open.length) - 1, 1)[0];
    race.asteroids.push({
      id: uid("ast"), kind: "asteroid", lane: spot.lane, hexPos: spot.hexPos,
      startLane: spot.lane, startHexPos: spot.hexPos, history: [],
      design: ASTEROID_DESIGNS[rollD(ASTEROID_DESIGNS.length) - 1],
      // Cosmetic only (spin speed/direction) -- Math.random() rather than
      // rollD so it never shifts any dice-stubbed test's roll sequence.
      spinDur: 2.5 + Math.random() * 2, spinDir: Math.random() < 0.5 ? "normal" : "reverse"
    });
  }
}
const ASTEROID_DESIGNS = ["a", "b", "c", "d"];
// Builds a jagged N-point rock outline (radii alternating far/near, plus a
// little per-point jitter) around the origin, so it reads as a crinkly rock
// silhouette rather than a smooth polygon.
function buildRockShape(n, farR, nearR, phaseDeg, jitter) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const angle = (phaseDeg + k * (360 / n)) * Math.PI / 180;
    const r = (k % 2 === 0 ? farR : nearR) + jitter[k % jitter.length];
    pts.push([+(r * Math.cos(angle)).toFixed(1), +(r * Math.sin(angle)).toFixed(1)]);
  }
  return pts;
}
// Four distinct outlines, all sized to a ~10-11 unit max radius -- scaled
// down to fit well inside a hex's inscribed circle when drawn (see the
// `scale` passed into asteroidFacets, below).
const ASTEROID_SHAPES = {
  a: buildRockShape(10, 10, 6.5, -90, [0, -0.6, 0.4, -0.3, 0.5, -0.4, 0.3, -0.5, 0.6, -0.3]),
  b: buildRockShape(9, 9.5, 6, -70, [0.4, -0.5, 0.3, -0.4, 0.6, -0.3, 0.5, -0.6, 0.3]),
  c: buildRockShape(11, 10.5, 6.8, -100, [-0.3, 0.5, -0.4, 0.3, -0.6, 0.4, -0.3, 0.5, -0.4, 0.3, -0.5]),
  d: buildRockShape(8, 9, 6.2, -45, [0.5, -0.4, 0.3, -0.6, 0.4, -0.3, 0.5, -0.4]),
};
const ASTEROID_TONES = ["#5c594f", "#716d60", "#847f6f", "#45433a"];
// A faceted fill (fan-triangulated from an off-center point, each facet a
// different gray) plus a crisp dark outline -- reads as a crinkly, lit rock
// rather than a flat-filled blob.
function asteroidFacets(design, cx, cy, scale) {
  const shape = ASTEROID_SHAPES[design] || ASTEROID_SHAPES.a;
  const n = shape.length;
  const avgX = shape.reduce((s, p) => s + p[0], 0) / n, avgY = shape.reduce((s, p) => s + p[1], 0) / n;
  const center = [avgX * 0.3, avgY * 0.3 - 1.5];
  const toPt = ([dx, dy]) => `${(cx + dx * scale).toFixed(1)},${(cy + dy * scale).toFixed(1)}`;
  let facets = "";
  for (let i = 0; i < n; i++) {
    const pts = [center, shape[i], shape[(i + 1) % n]].map(toPt).join(" ");
    facets += `<polygon class="asteroid-facet" fill="${ASTEROID_TONES[i % ASTEROID_TONES.length]}" points="${pts}"/>`;
  }
  const outline = shape.map(toPt).join(" ");
  return `${facets}<polygon class="asteroid-outline" points="${outline}"/>`;
}
function initLegState(race) {
  const course = getCourse(race.courseId);
  const leg = rollCircularLeg(course);
  leg.finalTN = Math.min(leg.finalTN, legTNCap(race));
  const prev = race.legState ? race.legState.cars : {};
  const cars = {};
  race.participants.forEach(p => {
    cars[p.id] = {
      gearChange: 0, slipsThisLeg: 0, attackedThisLeg: false, damageControl: false, turn: null,
      // Disadvantage carried in from hits and fumbles; consumed by this car's next check.
      pendingD: prev[p.id] ? prev[p.id].pendingD || 0 : 0,
      turnDone: !!p.out
    };
  });
  // Thrust never changes during a race, so the initiative order is set once
  // (ties broken by 1D20 at the start) and every Leg keeps it. Ships that
  // have been destroyed simply drop out of it.
  if (!race.initiative) race.initiative = initiativeOrder(race.participants).map(p => p.id);
  const order = race.initiative.filter(id => { const p = race.participants.find(x => x.id === id); return p && !p.out; });
  race.legState = { leg, cars, complete: false, order };
  STATE._openDeclFor = null;
  // A race saved before this feature existed won't have these fields yet.
  race.asteroids = race.asteroids || [];
  race._legStartEvents = [];
  driftWrecks(race);
  driftAsteroids(race);
}
function nextTurnParticipant(race) {
  const ls = race.legState;
  for (const id of ls.order) {
    const p = race.participants.find(x => x.id === id);
    if (p && !p.out && !ls.cars[p.id].turnDone) return p;
  }
  return null;
}
function participantLabel(p) { return p.type === "hero" ? shipName(p.shipId) : (p.name + " (NPC)"); }

function startRace(courseId, shipIds, npcs) {
  const course = getCourse(courseId);
  const participants = [];
  // "Color|Number" within this one race -- every Hero/NPC here shares the
  // course's own Division already (Race Setup only offers same-Division
  // ships), so the Division itself doesn't need to be part of the key.
  const usedIcons = new Set();
  shipIds.forEach(sid => {
    const ship = getShip(sid);
    const p = { id: uid("hero"), type: "hero", shipId: sid, cumulative: 0, history: [], out: false, gear: 0 };
    p.maxHp = carStats(p).points;
    p.hp = p.maxHp;
    participants.push(p);
    const info = shipIconInfo(ship);
    if (info) usedIcons.add(`${info.color}|${info.number}`);
  });
  npcs.forEach(n => {
    const pick = pickNpcIcon(course.division, usedIcons);
    if (pick) usedIcons.add(`${pick.color}|${pick.number}`);
    const npcClass = n.classId ? getShipClass(n.classId) : null;
    const stats = n.stats || (npcClass ? npcStatsFromClass(npcClass) : npcStatsFromDivision(course.division));
    participants.push({
      id: uid("npc"), type: "npc", name: n.name, aggression: clampInt(n.aggression, 1, 10, 5),
      division: course.division, ...stats,
      cumulative: 0, history: [], iconDivision: course.division, iconColor: pick ? pick.color : "", iconNumber: pick ? pick.number : "",
      out: false, gear: 0, maxHp: stats.points, hp: stats.points
    });
  });
  // Starting lanes: round-robin in initiative order, outer lanes staggered ahead.
  // Highest Thrust starts in lane 1; each slower ship starts one lane further out.
  const startOrder = initiativeOrder(participants);
  const byHighest = [...startOrder].reverse();
  byHighest.forEach((p, i) => {
    const laneIdx0 = i % course.lanes;
    p.lane = laneIdx0 + 1;
    p.hexPos = laneStartHexPos(laneIdx0);
    p.laps = 0;
    p.startLane = p.lane;
    p.startHexPos = p.hexPos;
  });
  const race = { courseId, legIndex: 0, participants, finished: false, started: false, winnerId: "", log: [], asteroids: [], _legStartEvents: [] };
  // Lanes and turn order both come from the same initiative order.
  race.initiative = startOrder.map(p => p.id);
  // Asteroids are placed once, up front, avoiding the ships' starting hexes
  // (already set above) -- see RULE_CHANGES.md 2026-10-09.
  placeAsteroids(race, course.asteroidCount || 0);
  initLegState(race);
  STATE.race = race;
  saveState();
}

/* ---------- Automatic choices for NPCs (aggression-driven) ---------- */
// NPCs keep up with the pack: from Gear-0 they always shift up, otherwise
// they move toward the median gear of the racers still running, and a
// more aggressive NPC sometimes pushes a gear higher on its own.
function npcGearChange(race, p, agg) {
  if (p.gear === 0) return 1;
  const gears = race.participants.filter(x => !x.out).map(x => x.gear || 0).sort((a, b) => a - b);
  const median = gears.length ? gears[Math.floor(gears.length / 2)] : p.gear;
  if (p.gear < median) return 1;
  if (p.gear > median && rollD(20) > agg) return -1;
  if (p.gear < GDATA.MAX_GEAR && rollD(20) <= agg) return 1;
  return 0;
}
function npcChoices(race, p) {
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const positions = standingsPositions(race, course);
  const agg = legAggressionFor(p, positions);
  // An NPC below full HP uses Damage Control instead of attacking this Leg.
  return { gearChange: npcGearChange(race, p, agg), damageControl: p.hp < p.maxHp };
}

/* ---------- Resolving one turn ---------- */
// Gear's Task Check modifier as a net Advantage/Disadvantage count.
function gearNet(gear) {
  const mod = (GDATA.GEAR_TABLE[gear] || {}).mod;
  return mod === "AA" ? 2 : mod === "A" ? 1 : mod === "D" ? -1 : mod === "DD" ? -2 : 0;
}
// One line for a Control check: the modifier as A/AA/D/DD (and where it came
// from), the score broken into Control + Pilot skill, and the result.
function controlCheckLine(label, rc, stats, sources) {
  const modeWord = rc.net >= 0 ? "Max" : "Min";
  const lines = [
    "Control Task Check",
    `Control=${modeWord}(${rc.dice.join(",")})+C${stats.control}+P${stats.crewPilot}=${rc.total}`,
    `Control-${rc.total} vs. TN (${rc.tn}) ${rc.success ? "Success" : "Fail"}`,
  ];
  const extra = [];
  if (rc.success && rc.critLevels) extra.push(`${rc.critLevels} Critical${rc.critLevels === 1 ? "" : "s"} (+${rc.critLevels} bonus hex${rc.critLevels === 1 ? "" : "es"})`);
  if (rc.fumbleLevels) extra.push(`${rc.fumbleLevels} Fumble${rc.fumbleLevels === 1 ? "" : "s"}`);
  if (extra.length) lines.push(extra.join(", "));
  return lines;
}
// One line for a Gunner (attack) check: same shape as controlCheckLine(), but
// scored on Gunner + Gunner skill and reported as a hit or a miss.
function gunnerCheckLine(label, rc, stats) {
  const modeWord = rc.net >= 0 ? "Max" : "Min";
  const mod = rc.net ? netLabel(rc.net) : "";
  const score = stats.gunner + stats.crewGunner;
  return [
    label,
    `Gunner-${score}${mod} vs. TN (${rc.tn})`,
    `${modeWord}(${rc.dice.join(", ")}) + ${score} vs. TN (${rc.tn}) ${rc.success ? "Hit" : "Miss"}`,
  ];
}
function applyDamage(race, p, amount, log) {
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp === 0 && !p.out) {
    p.out = true;
    p.outLeg = race.legIndex;
    log.push(`${participantLabel(p)} is destroyed -- a wreck stays in its hex.`);
  }
}
function fallOffTrack(race, p, T, log) {
  log.push(`${participantLabel(p)} is forced off the track: 3 HP damage (ignoring Armor), turn ends, next Leg starts in Gear-1.`);
  applyDamage(race, p, 3, log);
  p.gear = 1;
  T.movement = 0;
  T.stopped = true;
}
function applyFumbleAffect(race, p, a, T, log) {
  const course = getCourse(race.courseId);
  const car = race.legState.cars[p.id];
  if (a.type === "hp") {
    const dmg = Math.max(0, carTier(carDivision(p)) * a.tierMult - carStats(p).armor);
    applyDamage(race, p, dmg, log);
  } else if (a.type === "loseHexes") {
    T.movement = Math.max(0, T.movement - a.amount);
  } else if (a.type === "laneShift") {
    const target = a.dir === "in" ? p.lane - 1 : p.lane + 1;
    if (target >= 1 && target <= course.lanes) {
      // Move to the matching hex in the new lane (the same neighbor the Slip
      // map uses), so the position stays on that lane's ring.
      const geom = circTrackGeometry(course);
      const sn = geom.slipNeighbors[p.lane - 1][p.hexPos || 0];
      const cands = a.dir === "in" ? sn.inward : sn.outward;
      p.lane = target;
      if (cands.length) p.hexPos = cands[0];
      else p.hexPos = Math.min(p.hexPos || 0, geom.laneHexLists[target - 1].length - 1);
    } else if (a.forced) fallOffTrack(race, p, T, log);
  } else if (a.type === "gearReset") {
    p.gear = a.to;
  } else if (a.type === "nextLegD") {
    car.pendingD += a.amount;
  } else if (a.type === "stopped") {
    T.movement = 0;
    T.stopped = true;
  }
}
function rollFumble(race, p, T, log) {
  const sum = rollD(10) + rollD(10);
  const entry = GDATA.FUMBLE_CHART[sum - 2];
  log.push(`Fumble chart (${sum}): ${entry.text}`);
  entry.affects.forEach(a => applyFumbleAffect(race, p, a, T, log));
}
// An open hex beside `hex` for a car to slip into after landing on an
// obstacle -- any real hex neighbor with nobody in it.
function openHexBeside(race, geom, laneIdx0, hexPos, exceptId) {
  const hex = geom.laneHexLists[laneIdx0][hexPos];
  for (const d of HEX_DIRS) {
    const hit = geom.lookup.get(hexKey(hex.q + d.dq, hex.r + d.dr));
    if (hit && !occupantAt(race, hit.lane + 1, hit.index, exceptId)) return { laneIdx0: hit.lane, hexPos: hit.index };
  }
  return null;
}

// A Gunner attack from `p` against `target`: one Gunner check vs the Leg TN;
// a hit deals 1D6 (or flat 4) plus the attacker's Damage bonus, less Armor.
function resolveAttack(race, p, target, log) {
  const course = getCourse(race.courseId);
  const stats = carStats(p);
  const tn = race.legState.leg.finalTN;
  const net = gearNet(p.gear);
  const gc = rollCheck(stats.gunner + stats.crewGunner, net, tn);
  log.push(...gunnerCheckLine(`Gunner vs ${participantLabel(target)}`, gc, stats));
  if (!gc.success) return;
  const rolledDmg = course.flatDamage ? 4 : rollD(GDATA.DIE_SIDES);
  const armor = carStats(target).armor;
  const dmg = Math.max(0, rolledDmg + stats.damage - armor);
  const dmgOp = stats.damage < 0 ? `- ${-stats.damage}` : `+ ${stats.damage}`;
  log.push(`Damage ${course.flatDamage ? "4 (flat)" : rolledDmg} ${dmgOp} - Armor ${armor} = ${dmg}.`);
  applyDamage(race, target, dmg, log);
  race.legState.cars[target.id].pendingD += 1; // taking a hit: one Disadvantage on the target's next check
}
// Enemy racers within the attacker's Range (weapon range, in hexes) of a position along the path.
// No attacks on the first Leg (see RULE_CHANGES.md).
function attackTargetsFrom(race, p, geom, pos) {
  if (race.legIndex === 0) return [];
  const here = { lane: pos.laneIdx0 + 1, hexPos: pos.hexPos };
  const range = Math.max(1, carStats(p).range || 1);
  return race.participants.filter(x => x.id !== p.id && !x.out && hexesWithinManeuverRange(geom, here, x, range));
}

// A turn starts here: gear, movement roll, the Control check (only when the
// roll exceeds the Leg TN, made before moving), and any fumbles. Then the walk
// moves one hex at a time. A hero's walk pauses before every hex: the hero
// clicks straight ahead, or a Slip left or right. The nth Slip of the Leg costs
// n movement points; the lateral shift is free.
function resolveTurn(race, p, choices) {
  const ls = race.legState, car = ls.cars[p.id];
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const tn = ls.leg.finalTN;
  const stats = carStats(p);
  const log = [];

  // 0. Damage Control: offered at the start of the Leg, before Gear/Movement.
  // Repairs 1D6 + Damage Control HP (never above max HP) in exchange for
  // forgoing this Leg's attack.
  if (choices.damageControl) {
    car.attackedThisLeg = true;
    const dcRoll = rollD(GDATA.DIE_SIDES);
    const dcBonus = stats.damageControl + stats.crewEngineer;
    const dcSign = dcBonus < 0 ? `- ${-dcBonus}` : `+ ${dcBonus}`;
    const healed = Math.max(0, dcRoll + dcBonus);
    p.hp = Math.min(p.maxHp, p.hp + healed);
    log.push(`Dmg Ctrl: 1d6 ${dcSign} = ${dcRoll} ${dcSign} = ${healed} HP repaired. ${p.hp}/${p.maxHp}`);
  }

  // 1. Gear shift (at most one level) and movement roll.
  p.gear = clampInt(p.gear + clampInt(choices.gearChange, -1, 1, 0), 0, GDATA.MAX_GEAR, p.gear);
  const dice = (GDATA.GEAR_TABLE[p.gear] || {}).dice || 0;
  const rolled = Array.from({ length: dice }, () => rollD(GDATA.DIE_SIDES));
  const intended = dice ? Math.max(0, rolled.reduce((a, b) => a + b, 0) + stats.thrust) : 0;
  log.push(`Gear ${p.gear}: rolled ${rolled.length ? rolled.join(" + ") : "nothing (Gear-0)"} + Thrust ${stats.thrust} = ${intended} movement points.`);

  // 2. Control modifiers. Pending Disadvantage from earlier hits/fumbles is
  // consumed by this turn's checks. Movement over the TN triggers the Control
  // check below but adds no Disadvantage of its own -- only the gear does
  // (see RULE_CHANGES.md 2026-10-07; otherwise it's double jeopardy, forcing
  // both a check and a Disadvantage on it).
  const pendingNow = car.pendingD;
  car.pendingD = 0;
  const net = gearNet(p.gear) - pendingNow;
  const checkSources = [];
  if (gearNet(p.gear)) checkSources.push(`Gear ${p.gear}`);
  if (intended > tn) checkSources.push("movement over the TN");
  if (pendingNow) checkSources.push("earlier hits/fumbles");
  const T = { movement: intended, stopped: false };

  // 3. Control Task Check when the movement roll exceeds the Leg TN. It is made
  // before the ship moves, so a failure halves the whole move.
  if (intended > tn) {
    const rc = rollCheck(stats.control + stats.crewPilot, net, tn);
    log.push(...controlCheckLine("Control check (movement over the TN)", rc, stats, checkSources));
    if (rc.success) {
      T.movement = intended + rc.critLevels;
    } else {
      T.movement = Math.floor(intended / 2);
      log.push(`Failure: moves half its intended distance (${T.movement}).`);
    }
    for (let i = 0; i < rc.fumbleLevels; i++) rollFumble(race, p, T, log);
  }
  if (p.out) T.stopped = true;

  car.turn = {
    log, T, net, checkSources, tn, R: T.stopped ? 0 : T.movement, slips: 0,
    rolled, thrustAtRoll: stats.thrust, intended,
    cur: { laneIdx0: p.lane - 1, hexPos: p.hexPos || 0 }, laps: p.laps || 0,
    walked: [], left: [], passedAttack: false, declinedHere: false, halt: false, finished: false, awaiting: null, choice: null
  };
  walkTurn(race, p);
}

// Moves the walk onto `dest` (one hex), leaving a dot on the hex it came from,
// counting laps and the finish line.
function moveWalkTo(t, dest, geom, course) {
  if (t.cur.hexPos + 1 >= geom.laneHexLists[t.cur.laneIdx0].length) t.laps += 1;
  t.left.push({ laneIdx0: t.cur.laneIdx0, hexPos: t.cur.hexPos });
  t.cur = { laneIdx0: dest.laneIdx0, hexPos: dest.hexPos };
  t.walked.push({ lane: t.cur.laneIdx0 + 1, hexPos: t.cur.hexPos });
  if (t.laps >= course.laps) t.finished = true;
  // A declined attack offer only holds for the hex it was declined at --
  // moving to a new hex re-offers it if a target is still in range.
  t.declinedHere = false;
}
// The moves open from the current hex: straight ahead, or a Slip to an open
// hex beside the ship. Straight ahead into an occupied hex is an obstacle
// check. A Slip costs the nth Slip of the Leg in movement points and is only
// offered if affordable.
function encounterOptions(race, p, car, cur, R, geom, course) {
  const circ = geom.laneHexLists[cur.laneIdx0].length;
  const ahead = { laneIdx0: cur.laneIdx0, hexPos: (cur.hexPos + 1) % circ };
  const aheadOcc = occupantAt(race, ahead.laneIdx0 + 1, ahead.hexPos, p.id);
  const aheadLabel = isHardObstacle(aheadOcc)
    ? "Straight ahead (blocked by an asteroid)"
    : (aheadOcc ? "Straight ahead (Control check to pass)" : "Straight ahead");
  const opts = [{ id: "straight", label: aheadLabel, dest: ahead }];
  const cost = car.slipsThisLeg + 1;
  if (cost > R) return opts;
  const sn = geom.slipNeighbors[cur.laneIdx0][cur.hexPos];
  const aheadHex = geom.laneHexLists[ahead.laneIdx0][ahead.hexPos];
  [[-1, sn.inward, "Slip left"], [1, sn.outward, "Slip right"]].forEach(([dir, cands, label]) => {
    const lane0 = cur.laneIdx0 + dir;
    if (lane0 < 0 || lane0 >= course.lanes) return;
    const forward = cands.filter(h => hexDistance(geom.laneHexLists[lane0][h], aheadHex) === 1);
    const hexPos = forward.find(h => !occupantAt(race, lane0 + 1, h, p.id));
    if (hexPos === undefined) return;
    opts.push({ id: dir < 0 ? "left" : "right", label: `${label} (costs ${cost} movement point${cost === 1 ? "" : "s"})`, cost, dest: { laneIdx0: lane0, hexPos } });
  });
  return opts;
}
function applyEncounter(race, p, id, opts) {
  const car = race.legState.cars[p.id], t = car.turn;
  const course = getCourse(race.courseId), geom = circTrackGeometry(course);
  const stats = carStats(p);
  t.choice = null;
  const opt = opts.find(o => o.id === id);
  if (!opt) return;
  if (id === "straight") {
    const occ = occupantAt(race, opt.dest.laneIdx0 + 1, opt.dest.hexPos, p.id);
    if (isHardObstacle(occ)) {
      // An asteroid can't be argued past with a Control check -- it's a dead
      // stop, every time, and costs 2 HP ignoring Armor (see RULE_CHANGES.md
      // 2026-10-09). A wreck, below, is Control-checkable like a live racer.
      p.gear = Math.max(0, p.gear - 1);
      t.log.push(`Stops short of the asteroid field; drops to Gear ${p.gear}.`);
      applyDamage(race, p, 2, t.log);
      t.halt = true;
      return;
    }
    if (occ) {
      const ob = rollCheck(stats.control + stats.crewPilot, t.net, t.tn);
      t.log.push(...controlCheckLine(`Obstacle check (${participantLabel(occ)})`, ob, stats, t.checkSources));
      if (!ob.success) {
        p.gear = Math.max(0, p.gear - 1);
        t.log.push(`Stops short of the obstacle; drops to Gear ${p.gear}.`);
        t.halt = true;
        return;
      }
    }
    t.R -= 1;
    moveWalkTo(t, opt.dest, geom, course);
    return;
  }
  applySlip(race, p, opt);
}

// One Slip: a forward hex with a free lateral shift. The nth Slip of the Leg
// costs n movement points.
function applySlip(race, p, opt) {
  const car = race.legState.cars[p.id], t = car.turn;
  const course = getCourse(race.courseId), geom = circTrackGeometry(course);
  const priorSlips = car.slipsThisLeg;
  car.slipsThisLeg += 1;
  t.slips += 1;
  t.R -= opt.cost;
  t.log.push(`Total Slips = ${priorSlips} at ${opt.cost} Movement Points`);
  moveWalkTo(t, opt.dest, geom, course);
}

// An NPC's step at one hex (see RULE_CHANGES.md 2026-10-10):
// - Open ahead: takes its one free inward Slip per Leg -- the 1st Slip of a
//   Leg costs exactly what a straight hex does (1 movement point for 1 hex
//   of forward progress either way), so it's not a tradeoff, just a standing
//   lane-efficiency pick -- aimed at a hunt target's lane instead, when one's
//   active this Leg.
// - Blocked by an asteroid: always detours around it when a Slip is
//   available -- no Control check exists to gamble on an asteroid.
// - Blocked by a wreck or live racer: weighs the Control check's actual
//   success chance against the real distance this Leg stands to lose if it
//   fails (a failed check halts the WHOLE turn, not just this hex), biased
//   by Aggression -- reckless cars accept worse odds, cautious ones demand
//   better -- and only detours when the numbers favor it.
// - Choosing between two viable detour directions leans toward a hunt
//   target's lane when one's active, otherwise the same Leg-Aggression-
//   scaled ratio the old pre-Circus-Astralis rules used for their Slip lean.
function npcStepPick(race, p, car, stats, t, opts, huntTarget, legAgg) {
  const inward = opts.find(o => o.id === "left");
  const outward = opts.find(o => o.id === "right");
  const ahead = opts.find(o => o.id === "straight").dest;
  const occ = occupantAt(race, ahead.laneIdx0 + 1, ahead.hexPos, p.id);

  const leanInward = () => {
    if (huntTarget && huntTarget.lane !== p.lane) return huntTarget.lane < p.lane;
    const roll = rollD(20);
    return (legAgg - roll) / legAgg >= 0.5;
  };

  if (occ) {
    const detour = inward && outward ? (leanInward() ? inward : outward) : (inward || outward);
    if (isHardObstacle(occ)) return detour ? detour.id : "straight"; // an asteroid -- no check to gamble on
    if (detour) {
      const score = stats.control + stats.crewPilot;
      const pSuccess = controlCheckSuccessChance(score, t.net, t.tn);
      // Going straight risks the WHOLE remaining movement (a failed check
      // halts the turn), while the detour guarantees (R - cost + 1) more
      // hexes -- so the break-even success chance is 1 - (cost - 1) / R: a
      // detour that costs no more than a straight hex (cost 1) needs a
      // guaranteed success to beat it; a pricier detour lowers the bar.
      const pureThreshold = Math.max(0, Math.min(1, 1 - (detour.cost - 1) / t.R));
      const bias = ((p.aggression || 5) - 5.5) / 20; // reckless accepts worse odds, cautious demands better
      const effectiveThreshold = Math.min(1, Math.max(0, pureThreshold - bias));
      if (pSuccess < effectiveThreshold) return detour.id;
    }
    return "straight"; // the math favors the gamble, or there's nowhere else to go
  }

  if (car.slipsThisLeg === 0) {
    let dir = null;
    if (huntTarget && huntTarget.lane !== p.lane) dir = huntTarget.lane < p.lane ? inward : outward;
    if (!dir) dir = inward;
    if (dir) return dir.id;
  }
  return "straight";
}
// Whether the hero's remaining movement straight ahead passes no racer.
function straightRunClear(race, p, t) {
  if (!t || t.R <= 0 || t.finished) return false;
  const circ = circTrackGeometry(getCourse(race.courseId)).laneHexLists[t.cur.laneIdx0].length;
  for (let k = 1; k <= t.R; k++) {
    if (occupantAt(race, t.cur.laneIdx0 + 1, (t.cur.hexPos + k) % circ, p.id)) return false;
  }
  return true;
}
// Moves a hero straight ahead for all of its remaining movement, then resumes the walk.
function moveAllStraight(race, p) {
  const car = race.legState.cars[p.id], t = car.turn;
  const course = getCourse(race.courseId), geom = circTrackGeometry(course);
  while (!t.finished && !t.halt && t.R > 0) {
    applyEncounter(race, p, "straight", encounterOptions(race, p, car, t.cur, t.R, geom, course));
    // Stop early once a racer comes into Range, so the attack offer isn't skipped.
    if (!car.attackedThisLeg && attackTargetsFrom(race, p, geom, t.cur).length) break;
  }
  walkTurn(race, p);
}
// Walks the path one hex at a time. A hero's walk pauses before each hex
// (returns "paused") for an attack offer or a click on the next hex; NPCs decide
// on their own.
function walkTurn(race, p) {
  const ls = race.legState, car = ls.cars[p.id], t = car.turn;
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const stats = carStats(p);
  // An NPC's hunting target and Leg Aggression are fixed once for the whole
  // turn, not re-rolled hex by hex (see RULE_CHANGES.md 2026-10-10).
  let huntTarget = null, legAgg = 0;
  if (p.type === "npc") {
    const positions = standingsPositions(race, course);
    legAgg = legAggressionFor(p, positions);
    huntTarget = npcHuntTarget(race, p, positions);
  }
  while (!t.finished && !t.halt) {
    // A car destroyed mid-turn (e.g. its own pre-movement Fumble) gets no
    // further movement or attack this turn -- it's a wreck, not a racer.
    if (p.out) break;
    // One attack per Leg. While the shooter can still attack, every racer in range is offered.
    const targets = !car.attackedThisLeg ? attackTargetsFrom(race, p, geom, t.cur) : [];
    if (p.type === "hero") {
      if (t.R <= 0) {
        if (!targets.length || t.passedAttack) break;
        t.awaiting = targets.map(x => x.id);
        t.choice = null;
        return "paused";
      }
      if (targets.length && !t.declinedHere) {
        t.awaiting = targets.map(x => x.id);
        t.choice = null;
        return "paused";
      }
      t.awaiting = null;
      const opts = encounterOptions(race, p, car, t.cur, t.R, geom, course);
      const circ = geom.laneHexLists[t.cur.laneIdx0].length;
      const ahead = { laneIdx0: t.cur.laneIdx0, hexPos: (t.cur.hexPos + 1) % circ };
      const occ = occupantAt(race, ahead.laneIdx0 + 1, ahead.hexPos, p.id);
      t.choice = { options: opts.map(o => ({ id: o.id, label: o.label, cost: o.cost, dest: o.dest })), occupantId: occ ? occ.id : null, occupantHard: occ ? isHardObstacle(occ) : false };
      return "paused";
    }
    if (targets.length && rollD(20) <= (p.aggression || 5)) {
      resolveAttack(race, p, targets[0], t.log);
      car.attackedThisLeg = true;
    }
    if (t.R <= 0) break;
    const opts = encounterOptions(race, p, car, t.cur, t.R, geom, course);
    applyEncounter(race, p, npcStepPick(race, p, car, stats, t, opts, huntTarget, legAgg), opts);
  }
  // A walk that ends on another ship's hex drifts to an open hex beside it
  // (free), or rolls the Fumble Chart if every hex beside it is blocked. This
  // must also run when the turn ended via a hard stop (t.halt), not just a
  // normal finish -- a ship can successfully Control-check past a live racer
  // (landing on its hex mid-walk, same as always), then immediately hard-stop
  // one hex later on an asteroid or a failed check, leaving it stuck exactly
  // on that racer's hex with nothing to nudge it off (see RULE_CHANGES.md
  // 2026-10-10: two ships piled up this way after a Leg of asteroid stops).
  if (!t.finished && occupantAt(race, t.cur.laneIdx0 + 1, t.cur.hexPos, p.id)) {
    const open = openHexBeside(race, geom, t.cur.laneIdx0, t.cur.hexPos, p.id);
    if (open) {
      t.log.push("Ends on an occupied hex: drifts to an open hex beside it (free).");
      t.cur = open;
    } else {
      t.log.push("Every hex beside the obstacle is blocked -- automatic Fumble, turn ends.");
      rollFumble(race, p, t.T, t.log);
    }
  }
  finishTurn(race, p);
  return "done";
}

// The hero's answer to an occupied hex ahead, or to an attack offer.
// The hero's click on a yellow hex: moves there. Racers still in range stay offered.
function decideEncounter(race, p, id) {
  const car = race.legState.cars[p.id], t = car.turn;
  if (!t || !t.choice) return;
  applyEncounter(race, p, id, t.choice.options);
  walkTurn(race, p);
}
// The hero's click on a red racer attacks it (once per Leg). With no movement
// points left, an empty target ends the turn without an attack.
function decideAttack(race, p, targetId) {
  const car = race.legState.cars[p.id], t = car.turn;
  if (!t || !t.awaiting) return;
  if (!targetId) {
    t.awaiting = null;
    if (t.R > 0) t.declinedHere = true;
    else t.passedAttack = true;
    walkTurn(race, p);
    return;
  }
  if (!t.awaiting.includes(targetId)) return;
  const target = race.participants.find(x => x.id === targetId);
  t.awaiting = null;
  if (target && !target.out) resolveAttack(race, p, target, t.log);
  car.attackedThisLeg = true;
  walkTurn(race, p);
}

// Ends a turn: moves the car to where its walk stopped, records history,
// and writes the turn log. Also checks the finish line.
function finishTurn(race, p) {
  const ls = race.legState, car = ls.cars[p.id], t = car.turn;
  const course = getCourse(race.courseId);
  p.lane = t.cur.laneIdx0 + 1;
  p.hexPos = t.cur.hexPos;
  p.laps = t.laps;
  const moved = t.walked.length;
  p.cumulative += moved;
  t.log.push(`Moved ${moved} hex${moved === 1 ? "" : "es"}; now lane ${p.lane}, lap ${Math.min(p.laps, course.laps)}/${course.laps}.`);
  race.turnSeq = (race.turnSeq || 0) + 1;
  p.history.push({ seq: race.turnSeq, leg: race.legIndex + 1, movement: moved, path: t.walked.slice(), lane: p.lane, laps: p.laps, hexPos: p.hexPos, slipHexes: t.slips, gear: p.gear });
  if (p.laps >= course.laps && !p.out) {
    race.finished = true;
    race.winnerId = p.id;
    t.log.push(`${participantLabel(p)} crosses the finish line and wins the race!`);
  }
  race.log.push({ legIndex: race.legIndex, name: participantLabel(p), lines: t.log });
  car.turnDone = true;
  car.turn = null;
  // A pop-up lap report for the hero's own ship, shown once per turn (see renderTurnReportModal()).
  if (p.type === "hero") {
    TURN_REPORT = {
      shipId: p.shipId, name: participantLabel(p), legIndex: race.legIndex,
      leg: { ...race.legState.leg },
      lane: p.lane, laps: p.laps, courseLaps: course.laps, gear: p.gear,
      hp: p.hp, maxHp: p.maxHp, lines: t.log.slice(),
      won: race.finished && race.winnerId === p.id,
    };
  }
}

// After a hero's turn step: if the turn is finished, move on to the next
// ship or the next Leg, and let any NPC turns run.
function afterHeroStep(race, p) {
  if (race.legState.cars[p.id].turn) return;
  advanceRace(race);
  runAutomaticTurns(race);
}

// After a turn: finish the race if it's over, or roll over to the next Leg
// once every car has acted. A race with at least one hero ends once every
// hero is out (no point continuing for its own sake); an all-NPC race (see
// RULE_CHANGES.md 2026-10-08) has no such shortcut -- it only ends when a
// racer actually crosses the finish line (finishTurn()).
function advanceRace(race) {
  if (race.finished) return;
  const hasHero = race.participants.some(x => x.type === "hero");
  if (hasHero && !race.participants.some(x => x.type === "hero" && !x.out)) { race.finished = true; return; }
  if (!nextTurnParticipant(race)) race.legState.complete = true; // the next Leg waits for Start Leg
}
// Runs every consecutive NPC turn until a Hero's turn comes up (or the race ends).
function runAutomaticTurns(race) {
  let p;
  while (!race.finished && (p = nextTurnParticipant(race)) && p.type === "npc") {
    resolveTurn(race, p, npcChoices(race, p));
    advanceRace(race);
  }
}

/* ============================== UI ============================== */
let CURRENT_TAB = "shipyard";
// The hero's own lap report, popped up once per hero turn (see finishTurn() and
// renderTurnReportModal()). Not part of STATE -- purely a transient UI overlay.
let TURN_REPORT = null;
function setTab(tab) { CURRENT_TAB = tab; render(); }
function render() {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === CURRENT_TAB));
  const root = document.getElementById("view");
  if (CURRENT_TAB === "introduction") root.innerHTML = renderIntroduction();
  else if (CURRENT_TAB === "shipyard") root.innerHTML = renderShipyard();
  else if (CURRENT_TAB === "cantina") root.innerHTML = renderCantina();
  else if (CURRENT_TAB === "hangar") root.innerHTML = renderHangarBay();
  else if (CURRENT_TAB === "course") root.innerHTML = renderCourse();
  else if (CURRENT_TAB === "race") root.innerHTML = renderRace();
  else if (CURRENT_TAB === "instructions") root.innerHTML = renderInstructions();
  else root.innerHTML = renderReference();
  if (TURN_REPORT) root.innerHTML += renderTurnReportModal(TURN_REPORT);
}
// Buckets a lap-report line by what it is, so the report can style rolls,
// pass/fail, Critical/Fumble results, and the closing summary differently.
function classifyLogLine(l) {
  if (l.startsWith("Move=") || l.startsWith("Gear ")) return "roll";
  if (l.startsWith("Control Task Check") || l.startsWith("Attack?") || l.startsWith("Gunner vs ")) return "hdr";
  if (l.startsWith("Dmg Ctrl:")) return "good";
  if (/ Success$/.test(l) || / Hit$/.test(l)) return "good";
  if (/ Fail$/.test(l) || / Miss$/.test(l)) return "bad";
  if (l.startsWith("Fumble chart") || /Critical/.test(l)) return "special";
  if (l.startsWith("Stops short") || l.startsWith("Every hex beside")) return "bad";
  if (l.startsWith("Moved ") || / crosses the finish line| is destroyed/.test(l)) return "summary";
  return "";
}
// A pop-up styled like an official motorsport lap report: every roll, every
// result, any Critical or Fumble, and the reason for any shortfall, for the
// hero's own ship, shown once after each of its turns (see finishTurn()).
function renderTurnReportModal(r) {
  const ship = getShip(r.shipId);
  const pct = r.maxHp ? Math.max(0, Math.min(100, Math.round(r.hp / r.maxHp * 100))) : 0;
  const naturalTN = legNaturalTN(r.leg);
  const cappedTxt = naturalTN > r.leg.finalTN ? ` (capped from ${naturalTN})` : "";
  return `<div class="modal-overlay" onclick="if(event.target===this) App.dismissTurnReport()">
    <div class="lapreport">
      <div class="lapreport-checker"></div>
      <div class="lapreport-banner">
        <div class="kicker">Official Lap Report — Leg ${r.legIndex + 1}</div>
        <div class="title">${ship ? iconThumbImg(ship) : ""}${esc(r.name)}</div>
      </div>
      <div class="lapreport-leg">
        <div><b>Tier ${r.leg.tier}${r.leg.mod !== 0 ? ` (Mod ${r.leg.mod >= 0 ? "+" : ""}${r.leg.mod})` : ""}/Target ${r.leg.finalTN}</b>${cappedTxt}</div>
        <div>${esc(r.leg.feature)}</div>
      </div>
      <div class="lapreport-stats">
        <div><small>Lane</small><b>${r.lane}</b></div>
        <div><small>Lap</small><b>${Math.min(r.laps, r.courseLaps)}/${r.courseLaps}</b></div>
        <div><small>Gear</small><b>${r.gear}</b></div>
        <div><small>HP</small><b>${r.hp}/${r.maxHp} (${pct}%)</b></div>
      </div>
      <div class="lapreport-body">${r.lines.map(l => `<div class="lapreport-line ${classifyLogLine(l)}">${esc(l)}</div>`).join("")}</div>
      <div class="lapreport-checker"></div>
      <div class="lapreport-footer"><button onclick="App.dismissTurnReport()">${r.won ? "🏁 Victory Lap" : "Continue"}</button></div>
    </div>
  </div>`;
}

/* ---------- Shipyard: build Ship Classes (the reusable hull) ----------
   See RULE_CHANGES.md 2026-10-03: a Ship Class holds the five mechanical
   stats and the hull's White icon number; multiple Ships (Hangar Bay) can be
   assembled from one Class. */
function renderShipyard() {
  let html = `<section class="card"><h2>Ship Classes</h2>
    <div class="row"><button onclick="App.addShipClass()">+ Add Ship Class</button>
    <label>Division <select onchange="App.setShipyardAddDivision(this.value)">
      ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === (STATE._shipyardAddDivision || "Comet") ? "selected" : ""}>${d} (Tier ${GDATA.DIVISION_TIER[d]})</option>`).join("")}
    </select></label></div>`;
  if (!STATE.shipClasses.length) html += `<p class="muted">No Ship Classes yet. A Class is a reusable hull -- build one here, then assemble one or more actual Ships from it in the Hangar Bay.</p>`;
  STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
  GDATA.DIVISIONS.forEach(div => {
    const classes = STATE.shipClasses.filter(c => c.division === div);
    const collapsed = !!STATE._shipyardDivCollapse[div];
    html += `<div class="divgroup"><div class="divhead" onclick="App.toggleShipyardDiv('${div}')">
      <button class="ghost collapse-btn" tabindex="-1">${collapsed ? "▸" : "▾"}</button>
      <b>${div}</b> <span class="muted">Tier ${GDATA.DIVISION_TIER[div]} · ${classes.length} ${classes.length === 1 ? "class" : "classes"}</span></div>`;
    if (!collapsed) {
      html += `<div class="divbody">`;
      if (!classes.length) html += `<p class="muted">No ${div} Ship Classes yet.</p>`;
      classes.forEach(cls => { html += renderShipClassCard(cls); });
      html += `</div>`;
    }
    html += `</div>`;
  });
  html += `</section>`;
  return html;
}
const STAT_LABEL = { thrust: "Thrust (G)", points: "Hit Points", control: "Control", gunner: "Gunner", damageControl: "Damage Control", damage: "Damage", armor: "Armor", range: "Range" };
function renderShipClassCard(cls) {
  const tier = carTier(cls.division);
  const collapsed = !!cls._collapsed;
  const spent = classBuildPointsSpent(cls);
  const budget = divisionBuildPoints(cls.division);
  const diff = budget - spent;
  const overBudget = diff < 0;
  const budgetStatus = overBudget ? `${-diff} OVER budget` : diff > 0 ? `${diff} under budget` : "exactly on budget";
  const shipsBuilt = STATE.ships.filter(s => s.classId === cls.id).length;
  let html = `<div class="subcard">
    <div class="row">
      <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleShipClassCollapse('${cls.id}')">${collapsed ? "▸" : "▾"}</button>
      ${iconThumbImg(cls)}
      <input class="name-input" value="${esc(cls.name)}" onchange="App.updateShipClass('${cls.id}','name',this.value)">
      ${collapsed ? "" : `<button class="ghost" title="Random Class name" onclick="App.rerollShipClassName('${cls.id}')">🎲</button>`}
      <label>Division
        <select onchange="App.updateShipClassDivision('${cls.id}',this.value)">
          ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === cls.division ? "selected" : ""}>${d}</option>`).join("")}
        </select></label>
      <span class="tag">Tier ${tier}</span>
      <span class="tag ${overBudget ? "danger" : ""}" title="Construction Points used vs this Class's Division budget">Construction Points ${spent} / ${budget} (${budgetStatus})</span>
      <span class="tag" title="How many Ships in the Hangar Bay are built from this Class">${shipsBuilt} ship${shipsBuilt === 1 ? "" : "s"} built</span>
      <button class="danger" style="margin-left:auto" onclick="App.deleteShipClass('${cls.id}')">Delete</button>
    </div>`;
  if (!collapsed) {
    html += `<table class="mktable shiptable classtable"><tr>${SHIP_STATS.map(s => `<th>${STAT_LABEL[s]}</th>`).join("")}</tr><tr>
      ${SHIP_STATS.map(s => `<td>${s === "damage" || s === "damageControl" ? `<b>${formatStatValue(cls, s)}</b> ` : ""}${numStepper(`<input type="number" style="width:48px" min="${shipStatBase(s)}" value="${cls[s]}" onchange="App.updateShipClassStat('${cls.id}','${s}',this.value)">`)}<div class="muted stat-next">(next +${mkStepCost(shipStatLevel(cls, s))}pt)</div></td>`).join("")}
    </tr></table>`;
    html += renderClassIconPicker(cls);
  }
  html += `</div>`;
  return html;
}
function renderClassIconPicker(cls) {
  const used = usedClassIconNumbers(cls.id, cls.division);
  const swatches = GDATA.SHIP_ICON_NUMBERS.map(num => {
    const selected = cls.icon === num;
    const takenByOther = used.has(num) && !selected;
    const btnCls = ["iconbtn"].concat(selected ? ["selected"] : []).concat(takenByOther ? ["used"] : []).join(" ");
    const title = takenByOther ? `Already used by another ${cls.division} Ship Class` : (selected ? `Icon ${num} (click to remove)` : `Icon ${num}`);
    const action = takenByOther ? "disabled" : `onclick="App.updateShipClassIcon('${cls.id}','${selected ? "" : num}')"`;
    return `<button type="button" class="${btnCls}" ${action} title="${title}"><img src="${esc(shipIconPath(cls.division, num, GDATA.SHIP_CLASS_ICON_COLOR))}" alt="Icon ${num}"></button>`;
  }).join("");
  return `<div class="row"><b>Icon</b></div><div class="iconpicker">${swatches}</div>`;
}

/* ---------- Cantina: build Crewmen (Pilot, Gunner, Engineer) ----------
   See RULE_CHANGES.md 2026-10-05 (Pilot/Gunner), 2026-10-08 (Engineer added).
   Each crewman starts at Pilot-0, Gunner-0, Engineer-0 and divides 6 points
   among the three, one point per increase. Built once -- no XP, no leveling
   after creation. */
function renderCantina() {
  let html = `<section class="card"><h2>Crewmen</h2>
    <div class="row"><button onclick="App.addCrewman()">+ Add Crewman</button></div>
    <p class="muted">Each crewman starts at Pilot-0, Gunner-0, and Engineer-0, then divides 6 points among Pilot, Gunner, and Engineer. A ship's crew shares one Pilot, one Gunner, and one Engineer value.</p>`;
  if (!STATE.crewmen.length) html += `<p class="muted">No Crewmen yet. A ship races with the Pilot, Gunner, and Engineer values of the crewman assigned to it (Hangar Bay) -- add one here first.</p>`;
  STATE.crewmen.forEach(crewman => { html += renderCrewmanCard(crewman); });
  html += `</section>`;
  return html;
}
function renderCrewmanCard(crewman) {
  const remaining = crewmanSplitRemaining(crewman);
  const assignedTo = STATE.ships.filter(s => s.crewmanId === crewman.id).map(s => s.name);
  return `<div class="subcard">
    <div class="row">
      <input class="name-input" value="${esc(crewman.name)}" onchange="App.updateCrewman('${crewman.id}','name',this.value)">
      <button class="ghost" title="Random name" onclick="App.rerollCrewmanName('${crewman.id}')">🎲</button>
      <span class="tag ${remaining < 0 ? "danger" : ""}">${remaining} split point${remaining === 1 ? "" : "s"} left</span>
      <span class="muted">${assignedTo.length ? `Piloting: ${assignedTo.map(n => esc(n)).join(", ")}` : "Unassigned"}</span>
      <button class="danger" style="margin-left:auto" onclick="App.deleteCrewman('${crewman.id}')">Delete</button>
    </div>
    <table class="mktable shiptable"><tr><th>Pilot</th><th>Gunner</th><th>Engineer</th></tr><tr>
      <td>${numStepper(`<input type="number" style="width:48px" min="${GDATA.CREWMAN_BASE}" value="${crewman.pilot}" onchange="App.updateCrewmanSkill('${crewman.id}','pilot',this.value)">`)}</td>
      <td>${numStepper(`<input type="number" style="width:48px" min="${GDATA.CREWMAN_BASE}" value="${crewman.gunner}" onchange="App.updateCrewmanSkill('${crewman.id}','gunner',this.value)">`)}</td>
      <td>${numStepper(`<input type="number" style="width:48px" min="${GDATA.CREWMAN_BASE}" value="${crewman.engineer}" onchange="App.updateCrewmanSkill('${crewman.id}','engineer',this.value)">`)}</td>
    </tr></table>
  </div>`;
}

/* ---------- Hangar Bay: assemble Ships from a Ship Class + a crewman + sponsor ---------- */
function renderHangarBay() {
  if (!STATE.shipClasses.length) {
    return `<section class="card"><h2>Ships</h2>
      <p class="muted">No Ship Classes yet. Build one in the Shipyard tab first, then come back here to assemble a Ship from it.</p></section>`;
  }
  let html = `<section class="card"><h2>Ships</h2>
    <div class="row"><button onclick="App.addShip()">+ Add Ship</button>
    <button class="ghost" onclick="App.randomShipName()">🎲 Name Idea</button> <span id="nameIdea" class="muted"></span></div>`;
  if (!STATE.ships.length) html += `<p class="muted">No ships yet.</p>`;
  STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
  GDATA.DIVISIONS.forEach(div => {
    const ships = STATE.ships.filter(s => { const cls = getShipClass(s.classId); return cls && cls.division === div; });
    const collapsed = !!STATE._hangarDivCollapse[div];
    html += `<div class="divgroup"><div class="divhead" onclick="App.toggleHangarDiv('${div}')">
      <button class="ghost collapse-btn" tabindex="-1">${collapsed ? "▸" : "▾"}</button>
      <b>${div}</b> <span class="muted">${ships.length} ${ships.length === 1 ? "ship" : "ships"}</span></div>`;
    if (!collapsed) {
      html += `<div class="divbody">`;
      if (!ships.length) html += `<p class="muted">No ${div} ships yet.</p>`;
      ships.forEach(ship => { html += renderShipCard(ship); });
      html += `</div>`;
    }
    html += `</div>`;
  });
  const unassigned = STATE.ships.filter(s => !getShipClass(s.classId));
  if (unassigned.length) {
    html += `<div class="divgroup"><div class="divhead"><b>No Ship Class chosen yet</b></div><div class="divbody">${unassigned.map(s => renderShipCard(s)).join("")}</div></div>`;
  }
  html += `</section>`;
  return html;
}
function renderShipStatsTable(ship, cls, crewman, eff) {
  const sponsor = sponsorOf(ship);
  const bonusTotal = sponsorBonusTotal(sponsor), penaltyTotal = sponsorPenaltyTotal(sponsor);
  const sponsorCell = (kind, s) => {
    const other = kind === "bonus" ? "penalty" : "bonus";
    const blocked = !!sponsor[other][s];
    const max = kind === "bonus" ? SPONSOR_BONUS_MAX : SPONSOR_PENALTY_MAX;
    return `<td>${numStepper(`<input type="number" style="width:48px" min="0" max="${max}" value="${sponsor[kind][s] || 0}" ${blocked ? `disabled title="This stat already has a ${other}"` : ""} onchange="App.setSponsor('${ship.id}','${kind}','${s}',this.value)">`)}</td>`;
  };
  // The crewman's Pilot/Gunner/Engineer land on the matching ship stat
  // (Control/Gunner/Damage Control); the rest of the stats get no crew
  // contribution at all.
  const crewAdd = { control: eff.crewPilot, gunner: eff.crewGunner, damageControl: eff.crewEngineer };
  const crewCell = s => crewAdd[s] !== undefined ? `<td>${crewAdd[s]}</td>` : `<td class="muted">—</td>`;
  const grand = { ...eff, control: eff.control + eff.crewPilot, gunner: eff.gunner + eff.crewGunner, damageControl: eff.damageControl + eff.crewEngineer };
  return `<p class="muted" style="margin:4px 0">Spread up to ${SPONSOR_BONUS_MAX} bonus and ${SPONSOR_PENALTY_MAX} penalty points across any stats, as you like. Only one of bonus or penalty per stat.</p>
    <table class="mktable shiptable">
      <tr><th></th>${SHIP_STATS.map(s => `<th>${STAT_LABEL[s]}</th>`).join("")}</tr>
      <tr><th>Class</th>${SHIP_STATS.map(s => `<td>${formatStatValue(cls, s)}</td>`).join("")}</tr>
      <tr><th>Bonus (${bonusTotal}/${SPONSOR_BONUS_MAX})</th>${SHIP_STATS.map(s => sponsorCell("bonus", s)).join("")}</tr>
      <tr><th>Penalty (${penaltyTotal}/${SPONSOR_PENALTY_MAX})</th>${SHIP_STATS.map(s => sponsorCell("penalty", s)).join("")}</tr>
      <tr><th>Crew</th>${SHIP_STATS.map(s => crewCell(s)).join("")}</tr>
      <tr class="totals"><th>Total</th>${SHIP_STATS.map(s => `<td><b>${formatStatValue(grand, s)}</b></td>`).join("")}</tr>
    </table>`;
}
function renderShipCard(ship) {
  const cls = getShipClass(ship.classId);
  if (!cls) {
    return `<div class="subcard"><div class="row">
      <input class="name-input" value="${esc(ship.name)}" onchange="App.updateShip('${ship.id}','name',this.value)">
      <label>Ship Class
        <select onchange="App.updateShip('${ship.id}','classId',this.value)">
          <option value="">-- choose a Ship Class --</option>
          ${STATE.shipClasses.map(c => `<option value="${c.id}">${esc(c.name)} (${c.division})</option>`).join("")}
        </select></label>
      <button class="danger" onclick="App.deleteShip('${ship.id}')">Delete</button>
    </div></div>`;
  }
  const collapsed = !!ship._collapsed;
  const crewman = getCrewman(ship.crewmanId);
  const eff = carStats({ type: "hero", shipId: ship.id });
  let html = `<div class="subcard">
    <div class="row">
      <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleShipCollapse('${ship.id}')">${collapsed ? "▸" : "▾"}</button>
      ${iconThumbImg(ship)}
      <input class="name-input" value="${esc(ship.name)}" onchange="App.updateShip('${ship.id}','name',this.value)">
      ${collapsed ? "" : `<button class="ghost" title="Random ship name" onclick="App.rerollShipName('${ship.id}')">🎲</button>`}
      <label>Ship Class
        <select onchange="App.updateShip('${ship.id}','classId',this.value)">
          ${STATE.shipClasses.map(c => `<option value="${c.id}" ${c.id === ship.classId ? "selected" : ""}>${esc(c.name)} (${c.division})</option>`).join("")}
        </select></label>
      <label>Crew (Pilot skill / Gunner skill / Engineer skill)
        <select onchange="App.updateShip('${ship.id}','crewmanId',this.value)">
          <option value="">-- none --</option>
          ${STATE.crewmen.map(c => `<option value="${c.id}" ${c.id === ship.crewmanId ? "selected" : ""}>${esc(c.name)} (Pilot skill ${c.pilot}, Gunner skill ${c.gunner}, Engineer skill ${c.engineer})</option>`).join("")}
        </select></label>
      <span class="tag ${crewman ? "" : "danger"}" title="${crewman ? "All set -- race-legal" : "A Ship needs an assigned crewman to race"}">${crewman ? "Ready to race" : "🔒 Needs a crewman"}</span>
      <button class="danger" style="margin-left:auto" onclick="App.deleteShip('${ship.id}')">Delete</button>
    </div>`;
  if (!collapsed) {
    html += renderShipStatsTable(ship, cls, crewman, eff);
    html += `<p class="muted" style="margin:4px 0">Totals include the Ship Class plus any sponsor adjustment. Edit the class in the Shipyard and the crewman in the Cantina.</p>`;
    html += `<div class="row"><label style="flex:1">Other crew (flavor only)
      <input value="${esc(ship.flavorCrew || "")}" placeholder="e.g. Hot Dust, Mack" onchange="App.updateShip('${ship.id}','flavorCrew',this.value)" style="width:100%"></label></div>`;
    html += renderShipIconPicker(ship);
  }
  html += `</div>`;
  return html;
}
function renderShipIconPicker(ship) {
  const cls = getShipClass(ship.classId);
  if (!cls || !cls.icon) {
    return `<div class="row"><b>Icon</b></div>
      <p class="muted">Give "${esc(cls ? cls.name : "")}" an Icon in the Shipyard tab first -- a Ship's icon number always matches its Class's.</p>`;
  }
  const used = usedShipIconKeys(ship.id);
  const swatches = GDATA.SHIP_ICON_COLORS.map(color => {
    const selected = ship.iconColor === color;
    const takenByOther = used.has(`${cls.division}|${color}|${cls.icon}`) && !selected;
    const btnCls = ["iconbtn"].concat(selected ? ["selected"] : []).concat(takenByOther ? ["used"] : []).join(" ");
    const title = takenByOther ? "Already used by another ship" : (selected ? `${color} ${cls.icon} (click to remove)` : `${color} ${cls.icon}`);
    const action = takenByOther ? "disabled" : `onclick="App.updateShipIcon('${ship.id}','${selected ? "" : color}')"`;
    return `<button type="button" class="${btnCls}" ${action} title="${title}"><img src="${esc(shipIconPath(cls.division, cls.icon, color))}" alt="${color} ${cls.icon}"></button>`;
  }).join("");
  return `<div class="row"><b>Icon</b> <span class="muted">number ${cls.icon} (matches the Ship Class) -- pick a color</span></div>
    <div class="iconpicker">${swatches}</div>`;
}

/* ---------- Racecourse: Circular Track only -- see RULE_CHANGES.md 2026-10-03.
   The straight/Legs (non-hex) track type is gone entirely. ---------- */
function renderCourse() {
  let html = `<div class="grid2">`;
  html += `<section class="card"><h2>Design a Racecourse</h2>
    <div class="formrow"><label>Race Name</label>
      <input id="cName" placeholder="Roll or type a name">
      <button class="ghost" onclick="App.rollDraftName()">🎲</button></div>
    <div class="formrow"><label>Division</label>
      <select id="cDiv">${GDATA.DIVISIONS.map(d => `<option value="${d}">${d} (Tier ${GDATA.DIVISION_TIER[d]})</option>`).join("")}</select></div>
    <p class="muted">6 lanes on a real hex grid, each exactly 6 hexes longer per lap than the one inside it (an exact property of hex ring math). Race runs Leg by Leg until a racer completes the required laps -- there's no fixed Leg count.</p>
    <div class="formrow"><label>Inner Lane Hexes (approx.)</label>${numStepper(`<input id="cInnerHexes" type="number" min="1" value="50" oninput="App.previewLaneHexes(this.value)">`)}</div>
    <div class="formrow"><label>Laps to Finish</label>${numStepper(`<input id="cLaps" type="number" min="1" value="3">`)}</div>
    <div class="formrow"><label>Damage</label><label class="chkline"><input id="cFlatDamage" type="checkbox"> Flat 4 instead of rolling 1D6 (Racemaster option, faster game)</label></div>
    <div class="formrow"><label>Apply Leg Modifier To</label>
      <select id="cMode"><option value="tier">Tier (TN = (Tier+Mod)×3)</option><option value="tn">TN (TN = Tier×3 + Mod)</option><option value="none">Ignore modifier</option></select></div>
    <div class="formrow"><label>Asteroids</label>${numStepper(`<input id="cAsteroids" type="number" min="0" value="0">`)}
      <button class="ghost" title="Random (2D10)" onclick="App.rollAsteroidCount()">🎲</button></div>
    <table class="mktable"><tr><th>Lane</th>${Array.from({ length: 6 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
      <tr><td>Hexes/Lap</td>${laneHexesArray({ lanes: 6, innerHexes: 50 }).map((h, i) => `<td id="laneHexCol${i}">${h}</td>`).join("")}</tr></table>
    <button onclick="App.generateCourse()">Generate Racecourse</button>
  </section>`;

  html += `<section class="card"><h2>Saved Racecourses</h2>`;
  if (!STATE.courses.length) html += `<p class="muted">None yet — generate one on the left.</p>`;
  STATE.courses.forEach(c => {
    html += `<div class="subcard">
      <div class="row"><b>${esc(c.name)}</b> <span class="tag">${c.division}</span>
        <span class="tag">${c.lanes} lanes, inner ~${c.innerHexes} hexes</span> <span class="tag">${c.laps} laps</span>
        <span class="tag">${c.asteroidCount || 0} asteroids</span>
        <span class="muted">Legs are rolled fresh each race</span>
        <button class="danger" onclick="App.deleteCourse('${c.id}')">Delete</button></div>
    </div>`;
  });
  html += `</section></div>`;
  return html;
}

/* ---------- Race Setup ---------- */
function renderRaceSetup() {
  let html = `<section class="card"><h2>Set Up a Race</h2>`;
  if (!STATE.courses.length) { html += `<p class="muted">Create a racecourse first (Racecourse tab).</p></section>`; return html; }
  let courseId = STATE._raceSetupCourse;
  if (!courseId || !STATE.courses.some(c => c.id === courseId)) courseId = STATE.courses[0].id;
  STATE._raceSetupCourse = courseId; // keep in sync with what's displayed -- App.fillRandomNpcs() etc. read it directly
  const course = getCourse(courseId);
  const division = course.division;
  STATE._raceSetupShips = STATE._raceSetupShips || [];
  html += `<div class="formrow"><label>Racecourse</label><select id="raceCourseSel" onchange="App.setRaceSetupCourse(this.value)">
    ${STATE.courses.map(c => `<option value="${c.id}" ${c.id === courseId ? "selected" : ""}>${esc(c.name)} (${c.division}, ${c.laps} laps)</option>`).join("")}
  </select></div>`;
  html += `<p class="muted">${course.lanes} lanes, inner lane ~${course.innerHexes} hexes around, ${course.laps} laps to finish. Ships are assigned a starting lane automatically; may Slip a lane during the race.</p>`;
  const eligible = STATE.ships.filter(s => { const cls = getShipClass(s.classId); return cls && cls.division === division && getCrewman(s.crewmanId); });
  html += `<div class="formrow" style="align-items:flex-start"><label>Ships <span class="muted">(${division} Division)</span></label><div>
    ${eligible.length ? `<div class="ship-pick-list">${eligible.map(s => { const cls = getShipClass(s.classId); const note = classBudgetNote(cls); return `<label class="chkline"><input type="checkbox" value="${s.id}" ${STATE._raceSetupShips.includes(s.id) ? "checked" : ""} onchange="App.toggleRaceShip('${s.id}',this.checked)"> ${iconThumbImg(s)} ${esc(s.name)} <span class="muted budget-note${note.startsWith("Illegal") ? " danger-text" : ""}">${note}</span></label>`; }).join("")}</div>`
      : `<span class="muted">No ${division} Division ships ready yet — build a ${division} Ship Class in the Shipyard, then assemble a Ship with an assigned Crewman in the Hangar Bay.</span>`}
  </div></div>`;
  const draftNpcs = STATE._draftNpcs || [];
  const room = Math.max(0, course.lanes - STATE._raceSetupShips.length - draftNpcs.length);
  const divisionClasses = STATE.shipClasses.filter(c => c.division === division);
  html += `<div class="formrow" style="align-items:flex-start"><label>NPC Racers</label><div>
    <div class="npc-draft-grid">
      <button class="ghost" title="Random ship name" onclick="App.rollNpcName()">🎲</button>
      <input id="npcName" placeholder="NPC name">
      <button class="ghost" title="Randomize Aggression" onclick="App.randomizeDraftNpcAggression()">🎲</button>
      <label>Aggression ${numStepper(`<input id="npcAggression" type="number" min="1" max="10" value="${STATE._draftNpcAggression || 5}" style="width:48px">`)}</label>
      <button class="ghost" title="Randomize Ship Class" ${divisionClasses.length ? "" : "disabled"} onclick="App.randomizeDraftNpcClass()">🎲</button>
      <select id="npcClass" title="Which Ship Class this NPC is built from">
        <option value="">(auto-built, no specific Class)</option>
        ${divisionClasses.map(c => `<option value="${c.id}">${esc(c.name)} (${classBudgetNote(c)})</option>`).join("")}
      </select>
    </div>
    <div class="row">
      <button class="ghost" onclick="App.addDraftNpc()">+ Add</button>
      <button class="ghost" ${room ? "" : "disabled"} onclick="App.fillRandomNpcs()">🎲 Fill to ${course.lanes}${room ? ` (+${room})` : ""}</button>
    </div>
    <p class="muted" style="margin:0 0 6px">An NPC can be built from a specific Ship Class in this Division (its stats, not your sponsor adjustments), or left auto-built. Each NPC gets its own icon that no ship or class in the Division uses. Aggression (1-10, public knowledge) drives its automated gear changes, movement, and hunting other racers during the race.</p>
    <div id="npcList" class="npc-list">${draftNpcs.map((n, i) => { const cls = n.classId ? getShipClass(n.classId) : null; return `<div class="npc-row">
      <a href="#" class="npc-chip-x" title="Remove" onclick="App.removeDraftNpc(${i});return false;">×</a>
      <b>${esc(n.name)}</b> <span class="muted">${cls ? esc(cls.name) : "(auto-built)"}</span> <span class="muted">Aggr ${n.aggression}</span>
    </div>`; }).join("")}</div>
  </div></div>`;
  html += `<button onclick="App.beginRace()">Start Race</button></section>`;
  return html;
}

/* ---------- Standings ---------- */
// The empty hole inside the innermost lane, as a square in % of the track's width and height.
function holeSizePct(course) {
  const geom = circTrackGeometry(course);
  const ring = geom.laneHexLists[0];
  let d = Infinity;
  ring.forEach(h => {
    const { x, y } = hexToPixel(geom, h.q, h.r);
    d = Math.min(d, Math.hypot(x - geom.cx, y - geom.cy));
  });
  const side = Math.max(0, (d - geom.hexSize) * Math.SQRT2);
  const rotatedW = geom.vbH, rotatedH = geom.vbW;
  return { w: side / rotatedW * 100, h: side / rotatedH * 100 };
}
function renderStandings(race, center = "", below = "") {
  const course = getCourse(race.courseId);
  const ringParams = hexRingParamsForCourse(course);
  const legsCompleted = race.participants.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
  let html = `<section class="card"><div class="row spread"><h3>Standings</h3>
    <div>
      <button id="raceReplayLastLegBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(true)">▶ Show Last Leg</button>
      <button id="raceReplayBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(false)">▶ Show Entire Race</button>
    </div>
  </div>`;
  const holeBox = holeSizePct(course);
  html += `<div class="racegrid"><div class="racetrack"><div class="circtrack-wrap" id="circtrackWrap">${renderCircularTrackSvg(race, course)}<div class="track-center" style="width:${holeBox.w.toFixed(2)}%;height:${holeBox.h.toFixed(2)}%">${center}</div></div></div><div class="racestandings">`;
  html += `<div class="board" id="standingsBoard">`;
  // Racers are listed 1st to last by real track position, and each bar is
  // sized by that same real position -- not cumulative Movement, which can
  // diverge from where a car actually sits (see trackProgress()).
  const ordered = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  ordered.forEach(p => {
    const label = p.type === "hero" ? shipName(p.shipId) : p.name + " (NPC)";
    const pct = Math.min(100, Math.round((trackProgress(p, ringParams) / (course.laps * 6)) * 100));
    const info = participantIconInfo(p);
    const iconImg = info
      ? `<img class="boardicon" id="boardicon-${p.id}" src="${esc(shipIconPath(info.division, info.number, info.color))}" style="left:${pct}%" title="${esc(label)}">`
      : "";
    const outTag = p.out ? ` <span class="tag danger">${p.type === "hero" ? "OOC" : "out"}</span>` : "";
    const circTag = ` <span class="tag">Lane ${p.lane}</span> <span class="tag">Lap ${Math.min(p.laps || 0, course.laps)}/${course.laps}</span> <span class="tag">Gear ${p.gear || 0}</span>${p.initiative != null ? ` <span class="tag">Init ${p.initiative}</span>` : ""}`;
    const aggrTag = p.type === "npc" ? ` <span class="tag" title="Aggression -- drives this NPC's automated gear changes, movement, and hunting">Aggr ${p.aggression || 5}</span>` : "";
    html += `<div class="boardrow"><span class="boardname"><span class="boardname-inner"><span class="boardlabel">${esc(label)}${outTag}${circTag}${aggrTag}</span></span></span>
      <div class="boardtrack">
        <div class="boardtrack-inner">
          <div class="boardbar"><div class="boardfill${p.out ? " dead" : ""}" id="boardfill-${p.id}" style="width:${pct}%"></div></div>
          ${iconImg}
        </div>
      </div>
      <span class="boardpts" id="boardpts-${p.id}"></span></div>`;
  });
  html += `</div>${below}</div></div></section>`;
  return html;
}

// A winner's accolades, read from the race history and log.
function racerAccolades(race, p) {
  const course = getCourse(race.courseId);
  const name = participantLabel(p);
  let hits = 0, damage = 0;
  race.log.forEach(entry => {
    if (entry.name !== name) return;
    entry.lines.forEach(l => {
      if (/^Gunner check vs .* Hit\.$/.test(l)) hits++;
      const dmg = l.match(/^Damage .* = (\d+)\.$/);
      if (dmg) damage += Number(dmg[1]);
    });
  });
  const slips = (p.history || []).reduce((n, h) => n + (h.slipHexes || 0), 0);
  return [
    ["Laps", `${Math.min(p.laps || 0, course.laps)}/${course.laps}`],
    ["Hexes", p.cumulative || 0],
    ["Turns", (p.history || []).length],
    ["Slips", slips],
    ["Hits landed", hits],
    ["Damage dealt", damage],
  ];
}
function renderWinnerTile(race) {
  const w = race.winnerId ? race.participants.find(p => p.id === race.winnerId) : null;
  if (!w) return "";
  const info = participantIconInfo(w);
  const img = info ? esc(shipIconPath(info.division, info.number, info.color)) : "";
  return `<div class="winner-tile">
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="greenkey" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.01 -0.01 0 0 1"/></filter></svg>
    <div class="flagwrap"><div class="flagpole"></div><video class="checkflag" src="Flags/Waving%20Checked%20Flag.mp4" autoplay loop muted playsinline></video></div>
    <div class="winner-name">${esc(participantLabel(w))}</div>
    <div class="winner-label">Winner</div>
    ${img ? `<img class="winner-img" src="${img}" alt="">` : ""}
    <ul class="accolades">${racerAccolades(race, w).map(([k, v]) => `<li><small>${k}</small><b>${v}</b></li>`).join("")}</ul>
  </div>`;
}

/* ---------- Race ---------- */
function renderRace() {
  if (!STATE.race) return renderRaceSetup();
  const race = STATE.race;
  const course = getCourse(race.courseId);
  if (!course) return `<p class="muted">Course for this race was deleted. <button onclick="App.abandonRace()">Clear Race</button></p>`;
  let html = "";
  html += `<div class="row spread"><h2><span style="color:var(--muted)">${esc(course.division)}-Division</span> ${esc(course.name)}</h2>
    <button class="danger" onclick="App.abandonRace()">Abandon Race</button></div>`;
  if (!race.finished) {
    const leg = race.legState.leg;
    const naturalTN = legNaturalTN(leg);
    const tnTag = naturalTN > leg.finalTN ? ` <span class="tag">capped from ${naturalTN}</span>` : "";
    html += `<section class="card"><h2>Leg ${race.legIndex + 1}</h2>
      <p><b>Tier ${leg.tier}</b> — ${esc(leg.feature)} ${leg.mod !== 0 ? `<span class="tag">Mod ${leg.mod >= 0 ? "+" : ""}${leg.mod}</span>` : ""} — <b>Target Number: ${leg.finalTN}</b>${tnTag}</p>
    </section>`;
  }
  let center = "";
  if (!race.finished) {
    center = race.started === false
      ? `<div class="hub"><div class="hub-line"><b>Ready</b></div><button onclick="App.startRaceNow()">Start Race</button></div>`
      : renderTurnPanel(race);
  }
  if (race.finished) center = renderWinnerTile(race);
  const below = race.finished || race.started === false ? "" : renderTurnOrder(race);
  html += renderStandings(race, center, below);
  if (race.finished) {
    const winner = race.winnerId ? race.participants.find(p => p.id === race.winnerId) : null;
    html += `<section class="card winner"><h2>🏁 Race Complete</h2>${winner ? `<p><b>${esc(participantLabel(winner))}</b> wins!</p>` : `<p>Every Hero ship was destroyed.</p>`}${renderFinalStandings(race)}
      <button onclick="App.abandonRace()">Start a New Race</button></section>`;
    html += renderLog(race);
    return html;
  }
  html += renderLog(race);
  return html;
}

/* ---------- Turn order and the active turn ---------- */
function renderTurnOrder(race) {
  const ls = race.legState;
  const next = nextTurnParticipant(race);
  let html = `<section class="card"><h3>Turn order (lowest Thrust first)</h3>
    <table class="mktable"><tr><th>#</th><th>Racer</th><th>Thrust</th><th>Status</th></tr>`;
  ls.order.forEach((id, i) => {
    const p = race.participants.find(x => x.id === id);
    if (!p) return;
    const status = p.out ? "Wreck" : ls.cars[id].turnDone ? "Done" : (next && next.id === id ? "Up next" : "Waiting");
    html += `<tr><td>${i + 1}</td><td>${esc(participantLabel(p))}${p.type === "npc" ? ` <span class="tag">NPC</span>` : ""}</td><td>${carStats(p).thrust}</td><td>${status}</td></tr>`;
  });
  return html + `</table><p class="muted">Click a hex the ship moves into on the track: straight ahead, or a forward Slip left or right. Each hex you leave gets a dot until the turn ends. A red racer within your Range can be attacked, once per Leg.</p></section>`;
}
function renderTurnPanel(race) {
  const ls = race.legState;
  const next = nextTurnParticipant(race);
  if (ls.complete) {
    const n = race.legIndex + 1;
    return `<div class="hub"><div class="hub-line"><b>Leg ${n} complete</b></div><button onclick="App.startNextLeg()">Start Leg ${n + 1}</button></div>`;
  }
  if (next && next.type === "hero") {
    const t = race.legState.cars[next.id].turn;
    return t && t.awaiting ? renderAttackPrompt(race, next, t) : t && t.choice ? renderMovePrompt(race, next, t) : renderHeroTurnForm(race, next);
  }
  return "";
}
function shortRacerName(x) {
  const n = x.type === "npc" ? x.name : shipName(x.shipId);
  return n.length > 12 ? n.slice(0, 11) + "…" : n;
}
function renderAttackPrompt(race, p, t) {
  const targets = t.awaiting.map(id => race.participants.find(x => x.id === id)).filter(Boolean);
  const pick = targets.length > 1 ? `document.getElementById('atkTarget-${p.id}').value` : `'${targets[0].id}'`;
  const stats = carStats(p);
  const tn = race.legState.leg.finalTN;
  const mod = (GDATA.GEAR_TABLE[p.gear] || {}).mod || "";
  return `<div class="hub">
    <div class="hub-line"><b>Attack?</b> <span class="muted">${t.R} left</span></div>
    ${t.R > 0 ? `<div class="hub-line muted">Next Slip costs ${race.legState.cars[p.id].slipsThisLeg + 1}</div>` : ""}
    ${targets.length > 1
      ? `<select id="atkTarget-${p.id}">${targets.map(x => `<option value="${x.id}">${esc(shortRacerName(x))}</option>`).join("")}</select>`
      : `<div class="hub-line">${esc(participantLabel(targets[0]))}</div>`}
    <div class="hub-row">
      <button onclick="App.decideAttack('${p.id}', ${pick})">Attack</button>
      ${t.R > 0 ? moveAllCell(race, p, t) : ""}
      <button class="ghost" onclick="App.decideAttack('${p.id}', '')">${t.R > 0 ? "Decline" : "Finish"}</button>
    </div>
    <div class="hub-line muted">Gunner-${stats.gunner + stats.crewGunner}${mod} vs. TN (${tn})</div>
  </div>`;
}
function renderHeroTurnForm(race, p) {
  const car = race.legState.cars[p.id];
  const newGear = Math.max(0, Math.min(GDATA.MAX_GEAR, p.gear + car.gearChange));
  const dice = (GDATA.GEAR_TABLE[newGear] || {}).dice || 0;
  const mod = (GDATA.GEAR_TABLE[newGear] || {}).mod || "";
  const stats = carStats(p);
  const tn = race.legState.leg.finalTN;
  return `<div class="hub">
    <div class="hub-line"><b>${esc(shipName(p.shipId))}</b>${car.pendingD > 0 ? ` <span class="tag" title="Disadvantage on its next Control check">Hit</span>` : ""}</div>
    <div class="hub-row">
      <select onchange="App.setTurn('${p.id}','gearChange',this.value)" title="Gear ${p.gear}">
        <option value="1" ${car.gearChange === 1 ? "selected" : ""}>Shift up</option>
        <option value="0" ${car.gearChange === 0 ? "selected" : ""}>Hold</option>
        <option value="-1" ${car.gearChange === -1 ? "selected" : ""}>Shift down</option>
      </select>
      <button onclick="App.takeTurn('${p.id}')">Take turn</button>
    </div>
    ${p.hp < p.maxHp ? (() => { const dc = stats.damageControl + stats.crewEngineer; return `<label class="hub-line muted"><input type="checkbox" ${car.damageControl ? "checked" : ""} onchange="App.setTurn('${p.id}','damageControl',this.checked)"> Dmg Ctrl: 1d6${dc < 0 ? "-" + -dc : "+" + dc} (HP ${p.hp}/${p.maxHp})</label>`; })() : ""}
    <div class="hub-line muted">Gear ${newGear}: ${dice ? `${dice}D6 + ${stats.thrust}` : "no movement"}</div>
    <div class="hub-line muted">Control-${stats.control + stats.crewPilot}${mod} vs. TN (${tn})</div>
    <div class="hub-line muted">Gunner-${stats.gunner + stats.crewGunner}${mod} vs. TN (${tn})</div>
  </div>`;
}
function moveAllCell(race, p, t) {
  return straightRunClear(race, p, t) ? `<button class="ghost" onclick="App.moveAll('${p.id}')">Move All</button>` : `<span></span>`;
}
function renderMovePrompt(race, p, t) {
  const rollLine = `Move=[${t.rolled.join("+")}]+[T${t.thrustAtRoll}] = ${t.intended}`;
  const fumbleLine = t.log.filter(l => l.startsWith("Fumble chart")).join("; ");
  const stats = carStats(p);
  const toPass = (t.choice.occupantId && !t.choice.occupantHard)
    ? `<div class="hub-gap"></div>
    <div class="hub-line">To Pass</div>
    <div class="hub-line muted">Control-${stats.control + stats.crewPilot}${t.net ? netLabel(t.net) : ""} vs. TN (${t.tn})</div>
    <div class="hub-gap"></div>`
    : "";
  return `<div class="hub">
    <div class="hub-line muted">${esc(rollLine)}</div>
    <div class="hub-line muted">${esc(fumbleLine)}</div>
    <div class="hub-gap"></div>
    <div class="hub-line"><b>${t.R}</b> movement left</div>
    <div class="hub-line muted">Next Slip costs ${race.legState.cars[p.id].slipsThisLeg + 1}</div>
    ${toPass}
    ${straightRunClear(race, p, t) ? `<button onclick="App.moveAll('${p.id}')">Move All</button>` : `<div class="hub-line muted">Click a hex</div>`}
  </div>`;
}
function shipStatusTags(p, pendingD = 0) {
  const maxHp = p.maxHp != null ? p.maxHp : 0;
  const hp = p.hp != null ? p.hp : maxHp;
  let tags = "";
  const hpDanger = p.out || hp < maxHp / 2;
  tags += ` <span class="tag${hpDanger ? " danger" : ""}">HP ${hp}/${maxHp}</span>`;
  if (pendingD > 0) tags += ` <span class="tag" title="Disadvantage on its next Control check">Hit</span>`;
  if (p.out) tags += ` <span class="tag danger">${p.type === "hero" ? "Destroyed" : "Wreck"}</span>`;
  return tags;
}

/* ---------- Race Log / Final Standings ---------- */
function renderFinalStandings(race) {
  const course = getCourse(race.courseId);
  const ringParams = hexRingParamsForCourse(course);
  const sorted = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  let html = `<ol class="finallist">`;
  sorted.forEach(p => {
    const oocTag = p.out ? ` <span class="tag danger">${p.type === "hero" ? "Destroyed" : "Wreck"}</span>` : "";
    html += `<li><b>${esc(participantLabel(p))}</b> — ${Math.min(p.laps || 0, course.laps)}/${course.laps} laps, Lane ${p.lane}, ${p.cumulative} hexes${oocTag}</li>`;
  });
  html += `</ol>`;
  return html;
}
function renderLog(race) {
  if (!race.log.length) return "";
  let html = `<section class="card"><details><summary>Race Log</summary>`;
  const byLeg = new Map();
  race.log.forEach(e => { if (!byLeg.has(e.legIndex)) byLeg.set(e.legIndex, []); byLeg.get(e.legIndex).push(e); });
  [...byLeg.keys()].reverse().forEach(li => {
    html += `<h4>Leg ${li + 1}</h4>`;
    byLeg.get(li).forEach(e => {
      html += `<p><b>${esc(e.name)}</b></p><ul>${e.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
    });
  });
  html += `</details></section>`;
  return html;
}

/* ---------- Introduction / Instructions / Reference ---------- */
function renderIntroduction() {
  return `<section class="card">
    <p class="flavortext">Engines screaming at the edge of failure. Pilots threading impossibly narrow corridors of space. Crews gambling everything on a single, perfect run.</p>
    <p class="flavortext">Welcome to GASCAR.</p>
    <p>This volume pulls back the curtain on the most dangerous sport in civilized space, where sublight racers tear through asteroid belts, skim planetary atmospheres, and chase victory across entire star systems under the unforgiving laws of physics and competition.</p>
    <p>Inside, you'll find the full machinery of GASCAR: the history and racing divisions, and the ships that redefine what "safe operating limits" mean. From razor-edged Spark-class Skiffs to system-spanning Nova-class Clippers, and the brutal, ground-hugging Flash-class Skimmers that started it all, every class is built to win or break trying. Each ship is one entity on the track -- a single Pilot's seat of the pants, backed by however many crew it takes to keep it running -- and every race comes down to that one Pilot's nerve.</p>
    <p>But racing is more than machines and men. Circuits span worlds, each racecourse a carefully engineered gauntlet of hazards, strategy, and spectacle. And behind it all lies a complete system for designing abstract racecourses and running high-stakes competitions where every Leg counts and every mistake can be final.</p>
    <p>Whether you're building a ship, running a race, or simply trying to keep your hull from tearing itself apart at full burn, this book gives you everything you need.</p>
    <p class="flavortext">Strap in.</p>
    <p class="flavortext">The corridor is narrow. The engines are hot.</p>
    <p class="flavortext">And for a few fleeting moments… you may just be the fastest thing in the system.</p>

    <h3>GASCAR Divisions, Circuits, and Races</h3>
    <p>The Galactic Association for Spaceship Competitive Astro-Racing, known as GASCAR, is the primary regulatory and promotional authority for organized spaceship racing across the Federation. Founded several centuries after the expansion of reliable sublight travel pre-A.C., the organization arose from a loose collection of engineering clubs, courier guilds, and thrill-seeking pilots who began staging informal velocity competitions between planets, moons, and orbital stations. As both the technology, the crowds, and the explosions grew larger, the need for standardized safety rules, race corridors, and ship classifications eventually gave rise to GASCAR.</p>
    <p class="introcaption muted">GASCAR followed mankind into the Eos Galaxy</p>
    <p>Unlike military flight demonstrations or commercial courier trials, GASCAR races are conducted entirely under sublight propulsion and take place within the bounds of a single star system. Racecourses typically weave through complex gravitational environments-skimming planetary magnetospheres, threading asteroid belts, and diving through tightly controlled orbital corridors. The result is a form of competition that rewards not only raw acceleration, but also precise navigation and exceptional piloting skill.</p>
    <p>At the top of GASCAR's organizational structure are the Divisions. Each Division defines a Tier of performance every competing ship is built to. Within each Division, GASCAR sanctions numerous race Circuits, each consisting of a season of multiple races spread across Imperial space. Every Circuit season culminates in the Division Championship, a premier event hosted each year by a different star system.</p>
    <p>Spark and Comet Division races are often described as frantic and technical, with small craft darting through obstacles at extreme speeds. Meteor Division races emphasize sustained acceleration and tactical course management over much longer tracks. Nova Division racers compete in longer endurance events where precision and engine discipline become decisive factors.</p>

    <h3>Flash Division</h3>
    <p>Not all GASCAR competition takes place in the vacuum of space. Across the Federation, a parallel form of racing has developed using gravitic surfacecraft known as skimmers. These small anti-gravity racers compete in low-altitude racecourses that weave through planetary terrain, urban skylines, canyon systems, and natural hazards. Though technically a separate subclass of competition, most Flash races operate under the broader guidance and regulatory framework of GASCAR. Flash racers are tightly restricted by design -- no craft may exceed five tons displacement, and they are not allowed to break the local speed of sound.</p>

    <h3>Combat</h3>
    <p>Although GASCAR ships can carry weapons, their use in sanctioned competition is strictly prohibited. Every race is monitored through ship telemetry to reconstruct incidents, and electronic warfare can disable or corrupt that telemetry, making sabotage or attacks possible mid-race. For simplicity, assume every ship carries a basic Foreign Object Detection and Removal (FODaR) system for clearing debris from the course -- clever pilots may try to misuse it. Resolve such actions using the Attack Maneuver rules.</p>
  </section>`;
}
function renderInstructions() {
  return `<section class="card"><h2>How to Use This App</h2>
    <p class="muted" style="margin-top:-6px">v${APP_VERSION}</p>
    <p class="muted">Build things in this order, then run the race. Rules follow Circus Astralis (see RULE_CHANGES.md 2026-10-05).</p>

    <h3>1. Shipyard — build Ship Classes</h3>
    <p>A Ship Class is a reusable hull: a Division (sets its construction-point budget -- see the Divisions table below), a White icon, and eight stats -- Thrust, Hit Points, Control, Gunner, Damage Control (1D6 plus a bonus), Damage (1D6 plus a bonus), Armor, and Range -- bought up from base values (Thrust 1, Hit Points 10, Control 5, Gunner 5, Damage Control 1D6, Armor 0, Range 1, Damage 1D6). Raising a stat costs 1 construction point for the first point, 2 more for the second, 3 more for the third, and so on. The Shipyard shows how many points you've used against the budget.</p>

    <h3>2. Cantina — build Crewmen</h3>
    <p>Each crewman starts at Pilot-0, Gunner-0, and Engineer-0, then divides 6 points among Pilot, Gunner, and Engineer, one point per increase. A ship's crew shares one Pilot, one Gunner, and one Engineer value. Pilot is added to a ship's Control for its Control checks; Gunner is added to its Gunner stat for attacks; Engineer is added to its Damage Control roll.</p>

    <h3>3. Hangar Bay — assemble ships</h3>
    <p>A Ship is a name, a Ship Class, a crewman (who provides the Pilot, Gunner, and Engineer values), a Red/Green/Blue color for the Class's icon, and optional sponsor bonuses. A sponsor grants up to ${SPONSOR_BONUS_MAX} bonus points spread over up to ${SPONSOR_BONUS_MAX} stats, in exchange for a -${SPONSOR_PENALTY_MAX} penalty to one stat. A Ship needs a crewman assigned to race. Extra crew names are flavor only.</p>

    <h3>4. Racecourse &amp; Race — run it</h3>
    <p>Every course is a Circular Track: a hex-grid, 6 lanes. Set the Division, the inner-lane hex count, the laps to finish, and how many asteroids to scatter on the track (type a number or roll 2D10). Race Setup lists race-legal ships in the course's Division; NPC racers are added automatically from the same construction-point budget. The first ship across the finish line wins.</p>
    <p>Each Leg, ships take turns one at a time in <b>Thrust order</b> (lowest first; ties are broken with 1D20, lowest first). The lowest Thrust starts in the outermost lane. On a ship's turn:</p>
    <ol>
      <li><b>Damage Control</b> — offered at the start of the Leg, before Gear. If taken, roll 1D6 + Damage Control + crew Engineer and repair that much HP (never above max HP), but the ship cannot attack this Leg.</li>
      <li><b>Gear</b> — shift one level up or down (or hold). Gear 0 doesn't move; Gear 1-5 roll 1-5 D6 and add Thrust.</li>
      <li><b>Move</b> — the Movement counter shows the points left. Click the highlighted hex your ship moves into: straight ahead, or Slip left or right. The nth Slip of the Leg costs n movement points; the sideways shift is free. A Slip you can't afford isn't offered. Each hex you leave gets a dot until the turn ends.</li>
      <li><b>Control check</b> — made only when your movement roll exceeds the Leg TN (before you move) or when you enter an occupied hex. Roll 1D20 + Control + Pilot against the Leg's TN. Failure moves half the intended distance before the walk, or stops you where the check failed when it comes up during the walk.</li>
      <li><b>Walk</b> — the ship moves hex by hex, counting its movement points. Entering a hex occupied by a live racer or a wreck (straight on) forces a Control check: on success the ship passes through, on failure it stops short. An asteroid is a hard stop instead -- no check, no passing through it (and it deals 2 HP of damage, ignoring Armor). Landing on another ship or wreck's hex drifts to an open hex beside it (free), or rolls the Fumble Chart if every hex beside it is blocked.</li>
      <li><b>Attack</b> — if you pass within your Range (weapon range, 1 hex by default) of another racer, the turn pauses and asks whether to attack. You may attack once per Leg: roll 1D20 + Gunner + crew Gunner against the TN. On a hit, roll 1D6 plus the attacker's Damage bonus, minus the target's Armor. The target then carries one Disadvantage into its next Control check. No attacks are allowed on the first Leg.</li>
    </ol>
    <p>A ship that drops to 0 HP is destroyed and leaves a wreck that other ships can still try to pass -- same Control check as passing a live racer -- or must navigate around if the check fails. At the start of every Leg the wreck drifts 1-2 hexes forward (one hex at a time, a random pick among the three hexes ahead of it), never past the edge of the track or onto an occupied hex. A ship forced off the track loses 3 HP (ignoring Armor), starts the next Leg in Gear-1, and its turn ends.</p>
    <p>A Racecourse can also scatter a fixed number of asteroids among the lanes (chosen when the course is built), shown as spinning rock shapes with no ring around them. None start on a ship's starting hex. Each Leg, every asteroid drifts 1-2 hexes forward, staying in its own lane. A ship's own deliberate movement into an asteroid's hex is a hard stop -- no check, no passing through it -- and deals 2 HP of damage, ignoring Armor. But if a drifting asteroid moves into an active ship's hex, it shoves that ship into one of the three hexes ahead of it and deals 1 HP of damage, ignoring Armor; if all three are blocked, the ship rolls the Fumble Chart instead and its turn for the Leg ends. Starting a Leg plays a short animation of that Leg's asteroid drift and any ship it shoved, before play moves to the first ship's turn.</p>

    <p><b>Show Last Leg</b>/<b>Show Entire Race</b> (above Standings) replay each ship's movement at half speed, dropping a small colored dot at the center of every hex it passes through -- wreck and asteroid drift animate too. Click anywhere to clear the trail.</p>

    <p class="muted">The <b>Reference</b> tab has the Division table, the Gear table, the Task Check modifiers, the Fumble Chart, and Export/Import for your save data. Everything is saved automatically to this browser (localStorage) — use Export JSON on Reference for a backup file you control.</p>
  </section>`;
}
function renderReference() {
  let html = `<div class="grid2">`;
  html += `<section class="card"><h2>Data</h2>
    <p class="muted">Everything is saved automatically to this browser's local storage — closing the tab or the browser is safe. But clearing your browser's cache/site data (or opening the app in a different browser or on a different computer) will erase it, since nothing is uploaded anywhere. Use <b>Export JSON</b> to save a backup file you control, and <b>Import JSON</b> to restore it.</p>
    <div class="row"><button class="ghost" onclick="App.exportData()">Export JSON</button>
    <label class="ghost filebtn">Import JSON<input type="file" accept="application/json" onchange="App.importData(this.files[0])"></label>
    <button class="danger" onclick="App.resetAll()">Reset All Data</button></div>
  </section>`;

  html += `<section class="card"><h2>Name Generators</h2>
    <div class="row"><button onclick="App.rollRefRaceName()">🎲 Race Name</button><span id="refRaceName" class="tag"></span></div>
    <div class="row"><button onclick="App.rollRefShipName()">🎲 Ship Name</button><span id="refShipName" class="tag"></span></div>
  </section>`;

  html += `<section class="card"><h2>Divisions</h2><table class="mktable">
    <tr><th>Division</th><th>Tier</th><th>Crew (flavor)</th><th>Construction Points</th></tr>
    ${GDATA.DIVISIONS.map(d => { const t = GDATA.DIVISION_TIER[d]; return `<tr><td>${d}</td><td>${t}</td><td>${tierCrewCount(t)}</td><td>${divisionBuildPoints(d)}</td></tr>`; }).join("")}
  </table>
  <p class="muted">Every Ship Class stat costs the same: 1 point for the first increase above base, 2 for the next, 3 for the one after, and so on.</p></section>`;

  html += `<section class="card"><h2>Gear Table</h2>
    <p class="muted">Shift one gear per Leg (0-5). Movement is the dice plus the ship's Thrust.</p>
    <table class="mktable"><tr><th>Gear</th><th>Movement</th><th>Control check modifier</th></tr>
    ${[0, 1, 2, 3, 4, 5].map(g => { const e = GDATA.GEAR_TABLE[g]; return `<tr><td>${g}</td><td>${e.dice ? `${e.dice}D6 + Thrust` : "0"}</td><td>${e.mod || "—"}</td></tr>`; }).join("")}
  </table></section>`;

  html += `<section class="card"><h2>Task Check Modifiers</h2>
    <p class="muted">Applied to Control checks (the Control Task Check and obstacle checks). Each Disadvantage level adds one die; Advantage levels add one die too. Gunner checks have no modifiers.</p>
    <table class="mktable"><tr><th>Condition</th><th>Modifier</th></tr>
    <tr><td>Gear 1 / Gear 2</td><td>AA / A</td></tr>
    <tr><td>Gear 4 / Gear 5</td><td>D / DD</td></tr>
    <tr><td>Movement exceeds the Leg TN</td><td>D</td></tr>
    <tr><td>Each hit taken from an attack (next Control check)</td><td>D per hit</td></tr>
    <tr><td>Fumble chart roll 18 (next Control check)</td><td>DD</td></tr>
  </table>
  <p class="muted">A Control check happens when the movement roll exceeds the Leg TN, and each time the ship enters an occupied hex. Slips never trigger a check on their own.</p></section>`;

  html += `<section class="card" style="grid-row: span 2;"><h2>Fumble Chart (2d10)</h2>
    <p class="muted">Rolled once per Fumble. Low rolls are beneficial, the middle is annoying, high rolls are catastrophic.</p>
    <table class="mktable"><tr><th>Roll</th><th>Result</th></tr>
    ${GDATA.FUMBLE_CHART.map(o => `<tr><td>${o.roll}</td><td>${esc(o.text)}</td></tr>`).join("")}
  </table></section>`;

  html += `</div>`;
  return html;
}

/* ---------- Replay trail ---------- */
const REPLAY_TRAIL_COLORS = ["#ff5a5a", "#5ad1ff", "#7dff5a", "#ffb84d", "#c77dff", "#ff5ac7", "#5affea", "#ffe45a"];
function replayTrailColorFor(participantIdx) { return REPLAY_TRAIL_COLORS[participantIdx % REPLAY_TRAIL_COLORS.length]; }
let REPLAY_TRAIL_DOTS = [];
function paintReplayTrailDot(geom, laneIdx0, hexPos, color) {
  const svg = document.querySelector(".circtrack");
  if (!svg) return;
  const host = svg.querySelector(".trackrot") || svg;
  const hex = geom.laneHexLists[laneIdx0][hexPos];
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", x.toFixed(1));
  dot.setAttribute("cy", y.toFixed(1));
  dot.setAttribute("r", (geom.hexSize * 0.16).toFixed(1));
  dot.setAttribute("class", "replaytraildot");
  dot.style.fill = color;
  host.appendChild(dot);
  REPLAY_TRAIL_DOTS.push(dot);
}
function clearReplayTrail() {
  REPLAY_TRAIL_DOTS.forEach(el => el.remove());
  REPLAY_TRAIL_DOTS = [];
}
let replayTrailClickListenerBound = false;
function ensureReplayTrailClickListener() {
  if (replayTrailClickListenerBound) return;
  replayTrailClickListenerBound = true;
  document.addEventListener("click", clearReplayTrail);
}

/* ============================== Actions (exposed as window.App) ============================== */
const App = {
  /* Shared */
  stepNum(btn, delta) {
    const input = btn.parentElement.querySelector("input");
    if (!input || input.disabled) return;
    const step = parseFloat(input.step) || 1;
    const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
    const max = input.max !== "" ? parseFloat(input.max) : Infinity;
    const v = Math.max(min, Math.min(max, (parseFloat(input.value) || 0) + delta * step));
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  },

  /* Ship Classes (Shipyard) */
  setShipyardAddDivision(val) {
    if (!GDATA.DIVISIONS.includes(val)) return;
    STATE._shipyardAddDivision = val;
    saveState(); render();
  },
  addShipClass() {
    const division = STATE._shipyardAddDivision || "Comet";
    STATE.shipClasses.push({ id: uid("class"), name: "New Ship Class", division, icon: "", ...freshClassStats() });
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse[division] = false;
    saveState(); render();
  },
  deleteShipClass(id) {
    const inUse = STATE.ships.some(s => s.classId === id);
    if (!confirm(inUse ? "Ships are built from this Class -- delete it anyway? They'll need a new Class chosen." : "Delete this Ship Class?")) return;
    STATE.shipClasses = STATE.shipClasses.filter(c => c.id !== id);
    saveState(); render();
  },
  updateShipClass(id, field, val) { getShipClass(id)[field] = val; saveState(); },
  rerollShipClassName(id) { getShipClass(id).name = rollShipName(); saveState(); render(); },
  updateShipClassDivision(id, val) {
    if (!GDATA.DIVISIONS.includes(val)) return;
    const cls = getShipClass(id);
    cls.division = val;
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse[val] = false;
    saveState(); render();
  },
  updateShipClassStat(id, stat, val) {
    const cls = getShipClass(id);
    cls[stat] = clampInt(val, shipStatBase(stat), 999, cls[stat]);
    saveState(); render();
  },
  toggleShipClassCollapse(id) { const c = getShipClass(id); c._collapsed = !c._collapsed; saveState(); render(); },
  toggleShipyardDiv(div) {
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse[div] = !STATE._shipyardDivCollapse[div];
    saveState(); render();
  },
  updateShipClassIcon(id, num) {
    const cls = getShipClass(id);
    if (!cls) return;
    if (!num) { cls.icon = ""; saveState(); render(); return; }
    if (STATE.shipClasses.some(c => c.id !== id && c.division === cls.division && c.icon === num)) {
      alert(`That icon is already used by another ${cls.division} Ship Class.`);
      return;
    }
    cls.icon = num;
    saveState(); render();
  },

  /* Crewmen (Cantina) */
  addCrewman() {
    STATE.crewmen.push(freshCrewman(rollHeroName()));
    saveState(); render();
  },
  deleteCrewman(id) {
    const inUse = STATE.ships.some(s => s.crewmanId === id);
    if (!confirm(inUse ? "A Ship has this Crewman assigned as pilot -- delete anyway? That Ship will need a new Crewman." : "Delete this Crewman?")) return;
    STATE.crewmen = STATE.crewmen.filter(c => c.id !== id);
    STATE.ships.forEach(s => { if (s.crewmanId === id) s.crewmanId = ""; });
    saveState(); render();
  },
  updateCrewman(id, field, val) { getCrewman(id)[field] = val; saveState(); },
  rerollCrewmanName(id) { getCrewman(id).name = rollHeroName(); saveState(); render(); },
  updateCrewmanSkill(id, field, val) {
    const crewman = getCrewman(id);
    const others = crewmanSplitSpent(crewman) - (crewman[field] - GDATA.CREWMAN_BASE);
    const maxForField = GDATA.CREWMAN_BASE + (GDATA.CREWMAN_SPLIT_POINTS - others);
    crewman[field] = clampInt(val, GDATA.CREWMAN_BASE, maxForField, crewman[field]);
    saveState(); render();
  },

  /* Ships (Hangar Bay) */
  addShip() {
    STATE.ships.push({ id: uid("ship"), name: "New Ship", classId: "", crewmanId: "", iconColor: "" });
    saveState(); render();
  },
  deleteShip(id) {
    if (!confirm("Delete this ship?")) return;
    STATE.ships = STATE.ships.filter(s => s.id !== id);
    saveState(); render();
  },
  updateShip(id, field, val) {
    const ship = getShip(id);
    ship[field] = val;
    // Changing Class invalidates a previously-picked color (a different
    // Class's icon number means the old color pick may now collide, or the
    // new Class has no icon at all yet) -- cleared, re-pick in the picker.
    if (field === "classId") ship.iconColor = "";
    saveState(); render();
  },
  randomShipName() { document.getElementById("nameIdea").textContent = rollShipName(); },
  rerollShipName(id) { getShip(id).name = rollShipName(); saveState(); render(); },
  toggleShipCollapse(id) { const s = getShip(id); s._collapsed = !s._collapsed; saveState(); render(); },
  toggleHangarDiv(div) {
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[div] = !STATE._hangarDivCollapse[div];
    saveState(); render();
  },
  updateShipIcon(id, color) {
    const ship = getShip(id);
    const cls = ship && getShipClass(ship.classId);
    if (!ship || !cls || !cls.icon) return;
    if (!color) { ship.iconColor = ""; saveState(); render(); return; }
    if (STATE.ships.some(s => s.id !== id && s.iconColor === color && getShipClass(s.classId) === cls)) {
      alert("That icon is already used by another ship.");
      return;
    }
    ship.iconColor = color;
    saveState(); render();
  },
  setSponsor(shipId, kind, stat, val) {
    const ship = getShip(shipId);
    const sponsor = sponsorOf(ship);
    ship.sponsor = sponsor;
    const max = kind === "bonus" ? SPONSOR_BONUS_MAX : SPONSOR_PENALTY_MAX;
    const others = (kind === "bonus" ? sponsorBonusTotal(sponsor) : sponsorPenaltyTotal(sponsor)) - (sponsor[kind][stat] || 0);
    const v = clampInt(val, 0, max - others, sponsor[kind][stat] || 0);
    sponsor[kind][stat] = v;
    // A stat takes a bonus or a penalty, never both.
    if (v > 0) {
      const opposite = kind === "bonus" ? "penalty" : "bonus";
      delete sponsor[opposite][stat];
    }
    saveState(); render();
  },

  /* Course */
  rollDraftName() { document.getElementById("cName").value = rollRaceName(); },
  rollAsteroidCount() { document.getElementById("cAsteroids").value = rollD(10) + rollD(10); },
  previewLaneHexes(val) {
    const inner = clampInt(val, 1, 999, 50);
    laneHexesArray({ lanes: 6, innerHexes: inner }).forEach((h, i) => {
      const cell = document.getElementById(`laneHexCol${i}`);
      if (cell) cell.textContent = h;
    });
  },
  generateCourse() {
    const name = document.getElementById("cName").value.trim() || rollRaceName();
    const division = document.getElementById("cDiv").value;
    const mode = document.getElementById("cMode").value;
    const innerHexes = clampInt(document.getElementById("cInnerHexes").value, 1, 999, 50);
    const laps = clampInt(document.getElementById("cLaps").value, 1, 999, 3);
    const flatDamage = !!document.getElementById("cFlatDamage").checked;
    const asteroidCount = clampInt(document.getElementById("cAsteroids").value, 0, 999, 0);
    STATE.courses.push({ id: uid("course"), name, division, lanes: 6, innerHexes, laps, legMode: mode, flatDamage, asteroidCount });
    saveState(); render();
  },
  deleteCourse(id) {
    if (!confirm("Delete this racecourse?")) return;
    STATE.courses = STATE.courses.filter(c => c.id !== id);
    saveState(); render();
  },

  /* Race setup */
  rollNpcName() { document.getElementById("npcName").value = rollShipName(); },
  randomizeDraftNpcClass() {
    const course = getCourse(STATE._raceSetupCourse);
    const classes = course ? STATE.shipClasses.filter(c => c.division === course.division) : [];
    const sel = document.getElementById("npcClass");
    sel.value = classes.length ? classes[rollD(classes.length) - 1].id : "";
  },
  addDraftNpc() {
    const input = document.getElementById("npcName");
    const v = input.value.trim();
    if (!v) return;
    const aggression = clampInt(document.getElementById("npcAggression").value, 1, 10, 5);
    const classId = document.getElementById("npcClass").value || null;
    STATE._draftNpcs = STATE._draftNpcs || [];
    STATE._draftNpcs.push({ name: v, aggression, classId });
    STATE._draftNpcAggression = aggression;
    input.value = "";
    render();
  },
  randomizeDraftNpcAggression() { document.getElementById("npcAggression").value = rollD(10); },
  removeDraftNpc(i) { STATE._draftNpcs.splice(i, 1); render(); },
  // Tops the draft up to the course's lane count (selected Ships count against
  // the same cap, see RULE_CHANGES.md 2026-10-08) with randomly named/aggression/
  // Ship Class NPCs (auto-built if the Division has no Ship Classes yet).
  fillRandomNpcs() {
    const course = getCourse(STATE._raceSetupCourse);
    if (!course) return;
    const classes = STATE.shipClasses.filter(c => c.division === course.division);
    STATE._draftNpcs = STATE._draftNpcs || [];
    const room = course.lanes - (STATE._raceSetupShips || []).length - STATE._draftNpcs.length;
    for (let i = 0; i < room; i++) {
      const classId = classes.length ? classes[rollD(classes.length) - 1].id : null;
      STATE._draftNpcs.push({ name: rollShipName(), aggression: rollD(10), classId });
    }
    saveState(); render();
  },
  setRaceSetupCourse(id) {
    STATE._raceSetupCourse = id;
    const course = getCourse(id);
    const div = course ? course.division : null;
    STATE._raceSetupShips = (STATE._raceSetupShips || []).filter(sid => shipDivision(getShip(sid)) === div);
    saveState(); render();
  },
  toggleRaceShip(id, checked) {
    STATE._raceSetupShips = (STATE._raceSetupShips || []).filter(x => x !== id);
    if (checked) STATE._raceSetupShips.push(id);
    saveState();
  },
  beginRace() {
    let courseId = STATE._raceSetupCourse;
    if (!courseId || !STATE.courses.some(c => c.id === courseId)) courseId = STATE.courses.length ? STATE.courses[0].id : null;
    if (!courseId) { alert("Create a racecourse first."); return; }
    const course = getCourse(courseId);
    const division = course.division;
    let shipIds = (STATE._raceSetupShips || []).filter(sid => { const s = getShip(sid); return s && shipDivision(s) === division && getCrewman(s.crewmanId); });
    let npcs = STATE._draftNpcs || [];
    // At least one racer total -- a hero isn't required, so an all-NPC race can be watched Leg by Leg.
    if (!shipIds.length && !npcs.length) { alert(`Select at least one ${division} Division ship, or add at least one NPC.`); return; }
    // No more racers than the course has lanes: keep the first N selected
    // ships, then fill any remaining lanes with the first drafted NPCs.
    if (shipIds.length + npcs.length > course.lanes) {
      shipIds = shipIds.slice(0, course.lanes);
      npcs = npcs.slice(0, Math.max(0, course.lanes - shipIds.length));
    }
    startRace(courseId, shipIds, npcs);
    STATE._draftNpcs = [];
    STATE._raceSetupShips = [];
    saveState(); render();
  },
  abandonRace() {
    if (!confirm("Abandon the current race?")) return;
    STATE.race = null; STATE._openDeclFor = null; saveState(); render();
  },
  dismissTurnReport() {
    TURN_REPORT = null; render();
  },

  /* Race play */
  moveAll(pid) {
    const race = STATE.race;
    if (!race || race.finished || race.started === false) return;
    const p = race.participants.find(x => x.id === pid);
    if (!p || !race.legState.cars[pid].turn || !straightRunClear(race, p, race.legState.cars[pid].turn)) return;
    moveAllStraight(race, p);
    afterHeroStep(race, p);
    saveState(); render();
  },
  setTurn(pid, field, val) {
    const race = STATE.race, car = race.legState.cars[pid];
    const p = race.participants.find(x => x.id === pid);
    if (field === "gearChange") {
      car.gearChange = clampInt(val, -1, 1, 0);
      if (p.gear + car.gearChange < 0) car.gearChange = -p.gear;
      if (p.gear + car.gearChange > GDATA.MAX_GEAR) car.gearChange = GDATA.MAX_GEAR - p.gear;
    }
    if (field === "damageControl") car.damageControl = !!val;
    saveState(); render();
  },
  startRaceNow() {
    const race = STATE.race;
    if (!race || race.started !== false) return;
    race.started = true;
    runAutomaticTurns(race);
    saveState(); render();
    playLegStartAnimation(race);
  },
  startNextLeg() {
    const race = STATE.race;
    if (!race || race.finished || !race.legState.complete) return;
    race.legIndex += 1;
    initLegState(race);
    runAutomaticTurns(race);
    saveState(); render();
    playLegStartAnimation(race);
  },
  takeTurn(pid) {
    const race = STATE.race;
    if (!race || race.finished || race.started === false) return;
    const p = race.participants.find(x => x.id === pid);
    if (!p || nextTurnParticipant(race) !== p || race.legState.cars[pid].turn) return;
    const car = race.legState.cars[pid];
    resolveTurn(race, p, { gearChange: car.gearChange, damageControl: car.damageControl });
    afterHeroStep(race, p);
    saveState(); render();
  },
  encounterChoice(pid, id) {
    const race = STATE.race;
    if (!race || race.finished || race.started === false) return;
    const p = race.participants.find(x => x.id === pid);
    if (!p) return;
    decideEncounter(race, p, id);
    afterHeroStep(race, p);
    saveState(); render();
  },
  decideAttack(pid, targetId) {
    const race = STATE.race;
    if (!race || race.finished || race.started === false) return;
    const p = race.participants.find(x => x.id === pid);
    if (!p) return;
    decideAttack(race, p, targetId);
    afterHeroStep(race, p);
    saveState(); render();
  },
  playRaceReplay(lastLegOnly) {
    const race = STATE.race;
    if (!race) return;
    const course = getCourse(race.courseId);
    const geom = circTrackGeometry(course);
    const ringParams = hexRingParamsForCourse(course);
    // "Last leg" means the most recent leg that has finished for every ship:
    // the leg before the one in progress, or the final leg once the race is over.
    const lastLeg = Math.max(0, race.finished || race.legState.complete ? race.legIndex : race.legIndex - 1);
    const fromLeg = lastLegOnly ? lastLeg : 0;
    // Ships and asteroids both replay through the same machinery (see
    // RULE_CHANGES.md 2026-10-09: asteroid drift is tracked the same way a
    // wreck's is) -- each tagged with its kind so the two differ only in
    // which DOM element/transform function they use.
    const movers = race.participants.map(p => ({ obj: p, kind: "ship" }))
      .concat((race.asteroids || []).map(a => ({ obj: a, kind: "asteroid" })));
    if (!movers.some(m => (m.obj.history || []).length)) return;
    const btnAll = document.getElementById("raceReplayBtn");
    const btnLast = document.getElementById("raceReplayLastLegBtn");
    if (btnAll) btnAll.disabled = true;
    if (btnLast) btnLast.disabled = true;
    ensureReplayTrailClickListener();
    const pickPosition = (obj) => {
      let pos = { lane: obj.startLane || 1, hexPos: obj.startHexPos || 0, laps: 0 };
      (obj.history || []).forEach(h => { if (h.leg - 1 < fromLeg) pos = h; });
      return pos;
    };
    const setBar = (p, pos) => {
      const pct = Math.min(100, Math.round((trackProgress({ laps: pos.laps || 0, lane: pos.lane, hexPos: pos.hexPos }, ringParams) / (course.laps * 6)) * 100));
      const fill = document.getElementById(`boardfill-${p.id}`);
      const icon = document.getElementById(`boardicon-${p.id}`);
      if (fill) fill.style.width = pct + "%";
      if (icon) icon.style.left = pct + "%";
    };
    const elIdFor = m => m.kind === "asteroid" ? `asteroid-${m.obj.id}` : `circracer-${m.obj.id}`;
    const placeAt = (m, pos, prevRotDeg) => m.kind === "asteroid" ? asteroidTransform(geom, pos.lane, pos.hexPos) : circRacerTransform(geom, pos, prevRotDeg).transform;
    // Every turn in the replay range, in the order the turns actually happened.
    const events = [];
    movers.forEach((m, mi) => {
      const perTurn = buildCircularLegWaypoints(m.obj, geom);
      (m.obj.history || []).forEach((rec, hi) => {
        if (rec.leg - 1 < fromLeg) return;
        if (lastLegOnly && rec.leg - 1 !== fromLeg) return;
        events.push({ m, mi, rec, wp: perTurn[hi] || [], seq: rec.seq || 0 });
      });
    });
    events.sort((a, b) => a.seq - b.seq);
    movers.forEach(m => {
      const pos = pickPosition(m.obj);
      const g = document.getElementById(elIdFor(m));
      if (g) g.setAttribute("transform", placeAt(m, pos));
      if (m.kind === "ship") setBar(m.obj, pos);
    });
    const hexStepDelay = 200, turnPause = 400;
    let idx = 0;
    function playTurn(ev, done) {
      let i = 0;
      function tick() {
        if (STATE.race !== race) return;
        if (i >= ev.wp.length) { if (ev.m.kind === "ship") setBar(ev.m.obj, ev.rec); done(); return; }
        const point = ev.wp[i++];
        const g = document.getElementById(elIdFor(ev.m));
        if (g) {
          const rotMatch = /rotate\(([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
          const prevRotDeg = rotMatch ? parseFloat(rotMatch[1]) : null;
          g.setAttribute("transform", placeAt(ev.m, point, prevRotDeg));
        }
        paintReplayTrailDot(geom, (point.lane || 1) - 1, point.hexPos || 0, replayTrailColorFor(ev.mi));
        setTimeout(tick, hexStepDelay);
      }
      tick();
    }
    function nextTurn() {
      if (STATE.race !== race) return;
      if (idx >= events.length) {
        if (btnAll) btnAll.disabled = false;
        if (btnLast) btnLast.disabled = false;
        return;
      }
      const ev = events[idx++];
      playTurn(ev, () => setTimeout(nextTurn, turnPause));
    }
    setTimeout(nextTurn, 400);
  },

  /* Reference */
  rollRefRaceName() { document.getElementById("refRaceName").textContent = rollRaceName(); },
  rollRefShipName() { document.getElementById("refShipName").textContent = rollShipName(); },

  /* Data */
  exportData() {
    const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gascar-race-data.json";
    a.click();
  },
  importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        STATE = Object.assign(defaultState(), data);
        migrateState(STATE);
        saveState(); render();
      } catch (e) { alert("Could not read that file: " + e.message); }
    };
    reader.readAsText(file);
  },
  resetAll() {
    if (!confirm("This clears ALL ships, courses, and the current race. Continue?")) return;
    STATE = defaultState(); saveState(); render();
  }
};
window.App = App;

/* ============================== Boot ============================== */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tabbtn").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  render();
  startUpdateCheck();
});
/* New-version banner: re-loads version.js (a fresh <script> tag, not
   fetch()) and compares its LATEST_APP_VERSION against this tab's own
   APP_VERSION. Also rechecks on every click (any button, tab, etc.) so an
   actively-used tab picks up a new deploy almost immediately instead of
   waiting up to 5 minutes -- throttled to at most once per MIN_CHECK_GAP so
   a burst of clicks still only costs one request. */
function startUpdateCheck() {
  const MIN_CHECK_GAP = 30 * 1000;
  let lastCheck = 0;
  const check = () => {
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP) return;
    lastCheck = now;
    const s = document.createElement("script");
    s.src = "version.js?" + now;
    s.onload = () => {
      if (typeof LATEST_APP_VERSION !== "undefined" && LATEST_APP_VERSION !== APP_VERSION) {
        document.getElementById("updateBannerText").textContent = `A new version (v${LATEST_APP_VERSION}) is available -- your open tab is still running v${APP_VERSION}.`;
        document.getElementById("updateBanner").hidden = false;
        clearInterval(intervalId);
        document.removeEventListener("visibilitychange", onVisible);
        document.removeEventListener("click", check);
      }
      s.remove();
    };
    s.onerror = () => s.remove();
    document.head.appendChild(s);
  };
  const onVisible = () => { if (!document.hidden) check(); };
  const intervalId = setInterval(check, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", onVisible);
  document.addEventListener("click", check);
  setTimeout(check, 5000);
}
