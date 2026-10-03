/* GASCAR — application logic (vanilla JS, no build step).
   GASCAR = Galactic Association for Spaceship Competitive Astro-Racing,
   the in-world racing league depicted in the tabletop game Warp Space: GASCAR.

   Circus Maximus conversion (see RULE_CHANGES.md 2026-10-03): every racer is
   a SINGLE entity -- one car, one Skill stat, one roll per Leg -- whether
   its crew is 1 person or 4. Movement comes from a Circus-Maximus-style
   gear die every Leg, unconditionally; a separate d20+Advantage/Disadvantage
   Skill Check only fires when something risky happens that Leg (a Slip, a
   Maneuver, high gear, crossing/landing on another car's hex), and only a
   FAILED Skill Check has consequences (the Out-of-Control chart) -- success is binary, no Crit
   bonus. NPCs are mechanically identical to Heroes. The old 4-position
   (Pilot/Navigator/Spotter/Engineer) Task Check system, Resistance checks,
   and the straight/Legs (non-hex) track type are gone entirely. The hex/
   Circular Track engine itself (traceLaneRing, circTrackGeometry,
   resolveSlipPath, etc.) is untouched -- it's the one piece of the old
   system explicitly kept. */

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
   This is the ONE dice mechanic in the whole game now -- the Skill Check,
   the Attack-to-hit roll, everything -- just with a different score/net/TN
   fed in each time. */
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
// House rule: a Skill Check's success is binary (no Crit bonus) -- margin of
// success doesn't matter, only margin of FAILURE (fumbleLevels -> how many
// times the Out-of-Control chart gets rolled). Still surfaces critLevels in
// the label for flavor/visibility even though nothing mechanical reads it.
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
  return { ships: [], courses: [], race: null };
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
function migrateState(state) {
  if (!state._circusMaximusConversion) {
    state.ships = [];
    state.courses = [];
    state.race = null;
    delete state.crew;
    delete state.shipClasses;
    state._circusMaximusConversion = true;
  }
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
function getCourse(id) { return STATE.courses.find(c => c.id === id); }
function shipName(shipId) { const s = getShip(shipId); return s ? s.name : "(deleted ship)"; }

/* ============================== Cars: Tier, build points, stats ==============================
   See RULE_CHANGES.md 2026-10-03. Division (Flash/Spark/Comet/Meteor/Nova) is
   FLAVOR ONLY -- it just picks a Tier and which Leg Feature flavor pool to
   draw from (GDATA.DIVISION_TIER/DIVISION_ATMOSPHERIC). Tier alone drives
   crew size and the build-point budget. A car (Hero ship or NPC alike) is
   six numbers -- Speed, Health, Armor, Attack, Damage, Skill -- bought up
   from a base line on one shared Tier-scaled point pool (Circus Maximus's
   own flat 6 at Tier 1, +1 per Tier beyond that). */
const CAR_STATS = ["speed", "health", "armor", "attack", "damage", "skill"];
function carTier(division) { return GDATA.DIVISION_TIER[division] || 1; }
function tierCrewCount(tier) { return (GDATA.TIERS[tier] || GDATA.TIERS[1]).crew; }
function tierBuildPoints(tier) { return (GDATA.TIERS[tier] || GDATA.TIERS[1]).buildPoints; }
// A stat's value before any points are spent -- Health is Tier x3 (GASCAR's
// own existing HP formula), everything else is Circus Maximus's own base
// (Skill 7, the rest 0 except Damage's minimum of 1).
function statBase(stat, tier) { return stat === "health" ? tier * 3 : GDATA.STAT_BASE[stat]; }
// Build points spent so far on one car, across all six stats -- kept as a
// single shared pool (see RULE_CHANGES.md) rather than Skill having its own
// budget, but routed through this one function so that split could be made
// later without touching every caller.
function buildPointsSpent(ship) {
  const tier = carTier(ship.division);
  return CAR_STATS.reduce((sum, stat) => sum + Math.max(0, (ship[stat] || 0) - statBase(stat, tier)) * GDATA.STAT_COSTS[stat], 0);
}
function buildPointsRemaining(ship) { return tierBuildPoints(carTier(ship.division)) - buildPointsSpent(ship); }
// A fresh car/NPC at its Division's baseline, nothing spent yet.
function freshCarStats(division) {
  const tier = carTier(division);
  const out = {};
  CAR_STATS.forEach(stat => { out[stat] = statBase(stat, tier); });
  return out;
}
// Every stat a participant (Hero ship OR NPC) fights with this race --
// unifies the two shapes (a Hero's stats live on its Ship; an NPC carries
// its own inline, see startRace()) so the rest of the engine never has to
// branch on p.type to read a stat.
function carStats(p) {
  const src = p.type === "hero" ? getShip(p.shipId) : p;
  const out = {};
  CAR_STATS.forEach(stat => { out[stat] = (src && src[stat]) || 0; });
  return out;
}
// A participant's Division -- lives on its Ship for a Hero, inline for an
// NPC (see startRace()). Needed anywhere Tier has to be looked up for a
// participant directly (e.g. a Maneuver's Tier-scaled self-cost).
function carDivision(p) { return p.type === "hero" ? getShip(p.shipId).division : p.division; }

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
var STAGGER_PER_LANE = 4;
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
// House rule: Racing Maneuvers (and Attack) can target a car within
// MANEUVER_RANGE_HEXES hexes (same lane or a nearby one), wrapping a lap in
// the same lane. A different lane's position is compared via real hex
// distance (cube coordinates).
var MANEUVER_RANGE_HEXES = 2;
function hexesWithinManeuverRange(geom, pA, pB) {
  const laneA = (pA.lane || 1) - 1, laneB = (pB.lane || 1) - 1;
  if (Math.abs(laneA - laneB) > MANEUVER_RANGE_HEXES) return false;
  if (laneA === laneB) {
    const circA = geom.laneHexLists[laneA].length || 1;
    return circularHexDist(pA.hexPos || 0, pB.hexPos || 0, circA) <= MANEUVER_RANGE_HEXES;
  }
  const hexA = geom.laneHexLists[laneA][(pA.hexPos || 0) % geom.laneHexLists[laneA].length];
  const hexB = geom.laneHexLists[laneB][(pB.hexPos || 0) % geom.laneHexLists[laneB].length];
  return hexDistance(hexA, hexB) <= MANEUVER_RANGE_HEXES;
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
// House rule (see RULE_CHANGES.md 2026-10-03): cars cannot occupy the same
// hex -- Circus Maximus's own "entering a space with another chariot"
// obstacle rule, not a shared-hex Disadvantage penalty (Crowded Field,
// retired). Resolves every active car's path in Circus Maximus's own turn
// order (lowest Speed stat first -- a slower car commits to its line
// before a faster one has to react to it), building up an occupied-hex set
// as each car's new position is settled.
// `paramsFor(p)` supplies { movement, slipHexes } for this pass -- the
// lock-time tentative gear roll (to decide if this Leg's Skill Check
// triggers), or the finish-time final amount after Out-of-Control effects
// (to actually place cars). `place=false` only DETECTS whether a car's path
// would cross or land on an occupied hex, mutating nothing. `place=true`
// also resolves what happens on an unavoidable landing collision: drift to
// an open hex truly adjacent (any of the 6 hex neighbors, any lane) to the
// blocked one, or -- if every neighbor is also taken -- automatically roll
// one Out-of-Control Chart entry, exactly as the book describes (no Skill
// Check attempt for that specific failure mode; the Leg's own Skill Check,
// if it triggered, is handled separately).
function resolveCarCollisions(race, geom, paramsFor, place) {
  const order = race.participants.filter(p => !p.out).sort((a, b) => {
    const diff = carStats(a).speed - carStats(b).speed;
    return diff !== 0 ? diff : Math.random() - 0.5;
  });
  // hexKey -> Set of participant ids currently claiming it. A Set (not a
  // plain boolean) matters because more racers than lanes can legitimately
  // start a race sharing a hex (startRace()'s lane assignment wraps round-
  // robin) -- removing just THIS car's own claim must never also drop
  // another car that's still legitimately sitting there.
  const occupied = new Map();
  const claim = (key, id) => { if (!occupied.has(key)) occupied.set(key, new Set()); occupied.get(key).add(id); };
  const unclaim = (key, id) => { const s = occupied.get(key); if (s) { s.delete(id); if (!s.size) occupied.delete(key); } };
  race.participants.forEach(p => { if (!p.out) claim(`${p.lane}|${p.hexPos}`, p.id); });
  const results = {};
  order.forEach(p => {
    unclaim(`${p.lane}|${p.hexPos}`, p.id); // this car is about to move off its current hex
    const { movement, slipHexes } = paramsFor(p);
    const dir = race.legState.cars[p.id].slip === "left" ? -1 : 1;
    const path = resolveSlipPath(geom, p.lane - 1, p.hexPos, movement, slipHexes, dir);
    let finalLaneIdx0 = path.finalLaneIdx0, finalHexPos = path.finalHexPos;
    const collided = path.steps.some(s => occupied.has(`${s.laneIdx0 + 1}|${s.hexPos}`)) || occupied.has(`${finalLaneIdx0 + 1}|${finalHexPos}`);
    if (place && occupied.has(`${finalLaneIdx0 + 1}|${finalHexPos}`)) {
      const hex = geom.laneHexLists[finalLaneIdx0][finalHexPos];
      let drifted = null;
      for (const d of HEX_DIRS) {
        const hit = geom.lookup.get(hexKey(hex.q + d.dq, hex.r + d.dr));
        if (hit && !occupied.has(`${hit.lane + 1}|${hit.index}`)) { drifted = hit; break; }
      }
      if (drifted) { finalLaneIdx0 = drifted.lane; finalHexPos = drifted.index; }
      else { rollOneOutOfControl(race, p); }
    }
    claim(`${finalLaneIdx0 + 1}|${finalHexPos}`, p.id);
    results[p.id] = { collided, finalLaneIdx0, finalHexPos, lapsGained: path.lapsGained, movement };
  });
  return results;
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
function renderCircularTrackSvg(race, course) {
  const geom = circTrackGeometry(course);
  const { vbW, vbH, iconSize } = geom;
  let svg = `<svg viewBox="0 0 ${vbW} ${vbH}" class="circtrack" role="img" aria-label="Circular track standings">`;
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
  race.participants.forEach(p => {
    const { laneIdx0, transform } = circRacerTransform(geom, p);
    const label = p.type === "hero" ? shipName(p.shipId) : p.name;
    const lapTag = `Lap ${Math.min(p.laps || 0, course.laps)}/${course.laps}`;
    const imgHref = p.iconColor && p.iconNumber && p.iconDivision ? esc(shipIconPath(p.iconDivision, p.iconNumber, p.iconColor)) : "";
    svg += `<g class="circracer${p.out ? " dead" : ""}" id="circracer-${p.id}" transform="${transform}">
      ${imgHref
        ? `<image href="${imgHref}" x="${(-iconSize / 2).toFixed(1)}" y="${(-iconSize / 2).toFixed(1)}" width="${iconSize.toFixed(1)}" height="${iconSize.toFixed(1)}"/>`
        : `<circle r="${(iconSize / 2).toFixed(1)}" class="circdot"/>`}
      <title>${esc(label)} — Lane ${laneIdx0 + 1}, ${esc(lapTag)}</title>
    </g>`;
  });
  svg += `</svg>`;
  return svg;
}
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

/* ============================== Icons ============================== */
function shipIconPath(division, number, color) { return `${GDATA.SHIP_ICON_DIR}${division} ${number} ${color}.png`; }
function iconThumbImg(obj) {
  const div = obj && (obj.type === "hero" ? obj.division : obj.iconDivision || obj.division);
  if (!obj || !obj.iconColor || !obj.iconNumber || !div) return "";
  return `<img class="iconthumb" src="${esc(shipIconPath(div, obj.iconNumber, obj.iconColor))}" title="${esc(div)} ${esc(obj.iconColor)} ${esc(obj.iconNumber)}">`;
}
// Picks a uniformly random (color, number) not already in usedKeys (a Set of
// "Color|Number" strings) -- used to give an NPC racer a random, distinct
// icon at race start. Returns null if all 45 are taken.
function pickRandomUnusedIcon(usedKeys) {
  const options = [];
  GDATA.SHIP_ICON_COLORS.forEach(color => GDATA.SHIP_ICON_NUMBERS.forEach(number => {
    const key = `${color}|${number}`;
    if (!usedKeys.has(key)) options.push({ color, number });
  }));
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}
function usedShipIconKeys(excludeId) {
  const used = new Set();
  STATE.ships.forEach(s => { if (s.id !== excludeId && s.iconColor && s.iconNumber) used.add(`${s.division}|${s.iconColor}|${s.iconNumber}`); });
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
  const scores = race.participants.map(p => carStats(p).skill);
  return (scores.length ? Math.max(...scores) : 0) + 18;
}
function legNaturalTN(leg) {
  return leg.finalMode === "tier" ? leg.tnTierMod : leg.finalMode === "tn" ? leg.tnTnMod : leg.baseTN;
}

/* ============================== Race engine ============================== */
function activeCars(race) {
  return race.participants.filter(p => !p.out || p.outLeg === race.legIndex);
}
function livingCars(race) {
  return race.participants.filter(p => !p.out);
}
function initLegState(race) {
  const course = getCourse(race.courseId);
  const leg = rollCircularLeg(course);
  leg.finalTN = Math.min(leg.finalTN, legTNCap(race));
  const cars = {};
  race.participants.forEach(p => {
    cars[p.id] = {
      gearChange: 0, // -1/0/+1, chosen at Declare (Heroes) or by autoDeclareNpc (NPCs)
      slip: "", slipHexes: 0, slipAdvantage: 0,
      maneuver: "", maneuverTarget: "",
      maneuverReceivedD: 0, maneuverInstigatedD: 0,
      declared: p.type === "npc", // NPCs auto-declare at lock time; Heroes must declare first
      gear: p.gear || 0, gearMovement: 0,
      triggered: false, collided: false, net: 0, skillCheck: null,
      outOfControlRolls: [],
      hexesLost: 0, stopped: false,
      autoLast: !!p.out
    };
  });
  race.legState = { leg, declLocked: false, cars };
  STATE._openDeclFor = null;
}
// Initiative = d20 + the car's own Speed stat.
function resolveInitiativeOrder(participants) {
  const rolled = participants.map(p => ({ p, val: rollD(20) + carStats(p).speed }));
  rolled.forEach(r => { r.p.initiative = r.val; });
  rolled.sort((a, b) => b.val - a.val);
  const result = [];
  let i = 0;
  while (i < rolled.length) {
    let j = i;
    while (j + 1 < rolled.length && rolled[j + 1].val === rolled[i].val) j++;
    if (j === i) { result.push(rolled[i].p); i++; continue; }
    result.push(...breakTieOrder(rolled.slice(i, j + 1).map(r => r.p)));
    i = j + 1;
  }
  return result;
}
function breakTieOrder(tied) {
  const rolled = tied.map(p => ({ p, val: rollD(20) + carStats(p).speed }));
  rolled.sort((a, b) => b.val - a.val);
  const result = [];
  let i = 0;
  while (i < rolled.length) {
    let j = i;
    while (j + 1 < rolled.length && rolled[j + 1].val === rolled[i].val) j++;
    if (j === i) { result.push(rolled[i].p); i++; continue; }
    result.push(...breakTieOrder(rolled.slice(i, j + 1).map(r => r.p)));
    i = j + 1;
  }
  return result;
}
function startRace(courseId, shipIds, npcs) {
  const course = getCourse(courseId);
  const participants = [];
  const usedIcons = new Set();
  shipIds.forEach(sid => {
    const ship = getShip(sid);
    participants.push({
      id: uid("hero"), type: "hero", shipId: sid, cumulative: 0, history: [],
      hp: ship.health, maxHp: ship.health, out: false, gear: 0
    });
    if (ship.iconColor && ship.iconNumber) usedIcons.add(`${ship.division}|${ship.iconColor}|${ship.iconNumber}`);
  });
  // An NPC racer is a full car in its own right now (see RULE_CHANGES.md) --
  // built the same way a Hero's ship is (freshCarStats() at the course's own
  // Division/Tier), not a stripped-down abstraction. It gets a random icon,
  // distinct from every Hero ship and every other NPC in this race.
  npcs.forEach(n => {
    const pick = pickRandomUnusedIcon(usedIcons);
    if (pick) usedIcons.add(`${course.division}|${pick.color}|${pick.number}`);
    const stats = n.stats || freshCarStats(course.division);
    participants.push({
      id: uid("npc"), type: "npc", name: n.name, aggression: clampInt(n.aggression, 1, 10, 5),
      division: course.division, ...stats,
      cumulative: 0, history: [], iconDivision: course.division, iconColor: pick ? pick.color : "", iconNumber: pick ? pick.number : "",
      hp: stats.health, maxHp: stats.health, out: false, gear: 0
    });
  });
  // Every racer starts in a lane, round-robin by Initiative, tracking laps
  // completed + hex position within the current lap. Outer lanes get a
  // staggered head start (see laneStartHexPos()).
  const order = resolveInitiativeOrder(participants);
  order.forEach((p, i) => {
    const laneIdx0 = i % course.lanes;
    p.lane = laneIdx0 + 1;
    p.hexPos = laneStartHexPos(laneIdx0);
    p.laps = 0;
    p.startLane = p.lane;
    p.startHexPos = p.hexPos;
  });
  const race = { courseId, legIndex: 0, participants, finished: false, log: [] };
  initLegState(race);
  STATE.race = race;
  saveState();
}
function participantLabel(p) { return p.type === "hero" ? shipName(p.shipId) : (p.name + " (NPC)"); }

/* ---------- Maneuvers (see RULE_CHANGES.md 2026-10-03) ----------
   One Maneuver per car per Leg, car vs. car. Nudge/Block/Ram always land:
   Disadvantage to the target, self-cost Disadvantage to the instigator, and
   BOTH cars' Skill Checks are triggered this Leg. Attack is the one with
   its own roll -- see applyAttack(). */
function maneuverDAmount(m, instigatorDivision) {
  return m.selfD === "Tier" ? carTier(instigatorDivision) : m.selfD;
}
// Attack: the instigator's own Attack score vs the Leg's TN (same
// rollCheck() as everything else, net=0 -- no situational Advantage/
// Disadvantage on the to-hit roll itself). A hit deals the instigator's
// Damage stat, reduced by the target's Armor (min 0), to the target's HP;
// 0 HP marks it out of the race, same as an Out-of-Control hit. A miss does
// nothing beyond the instigator's own selfD, already applied by the caller.
function applyAttack(race, instigator, target, tn) {
  const atkStats = carStats(instigator);
  const rc = rollCheck(atkStats.attack, 0, tn);
  if (!rc.success) return { hit: false, rc };
  const tgtStats = carStats(target);
  const dmg = Math.max(0, atkStats.damage - tgtStats.armor);
  target.hp = Math.max(0, target.hp - dmg);
  if (target.hp === 0 && !target.out) { target.out = true; target.outLeg = race.legIndex; }
  return { hit: true, rc, dmg };
}
// Automates one NPC's whole Declare step: gear shift, (Circular Track) Slip,
// and Maneuver -- all driven by its Leg Aggression (own Aggression + current
// standings position - 1). A ship further back gambles more, regardless of
// its base personality.
function autoDeclareNpc(race, p, legAggression, course, geom, positions) {
  const ls = race.legState, car = ls.cars[p.id];
  // Gear: push up while winning the aggression gamble, otherwise hold or
  // ease off -- simple, legible NPC behavior without a separate sub-system.
  const roll = rollD(20);
  if (roll <= legAggression) car.gearChange = 1;
  else if (roll > legAggression + 5) car.gearChange = -1;
  // Legal targets: excludes self, destroyed cars, and anyone out of
  // Maneuver range. "Logical" target: whoever's immediately ahead of it in
  // the standings.
  const legalTargets = race.participants.filter(x => x.id !== p.id && !x.out && hexesWithinManeuverRange(geom, p, x));
  const aheadOrder = race.participants
    .filter(x => x.id !== p.id && !x.out && positions[x.id] < positions[p.id])
    .sort((a, b) => positions[b.id] - positions[a.id]);
  const target = aheadOrder.find(x => legalTargets.includes(x)) || null;
  if (target && rollD(20) <= legAggression) {
    const margin = legAggression - rollD(20);
    // Deterministic pick by how decisively it rolled: Attack only once
    // genuinely aggressive (margin >= 6), otherwise the more severe
    // interference Maneuver.
    const mv = margin >= 6 ? GDATA.MANEUVERS.find(m => m.name === "Attack")
      : margin >= 3 ? GDATA.MANEUVERS.find(m => m.name === "Ram")
      : GDATA.MANEUVERS.find(m => m.name === "Nudge");
    car.maneuver = mv.name;
    car.maneuverTarget = target.id;
  }
  autoDeclareNpcSlip(race, p, legAggression, course, geom, target);
  car.declared = true;
}
// NPC Slip: one more independent d20<=legAggression roll decides whether
// the car attempts a Slip at all this Leg. A success always Slips at least
// 1; if a legal target exists but isn't in Maneuver range yet, a second
// roll decides whether to hunt it down instead of just leaning for
// speed/Advantage.
function autoDeclareNpcSlip(race, p, legAggression, course, geom, target) {
  const car = race.legState.cars[p.id];
  const roll = rollD(20);
  if (roll > legAggression) return;
  const margin = legAggression - roll;
  const amount = Math.max(1, Math.floor(margin / 2));
  const maxLeft = p.lane - 1, maxRight = course.lanes - p.lane;
  let dir = null, hexes = 0;
  const alreadyInRange = target && hexesWithinManeuverRange(geom, p, target);
  if (target && !alreadyInRange) {
    if (rollD(20) <= legAggression) {
      const towardLeft = target.lane < p.lane;
      const laneGap = Math.abs(target.lane - p.lane);
      const neededLanes = Math.max(0, laneGap - MANEUVER_RANGE_HEXES);
      const huntAmount = Math.min(amount, neededLanes, towardLeft ? maxLeft : maxRight);
      if (huntAmount > 0) { dir = towardLeft ? "left" : "right"; hexes = huntAmount; }
    }
  }
  if (dir === null) {
    const inward = (margin / legAggression) >= 0.5;
    dir = inward ? "left" : "right";
    hexes = Math.min(amount, dir === "left" ? maxLeft : maxRight);
  }
  if (hexes <= 0) return;
  car.slip = dir; car.slipHexes = hexes;
}
// Locks in Declarations: resolves gear shifts + movement, Maneuvers, Slip
// curve-touch A/D, and Skill Check triggers for every car at once. Heroes
// must have already declared; NPCs auto-declare here.
function lockDeclarations() {
  const race = STATE.race, ls = race.legState, course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const positions = standingsPositions(race, course);
  race.participants.filter(p => p.type === "npc" && !p.out).forEach(p => {
    autoDeclareNpc(race, p, legAggressionFor(p, positions), course, geom, positions);
  });
  // Gear + movement: unconditional, every car, every Leg.
  race.participants.forEach(p => {
    if (p.out) return;
    const car = ls.cars[p.id];
    p.gear = Math.max(0, Math.min(GDATA.MAX_GEAR, p.gear + car.gearChange));
    car.gear = p.gear;
    const stats = carStats(p);
    const dice = GDATA.GEAR_DICE[p.gear];
    const rolled = dice ? Array.from({ length: dice.n }, () => rollD(dice.d)).reduce((a, b) => a + b, 0) : 0;
    car.gearMovement = p.gear === 0 ? 0 : Math.max(0, rolled + stats.speed);
  });
  // Slip: curve-touch Advantage/Disadvantage, projected from this Leg's
  // just-rolled gear movement (the Slingshot/actual-path resolution happens
  // later in finishLeg(), once any Out-of-Control hex losses are known).
  race.participants.forEach(p => {
    if (p.out) return;
    const car = ls.cars[p.id];
    car.slipAdvantage = 0;
    if (!car.slip) { car.slipHexes = 0; return; }
    const maxLane = Math.min(car.slip === "left" ? p.lane - 1 : course.lanes - p.lane, car.gearMovement || 0);
    const hexes = clampInt(car.slipHexes, 0, Math.max(0, maxLane), 0);
    car.slipHexes = hexes;
    if (hexes <= 0) { car.slip = ""; return; }
    const originLaneIdx0 = p.lane - 1, originHexPos = p.hexPos || 0;
    const dir = car.slip === "left" ? -1 : 1;
    const projected = resolveSlipPath(geom, originLaneIdx0, originHexPos, car.gearMovement || 0, hexes, dir);
    let touchesCurve = !isHexOnStraight(geom, originLaneIdx0, originHexPos);
    for (let i = 0; !touchesCurve && i < projected.steps.length; i++) {
      const step = projected.steps[i];
      if (!isHexOnStraight(geom, step.laneIdx0, step.hexPos)) touchesCurve = true;
    }
    car.slipAdvantage = touchesCurve ? (car.slip === "right" ? hexes : -hexes) : 0;
  });
  // Maneuvers: resolve each declared Maneuver, applying its effect and
  // flagging both cars' Skill Checks as triggered.
  const tn = ls.leg.finalTN;
  race.participants.forEach(p => {
    if (p.out) return;
    const car = ls.cars[p.id];
    if (!car.maneuver) return;
    const mv = GDATA.MANEUVERS.find(m => m.name === car.maneuver);
    if (!mv) return;
    const target = race.participants.find(x => x.id === car.maneuverTarget);
    const dAmount = maneuverDAmount(mv, carDivision(p));
    car.maneuverInstigatedD += dAmount;
    car.maneuverTriggered = true;
    if (!target || target.out) return;
    const tCar = ls.cars[target.id];
    tCar.maneuverTriggered = true;
    if (mv.name === "Attack") {
      car.attackResult = applyAttack(race, p, target, tn);
    } else {
      tCar.maneuverReceivedD += mv.targetD;
    }
  });
  // Obstacle check (see RULE_CHANGES.md 2026-10-03): a TENTATIVE pass, using
  // this Leg's just-rolled gear movement, purely to decide whether a car's
  // intended path would cross or land on another car's hex -- Circus
  // Maximus's own "entering a space with another chariot" trigger. This
  // never actually moves anyone (place=false); the real placement (with
  // drift/auto-Out-of-Control on an unavoidable collision) happens in
  // finishLeg(), once Out-of-Control hex losses are known.
  const collisions = resolveCarCollisions(race, geom, p => {
    const c = ls.cars[p.id];
    return { movement: c.gearMovement, slipHexes: c.slip ? Math.min(c.slipHexes || 0, c.gearMovement) : 0 };
  }, false);
  // Skill Check trigger: a Slip beyond the first free hex, high gear (top 2
  // categories), a path that crosses/lands on another car's hex, or
  // running/receiving a Maneuver this Leg -- mapped directly from Circus
  // Maximus's own trigger list (an extra drift, an obstacle, high speed),
  // not invented GASCAR-specific conditions. Only ONE Skill Check is ever
  // rolled per Leg regardless of how many triggers fired.
  race.participants.forEach(p => {
    if (p.out) return;
    const car = ls.cars[p.id];
    const extraSlip = Math.max(0, (car.slipHexes || 0) - 1);
    const highGear = p.gear >= GDATA.HIGH_GEAR_TRIGGER;
    car.collided = !!(collisions[p.id] && collisions[p.id].collided);
    car.triggered = extraSlip > 0 || highGear || car.collided || !!car.maneuverTriggered;
    car.net = (car.slipAdvantage || 0) - (car.maneuverReceivedD || 0) - (car.maneuverInstigatedD || 0);
    car.declared = true;
  });
  // NPCs' own Skill Checks auto-resolve immediately (same spirit as their
  // whole Declare step being automated) -- only Heroes click their own.
  race.participants.filter(p => p.type === "npc" && !p.out).forEach(p => {
    const car = ls.cars[p.id];
    if (car.triggered) rollCarSkillCheck(race, p);
  });
  ls.declLocked = true;
}
function rollCarSkillCheck(race, p) {
  const ls = race.legState, car = ls.cars[p.id];
  if (car.skillCheck) return; // already rolled
  const stats = carStats(p);
  car.skillCheck = rollCheck(stats.skill, car.net, ls.leg.finalTN);
  for (let i = 0; i < car.skillCheck.fumbleLevels; i++) rollOneOutOfControl(race, p);
}
function rollOneOutOfControl(race, p) {
  const car = race.legState.cars[p.id];
  const entry = GDATA.OUT_OF_CONTROL[rollD(10) - 1];
  applyOutOfControlAffects(race, p, entry.affects || []);
  car.outOfControlRolls.push({ text: entry.text, applied: (entry.affects || []).slice() });
}
function applyOutOfControlAffects(race, p, affects) {
  const car = race.legState.cars[p.id];
  const stats = carStats(p);
  const tier = carTier(carDivision(p));
  affects.forEach(a => {
    if (a.type === "hp") {
      const dmg = Math.max(0, tier * a.tierMult - stats.armor);
      p.hp = Math.max(0, p.hp - dmg);
      if (p.hp === 0 && !p.out) { p.out = true; p.outLeg = race.legIndex; }
    } else if (a.type === "loseHexes") {
      car.hexesLost = (car.hexesLost || 0) + a.amount;
    } else if (a.type === "laneShift") {
      const course = getCourse(race.courseId);
      if (a.dir === "in" && p.lane > 1) p.lane -= 1;
      else if (a.dir === "out" && p.lane < course.lanes) p.lane += 1;
    } else if (a.type === "gearReset") {
      p.gear = 1;
    } else if (a.type === "stopped") {
      car.stopped = true;
    }
  });
}
function describeOutOfControlAffects(affects, tier) {
  if (!affects || !affects.length) return "No lasting effect.";
  return affects.map(a => {
    if (a.type === "hp") return `${Math.max(0, tier * a.tierMult)} HP damage (Tier ${tier} × ${a.tierMult}, before Armor)`;
    if (a.type === "loseHexes") return `lose ${a.amount} hexes of this Leg's movement`;
    if (a.type === "laneShift") return `pushed 1 lane ${a.dir === "in" ? "inward" : "outward"}`;
    if (a.type === "gearReset") return `gear drops to 1 next Leg`;
    if (a.type === "stopped") return `this Leg's movement ends now`;
    return "";
  }).filter(Boolean).join("; ");
}
function finishLeg() {
  const race = STATE.race, ls = race.legState;
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  // Precompute each car's final movement/Slip breakdown (independent of
  // where anyone else ends up) before collision resolution, which only
  // needs the totals, not how they were built up.
  const movementInfo = {};
  race.participants.forEach(p => {
    if (p.out) return;
    const car = ls.cars[p.id];
    const movement = car.stopped ? 0 : Math.max(0, (car.gearMovement || 0) - (car.hexesLost || 0));
    const declaredSlipHexes = car.slip ? (car.slipHexes || 0) : 0;
    const actualSlipHexes = Math.min(declaredSlipHexes, movement);
    // Slingshot: an inward Slip that touches a curve grants +1 bonus
    // Movement per hex actually Slipped this Leg -- pure extra forward
    // movement, gated on an ACTIVE dive toward the inside this Leg.
    const slingshotBonus = car.slipAdvantage < 0 ? actualSlipHexes : 0;
    movementInfo[p.id] = { total: movement + slingshotBonus, actualSlipHexes, slingshotBonus };
  });
  // Movement + Slip, resolved with the "no two cars share a hex" collision
  // rule (see RULE_CHANGES.md 2026-10-03, replacing Crowded Field) --
  // Circus Maximus's own turn order (lowest Speed first), drifting to an
  // open neighbor hex or auto-rolling Out-of-Control if fully boxed in.
  const results = resolveCarCollisions(race, geom, p => {
    const info = movementInfo[p.id];
    return { movement: info.total, slipHexes: info.actualSlipHexes };
  }, true);
  race.participants.forEach(p => {
    if (p.out) return;
    const r = results[p.id], info = movementInfo[p.id];
    p.cumulative += r.movement;
    p.lane = r.finalLaneIdx0 + 1;
    p.hexPos = r.finalHexPos;
    p.laps = (p.laps || 0) + r.lapsGained;
    p.history.push({ leg: race.legIndex + 1, movement: r.movement, lane: p.lane, laps: p.laps, hexPos: p.hexPos, slipHexes: info.actualSlipHexes, slingshotBonus: info.slingshotBonus, gear: p.gear });
  });
  // Race Log: Out-of-Control descriptions rolled this Leg, one entry per
  // roll (multiple Fumble Levels each get their own line), plus each car's
  // finishing order this Leg by real track position (cosmetic -- it has no
  // effect on actual Movement).
  const ringParams = hexRingParamsForCourse(course);
  const ordered = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  const rows = ordered.map((p, i) => ({
    id: p.id, name: participantLabel(p), type: p.type, position: i + 1,
    movement: (ls.cars[p.id] && ls.cars[p.id].gearMovement != null) ? (p.history[p.history.length - 1] || {}).movement || 0 : 0,
    out: !!p.out
  }));
  const outOfControl = [];
  race.participants.forEach(p => {
    const car = ls.cars[p.id];
    (car.outOfControlRolls || []).forEach(roll => outOfControl.push({ name: participantLabel(p), text: roll.text }));
  });
  race.log.push({ legIndex: race.legIndex, rows, outOfControl });

  // The race has no fixed Leg count -- it ends the moment any racer
  // completes the required laps, or every Hero is destroyed.
  const someoneFinished = race.participants.some(p => !p.out && (p.laps || 0) >= course.laps);
  const heroesLeft = race.participants.some(p => p.type === "hero" && !p.out);
  if (someoneFinished || !heroesLeft) {
    race.finished = true;
  } else {
    race.legIndex += 1;
    initLegState(race);
  }
  saveState();
}

/* ============================== UI ============================== */
let CURRENT_TAB = "hangar";
function setTab(tab) { CURRENT_TAB = tab; render(); }
function render() {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === CURRENT_TAB));
  const root = document.getElementById("view");
  if (CURRENT_TAB === "introduction") root.innerHTML = renderIntroduction();
  else if (CURRENT_TAB === "hangar") root.innerHTML = renderHangarBay();
  else if (CURRENT_TAB === "course") root.innerHTML = renderCourse();
  else if (CURRENT_TAB === "race") root.innerHTML = renderRace();
  else if (CURRENT_TAB === "instructions") root.innerHTML = renderInstructions();
  else root.innerHTML = renderReference();
}

/* ---------- Hangar Bay: build cars directly (no separate Ship Class layer --
   see RULE_CHANGES.md 2026-10-03: a car is just six numbers now, there's no
   complex stat block worth templating separately from the Ship itself). ---------- */
function renderHangarBay() {
  let html = `<section class="card"><h2>Ships</h2>
    <div class="row"><button onclick="App.addShip()">+ Add Ship</button>
    <label>Division <select onchange="App.setHangarAddDivision(this.value)">
      ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === (STATE._hangarAddDivision || "Comet") ? "selected" : ""}>${d} (Tier ${GDATA.DIVISION_TIER[d]})</option>`).join("")}
    </select></label>
    <button class="ghost" onclick="App.randomShipName()">🎲 Name Idea</button> <span id="nameIdea" class="muted"></span></div>`;
  if (!STATE.ships.length) html += `<p class="muted">No ships yet.</p>`;
  STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
  GDATA.DIVISIONS.forEach(div => {
    const ships = STATE.ships.filter(s => s.division === div);
    const collapsed = !!STATE._hangarDivCollapse[div];
    html += `<div class="divgroup"><div class="divhead" onclick="App.toggleHangarDiv('${div}')">
      <button class="ghost collapse-btn" tabindex="-1">${collapsed ? "▸" : "▾"}</button>
      <b>${div}</b> <span class="muted">Tier ${GDATA.DIVISION_TIER[div]} · ${ships.length} ${ships.length === 1 ? "ship" : "ships"}</span></div>`;
    if (!collapsed) {
      html += `<div class="divbody">`;
      if (!ships.length) html += `<p class="muted">No ${div} ships yet.</p>`;
      ships.forEach(ship => { html += renderShipCard(ship); });
      html += `</div>`;
    }
    html += `</div>`;
  });
  html += `</section>`;
  return html;
}
const STAT_LABEL = { speed: "Speed", health: "Health", armor: "Armor", attack: "Attack", damage: "Damage", skill: "Skill" };
function renderShipCard(ship) {
  const tier = carTier(ship.division);
  const collapsed = !!ship._collapsed;
  const remaining = buildPointsRemaining(ship);
  let html = `<div class="subcard">
    <div class="row">
      <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleShipCollapse('${ship.id}')">${collapsed ? "▸" : "▾"}</button>
      ${iconThumbImg(ship)}
      <input class="name-input" value="${esc(ship.name)}" onchange="App.updateShip('${ship.id}','name',this.value)">
      ${collapsed ? "" : `<button class="ghost" title="Random ship name" onclick="App.rerollShipName('${ship.id}')">🎲</button>`}
      <label>Division
        <select onchange="App.updateShipDivision('${ship.id}',this.value)">
          ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === ship.division ? "selected" : ""}>${d}</option>`).join("")}
        </select></label>
      <span class="tag">Tier ${tier}</span>
      <span class="tag">Crew ${ship.crew.length}/${tierCrewCount(tier)}</span>
      <span class="tag ${remaining < 0 ? "danger" : ""}">${remaining} build pt${remaining === 1 ? "" : "s"} left</span>
      <button class="danger" style="margin-left:auto" onclick="App.deleteShip('${ship.id}')">Delete</button>
    </div>`;
  if (!collapsed) {
    html += `<table class="mktable shiptable"><tr>${CAR_STATS.map(s => `<th>${STAT_LABEL[s]}</th>`).join("")}</tr><tr>
      ${CAR_STATS.map(s => `<td>${numStepper(`<input type="number" style="width:48px" min="${statBase(s, tier)}" value="${ship[s]}" onchange="App.updateShipStat('${ship.id}','${s}',this.value)">`)} <span class="muted">(${GDATA.STAT_COSTS[s]}pt)</span></td>`).join("")}
    </tr></table>`;
    html += `<div class="row" style="align-items:flex-start"><b>Crew</b><div style="flex:1;min-width:0">
      <p class="muted" style="margin:0 0 6px">Flavor only -- crew has no stats of its own; the ship's Skill above is what rolls.</p>
      ${ship.crew.map((name, i) => `<div class="row" style="margin:2px 0">
        <input value="${esc(name)}" onchange="App.updateCrewName('${ship.id}',${i},this.value)">
        <button class="ghost" title="Random name" onclick="App.rerollCrewName('${ship.id}',${i})">🎲</button>
      </div>`).join("")}
    </div></div>`;
    html += renderShipIconPicker(ship);
  }
  html += `</div>`;
  return html;
}
function renderShipIconPicker(ship) {
  const used = usedShipIconKeys(ship.id);
  const swatches = GDATA.SHIP_ICON_COLORS.flatMap(color => GDATA.SHIP_ICON_NUMBERS.map(num => {
    const selected = ship.iconColor === color && ship.iconNumber === num;
    const takenByOther = used.has(`${ship.division}|${color}|${num}`) && !selected;
    const cls = ["iconbtn"].concat(selected ? ["selected"] : []).concat(takenByOther ? ["used"] : []).join(" ");
    const title = takenByOther ? "Already used by another ship" : (selected ? `${color} ${num} (click to remove)` : `${color} ${num}`);
    const action = takenByOther ? "disabled" : `onclick="App.updateShipIcon('${ship.id}','${selected ? "" : color}','${selected ? "" : num}')"`;
    return `<button type="button" class="${cls}" ${action} title="${title}"><img src="${esc(shipIconPath(ship.division, num, color))}" alt="${color} ${num}"></button>`;
  })).join("");
  return `<div class="row"><b>Icon</b></div><div class="iconpicker">${swatches}</div>`;
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
    <div class="formrow"><label>Apply Leg Modifier To</label>
      <select id="cMode"><option value="tier">Tier (TN = (Tier+Mod)×3)</option><option value="tn">TN (TN = Tier×3 + Mod)</option><option value="none">Ignore modifier</option></select></div>
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
  if (!STATE.ships.length) { html += `<p class="muted">Build at least one ship first (Hangar Bay tab).</p></section>`; return html; }
  let courseId = STATE._raceSetupCourse;
  if (!courseId || !STATE.courses.some(c => c.id === courseId)) courseId = STATE.courses[0].id;
  const course = getCourse(courseId);
  const division = course.division;
  STATE._raceSetupShips = STATE._raceSetupShips || [];
  html += `<div class="formrow"><label>Racecourse</label><select id="raceCourseSel" onchange="App.setRaceSetupCourse(this.value)">
    ${STATE.courses.map(c => `<option value="${c.id}" ${c.id === courseId ? "selected" : ""}>${esc(c.name)} (${c.division}, ${c.laps} laps)</option>`).join("")}
  </select></div>`;
  html += `<p class="muted">${course.lanes} lanes, inner lane ~${course.innerHexes} hexes around, ${course.laps} laps to finish. Ships are assigned a starting lane automatically; may Slip a lane during the race.</p>`;
  const eligible = STATE.ships.filter(s => s.division === division);
  html += `<div class="formrow" style="align-items:flex-start"><label>Ships <span class="muted">(${division} Division only)</span></label><div>
    ${eligible.length ? eligible.map(s => `<label class="chkline"><input type="checkbox" value="${s.id}" ${STATE._raceSetupShips.includes(s.id) ? "checked" : ""} onchange="App.toggleRaceShip('${s.id}',this.checked)"> ${iconThumbImg(s)} ${esc(s.name)}</label>`).join("")
      : `<span class="muted">No ${division} Division ships built yet — build one in the Hangar Bay and set its Division to ${division}.</span>`}
  </div></div>`;
  html += `<div class="formrow" style="align-items:flex-start"><label>NPC Racers</label><div>
    <div class="row">
      <input id="npcName" placeholder="NPC name"><button class="ghost" title="Random ship name" onclick="App.rollNpcName()">🎲</button>
      <label>Aggression ${numStepper(`<input id="npcAggression" type="number" min="1" max="10" value="${STATE._draftNpcAggression || 5}" style="width:48px">`)}</label>
      <button class="ghost" title="Randomize Aggression" onclick="App.randomizeDraftNpcAggression()">🎲</button>
      <button class="ghost" onclick="App.addDraftNpc()">+ Add</button>
    </div>
    <p class="muted" style="margin:0 0 6px">NPCs are full cars built the same way a Hero's ship is (same Division/Tier budget, spent evenly). Aggression (1-10, public knowledge) drives its automated Maneuvers and Slip during the race.</p>
    <div id="npcList">${(STATE._draftNpcs || []).map((n, i) => `<span class="tag">${esc(n.name)} <span class="muted">(Aggr ${n.aggression})</span> <a href="#" onclick="App.removeDraftNpc(${i});return false;">×</a></span>`).join(" ")}</div>
  </div></div>`;
  html += `<button onclick="App.beginRace()">Start Race</button></section>`;
  return html;
}

/* ---------- Standings ---------- */
function renderStandings(race) {
  const course = getCourse(race.courseId);
  const ringParams = hexRingParamsForCourse(course);
  const legsCompleted = race.participants.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
  let html = `<section class="card"><div class="row spread"><h3>Standings</h3>
    <div>
      <button id="raceReplayLastLegBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(true)">▶ Show Last Leg</button>
      <button id="raceReplayBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(false)">▶ Show Entire Race</button>
    </div>
  </div>`;
  html += `<div class="circtrack-wrap" id="circtrackWrap">${renderCircularTrackSvg(race, course)}</div>`;
  html += `<div class="board" id="standingsBoard">`;
  // Racers are listed 1st to last by real track position, and each bar is
  // sized by that same real position -- not cumulative Movement, which can
  // diverge from where a car actually sits (see trackProgress()).
  const ordered = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  ordered.forEach(p => {
    const label = p.type === "hero" ? shipName(p.shipId) : p.name + " (NPC)";
    const pct = Math.min(100, Math.round((trackProgress(p, ringParams) / (course.laps * 6)) * 100));
    const div = p.type === "hero" ? getShip(p.shipId).division : p.iconDivision;
    const iconImg = p.iconColor && p.iconNumber && div
      ? `<img class="boardicon" id="boardicon-${p.id}" src="${esc(shipIconPath(div, p.iconNumber, p.iconColor))}" style="left:${pct}%" title="${esc(div)} ${esc(p.iconColor)} ${esc(p.iconNumber)}">`
      : "";
    const outTag = p.out ? ` <span class="tag danger">${p.type === "hero" ? "OOC" : "out"}</span>` : "";
    const circTag = ` <span class="tag">Lane ${p.lane}</span> <span class="tag">Lap ${Math.min(p.laps || 0, course.laps)}/${course.laps}</span> <span class="tag">Gear ${p.gear || 0}</span>${p.initiative != null ? ` <span class="tag">Init ${p.initiative}</span>` : ""}`;
    const aggrTag = p.type === "npc" ? ` <span class="tag" title="Aggression -- drives this NPC's automated Maneuvers and Slip">Aggr ${p.aggression || 5}</span>` : "";
    html += `<div class="boardrow"><span class="boardname"><span class="boardname-inner"><span class="thumbslot">${iconThumbImg(p.type === "hero" ? getShip(p.shipId) : p)}</span><span class="boardlabel">${esc(label)}${outTag}${circTag}${aggrTag}</span></span></span>
      <div class="boardtrack">
        <div class="boardtrack-inner">
          <div class="boardbar"><div class="boardfill${p.out ? " dead" : ""}" id="boardfill-${p.id}" style="width:${pct}%"></div></div>
          ${iconImg}
        </div>
      </div>
      <span class="boardpts" id="boardpts-${p.id}"></span></div>`;
  });
  html += `</div></section>`;
  return html;
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
  html += renderStandings(race);
  if (race.finished) {
    html += `<section class="card winner"><h2>🏁 Race Complete</h2>${renderFinalStandings(race)}
      <button onclick="App.abandonRace()">Start a New Race</button></section>`;
    html += renderLog(race);
    return html;
  }
  const leg = race.legState.leg;
  const naturalTN = legNaturalTN(leg);
  const tnTag = naturalTN > leg.finalTN ? ` <span class="tag">capped from ${naturalTN}</span>` : "";
  html += `<section class="card"><h2>Leg ${race.legIndex + 1}</h2>
    <p><b>Tier ${leg.tier}</b> — ${esc(leg.feature)} ${leg.mod !== 0 ? `<span class="tag">Mod ${leg.mod >= 0 ? "+" : ""}${leg.mod}</span>` : ""} — <b>Target Number: ${leg.finalTN}</b>${tnTag}</p>
  </section>`;
  html += renderDeclarations(race);
  if (race.legState.declLocked) html += renderResolve(race);
  html += renderLog(race);
  return html;
}

/* ---------- Declarations ---------- */
function renderDeclarations(race) {
  const ls = race.legState;
  const { header, collapsed } = renderPhaseCardOpen(race, "decl", "Declare Intentions");
  let html = header;
  if (ls.declLocked) {
    if (!collapsed) {
      html += `<table class="mktable decltable"><tr><th>Racer</th><th>Gear</th><th>Slip A/D</th><th>Maneuver</th><th>Maneuver Rec'd</th><th>Maneuver Inst'd</th><th title="Slip A/D + Maneuver Rec'd + Maneuver Inst'd -- the net fed into this car's Skill Check, if one is triggered.">Net</th></tr>`;
      race.participants.forEach(p => {
        if (p.out && p.outLeg !== race.legIndex) return;
        const car = ls.cars[p.id];
        const slipTag = car.slip ? ` <span class="tag">Slipped ${car.slip} ${car.slipHexes} (${netLabel(car.slipAdvantage || 0)})</span>` : "";
        const maneuverTarget = race.participants.find(x => x.id === car.maneuverTarget);
        const maneuverText = car.maneuver ? `${car.maneuver}${maneuverTarget ? ` (${participantLabel(maneuverTarget)})` : ""}` : "—";
        html += `<tr>${renderRacerCell(p)}<td>${p.gear}${car.gearChange ? ` (${car.gearChange > 0 ? "+" : ""}${car.gearChange})` : ""}</td><td>${p.lane}${slipTag}</td>
          <td>${maneuverText}</td><td>${netLabel(-car.maneuverReceivedD)}</td><td>${netLabel(-car.maneuverInstigatedD)}</td><td>${netLabel(car.net)}</td></tr>`;
      });
      html += `</table>`;
    }
    html += `</section>`;
    return html;
  }
  const heroes = race.participants.filter(p => p.type === "hero" && (!p.out || p.outLeg === race.legIndex));
  const allDeclared = heroes.every(p => ls.cars[p.id].declared);
  html += `<p class="muted">Intentions are declared privately, one ship at a time. Once every ship has declared, lock to reveal them all at once.</p>`;
  html += `<table class="mktable"><tr><th>Ship</th><th>Status</th><th></th></tr>`;
  heroes.forEach(p => {
    const car = ls.cars[p.id];
    html += `<tr><td>${iconThumbImg(getShip(p.shipId))} ${esc(shipName(p.shipId))}</td>
      <td>${car.declared ? '<span class="tag success">Declared</span>' : '<span class="tag">Not yet declared</span>'}</td>
      <td><button class="${car.declared ? "ghost" : ""}" onclick="App.openDeclModal('${p.id}')">${car.declared ? "Review / Edit" : "Declare Intentions"}</button></td></tr>`;
  });
  html += `</table>`;
  html += `<button ${allDeclared ? "" : "disabled"} onclick="App.lockDecl()">Lock Declarations (Reveal)</button>`;
  if (!allDeclared) html += ` <span class="muted">Waiting on: ${heroes.filter(p => !ls.cars[p.id].declared).map(p => esc(shipName(p.shipId))).join(", ")}</span>`;
  html += `</section>`;
  if (STATE._openDeclFor && ls.cars[STATE._openDeclFor]) html += renderDeclModal(race, STATE._openDeclFor);
  return html;
}
function renderRacerCell(p) {
  const name = p.type === "hero" ? shipName(p.shipId) : p.name;
  const icon = p.type === "hero" ? getShip(p.shipId) : p;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const line1 = esc(words[0] || "");
  const line2 = esc(words.slice(1).join(" "));
  const note = p.type === "npc" ? `NPC, Aggr ${p.aggression || 5}` : "";
  return `<td class="racercell">${iconThumbImg(icon)}<span class="racerlines"><span>${line1}</span><span>${line2}</span><span class="muted">${esc(note)}</span></span></td>`;
}
function renderDeclModal(race, pid) {
  const ls = race.legState, car = ls.cars[pid];
  const p = race.participants.find(x => x.id === pid);
  const course = getCourse(race.courseId);
  const geom = circTrackGeometry(course);
  const others = race.participants.filter(x => x.id !== pid && !x.out && hexesWithinManeuverRange(geom, p, x));
  const slipMaxLeft = p.lane - 1, slipMaxRight = course.lanes - p.lane;
  const newGear = Math.max(0, Math.min(GDATA.MAX_GEAR, p.gear + car.gearChange));
  const slipMax = car.slip === "left" ? slipMaxLeft : car.slip === "right" ? slipMaxRight : 0;
  return `<div class="modal-overlay" onclick="if(event.target===this) App.closeDeclModal()">
    <div class="modal-box">
      <div class="row spread"><h3>${iconThumbImg(getShip(p.shipId))} ${esc(shipName(p.shipId))} — Declare Intentions</h3><button class="ghost" onclick="App.closeDeclModal()">✕</button></div>
      <div class="formrow"><label>Gear (currently ${p.gear})</label>
        <select onchange="App.setDecl('${pid}','gearChange',this.value)">
          <option value="-1" ${car.gearChange === -1 ? "selected" : ""}>Shift down (-1)</option>
          <option value="0" ${car.gearChange === 0 ? "selected" : ""}>Hold</option>
          <option value="1" ${car.gearChange === 1 ? "selected" : ""}>Shift up (+1)</option>
        </select>
        <span class="muted">-> Gear ${newGear} this Leg (${newGear === 0 ? "no movement" : `${GDATA.GEAR_DICE[newGear].n}D${GDATA.GEAR_DICE[newGear].d} + Speed`})</span></div>
      <div class="formrow"><label>Slip (currently Lane ${p.lane})</label>
        <select onchange="App.setDecl('${pid}','slip',this.value)">
          <option value="" ${!car.slip ? "selected" : ""}>No change</option>
          ${slipMaxLeft > 0 ? `<option value="left" ${car.slip === "left" ? "selected" : ""}>Slip Left (inward)</option>` : ""}
          ${slipMaxRight > 0 ? `<option value="right" ${car.slip === "right" ? "selected" : ""}>Slip Right (outward)</option>` : ""}
        </select>
        ${car.slip ? ` ${numStepper(`<input type="number" min="1" max="${Math.max(1, slipMax)}" value="${Math.min(Math.max(1, car.slipHexes || 1), Math.max(1, slipMax))}" onchange="App.setDecl('${pid}','slipHexes',this.value)" style="width:56px">`)} hex(es) / ${slipMax} max` : ""}
      </div>
      <p class="muted" style="margin:-4px 0 10px">The first hex of Slip is free; any more hexes of Slip, high gear, your path crossing or landing on another car's hex, or running/receiving a Maneuver each trigger a Skill Check this Leg. Two cars can never end a Leg on the same hex -- an unavoidable collision drifts you to an open neighboring hex, or (if fully boxed in) rolls you straight onto the Out-of-Control Chart. Touching a curve anywhere along the way grants +1 Advantage per hex outward or -1 Disadvantage per hex inward.</p>
      <div class="formrow" style="align-items:flex-start"><label>Maneuver</label><div style="flex:1;min-width:0">
        <select class="monoselect" onchange="App.setManeuver('${pid}',this.value)">
          <option value="">none</option>
          ${GDATA.MANEUVERS.map(m => `<option value="${m.name}" ${car.maneuver === m.name ? "selected" : ""}>${padNbsp(m.name, 10)}${m.desc}</option>`).join("")}
        </select>
        ${car.maneuver ? `<div class="chkgrid" style="margin-top:6px">${others.length ? others.map(o => `<label class="chkline"><input type="radio" name="mantarget-${pid}" ${car.maneuverTarget === o.id ? "checked" : ""} onchange="App.setManeuverTarget('${pid}','${o.id}')"> ${esc(participantLabel(o))}</label>`).join("") : `<span class="muted">no other racers in range</span>`}</div>` : ""}
      </div></div>
      <button onclick="App.confirmDecl('${pid}')">I'm Done — Confirm Declaration</button>
    </div>
  </div>`;
}
function renderPhaseCardOpen(race, key, title) {
  const ls = race.legState;
  ls.phaseCollapsed = ls.phaseCollapsed || {};
  const collapsed = !!ls.phaseCollapsed[key];
  const header = `<section class="card"><h3>
    <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.togglePhaseCollapse('${key}')">${collapsed ? "▸" : "▾"}</button>
    ${title}
  </h3>`;
  return { header, collapsed };
}

/* ---------- Resolve: gear movement + (if triggered) the Skill Check ---------- */
function renderResolve(race) {
  const ls = race.legState;
  let html = `<section class="card"><h3>Resolve the Leg</h3>`;
  const active = race.participants.filter(p => !p.out || p.outLeg === race.legIndex);
  active.forEach(p => {
    const car = ls.cars[p.id];
    const label = p.type === "hero" ? shipName(p.shipId) : p.name;
    html += `<div class="subcard"><div class="row">${iconThumbImg(p.type === "hero" ? getShip(p.shipId) : p)} <b>${esc(label)}</b>${shipStatusTags(p)}</div>`;
    if (p.out) { html += `</div>`; return; }
    html += `<p>Gear ${p.gear}: rolled <b>${car.gearMovement}</b> hex${car.gearMovement === 1 ? "" : "es"} this Leg${car.slipAdvantage ? ` (Slip ${netLabel(car.slipAdvantage)})` : ""}</p>`;
    if (car.maneuver) {
      const target = race.participants.find(x => x.id === car.maneuverTarget);
      if (car.maneuver === "Attack" && car.attackResult) {
        html += `<p>Attack on ${target ? esc(participantLabel(target)) : "?"}: ${car.attackResult.hit ? `<b>Hit</b> for ${car.attackResult.dmg} HP` : "<b>Miss</b>"}</p>`;
      } else if (car.maneuver) {
        html += `<p>${esc(car.maneuver)}${target ? ` on ${esc(participantLabel(target))}` : ""}</p>`;
      }
    }
    if (p.type === "hero") {
      if (!car.triggered) {
        html += `<p class="muted">No Skill Check needed this Leg.</p>`;
      } else if (!car.skillCheck) {
        html += `<p class="muted">Net: <b>${netLabel(car.net)}</b> vs TN ${ls.leg.finalTN}</p>
          <button onclick="App.doSkillCheck('${p.id}')">Roll Skill Check</button>`;
      } else {
        const rc = car.skillCheck;
        html += `<p>Rolled ${rc.dice.join(", ")} → chosen ${rc.chosen} + ${carStats(p).skill} = <b>${rc.total}</b> vs TN ${rc.tn} → <b>${outcomeLabel(rc)}</b></p>`;
        const tier = carTier(carDivision(p));
        const rollsNeeded = rc.fumbleLevels;
        const rollsDone = car.outOfControlRolls.length;
        if (rollsDone < rollsNeeded) {
          html += `<button class="ghost" onclick="App.doOutOfControl('${p.id}')">Roll on Out-of-Control Chart${rollsNeeded > 1 ? ` (${rollsDone + 1} of ${rollsNeeded})` : ""}</button>`;
        } else {
          car.outOfControlRolls.forEach((roll, i) => {
            html += `<p class="fumbletext">${rollsNeeded > 1 ? `<b>Roll ${i + 1} of ${rollsNeeded}:</b> ` : ""}${esc(roll.text)}</p>
              <p class="muted">Applied: ${describeOutOfControlAffects(roll.applied, tier)}</p>`;
          });
        }
      }
    } else if (car.triggered && car.skillCheck) {
      const rc = car.skillCheck;
      html += `<p class="muted">Skill Check: rolled ${rc.dice.join(", ")} → <b>${rc.total}</b> vs TN ${rc.tn} → ${outcomeLabel(rc)}</p>`;
      if (car.outOfControlRolls.length) car.outOfControlRolls.forEach(roll => { html += `<p class="fumbletext">${esc(roll.text)}</p>`; });
    }
    html += `</div>`;
  });
  const allResolved = active.every(p => {
    if (p.out) return true;
    const car = ls.cars[p.id];
    if (!car.triggered) return true;
    if (!car.skillCheck) return false;
    return car.outOfControlRolls.length >= car.skillCheck.fumbleLevels;
  });
  html += `<button ${allResolved ? "" : "disabled"} onclick="App.doFinishLeg()">Finish Leg &amp; Update Board</button>`;
  if (!allResolved) html += ` <span class="muted">Waiting on every triggered Skill Check (and any Out-of-Control rolls) to finish.</span>`;
  html += `</section>`;
  return html;
}
function shipStatusTags(p) {
  const maxHp = p.maxHp != null ? p.maxHp : 0;
  const hp = p.hp != null ? p.hp : maxHp;
  let tags = "";
  const hpDanger = p.out || hp < maxHp / 2;
  tags += ` <span class="tag${hpDanger ? " danger" : ""}">HP ${hp}/${maxHp}</span>`;
  if (p.out) tags += ` <span class="tag danger">${p.type === "hero" ? "OOC — out of race" : "out — removed from race"}</span>`;
  return tags;
}

/* ---------- Race Log / Final Standings ---------- */
function renderFinalStandings(race) {
  const course = getCourse(race.courseId);
  const ringParams = hexRingParamsForCourse(course);
  const sorted = [...race.participants].sort((a, b) => trackProgress(b, ringParams) - trackProgress(a, ringParams));
  let html = `<ol class="finallist">`;
  sorted.forEach((p, i) => {
    const label = p.type === "hero" ? shipName(p.shipId) : p.name + " (NPC)";
    const oocTag = p.out ? ` <span class="tag danger">${p.type === "hero" ? "OOC" : "out"}</span>` : "";
    html += `<li>${i === 0 ? "🏆 " : ""}<b>${esc(label)}</b> — ${Math.min(p.laps || 0, course.laps)}/${course.laps} laps, Lane ${p.lane}, ${p.cumulative} hexes${oocTag}</li>`;
  });
  html += `</ol>`;
  return html;
}
function renderLog(race) {
  if (!race.log.length) return "";
  let html = `<section class="card"><details><summary>Race Log</summary>`;
  [...race.log].reverse().forEach(entry => {
    html += `<h4>Leg ${entry.legIndex + 1}</h4><table class="mktable"><tr><th>Pos</th><th>Racer</th><th>Movement</th></tr>`;
    entry.rows.forEach(r => {
      html += `<tr><td>${r.position}</td><td>${esc(r.name)}${r.type === "npc" ? ` <span class="tag">NPC</span>` : ""}</td><td>${r.out ? "OOC" : "+" + r.movement}</td></tr>`;
    });
    html += `</table>`;
    if (entry.outOfControl && entry.outOfControl.length) {
      html += `<div class="logfumbles"><b>Out of Control this Leg:</b>`;
      entry.outOfControl.forEach(f => { html += `<p class="fumbletext"><b>${esc(f.name)}:</b> ${esc(f.text)}</p>`; });
      html += `</div>`;
    }
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
    <p class="muted">Build things in this order, then run the race.</p>

    <h3>1. Hangar Bay — build ships</h3>
    <p>Each ship is one entity: a Division (which just picks a Tier and a flavor pool, nothing mechanical beyond that), a crew size fixed by Tier (flavor names only, no stats of their own), and six numbers -- Speed, Health, Armor, Attack, Damage, Skill -- bought up from a baseline on a shared Tier-scaled build-point budget (6 points at Tier 1, +1 per Tier). Skill is what rolls the Skill Check; Speed adds to every Leg's gear-die movement; Attack/Damage/Armor only matter if you run the Attack Maneuver.</p>

    <h3>2. Racecourse — design a race</h3>
    <p>Every course is a Circular Track: a real hex-grid, 6 lanes, each exactly 6 hexes longer per lap than the one inside it. Set the Division (flavor + Tier), inner lane hex count, and laps to finish -- the race has no fixed Leg count, it ends the moment any racer completes the required laps.</p>

    <h3>3. Race — run it</h3>
    <p>Race Setup filters selectable ships to the course's Division, and you can add NPC racers -- full cars in their own right, built the same way, each with an Aggression score (1-10) that drives its behavior. Each Leg:</p>
    <ol>
      <li><b>Declare</b> — shift your gear by at most 1 (0-5), optionally Slip a lane (Circular Track), and optionally run one Maneuver against a car within 2 hexes. NPCs declare automatically, driven by their Leg Aggression (Aggression + current standings position - 1 -- a car further back gambles more).</li>
      <li><b>Resolve</b> — movement is unconditional: your current gear's die (1D4 up to 2D6, scaling with gear 1-5; gear 0 is no movement) plus your Speed stat, rolled fresh every Leg. Two cars can never occupy the same hex -- movement is resolved in order of lowest Speed stat first, and a car whose path would land on an already-occupied hex drifts to an open neighboring hex, or rolls straight onto the Out-of-Control Chart if fully boxed in. A Skill Check (d20 + Skill + Advantage/Disadvantage vs the Leg's TN) only fires if something risky happened this Leg -- more than 1 hex of Slip, high gear (4-5), your path crossing or landing on another car's hex, or running/receiving a Maneuver. Success is binary (no bonus); a failed check rolls once on the Out-of-Control Chart per Fumble Level, and every roll's effects stack.</li>
      <li><b>Attack</b> is the one Maneuver with its own roll: the instigator's Attack score vs the Leg's TN. A hit deals the instigator's Damage stat (reduced by the target's Armor) to the target's HP; a miss does nothing further. It still costs the instigator Tier Disadvantage on their own Skill Check either way.</li>
      <li>A ship reduced to 0 HP (by Attack or an Out-of-Control hit) is marked out of the race and frozen at its crash position for the rest of the race.</li>
    </ol>
    <p><b>Show Last Leg</b>/<b>Show Entire Race</b> (above Standings) replay each ship's movement at half speed, dropping a small colored dot at the center of every hex it passes through. Click anywhere to clear the trail.</p>

    <p class="muted">The <b>Reference</b> tab has the Division table, the Maneuvers list, the Out-of-Control Chart, and Export/Import for your save data. Everything is saved automatically to this browser (localStorage) — use Export JSON on Reference for a backup file you control.</p>
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
    <tr><th>Division</th><th>Tier</th><th>Crew</th><th>Build Points</th></tr>
    ${GDATA.DIVISIONS.map(d => { const t = GDATA.DIVISION_TIER[d]; return `<tr><td>${d}</td><td>${t}</td><td>${tierCrewCount(t)}</td><td>${tierBuildPoints(t)}</td></tr>`; }).join("")}
  </table></section>`;

  html += `<section class="card"><h2>Racing Maneuvers</h2>
    <p class="muted">One Maneuver per car per Leg, against a car within 2 hexes.</p>
    <table class="mktable">
    <tr><th>Maneuver</th><th>Description</th><th>Self Cost</th><th>Deals</th></tr>
    ${GDATA.MANEUVERS.map(m => `<tr><td>${m.name}</td><td>${esc(m.desc)}</td><td>${m.selfD === "Tier" ? "Tier D's" : (m.selfD === 1 ? "1 D" : `${m.selfD} D's`)}</td><td>${m.targetD == null ? "Attack roll -> Damage stat" : (m.targetD === 1 ? "1 D" : `${m.targetD} D's`)}</td></tr>`).join("")}
  </table></section>`;

  html += `<section class="card" style="grid-row: span 2;"><h2>Out-of-Control Chart (1d10)</h2>
    <p class="muted">Rolled once per Fumble Level on a failed Skill Check -- every roll's effects apply and stack.</p>
    <table class="mktable"><tr><th>Roll</th><th>Result</th></tr>
    ${GDATA.OUT_OF_CONTROL.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.text)}</td></tr>`).join("")}
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
  const hex = geom.laneHexLists[laneIdx0][hexPos];
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", x.toFixed(1));
  dot.setAttribute("cy", y.toFixed(1));
  dot.setAttribute("r", (geom.hexSize * 0.16).toFixed(1));
  dot.setAttribute("class", "replaytraildot");
  dot.style.fill = color;
  svg.appendChild(dot);
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

  /* Ships */
  setHangarAddDivision(val) {
    if (!GDATA.DIVISIONS.includes(val)) return;
    STATE._hangarAddDivision = val;
    saveState(); render();
  },
  addShip() {
    const division = STATE._hangarAddDivision || "Comet";
    const tier = carTier(division);
    STATE.ships.push({
      id: uid("ship"), name: "New Ship", division,
      crew: Array.from({ length: tierCrewCount(tier) }, () => rollHeroName()),
      ...freshCarStats(division),
      iconColor: "", iconNumber: ""
    });
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[division] = false;
    saveState(); render();
  },
  deleteShip(id) {
    if (!confirm("Delete this ship?")) return;
    STATE.ships = STATE.ships.filter(s => s.id !== id);
    saveState(); render();
  },
  updateShip(id, field, val) { getShip(id)[field] = val; saveState(); },
  updateShipDivision(id, val) {
    if (!GDATA.DIVISIONS.includes(val)) return;
    const ship = getShip(id);
    const newTier = carTier(val), oldTier = carTier(ship.division);
    ship.division = val;
    // Crew count follows Tier -- grow with blank-filled names, or shrink
    // (trimming from the end) if the new Division's Tier is lower.
    const want = tierCrewCount(newTier);
    while (ship.crew.length < want) ship.crew.push(rollHeroName());
    if (ship.crew.length > want) ship.crew = ship.crew.slice(0, want);
    // Stat bases shift with Tier (Health especially) -- never drop a stat
    // the player already raised above the new base.
    CAR_STATS.forEach(stat => { ship[stat] = Math.max(ship[stat], statBase(stat, newTier)); });
    if (ship.iconColor && ship.iconNumber && newTier !== oldTier) { /* icon stays -- division-scoped uniqueness is re-checked on next pick */ }
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[val] = false;
    saveState(); render();
  },
  updateShipStat(id, stat, val) {
    const ship = getShip(id);
    const tier = carTier(ship.division);
    ship[stat] = clampInt(val, statBase(stat, tier), 999, ship[stat]);
    saveState(); render();
  },
  updateCrewName(id, idx, val) { getShip(id).crew[idx] = val; saveState(); },
  rerollCrewName(id, idx) { getShip(id).crew[idx] = rollHeroName(); saveState(); render(); },
  randomShipName() { document.getElementById("nameIdea").textContent = rollShipName(); },
  rerollShipName(id) { getShip(id).name = rollShipName(); saveState(); render(); },
  toggleShipCollapse(id) { const s = getShip(id); s._collapsed = !s._collapsed; saveState(); render(); },
  toggleHangarDiv(div) {
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[div] = !STATE._hangarDivCollapse[div];
    saveState(); render();
  },
  updateShipIcon(id, color, num) {
    const ship = getShip(id);
    if (!ship) return;
    if (!color || !num) { ship.iconColor = ""; ship.iconNumber = ""; saveState(); render(); return; }
    if (STATE.ships.some(s => s.id !== id && s.iconColor === color && s.iconNumber === num && s.division === ship.division)) {
      alert(`That icon is already used by another ${ship.division} ship.`);
      return;
    }
    ship.iconColor = color; ship.iconNumber = num;
    saveState(); render();
  },
  togglePhaseCollapse(key) {
    const ls = STATE.race.legState;
    ls.phaseCollapsed = ls.phaseCollapsed || {};
    ls.phaseCollapsed[key] = !ls.phaseCollapsed[key];
    saveState(); render();
  },

  /* Course */
  rollDraftName() { document.getElementById("cName").value = rollRaceName(); },
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
    STATE.courses.push({ id: uid("course"), name, division, lanes: 6, innerHexes, laps, legMode: mode });
    saveState(); render();
  },
  deleteCourse(id) {
    if (!confirm("Delete this racecourse?")) return;
    STATE.courses = STATE.courses.filter(c => c.id !== id);
    saveState(); render();
  },

  /* Race setup */
  rollNpcName() { document.getElementById("npcName").value = rollShipName(); },
  addDraftNpc() {
    const input = document.getElementById("npcName");
    const v = input.value.trim();
    if (!v) return;
    const aggression = clampInt(document.getElementById("npcAggression").value, 1, 10, 5);
    STATE._draftNpcs = STATE._draftNpcs || [];
    STATE._draftNpcs.push({ name: v, aggression });
    STATE._draftNpcAggression = aggression;
    input.value = "";
    render();
  },
  randomizeDraftNpcAggression() { document.getElementById("npcAggression").value = rollD(10); },
  removeDraftNpc(i) { STATE._draftNpcs.splice(i, 1); render(); },
  setRaceSetupCourse(id) {
    STATE._raceSetupCourse = id;
    const course = getCourse(id);
    const div = course ? course.division : null;
    STATE._raceSetupShips = (STATE._raceSetupShips || []).filter(sid => { const s = getShip(sid); return s && s.division === div; });
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
    const division = getCourse(courseId).division;
    const shipIds = (STATE._raceSetupShips || []).filter(sid => { const s = getShip(sid); return s && s.division === division; });
    if (!shipIds.length) { alert(`Select at least one ${division} Division ship.`); return; }
    startRace(courseId, shipIds, STATE._draftNpcs || []);
    STATE._draftNpcs = [];
    STATE._raceSetupShips = [];
    saveState(); render();
  },
  abandonRace() {
    if (!confirm("Abandon the current race?")) return;
    STATE.race = null; STATE._openDeclFor = null; saveState(); render();
  },

  /* Race play */
  setDecl(pid, field, val) {
    const race = STATE.race, car = race.legState.cars[pid];
    const p = race.participants.find(x => x.id === pid);
    if (field === "gearChange") {
      car.gearChange = clampInt(val, -1, 1, 0);
      // Clamp against the board's own min/max gear.
      if (p.gear + car.gearChange < 0) car.gearChange = -p.gear;
      if (p.gear + car.gearChange > GDATA.MAX_GEAR) car.gearChange = GDATA.MAX_GEAR - p.gear;
      saveState(); render();
      return;
    }
    if (field === "slip") {
      car.slip = val;
      car.slipHexes = val ? (car.slipHexes || 1) : 0;
      saveState(); render();
      return;
    }
    if (field === "slipHexes") {
      const course = getCourse(race.courseId);
      const maxLane = car.slip === "left" ? p.lane - 1 : course.lanes - p.lane;
      car.slipHexes = clampInt(val, 1, Math.max(1, maxLane), car.slipHexes || 1);
      saveState();
      return;
    }
    car[field] = val;
    saveState();
  },
  setManeuver(pid, val) {
    const car = STATE.race.legState.cars[pid];
    car.maneuver = val;
    if (!val) car.maneuverTarget = "";
    saveState(); render();
  },
  setManeuverTarget(pid, targetId) {
    STATE.race.legState.cars[pid].maneuverTarget = targetId;
    saveState();
  },
  openDeclModal(pid) { STATE._openDeclFor = pid; render(); },
  closeDeclModal() { STATE._openDeclFor = null; render(); },
  confirmDecl(pid) {
    STATE.race.legState.cars[pid].declared = true;
    STATE._openDeclFor = null;
    saveState(); render();
  },
  lockDecl() {
    const race = STATE.race;
    const heroes = race.participants.filter(p => p.type === "hero" && (!p.out || p.outLeg === race.legIndex));
    const allDeclared = heroes.every(p => race.legState.cars[p.id].declared);
    if (!allDeclared) { alert("Not all ships have declared their intentions yet."); return; }
    lockDeclarations(); render();
  },
  doSkillCheck(pid) {
    const race = STATE.race;
    const p = race.participants.find(x => x.id === pid);
    rollCarSkillCheck(race, p);
    saveState(); render();
  },
  doOutOfControl(pid) {
    const race = STATE.race;
    const p = race.participants.find(x => x.id === pid);
    rollOneOutOfControl(race, p);
    saveState(); render();
  },
  doFinishLeg() { finishLeg(); render(); },
  playRaceReplay(lastLegOnly) {
    const race = STATE.race;
    if (!race) return;
    const course = getCourse(race.courseId);
    const legsCompleted = race.participants.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
    if (!legsCompleted) return;
    const fromLeg = lastLegOnly ? legsCompleted - 1 : 0;
    const btnAll = document.getElementById("raceReplayBtn");
    const btnLast = document.getElementById("raceReplayLastLegBtn");
    if (btnAll) btnAll.disabled = true;
    if (btnLast) btnLast.disabled = true;
    const geom = circTrackGeometry(course);
    ensureReplayTrailClickListener();
    const ringParams = hexRingParamsForCourse(course);
    const tracks = race.participants.map(p => ({ p, perLeg: buildCircularLegWaypoints(p, geom) }));
    race.participants.forEach((p, i) => {
      const perLeg = tracks[i].perLeg;
      let startPos = null;
      for (let li = Math.min(fromLeg, perLeg.length) - 1; li >= 0 && !startPos; li--) {
        const wp = perLeg[li];
        if (wp && wp.length) startPos = wp[wp.length - 1];
      }
      if (!startPos) startPos = { lane: p.startLane || 1, hexPos: p.startHexPos || 0 };
      const g = document.getElementById(`circracer-${p.id}`);
      if (g) g.setAttribute("transform", circRacerTransform(geom, startPos).transform);
    });
    let leg = fromLeg;
    const hexStepDelay = 200;
    function updateBoardsForLeg(legIdx) {
      race.participants.forEach(p => {
        const h = p.history || [];
        let laneAtLeg = p.startLane || 1, hexPosAtLeg = p.startHexPos || 0, lapsAtLeg = 0;
        for (let j = 0; j <= legIdx && j < h.length; j++) { laneAtLeg = h[j].lane; hexPosAtLeg = h[j].hexPos; lapsAtLeg = h[j].laps; }
        const pct = Math.min(100, Math.round((trackProgress({ laps: lapsAtLeg, lane: laneAtLeg, hexPos: hexPosAtLeg }, ringParams) / (course.laps * 6)) * 100));
        const fill = document.getElementById(`boardfill-${p.id}`);
        const icon = document.getElementById(`boardicon-${p.id}`);
        if (fill) fill.style.width = pct + "%";
        if (icon) icon.style.left = pct + "%";
      });
    }
    updateBoardsForLeg(fromLeg - 1);
    function playLeg(legIdx, done) {
      const maxSteps = Math.max(1, ...tracks.map(t => (t.perLeg[legIdx] || []).length));
      let sub = 0;
      function tick() {
        if (STATE.race !== race) return;
        tracks.forEach((t, i) => {
          const wp = t.perLeg[legIdx];
          if (!wp || !wp.length) return;
          const point = wp[Math.min(sub, wp.length - 1)];
          const g = document.getElementById(`circracer-${t.p.id}`);
          if (!g) return;
          const m = /rotate\(([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
          const prevRotDeg = m ? parseFloat(m[1]) : null;
          g.setAttribute("transform", circRacerTransform(geom, point, prevRotDeg).transform);
          paintReplayTrailDot(geom, (point.lane || 1) - 1, point.hexPos || 0, replayTrailColorFor(i));
        });
        sub += 1;
        if (sub < maxSteps) setTimeout(tick, hexStepDelay);
        else done();
      }
      tick();
    }
    function step() {
      if (STATE.race !== race) return;
      playLeg(leg, () => {
        updateBoardsForLeg(leg);
        leg += 1;
        if (leg < legsCompleted) step();
        else { if (btnAll) btnAll.disabled = false; if (btnLast) btnLast.disabled = false; }
      });
    }
    setTimeout(step, 400);
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
