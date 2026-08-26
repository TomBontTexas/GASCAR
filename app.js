/* GASCAR — application logic (vanilla JS, no build step).
   GASCAR = Galactic Association for Spaceship Competitive Astro-Racing,
   the in-world racing league depicted in the tabletop game Warp Space: GASCAR. */

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
function padNbsp(s, n) { s = String(s); return s + " ".repeat(Math.max(0, n - s.length)); }

/* Core Task Check: roll (|net|+1) d20s, keep highest (net>=0) or lowest (net<0), add score.
   Returns success/critical/fumble info per the book's Advantage/Disadvantage rules. */
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
function outcomeLabel(rc) {
  if (rc.isCrit) return rc.critLevels + " Critical" + (rc.critLevels === 1 ? "" : "s");
  if (rc.isFumble) return rc.fumbleLevels + " Fumble" + (rc.fumbleLevels === 1 ? "" : "s");
  return rc.success ? "Success" : "Failure";
}
function formatMk(score, net) {
  if (!net) return String(score);
  return score + (net > 0 ? "A".repeat(net) : "D".repeat(-net));
}
function netLabel(net) {
  if (!net) return "—";
  return (net > 0 ? "+" : "") + net + (net > 0 ? "A" : "D") + (Math.abs(net) > 1 ? "s" : "");
}
function signedCost(n) { return n > 0 ? `+${n}` : String(n); }

/* ============================== State ============================== */
const STORAGE_KEY = "gascar_state_v1";
const POSITIONS = ["pilot", "navigator", "spotter", "engineer"];
const POS_LABEL = { pilot: "Pilot", navigator: "Navigator", spotter: "Spotter", engineer: "Engineer" };
/* House rule (see RULE_CHANGES.md): on Critical Success/Fumble, Engineer/Spotter
   choose 1 level to Pilot, or 2 levels to one of these support positions. */
const CRIT_FUMBLE_GRANT_TARGETS = { engineer: ["spotter", "navigator"], spotter: ["navigator"] };

function defaultState() {
  return { crew: [], ships: [], courses: [], race: null, shipClasses: [] };
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
/* Upgrades:
   - Ship Classes saved under any earlier shape: Acc briefly became a
     Score+Advantage pair (now reverted -- Acc has no Advantage/Disadvantage,
     see RULE_CHANGES.md) and Tier/Damper/Min Crew came from a required
     Division pick instead of a free Tier number.
   - Ships saved before Division (.cls) and Ship Class (.shipClass) split
     into two independent fields -- a ship's Class used to just be whatever
     Division name sat in .cls. Give it a matching .shipClass so its stats
     don't change, and make sure .cls itself still names a real Division. */
function migrateState(state) {
  /* ONE-TIME migration (see APP_CHANGES.md): the book's Flash/Spark/Comet/Meteor/Nova
     stat blocks are no longer selectable as a Ship Class directly -- only custom Classes
     built in the Shipyard (optionally seeded from a Division via the Default button) are.
     Ships and Race Courses built against the old hard-coded classes are cleared. */
  if (!state._builtinShipClassesRemoved) {
    state.ships = [];
    state.courses = [];
    state.race = null;
    state._builtinShipClassesRemoved = true;
  }
  // ONE-TIME migration (see APP_CHANGES.md/RULE_CHANGES.md): Circular Track
  // switched from a square grid to a real hex grid -- a clean break, not a
  // field rename, since the old squarePos/innerSquares positions don't
  // correspond to anything meaningful under hex rules (this replaces an
  // EARLIER, now-obsolete hexPos->squarePos rename below that would have
  // actively fought this migration by renaming fresh hex data back to
  // square names). Any Circular Track course is removed; a race actively
  // running on one is cleared too. Straight/Legs courses and their races,
  // which never used squarePos, are untouched.
  if (!state._circularTrackHexed) {
    const raceCourse = state.race ? (state.courses || []).find(c => c.id === state.race.courseId) : null;
    if (raceCourse && raceCourse.trackType === "circular") state.race = null;
    state.courses = (state.courses || []).filter(c => c.trackType !== "circular");
    state._circularTrackHexed = true;
  }
  (state.shipClasses || []).forEach(sc => {
    if (sc.acc) { sc.maxThrust = sc.acc.score + (sc.acc.adv || 0); delete sc.acc; }
    if (sc.maxThrust == null) sc.maxThrust = 10;
    if (!sc.division) sc.division = GDATA.DIVISIONS.find(d => GDATA.SHIP_CLASSES[d].tier === sc.tier) || "Comet";
    if (sc.division === "Spark") { sc.ai.control = 0; sc.ai.nav = 0; sc.ai.sensors = 0; }
    if (!sc.frame || sc.frame === "None") sc.frame = "Standard";
    if (sc.armor == null) sc.armor = 0;
    if (!sc.compartment || sc.compartment === "None") sc.compartment = "Standard";
  });
  (state.ships || []).forEach(ship => {
    if (!ship.shipClass) ship.shipClass = ship.cls || "Comet";
    if (!GDATA.DIVISIONS.includes(ship.cls)) ship.cls = "Comet";
    // A bare Division name is only illegal here if it ISN'T ALSO a real custom
    // Class name -- a custom Class is allowed to share a name with a Division
    // (see APP_CHANGES.md), so e.g. a class literally named "Meteor" must not
    // get stomped just because "Meteor" is also a Division. Only reassign when
    // there's truly no matching custom Class (leftover pre-Shipyard save data).
    const hasMatchingCustomClass = (state.shipClasses || []).some(c => c.name === ship.shipClass);
    if (GDATA.DIVISIONS.includes(ship.shipClass) && !hasMatchingCustomClass) {
      ship.shipClass = (state.shipClasses && state.shipClasses[0]) ? state.shipClasses[0].name : "";
    }
  });
  (state.courses || []).forEach(course => {
    if (!GDATA.DIVISIONS.includes(course.division)) course.division = "Comet";
    if (!course.trackType) course.trackType = "legs";
  });
  // Self-heal a cached race (see APP_CHANGES.md): a Hero at 0 HP must be out of
  // the race. Early saves (or HP zeroed on a path that didn't flag it) can leave
  // `out` unset while hp is 0, so the wreck keeps racing. Mark it out here, and
  // give it an outLeg that isn't the current Leg so it's removed from the cards
  // right away rather than lingering (this is a repair, not a fresh kill).
  if (state.race && Array.isArray(state.race.participants)) {
    const legIdx = state.race.legIndex || 0;
    // Back-fill NPC iconDivision (see APP_CHANGES.md): icons are now per-Division,
    // so an NPC saved before that needs the race's Division to find its icon art.
    const raceCourse = (state.courses || []).find(c => c.id === state.race.courseId);
    state.race.participants.forEach(p => {
      if (p.type === "npc" && !p.iconDivision && raceCourse) p.iconDivision = raceCourse.division;
      if (p.type === "hero" && p.hp != null && p.hp <= 0 && !p.out) {
        p.out = true;
        p.outLeg = legIdx - 1;
      }
      // Convert old countdown penalties to absolute Leg windows (see
      // applyFumbleAffects / APP_CHANGES.md). A stored legsRemaining of r during
      // Leg L means the penalty is active this Leg and r more, i.e. through L+r.
      (p.penalties || []).forEach(pen => {
        if (pen.startLeg == null && pen.legsRemaining != null) {
          pen.startLeg = 0; // already in effect
          pen.endLeg = legIdx + pen.legsRemaining;
          delete pen.legsRemaining;
        }
      });
    });
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}
function getCrew(id) { return STATE.crew.find(c => c.id === id); }
function getShip(id) { return STATE.ships.find(s => s.id === id); }
function getCourse(id) { return STATE.courses.find(c => c.id === id); }
/* Division vs Ship Class (see APP_CHANGES.md) are two independent fields on
   a ship: .cls names a Division (Flash/Spark/Comet/Meteor/Nova -- fixed,
   never extended by custom classes; ties a ship to a racecourse's TN table)
   while .shipClass names the stat block (Tier/Acc/Damper/Crew/Ship AI) it
   actually uses -- always a user-created Ship Class built in the Shipyard
   tab (see APP_CHANGES.md: the book's 5 Divisions are no longer directly
   selectable as a Class -- only their stat blocks remain, as raw material
   for the Shipyard's "Default" button). A custom Class may legally share
   its name with a Division (e.g. a custom "Flash" class) -- getShipClass()
   checks custom classes first for exactly this reason, falling back to a
   bare GDATA.SHIP_CLASSES[name] lookup only for old saved data. Anything
   that needs a Division's own book stats directly (e.g. rollLegCount()'s
   leg dice) reads GDATA.SHIP_CLASSES[division] itself rather than going
   through getShipClass(), so it can't be shadowed by a same-named Class.

   A custom Ship Class must itself pick a Division to be "legal for" --
   Tier, Damper, and Min Crew all come straight from that Division's own
   built-in stat block (not editable), same as the book ties every
   Division's whole stat block together (see RULE_CHANGES.md). Spark's AI
   Score is always locked at 0 (book default -- Advantage/Disadvantage still
   applies) so any custom class legal for Spark inherits that lock. Acc
   itself has no Advantage/Disadvantage at all -- it's a plain number. Hit
   Points and Damage Reduction (see computeHitPoints()/computeDamageReduction()
   below) are computed for every class -- a freshly-created blank one gets
   the "Standard" Frame Strength / no Armor / "Standard" Compartmentalization
   defaults until the player spends points to change them; hitting Default
   (or "+ Add Preset") instead pulls in that Division's own preset hull
   (see RULE_CHANGES.md for the per-Division table). */
function frameOption(name) { return GDATA.FRAME_STRENGTH.find(f => f.name === name) || GDATA.FRAME_STRENGTH[0]; }
function compartmentOption(name) { return GDATA.COMPARTMENTALIZATION.find(c => c.name === name) || GDATA.COMPARTMENTALIZATION[0]; }
function computeHitPoints(tier, frameName) {
  const base = tier * 3;
  switch (frameOption(frameName).hpOp) {
    case "div4": return Math.ceil(base / 4);
    case "div2": return Math.ceil(base / 2);
    case "mul2": return base * 2;
    case "mul4": return base * 4;
    default: return base;
  }
}
function computeDamageReduction(armorLevel, compartmentName) {
  return (armorLevel || 0) * compartmentOption(compartmentName).multiplier;
}
function frameCost(tier, frameName) { return frameOption(frameName).costFactor * tier; }
function compartmentCost(tier, compartmentName) { return compartmentOption(compartmentName).costFactor * tier; }
function getShipClass(name) {
  // Custom classes are checked first: a class may legally share its name with
  // a Division (e.g. a custom "Flash" class) -- that name must resolve to the
  // player's own class, not the book's Division stat block. The GDATA.SHIP_CLASSES
  // fallback below exists only for a bare Division name (see rollLeg()) or old
  // saved data (see migrateState()).
  let raw;
  const sc = STATE.shipClasses.find(c => c.name === name);
  if (sc) {
    const divStats = GDATA.SHIP_CLASSES[sc.division] || GDATA.SHIP_CLASSES.Comet;
    raw = { ...sc, tier: divStats.tier, damper: divStats.damper, crew: divStats.crew };
  } else {
    raw = GDATA.SHIP_CLASSES[name];
    if (!raw) return undefined;
  }
  const frame = raw.frame || "Standard";
  const armor = raw.armor || 0;
  const compartment = raw.compartment || "Standard";
  return { ...raw, frame, armor, compartment, hp: computeHitPoints(raw.tier, frame), dr: computeDamageReduction(armor, compartment) };
}
/* Acc has no Advantage/Disadvantage -- it's a plain point-costed number,
   unlike Spotter/Navigator/Pilot which are Score + Advantage/Disadvantage
   (see RULE_CHANGES.md). Frame Strength and Compartmentalization each cost
   (or refund) a multiple of Tier; Armor uses the same triangular Score-cost
   progression as Spotter/Navigator/Pilot (level n costs n(n+1)/2). */
function shipClassTotalCost(sc) {
  const aiStats = [{ score: sc.ai.sensors, adv: sc.ai.sensorsAdv }, { score: sc.ai.nav, adv: sc.ai.navAdv }, { score: sc.ai.control, adv: sc.ai.controlAdv }];
  const tier = sc.tier != null ? sc.tier : (GDATA.SHIP_CLASSES[sc.division] || GDATA.SHIP_CLASSES.Comet).tier;
  const hullCost = frameCost(tier, sc.frame || "Standard") + scoreCost(sc.armor || 0) + compartmentCost(tier, sc.compartment || "Standard");
  return (sc.maxThrust || 0) + aiStats.reduce((sum, s) => sum + skillCost(s.score, s.adv), 0) + hullCost;
}
/* House rule (see APP_CHANGES.md): a Ship may only use a Ship Class legal for its
   own Division -- the Hangar Bay's Ship Class dropdown is filtered to just these. */
function shipClassNamesForDivision(division) { return STATE.shipClasses.filter(c => c.division === division).map(c => c.name); }
/* Ship icon art (see GDATA.SHIP_ICON_* in data.js): every Division has its own
   set of 15 ship designs. A Ship Class picks one of its Division's 15 White
   icons; a Ship built from a Class picks one of that Division's 45 Red/Green/
   Blue icons. Icons are unique PER DIVISION (the same number/color in another
   Division is a different ship) -- these report which numbers/colors are taken
   by some OTHER class/ship in the SAME Division,
   so the picker UI can grey them out (and App.updateShipClassIcon()/
   App.updateShipIcon() re-check at the moment of picking, in case two tabs
   or a stale render raced each other). */
function shipIconPath(division, number, color) { return `${GDATA.SHIP_ICON_DIR}${division} ${number} ${color}.png`; }
/* Which Division's 15 ship designs an icon is drawn from. A Ship reads it from
   its Ship Class's Division; an NPC race participant carries its own
   iconDivision (set from the course's Division at race start). Icon numbers
   (01-15) are per-Division, so uniqueness checks are scoped to a Division too. */
function shipClassDivision(name) { const c = getShipClass(name); return c ? c.division : null; }
function iconDivisionOf(obj) {
  if (!obj) return null;
  if (obj.iconDivision) return obj.iconDivision;          // NPC participant
  if (obj.shipClass) return shipClassDivision(obj.shipClass); // Ship
  return null;
}
function usedClassIconNumbers(excludeId, division) {
  return new Set(STATE.shipClasses.filter(c => c.id !== excludeId && c.icon && c.division === division).map(c => c.icon));
}
function usedShipIconKeys(excludeId) {
  return new Set(STATE.ships.filter(s => s.id !== excludeId && s.iconColor && s.iconNumber)
    .map(s => `${shipClassDivision(s.shipClass) || "?"}|${s.iconColor}|${s.iconNumber}`));
}
/* Small <img> thumbnail for anything carrying .iconColor/.iconNumber (a Ship
   or an NPC race participant) -- empty string if it has no icon assigned or its
   Division can't be resolved. */
function iconThumbImg(obj) {
  if (!obj || !obj.iconColor || !obj.iconNumber) return "";
  const div = iconDivisionOf(obj);
  if (!div) return "";
  return `<img class="iconthumb" src="${esc(shipIconPath(div, obj.iconNumber, obj.iconColor))}" title="${esc(div)} ${esc(obj.iconColor)} ${esc(obj.iconNumber)}">`;
}
/* Picks a uniformly random (color, number) not already in usedKeys (a Set of
   "Color|Number" strings) -- used to give an NPC racer a random, distinct
   icon at race start (see startRace()). Returns null if all 45 are taken. */
function pickRandomUnusedIcon(usedKeys) {
  const options = [];
  GDATA.SHIP_ICON_COLORS.forEach(color => GDATA.SHIP_ICON_NUMBERS.forEach(num => {
    if (!usedKeys.has(`${color}|${num}`)) options.push({ color, number: num });
  }));
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}
/* House rule (see RULE_CHANGES.md): every Division has a build points cap
   (GDATA.DIVISION_CAPS) -- it's a RULE, not an app-enforced wall. The Racemaster
   can build a Ship Class over its Division's cap; the app doesn't block it, it
   just flags the Total Points display in red (see shipClassOverCap()) so it's
   obvious the class is out of spec. Flash also has a separate physical 5-G Max
   Thrust ceiling (sub-sonic) which IS hard-enforced -- see maxThrustCap(). */
function maxThrustCap(division) { return division === "Flash" ? 5 : 99; }
function shipClassOverCap(sc) {
  const cap = GDATA.DIVISION_CAPS[sc.division];
  return !!cap && shipClassTotalCost(sc) > cap.maxPoints;
}
function mutateShipClassWithCapCheck(sc, mutateFn) {
  mutateFn();
  saveState(); render();
}
/* House rule (see RULE_CHANGES.md): each Ship Class has an EXACT number of
   DISTINCT crewmen required to fill its 4 positions -- not a minimum, a fixed
   crew size. A Flash/Spark (crew 1) must be flown solo -- one person, all 4
   positions, never two different people. A Nova (crew 3) needs exactly 3
   different people, never more or fewer. Every position must also actually
   be filled (not left blank) for the ship to be race-legal, which in turn
   caps how many positions any one crewman can hold: with 4 positions and a
   crew size of N, one person can hold at most 4-N+1 of them -- the rest must
   go to at least N-1 other people. App.assignCrew() enforces both the floor
   (can't leave a position blank) and the ceiling (can't bring in more
   distinct people than the crew size allows) at assignment time. */
function distinctCrewCount(ship) { return new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean)).size; }
function minCrewFor(ship) { return getShipClass(ship.shipClass).crew || 1; }
function emptyPositions(ship) { return POSITIONS.filter(p => !ship.assignments[p]); }
function maxPositionsPerCrewman(ship) { return POSITIONS.length - minCrewFor(ship) + 1; }
function shipCrewComplete(ship) { return emptyPositions(ship).length === 0 && distinctCrewCount(ship) === minCrewFor(ship); }
function crewLockMessage(ship) {
  const empties = emptyPositions(ship);
  if (empties.length) return `${ship.name}: ${empties.map(p => POS_LABEL[p]).join(", ")} unfilled`;
  return `${ship.name}: needs exactly ${minCrewFor(ship)} distinct crew, has ${distinctCrewCount(ship)}`;
}

/* ============================== Ship Display computation ============================== */
/* Mirrors "Building a Race Ship Display" (p.27-28). */
/* Simplified crewman point cost (p.25): score + 10/Advantage, score - 5/Disadvantage. */
// The effective Leg-skill ceiling (AAAAA) -- NOT a purchase limit. Advantage can be
// bought past this (see updateSkill/updateShipClassAI); it just goes to waste in a
// Leg, and its cost keeps climbing regardless (see advCost below).
var MAX_ADV = 5;
// House rule (see RULE_CHANGES.md): Circular Track / Distance Tracking runs
// on a real hex grid (see circTrackGeometry() below) -- lane N is a hex ring
// at ring-level (innerRing + N) around a shared center, with the two
// straight sides elongated by straightLen extra hexes each (see
// hexRingParamsForCourse()). Growth per lane out is therefore a constant +6
// hexes (6x the +1 ring-level increase) -- an exact property of hex ring
// math, not a chosen/arbitrary number. (An earlier attempt made the
// straight legs a plain constant, independent of ring level, reasoning that
// would make Q comparisons across lanes simpler -- it does, but it also
// breaks the ring-nesting guarantee: hex-ring corners aren't at a
// radius-independent offset the way a circle's are, so a fixed-length
// straight leg starting from a k-dependent corner drifts out of alignment
// with the next lane's, reintroducing overlaps. Caught by testing before
// shipping -- see hexStepAdvance() below for how cross-lane comparison is
// solved instead, without touching this proven geometry.)
function laneHexesArray(course) {
  const { innerRing, straightLen } = hexRingParamsForCourse(course);
  return Array.from({ length: course.lanes || 6 }, (_, i) => 6 * (innerRing + i) + 2 * straightLen);
}
// Derives (innerRing, straightLen) from the course's configurable
// "innerHexes" target (replacing the old square system's innerSquares field)
// -- solves innerHexes ~= 6*innerRing + 2*straightLen with straightLen held
// at 2x innerRing (a reasonable straight-vs-curve shape ratio; unlike the
// old trapezoid system, every hex is ALWAYS the exact same regular size
// regardless of this ratio, so this is purely a track-SHAPE choice now, not
// a cell-size-matching necessity).
function hexRingParamsForCourse(course) {
  const target = course.innerHexes || 50;
  const innerRing = Math.max(1, Math.round(target / 10));
  const straightLen = 2 * innerRing;
  return { innerRing, straightLen };
}
// Staggered start (see RULE_CHANGES.md): each lane out starts this many
// hexes further ahead than the one inside it -- a fixed offset. Shared by
// startRace() (actual gameplay hexPos) and the standings SVG (drawing each
// lane's own starting mark at that same hex).
var STAGGER_PER_LANE = 4;
function laneStartHexPos(laneIdx0) { return laneIdx0 * STAGGER_PER_LANE; }
// House rule (see RULE_CHANGES.md): skill/AI SCORE cost is triangular — level n
// costs n(n+1)/2 (1,3,6,10,15,21,28,36,45,55 for scores 1..10).
function scoreCost(score) { score = score || 0; return score * (score + 1) / 2; }
// Advantage: each level's INCREMENT doubles (A costs 5, AA +10, AAA +20, AAAA +40,
// AAAAA +80, AAAAAA +160, ...) with no purchase ceiling -- so cumulative totals are
// A=5, AA=15, AAA=35, AAAA=75, AAAAA=155, AAAAAA=315, etc. Disadvantage is a flat
// -5/level discount, uncapped on the negative side.
function advCost(adv) {
  if (!adv) return 0;
  if (adv < 0) return adv * 5;
  return 5 * (Math.pow(2, adv) - 1);
}
// Shared by crew skills and ship AI. maxThrust is NOT a skill and keeps a flat cost.
function skillCost(score, adv) { return scoreCost(score) + advCost(adv); }
function crewTotalCost(crewman) {
  return POSITIONS.concat("resistance").reduce((sum, pos) => sum + skillCost(crewman.skills[pos].score, crewman.skills[pos].adv), 0);
}
function computeShipDisplay(ship) {
  const cls = getShipClass(ship.shipClass);
  const out = {};
  POSITIONS.forEach(pos => {
    const crewId = ship.assignments[pos];
    const crewman = crewId ? getCrew(crewId) : null;
    const crewSkill = crewman ? crewman.skills[pos] : { score: 0, adv: 0 };
    let shipAI = 0, shipAIAdv = 0;
    if (pos === "pilot") { shipAI = cls.ai.control; shipAIAdv = cls.ai.controlAdv; }
    else if (pos === "navigator") { shipAI = cls.ai.nav; shipAIAdv = cls.ai.navAdv; }
    else if (pos === "spotter") { shipAI = cls.ai.sensors; shipAIAdv = cls.ai.sensorsAdv; }
    else { shipAI = 0; shipAIAdv = 0; } // Engineer AI = 0 always

    let bonus = 0;
    if (pos === "spotter") bonus += cls.tier; // Spotter gets ship Tier as bonus
    if (ship.sponsorBonusPos === pos) bonus += 1;
    let penalty = 0;
    if (ship.sponsorPenaltyPos === pos) penalty -= 1;

    const finalScore = (crewSkill.score || 0) + shipAI + bonus + penalty;
    const finalAdv = (crewSkill.adv || 0) + shipAIAdv;
    out[pos] = {
      crewName: crewman ? crewman.name : "(unassigned)",
      crewScore: crewSkill.score || 0, crewAdv: crewSkill.adv || 0,
      shipAI, shipAIAdv, bonus, penalty,
      finalScore, finalAdv, mk: formatMk(finalScore, finalAdv)
    };
  });
  return out;
}

/* ============================== Racecourse generation ============================== */
function rollLegFeature(division) {
  const table = division === "Flash" ? GDATA.FLASH_LEG_FEATURES : GDATA.SPACE_LEG_FEATURES;
  const idx = rollD(50) - 1;
  return { d50: idx + 1, desc: table[idx][0], mod: table[idx][1] };
}
function rollLeg(division) {
  const tier = rollD(5) + rollD(5); // 2d5 -> 2..10
  const baseTN = tier * 3;
  const feat = rollLegFeature(division);
  const tnTierMod = (tier + feat.mod) * 3;
  const tnTnMod = baseTN + feat.mod;
  return { tier, baseTN, d50: feat.d50, feature: feat.desc, mod: feat.mod, tnTierMod, tnTnMod, finalTN: tnTierMod, finalMode: "tier" };
}
/* Number of Legs is set by the race Type (Drag Race / Short / Medium / Long --
   see GDATA.RACE_TYPES), independent of Division. Drag Race is a flat 1; the
   others roll and sum (e.g. Medium = 2d10). */
function raceType(name) { return GDATA.RACE_TYPES.find(t => t.name === name) || GDATA.RACE_TYPES[0]; }
function rollLegCount(typeName) {
  const dice = raceType(typeName).dice;
  let total = 0;
  for (let i = 0; i < dice.n; i++) total += rollD(dice.d);
  return total;
}
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
/* Hero name: roll a d100 for the first name and a separate d100 for the last
   name from GDATA.HERO_FIRST_NAMES / HERO_LAST_NAMES (see data.js). */
function rollHeroName() {
  return `${GDATA.HERO_FIRST_NAMES[rollD(100) - 1]} ${GDATA.HERO_LAST_NAMES[rollD(100) - 1]}`;
}

/* ============================== Race engine ============================== */
function activePenalties(participant, legIndex) {
  // Fumble penalties use an ABSOLUTE Leg window [startLeg, endLeg] (see
  // applyFumbleAffects) rather than a countdown, so the "N more Legs" display can
  // never drift off by one. Drop windows already past, then sum those in effect
  // this Leg. No mutation of the counts here -- the window is fixed when created.
  participant.penalties = (participant.penalties || []).filter(pen => pen.endLeg >= legIndex);
  const totals = { pilot: 0, navigator: 0, spotter: 0, engineer: 0 };
  participant.penalties.forEach(pen => {
    if (legIndex >= pen.startLeg && legIndex <= pen.endLeg) totals[pen.position] += pen.amount;
  });
  return totals;
}
// Legs a penalty is still in effect, counting the current Leg. 0 means it's not
// active this Leg (a window that starts next Leg reports how many Legs until it
// ends). Used for the status display.
function penaltyLegsLeft(pen, legIndex) {
  if (legIndex > pen.endLeg) return 0;
  return pen.endLeg - Math.max(legIndex, pen.startLeg) + 1;
}
/* A ship's usable max thrust after any Acceleration fumble effects (see the
   Fumble charts in data.js): reductions subtract from it, a cap floors it,
   both persisting for the rest of the race. Never drops below 1-G. */
function effectiveMaxThrust(participant, cls) {
  let m = cls.maxThrust - (participant.accelReduction || 0);
  if (participant.accelCap != null) m = Math.min(m, participant.accelCap);
  return Math.max(1, m);
}
/* Applies one Fumble chart entry's structured `affects` (see data.js) to the
   ship that just fumbled: crew Disadvantage penalties over future Legs, HP
   damage (reduced by DR; 0 HP = out of the race), Acceleration reductions,
   and forced-last-place Legs. */
function applyFumbleAffects(pid, entry) {
  const race = STATE.race, ls = race.legState;
  const ps = ls.perShip[pid];
  const participant = race.participants.find(p => p.id === pid);
  const ship = getShip(participant.shipId);
  const cls = getShipClass(ship.shipClass);
  if (participant.hp == null) { participant.maxHp = cls.hp; participant.hp = cls.hp; }
  participant.penalties = participant.penalties || [];
  (entry.affects || []).forEach(a => {
    if (a.type === "disadvantage") {
      // Absolute Leg window: a Fumble on this Leg imposes the Disadvantage on the
      // NEXT a.legs Legs (it doesn't affect the Leg it happened on -- that Leg's
      // conditions were already set at initLegState). startLeg is the first
      // affected Leg, endLeg the last (inclusive).
      participant.penalties.push({ position: a.position, amount: -a.levels, startLeg: race.legIndex + 1, endLeg: race.legIndex + a.legs });
    } else if (a.type === "hp") {
      const dmg = Math.max(0, (cls.tier * a.tierMult) - (cls.dr || 0));
      participant.hp = Math.max(0, participant.hp - dmg);
      if (participant.hp === 0 && !participant.out) { participant.out = true; participant.outLeg = race.legIndex; }
    } else if (a.type === "accel") {
      if (a.mode === "reduce") participant.accelReduction = (participant.accelReduction || 0) + a.value;
      else if (a.mode === "set") participant.accelCap = participant.accelCap != null ? Math.min(participant.accelCap, a.value) : a.value;
    } else if (a.type === "last") {
      participant.forcedLastLegs = Math.max(participant.forcedLastLegs || 0, a.legs);
    }
  });
  ps.fumbleApplied = (entry.affects || []).slice();
}
/* Heroes shown/handled in the CURRENT Leg's Phase Cards. A destroyed ship is
   NOT deleted from the race mid-Leg -- it stays visible (flagged DESTROYED)
   through the end of the Leg it died on, then drops out from the next Leg on. */
function activeHeroes(race) {
  return race.participants.filter(p => p.type === "hero" && (!p.out || p.outLeg === race.legIndex));
}
/* Heroes not yet destroyed -- used to decide whether the race can continue. */
function livingHeroes(race) {
  return race.participants.filter(p => p.type === "hero" && !p.out);
}
function rollCircularLeg(course) {
  const leg = rollLeg(course.division);
  const mode = course.legMode || "tier";
  leg.finalMode = mode;
  leg.finalTN = mode === "tier" ? leg.tnTierMod : (mode === "tn" ? leg.tnTnMod : leg.baseTN);
  return leg;
}
// House rule (see RULE_CHANGES.md): a Leg's TN can never exceed the highest
// Ship Pilot Mk among this race's Heroes, plus 18. Pilot Mk here is the ship's
// static Pilot score (crew skill + Ship AI + bonuses/penalties -- see
// computeShipDisplay()), not a Leg's tactical Advantage/Disadvantage, which
// doesn't exist yet at the point a Leg's TN is set. NPCs have no Ship/crew, so
// only Heroes count; an all-NPC race falls back to a flat cap of 18.
function legTNCap(race) {
  const mks = race.participants.filter(p => p.type === "hero").map(p => computeShipDisplay(getShip(p.shipId)).pilot.finalScore);
  return (mks.length ? Math.max(...mks) : 0) + 18;
}
// The TN a Leg would have had before legTNCap() -- initLegState() overwrites
// leg.finalTN with the capped value but leaves tnTierMod/tnTnMod/baseTN
// alone, so the pre-cap number for whichever finalMode was in play is still
// recoverable from those. Used only for the "capped from N" debug display
// (see renderRace()) -- not needed anywhere the cap itself is applied.
function legNaturalTN(leg) {
  return leg.finalMode === "tier" ? leg.tnTierMod : leg.finalMode === "tn" ? leg.tnTnMod : leg.baseTN;
}
function initLegState(race) {
  const course = getCourse(race.courseId);
  // Circular Track (see RULE_CHANGES.md): there's no pre-built Leg list -- a
  // fresh Leg (Tier/Feature/TN) is rolled every time one is needed, including
  // the first Leg of a race, so re-racing the same course never reuses a
  // stale Leg from a prior run. Straight courses' Legs are pre-built and
  // persisted on the course (reusable across different races/rosters), so a
  // shallow copy is taken here before the TN cap below is applied -- the
  // course's own stored Leg (and its finalTN) is never mutated.
  const leg = course.trackType === "circular" ? rollCircularLeg(course) : { ...course.legs[race.legIndex] };
  leg.finalTN = Math.min(leg.finalTN, legTNCap(race));
  const perShip = {};
  race.participants.filter(p => p.type === "hero").forEach(p => {
    const ship = getShip(p.shipId);
    const shipCls = getShipClass(ship.shipClass);
    const carriedConditions = activePenalties(p, race.legIndex);
    const effMax = effectiveMaxThrust(p, shipCls);
    perShip[p.id] = {
      accel: Math.max(1, Math.min(effMax, shipCls.damper || effMax)), // min 1-G (see RULE_CHANGES.md)
      // Racing Maneuvers (see RULE_CHANGES.md): EACH position may run its own
      // Maneuver against the SAME position on chosen target ships.
      maneuvers: { pilot: "", navigator: "", spotter: "", engineer: "" },
      maneuverTargets: { pilot: [], navigator: [], spotter: [], engineer: [] },
      slip: "", // Circular Track lane change this Leg: "" | "left" | "right" (see RULE_CHANGES.md)
      slipHexes: 0, // hexes of Slip declared this Leg (costs no Movement Points)
      slipAdvantage: 0, // signed A/D from the Slip, computed at lockDeclarations() -- 0 if entirely within a straightaway
      // House rule (see RULE_CHANGES.md): Crowded Field. -1 D per ship that
      // shared this hex with it at the end of the PREVIOUS Leg (flagged by
      // finishLeg() as the group's size, consumed and cleared here so it only
      // ever applies once).
      crowdedFieldD: p.crowdedFieldNextLeg ? -p.crowdedFieldNextLeg : 0,
      declared: false,
      conditions: carriedConditions,
      grants: { pilot: 0, navigator: 0, spotter: 0, engineer: 0 },
      resistanceDelta: { pilot: 0, navigator: 0, spotter: 0, engineer: 0 },
      // Maneuver Disadvantage received on each position (target's same position),
      // and the instigator's own self-cost on each acting position.
      maneuverReceivedByPos: { pilot: 0, navigator: 0, spotter: 0, engineer: 0 },
      maneuverInstigatedByPos: { pilot: 0, navigator: 0, spotter: 0, engineer: 0 },
      netLegAcc: 0,
      resistance: null, // { [crewId]: {pass, total, tn, positions:[...] } }
      condLocked: false, // Phase I conditions locked for this Leg (see renderPhaseI)
      // A ship destroyed (0 HP) earlier stays out for every remaining Leg.
      autoLast: !!p.out,
      results: { engineer: null, spotter: null, navigator: null, pilot: null },
      // House rule (see RULE_CHANGES.md): Engineer/Spotter must choose their grant
      // target BEFORE rolling -- starts unset each Leg so there's no silent default.
      grantChoice: { engineer: "", spotter: "" }
    };
    p.crowdedFieldNextLeg = 0; // consumed above into crowdedFieldD -- one-Leg effect only
  });
  const npcState = {};
  race.participants.filter(p => p.type === "npc").forEach(p => {
    npcState[p.id] = { maneuverReceivedD: 0 };
  });
  race.legState = {
    leg, declLocked: false, perShip, npcState,
    npcResults: {}, baseLegResult: null, standings: null,
    // UI only (see APP_CHANGES.md): each phase card can be collapsed to its
    // header manually via the button in renderPhaseCardOpen(). Phase I
    // (Crew Task Check Modifications) starts collapsed each Leg -- it's
    // rarely used outside an RPG-style campaign and is just noise otherwise.
    phaseCollapsed: { phaseI: true }
  };
  STATE._openDeclFor = null;
}
function participantLabel(p) { return p.type === "hero" ? shipName(p.shipId) : (p.name + " (NPC)"); }
// House rule (see RULE_CHANGES.md): Initiative = d20 + Ship's max
// Acceleration. NPCs have no Ship Class (see startRace()), so they roll a
// bare d20.
function shipMaxAccelForInitiative(p) {
  if (p.type !== "hero") return 0;
  const ship = getShip(p.shipId);
  return getShipClass(ship.shipClass).maxThrust || 0;
}
// Rolls Initiative once for every ship in `ships`, stamps it onto
// p.initiative (the displayed value), and returns them sorted highest to
// lowest. A tied GROUP's overall rank among the rest of the field is fixed by
// that shared value -- only their order relative to EACH OTHER is
// undetermined, so ties are broken by a separate, unstamped reroll among just
// that group (see breakTieOrder()) rather than a fresh d20 that could
// otherwise vault a formerly-tied ship above (or below) ships it never tied
// with (see RULE_CHANGES.md).
function resolveInitiativeOrder(ships) {
  const rolled = ships.map(p => ({ p, val: rollD(20) + shipMaxAccelForInitiative(p) }));
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
// Orders a group of ships that tied on Initiative, purely relative to each
// other -- their displayed p.initiative is untouched (it's still the tied
// value that put them in this group). Repeats (recursively, on whichever
// subset ties again) until every ship in the group has a strict order.
function breakTieOrder(tiedShips) {
  const rolled = tiedShips.map(p => ({ p, val: rollD(20) + shipMaxAccelForInitiative(p) }));
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
function startRace(courseId, shipIds, npcNames) {
  const course = getCourse(courseId);
  const circular = course.trackType === "circular";
  const participants = [];
  const usedIcons = new Set();
  shipIds.forEach(sid => {
    const ship = getShip(sid);
    const cls = getShipClass(ship.shipClass);
    participants.push({
      id: uid("hero"), type: "hero", shipId: sid, cumulative: 0, history: [], penalties: [],
      // Fumble-tracked state (see data.js Fumble charts / RULE_CHANGES.md):
      hp: cls.hp, maxHp: cls.hp, out: false,
      accelReduction: 0, accelCap: null, forcedLastLegs: 0
    });
    if (ship.iconColor && ship.iconNumber) usedIcons.add(`${ship.iconColor}|${ship.iconNumber}`);
  });
  // House rule / UI (see APP_CHANGES.md): an NPC racer gets a random icon --
  // any color, whichever hull number -- distinct from every Hero ship and
  // every other NPC in this same race, so no two bars on the board look alike.
  // NPC icons come from the course's Division (all racers in a race share it).
  npcNames.forEach(n => {
    const pick = pickRandomUnusedIcon(usedIcons);
    if (pick) usedIcons.add(`${pick.color}|${pick.number}`);
    participants.push({ id: uid("npc"), type: "npc", name: n, cumulative: 0, history: [], iconDivision: course.division, iconColor: pick ? pick.color : "", iconNumber: pick ? pick.number : "" });
  });
  // Circular Track / Distance Tracking (see RULE_CHANGES.md): every racer starts
  // in a lane, round-robin, and tracks laps completed + hex position within
  // the current lap. Lane may change mid-race via a Slip (see
  // renderDeclModal). Outer lanes get a staggered head start, same reasoning
  // as a real track: an unstaggered outer lane's full-lap hex gain over the
  // one inside it comes entirely from the two curved end-caps (straights are
  // the same length for every lane -- see circTrackGeometry()), so crossing
  // just the first curve it would already be running ahead. Starting that
  // far behind cancels it out. startLane/startHexPos are kept alongside the
  // live lane/hexPos so a race replay can redraw the true starting frame
  // later.
  if (circular) {
    // House rule (see RULE_CHANGES.md): Initiative. Every ship rolls d20 +
    // its max Acceleration (NPCs have no Ship Class, so just d20) once at the
    // start of the Race; lanes are assigned in sequence, innermost to
    // outermost, highest Initiative to lowest -- more racers than lanes wraps
    // back to lane 1, same as the old round-robin did. Ties are broken by
    // re-rolling ONLY the tied ships against each other (see resolveInitiativeOrder()).
    const order = resolveInitiativeOrder(participants);
    order.forEach((p, i) => {
      const laneIdx0 = i % course.lanes;
      p.lane = laneIdx0 + 1;
      p.hexPos = laneStartHexPos(laneIdx0);
      p.laps = 0;
      p.startLane = p.lane;
      p.startHexPos = p.hexPos;
    });
  }
  const race = { courseId, legIndex: 0, participants, finished: false, log: [] };
  initLegState(race);
  STATE.race = race;
  saveState();
}
function lockDeclarations() {
  const race = STATE.race, ls = race.legState;
  const course = getCourse(race.courseId);
  Object.entries(ls.perShip).forEach(([pid, ps]) => {
    const ship = getShip(race.participants.find(p => p.id === pid).shipId);
    const damper = getShipClass(ship.shipClass).damper;
    ps.netLegAcc = damper - ps.accel;
    ps.declared = true;
  });
  // Circular Track Slips (see RULE_CHANGES.md): a Slip costs no Movement
  // Points beyond ordinary movement -- of this Leg's eventual hexes of
  // movement, the declared Slip hexes are interleaved with ordinary forward
  // movement wherever resolveSlipPath()'s longest-path DP finds the ship
  // makes the most real progress around the track (not always first or
  // last -- see RULE_CHANGES.md; even though every hex is the same real
  // size, WHICH hex a "forward" step reaches depends on the current lane,
  // so different interleavings genuinely land on different final hexes).
  // Each hex of Slip is a diagonal, edge-adjacent step -- it advances
  // forward by one hex (same as ordinary movement) AND changes one lane,
  // simultaneously -- not a purely lateral hop. Since the Leg's real
  // movement isn't resolved yet (that's what Phase VI's roll -- fed by the
  // very A/D this determines -- is for), the lane change itself happens
  // later, in finishLeg(), once movement is known; this only clamps the
  // declared magnitude to physically available lanes and decides the A/D.
  // It grants +1 Advantage per hex if the destination lane is further
  // outward or -1 Disadvantage per hex if it's further inward, UNLESS the
  // whole projected Leg -- current hex, forward by (declared Acceleration
  // minus the Slip amount), then each diagonal Slip step in turn -- stays
  // entirely on a straightaway; touching
  // a curve anywhere along that projected span uses the curve A/D. The A/D
  // itself is applied via pilotExtraNet() (not folded into
  // ps.conditions.pilot) so it shows as its own "Slip" line in
  // legAdSourcesHtml() instead of disappearing into "Conditions."
  if (course.trackType === "circular") {
    const geom = circTrackGeometry(course);
    Object.entries(ls.perShip).forEach(([pid, ps]) => {
      ps.slipAdvantage = 0;
      if (!ps.slip) { ps.slipHexes = 0; return; }
      const participant = race.participants.find(p => p.id === pid);
      // The track runs counterclockwise (see RULE_CHANGES.md) -- facing the
      // direction of travel, steering LEFT points toward the track's center
      // (inward, toward lane 1) and RIGHT points away from it (outward,
      // toward a higher lane number), the same way a driver on a real
      // counterclockwise oval steers left to move to the inside lane.
      // House rule (see RULE_CHANGES.md): a Slip is also capped at the ship's
      // declared Acceleration -- a ship can't Slip more hexes than its own
      // declared G rate this Leg, on top of the lanes actually available.
      const maxLane = Math.min(ps.slip === "left" ? participant.lane - 1 : course.lanes - participant.lane, ps.accel || 0);
      const hexes = clampInt(ps.slipHexes, 0, Math.max(0, maxLane), 0);
      ps.slipHexes = hexes;
      if (hexes <= 0) { ps.slip = ""; return; }
      const originLaneIdx0 = participant.lane - 1;
      const originHexPos = participant.hexPos || 0;
      const dir = ps.slip === "left" ? -1 : 1;
      // Touches a curve if the origin hex does, or if any hex along the
      // projected path (declared Acceleration's worth of movement,
      // interleaved with the declared Slip hexes the same way
      // resolveSlipPath() actually resolves the Leg -- see RULE_CHANGES.md)
      // does.
      const projected = resolveSlipPath(geom, originLaneIdx0, originHexPos, ps.accel || 0, hexes, dir);
      let touchesCurve = !isHexOnStraight(geom, originLaneIdx0, originHexPos);
      for (let i = 0; !touchesCurve && i < projected.steps.length; i++) {
        const step = projected.steps[i];
        if (!isHexOnStraight(geom, step.laneIdx0, step.hexPos)) touchesCurve = true;
      }
      ps.slipAdvantage = touchesCurve ? (ps.slip === "right" ? hexes : -hexes) : 0;
    });
  }
  // Apply maneuvers: each position may run its own Maneuver against the SAME
  // position on the chosen targets (see RULE_CHANGES.md).
  Object.entries(ls.perShip).forEach(([pid, ps]) => {
    const tier = getShipClass(getShip(race.participants.find(p => p.id === pid).shipId).shipClass).tier;
    ps.maneuverInstigatedByPos = ps.maneuverInstigatedByPos || { pilot: 0, navigator: 0, spotter: 0, engineer: 0 };
    POSITIONS.forEach(pos => {
      const mvName = ps.maneuvers && ps.maneuvers[pos];
      if (!mvName) return;
      const mv = GDATA.MANEUVERS.find(m => m.name === mvName);
      if (!mv) return;
      const dAmount = mv.disadv === "Tier" ? tier : mv.disadv;
      const targets = (ps.maneuverTargets && ps.maneuverTargets[pos]) || [];
      targets.forEach(tid => {
        // Hero target: Disadvantage lands on the SAME position. NPC target: no
        // per-position rolls, so it applies to the NPC's single roll as normal.
        if (ls.perShip[tid]) {
          const t = ls.perShip[tid];
          t.maneuverReceivedByPos = t.maneuverReceivedByPos || { pilot: 0, navigator: 0, spotter: 0, engineer: 0 };
          t.maneuverReceivedByPos[pos] += dAmount;
        } else if (ls.npcState[tid]) ls.npcState[tid].maneuverReceivedD += dAmount;
      });
      let selfD = dAmount * (targets.length > 0 ? 1 : 0);
      if (targets.length > 1) selfD += (targets.length - 1); // +1 Disadvantage per additional target
      ps.maneuverInstigatedByPos[pos] += selfD;
    });
  });
  ls.declLocked = true;
  saveState();
}
function rollResistance(pid) {
  const race = STATE.race, ps = race.legState.perShip[pid];
  const ship = getShip(race.participants.find(p => p.id === pid).shipId);
  const cls = getShipClass(ship.shipClass);
  const uncompensated = Math.max(0, ps.accel - cls.damper);
  const tn = uncompensated * 3;
  const crewIds = [...new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean))];
  const result = {};
  crewIds.forEach(cid => {
    const crewman = getCrew(cid);
    const heldPositions = POSITIONS.filter(pos => ship.assignments[pos] === cid);
    if (tn <= 0) {
      result[cid] = { pass: true, total: null, tn, positions: heldPositions, skipped: true };
      return;
    }
    // Phase I conditions apply to the Resistance check too (see RULE_CHANGES.md):
    // each condition checked on this crewman is −1 Disadvantage on their roll.
    const condFlags = (ps._condFlags && ps._condFlags[cid]) || {};
    const condCount = Object.values(condFlags).filter(Boolean).length;
    const net = (crewman.skills.resistance.adv || 0) - condCount;
    const rc = rollCheck(crewman.skills.resistance.score, net, tn);
    // Store the full roll so Phase II can show it the same way every other phase
    // does (dice → chosen + score = total vs TN → outcome).
    result[cid] = {
      pass: rc.success, total: rc.total, tn, positions: heldPositions, fumble: rc.isFumble,
      dice: rc.dice, chosen: rc.chosen, score: crewman.skills.resistance.score, net: rc.net, conds: condCount
    };
    if (!rc.success) {
      heldPositions.forEach(pos => { ps.resistanceDelta[pos] -= 1; });
    }
    if (rc.isFumble) ps.autoLast = true;
  });
  ps.resistance = result;
  saveState();
}
function netForPosition(ps, shipDisplay, pos, extra) {
  extra = extra || 0;
  // Maneuver Disadvantage on THIS position: received (as a target) plus the
  // instigator's own self-cost for acting from this position. Guarded for old
  // cached legs that predate these per-position fields.
  const manRecv = (ps.maneuverReceivedByPos && ps.maneuverReceivedByPos[pos]) || 0;
  const manSelf = (ps.maneuverInstigatedByPos && ps.maneuverInstigatedByPos[pos]) || 0;
  const raw = shipDisplay[pos].finalAdv + ps.conditions[pos] + ps.resistanceDelta[pos] + ps.grants[pos] - manRecv - manSelf + extra;
  // House rule (see RULE_CHANGES.md): the effective Leg skill caps at AAAAA. Stacked
  // crew+AI+grants past MAX_ADV are wasted. Disadvantage has no floor (no leg max DDDD).
  return Math.min(raw, MAX_ADV);
}
function pilotExtraNet(ps) {
  // Maneuvers (received + self-cost) are now per-position, handled in
  // netForPosition. Net Leg Acceleration and a Slip's A/D are Pilot-specific
  // here (not folded into ps.conditions.pilot) so each gets its own labeled
  // line in legAdSourcesHtml() instead of vanishing into a generic total.
  // ps.slipAdvantage (set in lockDeclarations()) is signed and already scaled
  // by hexes slipped -- 0 if the Slip was entirely within a straightaway.
  // ps.crowdedFieldD (set in initLegState() from last Leg's finishLeg()
  // detection -- see RULE_CHANGES.md) is -1 if 2+ ships shared a hex
  // entering this Leg, else 0.
  return (ps.netLegAcc || 0) + (ps.slipAdvantage || 0) + (ps.crowdedFieldD || 0);
}
/* House rule (see RULE_CHANGES.md): Speed Bonus IS the Leg's declared Acceleration,
   1-for-1 -- it's the whole basis of the Leg-win ranking score (see rollPhase()'s
   pilot branch), independent of the Damper-based Advantage/Disadvantage used for
   the TN check's dice pool. */
function speedBonus(accel) { return accel || 0; }
function rollPhase(pid, phase) {
  const race = STATE.race, ls = race.legState, ps = ls.perShip[pid];
  const ship = getShip(race.participants.find(p => p.id === pid).shipId);
  const disp = computeShipDisplay(ship);
  const tn = ls.leg.finalTN;
  if (phase === "pilot") {
    const net = netForPosition(ps, disp, "pilot", pilotExtraNet(ps));
    // Resolve the dice pool against the TN exactly as normal — Success/Failure and
    // Critical/Fumble come entirely from skill and the dice pool. rc is left untouched.
    const rc = rollCheck(disp.pilot.finalScore, net, tn);
    // House rule (see RULE_CHANGES.md): the d20 roll and Pilot Leg Skill Score
    // (rc.total) do NOT factor into who wins the Leg at all -- rc is rolled only
    // to resolve the TN check (Success/Failure) and classify Critical/Fumble.
    // The Leg-win ranking score (the Leg Ranking Score shown on the card, and
    // each Hero's own Movement on a Circular Track) is Speed Bonus alone,
    // +1 per Critical Success LEVEL (past the first success die), or -1 per
    // Fumble LEVEL (past the first failure die) -- never both, since Crit
    // only happens on Advantage rolls and Fumble only on Disadvantage. This
    // is distinct from the Base Leg Result (see computeBaseLegResult()),
    // which is Speed-Bonus-only across all Heroes (2026-08-21 rule change).
    const sb = speedBonus(ps.accel);
    const critBonus = rc.critLevels;
    const fumblePenalty = rc.fumbleLevels;
    ps.results.pilot = { net, rc, speedBonus: sb, critBonus, fumblePenalty, rankTotal: sb + critBonus - fumblePenalty };
  } else {
    const net = netForPosition(ps, disp, phase, 0);
    const rc = rollCheck(disp[phase].finalScore, net, tn);
    ps.results[phase] = { net, rc };
    autoApplyGrant(pid, phase);
  }
  saveState();
}
/* House rule (see RULE_CHANGES.md): Engineer/Spotter/Navigator may decline to
   roll; it counts as a plain Failure (same -1 D grant, free choice of target —
   never the Critical/Fumble fixed-choice options) with no dice involved.
   Player-facing label is "Play It Safe" (renamed from "Skip"); the internal
   name and mechanics are unchanged. */
function skipPhase(pid, phase) {
  const ls = STATE.race.legState;
  const rc = { dice: [], chosen: null, tn: ls.leg.finalTN, total: null, success: false, successCount: 0, failCount: 0, critLevels: 0, fumbleLevels: 0, isCrit: false, isFumble: false, net: null };
  ls.perShip[pid].results[phase] = { net: null, rc, skipped: true };
  autoApplyGrant(pid, phase);
  saveState();
}
function applyGrant(pid, phase, targetPos, amountOverride) {
  const ps = STATE.race.legState.perShip[pid];
  const res = ps.results[phase];
  if (!res) return;
  const rc = res.rc;
  let amount = amountOverride;
  if (amount === undefined) {
    if (rc.isCrit) amount = 2; else if (rc.isFumble) amount = -2; else amount = rc.success ? 1 : -1;
  }
  ps.grants[targetPos] += amount;
  res.applied = { targetPos, amount };
  saveState();
}
/* House rule (see RULE_CHANGES.md): the grant target (and, on a Crit/Fumble,
   therefore the amount too) is fully determined before rolling -- there's no
   longer a live choice to make afterward, so the grant is applied the moment
   the result exists, with no separate manual step. Mirrors exactly what
   renderPhaseRollBlock() would have shown as the (now-removed) Apply button. */
function autoApplyGrant(pid, phase) {
  if (phase === "pilot") return;
  const ps = STATE.race.legState.perShip[pid];
  const res = ps.results[phase];
  if (!res || res.applied) return;
  const target = phase === "navigator" ? "pilot" : ps.grantChoice[phase];
  const critFumbleTargets = CRIT_FUMBLE_GRANT_TARGETS[phase];
  const rc = res.rc;
  if (critFumbleTargets && (rc.isCrit || rc.isFumble)) {
    const sign = rc.isCrit ? 1 : -1;
    applyGrant(pid, phase, target, target === "pilot" ? sign : sign * 2);
  } else {
    applyGrant(pid, phase, target);
  }
}
function computeBaseLegResult() {
  const race = STATE.race, ls = race.legState;
  // House rule (see RULE_CHANGES.md): the Base Leg Result -- the baseline
  // NPC Performance rolls are added to -- averages Heroes' Speed Bonus
  // ALONE, not their full Leg Ranking Score. A Hero's own Critical
  // Success/Fumble still adjusts THEIR OWN Leg Ranking Score (and Movement
  // on a Circular Track) as always -- it just no longer skews the shared
  // NPC baseline every Hero's dice luck feeds into.
  const totals = Object.values(ls.perShip)
    .filter(ps => ps.results.pilot && !ps.autoLast)
    .map(ps => ps.results.pilot.speedBonus);
  ls.baseLegResult = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
  saveState();
}
function rollNpc(pid) {
  // Per p.35: NPCs use d6s instead of d20s for Advantage/Disadvantage — each level
  // rolls one more d6, keeping the lowest (Disadvantage) or highest (Advantage) to
  // pick the NPC Performance row. No Crit/Fumble for NPCs, just the extreme die.
  const race = STATE.race, ls = race.legState;
  const disadv = (ls.npcState[pid] && ls.npcState[pid].maneuverReceivedD) || 0;
  const net = -disadv; // Racing Maneuvers only ever impose Disadvantage on NPC targets today
  const diceCount = Math.abs(net) + 1;
  const dice = Array.from({ length: diceCount }, () => rollD(6));
  const chosen = net >= 0 ? Math.max(...dice) : Math.min(...dice);
  const entry = GDATA.NPC_PERFORMANCE[chosen - 1];
  const total = (ls.baseLegResult || 0) + entry.mod;
  ls.npcResults[pid] = { dice, chosen, net, name: entry.name, mod: entry.mod, total };
  saveState();
}
function finishLeg() {
  const race = STATE.race, ls = race.legState;
  const course = getCourse(race.courseId);
  const circular = course.trackType === "circular";
  const N = race.participants.length;
  const rows = race.participants.map(p => {
    if (p.type === "hero") {
      const ps = ls.perShip[p.id];
      // Forced-last (Fumble "Position (Last)") ranks at the bottom like autoLast,
      // but the ship still played its phases this Leg. A destroyed ship (HP 0) is
      // frozen -- no movement at all -- whether it blew up this Leg or an earlier one.
      const forcedLast = (p.forcedLastLegs || 0) > 0;
      const lastPlace = ps.autoLast || forcedLast || !!p.out;
      const frozen = !!p.out; // destroyed = out of the race, makes no further progress
      const rankTotal = ps.results.pilot ? ps.results.pilot.rankTotal : -999;
      const total = lastPlace ? -999 : rankTotal;
      const successCount = ps.results.pilot ? ps.results.pilot.rc.successCount : 0;
      const fumbleCount = ps.results.pilot ? ps.results.pilot.rc.failCount - 1 : 0;
      return { id: p.id, name: shipName(p.shipId), type: "hero", total, rankTotal, successCount, fumbleCount: Math.max(0, fumbleCount), autoLast: ps.autoLast, lastPlace, frozen, out: !!p.out };
    } else {
      // An NPC removed for falling too far behind (see below) is frozen -- no
      // more movement -- and ranks last, just like a destroyed Hero.
      const frozen = !!p.out;
      const r = ls.npcResults[p.id] || { total: -999 };
      return { id: p.id, name: p.name, type: "npc", total: frozen ? -999 : r.total, rankTotal: r.total, successCount: 0, fumbleCount: 0, autoLast: false, lastPlace: frozen, frozen, out: frozen };
    }
  });
  rows.sort((a, b) => {
    if (a.lastPlace !== b.lastPlace) return a.lastPlace ? 1 : -1;
    if (b.total !== a.total) return b.total - a.total;
    if (b.successCount !== a.successCount) return b.successCount - a.successCount;
    return a.fumbleCount - b.fumbleCount;
  });
  let lastPos = 0, lastKey = null;
  rows.forEach((r, i) => {
    const key = r.lastPlace ? "AL" : `${r.total}|${r.successCount}|${r.fumbleCount}`;
    if (key !== lastKey) { lastPos = i + 1; lastKey = key; }
    r.position = lastPos;
    // Distance Tracking (see RULE_CHANGES.md): hexes moved this Leg is the ship's
    // real Leg Finishing Score, floored at 0 -- Fumbles and Disadvantage slow a
    // ship, never send it backward. The points-ranking "forced last" override
    // (via r.total/-999) is a straight-course-only concept and doesn't apply here.
    // A Slip no longer costs Movement Points beyond ordinary movement (see
    // RULE_CHANGES.md) -- it only changes lane and, off a straightaway,
    // Advantage/Disadvantage.
    r.movement = r.frozen ? 0 : (circular ? Math.max(0, r.rankTotal) : (N - lastPos + 1));
    // House rule (see RULE_CHANGES.md): if the Pilot Fails or Fumbles their
    // own Task Check this Leg, Movement (MPs) for the Leg is cut in half,
    // rounded up -- applied here, BEFORE any Slip calculations below, so a
    // Slip's hexes (and the curve-touch Advantage/Disadvantage) are based
    // on the ALREADY-HALVED total, never the full pre-Fumble amount.
    if (circular && r.type === "hero") {
      const pilotRc = ls.perShip[r.id] && ls.perShip[r.id].results.pilot && ls.perShip[r.id].results.pilot.rc;
      if (pilotRc && !pilotRc.success) r.movement = Math.ceil(r.movement / 2);
    }
  });
  const circGeom = circular ? circTrackGeometry(course) : null;
  rows.forEach(r => {
    const participant = race.participants.find(p => p.id === r.id);
    participant.cumulative += r.movement; // straight: points; circular: total hexes traveled (monotonic)
    if (circular) {
      // Circular Track Slip (see RULE_CHANGES.md): the Slip's hexes are
      // taken first, then the ship continues forward in its new lane -- see
      // resolveSlipPath(). A ship that didn't Slip this Leg (or rolled 0
      // movement) just moves forward in its current lane as always.
      const ps = ls.perShip[r.id];
      const originLaneIdx0 = participant.lane - 1;
      const declaredSlipHexes = (ps && ps.slip) ? (ps.slipHexes || 0) : 0;
      const actualSlipHexes = Math.min(declaredSlipHexes, Math.max(0, r.movement));
      const dir = (ps && ps.slip === "left") ? -1 : 1;
      // House rule (see RULE_CHANGES.md): Slingshot. An inward Slip that
      // touches a curve (ps.slipAdvantage is negative ONLY for "left" +
      // touchesCurve, per lockDeclarations()) grants 1 bonus MP per hex
      // actually Slipped this Leg (actualSlipHexes, already shrunk by any
      // Fail/Fumble halving or lane clamp above) -- pure extra forward
      // movement on top, not an extra Slip hex. Gated on an ACTIVE dive
      // toward the inside this Leg, never on merely occupying the inside
      // lane already.
      const slingshotBonus = (ps && ps.slipAdvantage < 0) ? actualSlipHexes : 0;
      const totalMovement = r.movement + slingshotBonus;
      participant.cumulative += slingshotBonus;
      const path = resolveSlipPath(circGeom, originLaneIdx0, participant.hexPos || 0, totalMovement, actualSlipHexes, dir);
      participant.lane = path.finalLaneIdx0 + 1;
      participant.hexPos = path.finalHexPos;
      participant.laps = (participant.laps || 0) + path.lapsGained;
      participant.history.push({ leg: race.legIndex + 1, total: r.total, position: r.position, movement: totalMovement, lane: participant.lane, laps: participant.laps, hexPos: participant.hexPos, slipHexes: actualSlipHexes, slingshotBonus });
    } else {
      participant.history.push({ leg: race.legIndex + 1, total: r.total, position: r.position, movement: r.movement });
    }
    if (participant.type === "hero" && participant.forcedLastLegs > 0) participant.forcedLastLegs -= 1;
  });
  // House rule (see RULE_CHANGES.md): Crowded Field. Any 2+ ships (hero or NPC)
  // that end this Leg sharing the same hex flag every HERO among them for a
  // one-Leg Pilot Disadvantage next Leg, 1 D per ship in the hex (consumed
  // in initLegState() via crowdedFieldD) -- an NPC can crowd a Hero's hex
  // even though only a Hero has a Pilot to penalize.
  if (circular) {
    const byHex = {};
    race.participants.forEach(p => {
      if (p.out) return;
      const key = `${p.lane}|${p.hexPos}`;
      (byHex[key] = byHex[key] || []).push(p);
    });
    Object.values(byHex).forEach(group => {
      if (group.length < 2) return;
      group.forEach(p => { if (p.type === "hero") p.crowdedFieldNextLeg = group.length; });
    });
  }
  // House rule (see RULE_CHANGES.md): an NPC sitting in LAST place, more than one
  // full Leg's worth of movement behind the SECOND-to-last ship, is out of the
  // race -- its bar freezes where it is (see renderStandings). A full Leg's max
  // movement is N (the racer count), so the gap scales with the field instead of
  // a flat number. Loop so a detached tail can clear in one Leg; stops as soon as
  // last place is a Hero or the gap closes to <= one Leg. Distance Tracking
  // measures in hexes, not points, so this points-scaled gap doesn't apply there.
  if (!circular) {
    while (true) {
      const inRace = race.participants.filter(p => !p.out).sort((a, b) => a.cumulative - b.cumulative);
      if (inRace.length < 2) break;
      const last = inRace[0], secondLast = inRace[1];
      if (last.type === "npc" && (secondLast.cumulative - last.cumulative) > N) {
        last.out = true; last.outLeg = race.legIndex;
      } else break;
    }
  }

  // Record any Fumble descriptions rolled this Leg so they show in the Race Log.
  const fumbles = [];
  race.participants.forEach(p => {
    if (p.type !== "hero") return;
    const ps = ls.perShip[p.id];
    if (ps && ps.fumbleText) fumbles.push({ name: shipName(p.shipId), text: ps.fumbleText });
  });
  race.log.push({ legIndex: race.legIndex, rows: rows.map(r => ({ ...r })), fumbles });

  if (circular) {
    // Distance Tracking has no fixed Leg count -- the race ends the Leg any
    // in-race participant completes the course's required laps (see RULE_CHANGES.md).
    const someoneFinished = race.participants.some(p => !p.out && (p.laps || 0) >= course.laps);
    if (someoneFinished || livingHeroes(race).length === 0) {
      race.finished = true;
    } else {
      race.legIndex += 1;
      initLegState(race); // rolls the next Leg fresh -- see rollCircularLeg()
    }
  } else {
    // End the race when the course is done, OR once every Hero has been destroyed
    // (a wreck is only removed after the Leg it died on has finished resolving).
    if (race.legIndex + 1 >= course.legs.length || livingHeroes(race).length === 0) {
      race.finished = true;
    } else {
      race.legIndex += 1;
      initLegState(race);
    }
  }
  saveState();
}
function shipName(shipId) { const s = getShip(shipId); return s ? s.name : "(deleted ship)"; }

/* ============================== Rendering ============================== */
let CURRENT_TAB = "shipyard";
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
}

/* ---------- Cantina: create Hero crewmembers ---------- */
/* Crew skill summaries (Cantina header + Hangar crew dropdown). "Score" is the
   raw skill Score; the highest one on a crewman is highlighted so players can
   compare Heroes at a glance. */
const CREW_SKILL_FULL = [["pilot", "Pilot"], ["navigator", "Navigator"], ["spotter", "Spotter"], ["engineer", "Engineer"], ["resistance", "Resistance"]];
const CREW_SKILL_ABBR = [["pilot", "Pil"], ["navigator", "Nav"], ["spotter", "Spot"], ["engineer", "Eng"], ["resistance", "Res"]];
// Effective skill value for ranking: raw Score adjusted by net Advantage(+)/
// Disadvantage(-), so A/D count when deciding a crewman's best skill.
function crewSkillEff(sk) { return (sk.score || 0) + (sk.adv || 0); }
// Shared skill cells: one column per skill showing its Skill Mk (score + A/D),
// with the crewman's best skill (by effective value) highlighted in gold.
// `defs` picks full labels (Cantina) or abbreviations (dropdown).
function crewSkillCells(c, defs) {
  const effs = defs.map(([k]) => crewSkillEff(c.skills[k]));
  const max = Math.max.apply(null, effs);
  return defs.map(([k, label]) => {
    const sk = c.skills[k];
    const hi = (crewSkillEff(sk) === max && max > 0) ? " hi" : "";
    return `<span class="crewskill${hi}"><span class="lbl">${label}</span><span class="val">${formatMk(sk.score, sk.adv)}</span></span>`;
  }).join("");
}
function crewSkillHeaderHtml(c, total) {
  let cells = crewSkillCells(c, CREW_SKILL_FULL);
  // Total Points rendered as one more matching cell, same size as the rest.
  cells += `<span class="crewskill total"><span class="lbl">Total</span><span class="val">${total}</span></span>`;
  return `<span class="crewskills">${cells}</span>`;
}
// Inline skill summary for the dropdown ("Pil-7, Nav-3A, ...") with the best
// skill (by effective value) coloured gold.
function crewSkillInlineHtml(c) {
  const effs = CREW_SKILL_ABBR.map(([k]) => crewSkillEff(c.skills[k]));
  const max = Math.max.apply(null, effs);
  return CREW_SKILL_ABBR.map(([k, ab]) => {
    const sk = c.skills[k];
    const hi = (crewSkillEff(sk) === max && max > 0) ? " hi" : "";
    return `<span class="ddskill${hi}">${ab}-${formatMk(sk.score, sk.adv)}</span>`;
  }).join("");
}
// Custom crew-assignment dropdown for the Hangar Bay. A native <select> can't
// colour-highlight its options, so this is a hand-rolled listbox: the closed
// button shows the selected crewman's name; the open menu lists every crewman
// with the same gold-highlighted skill columns as the Cantina header.
function crewDropdownHtml(ship, pos) {
  const selId = ship.assignments[pos] || "";
  const sel = selId ? getCrew(selId) : null;
  let opts = `<div class="crewdd-opt${selId ? "" : " chosen"}" onclick="App.crewDDpick('${ship.id}','${pos}','')"><span class="crewdd-name muted">— none —</span></div>`;
  opts += STATE.crew.map(c =>
    `<div class="crewdd-opt${c.id === selId ? " chosen" : ""}" onclick="App.crewDDpick('${ship.id}','${pos}','${c.id}')">
      <span class="crewdd-name">${esc(c.name)}</span>
      <span class="ddskills">${crewSkillInlineHtml(c)}</span>
    </div>`).join("");
  return `<div class="crewdd">
    <button type="button" class="crewdd-btn" onclick="App.crewDDtoggle(this)">
      <span>${sel ? esc(sel.name) : "—"}</span><span class="crewdd-caret">▾</span></button>
    <div class="crewdd-menu">${opts}</div>
  </div>`;
}
function renderCantina() {
  let html = `<section class="card"><h2>Crew</h2>`;
  html += `<div class="row"><select id="presetCrew">${GDATA.PRESET_CREW.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select>
    <button onclick="App.addPresetCrew()">+ Add Preset</button>
    <button class="ghost" onclick="App.addBlankCrew()">+ Add Blank Crewman</button></div>`;
  if (!STATE.crew.length) html += `<p class="muted">No crew yet. Add a preset from <em>Stars of the Show</em> or a blank crewman.</p>`;
  STATE.crew.forEach(c => {
    const total = crewTotalCost(c);
    const collapsed = !!c._collapsed;
    html += `<div class="subcard">
      <div class="row">
        <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleCrewCollapse('${c.id}')">${collapsed ? "▸" : "▾"}</button>
        <input class="name-input" value="${esc(c.name)}" onchange="App.updateCrew('${c.id}','name',this.value)">
        ${collapsed ? "" : `<button class="ghost" title="Random Hero name" onclick="App.rerollCrewName('${c.id}')">🎲</button>`}
        ${collapsed
          ? ""
          : `<label>Unspent XP <input type="number" style="width:56px" value="${c.unspentPoints || 0}" onchange="App.updateUnspentPoints('${c.id}',this.value)"></label>`}
        ${crewSkillHeaderHtml(c, total)}
        <button class="danger" style="margin-left:auto" onclick="App.deleteCrew('${c.id}')">Delete</button>
      </div>`;
    if (!collapsed) {
      html += `<table class="mktable skilltable">
        <tr><th>Skill</th><th>Score</th><th>Advantage (+) /<br>Disadvantage (−)</th><th>Skill Mk</th><th>Cost</th></tr>
        ${POSITIONS.concat("resistance").map(pos => {
          const label = pos === "resistance" ? "Resistance" : POS_LABEL[pos];
          const s = c.skills[pos];
          return `<tr>
            <td>${label}</td>
            <td><input type="number" style="width:56px" value="${s.score}" onchange="App.updateSkill('${c.id}','${pos}','score',this.value)"></td>
            <td><input type="number" style="width:56px" value="${s.adv}" onchange="App.updateSkill('${c.id}','${pos}','adv',this.value)"></td>
            <td><b>${formatMk(s.score, s.adv)}</b></td>
            <td>${skillCost(s.score, s.adv)}</td>
          </tr>`;
        }).join("")}
        <tr><td colspan="4"><b>Total Points</b></td><td><b>${total}</b></td></tr>
      </table>`;
    }
    html += `</div>`;
  });
  html += `</section>`;
  return html;
}

/* ---------- Hangar Bay: build ships from Ship Classes and Hero crew ---------- */
function renderHangarBay() {
  if (!STATE.shipClasses.length) {
    return `<section class="card"><h2>Ships</h2>
      <p class="muted">No Ship Classes yet. Build one in the Shipyard tab first, then come back here to build ships from it.</p></section>`;
  }
  let html = `<section class="card"><h2>Ships</h2>
    <div class="row"><button onclick="App.addShip()">+ Add Ship</button>
    <label>Division <select onchange="App.setHangarAddDivision(this.value)">
      ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === (STATE._hangarAddDivision || "Comet") ? "selected" : ""}>${d}</option>`).join("")}
    </select></label>
    <button class="ghost" onclick="App.randomShipName()">🎲 Name Idea</button> <span id="nameIdea" class="muted"></span></div>`;
  if (!STATE.ships.length) html += `<p class="muted">No ships yet.</p>`;
  // Group ships into a collapsible per-Division tree (Flash..Nova order).
  STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
  GDATA.DIVISIONS.forEach(div => {
    const ships = STATE.ships.filter(s => (s.cls || "Comet") === div);
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
  html += `</section>`;
  return html;
}
function renderShipCard(ship) {
    let html = "";
    const cls = getShipClass(ship.shipClass);
    if (!cls) {
      return `<div class="subcard"><div class="row">
        <input class="name-input" value="${esc(ship.name)}" onchange="App.updateShip('${ship.id}','name',this.value)">
        <label>Ship Class
          <select onchange="App.updateShip('${ship.id}','shipClass',this.value)">
            <option value="">-- choose a Ship Class --</option>
            ${shipClassNamesForDivision(ship.cls).map(d => `<option value="${d}">${d}</option>`).join("")}
          </select></label>
        <button class="danger" onclick="App.deleteShip('${ship.id}')">Delete</button>
      </div></div>`;
    }
    const disp = computeShipDisplay(ship);
    const collapsed = !!ship._collapsed;
    html += `<div class="subcard">
      <div class="row">
        <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleShipCollapse('${ship.id}')">${collapsed ? "▸" : "▾"}</button>
        ${iconThumbImg(ship)}
        <input class="name-input" value="${esc(ship.name)}" onchange="App.updateShip('${ship.id}','name',this.value)">
        ${collapsed ? "" : `<button class="ghost" title="Random ship name" onclick="App.rerollShipName('${ship.id}')">🎲</button>`}
        <label>Division
          <select onchange="App.updateShip('${ship.id}','cls',this.value)">
            ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === ship.cls ? "selected" : ""}>${d}</option>`).join("")}
          </select></label>
        <label>Ship Class
          <select onchange="App.updateShip('${ship.id}','shipClass',this.value)">
            ${shipClassNamesForDivision(ship.cls).map(d => `<option value="${d}" ${d === ship.shipClass ? "selected" : ""}>${d}</option>`).join("")}
          </select></label>
        ${collapsed
          ? `<span class="tag">Total Points ${shipClassTotalCost(cls)}</span><span class="tag ${shipCrewComplete(ship) ? "" : "danger"}">${shipCrewComplete(ship) ? "" : "🔒 "}Crew ${distinctCrewCount(ship)}/${minCrewFor(ship)}</span>`
          : `<span class="tag">Tier ${cls.tier}</span><span class="tag">${cls.maxThrust}-G</span><span class="tag">Damper ${cls.damper}</span>
        <span class="tag ${shipCrewComplete(ship) ? "" : "danger"}" title="${shipCrewComplete(ship) ? "All positions filled -- race-legal" : `Locked out of racing: ${crewLockMessage(ship)}`}">${shipCrewComplete(ship) ? "" : "🔒 "}Crew ${distinctCrewCount(ship)}/${minCrewFor(ship)}</span>
        <span class="tag">HP ${cls.hp}</span><span class="tag">DR ${cls.dr}</span>`}
        <button class="danger" onclick="App.deleteShip('${ship.id}')">Delete</button>
      </div>`;
    if (!collapsed) {
      html += `<div class="row">
        <label>Sponsor Bonus:
          <select onchange="App.updateShip('${ship.id}','sponsorBonusPos',this.value)">
            <option value="">none</option>
            ${POSITIONS.map(p => `<option value="${p}" ${ship.sponsorBonusPos === p ? "selected" : ""}>${POS_LABEL[p]}</option>`).join("")}
          </select>
        </label>
        <label>Sponsor Penalty:
          <select onchange="App.updateShip('${ship.id}','sponsorPenaltyPos',this.value)">
            <option value="">none</option>
            ${POSITIONS.map(p => `<option value="${p}" ${ship.sponsorPenaltyPos === p ? "selected" : ""}>${POS_LABEL[p]}</option>`).join("")}
          </select>
        </label>
      </div>
      <table class="mktable shiptable">
        <tr><th>Position</th><th>Crewman</th><th>Crew Skill</th><th>Ship AI</th><th>Bonus</th><th>Penalty</th><th>Ship Skill Mk</th></tr>
        ${POSITIONS.map(pos => `<tr>
          <td>${POS_LABEL[pos]}</td>
          <td>${crewDropdownHtml(ship, pos)}</td>
          <td>${formatMk(disp[pos].crewScore, disp[pos].crewAdv)}</td>
          <td>${formatMk(disp[pos].shipAI, disp[pos].shipAIAdv)}</td>
          <td>${disp[pos].bonus >= 0 ? "+" : ""}${disp[pos].bonus}</td>
          <td>${disp[pos].penalty}</td>
          <td><b>${disp[pos].mk}</b></td>
        </tr>`).join("")}
      </table>
      ${renderShipIconPicker(ship)}`;
    }
    html += `</div>`;
    return html;
}

/* Icon pickers (see GDATA.SHIP_ICON_* in data.js): a grid of clickable
   thumbnails. An icon already used by another Class/Ship is greyed out and
   disabled; the current selection is highlighted, and clicking it again
   removes it (toggle) -- that's the only way to unpick, there's no separate
   Clear button.
   House rule (see APP_CHANGES.md): a Ship's icon NUMBER always matches its
   Ship Class's icon number -- only the COLOR is free (Red/Green/Blue). A
   Class's icon is always White. This means at most 3 Ships (one per color)
   can ever be built from a single Class. */
function renderClassIconPicker(sc) {
  const used = usedClassIconNumbers(sc.id, sc.division);
  const swatches = GDATA.SHIP_ICON_NUMBERS.map(num => {
    const selected = sc.icon === num;
    const takenByOther = used.has(num) && !selected;
    const cls = ["iconbtn"].concat(selected ? ["selected"] : []).concat(takenByOther ? ["used"] : []).join(" ");
    const title = takenByOther ? `Already used by another ${sc.division} Ship Class` : (selected ? `Icon ${num} (click to remove)` : `Icon ${num}`);
    const action = takenByOther ? "disabled" : `onclick="App.updateShipClassIcon('${sc.id}','${selected ? "" : num}')"`;
    return `<button type="button" class="${cls}" ${action} title="${title}"><img src="${esc(shipIconPath(sc.division, num, GDATA.SHIP_CLASS_ICON_COLOR))}" alt="Icon ${num}"></button>`;
  }).join("");
  return `<div class="row"><b>Icon</b></div>
    <div class="iconpicker">${swatches}</div>`;
}
function renderShipIconPicker(ship) {
  const sc = STATE.shipClasses.find(c => c.name === ship.shipClass);
  const classIconNum = sc && sc.icon;
  if (!classIconNum) {
    return `<div class="row"><b>Icon</b></div>
      <p class="muted">Give "${esc(ship.shipClass)}" an Icon in the Shipyard tab first -- a Ship's icon number always matches its Class's.</p>`;
  }
  const used = usedShipIconKeys(ship.id);
  const swatches = GDATA.SHIP_ICON_COLORS.map(color => {
    const selected = ship.iconColor === color && ship.iconNumber === classIconNum;
    const takenByOther = used.has(`${sc.division}|${color}|${classIconNum}`) && !selected;
    const cls = ["iconbtn"].concat(selected ? ["selected"] : []).concat(takenByOther ? ["used"] : []).join(" ");
    const title = takenByOther ? "Already used by another ship" : (selected ? `${color} ${classIconNum} (click to remove)` : `${color} ${classIconNum}`);
    const action = takenByOther ? "disabled" : `onclick="App.updateShipIcon('${ship.id}','${selected ? "" : color}','${selected ? "" : classIconNum}')"`;
    return `<button type="button" class="${cls}" ${action} title="${title}"><img src="${esc(shipIconPath(sc.division, classIconNum, color))}" alt="${color} ${classIconNum}"></button>`;
  }).join("");
  return `<div class="row"><b>Icon</b> <span class="muted">number ${classIconNum} (matches the Ship Class) -- pick a color</span></div>
    <div class="iconpicker">${swatches}</div>`;
}

/* ---------- Shipyard: build new Ship Classes ---------- */
/* Ship Classes: user-defined ship models, distinct from the book's built-in
   Divisions (Flash/Spark/Comet/Meteor/Nova -- see APP_CHANGES.md for how
   Division and Ship Class differ). Every custom class must pick which
   Division it's legal for; Tier, Damper, and Min Crew all come straight
   from that Division's own stat block, not editable here. Spark locks Ship
   AI Score at 0 (Advantage/Disadvantage still free) -- same as the book's
   own Spark entry. Acc is a plain point-costed number (no Advantage/
   Disadvantage); Spotter/Navigator/Pilot are Score+Advantage, same p.25
   point cost used for crew -- all four sum into Total Points. */
function renderShipyard() {
  let html = `<section class="card"><h2>Ship Classes</h2>`;
  html += `<div class="row"><select id="presetShipClass">${GDATA.DIVISIONS.map(d => `<option value="${d}">${d} (${GDATA.SHIP_CLASSES[d].common})</option>`).join("")}</select>
    <button onclick="App.addPresetShipClass()">+ Add Preset</button>
    <button class="ghost" onclick="App.addShipClass()">+ Add Blank Ship Class</button></div>`;
  if (!STATE.shipClasses.length) html += `<p class="muted">No Ship Classes yet. Add a preset seeded from a Division's book stats, or a blank class to build from scratch.</p>`;
  // Group classes into a collapsible per-Division tree (Flash..Nova order).
  STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
  GDATA.DIVISIONS.forEach(div => {
    const classes = STATE.shipClasses.filter(sc => sc.division === div);
    const collapsed = !!STATE._shipyardDivCollapse[div];
    html += `<div class="divgroup"><div class="divhead" onclick="App.toggleShipyardDiv('${div}')">
      <button class="ghost collapse-btn" tabindex="-1">${collapsed ? "▸" : "▾"}</button>
      <b>${div}</b> <span class="muted">${GDATA.SHIP_CLASSES[div].common} · ${classes.length} ${classes.length === 1 ? "class" : "classes"}</span></div>`;
    if (!collapsed) {
      html += `<div class="divbody">`;
      if (!classes.length) html += `<p class="muted">No ${div} Ship Classes yet.</p>`;
      classes.forEach(sc => { html += renderShipClassCard(sc); });
      html += `</div>`;
    }
    html += `</div>`;
  });
  html += `</section>`;
  return html;
}
function renderShipClassCard(sc) {
    let html = "";
    const collapsed = !!sc._collapsed;
    const divStats = GDATA.SHIP_CLASSES[sc.division];
    const isSpark = sc.division === "Spark";
    const total = shipClassTotalCost(sc);
    const overCap = shipClassOverCap(sc);
    html += `<div class="subcard">
      <div class="row">
        <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.toggleShipClassCollapse('${sc.id}')">${collapsed ? "▸" : "▾"}</button>
        ${sc.icon ? `<img class="iconthumb" src="${esc(shipIconPath(sc.division, sc.icon, GDATA.SHIP_CLASS_ICON_COLOR))}" title="${esc(sc.division)} Icon ${sc.icon}">` : ""}
        <label>Class Name <input class="name-input" value="${esc(sc.name)}" onchange="App.updateShipClassName('${sc.id}',this.value)"></label>
        ${collapsed ? `<span class="tag">${sc.division}</span><span class="tag${overCap ? " danger" : ""}" title="${overCap ? `Over the ${sc.division} Division cap of ${GDATA.DIVISION_CAPS[sc.division].maxPoints}` : ""}">Total Points ${total}</span>` : ""}
        <button class="danger" onclick="App.deleteShipClass('${sc.id}')">Delete</button>
      </div>`;
    if (!collapsed) {
      html += `<div class="row">
        <label>Legal for Division
          <select onchange="App.updateShipClassDivision('${sc.id}',this.value)">
            ${GDATA.DIVISIONS.map(d => `<option value="${d}" ${d === sc.division ? "selected" : ""}>${d}</option>`).join("")}
          </select></label>
        <button class="ghost" title="Reset all stats to the book ${sc.division}-class ship" onclick="App.applyShipClassDefault('${sc.id}')">Default</button>
        <label>Acc <input type="number" style="width:56px" min="0" max="${maxThrustCap(sc.division)}" value="${sc.maxThrust}" onchange="App.updateShipClassMaxThrust('${sc.id}',this.value)"></label>
        <span class="tag">Tier ${divStats.tier}</span>
        <span class="tag">Damper ${divStats.damper}</span>
        <span class="tag">Min Crew ${divStats.crew}</span>
      </div>`;
      if (isSpark) html += `<p class="muted">Spark ships get no Ship AI Score — locked at 0 (Advantage/Disadvantage still applies).</p>`;
      if (sc.division === "Flash") html += `<p class="muted">Flash ships are sub-sonic — Max Thrust is hard-capped at 5-G.</p>`;
      if (GDATA.DIVISION_CAPS[sc.division]) {
        html += `<p class="muted">${sc.division} Division ships are capped at ${GDATA.DIVISION_CAPS[sc.division].maxPoints} total points (a rule, not enforced here — Total Points below turns red if you build over it).</p>`;
      }
      html += `<table class="mktable skilltable">
        <tr><th>Stat</th><th>Score</th><th>Advantage (+) /<br>Disadvantage (−)</th><th>Mk</th><th>Cost</th></tr>
        ${[["Spotter", "sensors", "sensorsAdv"], ["Navigator", "nav", "navAdv"], ["Pilot", "control", "controlAdv"]].map(([label, scoreKey, advKey]) => `
          <tr>
            <td>${label}</td>
            <td><input type="number" style="width:56px" value="${sc.ai[scoreKey]}" ${isSpark ? "disabled title=\"Spark locks Ship AI Score at 0\"" : ""} onchange="App.updateShipClassAI('${sc.id}','${scoreKey}',this.value)"></td>
            <td><input type="number" style="width:56px" value="${sc.ai[advKey]}" onchange="App.updateShipClassAI('${sc.id}','${advKey}',this.value)"></td>
            <td><b>${formatMk(sc.ai[scoreKey], sc.ai[advKey])}</b></td>
            <td>${skillCost(sc.ai[scoreKey], sc.ai[advKey])}</td>
          </tr>`).join("")}
      </table>
      <div class="row">
        <label>Frame Strength
          <select onchange="App.updateShipClassFrame('${sc.id}',this.value)">
            ${GDATA.FRAME_STRENGTH.map(f => `<option value="${f.name}" ${f.name === sc.frame ? "selected" : ""}>${f.name} (${signedCost(frameCost(divStats.tier, f.name))})</option>`).join("")}
          </select></label>
        <label>Armor <input type="number" style="width:56px" min="0" value="${sc.armor}" onchange="App.updateShipClassArmor('${sc.id}',this.value)"></label>
        <label>Compartmentalization
          <select onchange="App.updateShipClassCompartment('${sc.id}',this.value)">
            ${GDATA.COMPARTMENTALIZATION.map(c => `<option value="${c.name}" ${c.name === sc.compartment ? "selected" : ""}>${c.name} (${signedCost(compartmentCost(divStats.tier, c.name))})</option>`).join("")}
          </select></label>
        <span class="tag">HP ${computeHitPoints(divStats.tier, sc.frame)}</span>
        <span class="tag">DR ${computeDamageReduction(sc.armor, sc.compartment)}</span>
      </div>
      <table class="mktable"><tr><td><b>Total Points</b></td><td><b${overCap ? ` class="danger-text"` : ""}>${total}</b></td></tr></table>
      ${renderClassIconPicker(sc)}`;
    }
    html += `</div>`;
    return html;
}

/* ---------- Course ---------- */
function renderCourse() {
  let html = `<div class="grid2">`;
  const trackType = STATE._draftTrackType || "legs";
  html += `<section class="card"><h2>Design a Racecourse</h2>
    <div class="formrow"><label>Race Name</label>
      <input id="cName" value="${esc(STATE._draftCourse?.name || "")}" placeholder="Roll or type a name">
      <button class="ghost" onclick="App.rollDraftName()">🎲</button></div>
    <div class="formrow"><label>Division</label>
      <select id="cDiv" onchange="App.draftDivChanged(this.value)">
        ${GDATA.DIVISIONS.map(d => `<option value="${d}">${d}</option>`).join("")}
      </select></div>
    <div class="formrow"><label>Track</label>
      <select id="cTrackType" onchange="App.setDraftTrackType(this.value)">
        <option value="legs" ${trackType === "legs" ? "selected" : ""}>Straight — Legs</option>
        <option value="circular" ${trackType === "circular" ? "selected" : ""}>Circular — Distance Tracking</option>
      </select></div>
    ${trackType === "circular" ? `
    <p class="muted">Circular Track (see RULE_CHANGES.md): 6 lanes on a real hex grid, each exactly 6 hexes longer per lap than the one inside it (an exact property of hex ring math, not a chosen number). Race runs Leg by Leg until a racer completes the required laps — there's no fixed Leg count.</p>
    <div class="formrow"><label>Inner Lane Hexes (approx.)</label><input id="cInnerHexes" type="number" min="1" value="50" oninput="App.previewLaneHexes(this.value)"></div>
    <div class="formrow"><label>Laps to Finish</label><input id="cLaps" type="number" min="1" value="3"></div>
    <div class="formrow"><label>Apply Leg Modifier To</label>
      <select id="cMode"><option value="tier">Tier (TN = (Tier+Mod)×3)</option><option value="tn">TN (TN = Tier×3 + Mod)</option><option value="none">Ignore modifier</option></select></div>
    <table class="mktable"><tr><th>Lane</th>${Array.from({ length: 6 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
      <tr><td>Hexes/Lap</td>${laneHexesArray({ lanes: 6, innerHexes: 50 }).map((h, i) => `<td id="laneHexCol${i}">${h}</td>`).join("")}</tr></table>
    ` : `
    <div class="formrow"><label>Race Type</label>
      <select id="cType">
        ${GDATA.RACE_TYPES.map(t => `<option value="${t.name}"${t.name === "Medium" ? " selected" : ""}>${t.name} (${t.label})</option>`).join("")}
      </select></div>
    <div class="formrow"><label># Legs</label>
      <input id="cLegs" type="number" min="1" value="4">
      <button class="ghost" onclick="App.rollDraftLegCount()">🎲 by Type</button></div>
    <div class="formrow"><label>Apply Leg Modifier To</label>
      <select id="cMode"><option value="tier">Tier (TN = (Tier+Mod)×3)</option><option value="tn">TN (TN = Tier×3 + Mod)</option><option value="none">Ignore modifier</option></select></div>
    `}
    <button onclick="App.generateCourse()">Generate Racecourse</button>
  </section>`;

  html += `<section class="card"><h2>Saved Racecourses</h2>`;
  if (!STATE.courses.length) html += `<p class="muted">None yet — generate one on the left.</p>`;
  STATE.courses.forEach(c => {
    const circular = c.trackType === "circular";
    const circTag = circular ? `<span class="tag">Circular</span> <span class="tag">${c.lanes} lanes, inner ~${c.innerHexes} hexes</span> <span class="tag">${c.laps} laps</span>` : `${c.type ? `<span class="tag">${esc(c.type)}</span>` : ""} <span class="tag">${c.legs.length} Legs</span>`;
    // Circular Track Legs are rolled fresh live during the race, never stored
    // on the course (see RULE_CHANGES.md) -- there's nothing to preview here.
    const viewLegsBtn = circular ? `<span class="muted">Legs are rolled fresh each race</span>` : `<button class="ghost" onclick="App.toggleCourseView('${c.id}')">${STATE._expanded === c.id ? "Hide" : "View"} Legs</button>`;
    html += `<div class="subcard">
      <div class="row"><b>${esc(c.name)}</b> <span class="tag">${c.division}</span>${circTag}
        ${viewLegsBtn}
        <button class="danger" onclick="App.deleteCourse('${c.id}')">Delete</button></div>`;
    if (!circular && STATE._expanded === c.id) {
      html += `<table class="mktable"><tr><th>Leg</th><th>Tier</th><th>Base TN</th><th>Feature</th><th>Mod</th><th>TN(Tier)</th><th>TN(TN)</th><th>Final TN</th><th></th></tr>`;
      c.legs.forEach((leg, i) => {
        html += `<tr>
          <td>${i + 1}</td><td>${leg.tier}</td><td>${leg.baseTN}</td>
          <td>${esc(leg.feature)} <span class="muted">(d50: ${leg.d50})</span></td>
          <td>${leg.mod >= 0 ? "+" : ""}${leg.mod}</td>
          <td>${leg.tnTierMod}</td><td>${leg.tnTnMod}</td>
          <td><input type="number" style="width:56px" value="${leg.finalTN}" onchange="App.setFinalTN('${c.id}',${i},this.value)"></td>
          <td><button class="ghost" onclick="App.rerollLeg('${c.id}',${i})">🎲</button></td>
        </tr>`;
      });
      html += `</table>`;
    }
    html += `</div>`;
  });
  html += `</section></div>`;
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
  // Distance Tracking has no fixed Leg count (see RULE_CHANGES.md) -- the race
  // runs until someone completes the required laps, so there's no "of N" total.
  const legHeader = course.trackType === "circular" ? `Leg ${race.legIndex + 1}` : `Leg ${race.legIndex + 1} of ${course.legs.length}`;
  // Debug visibility into the Leg TN cap (see RULE_CHANGES.md/legTNCap()):
  // show the pre-cap TN alongside the capped one whenever the cap actually
  // brought it down, so it's obvious when/how often the cap is binding
  // instead of the number just looking "stuck."
  const naturalTN = legNaturalTN(leg);
  const tnTag = naturalTN > leg.finalTN ? ` <span class="tag">capped from ${naturalTN}</span>` : "";
  html += `<section class="card"><h2>${legHeader}</h2>
    <p><b>Tier ${leg.tier}</b> — ${esc(leg.feature)} ${leg.mod !== 0 ? `<span class="tag">Mod ${leg.mod >= 0 ? "+" : ""}${leg.mod}</span>` : ""} — <b>Target Number: ${leg.finalTN}</b>${tnTag}</p>
  </section>`;

  html += renderDeclarations(race); // Phase 0 — all Heroes together
  if (race.legState.declLocked) {
    html += renderPhaseI(race);      // Phase I — all Heroes together
    html += renderPhaseII(race);     // Phase II — all Heroes together
    html += renderPhaseCrew(race, "engineer", "Phase III — Engineer", ["spotter", "navigator", "pilot"], null);
    html += renderPhaseCrew(race, "spotter", "Phase IV — Spotter", ["navigator", "pilot"], null);
    html += renderPhaseCrew(race, "navigator", "Phase V — Navigator", ["pilot"], "pilot");
    html += renderPhaseVI(race);
    html += renderLegClose(race);
  }
  html += renderLog(race);
  return html;
}

function renderRaceSetup() {
  let html = `<section class="card"><h2>Set Up a Race</h2>`;
  if (!STATE.courses.length) { html += `<p class="muted">Create a racecourse first (Racecourse tab).</p></section>`; return html; }
  if (!STATE.ships.length) { html += `<p class="muted">Build at least one ship first (Hangar Bay tab).</p></section>`; return html; }
  // Persist the selected course + ships in STATE so a re-render (e.g. adding an
  // NPC) doesn't wipe the checkbox selections, which are otherwise DOM-only.
  let courseId = STATE._raceSetupCourse;
  if (!courseId || !STATE.courses.some(c => c.id === courseId)) courseId = STATE.courses[0].id;
  const division = getCourse(courseId).division;
  STATE._raceSetupShips = STATE._raceSetupShips || [];
  html += `<div class="formrow"><label>Racecourse</label><select id="raceCourseSel" onchange="App.setRaceSetupCourse(this.value)">
    ${STATE.courses.map(c => `<option value="${c.id}" ${c.id === courseId ? "selected" : ""}>${esc(c.name)} (${c.division}, ${c.trackType === "circular" ? `Circular, ${c.laps} laps` : `${c.legs.length} legs`})</option>`).join("")}
  </select></div>`;
  {
    const selCourse = getCourse(courseId);
    if (selCourse && selCourse.trackType === "circular") {
      html += `<p class="muted">Circular Track — Distance Tracking is in effect (see Instructions). ${selCourse.lanes} lanes, inner lane ~${selCourse.innerHexes} hexes around, ${selCourse.laps} laps to finish. Ships are assigned a starting lane automatically; the Pilot may Slip a lane during the race.</p>`;
    }
  }
  // Only ships of the racecourse's Division are eligible to race it.
  const eligible = STATE.ships.filter(s => (s.cls || "Comet") === division);
  html += `<div class="formrow" style="align-items:flex-start"><label>Ships <span class="muted">(${division} Division only)</span></label><div>
    ${eligible.length ? eligible.map(s => `<label class="chkline"><input type="checkbox" value="${s.id}" ${STATE._raceSetupShips.includes(s.id) ? "checked" : ""} onchange="App.toggleRaceShip('${s.id}',this.checked)"> ${iconThumbImg(s)} ${esc(s.name)} <span class="muted">(${s.cls})</span>${shipCrewComplete(s) ? "" : ` <span class="tag danger" title="${crewLockMessage(s)}">🔒 crew incomplete</span>`}</label>`).join("")
      : `<span class="muted">No ${division} Division ships built yet — build one in the Hangar Bay and set its Division to ${division}.</span>`}
  </div></div>`;
  html += `<div class="formrow"><label>NPC Racers</label><div>
    <input id="npcName" placeholder="NPC name"><button class="ghost" title="Random ship name" onclick="App.rollNpcName()">🎲</button><button class="ghost" onclick="App.addDraftNpc()">+ Add</button>
    <div id="npcList">${(STATE._draftNpcs || []).map((n, i) => `<span class="tag">${esc(n)} <a href="#" onclick="App.removeDraftNpc(${i});return false;">×</a></span>`).join(" ")}</div>
  </div></div>`;
  html += `<button onclick="App.beginRace()">Start Race</button></section>`;
  return html;
}

/* UI only, no mechanics affected (see APP_CHANGES.md): the Standings bar is a
   race-track progress view, not a relative-to-leader bar chart. Each racer starts at the
   left (0%) and their bar's width is their cumulative movement as a percentage
   of the maximum possible movement for the whole race (every Leg's winner gets
   a number of points equal to the participant count, so max = legs * racers).
   Racer order never changes leg to leg -- only how far each bar reaches.
   "Show Entire Race" replays that growth from Leg 1 forward on the same bars
   (see App.playRaceReplay), rather than printing a separate snapshot per Leg. */
/* Hex-grid track geometry (see RULE_CHANGES.md): a real pointy-top axial hex
   grid, replacing the old continuous-Q trapezoid system entirely. Lane N is
   a hex ring at ring-level (innerRing+N) around a shared center -- see
   traceLaneRing() -- with the two straight sides elongated by a fixed
   straightLen so every lane shares the exact same straight length and only
   the curved end-caps grow. Because every lane's ring shares the same
   center and elongation, adjacent rings are ALWAYS perfectly nested by
   construction (standard hex-ring math) -- this is the actual fix for the
   earlier hex attempt's lane-to-lane misalignment: that used continuous,
   independently divided equal-angle curve slices (a shape that can flex to
   fit a circle regardless of neighboring lanes' cell counts), which a true
   regular hexagon can't do -- fixed 60-degree angles/equal sides, no
   flexing. Traces each lane COUNTERCLOCKWISE starting top-right (same
   convention as before): left along the top straight, down the left cap,
   right along the bottom straight, up the right cap, back to start. */
// 6 neighbor directions for pointy-top axial hexes, fixed rotational order.
const HEX_DIRS = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
];
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
  return hexes; // ordered; index = hexPos, today's squarePos
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
// direction of travel, as opposed to a line through its center. Each of the
// 6 HEX_DIRS faces exactly one edge; this pairing is fixed by hexCorners()'s
// own corner angle scheme (60*i-30) and doesn't depend on position.
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
// House rule (see RULE_CHANGES.md): Racing Maneuvers can target a ship
// within MANEUVER_RANGE_HEXES hexes (same lane or a nearby one), wrapping a
// lap in the same lane. A different lane's position is compared via real
// hex distance (cube coordinates) -- exact between any two hexes directly,
// simpler than the old system's same-lane Q-conversion workaround.
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
// Shared geometry for one course's Circular Track drawing -- computed once
// and reused both by the initial full SVG draw and by later incremental
// position updates (replay), so the two never drift out of sync with each
// other. Builds every lane's ordered hex ring, a global (q,r) lookup, and
// per-hex Slip-neighbor tables (which adjacent-lane hexes each hex is
// edge-adjacent to) -- everything movement/Slip/rendering need, computed
// once so nothing downstream needs runtime trig.
// A hex's structural position expressed as (completed legs) + (fraction
// through the current leg) -- used ONLY to sanity-check candidate Slip
// neighbors below, not as a distance metric. Since every leg (straight or
// curve) grows by exactly +1 hex per lane step, this value's expected
// change for "the same real structural position" one lane over is tiny
// (well under 1) everywhere EXCEPT at the ring's own seam (hexPos 0 /
// hexPos total-1), where the closed loop puts a hex from the FAR end of
// the neighboring lane's ring genuinely hex-adjacent too (see
// circTrackGeometry()'s slipNeighbors filter for why that specific
// coincidental adjacency has to be excluded as a Slip target).
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
        // The ring closing back on itself makes a hex right at the START
        // of the walk (hexPos near 0) ALSO true-hex-adjacent to a hex right
        // at the END of the neighboring lane's ring (hexPos near its own
        // total-1) -- real (q,r) adjacency, but not the "same real
        // position one lane over" a Slip is supposed to reach: taking it
        // would let a single lane-change land almost a full lap ahead by
        // pure coordinate-labeling coincidence, not real travel. Structural
        // offset catches this cleanly (a real corner candidate's offset
        // never drifts more than a fraction of 1; this artifact drifts by
        // nearly a full 6-leg lap) without touching the proven geometry.
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
// Used by the Circular Track Slip A/D rule (see RULE_CHANGES.md) to walk
// every hex a Leg's projected movement passes through.
function isHexOnStraight(geom, laneIdx0, hexPos) {
  return geom.laneHexLists[laneIdx0][hexPos].isStraight;
}
// One atomic unit of ordinary forward movement, staying in the same lane --
// used by resolveSlipPath() below. Returns the new position and whether a
// lap was completed by this single hex (a single hex can cross the lap
// boundary at most once).
function stepForward(geom, laneIdx0, hexPos) {
  const circ = geom.laneHexLists[laneIdx0].length;
  const lapGained = hexPos + 1 >= circ ? 1 : 0;
  return { laneIdx0, hexPos: (hexPos + 1) % circ, lapGained };
}
// Real forward advance contributed by ONE atomic step -- what
// resolveSlipPath()'s longest-path DP (below) sums and maximizes to decide
// where to interleave a Slip. Scored as the change in hexLegOffset()
// (completed legs + fraction through the current leg) between the two
// hexes -- the SAME structural measure used to filter slipNeighbors, now
// also used to VALUE them, so a hex-adjacent step is scored by how much
// real ground it actually covers, not by an incidental index number.
//
// (Two earlier versions of this function each got one thing right and one
// thing wrong. The first expressed every hex as a FRACTION of its own
// lane's total hex count (hexPos/laneLen) -- correct proportionality
// between straights and curves, but taking a same-index candidate into a
// longer destination lane makes that fraction slightly SMALLER even
// though nothing regressed, and the modular wraparound needed to handle
// genuine lap completions misread that tiny decrease as "advanced almost
// a full lap" -- a fake-huge score that made the DP pick a stationary
// candidate over a genuinely better one. The second switched to raw
// hex-INDEX delta -- no wraparound trap, and correct on the straights
// (where the two lanes' indices track closely, deltas of 0/1), but wrong
// on the curves: a curve leg's length scales with the lane's own ring
// level directly (not lane-length-plus-a-shared-constant, the way a
// straight does), so the exact same real structural position can be
// several raw index numbers apart between adjacent lanes partway through
// a curve -- scoring that raw gap as real distance produced deeply
// negative totals for any Leg that slipped through a curve, exactly
// backwards from the real Slingshot-style advantage of hugging the inside
// line through a turn. hexLegOffset() stays correctly small (well under 1)
// for any genuine adjacent candidate everywhere on the ring, straight or
// curve, so a plain subtraction -- no modular wraparound needed, since
// circTrackGeometry()'s slipNeighbors filter already excludes the one case
// (the ring's own seam) where two truly hex-adjacent hexes have very
// different offsets -- is the correct, uniform way to score every step.
// Caught via a user-flagged race where a heavy inward Slip through a curve
// landed far short of the demonstrably better "hug the inside line, gain
// ground exiting the curve" path the user had worked out by hand.)
function hexStepAdvance(geom, fromLaneIdx0, fromHexPos, toLaneIdx0, toHexPos) {
  return hexLegOffset(geom.innerRing, geom.straightLen, toLaneIdx0, toHexPos) -
    hexLegOffset(geom.innerRing, geom.straightLen, fromLaneIdx0, fromHexPos);
}
// House rule (see RULE_CHANGES.md): a Slip's hexes are interleaved with
// ordinary forward movement to actually maximize the ship's real progress
// around the track this Leg, rather than assuming "all Slip hexes first"
// is always optimal. Even though every hex is the same real size, WHICH
// hex a "forward" step reaches depends on the current lane/ring, so
// different interleavings of forward-vs-diagonal steps land on genuinely
// different final hexes -- some further along than others -- exactly the
// same class of issue the original square-grid bug had.
//
// This is a longest-path DP, not a greedy one-step lookahead (a single-step
// "whichever is bigger right now" comparison can lock in a choice that
// blocks a much better option two steps later). The state at step i is
// fully described by k = how many of the slipHexes diagonal hops have been
// used so far (the current lane is just originLane + dir*k), so only hexPos
// and the true best cumulative advance (via hexStepAdvance() -- real,
// cross-lane-comparable progress) need tracking per (i, k); keeping
// only the max-advance candidate per (i, k) and discarding the rest is
// lossless (same DP guarantee as the old square-grid version). A hex-ring
// corner can have up to 3 valid diagonal neighbor candidates (see
// circTrackGeometry()'s slipNeighbors) -- the DP tries all of them.
function resolveSlipPath(geom, originLaneIdx0, originHexPos, movement, slipHexes, dir) {
  const maxLaneIdx0 = geom.laneHexLists.length - 1;
  // DP state is keyed by (k, laneIdx0, hexPos) -- diagonal-hops-used PLUS
  // exact physical position -- not just (k) alone. Collapsing on (k) alone
  // is unsound: two different paths can tie in cumulative distance-so-far
  // while sitting on genuinely different hexes, and which one is better
  // depends on the lane you're now in (forward-step Q advance differs per
  // lane) -- discarding the "loser" of such a tie can throw away a state
  // that leads to a strictly better total. Keying by exact position is safe
  // because from an identical physical position, the best possible future
  // is a pure function of that position plus remaining moves/slips,
  // independent of how you got there -- a genuine DP state.
  let states = new Array(slipHexes + 1).fill(null).map(() => new Map());
  states[0].set(originLaneIdx0 + "," + originHexPos, { laneIdx0: originLaneIdx0, hexPos: originHexPos, dist: 0, lapsGained: 0, prev: null, step: null });
  for (let i = 0; i < movement; i++) {
    const next = new Array(slipHexes + 1).fill(null).map(() => new Map());
    for (let k = 0; k <= Math.min(i, slipHexes); k++) {
      states[k].forEach(st => {
        const fwd = stepForward(geom, st.laneIdx0, st.hexPos);
        // Score against the UNWRAPPED hexPos+1, not fwd.hexPos (which wraps
        // to 0 on a lap completion) -- hexLegOffset() treats an input equal
        // to the lane's own total as exactly one full lap (verified: its
        // leg-by-leg walk falls through to base=6), so this scores a
        // lap-completing step correctly without a special case, instead of
        // reading it as a huge regression back to hexPos 0.
        const fwdDist = st.dist + hexStepAdvance(geom, st.laneIdx0, st.hexPos, fwd.laneIdx0, st.hexPos + 1);
        const fwdKey = fwd.laneIdx0 + "," + fwd.hexPos;
        const existingFwd = next[k].get(fwdKey);
        if (!existingFwd || fwdDist > existingFwd.dist) {
          next[k].set(fwdKey, { laneIdx0: fwd.laneIdx0, hexPos: fwd.hexPos, dist: fwdDist, lapsGained: st.lapsGained + fwd.lapGained, prev: st, step: { laneIdx0: fwd.laneIdx0, hexPos: fwd.hexPos, isSlip: false } });
        }
        // Defensive bounds check (see the old system's own equivalent): a
        // live declared Slip is always pre-clamped to available lanes (see
        // lockDeclarations()), but this also reconstructs from RECORDED
        // history, which could in principle be malformed -- this just makes
        // the option unavailable rather than indexing off the end.
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
  // Defensive: states[0] is always reachable (the unconditional forward
  // transition keeps it populated every step), but a requested slipHexes
  // that isn't actually achievable within the lane bounds along the way
  // (malformed/legacy inputs only, never a live declared Slip) leaves
  // states[k] empty for the unreachable k and every k above it. Gracefully
  // degrade to the largest achievable k instead of crashing.
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
// each of its Legs (see App.playRaceReplay(), RULE_CHANGES.md/APP_CHANGES.md)
// -- walking hex by hex instead of one straight-line transition from a Leg's
// start position to its end position, since a straight chord cuts across a
// curve instead of following the track. Returns one array of {lane,hexPos}
// waypoints per Leg, by re-running the exact same deterministic
// resolveSlipPath() finishLeg() used to resolve it -- a perfect, step-for-
// step reconstruction, since the same inputs always produce the same path,
// PROVIDED the algorithm hasn't changed since that Leg was recorded (it has,
// at least once already, mid-development -- see RULE_CHANGES.md's
// longest-path DP entry). If the recomputed path doesn't land exactly on
// the Leg's authoritative recorded position, only the FINAL waypoint is
// snapped to match it -- the replay always ends where the ship actually is,
// even if an older Leg's lead-up animation isn't a perfect re-derivation.
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
// One racer's placement on the track for a given (lane, hexPos) snapshot --
// used for both the initial draw and later incremental transform updates,
// so a replay step only has to change this string, not rebuild any markup.
function circRacerTransform(geom, p, prevRotDeg) {
  const laneIdx0 = Math.min(Math.max((p.lane || 1) - 1, 0), geom.laneHexLists.length - 1);
  const ring = geom.laneHexLists[laneIdx0];
  const hexPos = ((p.hexPos || 0) % ring.length + ring.length) % ring.length;
  const hex = ring[hexPos];
  const { x, y } = hexToPixel(geom, hex.q, hex.r);
  // Icon art faces "up" natively (see .boardicon in style.css) -- facing
  // direction is just the pixel-space delta toward the NEXT hex in this
  // lane's own sequence (no trig needed, the grid is discrete), +90 to turn
  // that into the standard 0deg-is-east convention.
  const next = ring[(hexPos + 1) % ring.length];
  const nextPt = hexToPixel(geom, next.q, next.r);
  let rotDeg = Math.atan2(nextPt.y - y, nextPt.x - x) * 180 / Math.PI + 90;
  // If given the racer's CURRENTLY-displayed rotation (see App.playRaceReplay()),
  // re-express rotDeg as the equivalent (mod 360) angle closest to it, so a
  // CSS transition between them always animates the short way around --
  // e.g. 179 -> 181 instead of the numerically-different but
  // visually-identical 179 -> -179, which would spin the long way through 0.
  if (prevRotDeg != null) rotDeg += Math.round((prevRotDeg - rotDeg) / 360) * 360;
  return { laneIdx0, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rotDeg.toFixed(1)})` };
}
/* Circular Track standings view: a real hex-grid stadium track, one lane per
   Division lane, drawn as true regular hexagons (see circTrackGeometry()/
   traceLaneRing() above) -- every cell the exact same size and shape,
   adjacent lanes always meeting edge-to-edge by construction, no
   boundary-matching math needed at all (the old trapezoid system's
   mergedBoundaryAngles() has no hex equivalent -- it just isn't needed).
   Racer icons snap to the center of whichever hex their position falls in
   (circRacerTransform()). Each racer `<g>` gets a stable id
   (`circracer-<id>`) and a CSS transform transition (see style.css), the
   same way the linear board's icons/bars only actually animate when
   something moves their EXISTING DOM node rather than recreating it -- see
   App.playRaceReplay(), which updates these transforms directly instead of
   regenerating this whole SVG every step. */
function renderCircularTrackSvg(race, course) {
  const geom = circTrackGeometry(course);
  const { vbW, vbH, iconSize } = geom;
  let svg = `<svg viewBox="0 0 ${vbW} ${vbH}" class="circtrack" role="img" aria-label="Circular track standings">`;
  geom.laneHexLists.forEach((ring, lane) => {
    ring.forEach((hex, hexPos) => {
      const { x, y } = hexToPixel(geom, hex.q, hex.r);
      const pts = hexCorners(geom.hexSize * 0.96, x, y).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      // Curve hexes get their own fill (see style.css) so the two curved
      // end-caps read as visually distinct from the straightaways.
      svg += `<polygon class="circcell${hex.isStraight ? "" : " curve"}" id="circcell-${lane}-${hexPos}" points="${pts}"/>`;
    });
  });
  // Starting line: each lane's own mark at its actual staggered starting hex
  // (see laneStartHexPos()/RULE_CHANGES.md), not one straight line across
  // every lane -- outer lanes start further around the first curve, same as
  // a real track's staggered start grid. Drawn as that hex's own FRONT edge
  // (hexFrontEdge()) -- the real spine facing the direction of travel --
  // rather than a line cut through its center.
  geom.laneHexLists.forEach((ring, laneIdx0) => {
    const hexPos = Math.min(laneStartHexPos(laneIdx0), ring.length - 1);
    const hex = ring[hexPos];
    const next = ring[(hexPos + 1) % ring.length];
    const [p1, p2] = hexFrontEdge(geom, hex, next);
    svg += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" class="circfinish"/>`;
  });
  // Icon sized to sit inside a single hex with margin to spare (see
  // circTrackGeometry()'s iconSize). Name/lane/lap are hover-only via
  // <title> -- no permanent on-track labels to collide.
  race.participants.forEach(p => {
    const { laneIdx0, transform } = circRacerTransform(geom, p);
    const icon = p.type === "hero" ? getShip(p.shipId) : p;
    const iconDiv = iconDivisionOf(icon);
    const label = p.type === "hero" ? shipName(p.shipId) : p.name;
    const lapTag = `Lap ${Math.min(p.laps || 0, course.laps)}/${course.laps}`;
    const imgHref = icon && icon.iconColor && icon.iconNumber && iconDiv ? esc(shipIconPath(iconDiv, icon.iconNumber, icon.iconColor)) : "";
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
function renderStandings(race) {
  const course = getCourse(race.courseId);
  const circular = course.trackType === "circular";
  const laneHexes = circular ? laneHexesArray(course) : null;
  const maxPossible = Math.max(1, course.legs.length * race.participants.length);
  const legsCompleted = race.participants.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
  let html = `<section class="card"><div class="row spread"><h3>Standings</h3>
    <div>
      <button id="raceReplayLastLegBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(true)">▶ Show Last Leg</button>
      <button id="raceReplayBtn" class="ghost" ${legsCompleted ? "" : "disabled"} onclick="App.playRaceReplay(false)">▶ Show Entire Race</button>
    </div>
  </div>`;
  if (circular) html += `<div class="circtrack-wrap" id="circtrackWrap">${renderCircularTrackSvg(race, course)}</div>`;
  html += `<div class="board" id="standingsBoard">`;
  race.participants.forEach(p => {
    const icon = p.type === "hero" ? getShip(p.shipId) : p;
    const label = p.type === "hero" ? shipName(p.shipId) : p.name + " (NPC)";
    // Distance Tracking (see RULE_CHANGES.md): progress is toward the fixed
    // finish line (lane 1's own starting line), not raw hexes moved --
    // an outer lane's required MOVEMENT is its own lap distance times laps,
    // minus its starting stagger, since the stagger head start is exactly
    // what lets it reach that same physical line at the same time as lane 1
    // despite a longer lane.
    const req = circular ? Math.max(1, course.laps * laneHexes[p.lane - 1] - (p.startHexPos || 0)) : maxPossible;
    const pct = Math.min(100, Math.round((p.cumulative / req) * 100));
    const iconDiv = iconDivisionOf(icon);
    const iconImg = icon && icon.iconColor && icon.iconNumber && iconDiv
      ? `<img class="boardicon" id="boardicon-${p.id}" src="${esc(shipIconPath(iconDiv, icon.iconNumber, icon.iconColor))}" style="left:${pct}%" title="${esc(iconDiv)} ${esc(icon.iconColor)} ${esc(icon.iconNumber)}">`
      : "";
    const outTag = p.out ? ` <span class="tag danger">${p.type === "hero" ? "OOC" : "out"}</span>` : "";
    const circTag = circular ? ` <span class="tag">Lane ${p.lane}</span> <span class="tag">Lap ${Math.min(p.laps || 0, course.laps)}/${course.laps}</span>${p.initiative != null ? ` <span class="tag">Init ${p.initiative}</span>` : ""}` : "";
    html += `<div class="boardrow"><span class="boardname"><span class="boardname-inner"><span class="thumbslot">${iconThumbImg(icon)}</span><span class="boardlabel">${esc(label)}${outTag}${circTag}</span></span></span>
      <div class="boardtrack">
        <div class="boardtrack-inner">
          <div class="boardbar"><div class="boardfill${p.out ? " dead" : ""}" id="boardfill-${p.id}" style="width:${pct}%"></div></div>
          ${iconImg}
        </div>
      </div>
      <span class="boardpts" id="boardpts-${p.id}">${circular ? pct + "%" : p.cumulative}</span></div>`;
  });
  html += `</div></section>`;
  return html;
}
/* UI only, no mechanics affected (see APP_CHANGES.md): each phase card can be
   collapsed to its header via the button below, purely manually -- it never
   collapses on its own. The "Done" tag is just a status hint. */
function phaseIsComplete(race, key) {
  const heroes = activeHeroes(race);
  const ls = race.legState;
  if (key === "decl") return ls.declLocked;
  if (key === "phaseI" || key === "phaseII") return heroes.every(p => p.out || !!ls.perShip[p.id].resistance);
  return heroes.every(p => { const ps = ls.perShip[p.id]; return p.out || ps.autoLast || !!ps.results[key]; });
}
function renderPhaseCardOpen(race, key, title) {
  const ls = race.legState;
  // Defensive: a race already in progress before phase collapsing shipped has
  // no phaseCollapsed field on its legState -- without this, opening the Race
  // tab on such a race throws and the whole tab silently fails to render.
  ls.phaseCollapsed = ls.phaseCollapsed || {};
  const complete = phaseIsComplete(race, key);
  const collapsed = !!ls.phaseCollapsed[key];
  const header = `<section class="card"><h3>
    <button class="ghost collapse-btn" title="${collapsed ? "Expand" : "Collapse"}" onclick="App.togglePhaseCollapse('${key}')">${collapsed ? "▸" : "▾"}</button>
    ${title}${complete ? ' <span class="tag success">Done</span>' : ""}
  </h3>`;
  return { header, collapsed };
}
function renderFinalStandings(race) {
  const course = getCourse(race.courseId);
  const circular = course.trackType === "circular";
  const sorted = [...race.participants].sort((a, b) => b.cumulative - a.cumulative);
  let html = `<ol class="finallist">`;
  sorted.forEach((p, i) => {
    const label = p.type === "hero" ? shipName(p.shipId) : p.name + " (NPC)";
    const oocTag = p.type === "hero" && p.out ? ` <span class="tag danger">OOC</span>` : "";
    const detail = circular ? `${Math.min(p.laps || 0, course.laps)}/${course.laps} laps, Lane ${p.lane}, ${p.cumulative} hexes` : `${p.cumulative} pts`;
    html += `<li>${i === 0 ? "🏆 " : ""}<b>${esc(label)}</b> — ${detail}${oocTag}</li>`;
  });
  html += `</ol>`;
  return html;
}

// Per-position Maneuver helpers (see RULE_CHANGES.md): each position may run its
// own Maneuver, so summaries sum across positions and list who ran what.
function sumPosObj(o) { return o ? POSITIONS.reduce((a, pos) => a + (o[pos] || 0), 0) : 0; }
function declaredManeuversText(ps) {
  const parts = POSITIONS.filter(pos => ps.maneuvers && ps.maneuvers[pos]).map(pos => `${POS_LABEL[pos]}: ${ps.maneuvers[pos]}`);
  return parts.length ? parts.join(", ") : "—";
}
function renderDeclarations(race) {
  const ls = race.legState;
  const course = getCourse(race.courseId);
  const circular = course.trackType === "circular";
  const { header, collapsed } = renderPhaseCardOpen(race, "decl", "Phase 0: Declare Intentions");
  let html = header;
  if (ls.declLocked) {
    if (!collapsed) {
      html += `<table class="mktable"><tr><th>Racer</th><th>Accel</th><th>Net Leg Acc</th>${circular ? "<th>Lane</th><th>Pilot Total</th>" : ""}<th>Maneuver</th><th>Rec'd D</th><th>Inst'd D</th></tr>`;
      Object.entries(ls.perShip).forEach(([pid, ps]) => {
        const p = race.participants.find(x => x.id === pid);
        if (p.out && p.outLeg !== race.legIndex) return; // wreck stays until the next Leg begins
        const ship = getShip(p.shipId);
        // Pilot Total = Net Leg Acc + a Slip's signed A/D (see pilotExtraNet())
        // -- shown explicitly so two ships with the same Net Leg Acc but only
        // one Slipped don't look identical at a glance (a Slip through a curve
        // changes the Pilot's net; a Slip within a straightaway doesn't, and a
        // Slip never costs Movement Points -- see finishLeg()).
        const slipTag = ps.slip ? ` <span class="tag">Slipped ${ps.slip} ${ps.slipHexes} (${netLabel(ps.slipAdvantage || 0)})</span>` : "";
        const pilotCell = circular ? `<td>${p.lane}${slipTag}</td><td>${netLabel(pilotExtraNet(ps))}</td>` : "";
        html += `<tr><td>${iconThumbImg(ship)} ${esc(ship.name)}</td><td>${ps.accel}-G</td><td>${netLabel(ps.netLegAcc)}</td>${pilotCell}
          <td>${declaredManeuversText(ps)}</td><td>${netLabel(-sumPosObj(ps.maneuverReceivedByPos))}</td><td>${netLabel(-sumPosObj(ps.maneuverInstigatedByPos))}</td></tr>`;
      });
      Object.entries(ls.npcState).forEach(([pid, ns]) => {
        const p = race.participants.find(x => x.id === pid);
        const laneCell = circular ? `<td>${p.lane}</td><td>—</td>` : "";
        html += `<tr><td>${iconThumbImg(p)} ${esc(p.name)} <span class="muted">(NPC)</span></td><td>—</td><td>—</td>${laneCell}<td>—</td><td>${netLabel(-(ns.maneuverReceivedD || 0))}</td><td>—</td></tr>`;
      });
      html += `</table>`;
    }
    html += `</section>`;
    return html;
  }
  const heroes = activeHeroes(race);
  const allDeclared = heroes.every(p => ls.perShip[p.id].declared);
  html += `<p class="muted">Intentions are declared privately, one ship at a time. Once every ship has declared, lock to reveal them all at once.</p>`;
  html += `<table class="mktable"><tr><th>Ship</th><th>Status</th><th></th></tr>`;
  heroes.forEach(p => {
    const ps = ls.perShip[p.id];
    const ship = getShip(p.shipId);
    html += `<tr><td>${iconThumbImg(ship)} ${esc(ship.name)}</td>
      <td>${ps.declared ? '<span class="tag success">Declared</span>' : '<span class="tag">Not yet declared</span>'}</td>
      <td><button class="${ps.declared ? "ghost" : ""}" onclick="App.openDeclModal('${p.id}')">${ps.declared ? "Review / Edit" : "Declare Intentions"}</button></td></tr>`;
  });
  html += `</table>`;
  html += `<button ${allDeclared ? "" : "disabled"} onclick="App.lockDecl()">Lock Declarations (Reveal)</button>`;
  if (!allDeclared) {
    html += ` <span class="muted">Waiting on: ${heroes.filter(p => !ls.perShip[p.id].declared).map(p => esc(shipName(p.shipId))).join(", ")}</span>`;
  }
  html += `</section>`;
  if (STATE._openDeclFor && ls.perShip[STATE._openDeclFor]) html += renderDeclModal(race, STATE._openDeclFor);
  return html;
}

function renderDeclModal(race, pid) {
  const ps = race.legState.perShip[pid];
  const p = race.participants.find(x => x.id === pid);
  const ship = getShip(p.shipId);
  const cls = getShipClass(ship.shipClass);
  const course = getCourse(race.courseId);
  // House rule (see RULE_CHANGES.md): on a Circular Track, a Racing Maneuver
  // can only target a ship within MANEUVER_RANGE_HEXES hexes -- see
  // hexesWithinManeuverRange(). Straight/Legs courses have no hexes, so
  // targeting stays unrestricted there.
  const maneuverGeom = course.trackType === "circular" ? circTrackGeometry(course) : null;
  const others = race.participants.filter(x => x.id !== pid && !x.out && (!maneuverGeom || hexesWithinManeuverRange(maneuverGeom, p, x))); // can't target a ship that's out of the race, or (Circular Track) out of range
  const crewIds = [...new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean))];
  // Circular Track Slip (see RULE_CHANGES.md): a Slip costs no Movement
  // Points, but its magnitude is capped by both how many lanes are
  // physically available in that direction AND the declared Acceleration --
  // a ship can't Slip more hexes than its own declared G rate this Leg.
  // Direction availability (whether "Slip Left"/"Slip Right" even appears)
  // stays lane-only; only the magnitude cap for the chosen direction also
  // considers Accel.
  const slipMaxLeft = p.lane - 1;
  const slipMaxRight = course.lanes - p.lane;
  const slipMax = ps.slip === "left" ? Math.min(slipMaxLeft, ps.accel) : ps.slip === "right" ? Math.min(slipMaxRight, ps.accel) : 0;
  // Current effective Pilot Mk (see APP_CHANGES.md/user request): shown here so
  // the Pilot can see any Disadvantage/Advantage already carried into this Leg
  // (e.g. from a prior Leg's Fumble, or Crowded Field from how the last Leg
  // ended) BEFORE deciding what Acceleration to declare. Resistance/grants/
  // Maneuvers-received aren't rolled/chosen yet at Declare time, and
  // netLegAcc/slipAdvantage aren't computed until lockDeclarations() (they
  // depend on the Accel/Slip being chosen in this very modal), so only
  // carried Conditions plus the already-known crowdedFieldD go in here.
  const disp = computeShipDisplay(ship);
  const pilotNet = netForPosition(ps, disp, "pilot", ps.crowdedFieldD || 0);
  return `<div class="modal-overlay" onclick="if(event.target===this) App.closeDeclModal()">
    <div class="modal-box">
      <div class="row spread"><h3>${iconThumbImg(ship)} ${esc(ship.name)} — Declare Intentions</h3><button class="ghost" onclick="App.closeDeclModal()">✕</button></div>
      <p class="muted">Only this ship's crew should be looking right now.</p>
      <table class="mktable"><tr><th>Crewman</th><th>Positions</th><th>Resistance Skill Mk</th><th>Current Leg Pilot Mk</th></tr>
        ${crewIds.map(cid => {
          const crewman = getCrew(cid);
          const heldPositions = POSITIONS.filter(pos => ship.assignments[pos] === cid);
          return `<tr><td>${esc(crewman.name)}</td><td>${heldPositions.map(x => POS_LABEL[x]).join(", ")}</td><td>${formatMk(crewman.skills.resistance.score, crewman.skills.resistance.adv)}</td><td>${heldPositions.includes("pilot") ? formatMk(disp.pilot.finalScore, pilotNet) : "—"}</td></tr>`;
        }).join("")}
      </table>
      <div class="formrow"><label>Acceleration (G)</label>
        <input type="number" min="1" max="${effectiveMaxThrust(p, cls)}" value="${ps.accel}" onchange="App.setDecl('${pid}','accel',this.value)">
        <span class="muted">/ ${effectiveMaxThrust(p, cls)}-G max${effectiveMaxThrust(p, cls) < cls.maxThrust ? " (reduced by Fumble)" : ""}</span></div>
      ${course.trackType === "circular" ? `<div class="formrow"><label>Slip (currently Lane ${p.lane})</label>
        <select onchange="App.setDecl('${pid}','slip',this.value)">
          <option value="" ${!ps.slip ? "selected" : ""}>No change</option>
          ${slipMaxLeft > 0 ? `<option value="left" ${ps.slip === "left" ? "selected" : ""}>Slip Left (inward)</option>` : ""}
          ${slipMaxRight > 0 ? `<option value="right" ${ps.slip === "right" ? "selected" : ""}>Slip Right (outward)</option>` : ""}
        </select>
        ${ps.slip ? ` <input type="number" min="1" max="${Math.max(1, slipMax)}" value="${Math.min(Math.max(1, ps.slipHexes || 1), Math.max(1, slipMax))}" onchange="App.setDecl('${pid}','slipHexes',this.value)" style="width:56px"> hex(es) / ${slipMax} max` : ""}
      </div>
      <p class="muted" style="margin:-4px 0 10px">Your Slip hexes are worked in with your ordinary movement wherever it covers the most real ground for the Leg, not always first or last. Touching a curve anywhere along the way grants +1 Advantage per hex outward or -1 Disadvantage per hex inward.</p>` : ""}
      <div class="formrow" style="align-items:flex-start"><label>Racing Maneuvers</label><div style="flex:1;min-width:0">
        <p class="muted" style="margin:0 0 8px">Each position may run one Maneuver against the <b>same position</b> on chosen ships.</p>
        ${POSITIONS.map(pos => {
          const mvName = (ps.maneuvers && ps.maneuvers[pos]) || "";
          const posMvs = GDATA.MANEUVERS.filter(m => (m.position || "pilot") === pos);
          const tgts = (ps.maneuverTargets && ps.maneuverTargets[pos]) || [];
          return `<div class="manrow">
            <div class="manhead"><span class="manpos">${POS_LABEL[pos]}</span>
              <select class="monoselect" onchange="App.setPosManeuver('${pid}','${pos}',this.value)">
                <option value="">none</option>
                ${posMvs.map(m => `<option value="${m.name}" ${mvName === m.name ? "selected" : ""}>${padNbsp(m.name, 14)}${padNbsp(m.disadv === "Tier" ? "Tier" : m.disadv + "D", 6)}${m.desc}</option>`).join("")}
              </select>
            </div>
            ${mvName ? `<div class="mantargets">
              ${others.length ? `<div class="row" style="margin:4px 0 4px"><span class="muted">Targets:</span> <button class="ghost" onclick="App.togglePosAllTargets('${pid}','${pos}')">${others.every(o => tgts.includes(o.id)) ? "Clear All" : "Select All"}</button></div>
              <div class="chkgrid">${others.map(o => `<label class="chkline"><input type="checkbox" ${tgts.includes(o.id) ? "checked" : ""} onchange="App.togglePosTarget('${pid}','${pos}','${o.id}',this.checked)"> ${esc(participantLabel(o))}</label>`).join("")}</div>`
                : `<span class="muted">no other racers to target</span>`}
            </div>` : ""}
          </div>`;
        }).join("")}
      </div></div>
      <button onclick="App.confirmDecl('${pid}')">I'm Done — Confirm Declaration</button>
    </div>
  </div>`;
}

function renderPhaseI(race) {
  const { header, collapsed } = renderPhaseCardOpen(race, "phaseI", "Phase I — Crew Task Check Modifications");
  let html = header;
  if (!collapsed) {
    activeHeroes(race).forEach(p => {
      const ship = getShip(p.shipId);
      const cls = getShipClass(ship.shipClass);
      const ps = race.legState.perShip[p.id];
      html += `<div class="subcard"><div class="row">${iconThumbImg(ship)} <b>${esc(ship.name)}</b>${shipStatusTags(p, cls)}`;
      if (ps.autoLast) html += ` <span class="tag danger">OUT THIS LEG</span>`;
      html += `</div>`;
      if (!p.out) {
        // Per-crewman conditions (like Resistance): checking one applies −1
        // Disadvantage to every position that crewman holds this Leg.
        const crewIds = [...new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean))];
        // Conditions lock explicitly (button) or automatically once Resistance is
        // rolled -- either way they're fixed for the rest of the Leg.
        const locked = !!ps.condLocked || !!ps.resistance;
        const lockReason = ps.resistance ? " (Resistance already rolled.)" : "";
        html += `<p class="muted" style="margin:4px 0">Check a condition to apply −1 Disadvantage to that crewman's position(s) this Leg.${locked ? ` <b>Locked for this Leg.</b>${lockReason}` : ""}</p>`;
        html += `<table class="mktable"><tr><th>Crewman</th><th>Positions</th><th>Conditions</th></tr>`;
        crewIds.forEach(cid => {
          const crewman = getCrew(cid);
          const heldPositions = POSITIONS.filter(pos => ship.assignments[pos] === cid);
          const flags = (ps._condFlags && ps._condFlags[cid]) || {};
          html += `<tr><td>${esc(crewman ? crewman.name : "?")}</td><td>${heldPositions.map(x => POS_LABEL[x]).join(", ")}</td>
            <td><div class="condgrid">${GDATA.CONDITIONS.map((c, ci) => `<label class="chkline"><input type="checkbox" ${flags[c.name] ? "checked" : ""} ${locked ? "disabled" : ""} onchange="App.toggleCond('${p.id}','${cid}',${ci},this.checked)"> ${esc(c.name)}</label>`).join("")}</div></td></tr>`;
        });
        html += `</table>`;
        if (!locked) html += `<button onclick="App.lockConditions('${p.id}')">Lock Conditions for this Leg</button>`;
        else html += `<span class="tag">🔒 Conditions locked</span>`;
      }
      html += `</div>`;
    });
  }
  html += `</section>`;
  return html;
}

/* Itemized A/D line for a Resistance check (mirrors legAdSourcesHtml): the
   crewman's Resistance Advantage/Disadvantage plus −1 per Phase I condition. */
function resistanceAdSourcesHtml(resAdv, condCount, net) {
  const items = [];
  if (resAdv) items.push(`Crew skill ${netLabel(resAdv)}`);
  if (condCount) items.push(`Conditions ${netLabel(-condCount)}`);
  return `<p class="mkline"><span class="muted">Leg Advantages/Disadvantages:</span> ${items.length ? items.join(" · ") : "none this Leg"} &nbsp; → net <b>${netLabel(net)}</b></p>`;
}
function renderPhaseII(race) {
  const { header, collapsed } = renderPhaseCardOpen(race, "phaseII", "Phase II — Resist Uncompensated G-Forces");
  let html = header;
  if (!collapsed) {
    activeHeroes(race).forEach(p => {
      const ship = getShip(p.shipId);
      const cls = getShipClass(ship.shipClass);
      const ps = race.legState.perShip[p.id];
      const uncompensated = Math.max(0, ps.accel - cls.damper);
      const tn = uncompensated * 3;
      html += `<div class="subcard"><div class="row">${iconThumbImg(ship)} <b>${esc(ship.name)}</b>${shipStatusTags(p, cls)} <span class="muted">TN ${tn}</span> ${ps.autoLast ? '<span class="tag danger">OUT THIS LEG</span>' : ""}</div>`;
      if (!p.out) {
        const crewIds = [...new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean))];
        crewIds.forEach(cid => {
          const crewman = getCrew(cid);
          if (!crewman) return;
          const heldPositions = POSITIONS.filter(pos => ship.assignments[pos] === cid);
          const resScore = crewman.skills.resistance.score;
          const resAdv = crewman.skills.resistance.adv || 0;
          const condFlags = (ps._condFlags && ps._condFlags[cid]) || {};
          const condCount = Object.values(condFlags).filter(Boolean).length;
          const net = resAdv - condCount;
          const posLabel = heldPositions.map(x => POS_LABEL[x]).join(", ");
          html += `<div class="resistrow">`;
          // Same header shape as the other phase cards' roll blocks.
          html += `<p class="mkline"><b>${posLabel}:</b> ${esc(crewman.name)} &nbsp; Ship Skill Mk: <b>${formatMk(resScore, resAdv)}</b> &nbsp; Leg Ship Skill Mk: <b>${formatMk(resScore, net)}</b> &nbsp; <span class="muted">vs TN ${tn}</span></p>`;
          html += resistanceAdSourcesHtml(resAdv, condCount, net);
          const r = ps.resistance && ps.resistance[cid];
          if (r) {
            if (r.skipped) {
              html += `<p class="muted">No strain (TN ${r.tn}).</p>`;
            } else if (r.dice) {
              const outcome = r.fumble ? "FUMBLE — passed out!" : (r.pass ? "Success" : "Failed (−1 D)");
              html += `<p>Rolled ${r.dice.join(", ")} → chosen ${r.chosen} + ${r.score} = <b>${r.total}</b> vs TN ${r.tn} → <b>${outcome}</b></p>`;
            } else {
              const outcome = r.fumble ? "FUMBLE — passed out!" : (r.pass ? "Success" : "Failed (−1 D)");
              html += `<p><b>${outcome}</b>${r.total != null ? ` (${r.total} vs ${r.tn})` : ""}</p>`;
            }
          }
          html += `</div>`;
        });
        if (!ps.resistance) html += `<button onclick="App.doResistance('${p.id}')">Roll Resistance</button>`;
      }
      html += `</div>`;
    });
  }
  html += `</section>`;
  return html;
}

/* Compact human-readable summary of a fumble's applied affects (used in the roll block). */
function describeFumbleAffects(affects, cls) {
  if (!affects || !affects.length) return "No lasting mechanical effect.";
  return affects.map(a => {
    if (a.type === "disadvantage") {
      return `${POS_LABEL[a.position] || a.position} −${a.levels} Level${a.levels > 1 ? "s" : ""} of Disadvantage for ${a.legs} Leg${a.legs > 1 ? "s" : ""}`;
    }
    if (a.type === "hp") {
      const dmg = Math.max(0, (cls.tier * a.tierMult) - (cls.dr || 0));
      return `${dmg} HP damage (Tier ${cls.tier} × ${a.tierMult}${cls.dr ? `, − DR ${cls.dr}` : ""})`;
    }
    if (a.type === "accel") {
      return a.mode === "set"
        ? `Acceleration reduced to ${a.value}-G (rest of race)`
        : `−${a.value} to max Acceleration (rest of race)`;
    }
    if (a.type === "last") {
      return `forced to finish last for ${a.legs} Leg${a.legs > 1 ? "s" : ""}`;
    }
    return "";
  }).filter(Boolean).join("; ");
}

/* Compact per-ship status line shown in every Phase Card header: HP, DESTROYED,
   Acceleration cap, forced-last, and any active multi-Leg fumble penalties. */
function shipStatusTags(participant, cls) {
  if (!participant || participant.type !== "hero") return "";
  const maxHp = participant.maxHp != null ? participant.maxHp : (cls ? cls.hp : 0);
  const hp = participant.hp != null ? participant.hp : maxHp;
  let tags = "";
  const hpDanger = participant.out || hp < maxHp / 2; // red only below half total HP
  tags += ` <span class="tag${hpDanger ? " danger" : ""}">HP ${hp}/${maxHp}</span>`;
  if (participant.out) tags += ` <span class="tag danger">OOC — out of race</span>`;
  if (cls) {
    const effMax = effectiveMaxThrust(participant, cls);
    if (effMax < cls.maxThrust) tags += ` <span class="tag danger">Max ${effMax}-G</span>`;
  }
  if ((participant.forcedLastLegs || 0) > 0) {
    tags += ` <span class="tag danger">Forced last (${participant.forcedLastLegs} Leg${participant.forcedLastLegs > 1 ? "s" : ""})</span>`;
  }
  const legIndex = STATE.race ? STATE.race.legIndex : 0;
  (participant.penalties || []).forEach(pen => {
    const left = penaltyLegsLeft(pen, legIndex);
    if (left <= 0) return; // window already past
    const active = legIndex >= pen.startLeg; // in effect this Leg vs. starting next Leg
    const when = active ? `${left} Leg${left > 1 ? "s" : ""} left` : `next ${left} Leg${left > 1 ? "s" : ""}`;
    // Show the Advantage/Disadvantage letter (A/D), e.g. "Spotter −2D".
    const sign = pen.amount < 0 ? "−" : "+";
    const ad = pen.amount < 0 ? "D" : "A";
    tags += ` <span class="tag danger">${POS_LABEL[pen.position] || pen.position} ${sign}${Math.abs(pen.amount)}${ad} (${when})</span>`;
  });
  return tags;
}

/* Itemized list of every Advantage/Disadvantage in effect on this position THIS
   Leg (see RULE_CHANGES.md / user request) -- crew skill, Ship AI, carried Fumble
   Disadvantage + manual Conditions, Resistance, grants, Racing Maneuvers
   (received + this position's own self-cost), and (Pilot only) Acceleration and
   a Circular Track Slip -- ending in the net used on the dice pool. Only
   nonzero sources are listed; net matches netForPosition(). */
function legAdSourcesHtml(ps, disp, phase) {
  const d = disp[phase];
  const items = [];
  const add = (label, n) => { if (n) items.push(`${label} ${netLabel(n)}`); };
  add("Crew skill", d.crewAdv);
  add("Ship AI", d.shipAIAdv);
  add("Conditions", ps.conditions[phase]);      // carried Fumble Disadvantage + manual Condition toggles
  add("Resistance", ps.resistanceDelta[phase]);
  add("Grant", ps.grants[phase]);
  add("Maneuver", -((ps.maneuverReceivedByPos && ps.maneuverReceivedByPos[phase]) || 0));
  add("Maneuver used", -((ps.maneuverInstigatedByPos && ps.maneuverInstigatedByPos[phase]) || 0));
  if (phase === "pilot") {
    add("Acceleration", ps.netLegAcc || 0);
    add("Slip", ps.slipAdvantage || 0);
    add("Crowded Field", ps.crowdedFieldD || 0);
  }
  const extra = phase === "pilot" ? pilotExtraNet(ps) : 0;
  const net = netForPosition(ps, disp, phase, extra);
  const list = items.length ? items.join(" · ") : "none this Leg";
  return `<p class="mkline"><span class="muted">Leg Advantages/Disadvantages:</span> ${list} &nbsp; → net <b>${netLabel(net)}</b></p>`;
}
/* Shared by Phases III-VI: shows this position's Ship Skill Mk / Leg Ship Skill Mk
   right where the roll happens, then the roll button/result and phase-specific follow-up. */
function renderPhaseRollBlock(pid, ps, disp, tn, phase, grantTargets, forcedTarget, circular) {
  const res = ps.results[phase];
  const extra = phase === "pilot" ? pilotExtraNet(ps) : 0;
  const net = netForPosition(ps, disp, phase, extra);
  const sb = phase === "pilot" ? speedBonus(ps.accel) : 0;
  let html = `<p class="mkline"><b>${POS_LABEL[phase]}:</b> ${esc(disp[phase].crewName)} &nbsp; Ship Skill Mk: <b>${disp[phase].mk}</b> &nbsp; Leg Ship Skill Mk: <b>${formatMk(disp[phase].finalScore, net)}</b>`;
  if (sb) html += ` &nbsp; <span class="muted">+${sb} Speed Bonus @ ${ps.accel}-G — applied only afterward, to see who wins the Leg</span>`;
  html += ` &nbsp; <span class="muted">vs TN ${tn}</span></p>`;
  html += legAdSourcesHtml(ps, disp, phase);
  if (!res) {
    if (phase !== "pilot" && !forcedTarget) {
      // House rule (see RULE_CHANGES.md): Engineer/Spotter must specify who
      // receives their grant BEFORE rolling -- Roll/Play It Safe are withheld
      // until a target is chosen. A Critical Success/Fumble still offers its
      // own choice afterward, overriding whatever was picked here.
      const chosen = ps.grantChoice[phase];
      html += `<div class="row"><label>Grant to (choose before rolling):
        <select onchange="App.setGrantChoice('${pid}','${phase}',this.value)">
          <option value="">-- choose --</option>
          ${grantTargets.map(t => `<option value="${t}" ${chosen === t ? "selected" : ""}>${POS_LABEL[t]}</option>`).join("")}
        </select></label></div>`;
      if (!chosen) {
        html += `<p class="muted">Choose who receives ${POS_LABEL[phase]}'s grant before rolling.</p>`;
        return html;
      }
    }
    html += `<button onclick="App.doPhase('${pid}','${phase}')">Roll ${POS_LABEL[phase]}</button>`;
    if (phase !== "pilot") html += ` <button class="ghost" onclick="App.doSkipPhase('${pid}','${phase}')">Play It Safe (counts as Failure)</button>`;
    return html;
  }
  const rc = res.rc;
  if (res.skipped) {
    html += `<p><b>Played It Safe</b> — counts as a Failure.</p>`;
  } else {
    html += `<p>Rolled ${rc.dice.join(", ")} → chosen ${rc.chosen} + ${disp[phase].finalScore} = <b>${rc.total}</b> vs TN ${tn} → <b>${outcomeLabel(rc)}</b></p>`;
  }
  if (phase === "pilot" && res) {
    // House rule (see RULE_CHANGES.md): the Leg Ranking Score is Speed Bonus
    // alone, +/- Crit/Fumble -- the TN roll above (d20 + Pilot Leg Skill
    // Score) never contributes to it. Distinct from the Base Leg Result
    // (see computeBaseLegResult()), which is Speed-Bonus-only.
    let parts = `Speed Bonus ${sb}`;
    if (res.critBonus) parts += ` + Crit Bonus ${res.critBonus} (${res.critBonus} Critical Success${res.critBonus > 1 ? "es" : ""})`;
    if (res.fumblePenalty) parts += ` − Fumble Penalty ${res.fumblePenalty} (${res.fumblePenalty} Fumble${res.fumblePenalty > 1 ? "s" : ""})`;
    let rankTotalDisp = `${res.rankTotal}`;
    let previewMovement = Math.max(0, res.rankTotal);
    if (circular && !rc.success) {
      previewMovement = Math.ceil(previewMovement / 2);
      rankTotalDisp += ` ÷2 (${rc.isFumble ? "Fumble" : "Failed"}, rounded up) = ${previewMovement}`;
    }
    if (circular && ps.slipAdvantage < 0) {
      const slingshotHexes = Math.min(ps.slipHexes || 0, previewMovement);
      if (slingshotHexes > 0) {
        previewMovement += slingshotHexes;
        rankTotalDisp += ` + Slingshot ${slingshotHexes} (${slingshotHexes} hex${slingshotHexes > 1 ? "es" : ""} Slipped inward through the curve) = ${previewMovement}`;
      }
    }
    // The "who won the Leg" framing is Straight -- Legs-specific (points-based
    // standings); on a Circular Track this SAME score becomes movement in
    // hexes (see finishLeg()), not a Leg win/loss, so the caveat doesn't apply.
    const rankingNote = circular ? "" : " (used only to determine who won the Leg — the d20 roll and Skill Score above do not count toward it)";
    html += `<p class="muted">Leg Ranking Score: ${parts} = <b>${rankTotalDisp}</b>${rankingNote}</p>`;
  }
  if (phase !== "pilot") {
    // House rule (see RULE_CHANGES.md): the grant target (and, on a Crit/Fumble,
    // therefore the amount too) was already locked in before rolling -- rollPhase()/
    // skipPhase() apply it automatically the moment the result exists, no manual
    // step. This is just a defensive self-heal for a result saved before that
    // existed (an in-progress race from an older version of the app).
    if (!res.applied) autoApplyGrant(pid, phase);
    html += `<p class="muted">Applied ${netLabel(res.applied.amount)} to ${POS_LABEL[res.applied.targetPos]}.</p>`;
  } else if (rc.isFumble) {
    if (!ps.fumbleText) {
      html += `<button class="ghost" onclick="App.rollFumble('${pid}')">Roll on Fumble Chart</button>`;
    } else {
      const participant = STATE.race.participants.find(p => p.id === pid);
      const ship = getShip(participant.shipId);
      const cls = getShipClass(ship.shipClass);
      html += `<p class="fumbletext">${esc(ps.fumbleText)}</p>`;
      html += `<p class="muted">Applied: ${describeFumbleAffects(ps.fumbleApplied, cls)}</p>`;
    }
  }
  return html;
}

function renderPhaseCrew(race, phase, title, grantTargets, forcedTarget) {
  const prereqPhase = phase === "engineer" ? null : phase === "spotter" ? "engineer" : "spotter";
  const prereqLabel = prereqPhase === "engineer" ? "Phase III (Engineer)" : "Phase IV (Spotter)";
  const { header, collapsed } = renderPhaseCardOpen(race, phase, title);
  let html = header;
  if (!collapsed) {
    activeHeroes(race).forEach(p => {
      const ship = getShip(p.shipId);
      const cls = getShipClass(ship.shipClass);
      const ps = race.legState.perShip[p.id];
      html += `<div class="subcard"><div class="row">${iconThumbImg(ship)} <b>${esc(ship.name)}</b>${shipStatusTags(p, cls)}</div>`;
      if (p.out) {
        // Destroyed this Leg -- shown with its DESTROYED status, no more phases.
      } else if (ps.autoLast) {
        html += `<span class="tag danger">OUT THIS LEG</span>`;
      } else if (!ps.resistance) {
        html += `<span class="muted">Waiting on Phase II (Resistance).</span>`;
      } else if (prereqPhase && !ps.results[prereqPhase]) {
        html += `<span class="muted">Waiting on ${prereqLabel}.</span>`;
      } else {
        const disp = computeShipDisplay(ship);
        const tn = race.legState.leg.finalTN;
        html += renderPhaseRollBlock(p.id, ps, disp, tn, phase, grantTargets, forcedTarget, getCourse(race.courseId).trackType === "circular");
      }
      html += `</div>`;
    });
  }
  html += `</section>`;
  return html;
}

function renderPhaseVI(race) {
  const { header, collapsed } = renderPhaseCardOpen(race, "pilot", "Phase VI — Pilot");
  let html = header;
  if (!collapsed) {
    activeHeroes(race).forEach(p => {
      const ship = getShip(p.shipId);
      const cls = getShipClass(ship.shipClass);
      const ps = race.legState.perShip[p.id];
      html += `<div class="subcard"><div class="row">${iconThumbImg(ship)} <b>${esc(ship.name)}</b>${shipStatusTags(p, cls)}</div>`;
      if (p.out) {
        // Destroyed this Leg -- shown with its DESTROYED status, no more phases.
      } else if (ps.autoLast) {
        html += `<span class="tag danger">OUT THIS LEG</span>`;
      } else if (!ps.results.navigator) {
        html += `<span class="muted">Waiting on Phase V (Navigator).</span>`;
      } else {
        const disp = computeShipDisplay(ship);
        const tn = race.legState.leg.finalTN;
        html += renderPhaseRollBlock(p.id, ps, disp, tn, "pilot", [], null, getCourse(race.courseId).trackType === "circular");
      }
      html += `</div>`;
    });
  }
  html += `</section>`;
  return html;
}

function renderLegClose(race) {
  const ls = race.legState;
  const allPilotDone = activeHeroes(race).every(p => { const ps = ls.perShip[p.id]; return p.out || ps.autoLast || ps.results.pilot; });
  let html = `<section class="card"><h3>Phases VII–IX — Resolve the Leg</h3>`;
  if (!allPilotDone) { html += `<p class="muted">Waiting for all ships to complete Phase VI (Pilot).</p></section>`; return html; }
  if (ls.baseLegResult === null) {
    html += `<button onclick="App.doBaseResult()">Compute Base Leg Result</button></section>`;
    return html;
  }
  html += `<p>Base Leg Result: <b>${ls.baseLegResult}</b></p>`;
  const npcs = race.participants.filter(p => p.type === "npc" && !p.out); // removed NPCs no longer roll
  if (npcs.length) {
    html += `<table class="mktable"><tr><th>NPC</th><th>Roll</th><th>Result</th></tr>`;
    npcs.forEach(n => {
      const r = ls.npcResults[n.id];
      const advNote = r && r.net ? ` <span class="tag ${r.net < 0 ? "danger" : ""}">${r.net < 0 ? Math.abs(r.net) + " Disadvantage" : r.net + " Advantage"} (maneuver)</span>` : "";
      const rollTxt = r ? `[${r.dice.join(", ")}] → kept ${r.chosen} → ${r.name} (${r.mod >= 0 ? "+" : ""}${r.mod})${advNote}` : `<button onclick="App.doNpc('${n.id}')">Roll</button>`;
      html += `<tr><td>${esc(n.name)}</td><td>${rollTxt}</td><td>${r ? r.total : ""}</td></tr>`;
    });
    html += `</table>`;
  }
  const npcsDone = npcs.every(n => ls.npcResults[n.id]);
  if (npcsDone) html += `<button onclick="App.doFinishLeg()">Finish Leg &amp; Update Board</button>`;
  html += `</section>`;
  return html;
}

function renderLog(race) {
  if (!race.log.length) return "";
  let html = `<section class="card"><details><summary>Race Log</summary>`;
  [...race.log].reverse().forEach(entry => {
    html += `<h4>Leg ${entry.legIndex + 1}</h4><table class="mktable"><tr><th>Pos</th><th>Racer</th><th>Result</th><th>Movement</th></tr>`;
    entry.rows.forEach(r => {
      html += `<tr><td>${r.position}</td><td>${esc(r.name)}${r.type === "npc" ? ` <span class="tag">NPC</span>` : ""}</td><td>${r.out ? "OOC" : (r.autoLast ? "OUT" : r.total)}</td><td>+${r.movement}</td></tr>`;
    });
    html += `</table>`;
    if (entry.fumbles && entry.fumbles.length) {
      html += `<div class="logfumbles"><b>Fumbles this Leg:</b>`;
      entry.fumbles.forEach(f => {
        html += `<p class="fumbletext"><b>${esc(f.name)}:</b> ${esc(f.text)}</p>`;
      });
      html += `</div>`;
    }
  });
  html += `</details></section>`;
  return html;
}

/* ---------- Introduction ---------- */
function renderIntroduction() {
  return `<section class="card">
    <p class="flavortext">Engines screaming at the edge of failure. Pilots threading impossibly narrow corridors of space. Crews gambling everything on a single, perfect run.</p>
    <p class="flavortext">Welcome to GASCAR.</p>
    <p>This volume pulls back the curtain on the most dangerous sport in civilized space, where sublight racers tear through asteroid belts, skim planetary atmospheres, and chase victory across entire star systems under the unforgiving laws of physics and competition.</p>
    <p>Inside, you'll find the full machinery of GASCAR: the history and racing divisions, the crews who make the impossible routine, and the ships that redefine what "safe operating limits" mean. From razor-edged Spark-class Skiffs to system-spanning Nova-class Clippers, and the brutal, ground-hugging Flash-class Skimmers that started it all, every class is built to win or break trying.</p>
    <p>Meet five distinct race crew specialists built on the new Archetype Racer Crewman, each with the skills, instincts, and nerve required to survive high-G burns and split-second decisions. Explore a lineup of cutting-edge racing machines, each tuned for a different philosophy of speed, precision, endurance, aggression, or raw power.</p>
    <p>But racing is more than machines and men. Sponsors pull strings, bend rules, and sometimes break them outright. Circuits span worlds, each racecourse a carefully engineered gauntlet of hazards, strategy, and spectacle. And behind it all lies a complete system for designing abstract racecourses and running high-stakes competitions where every Leg counts and every mistake can be final.</p>
    <p>And, of course, no Warp Space product would be complete without Plot Hooks… nearly 30 of them here.</p>
    <p>Whether you're building a team, running a race, or simply trying to keep your ship from tearing itself apart at 18-G, this book gives you everything you need.</p>
    <p class="flavortext">Strap in.</p>
    <p class="flavortext">The corridor is narrow. The engines are hot.</p>
    <p class="flavortext">And for a few fleeting moments… you may just be the fastest thing in the system.</p>

    <h3>GASCAR Divisions, Circuits, and Races</h3>
    <p>The Galactic Association for Spaceship Competitive Astro-Racing, known as GASCAR, is the primary regulatory and promotional authority for organized spaceship racing across the Federation. Founded several centuries after the expansion of reliable sublight travel pre-A.C., the organization arose from a loose collection of engineering clubs, courier guilds, and thrill-seeking pilots who began staging informal velocity competitions between planets, moons, and orbital stations. As both the technology, the crowds, and the explosions grew larger, the need for standardized safety rules, race corridors, and ship classifications eventually gave rise to GASCAR.</p>
    <p class="introcaption muted">GASCAR followed mankind into the Eos Galaxy</p>
    <p>Unlike military flight demonstrations or commercial courier trials, GASCAR races are conducted entirely under sublight propulsion and take place within the bounds of a single star system. Racecourses typically weave through complex gravitational environments-skimming planetary magnetospheres, threading asteroid belts, and diving through tightly controlled orbital corridors. The result is a form of competition that rewards not only raw acceleration, but also precise navigation, sensor awareness, and exceptional piloting skill.</p>
    <p>At the top of GASCAR's organizational structure are the Divisions. Each Division defines a set of performance parameters that every competing ship must meet. Within each Division, GASCAR sanctions numerous race Circuits, each consisting of a season of multiple races spread across Imperial space. Every Circuit season culminates in the Division Championship, a premier event hosted each year by a different star system.</p>
    <p>Because the width and breath of the Imperium is so large, circuits tend to follow a circular route around or through a sector or two. They may have a race in one system, and a week later, they are 20 lightyears away, racing again in another system.</p>
    <p>Spark and Comet Division races are often described as frantic and technical, with small craft darting through obstacles at extreme speeds. Races last less than 12 hours, through some may take place over multiple days where each Leg can last up to 12 hours. Spark and Comet seasons typically last one year</p>
    <p>Meteor Division races emphasize sustained acceleration and tactical course management lasting long enough to stretch the limits of the class's 100-day operating duration, though most last less than 30 days. A Meteor season typically lasts two years.</p>
    <p>Nova Division races emphasize bursts of high acceleration and strategic course management lasting long enough to stretch the limits of the class's 200-day operating duration. Nova Division racers compete in longer endurance events where precision, thermal management, and engine discipline become decisive factors. Races average 150 days. A Nova season typically spans five years.</p>

    <h3>Licensing and Public Perception</h3>
    <p>GASCAR itself does not manufacture ships nor sponsor individual teams. Instead, it licenses racing corridors, certifies vessel configurations, and enforces strict engineering and safety standards designed to prevent the sport from devolving into uncontrolled experimental rocketry. Even so, racing vessels routinely push the limits of known propulsion technology, which many consider TL8 due to their high-tech nature. Engines run hotter, hull frames are lighter, and automation systems are more aggressive than those found on conventional spacecraft.</p>
    <p>The spectacle has made GASCAR one of the most widely followed sporting institutions in civilized space. Entire economies form around major race events, from engineering sponsors and sensor-tracking broadcasters to betting syndicates and celebrity pilots whose reputations rival those of military aces.</p>
    <p>For the crews who compete, however, the appeal is simpler. A GASCAR race represents the purest contest of speed and skill available to a pilot: a narrow corridor of space, engines burning plaid, and the knowledge that for a few extraordinary minutes the fastest thing in the system might just be you.</p>

    <h3>Flash Division</h3>
    <p>Not all GASCAR competition takes place in the vacuum of space. Across the Federation, a parallel form of racing has developed using gravitic surfacecraft known as skimmers. These small anti-gravity racers compete in low-altitude racecourses that weave through planetary terrain, urban skylines, canyon systems, and natural hazards. Though technically a separate subclass of competition, most Flash races operate under the broader guidance and regulatory framework of GASCAR.</p>
    <p>Flash racers are tightly restricted by design. No craft may exceed five tons displacement, and they are not allowed to break the local speed of sound. In practice this caps most racers at roughly 750 miles per hour depending on atmospheric conditions. These racers are also granted a special exemption from standard civilian anti-gravity regulations. While most civilian anti-gravity vehicles are limited to operating within three yards of the ground, Flash Division skimmers are permitted to climb as high as one hundred yards above the surface during a race. The restriction on speed still exists for both safety and environmental reasons; sonic booms through populated areas or fragile terrain would make many racecourses impossible to operate.</p>
    <p>Each world typically hosts several Flash races, which together feed into larger regional Flash Circuits, with racecourses adapted to regional geography. Desert worlds favor long canyon runs and salt-flat sprint tracks. Ocean planets often use island chains and floating beacons. Urban worlds weave their racecourses through skyscraper corridors and elevated infrastructure. While the terrain varies widely, all local leagues (or local race series) share common GASCAR standards for checkpoint marking, safety enforcement, and race officiation.</p>
    <p>For many pilots, the local skimmer leagues represent the first step in a professional racing career. The craft are smaller, the races shorter, and the entry costs dramatically lower than orbital competitions. Yet the danger remains very real. At near-sonic speeds only a few dozen yards above the ground, a pilot must rely on reflexes and precision rather than raw acceleration. More than one famous Spark-class racer began his career threading a skimmer through canyon walls at seven hundred miles an hour.</p>
    <p>Though considered the grassroots division of GASCAR, Flash Division Circuits maintain passionate followings and produce some of the most aggressive drivers in the sport. Many veterans of the spaceborne divisions quietly admit that if a driver can master skimmer racing, the transition to space is merely a matter of learning to fall upward.</p>

    <h3>Sponsors</h3>
    <p>Sponsors are a mix of noble houses, corporations, and the occasional slightly questionable organization who somehow still has their logo on a championship hull. Sponsors are both beneficial and detrimental to their ships. To reflect this, players may give a +1 bonus to Pilot, Navigator, Spotter, or Engineer; to compensate, they must take a -1 penalty someplace else.</p>

    <h3>Combat</h3>
    <p>Although GASCAR ships can carry weapons, their use in sanctioned competition is strictly prohibited. Beam weapons, missiles, railguns, and slug throwers are universally condemned, and every race is monitored through ship telemetry to reconstruct incidents. Electronic warfare can disable or corrupt that telemetry, however, making sabotage or attacks possible. If your campaign reaches that level, use the Warp Space: Ships & Combat rules.</p>
    <p>For simplicity, assume every ships carries a basic Foreign Object Detection and Removal (FODaR) system for clearing debris from the course. These low-powered systems are not intended for combat, but clever pilots may try to misuse them. Resolve such actions using the Racing Maneuvers: Attack rules.</p>
  </section>`;
}

/* ---------- Reference ---------- */
function renderInstructions() {
  return `<section class="card"><h2>How to Use This App</h2>
    <p class="muted" style="margin-top:-6px">v${APP_VERSION}</p>
    <p class="muted">Build things in this order, then run the race. Each tab only shows what's relevant once earlier steps are done — for example, Hangar Bay is empty until you have at least one Ship Class, and Race won't let you start until a Racecourse and its Ships exist.</p>

    <h3>1. Shipyard — build Ship Classes</h3>
    <p>A Ship Class is the reusable stat block a Ship is built from: Division, Max Thrust, Ship AI (Pilot/Navigator/Spotter scores + Advantage), Armor, Frame Strength, and Compartmentalization. Click <b>"Default"</b> on a new Class to seed it from that Division's book stats, then tweak from there. Every Division has a build-points cap (shown on the card) — you can build over it, but Total Points turns red as a flag, not a hard block. Flash Division also has a hard, non-negotiable 5-G Max Thrust ceiling (it's sub-sonic).</p>

    <h3>2. Cantina — build Crew</h3>
    <p>Name each Hero and put points into their five skills: Pilot, Navigator, Spotter, Engineer, and Resistance. Each skill is a Score plus Advantage/Disadvantage levels — neither has a purchase limit, they just get steeply pricier the higher you push them (Advantage cost doubles each level). The only cap in the game is on the <b>Leg</b>: no matter how much Advantage a position has, it only ever counts up to AAAAA in an actual race. Unspent Points track XP you haven't allocated yet.</p>

    <h3>3. Hangar Bay — build Ships</h3>
    <p>Use the <b>Division dropdown</b> next to "+ Add Ship" to choose what Division the new Ship races in — the Ship Class dropdown on each Ship card only lists Classes legal for that same Division, so the two can never mismatch. Then assign Crew to the four positions (Pilot, Navigator, Spotter, Engineer). A Ship's crew size is fixed by its Division; if you have fewer crew than positions, one person can hold more than one position. Every position must be filled before a Ship is race-legal (a 🔒 tag shows what's missing).</p>

    <h3>4. Racecourse — design a race</h3>
    <p>Set the course's Division (which Ships are eligible to enter) and pick a Track. <b>Straight — Legs</b> also asks for a Type — Drag Race is always 1 Leg; Short, Medium, and Long roll dice (2d5 / 2d10 / 2d20) to determine how many Legs the race has. Generate or hand-edit each Leg's Tier and TN; a course feature/modifier can nudge the TN up or down from the Tier-based baseline.</p>
    <p><b>Circular — Distance Tracking</b> is an alternate way to run the race, on a real hex-grid track: the course has 6 lanes, each exactly 6 hexes longer per lap than the one inside it (an exact property of the hex grid, not a chosen number; inner lane defaults to roughly 50 hexes), and you set how many laps finish the race. Each Leg, a Hero moves hexes equal to their own <b>Leg Ranking Score</b> (Speed Bonus, +1 per Critical Success Level, -1 per Fumble Level) — but a <b>Failed or Fumbled Pilot Task Check halves that Leg's Movement, rounded up</b>, applied before Slip is worked out (stacks with, doesn't replace, the usual -1/level Fumble hit to the Leg Ranking Score itself). NPCs move off the Base Leg Result (the Heroes' average Speed Bonus alone) instead and are never halved. The race has no fixed Leg count — it ends the moment any racer completes the required laps. At the start of the Race every ship rolls <b>Initiative</b> (d20 + its Max Acceleration; NPCs have no Ship Class, so they roll a bare d20) and lanes are assigned in that order, innermost lane to outermost, highest Initiative first — a tie is broken by re-rolling just the tied ships against each other. During Declare Intentions, the Pilot can declare one or more lanes of Slip left (inward) or right (outward); once the Leg's movement is known, the declared Slip hexes are worked in with the ordinary forward movement wherever it covers the most real ground for the Leg (not always first or last), at no cost beyond ordinary movement (a Fumble/halving that leaves less movement than declared shrinks the Slip to match). It costs no Advantage/Disadvantage only if the whole Leg (start position through the ship's declared Acceleration worth of movement) stays on a straightaway — touching a curve anywhere along that path grants +1 Advantage per hex slipped outward or costs −1 Disadvantage per hex slipped inward. An inward Slip that touches a curve <b>also</b> grants <b>+1 bonus Movement per hex actually Slipped</b> (Slingshot), on top of ordinary movement, pure free speed for cutting the inside line — this only fires for a Slip actually declared and executed that Leg, not just for sitting in the inside lane. Ships can only Slip into an adjacent lane's hex that's actually next to their current one. If two or more ships end a Leg sharing the same hex (<b>Crowded Field</b>), each of their Pilots starts the next Leg with 1 Level of Disadvantage per ship sharing that hex (2 ships sharing costs 2 D each, 3 ships costs 3 D each, and so on).</p>

    <h3>5. Race — run it</h3>
    <p>Race Setup filters selectable Ships to the chosen course's Division, and you can add NPC racers alongside your Heroes. Each Leg then walks through, in order:</p>
    <ol>
      <li><b>Declarations</b> — every Ship sets its Acceleration (capped by its Class's Max Thrust, reduced by any active Fumble penalties) and may run one Racing Maneuver per position against a target's same position. On a Circular Track, a Maneuver can only target a ship within 2 hexes; straight/Legs courses have no hexes, so targeting is unrestricted there.</li>
      <li><b>Phase I (Conditions)</b> — apply per-crewman conditions (Wounded, Under Fire, etc.); each one is Disadvantage on every position that crewman holds. Lock conditions once set so they hold for the whole Leg.</li>
      <li><b>Resistance</b> — every crewman rolls to resist G-forces from the declared Acceleration vs. the Damper Rating; a failed roll costs Disadvantage on that crewman's positions for the rest of the Leg.</li>
      <li><b>Engineer → Spotter → Navigator</b> — each rolls their Task Check and grants Advantage/Disadvantage to a chosen Ship (their own or a rival's); a Critical Success or Fumble can offer a bigger or different choice.</li>
      <li><b>Pilot</b> — rolls last. The Pilot's TN check (Score + accumulated Advantage/Disadvantage) determines pass/fail and Critical/Fumble, but who actually <i>wins</i> the Leg is decided separately: Speed Bonus (= declared Acceleration) plus 1 per Critical Success level, minus 1 per Fumble level.</li>
      <li><b>NPCs</b> auto-roll off the Base Leg Result once every Hero has finished. <b>Standings</b> then shows finishing order for the Leg; a Ship reduced to 0 HP is marked OOC (Out of Commission) and stays frozen at its crash position for the rest of the race.</li>
    </ol>
    <p>On a Circular Track, <b>Show Last Leg</b>/<b>Show Entire Race</b> (above the Standings track) replay each Ship's movement at half speed, dropping a small colored dot at the center of every hex it passes through so its path stays visible on the track. Click anywhere to clear the trail.</p>

    <p class="muted">The <b>Reference</b> tab has Division stat tables, the full Racing Maneuvers list, NPC Performance, both Fumble Charts, and Export/Import for your save data. Everything is saved automatically to this browser (localStorage) — use Export JSON on Reference for a backup file you control.</p>
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
    <tr><th>Division</th><th>Max Tier</th><th>Common Name</th><th>Max Thrust</th><th>Damper</th><th>Min Crew</th></tr>
    ${GDATA.DIVISIONS.map(d => { const c = GDATA.SHIP_CLASSES[d]; return `<tr><td>${d}</td><td>${c.tier}</td><td>${c.common}</td><td>${c.maxThrust}-G</td><td>${c.damper}-G</td><td>${c.crew || 1}</td></tr>`; }).join("")}
  </table></section>`;

  html += `<section class="card" style="grid-row: span 2;"><h2>Racing Maneuvers</h2>
    <p class="muted">Each position runs its own Maneuver during Declarations against a target's <b>same</b> position (Pilot always instigates). Target position only matters against Hero ships — against an NPC, it applies as normal and stacks cumulatively with other positions' Maneuvers on that same NPC.</p>
    <table class="mktable">
    <tr><th>Position</th><th>Maneuver</th><th>Description</th><th>Disadvantage</th></tr>
    ${GDATA.MANEUVERS.map(m => `<tr><td>${POS_LABEL[m.position] || m.position}</td><td>${m.name}</td><td>${esc(m.desc)}</td><td>${m.disadv === "Tier" ? "−Tier" : "−" + m.disadv}</td></tr>`).join("")}
  </table></section>`;

  html += `<section class="card"><h2>NPC Performance (1d6)</h2><table class="mktable">
    <tr><th>Roll</th><th>Result</th><th>Modifier</th></tr>
    ${GDATA.NPC_PERFORMANCE.map(n => `<tr><td>${n.roll}</td><td>${n.name} — ${esc(n.desc)}</td><td>${n.mod >= 0 ? "+" : ""}${n.mod}</td></tr>`).join("")}
  </table></section>`;

  html += `<section class="card"><h2>Flash Division Fumble Chart (1d10)</h2><table class="mktable">
    <tr><th>Roll</th><th>Result</th></tr>
    ${GDATA.FLASH_FUMBLES.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.text)}</td></tr>`).join("")}
  </table></section>`;

  html += `<section class="card"><h2>Spaceflight Fumble Chart (1d10)</h2><table class="mktable">
    <tr><th>Roll</th><th>Result</th></tr>
    ${GDATA.SPACEFLIGHT_FUMBLES.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.text)}</td></tr>`).join("")}
  </table></section>`;

  html += `</div>`;
  return html;
}

// Replay path trail (see APP_CHANGES.md): as App.playRaceReplay() steps a
// ship through a Leg, a dot is dropped at the center of each hex it
// passes through, in a per-ship color from this palette (cycling by
// participant index, so it stays stable across different Legs/replays for
// the same ship). Colors chosen to read clearly against the dark track
// background (--panel2/--border in style.css) and stay distinct from the
// gold used elsewhere for the finish line/UI accents.
const REPLAY_TRAIL_COLORS = ["#ff5a5a", "#5ad1ff", "#7dff5a", "#ffb84d", "#c77dff", "#ff5ac7", "#5affea", "#ffe45a"];
function replayTrailColorFor(participantIdx) { return REPLAY_TRAIL_COLORS[participantIdx % REPLAY_TRAIL_COLORS.length]; }
// Dots dropped by the CURRENTLY-running (or most recently finished) replay,
// so a later click anywhere on the page can clear them. A normal render()
// rebuilds the whole circtrack SVG from scratch anyway (see
// renderCircularTrackSvg()'s own comment), which already drops these dots
// along with the old DOM nodes -- this array only needs to handle the case
// where the SAME SVG is still on screen and the user clicks to explicitly
// clear the trail without triggering a re-render.
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
  /* Crew */
  addPresetCrew() {
    const idx = parseInt(document.getElementById("presetCrew").value, 10);
    const preset = GDATA.PRESET_CREW[idx];
    STATE.crew.push({
      id: uid("crew"), name: preset.name, unspentPoints: 0,
      skills: {
        pilot: { ...preset.pilot }, navigator: { ...preset.navigator },
        spotter: { ...preset.spotter }, engineer: { ...preset.engineer }, resistance: { ...preset.resistance }
      }
    });
    saveState(); render();
  },
  addBlankCrew() {
    STATE.crew.push({
      id: uid("crew"), name: rollHeroName(), unspentPoints: 0,
      skills: { pilot: { score: 0, adv: 0 }, navigator: { score: 0, adv: 0 }, spotter: { score: 0, adv: 0 }, engineer: { score: 0, adv: 0 }, resistance: { score: 0, adv: 0 } }
    });
    saveState(); render();
  },
  rerollCrewName(id) { getCrew(id).name = rollHeroName(); saveState(); render(); },
  deleteCrew(id) {
    if (!confirm("Delete this crewman?")) return;
    STATE.crew = STATE.crew.filter(c => c.id !== id);
    STATE.ships.forEach(s => POSITIONS.forEach(p => { if (s.assignments[p] === id) s.assignments[p] = ""; }));
    saveState(); render();
  },
  updateCrew(id, field, val) { getCrew(id)[field] = val; saveState(); },
  toggleCrewCollapse(id) { const c = getCrew(id); c._collapsed = !c._collapsed; saveState(); render(); },
  updateUnspentPoints(id, val) { getCrew(id).unspentPoints = clampInt(val, -9999, 9999, 0); saveState(); render(); },
  updateSkill(id, pos, field, val) {
    const c = getCrew(id);
    // House rule (see RULE_CHANGES.md): Advantage has no purchase limit -- only the
    // effective Leg skill is capped at AAAAA (see MAX_ADV / netForPosition). Buying
    // past AAAAA is legal, it's just wasted in a Leg.
    c.skills[pos][field] = clampInt(val, field === "adv" ? -5 : 0, field === "adv" ? 999 : 30, 0);
    saveState(); render();
  },

  /* Ships */
  setHangarAddDivision(val) {
    if (!GDATA.DIVISIONS.includes(val)) return;
    STATE._hangarAddDivision = val;
    saveState(); render();
  },
  addShip() {
    if (!STATE.shipClasses.length) { alert("Create a Ship Class in the Shipyard tab first."); return; }
    // Build into whichever Division is selected next to the Add Ship button
    // (defaults to Comet); cls and shipClass must always agree, so there must be
    // an actual Class in that Division to build from.
    const division = STATE._hangarAddDivision || "Comet";
    const defaultClass = STATE.shipClasses.find(c => c.division === division);
    if (!defaultClass) { alert(`No ${division} Division Ship Classes yet. Build one in the Shipyard tab first.`); return; }
    STATE.ships.push({ id: uid("ship"), name: "New Ship", cls: defaultClass.division, shipClass: defaultClass.name, sponsorBonusPos: "", sponsorPenaltyPos: "", iconColor: "", iconNumber: "", assignments: { pilot: "", navigator: "", spotter: "", engineer: "" } });
    // Make sure the Division group the new ship lands in is open, or it'd be
    // added into a collapsed tree node and appear to do nothing.
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[defaultClass.division] = false;
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
    if (field === "shipClass") {
      // House rule (see APP_CHANGES.md): a Ship's icon number must match its
      // Class's -- switching Class invalidates a now-mismatched icon.
      const sc = STATE.shipClasses.find(c => c.name === val);
      const classIcon = sc ? sc.icon : "";
      if (ship.iconNumber !== classIcon) { ship.iconColor = ""; ship.iconNumber = ""; }
    }
    if (field === "cls") {
      // The Ship Class dropdown is filtered to the ship's own Division -- if the
      // current Class isn't legal for the Division just switched to, drop to the
      // first legal Class for it (or none, if it has no Classes yet).
      if (!shipClassNamesForDivision(val).includes(ship.shipClass)) {
        ship.shipClass = shipClassNamesForDivision(val)[0] || "";
        const sc = STATE.shipClasses.find(c => c.name === ship.shipClass);
        const classIcon = sc ? sc.icon : "";
        if (ship.iconNumber !== classIcon) { ship.iconColor = ""; ship.iconNumber = ""; }
      }
      // The ship just moved to another Division group -- keep it open so it stays visible.
      STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
      STATE._hangarDivCollapse[val] = false;
    }
    saveState(); render();
  },
  // Crew dropdown: show each crewman's abbreviated skills only while the list is
  // open (native <option>s can't differ between open/closed, so swap the text on
  // focus/blur). The closed box keeps showing just the selected name.
  crewDDtoggle(btn) {
    const dd = btn.parentElement;
    const wasOpen = dd.classList.contains("open");
    document.querySelectorAll(".crewdd.open").forEach(d => d.classList.remove("open"));
    if (!wasOpen) dd.classList.add("open");
  },
  crewDDpick(shipId, pos, crewId) {
    // assignCrew re-renders (rebuilding the DOM), which closes the menu.
    App.assignCrew(shipId, pos, crewId);
  },
  assignCrew(shipId, pos, crewId) {
    const ship = getShip(shipId);
    if (crewId) {
      const required = minCrewFor(ship);
      const cap = maxPositionsPerCrewman(ship);
      const heldElsewhere = POSITIONS.filter(p => p !== pos && ship.assignments[p] === crewId).length;
      if (heldElsewhere + 1 > cap) {
        alert(`${getCrew(crewId).name} can only crew up to ${cap} position(s) on this ship -- it requires exactly ${required} distinct crew across its ${POSITIONS.length} positions.`);
        render();
        return;
      }
      // House rule (see RULE_CHANGES.md): crew size is exact, not just a floor --
      // bringing in a new distinct crewman can't push the ship's total past it.
      const simulated = { ...ship.assignments, [pos]: crewId };
      const resultingDistinct = new Set(POSITIONS.map(p => simulated[p]).filter(Boolean)).size;
      if (resultingDistinct > required) {
        alert(`This Ship Class takes exactly ${required} crew -- assigning ${getCrew(crewId).name} here would bring it to ${resultingDistinct} distinct crew. Reassign someone already on this ship instead, or free up a position first.`);
        render();
        return;
      }
    }
    ship.assignments[pos] = crewId;
    saveState(); render();
  },
  randomShipName() { document.getElementById("nameIdea").textContent = rollShipName(); },
  rerollShipName(id) { getShip(id).name = rollShipName(); saveState(); render(); },
  toggleShipCollapse(id) { const s = getShip(id); s._collapsed = !s._collapsed; saveState(); render(); },
  updateShipIcon(id, color, num) {
    const ship = getShip(id);
    if (!ship) return;
    if (!color || !num) { ship.iconColor = ""; ship.iconNumber = ""; saveState(); render(); return; }
    // House rule (see APP_CHANGES.md): a Ship's icon number must match its
    // Ship Class's icon number -- only the color is free.
    const sc = STATE.shipClasses.find(c => c.name === ship.shipClass);
    if (!sc || !sc.icon) { alert(`Give "${ship.shipClass}" an Icon in the Shipyard tab first.`); return; }
    if (num !== sc.icon) { alert(`This ship's icon number must match its Ship Class's icon (${sc.icon}).`); return; }
    // Uniqueness is per-Division: the same color+number in a different Division
    // is a different ship, so only clashes within this class's Division count.
    if (STATE.ships.some(s => s.id !== id && s.iconColor === color && s.iconNumber === num && shipClassDivision(s.shipClass) === sc.division)) {
      alert(`That icon is already used by another ${sc.division} ship.`);
      return;
    }
    ship.iconColor = color; ship.iconNumber = num;
    saveState(); render();
  },
  togglePhaseCollapse(key) {
    const ls = STATE.race.legState;
    ls.phaseCollapsed[key] = !ls.phaseCollapsed[key];
    saveState(); render();
  },

  /* Ship Classes */
  addShipClass() {
    STATE.shipClasses.push({
      id: uid("shipclass"), name: "New Class", common: "Custom",
      division: "Comet",
      maxThrust: 10,
      frame: "Standard", armor: 0, compartment: "Standard",
      legDice: { n: 2, d: 10 }, icon: "",
      ai: { control: 0, controlAdv: 0, nav: 0, navAdv: 0, sensors: 0, sensorsAdv: 0 }
    });
    // Keep the new class's Division group open so it doesn't land in a collapsed node.
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse["Comet"] = false;
    saveState(); render();
  },
  addPresetShipClass() {
    const division = document.getElementById("presetShipClass").value;
    const divStats = GDATA.SHIP_CLASSES[division];
    STATE.shipClasses.push({
      id: uid("shipclass"), name: division, common: divStats.common,
      division,
      maxThrust: divStats.maxThrust,
      frame: divStats.frame || "Standard", armor: divStats.armor || 0, compartment: divStats.compartment || "Standard",
      legDice: { n: 2, d: 10 }, icon: "",
      ai: { control: divStats.ai.control, controlAdv: divStats.ai.controlAdv, nav: divStats.ai.nav, navAdv: divStats.ai.navAdv, sensors: divStats.ai.sensors, sensorsAdv: divStats.ai.sensorsAdv }
    });
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse[division] = false;
    saveState(); render();
  },
  deleteShipClass(id) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    if (!sc) return;
    const dependent = STATE.ships.filter(s => s.shipClass === sc.name);
    const remaining = STATE.shipClasses.filter(c => c.id !== id);
    if (dependent.length && !remaining.length) {
      alert(`Can't delete "${sc.name}" -- ${dependent.length} ship(s) in the Hangar Bay use it and it's the only Ship Class left. Create another Class first, or delete those ships.`);
      return;
    }
    if (!confirm(`Delete ship class "${sc.name}"?${dependent.length ? ` ${dependent.length} ship(s) using it will be reassigned to "${remaining[0].name}".` : ""}`)) return;
    STATE.shipClasses = remaining;
    dependent.forEach(s => { s.shipClass = remaining[0].name; });
    saveState(); render();
  },
  toggleShipClassCollapse(id) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    sc._collapsed = !sc._collapsed; saveState(); render();
  },
  toggleShipyardDiv(div) {
    STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
    STATE._shipyardDivCollapse[div] = !STATE._shipyardDivCollapse[div];
    saveState(); render();
  },
  toggleHangarDiv(div) {
    STATE._hangarDivCollapse = STATE._hangarDivCollapse || {};
    STATE._hangarDivCollapse[div] = !STATE._hangarDivCollapse[div];
    saveState(); render();
  },
  updateShipClassName(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    const oldName = sc.name;
    const newName = val.trim();
    if (!newName || newName === oldName) { render(); return; }
    if (STATE.shipClasses.some(c => c.id !== id && c.name === newName)) {
      alert(`"${newName}" is already in use by another ship class.`);
      render();
      return;
    }
    sc.name = newName;
    STATE.ships.forEach(s => { if (s.shipClass === oldName) s.shipClass = newName; });
    saveState(); render();
  },
  updateShipClassIcon(id, num) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    if (!sc) return;
    // Icon numbers are per-Division, so only another Class in the SAME Division clashes.
    if (num && STATE.shipClasses.some(c => c.id !== id && c.icon === num && c.division === sc.division)) {
      alert(`Icon ${num} is already used by another ${sc.division} Ship Class.`);
      return;
    }
    sc.icon = num || "";
    // House rule (see APP_CHANGES.md): a Ship's icon number always matches its
    // Class's -- if the Class's icon just changed (or was cleared), any Ship
    // built from it whose number no longer matches loses its icon and must
    // repick a color for the new number.
    STATE.ships.forEach(s => {
      if (s.shipClass === sc.name && s.iconNumber !== sc.icon) { s.iconColor = ""; s.iconNumber = ""; }
    });
    saveState(); render();
  },
  updateShipClassDivision(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    if (!GDATA.DIVISIONS.includes(val)) return;
    mutateShipClassWithCapCheck(sc, () => {
      sc.division = val;
      // House rule (see RULE_CHANGES.md): Spark ships get no Ship AI Score at all -- locked at 0.
      if (val === "Spark") { sc.ai.control = 0; sc.ai.nav = 0; sc.ai.sensors = 0; }
      // Flash ships are sub-sonic -- clamp Max Thrust to 5-G on switching to Flash.
      sc.maxThrust = Math.min(sc.maxThrust, maxThrustCap(val));
      // Icon numbers are per-Division; if this icon now clashes in the new
      // Division, drop it (and its ships' icons) so nothing points at a
      // duplicate. The picker can then re-pick a free number.
      if (sc.icon && STATE.shipClasses.some(c => c.id !== sc.id && c.icon === sc.icon && c.division === val)) {
        sc.icon = "";
        STATE.ships.forEach(s => { if (s.shipClass === sc.name) { s.iconColor = ""; s.iconNumber = ""; } });
      }
      // Keep the target Division group open so the moved class stays visible.
      STATE._shipyardDivCollapse = STATE._shipyardDivCollapse || {};
      STATE._shipyardDivCollapse[val] = false;
    });
  },
  applyShipClassDefault(id) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    const divStats = GDATA.SHIP_CLASSES[sc.division];
    if (!confirm(`Reset "${sc.name}" to the book ${sc.division}-class stats? This overwrites Acc, Spotter, Navigator, Pilot, Frame Strength, Armor, and Compartmentalization.`)) return;
    sc.maxThrust = divStats.maxThrust;
    sc.ai = { control: divStats.ai.control, controlAdv: divStats.ai.controlAdv, nav: divStats.ai.nav, navAdv: divStats.ai.navAdv, sensors: divStats.ai.sensors, sensorsAdv: divStats.ai.sensorsAdv };
    sc.frame = divStats.frame || "Standard";
    sc.armor = divStats.armor || 0;
    sc.compartment = divStats.compartment || "Standard";
    saveState(); render();
  },
  updateShipClassMaxThrust(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    mutateShipClassWithCapCheck(sc, () => {
      sc.maxThrust = clampInt(val, 0, maxThrustCap(sc.division), sc.maxThrust);
    });
  },
  updateShipClassFrame(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    if (!GDATA.FRAME_STRENGTH.some(f => f.name === val)) return;
    mutateShipClassWithCapCheck(sc, () => { sc.frame = val; });
  },
  updateShipClassArmor(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    mutateShipClassWithCapCheck(sc, () => { sc.armor = clampInt(val, 0, 30, sc.armor); });
  },
  updateShipClassCompartment(id, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    if (!GDATA.COMPARTMENTALIZATION.some(c => c.name === val)) return;
    mutateShipClassWithCapCheck(sc, () => { sc.compartment = val; });
  },
  updateShipClassAI(id, key, val) {
    const sc = STATE.shipClasses.find(c => c.id === id);
    const isAdv = key.endsWith("Adv");
    if (sc.division === "Spark" && !isAdv) return; // AI Score locked at 0 for Spark
    mutateShipClassWithCapCheck(sc, () => {
      // Same "no purchase limit, only a Leg cap" rule as crew Advantage (see updateSkill).
      sc.ai[key] = clampInt(val, isAdv ? -5 : 0, isAdv ? 999 : 30, sc.ai[key]);
    });
  },

  /* Course */
  rollDraftName() { document.getElementById("cName").value = rollRaceName(); },
  draftDivChanged() { },
  setDraftTrackType(val) { STATE._draftTrackType = val; render(); },
  previewLaneHexes(val) {
    const inner = clampInt(val, 1, 999, 50);
    laneHexesArray({ lanes: 6, innerHexes: inner }).forEach((h, i) => {
      const cell = document.getElementById(`laneHexCol${i}`);
      if (cell) cell.textContent = h;
    });
  },
  rollDraftLegCount() {
    const type = document.getElementById("cType").value;
    document.getElementById("cLegs").value = rollLegCount(type);
  },
  generateCourse() {
    const name = document.getElementById("cName").value.trim() || rollRaceName();
    const division = document.getElementById("cDiv").value;
    const mode = document.getElementById("cMode").value;
    const trackType = STATE._draftTrackType || "legs";
    if (trackType === "circular") {
      // Circular Track / Distance Tracking (see RULE_CHANGES.md): there's no
      // pre-built Leg list -- every Leg of every race on this course is rolled
      // fresh, on the spot, by rollCircularLeg() (see initLegState()).
      const innerHexes = clampInt(document.getElementById("cInnerHexes").value, 1, 999, 50);
      const laps = clampInt(document.getElementById("cLaps").value, 1, 999, 3);
      STATE.courses.push({ id: uid("course"), name, division, trackType, lanes: 6, innerHexes, laps, legMode: mode, legs: [] });
    } else {
      const type = document.getElementById("cType").value;
      const count = clampInt(document.getElementById("cLegs").value, 1, 60, 4);
      const legs = [];
      for (let i = 0; i < count; i++) {
        const leg = rollLeg(division);
        leg.finalMode = mode;
        leg.finalTN = mode === "tier" ? leg.tnTierMod : (mode === "tn" ? leg.tnTnMod : leg.baseTN);
        legs.push(leg);
      }
      STATE.courses.push({ id: uid("course"), name, division, trackType, type, legs });
    }
    saveState(); render();
  },
  toggleCourseView(id) { STATE._expanded = STATE._expanded === id ? null : id; render(); },
  deleteCourse(id) {
    if (!confirm("Delete this racecourse?")) return;
    STATE.courses = STATE.courses.filter(c => c.id !== id);
    saveState(); render();
  },
  setFinalTN(courseId, idx, val) {
    getCourse(courseId).legs[idx].finalTN = clampInt(val, 1, 999, 0);
    saveState();
  },
  rerollLeg(courseId, idx) {
    const c = getCourse(courseId);
    const leg = rollLeg(c.division);
    leg.finalMode = c.legs[idx].finalMode;
    leg.finalTN = leg.finalMode === "tier" ? leg.tnTierMod : (leg.finalMode === "tn" ? leg.tnTnMod : leg.baseTN);
    c.legs[idx] = leg;
    saveState(); render();
  },

  /* Race setup */
  rollNpcName() { document.getElementById("npcName").value = rollShipName(); },
  playRaceReplay(lastLegOnly) {
    const race = STATE.race;
    if (!race) return;
    const course = getCourse(race.courseId);
    const circular = course.trackType === "circular";
    const laneHexes = circular ? laneHexesArray(course) : null;
    const maxPossible = Math.max(1, course.legs.length * race.participants.length);
    const legsCompleted = race.participants.reduce((m, p) => Math.max(m, (p.history || []).length), 0);
    if (!legsCompleted) return;
    // "Show Last Leg" starts the replay at the most recently completed Leg
    // instead of Leg 1 -- everything below is otherwise identical to "Show
    // Entire Race," just beginning from a later point.
    const fromLeg = lastLegOnly ? legsCompleted - 1 : 0;
    const btnAll = document.getElementById("raceReplayBtn");
    const btnLast = document.getElementById("raceReplayLastLegBtn");
    if (btnAll) btnAll.disabled = true;
    if (btnLast) btnLast.disabled = true;
    const geom = circular ? circTrackGeometry(course) : null;
    if (geom) ensureReplayTrailClickListener();
    const tracks = geom ? race.participants.map(p => ({ p, perLeg: buildCircularLegWaypoints(p, geom) })) : null;
    if (geom) {
      race.participants.forEach((p, i) => {
        // Walk backward from the Leg just before fromLeg looking for this
        // participant's last real waypoint -- a participant that dropped out
        // (p.out) before fromLeg has no waypoints that far, so it should stay
        // put at wherever it actually is rather than snapping back to the
        // race's starting line.
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
    }
    let leg = fromLeg;
    // Linear-board per-Leg cadence (straight courses); also matches the
    // .boardfill/.boardicon CSS transition (1.2s -- see style.css) so a
    // straight course's next Leg starts the instant the current one finishes,
    // with no idle gap/pause. hexStepDelay is the circular track's per-hex
    // hop cadence -- kept in sync with .circracer's own transition duration
    // (see style.css) for the same no-pause reason, just much shorter since
    // each hop covers one hex instead of a whole Leg. Both run at half speed
    // of their original cadence (see APP_CHANGES.md).
    const stepDelay = 1200;
    const hexStepDelay = 200;
    function updateBoardsForLeg(legIdx) {
      race.participants.forEach(p => {
        const h = p.history || [];
        let sum = 0;
        for (let j = 0; j <= legIdx && j < h.length; j++) sum += h[j].movement;
        // Distance Tracking: progress toward the fixed finish line (lane 1's
        // own starting line) -- see renderStandings() for why the starting
        // stagger is subtracted from the required distance.
        const req = circular ? Math.max(1, course.laps * laneHexes[p.lane - 1] - (p.startHexPos || 0)) : maxPossible;
        const pct = Math.min(100, Math.round((sum / req) * 100));
        const fill = document.getElementById(`boardfill-${p.id}`);
        const pts = document.getElementById(`boardpts-${p.id}`);
        const icon = document.getElementById(`boardicon-${p.id}`);
        if (fill) fill.style.width = pct + "%";
        if (pts) pts.textContent = circular ? pct + "%" : String(sum);
        if (icon) icon.style.left = pct + "%";
      });
    }
    // Snap every bar (and its icon) back to its state as of the end of the
    // Leg just before fromLeg -- 0% when replaying the whole race -- before
    // replaying forward from there.
    updateBoardsForLeg(fromLeg - 1);
    function playCircularLeg(legIdx, done) {
      const maxSteps = Math.max(1, ...tracks.map(t => (t.perLeg[legIdx] || []).length));
      let sub = 0;
      function tick() {
        if (STATE.race !== race) return; // race was abandoned/replaced mid-replay
        tracks.forEach((t, i) => {
          const wp = t.perLeg[legIdx];
          if (!wp || !wp.length) return;
          const point = wp[Math.min(sub, wp.length - 1)];
          const g = document.getElementById(`circracer-${t.p.id}`);
          if (!g) return;
          // Pass the racer's CURRENTLY-displayed rotation through so
          // circRacerTransform() can pick the equivalent angle closest to it
          // -- see its own comment -- so the CSS-transitioned turn always
          // animates the short way around instead of occasionally spinning a
          // full circle.
          const m = /rotate\(([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
          const prevRotDeg = m ? parseFloat(m[1]) : null;
          g.setAttribute("transform", circRacerTransform(geom, point, prevRotDeg).transform);
          // Path trail (see APP_CHANGES.md): drop a dot at the center of the
          // hex this ship just moved into, in its own color, so each racer's
          // path through the Leg stays visible on the track. Cleared by
          // clicking anywhere.
          paintReplayTrailDot(geom, (point.lane || 1) - 1, point.hexPos || 0, replayTrailColorFor(i));
        });
        sub += 1;
        if (sub < maxSteps) setTimeout(tick, hexStepDelay);
        else done();
      }
      tick();
    }
    function step() {
      if (STATE.race !== race) return; // race was abandoned/replaced mid-replay
      if (geom) {
        playCircularLeg(leg, () => {
          updateBoardsForLeg(leg);
          leg += 1;
          if (leg < legsCompleted) step();
          else { if (btnAll) btnAll.disabled = false; if (btnLast) btnLast.disabled = false; }
        });
      } else {
        updateBoardsForLeg(leg);
        leg += 1;
        if (leg < legsCompleted) setTimeout(step, stepDelay);
        else { if (btnAll) btnAll.disabled = false; if (btnLast) btnLast.disabled = false; }
      }
    }
    setTimeout(step, 400);
  },
  addDraftNpc() {
    const input = document.getElementById("npcName");
    const v = input.value.trim();
    if (!v) return;
    STATE._draftNpcs = STATE._draftNpcs || [];
    STATE._draftNpcs.push(v);
    input.value = "";
    render();
  },
  removeDraftNpc(i) { STATE._draftNpcs.splice(i, 1); render(); },
  setRaceSetupCourse(id) {
    STATE._raceSetupCourse = id;
    const course = getCourse(id);
    const div = course ? course.division : null;
    // Drop any selected ships that aren't in the newly-chosen Division.
    STATE._raceSetupShips = (STATE._raceSetupShips || []).filter(sid => { const s = getShip(sid); return s && (s.cls || "Comet") === div; });
    saveState(); render();
  },
  toggleRaceShip(id, checked) {
    STATE._raceSetupShips = (STATE._raceSetupShips || []).filter(x => x !== id);
    if (checked) STATE._raceSetupShips.push(id);
    saveState(); // no render -- keep the other checkboxes as the user left them
  },
  beginRace() {
    let courseId = STATE._raceSetupCourse;
    if (!courseId || !STATE.courses.some(c => c.id === courseId)) courseId = STATE.courses.length ? STATE.courses[0].id : null;
    if (!courseId) { alert("Create a racecourse first."); return; }
    const division = getCourse(courseId).division;
    // Only ships of the course's Division are valid racers.
    const shipIds = (STATE._raceSetupShips || []).filter(sid => { const s = getShip(sid); return s && (s.cls || "Comet") === division; });
    if (!shipIds.length) { alert(`Select at least one ${division} Division ship.`); return; }
    const underCrewed = shipIds.map(getShip).filter(ship => !shipCrewComplete(ship));
    if (underCrewed.length) {
      alert("Locked out of racing -- every position must be filled:\n" + underCrewed.map(crewLockMessage).join("\n"));
      return;
    }
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
    const ps = STATE.race.legState.perShip[pid];
    if (field === "accel") {
      const p = STATE.race.participants.find(x => x.id === pid);
      const cls = getShipClass(getShip(p.shipId).shipClass);
      // House rule (see RULE_CHANGES.md): declared Acceleration is at least 1-G --
      // a racer is always under power. effectiveMaxThrust already floors the max at
      // 1, so even a Fumble-reduced ship can still declare (and only) 1-G.
      ps.accel = clampInt(val, 1, effectiveMaxThrust(p, cls), ps.accel);
      // A Slip is also capped at the declared Acceleration (see RULE_CHANGES.md)
      // -- lowering Accel below an already-declared Slip magnitude re-clamps it,
      // and re-renders so the Slip section's shown max/value stay in sync.
      if (ps.slip) {
        const course = getCourse(STATE.race.courseId);
        const maxLane = Math.min(ps.slip === "left" ? p.lane - 1 : course.lanes - p.lane, ps.accel);
        ps.slipHexes = clampInt(ps.slipHexes, 1, Math.max(1, maxLane), ps.slipHexes || 1);
      }
      saveState(); render();
      return;
    } else if (field === "slip") {
      // Circular Track Slip (see RULE_CHANGES.md): changing direction defaults
      // the magnitude to 1 hex and re-renders so the magnitude input (and its
      // max, which depends on direction) shows/updates. lockDeclarations()
      // re-clamps the final magnitude authoritatively at lock time.
      ps.slip = val;
      ps.slipHexes = val ? (ps.slipHexes || 1) : 0;
      saveState(); render();
      return;
    } else if (field === "slipHexes") {
      const p = STATE.race.participants.find(x => x.id === pid);
      const course = getCourse(STATE.race.courseId);
      // Capped by both the lanes actually available AND the declared
      // Acceleration (see RULE_CHANGES.md).
      const maxLane = Math.min(ps.slip === "left" ? p.lane - 1 : course.lanes - p.lane, ps.accel);
      ps.slipHexes = clampInt(val, 1, Math.max(1, maxLane), ps.slipHexes || 1);
    } else ps[field] = val;
    saveState();
  },
  setPosManeuver(pid, pos, val) {
    const ps = STATE.race.legState.perShip[pid];
    ps.maneuvers = ps.maneuvers || { pilot: "", navigator: "", spotter: "", engineer: "" };
    ps.maneuverTargets = ps.maneuverTargets || { pilot: [], navigator: [], spotter: [], engineer: [] };
    ps.maneuvers[pos] = val;
    if (!val) ps.maneuverTargets[pos] = []; // clearing the Maneuver clears its targets
    saveState(); render(); // re-render to show/hide this position's target list
  },
  togglePosTarget(pid, pos, targetId, checked) {
    const ps = STATE.race.legState.perShip[pid];
    ps.maneuverTargets[pos] = (ps.maneuverTargets[pos] || []).filter(t => t !== targetId);
    if (checked) ps.maneuverTargets[pos].push(targetId);
    saveState();
  },
  togglePosAllTargets(pid, pos) {
    const race = STATE.race, ps = race.legState.perShip[pid];
    const p = race.participants.find(x => x.id === pid);
    const course = getCourse(race.courseId);
    const geom = course.trackType === "circular" ? circTrackGeometry(course) : null;
    const others = race.participants.filter(x => x.id !== pid && !x.out && (!geom || hexesWithinManeuverRange(geom, p, x)));
    const cur = ps.maneuverTargets[pos] || [];
    const allOn = others.every(o => cur.includes(o.id));
    ps.maneuverTargets[pos] = allOn ? [] : others.map(o => o.id);
    saveState(); render();
  },
  openDeclModal(pid) { STATE._openDeclFor = pid; render(); },
  closeDeclModal() { STATE._openDeclFor = null; render(); },
  confirmDecl(pid) {
    STATE.race.legState.perShip[pid].declared = true;
    STATE._openDeclFor = null;
    saveState(); render();
  },
  lockDecl() {
    const race = STATE.race;
    const heroes = activeHeroes(race);
    const allDeclared = heroes.every(p => race.legState.perShip[p.id].declared);
    if (!allDeclared) { alert("Not all ships have declared their intentions yet."); return; }
    const underCrewed = heroes.map(p => getShip(p.shipId)).filter(ship => !shipCrewComplete(ship));
    if (underCrewed.length) {
      alert("Locked out of racing -- every position must be filled:\n" + underCrewed.map(crewLockMessage).join("\n"));
      return;
    }
    lockDeclarations(); render();
  },
  toggleCond(pid, crewId, condIdx, checked) {
    const ps = STATE.race.legState.perShip[pid];
    if (ps.condLocked || ps.resistance) { render(); return; } // conditions are locked for this Leg
    const ship = getShip(STATE.race.participants.find(x => x.id === pid).shipId);
    const cond = GDATA.CONDITIONS[condIdx];
    if (!cond) return;
    ps._condFlags = ps._condFlags || {};
    ps._condFlags[crewId] = ps._condFlags[crewId] || {};
    const wasOn = !!ps._condFlags[crewId][cond.name];
    ps._condFlags[crewId][cond.name] = checked;
    // Apply −1 (or restore +1) to every position this crewman holds.
    const heldPositions = POSITIONS.filter(pos => ship.assignments[pos] === crewId);
    const delta = checked && !wasOn ? -1 : (!checked && wasOn ? 1 : 0);
    heldPositions.forEach(pos => { ps.conditions[pos] += delta; });
    saveState(); render();
  },
  lockConditions(pid) {
    STATE.race.legState.perShip[pid].condLocked = true;
    saveState(); render();
  },
  doResistance(pid) { rollResistance(pid); render(); },
  doPhase(pid, phase) { rollPhase(pid, phase); render(); },
  doSkipPhase(pid, phase) { skipPhase(pid, phase); render(); },
  setGrantChoice(pid, phase, val) { STATE.race.legState.perShip[pid].grantChoice[phase] = val; saveState(); render(); },
  rollFumble(pid) {
    const race = STATE.race, course = getCourse(race.courseId);
    const table = course.division === "Flash" ? GDATA.FLASH_FUMBLES : GDATA.SPACEFLIGHT_FUMBLES;
    const entry = table[rollD(10) - 1];
    const ps = race.legState.perShip[pid];
    ps.fumbleText = entry.text;
    const participant = race.participants.find(p => p.id === pid);
    const wasOut = !!participant.out;
    applyFumbleAffects(pid, entry);
    // A destroyed ship stays in the race until the Leg ends (see finishLeg) --
    // don't end the race here even if it was the last living Hero.
    saveState(); render();
    // Announce a kill with the Fumble description that caused it.
    if (participant.out && !wasOut) {
      alert(`💥 ${shipName(participant.shipId)} is Out of Commission (OOC) and out of the race!\n\n${entry.text}`);
    }
  },
  doBaseResult() {
    computeBaseLegResult();
    // Roll every NPC automatically -- their result depends on the Base Leg
    // Result just computed, so this is the natural moment; no per-NPC clicking.
    STATE.race.participants.filter(p => p.type === "npc" && !p.out).forEach(n => rollNpc(n.id));
    render();
  },
  doNpc(pid) { rollNpc(pid); render(); },
  doFinishLeg() { finishLeg(); render(); },

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
    if (!confirm("This clears ALL crew, ships, courses, and the current race. Continue?")) return;
    STATE = defaultState(); saveState(); render();
  }
};
window.App = App;

/* ============================== Boot ============================== */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tabbtn").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  // Close any open custom crew dropdown when clicking outside of it.
  document.addEventListener("click", e => {
    if (!e.target.closest(".crewdd")) {
      document.querySelectorAll(".crewdd.open").forEach(d => d.classList.remove("open"));
    }
  });
  render();
  startUpdateCheck();
});
/* New-version banner (see APP_CHANGES.md): re-loads version.js (a fresh
   <script> tag, not fetch()) and compares its LATEST_APP_VERSION against
   this tab's own APP_VERSION. A stale tab left open across a deploy has no
   other way to learn a new version exists -- GitHub Pages just keeps
   serving the old cached copy until something forces a reload. A <script>
   tag (not fetch, which is blocked cross-origin under file://) is what lets
   this also work when testing against the local file:// copy -- the same
   mechanism index.html already uses to load app.js itself. The cache-busting
   query string forces a real re-read every time either way. */
function startUpdateCheck() {
  const check = () => {
    const s = document.createElement("script");
    s.src = "version.js?" + Date.now();
    s.onload = () => {
      if (typeof LATEST_APP_VERSION !== "undefined" && LATEST_APP_VERSION !== APP_VERSION) {
        document.getElementById("updateBannerText").textContent = `A new version (v${LATEST_APP_VERSION}) is available -- your open tab is still running v${APP_VERSION}.`;
        document.getElementById("updateBanner").hidden = false;
        clearInterval(intervalId);
        document.removeEventListener("visibilitychange", onVisible);
      }
      s.remove();
    };
    s.onerror = () => s.remove(); // offline or blocked -- just skip this check, try again next tick
    document.head.appendChild(s);
  };
  const onVisible = () => { if (!document.hidden) check(); };
  const intervalId = setInterval(check, 5 * 60 * 1000); // every 5 minutes
  document.addEventListener("visibilitychange", onVisible);
  setTimeout(check, 5000); // first check shortly after load, not competing with initial render
}
