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
  if (rc.isCrit) return "Critical Success";
  if (rc.isFumble) return "Fumble";
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
    // Rename (see APP_CHANGES.md): Circular Track tiles are squares now, not
    // hexagons -- innerHexes -> innerSquares, value unchanged.
    if (course.innerHexes != null && course.innerSquares == null) { course.innerSquares = course.innerHexes; delete course.innerHexes; }
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
      // Rename (see APP_CHANGES.md): Circular Track tiles are squares now, not
      // hexagons -- hexPos/startHexPos -> squarePos/startSquarePos, values unchanged.
      if (p.hexPos != null && p.squarePos == null) { p.squarePos = p.hexPos; delete p.hexPos; }
      if (p.startHexPos != null && p.startSquarePos == null) { p.startSquarePos = p.startHexPos; delete p.startHexPos; }
      (p.history || []).forEach(h => { if (h.hexPos != null && h.squarePos == null) { h.squarePos = h.hexPos; delete h.hexPos; } });
    });
    if (state.race.legState && state.race.legState.perShip) {
      Object.values(state.race.legState.perShip).forEach(ps => {
        if (ps.slipHexes != null && ps.slipSquares == null) { ps.slipSquares = ps.slipHexes; delete ps.slipHexes; }
      });
    }
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
// House rule (see RULE_CHANGES.md): Circular Track / Distance Tracking. Each
// lane out from the inside adds a fixed number of squares to its lap length --
// this SAME number is also the exact decorative square tile count drawn for
// that lane (see curveSpineSets()/renderCircularTrackSvg() below), not just
// a gameplay figure.
var LANE_SQUARE_INCREMENT = 4;
// House rule (see RULE_CHANGES.md): each straightaway carries this many MORE
// squares than the "natural" straight/curve split would otherwise give it
// (see curveNaturalS()/curveSplitForCourse()) -- real extra length, not the
// same length subdivided into more, smaller squares (STADIUM_HALF_STRAIGHT,
// defined later, is grown to match). Counted once per straightaway, and
// there are 2, so a lane's total gains 2x this.
var STRAIGHT_SQUARE_BONUS = 10;
function laneSquaresArray(course) {
  return Array.from({ length: course.lanes || 6 }, (_, i) => (course.innerSquares || 50) + i * LANE_SQUARE_INCREMENT + 2 * STRAIGHT_SQUARE_BONUS);
}
// Staggered start (see RULE_CHANGES.md): each lane out starts this many
// squares further ahead than the one inside it -- a fixed offset, not derived
// from LANE_SQUARE_INCREMENT. Shared by startRace() (actual gameplay
// squarePos) and the standings SVG (drawing each lane's own starting mark at
// that same square).
var STAGGER_PER_LANE = 4;
function laneStartSquarePos(laneIdx0) { return laneIdx0 * STAGGER_PER_LANE; }
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
      slipSquares: 0, // squares of Slip declared this Leg (costs no Movement Points)
      slipAdvantage: 0, // signed A/D from the Slip, computed at lockDeclarations() -- 0 if entirely within a straightaway
      // House rule (see RULE_CHANGES.md): Crowded Field. -1 D per ship that
      // shared this square with it at the end of the PREVIOUS Leg (flagged by
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
  // in a lane, round-robin, and tracks laps completed + square position within the
  // current lap. Lane may change mid-race via a Slip (see renderDeclModal).
  // Outer lanes get a staggered head start, same reasoning as a real track: the
  // whole LANE_SQUARE_INCREMENT (4 squares) a lane's full lap gains over the one
  // inside it comes entirely from the two curved end-caps (straights are the
  // same length for every lane), split evenly between them -- so crossing just
  // the first curve, an unstaggered outer lane would already be running
  // LANE_SQUARE_INCREMENT/2 = 2 squares long per lane-step. Starting that far ahead
  // cancels it out. startLane/startSquarePos are kept alongside the live lane/
  // squarePos so a race replay can redraw the true starting frame later.
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
      p.squarePos = laneStartSquarePos(laneIdx0);
      p.laps = 0;
      p.startLane = p.lane;
      p.startSquarePos = p.squarePos;
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
  // Points beyond ordinary movement -- of this Leg's eventual squares of
  // movement, the ship spends as many as possible moving straight forward in
  // its CURRENT lane, then spends the declared Slip amount making the lane
  // change itself. Each square of Slip is a DIAGONAL, corner-touching step --
  // it advances forward by one square (same as ordinary movement) AND
  // changes one lane, simultaneously -- not a purely lateral hop, so a Slip's
  // squares count toward real forward progress exactly like any other
  // square of movement. Since the Leg's real movement isn't resolved yet
  // (that's what Phase VI's roll -- fed by the very A/D this determines --
  // is for), the lane change itself happens later, in finishLeg(), once
  // movement is known; this only clamps the declared magnitude to physically
  // available lanes and decides the A/D. It grants +1 Advantage per square if
  // the destination lane is further outward or -1 Disadvantage per square if
  // it's further inward, UNLESS the whole projected Leg -- current lane,
  // forward by (declared Acceleration minus the Slip amount), then each
  // diagonal Slip step in turn -- stays entirely on a straightaway; touching
  // a curve anywhere along that projected span uses the curve A/D. The A/D
  // itself is applied via pilotExtraNet() (not folded into
  // ps.conditions.pilot) so it shows as its own "Slip" line in
  // legAdSourcesHtml() instead of disappearing into "Conditions."
  if (course.trackType === "circular") {
    const geom = circTrackGeometry(course);
    const laneSquares = laneSquaresArray(course);
    Object.entries(ls.perShip).forEach(([pid, ps]) => {
      ps.slipAdvantage = 0;
      if (!ps.slip) { ps.slipSquares = 0; return; }
      const participant = race.participants.find(p => p.id === pid);
      // The track runs counterclockwise (see RULE_CHANGES.md) -- facing the
      // direction of travel, steering LEFT points toward the track's center
      // (inward, toward lane 1) and RIGHT points away from it (outward,
      // toward a higher lane number), the same way a driver on a real
      // counterclockwise oval steers left to move to the inside lane.
      // House rule (see RULE_CHANGES.md): a Slip is also capped at the ship's
      // declared Acceleration -- a ship can't Slip more squares than its own
      // declared G rate this Leg, on top of the lanes actually available.
      const maxLane = Math.min(ps.slip === "left" ? participant.lane - 1 : course.lanes - participant.lane, ps.accel || 0);
      const squares = clampInt(ps.slipSquares, 0, Math.max(0, maxLane), 0);
      ps.slipSquares = squares;
      if (squares <= 0) { ps.slip = ""; return; }
      const originLaneIdx0 = participant.lane - 1;
      const originSquarePos = participant.squarePos || 0;
      const dir = ps.slip === "left" ? -1 : 1;
      // Touches a curve if the origin square does, or if any square along
      // the projected path (declared Acceleration's worth of movement,
      // interleaved with the declared Slip squares the same way
      // resolveSlipPath() actually resolves the Leg -- see RULE_CHANGES.md)
      // does.
      const projected = resolveSlipPath(geom, laneSquares, originLaneIdx0, originSquarePos, ps.accel || 0, squares, dir);
      let touchesCurve = !isSquareOnStraight(geom, originLaneIdx0, originSquarePos);
      for (let i = 0; !touchesCurve && i < projected.steps.length; i++) {
        const step = projected.steps[i];
        if (!isSquareOnStraight(geom, step.laneIdx0, step.squarePos)) touchesCurve = true;
      }
      ps.slipAdvantage = touchesCurve ? (ps.slip === "right" ? squares : -squares) : 0;
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
  // by squares slipped -- 0 if the Slip was entirely within a straightaway.
  // ps.crowdedFieldD (set in initLegState() from last Leg's finishLeg()
  // detection -- see RULE_CHANGES.md) is -1 if 2+ ships shared a square
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
    // Distance Tracking (see RULE_CHANGES.md): squares moved this Leg is the ship's
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
    // Slip's squares (and the curve-touch Advantage/Disadvantage) are based
    // on the ALREADY-HALVED total, never the full pre-Fumble amount.
    if (circular && r.type === "hero") {
      const pilotRc = ls.perShip[r.id] && ls.perShip[r.id].results.pilot && ls.perShip[r.id].results.pilot.rc;
      if (pilotRc && !pilotRc.success) r.movement = Math.ceil(r.movement / 2);
    }
  });
  const circGeom = circular ? circTrackGeometry(course) : null;
  const circLaneSquares = circular ? laneSquaresArray(course) : null;
  rows.forEach(r => {
    const participant = race.participants.find(p => p.id === r.id);
    participant.cumulative += r.movement; // straight: points; circular: total squares traveled (monotonic)
    if (circular) {
      // Circular Track Slip (see RULE_CHANGES.md): the Slip's squares are
      // interleaved with ordinary forward movement to maximize the ship's
      // real distance covered this Leg -- see resolveSlipPath(). A ship
      // that didn't Slip this Leg (or rolled 0 movement) just moves forward
      // in its current lane as always.
      const ps = ls.perShip[r.id];
      const originLaneIdx0 = participant.lane - 1;
      const declaredSlipSquares = (ps && ps.slip) ? (ps.slipSquares || 0) : 0;
      const actualSlipSquares = Math.min(declaredSlipSquares, Math.max(0, r.movement));
      const dir = (ps && ps.slip === "left") ? -1 : 1;
      // House rule (see RULE_CHANGES.md): Slingshot. An inward Slip that
      // touches a curve (ps.slipAdvantage is negative ONLY for "left" +
      // touchesCurve, per lockDeclarations()) grants 1 bonus MP per square
      // actually Slipped this Leg (actualSlipSquares, already shrunk by any
      // Fail/Fumble halving or lane clamp above) -- pure extra forward
      // movement on top, not an extra Slip square. Gated on an ACTIVE dive
      // toward the inside this Leg, never on merely occupying the inside
      // lane already.
      const slingshotBonus = (ps && ps.slipAdvantage < 0) ? actualSlipSquares : 0;
      const totalMovement = r.movement + slingshotBonus;
      participant.cumulative += slingshotBonus;
      const path = resolveSlipPath(circGeom, circLaneSquares, originLaneIdx0, participant.squarePos || 0, totalMovement, actualSlipSquares, dir);
      participant.lane = path.finalLaneIdx0 + 1;
      participant.squarePos = path.finalSquarePos;
      participant.laps = (participant.laps || 0) + path.lapsGained;
      participant.history.push({ leg: race.legIndex + 1, total: r.total, position: r.position, movement: totalMovement, lane: participant.lane, laps: participant.laps, squarePos: participant.squarePos, slipSquares: actualSlipSquares, slingshotBonus });
    } else {
      participant.history.push({ leg: race.legIndex + 1, total: r.total, position: r.position, movement: r.movement });
    }
    if (participant.type === "hero" && participant.forcedLastLegs > 0) participant.forcedLastLegs -= 1;
  });
  // House rule (see RULE_CHANGES.md): Crowded Field. Any 2+ ships (hero or NPC)
  // that end this Leg sharing the same square flag every HERO among them for a
  // one-Leg Pilot Disadvantage next Leg, 1 D per ship in the square (consumed
  // in initLegState() via crowdedFieldD) -- an NPC can crowd a Hero's square
  // even though only a Hero has a Pilot to penalize.
  if (circular) {
    const bySquare = {};
    race.participants.forEach(p => {
      if (p.out) return;
      const key = `${p.lane}|${p.squarePos}`;
      (bySquare[key] = bySquare[key] || []).push(p);
    });
    Object.values(bySquare).forEach(group => {
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
  // measures in squares, not points, so this points-scaled gap doesn't apply there.
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
  if (CURRENT_TAB === "shipyard") root.innerHTML = renderShipyard();
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
    <p class="muted">Circular Track (see RULE_CHANGES.md): 6 lanes, each ${LANE_SQUARE_INCREMENT} squares longer than the one inside it. Race runs Leg by Leg until a racer completes the required laps — there's no fixed Leg count.</p>
    <div class="formrow"><label>Inner Lane Squares</label><input id="cInnerSquares" type="number" min="1" value="50" oninput="App.previewLaneSquares(this.value)"></div>
    <div class="formrow"><label>Laps to Finish</label><input id="cLaps" type="number" min="1" value="3"></div>
    <div class="formrow"><label>Apply Leg Modifier To</label>
      <select id="cMode"><option value="tier">Tier (TN = (Tier+Mod)×3)</option><option value="tn">TN (TN = Tier×3 + Mod)</option><option value="none">Ignore modifier</option></select></div>
    <table class="mktable"><tr><th>Lane</th>${Array.from({ length: 6 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
      <tr><td>Squares/Lap</td>${laneSquaresArray({ lanes: 6, innerSquares: 50 }).map((h, i) => `<td id="laneSquareCol${i}">${h}</td>`).join("")}</tr></table>
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
    const circTag = circular ? `<span class="tag">Circular</span> <span class="tag">${c.lanes} lanes, inner ${c.innerSquares} squares</span> <span class="tag">${c.laps} laps</span>` : `${c.type ? `<span class="tag">${esc(c.type)}</span>` : ""} <span class="tag">${c.legs.length} Legs</span>`;
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
      html += `<p class="muted">Circular Track — Distance Tracking is in effect (see Instructions). ${selCourse.lanes} lanes, inner lane ${selCourse.innerSquares} squares around, ${selCourse.laps} laps to finish. Ships are assigned a starting lane automatically; the Pilot may Slip a lane during the race.</p>`;
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
/* Oblong (stadium) track geometry (see RULE_CHANGES.md): two straightaways of
   fixed length joined by a semicircular curve at each end -- like a real
   running track, where lane N is the same shape as lane 1 just pushed
   outward, so its straights are the same length and only its curves get
   bigger. Traces the loop COUNTERCLOCKWISE (the real-world racing
   convention) starting at the top-right straight/curve join (the far right
   end of the upper straightaway, where the starting line is drawn): left
   along the top straight, down the left cap, right along the bottom
   straight, up the right cap, back to start. `t` is arc length along that
   lane's own perimeter, wrapping at `perimeter`. */
// Originally scaled 1.5x together (100->150, 36->54) to make the drawn track
// 50% bigger while keeping every lane's square count identical.
// STADIUM_INNER_R stays at that base value; STADIUM_HALF_STRAIGHT is grown
// further below to fit STRAIGHT_SQUARE_BONUS extra squares onto EACH
// straightaway (see RULE_CHANGES.md) as real extra length, not the same
// length subdivided into more, smaller squares -- BASE_STADIUM_HALF_STRAIGHT
// is the frozen 150 used only to size that bonus, so growing
// STADIUM_HALF_STRAIGHT itself doesn't feed back into its own calculation.
const BASE_STADIUM_HALF_STRAIGHT = 150, STADIUM_INNER_R = 54;
// The "natural" straight square count (see curveSplitForCourse()) at a given
// half-straight length -- straight square width roughly equal to lane 1's
// curve square width.
function curveNaturalS(halfStraight, innerR, innerSquares) {
  const ratio = (2 * halfStraight) / (Math.PI * innerR);
  const half0 = innerSquares / 2;
  return Math.max(1, Math.round(half0 - Math.max(1, half0 / (ratio + 1))));
}
const BASE_NATURAL_S = curveNaturalS(BASE_STADIUM_HALF_STRAIGHT, STADIUM_INNER_R, 50);
const STADIUM_HALF_STRAIGHT = BASE_STADIUM_HALF_STRAIGHT * (BASE_NATURAL_S + STRAIGHT_SQUARE_BONUS) / BASE_NATURAL_S;
function stadiumPerimeter(r) { return 4 * STADIUM_HALF_STRAIGHT + 2 * Math.PI * r; }
// Total length of Q, the LANE-INDEPENDENT loop coordinate stadiumPoint() and
// friends use below (see their comment) -- two straightaways plus a full
// circle's worth of raw angle (the two half-circle caps together).
function qLoopTotal() { return 4 * STADIUM_HALF_STRAIGHT + 2 * Math.PI; }
// Real (x,y) for a lane of radius r at loop-position Q. Unlike a plain
// arc-length parametrization, Q means the same thing for every lane: real arc
// length on the two straightaways (identical length regardless of lane), but
// raw SWEPT ANGLE -- not scaled by radius -- on the two curved end-caps. Two
// different lanes at the same Q therefore sit on the same straight
// cross-section, or on the same radial spoke through the curve, which is
// exactly the property a square grid needs for its column lines to stay aligned
// across lanes (see RULE_CHANGES.md/APP_CHANGES.md) -- and since the same
// angular step covers more real arc length at a bigger radius, outer lanes'
// grid cells naturally stretch wider through a curve rather than needing to
// be forced into it.
function stadiumPoint(cx, cy, r, Q) {
  const straight = 2 * STADIUM_HALF_STRAIGHT, total = qLoopTotal();
  Q = ((Q % total) + total) % total;
  if (Q < straight) return { x: cx + STADIUM_HALF_STRAIGHT - Q, y: cy - r };
  Q -= straight;
  if (Q < Math.PI) {
    const a = -Math.PI / 2 - Q;
    return { x: cx - STADIUM_HALF_STRAIGHT + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  Q -= Math.PI;
  if (Q < straight) return { x: cx - STADIUM_HALF_STRAIGHT + Q, y: cy + r };
  Q -= straight;
  const a = Math.PI / 2 - Q;
  return { x: cx + STADIUM_HALF_STRAIGHT + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
// Tangent direction at Q -- independent of r (mirrors stadiumPoint()'s exact
// segment order): at a shared angular position every concentric lane points
// the same way, and every lane is already parallel on the straights. Chosen
// to be CONTINUOUS (no jump) across each internal segment boundary -- the top
// straight ends at PI and the left cap starts at PI - 0 = PI (not the
// equivalent-but-numerically-different -PI a naive "-PI/2 - Q - PI/2" gives),
// the left cap ends at PI - PI = 0 matching the bottom straight's constant 0,
// and the right cap already starts and stays in the same -Q branch the
// bottom straight's 0 leads into. This matters because circRacerTransform()'s
// rotate(deg) is CSS-transitioned during replay (see APP_CHANGES.md): a jump
// from a value like 180 to its equivalent -180 would interpolate the LONG way
// around (a visible full-turn spin) instead of not moving at all. The one
// remaining jump, at the lap boundary (Q wraps from qLoopTotal back to 0), is
// unavoidable -- turning a bounded angle into an ever-increasing one would
// break at the SAME kind of boundary eventually anyway -- but it only occurs
// once per lap, at the start/finish line, not at every internal transition.
function stadiumTangent(Q) {
  const straight = 2 * STADIUM_HALF_STRAIGHT, total = qLoopTotal();
  Q = ((Q % total) + total) % total;
  if (Q < straight) return Math.PI;
  Q -= straight;
  if (Q < Math.PI) return Math.PI - Q;
  Q -= Math.PI;
  if (Q < straight) return 0;
  Q -= straight;
  return -Q;
}
// Shortest wraparound distance between two squarePos values a and b around a
// lane of circ squares (a lap loops back to 0, so square circ-1 and square 0
// are themselves adjacent).
function circularSquareDist(a, b, circ) {
  const d = Math.abs(a - b) % circ;
  return Math.min(d, circ - d);
}
// House rule (see RULE_CHANGES.md): Racing Maneuvers can target a ship within
// MANEUVER_RANGE_SQUARES squares (same lane or a nearby one), wrapping a lap
// in the same lane. A different lane's position is carried into pA's own
// lane's square units via the exact squarePosToQ()/qToSquarePos() real-arc
// conversions (the same ones the Slip mechanic uses), then compared the same
// way -- this keeps range consistent regardless of curve vs. straight square
// size, rather than assuming every square is the same length.
var MANEUVER_RANGE_SQUARES = 2;
function squaresWithinManeuverRange(geom, pA, pB) {
  const laneA = (pA.lane || 1) - 1, laneB = (pB.lane || 1) - 1;
  if (Math.abs(laneA - laneB) > MANEUVER_RANGE_SQUARES) return false;
  const circA = geom.laneSquares[laneA] || 1;
  if (laneA === laneB) return circularSquareDist(pA.squarePos || 0, pB.squarePos || 0, circA) <= MANEUVER_RANGE_SQUARES;
  const qB = squarePosToQ(geom, laneB, pB.squarePos || 0);
  const equivB = qToSquarePos(geom, laneA, qB);
  return circularSquareDist(pA.squarePos || 0, equivB, circA) <= MANEUVER_RANGE_SQUARES;
}
// Curve/straight split (see RULE_CHANGES.md): lanes carry DIFFERENT total
// cell counts (LANE_SQUARE_INCREMENT apart), used identically for gameplay
// (laneSquaresArray()) and for the decorative tile count drawn below. The
// straight portion's real length is the same for every lane, so it keeps one
// SHARED cell count S across all 6 lanes; the entire per-lane growth is spent
// on the two curves, split evenly between them. S is chosen once so a
// straight cell and lane 1's curve cell come out close to the same length.
function curveSplitForCourse(course) {
  const laneSquares = laneSquaresArray(course); // already includes the +2*STRAIGHT_SQUARE_BONUS total
  // Natural split uses the UNPADDED innerSquares (matching BASE_NATURAL_S's own
  // baseline above) and the frozen BASE_STADIUM_HALF_STRAIGHT, then adds the
  // bonus -- not laneSquares[0]/BASE_STADIUM_HALF_STRAIGHT directly, since
  // those already carry the bonus baked in and would double-count it.
  const naturalS = curveNaturalS(BASE_STADIUM_HALF_STRAIGHT, STADIUM_INNER_R, course.innerSquares || 50);
  const S = naturalS + STRAIGHT_SQUARE_BONUS;
  const curveCounts = laneSquares.map(h => (h - 2 * S) / 2);
  return { S, curveCounts };
}
// Per-lane curve spine angles (0..PI), one array per lane -- EQUALLY spaced
// within that lane (lane 2's 11 curve cells are each exactly 1/11 of the
// curve, not a mix of sizes), independent of any other lane's own division.
// Since lanes now generally have different counts, this does NOT nest the
// way a shared/bisected grid would -- curveCellPoints() below handles the
// resulting non-matching boundaries so tiles still meet with no gap.
function curveSpineSets(course) {
  const { S, curveCounts } = curveSplitForCourse(course);
  const sets = curveCounts.map(count => Array.from({ length: count + 1 }, (_, k) => (k / count) * Math.PI));
  return { S, curveCounts, sets };
}
// The angles at which lane `outerIdx`'s inner edge and lane `innerIdx`'s
// outer edge must both place a vertex, restricted to [a0,a1] -- the union of
// both lanes' own spine angles in that range, sorted and deduped. Since
// lanes are independently and evenly spaced (see curveSpineSets()) neither
// lane's angles are a subset of the other's, so a shared boundary can only
// stay gapless if BOTH sides draw it from this same combined point list
// instead of each using only its own 2 endpoints.
function mergedBoundaryAngles(geom, innerIdx, outerIdx, a0, a1) {
  const eps = 1e-9;
  const merged = [...geom.spineSets[innerIdx], ...geom.spineSets[outerIdx]]
    .filter(a => a > a0 - eps && a < a1 + eps).sort((x, y) => x - y);
  const out = [a0];
  for (const a of merged) if (a - out[out.length - 1] > eps && a1 - a > eps) out.push(a);
  out.push(a1);
  return out;
}
// One STRAIGHT cell's 4 corner points -- a true square, since rowGap ===
// squareSpacing (see circTrackGeometry()). `which` is 0 for the top
// straightaway, 1 for the bottom.
function straightCellPoints(geom, which, row, col) {
  const straight = 2 * STADIUM_HALF_STRAIGHT;
  const base = which === 0 ? 0 : straight + Math.PI;
  const Q0 = base + col * geom.squareSpacing, Q1 = base + (col + 1) * geom.squareSpacing;
  const r = STADIUM_INNER_R + row * geom.rowGap, half = geom.rowGap / 2;
  return [
    stadiumPoint(geom.cx, geom.cy, r - half, Q0),
    stadiumPoint(geom.cx, geom.cy, r - half, Q1),
    stadiumPoint(geom.cx, geom.cy, r + half, Q1),
    stadiumPoint(geom.cx, geom.cy, r + half, Q0),
  ];
}
// One curve cell's corner points for lane laneIdx0, cell k (between that
// lane's own spine angles k and k+1, from curveSpineSets()) -- a "curved
// rectangle" (radial-sector trapezoid), equally sized within its own lane,
// bounded by the two radial spines and the inner/outer radius halfway to
// each neighboring lane -- the SAME half-band width a straight cell uses, so
// straight and curve meet edge-to-edge with no seam at the transition.
// Neither the inner nor outer edge is always just 2 points: since each lane
// is independently and evenly divided (see curveSpineSets()), a neighboring
// lane's spines generally fall at different angles than this lane's own, so
// both edges are drawn from mergedBoundaryAngles() -- the combined point
// list both this lane and its neighbor use for that shared boundary -- so
// they always meet exactly, whichever side has more subdivisions there.
function curveCellPoints(geom, which, laneIdx0, k) {
  const spines = geom.spineSets[laneIdx0];
  const a0 = spines[k], a1 = spines[k + 1];
  const straight = 2 * STADIUM_HALF_STRAIGHT;
  const base = which === 0 ? straight : 2 * straight + Math.PI;
  const r = geom.radii[laneIdx0], half = geom.rowGap / 2;
  const innerAngles = laneIdx0 > 0 ? mergedBoundaryAngles(geom, laneIdx0 - 1, laneIdx0, a0, a1) : [a0, a1];
  const outerAngles = laneIdx0 < geom.spineSets.length - 1 ? mergedBoundaryAngles(geom, laneIdx0, laneIdx0 + 1, a0, a1) : [a0, a1];
  const pts = [];
  for (const a of innerAngles) pts.push(stadiumPoint(geom.cx, geom.cy, r - half, base + a));
  for (let i = outerAngles.length - 1; i >= 0; i--) pts.push(stadiumPoint(geom.cx, geom.cy, r + half, base + outerAngles[i]));
  return pts;
}
// Shared geometry for one course's Circular Track drawing -- computed once and
// reused both by the initial full SVG draw and by later incremental position
// updates (replay), so the two never drift out of sync with each other.
function circTrackGeometry(course) {
  const laneSquares = laneSquaresArray(course); // gameplay cell counts -- also the decorative tile count per lane
  const { S, curveCounts, sets } = curveSpineSets(course);
  const squareSpacing = (2 * STADIUM_HALF_STRAIGHT) / S; // straight cell length
  const rowGap = squareSpacing; // square cells: radial (lane) spacing matches cell length
  const radii = laneSquares.map((_, i) => STADIUM_INNER_R + i * rowGap);
  const outerR = radii[radii.length - 1];
  // Margin needs to clear a cell's own extent past its center, not just the
  // lane radius -- a tile centered exactly at outerR still sticks out another half-cell.
  const margin = rowGap / 2 + 10;
  const vbW = 2 * (STADIUM_HALF_STRAIGHT + outerR + margin), vbH = 2 * (outerR + margin);
  const cx = vbW / 2, cy = vbH / 2; // always exactly centered on this render's own viewBox
  // Icon size is a fraction of a straight square's own side length (curve
  // squares run close to the same size by construction -- see
  // curveSplitForCourse()) -- comfortably smaller than the square itself so
  // the icon fits inside it with a little margin, not overflowing into
  // neighboring squares.
  return { laneSquares, rowGap, squareSpacing, radii, outerR, vbW, vbH, cx, cy, S, curveCounts, spineSets: sets, iconSize: squareSpacing * 0.8 };
}
// Exact real Q for gameplay squarePos N in lane laneIdx0 -- indexes directly
// into the SAME decorative segment structure renderCircularTrackSvg() draws
// (S shared straight squares, then that lane's own curveCounts[] curve
// squares, repeated for the second straight/curve) rather than approximating
// through squarePos's fraction of the lap's AVERAGE square size
// (perimeter(r)/laneSquares[lane]) -- that average generally does NOT match
// the straight's own square width once a lane's curve squares differ enough
// in real size from the straight's, which put ship positions visibly off (by
// a whole square, growing outward) from lane 3 on (see RULE_CHANGES.md/
// APP_CHANGES.md). squarePos is always an integer square index here, so this
// needs no snapping/rounding -- it's exact by construction. Returns the
// square's CENTER (matching straightCellPoints()'s [col*spacing,
// (col+1)*spacing] span and curveCellPoints()'s spine-midpoint span) so a
// racer icon lands centered in its square rather than pinned to its leading
// edge.
function squarePosToQ(geom, laneIdx0, squarePos) {
  const S = geom.S, C = geom.curveCounts[laneIdx0], circ = geom.laneSquares[laneIdx0] || 1;
  const straight = 2 * STADIUM_HALF_STRAIGHT;
  let n = ((squarePos % circ) + circ) % circ;
  if (n < S) return (n + 0.5) * geom.squareSpacing;
  n -= S;
  const spines = geom.spineSets[laneIdx0];
  if (n < C) return straight + (spines[n] + spines[n + 1]) / 2;
  n -= C;
  if (n < S) return straight + Math.PI + (n + 0.5) * geom.squareSpacing;
  n -= S;
  return 2 * straight + Math.PI + (spines[n] + spines[n + 1]) / 2;
}
// The Q of square `squarePos`'s LEADING (forward) edge -- the boundary it
// shares with the next square in its own lane -- as opposed to
// squarePosToQ()'s CENTER. This is the actual corner point a diagonal Slip
// step touches in the adjacent lane (see stepDiagonal()): on the straight,
// every lane shares the exact same grid (same S, same squareSpacing), so a
// square's leading edge and its neighbor's center happen to floor to the
// same destination index there, which is what masked this for so long -- but
// on the curve, where lanes have DIFFERENT subdivision counts (see
// curveSplitForCourse()), a square's own leading-edge boundary and its
// same-lane neighbor's center are NOT the same point, and floor-converting
// the wrong one into the adjacent lane picks a cell that doesn't actually
// touch the origin at all (see RULE_CHANGES.md).
function squareLeadingEdgeQ(geom, laneIdx0, squarePos) {
  const S = geom.S, C = geom.curveCounts[laneIdx0], circ = geom.laneSquares[laneIdx0] || 1;
  const straight = 2 * STADIUM_HALF_STRAIGHT;
  let n = ((squarePos % circ) + circ) % circ;
  if (n < S) return (n + 1) * geom.squareSpacing;
  n -= S;
  const spines = geom.spineSets[laneIdx0];
  if (n < C) return straight + spines[n + 1];
  n -= C;
  if (n < S) return straight + Math.PI + (n + 1) * geom.squareSpacing;
  n -= S;
  return 2 * straight + Math.PI + spines[n + 1];
}
// Exact inverse of squarePosToQ() -- given a real Q, finds which gameplay
// square (integer index) in lane laneIdx0 contains it. Curve cells are
// equally sized within a lane (see curveSpineSets()), so the curve branches
// divide directly by Math.PI/C rather than searching geom.spineSets -- exact,
// same as squarePosToQ(), and NOT the old average-density approximation
// (t/perimeter(r)*laneSquares[lane]) that a Q/t-based Slip conversion used to
// round through, which drifted off by whole squares once a lane's curve
// squares differ enough in real size from the straight's (see
// RULE_CHANGES.md/APP_CHANGES.md).
function qToSquarePos(geom, laneIdx0, Q) {
  const S = geom.S, C = geom.curveCounts[laneIdx0];
  const straight = 2 * STADIUM_HALF_STRAIGHT, total = 2 * straight + 2 * Math.PI;
  Q = ((Q % total) + total) % total;
  if (Q < straight) return Math.min(S - 1, Math.floor(Q / geom.squareSpacing));
  Q -= straight;
  if (Q < Math.PI) return S + Math.min(C - 1, Math.floor(Q / (Math.PI / C)));
  Q -= Math.PI;
  if (Q < straight) return S + C + Math.min(S - 1, Math.floor(Q / geom.squareSpacing));
  Q -= straight;
  return S + C + S + Math.min(C - 1, Math.floor(Q / (Math.PI / C)));
}
// Whether gameplay square N in lane laneIdx0 is a straight square or a curve
// square -- same S/curveCounts[] segment structure as squarePosToQ(), just
// returning a boolean classification instead of a real Q. Used by the
// Circular Track Slip A/D rule (see RULE_CHANGES.md) to walk every square a
// Leg's projected movement passes through.
function isSquareOnStraight(geom, laneIdx0, squarePos) {
  const S = geom.S, C = geom.curveCounts[laneIdx0], circ = geom.laneSquares[laneIdx0] || 1;
  let n = ((squarePos % circ) + circ) % circ;
  if (n < S) return true;
  n -= S;
  if (n < C) return false;
  n -= C;
  return n < S;
}
// One atomic unit of ordinary forward movement, staying in the same lane --
// used by resolveSlipPath() below. Returns the new position and whether a
// lap was completed by this single square (a single square can cross the
// lap boundary at most once).
function stepForward(laneSquaresArr, laneIdx0, squarePos) {
  const circ = laneSquaresArr[laneIdx0];
  const lapGained = squarePos + 1 >= circ ? 1 : 0;
  return { laneIdx0, squarePos: (squarePos + 1) % circ, lapGained };
}
// One atomic unit of Slip movement -- a diagonal, corner-touching step: one
// square forward (in the CURRENT lane's own square-width, same as ordinary
// movement) AND one lane over, at once (see RULE_CHANGES.md). Used by
// resolveSlipPath() below.
function stepDiagonal(geom, laneSquaresArr, laneIdx0, squarePos, dir) {
  const circ = laneSquaresArr[laneIdx0];
  const lapGained = squarePos + 1 >= circ ? 1 : 0;
  const nextLaneIdx0 = laneIdx0 + dir;
  const advancedQ = squareLeadingEdgeQ(geom, laneIdx0, squarePos);
  return { laneIdx0: nextLaneIdx0, squarePos: qToSquarePos(geom, nextLaneIdx0, advancedQ), lapGained };
}
// Real forward Q-distance from fromQ to toQ, wrap-aware -- always the SHORT
// way around the loop, since a single atomic step never covers anywhere
// close to a full lap.
function qAdvance(fromQ, toQ) {
  const total = qLoopTotal();
  return ((toQ - fromQ) % total + total) % total;
}
// House rule (see RULE_CHANGES.md): a Slip's squares are interleaved with
// ordinary forward movement to actually maximize the ship's real distance
// covered this Leg, rather than assuming "all Slip squares first" or "all
// Slip squares last" is always optimal. Adjacent lanes' squares are only
// close to, not exactly, the same real length (see curveSplitForCourse()),
// and a diagonal hop lands on whichever square in the new lane contains the
// target Q -- not necessarily a same-length square -- so which option covers
// more real ground can genuinely go either way depending on how the two
// lanes' grids happen to align right there.
//
// This is a longest-path DP, not a greedy one-step lookahead (a single-step
// "whichever is bigger right now" comparison can lock in a choice that looks
// better immediately but blocks a much better option two steps later --
// reported directly by a replay trail that visibly hugged a curve's inner
// squares instead of the wider, faster arc it could have taken). The state
// at step i is fully described by k = how many of the slipSquares diagonal
// hops have been used so far (the current lane is just originLane + dir*k,
// with no other freedom), so only squarePos and the true best cumulative
// real distance need tracking per (i, k) -- and since Q strictly increases
// with squarePos within a lane, whichever candidate for a given (i, k) has
// covered the most real distance so far is ALSO the one every future step
// (forward or diagonal) does at least as well from, so keeping only that
// max-distance candidate per (i, k) and discarding the rest is lossless: the
// standard "keep the winner, forget the pretenders" DP guarantee. Movement
// and slipSquares are both small (a handful to a few dozen), so this is
// exhaustive-cheap. Deterministic given (origin, movement, Slip squares,
// direction) -- the same inputs recorded in history -- so a replay can
// exactly re-derive the original path rather than approximate it.
function resolveSlipPath(geom, laneSquaresArr, originLaneIdx0, originSquarePos, movement, slipSquares, dir) {
  const maxLaneIdx0 = laneSquaresArr.length - 1;
  // states[k] = the best (max real distance covered) way to have used
  // exactly k diagonal Slip squares after the steps processed so far.
  let states = new Array(slipSquares + 1).fill(null);
  states[0] = { laneIdx0: originLaneIdx0, squarePos: originSquarePos, dist: 0, lapsGained: 0, prev: null, step: null };
  for (let i = 0; i < movement; i++) {
    const next = new Array(slipSquares + 1).fill(null);
    for (let k = 0; k <= Math.min(i, slipSquares); k++) {
      const st = states[k];
      if (!st) continue;
      const curQ = squarePosToQ(geom, st.laneIdx0, st.squarePos);
      const fwd = stepForward(laneSquaresArr, st.laneIdx0, st.squarePos);
      const fwdDist = st.dist + qAdvance(curQ, squarePosToQ(geom, fwd.laneIdx0, fwd.squarePos));
      if (!next[k] || fwdDist > next[k].dist) {
        next[k] = { laneIdx0: fwd.laneIdx0, squarePos: fwd.squarePos, dist: fwdDist, lapsGained: st.lapsGained + fwd.lapGained, prev: st, step: { laneIdx0: fwd.laneIdx0, squarePos: fwd.squarePos, isSlip: false } };
      }
      // Defensive: a Slip should never be able to cross past the outermost
      // or innermost lane (lockDeclarations() clamps for exactly this
      // reason in real play), but this also reconstructs from RECORDED
      // history/declared values, which could in principle be malformed
      // (corrupted save data, a record from some future rule change) --
      // this bounds check just makes that option unavailable rather than
      // indexing off the end of the lane arrays.
      if (k < slipSquares && st.laneIdx0 + dir >= 0 && st.laneIdx0 + dir <= maxLaneIdx0) {
        const diag = stepDiagonal(geom, laneSquaresArr, st.laneIdx0, st.squarePos, dir);
        const diagDist = st.dist + qAdvance(curQ, squarePosToQ(geom, diag.laneIdx0, diag.squarePos));
        if (!next[k + 1] || diagDist > next[k + 1].dist) {
          next[k + 1] = { laneIdx0: diag.laneIdx0, squarePos: diag.squarePos, dist: diagDist, lapsGained: st.lapsGained + diag.lapGained, prev: st, step: { laneIdx0: diag.laneIdx0, squarePos: diag.squarePos, isSlip: true } };
        }
      }
    }
    states = next;
  }
  // Defensive: states[0] is always reachable (the unconditional forward
  // transition keeps it populated every step), but a requested slipSquares
  // that isn't actually achievable within the lane bounds along the way --
  // possible only from malformed/legacy inputs (see the bounds-check comment
  // above), never from a live, freshly-declared Slip -- leaves states[k]
  // null for the unreachable k and every k above it. Gracefully degrade to
  // the largest achievable k instead of crashing, the same way the old
  // implementation silently used fewer diagonal squares than requested
  // rather than erroring out.
  let k = slipSquares;
  while (k > 0 && !states[k]) k--;
  const final = states[k];
  const steps = [];
  for (let cur = final; cur && cur.step; cur = cur.prev) steps.push(cur.step);
  steps.reverse();
  return { steps, finalLaneIdx0: final.laneIdx0, finalSquarePos: final.squarePos, lapsGained: final.lapsGained };
}
// Every intermediate square a racer's <g> should visit while animating
// through each of its Legs (see App.playRaceReplay(), RULE_CHANGES.md/
// APP_CHANGES.md) -- walking square by square instead of one straight-line
// transition from a Leg's start position to its end position, since a
// straight chord cuts across a curve instead of following the track.
// Returns one array of {lane,squarePos} waypoints per Leg.
//
// For a Leg with a recorded slipSquares field, this re-runs the EXACT same
// deterministic algorithm finishLeg() used to resolve it (resolveSlipPath())
// with that Leg's own recorded movement/slipSquares/direction -- a perfect,
// step-for-step reconstruction, since the same inputs always produce the
// same path. If that re-simulation doesn't land exactly on the Leg's
// authoritative recorded (lane, squarePos) -- meaning it was recorded under
// an earlier rule version, where the same inputs would have resolved
// differently (this rule has changed more than once, and old in-progress
// races mix Legs recorded under different versions of it) -- or the record
// predates the slipSquares field entirely (old saved races, still sitting in
// localStorage), it falls back to a diagonal hop per lane crossed FIRST
// (from the origin square, using the same exact stepDiagonal() primitive),
// then however many forward steps are actually needed, in the destination
// lane, to land exactly on the Leg's recorded position -- that forward count
// is DERIVED from the real gap left after the hops, never assumed and then
// force-corrected, so every step is a genuine, valid move and nothing ever
// needs overriding. Either way the reconstruction always lands exactly on
// the Leg's authoritative recorded position with a connected,
// corner-touching path the whole way.
function buildCircularLegWaypoints(p, laneSquares, geom) {
  const h = p.history || [];
  const perLeg = [];
  let fromLane = p.startLane || 1, fromSquarePos = p.startSquarePos || 0, fromLaps = 0;
  for (let L = 0; L < h.length; L++) {
    const rec = h[L];
    const toLane = rec.lane, movement = rec.movement || 0;
    let waypoints = [];
    if (rec.slipSquares !== undefined) {
      const dir = toLane >= fromLane ? 1 : -1;
      const path = resolveSlipPath(geom, laneSquares, fromLane - 1, fromSquarePos, movement, rec.slipSquares, dir);
      if (path.finalLaneIdx0 + 1 === toLane && path.finalSquarePos === rec.squarePos) {
        waypoints = path.steps.map(s => ({ lane: s.laneIdx0 + 1, squarePos: s.squarePos }));
      }
    }
    if (!waypoints.length) {
      if (toLane === fromLane) {
        const circ = laneSquares[fromLane - 1] || 1;
        let cur = fromSquarePos;
        for (let s = 0; s < movement; s++) {
          cur = (cur + 1) % circ;
          waypoints.push({ lane: fromLane, squarePos: cur });
        }
      } else {
        // A Leg recorded under an earlier rule version (this rule has
        // changed more than once today, and old in-progress races mix Legs
        // recorded under different versions of it): walk it DISCRETELY --
        // one diagonal hop per lane crossed FIRST, using the exact same
        // stepDiagonal() primitive resolveSlipPath() itself uses (not a
        // continuous Q interpolation -- see RULE_CHANGES.md for why that
        // used to under/overshoot on the curve), then as many forward steps
        // as needed, IN THE DESTINATION LANE, to land exactly on the Leg's
        // authoritative recorded position. Deliberately not assuming
        // exactly `movement - slipSquares` forward steps and then
        // overriding/snapping the final waypoint if that guess doesn't land
        // right -- that guess isn't even meaningful for a Leg recorded
        // under a genuinely different rule, and forcing a mismatched final
        // waypoint created a visible backward jump right at the end. Instead
        // the forward count is DERIVED from the actual gap left after the
        // hops, so every single step -- including the last -- is a real,
        // valid, corner-touching or same-lane move; nothing is ever forced.
        const numHops = Math.abs(toLane - fromLane);
        const dir = toLane > fromLane ? 1 : -1;
        let laneIdx0 = fromLane - 1, squarePos = fromSquarePos;
        for (let i = 0; i < numHops; i++) {
          const r = stepDiagonal(geom, laneSquares, laneIdx0, squarePos, dir);
          laneIdx0 = r.laneIdx0; squarePos = r.squarePos;
          waypoints.push({ lane: laneIdx0 + 1, squarePos });
        }
        const circTo = laneSquares[laneIdx0];
        const neededForward = ((rec.squarePos - squarePos) % circTo + circTo) % circTo;
        for (let s = 0; s < neededForward; s++) {
          const r = stepForward(laneSquares, laneIdx0, squarePos);
          laneIdx0 = r.laneIdx0; squarePos = r.squarePos;
          waypoints.push({ lane: laneIdx0 + 1, squarePos });
        }
      }
    }
    if (!waypoints.length) waypoints.push({ lane: toLane, squarePos: rec.squarePos });
    perLeg.push(waypoints);
    fromLane = toLane; fromSquarePos = rec.squarePos; fromLaps = rec.laps || 0;
  }
  return perLeg;
}
// One racer's placement on the track for a given (lane, squarePos) snapshot --
// used for both the initial draw and later incremental transform updates, so
// a replay step only has to change this string, not rebuild any markup.
function circRacerTransform(geom, p, prevRotDeg) {
  const laneIdx0 = Math.min(Math.max((p.lane || 1) - 1, 0), geom.radii.length - 1);
  const r = geom.radii[laneIdx0];
  const Q = squarePosToQ(geom, laneIdx0, p.squarePos || 0);
  const { x, y } = stadiumPoint(geom.cx, geom.cy, r, Q);
  // Icon art faces "up" natively (see .boardicon in style.css) -- +90 turns
  // that into the tangent's own 0deg-is-east convention.
  let rotDeg = stadiumTangent(Q) * 180 / Math.PI + 90;
  // If given the racer's CURRENTLY-displayed rotation (see circularSnapshotAt()
  // in App.playRaceReplay()), re-express rotDeg as the equivalent (mod 360)
  // angle closest to it, so a CSS transition between them always animates the
  // short way around -- e.g. 179 -> 181 instead of the numerically-different
  // but visually-identical 179 -> -179, which would spin the long way through
  // 0. stadiumTangent() is already made continuous across every INTERNAL
  // segment boundary (see its own comment); this catches the one remaining
  // jump, once per lap at the start/finish line, plus any other rotation
  // source (e.g. a replay reset) that isn't already guaranteed continuous.
  if (prevRotDeg != null) rotDeg += Math.round((prevRotDeg - rotDeg) / 360) * 360;
  return { laneIdx0, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rotDeg.toFixed(1)})` };
}
/* Circular Track standings view: an oblong (stadium) track, two straightaways
   with a curve on each end, one lane per Division lane. The straight portion
   is tiled with true SQUARES (straightCellPoints()) -- since every lane
   shares the same straight cell count S, adjacent lanes' squares simply share
   an edge with no offset math needed. The curve portion is tiled with "curved
   rectangles" (radial-sector trapezoids, curveCellPoints()) instead, EQUALLY
   sized within each lane -- lane 2's 11 curve cells are each exactly 1/11 of
   that curve, not a mix of sizes (see curveSpineSets()) -- since different
   lanes carry different curve cell counts (see RULE_CHANGES.md/
   APP_CHANGES.md), this means neighboring lanes' radial spines generally
   don't land at the same angles. Gapless tiling is instead guaranteed per
   shared boundary: the edge between lane R and lane R+1 is drawn from
   mergedBoundaryAngles(), the combined set of both lanes' own angles in that
   stretch, so whichever side has more subdivisions there, both sides trace
   the exact same points. Both straight and curve cells use the identical
   half-band radial extent, so they meet edge-to-edge with no seam at the
   transition either. Racer icons snap to the center of whichever cell their
   position falls in (circRacerTransform()/snapQToCell()). Each racer `<g>`
   gets a stable id (`circracer-<id>`) and a CSS transform transition (see
   style.css), the same way the linear board's icons/bars only actually
   animate when something moves their EXISTING DOM node rather than
   recreating it -- see App.playRaceReplay(), which updates these transforms
   directly instead of regenerating this whole SVG every step. */
function renderCircularTrackSvg(race, course) {
  const geom = circTrackGeometry(course);
  const { vbW, vbH, cx, cy, iconSize } = geom;
  let svg = `<svg viewBox="0 0 ${vbW} ${vbH}" class="circtrack" role="img" aria-label="Circular track standings">`;
  for (let row = 0; row < 6; row++) {
    const S = geom.S, C = geom.curveCounts[row];
    [0, 1].forEach(which => {
      for (let col = 0; col < S; col++) {
        // squarePos indexing matches squarePosToQ()'s own scheme (see there)
        // so a replay trail (see App.playRaceReplay()) can find a given
        // (lane, squarePos)'s cell by id.
        const squarePos = which === 0 ? col : S + C + col;
        const pts = straightCellPoints(geom, which, row, col).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
        svg += `<polygon class="circcell" id="circcell-${row}-${squarePos}" points="${pts.join(" ")}"/>`;
      }
    });
    [0, 1].forEach(which => {
      for (let k = 0; k < C; k++) {
        const squarePos = which === 0 ? S + k : 2 * S + C + k;
        const pts = curveCellPoints(geom, which, row, k).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
        svg += `<polygon class="circcell" id="circcell-${row}-${squarePos}" points="${pts.join(" ")}"/>`;
      }
    });
  }
  // Starting line: each lane gets its own mark at its actual staggered
  // starting square (see laneStartSquarePos()/RULE_CHANGES.md), not one straight
  // line across every lane -- outer lanes start further around the first
  // curve, same as a real track's staggered start grid, so a single radial
  // line would only be accurate for lane 1. Drawn at the LEFTMOST side of that
  // square (its leading edge, in the direction of CCW travel) -- squarePos N
  // itself is the square's trailing/right edge, so the leading/left edge is
  // one square further, at N+1. Computed directly against the DECORATIVE
  // straight grid (col*squareSpacing), not by converting squarePos through
  // the gameplay lap fraction (stadiumPerimeter(r)/laneSquares[lane]) like
  // circRacerTransform does elsewhere -- that fraction is only the AVERAGE
  // square size across the whole lap and doesn't exactly match the straight's
  // own square width (straight and curve squares are paced differently per
  // lane -- see curveSplitForCourse()), so it left the tick a hair off the
  // real square boundary. Every starting square is within the shared
  // straight (see laneStartSquarePos()), so indexing the straight grid
  // directly is both exact and simpler.
  geom.radii.forEach((r, laneIdx0) => {
    const col = Math.min(laneStartSquarePos(laneIdx0) + 1, geom.S);
    const Q = col * geom.squareSpacing;
    const pt = stadiumPoint(cx, cy, r, Q);
    const perp = stadiumTangent(Q) + Math.PI / 2;
    const half = geom.rowGap * 0.45;
    const x1 = pt.x + half * Math.cos(perp), y1 = pt.y + half * Math.sin(perp);
    const x2 = pt.x - half * Math.cos(perp), y2 = pt.y - half * Math.sin(perp);
    svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="circfinish"/>`;
  });
  // Icon sized to sit inside a single square with margin to spare (see
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
  const laneSquares = circular ? laneSquaresArray(course) : null;
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
    // finish line (lane 1's own starting line), not raw squares moved --
    // an outer lane's required MOVEMENT is its own lap distance times laps,
    // minus its starting stagger, since the stagger head start is exactly
    // what lets it reach that same physical line at the same time as lane 1
    // despite a longer lane.
    const req = circular ? Math.max(1, course.laps * laneSquares[p.lane - 1] - (p.startSquarePos || 0)) : maxPossible;
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
    const detail = circular ? `${Math.min(p.laps || 0, course.laps)}/${course.laps} laps, Lane ${p.lane}, ${p.cumulative} squares` : `${p.cumulative} pts`;
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
        const slipTag = ps.slip ? ` <span class="tag">Slipped ${ps.slip} ${ps.slipSquares} (${netLabel(ps.slipAdvantage || 0)})</span>` : "";
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
  // can only target a ship within MANEUVER_RANGE_SQUARES squares -- see
  // squaresWithinManeuverRange(). Straight/Legs courses have no squares, so
  // targeting stays unrestricted there.
  const maneuverGeom = course.trackType === "circular" ? circTrackGeometry(course) : null;
  const others = race.participants.filter(x => x.id !== pid && !x.out && (!maneuverGeom || squaresWithinManeuverRange(maneuverGeom, p, x))); // can't target a ship that's out of the race, or (Circular Track) out of range
  const crewIds = [...new Set(POSITIONS.map(pos => ship.assignments[pos]).filter(Boolean))];
  // Circular Track Slip (see RULE_CHANGES.md): a Slip costs no Movement
  // Points, but its magnitude is capped by both how many lanes are
  // physically available in that direction AND the declared Acceleration --
  // a ship can't Slip more squares than its own declared G rate this Leg.
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
        ${ps.slip ? ` <input type="number" min="1" max="${Math.max(1, slipMax)}" value="${Math.min(Math.max(1, ps.slipSquares || 1), Math.max(1, slipMax))}" onchange="App.setDecl('${pid}','slipSquares',this.value)" style="width:56px"> square(s) / ${slipMax} max` : ""}
      </div>
      <p class="muted" style="margin:-4px 0 10px">Your Slip squares are worked in with your ordinary movement wherever it covers the most real ground, not always first or last. Touching a curve anywhere along the way grants +1 Advantage per square outward or -1 Disadvantage per square inward.</p>` : ""}
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
    html += `<p>Rolled ${rc.dice.join(", ")} → chosen ${rc.chosen} + ${disp[phase].finalScore} = <b>${rc.total}</b> vs TN ${tn} → <b>${outcomeLabel(rc)}</b>${phase === "pilot" ? ` (${rc.successCount} success dice)` : ""}</p>`;
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
      const slingshotSquares = Math.min(ps.slipSquares || 0, previewMovement);
      if (slingshotSquares > 0) {
        previewMovement += slingshotSquares;
        rankTotalDisp += ` + Slingshot ${slingshotSquares} (${slingshotSquares} square${slingshotSquares > 1 ? "s" : ""} Slipped inward through the curve) = ${previewMovement}`;
      }
    }
    // The "who won the Leg" framing is Straight -- Legs-specific (points-based
    // standings); on a Circular Track this SAME score becomes movement in
    // squares (see finishLeg()), not a Leg win/loss, so the caveat doesn't apply.
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
    <p><b>Circular — Distance Tracking</b> is an alternate way to run the race: the course has 6 lanes, each 4 squares longer per lap than the one inside it (inner lane defaults to 50 squares), and you set how many laps finish the race. Each Leg, a Hero moves squares equal to their own <b>Leg Ranking Score</b> (Speed Bonus, +1 per Critical Success Level, -1 per Fumble Level) — but a <b>Failed or Fumbled Pilot Task Check halves that Leg's Movement, rounded up</b>, applied before Slip is worked out (stacks with, doesn't replace, the usual -1/level Fumble hit to the Leg Ranking Score itself). NPCs move off the Base Leg Result (the Heroes' average Speed Bonus alone) instead and are never halved. The race has no fixed Leg count — it ends the moment any racer completes the required laps. At the start of the Race every ship rolls <b>Initiative</b> (d20 + its Max Acceleration; NPCs have no Ship Class, so they roll a bare d20) and lanes are assigned in that order, innermost lane to outermost, highest Initiative first — a tie is broken by re-rolling just the tied ships against each other. During Declare Intentions, the Pilot can declare one or more lanes of Slip left (inward) or right (outward); once the Leg's movement is known, the declared Slip squares are worked in with the ordinary forward movement wherever it covers the most real ground for the Leg (not always first or last), at no cost beyond ordinary movement (a Fumble/halving that leaves less movement than declared shrinks the Slip to match). It costs no Advantage/Disadvantage only if the whole Leg (start position through the ship's declared Acceleration worth of movement) stays on a straightaway — touching a curve anywhere along that path grants +1 Advantage per square slipped outward or costs −1 Disadvantage per square slipped inward. An inward Slip that touches a curve <b>also</b> grants <b>+1 bonus Movement per square actually Slipped</b> (Slingshot), on top of ordinary movement, pure free speed for cutting the inside line — this only fires for a Slip actually declared and executed that Leg, not just for sitting in the inside lane. Ships can only Slip into a square that shares a corner or partial side with their current one. If two or more ships end a Leg sharing the same square (<b>Crowded Field</b>), each of their Pilots starts the next Leg with 1 Level of Disadvantage per ship sharing that square (2 ships sharing costs 2 D each, 3 ships costs 3 D each, and so on).</p>

    <h3>5. Race — run it</h3>
    <p>Race Setup filters selectable Ships to the chosen course's Division, and you can add NPC racers alongside your Heroes. Each Leg then walks through, in order:</p>
    <ol>
      <li><b>Declarations</b> — every Ship sets its Acceleration (capped by its Class's Max Thrust, reduced by any active Fumble penalties) and may run one Racing Maneuver per position against a target's same position. On a Circular Track, a Maneuver can only target a ship within 2 squares; straight/Legs courses have no squares, so targeting is unrestricted there.</li>
      <li><b>Phase I (Conditions)</b> — apply per-crewman conditions (Wounded, Under Fire, etc.); each one is Disadvantage on every position that crewman holds. Lock conditions once set so they hold for the whole Leg.</li>
      <li><b>Resistance</b> — every crewman rolls to resist G-forces from the declared Acceleration vs. the Damper Rating; a failed roll costs Disadvantage on that crewman's positions for the rest of the Leg.</li>
      <li><b>Engineer → Spotter → Navigator</b> — each rolls their Task Check and grants Advantage/Disadvantage to a chosen Ship (their own or a rival's); a Critical Success or Fumble can offer a bigger or different choice.</li>
      <li><b>Pilot</b> — rolls last. The Pilot's TN check (Score + accumulated Advantage/Disadvantage) determines pass/fail and Critical/Fumble, but who actually <i>wins</i> the Leg is decided separately: Speed Bonus (= declared Acceleration) plus 1 per Critical Success level, minus 1 per Fumble level.</li>
      <li><b>NPCs</b> auto-roll off the Base Leg Result once every Hero has finished. <b>Standings</b> then shows finishing order for the Leg; a Ship reduced to 0 HP is marked OOC (Out of Commission) and stays frozen at its crash position for the rest of the race.</li>
    </ol>
    <p>On a Circular Track, <b>Show Last Leg</b>/<b>Show Entire Race</b> (above the Standings track) replay each Ship's movement at half speed, dropping a small colored dot at the center of every square it passes through so its path stays visible on the track. Click anywhere to clear the trail.</p>

    <p class="muted">The <b>Reference</b> tab has Division stat tables, the full Racing Maneuvers list, NPC Performance, both Fumble Charts, and Export/Import for your save data. Everything is saved automatically to this browser (localStorage) — use Export JSON on Reference for a backup file you control.</p>
  </section>`;
}
function renderReference() {
  let html = `<div class="grid2">`;
  html += `<section class="card"><h2>Name Generators</h2>
    <div class="row"><button onclick="App.rollRefRaceName()">🎲 Race Name</button><span id="refRaceName" class="tag"></span></div>
    <div class="row"><button onclick="App.rollRefShipName()">🎲 Ship Name</button><span id="refShipName" class="tag"></span></div>
  </section>`;

  html += `<section class="card"><h2>Divisions</h2><table class="mktable">
    <tr><th>Division</th><th>Max Tier</th><th>Common Name</th><th>Max Thrust</th><th>Damper</th><th>Min Crew</th></tr>
    ${GDATA.DIVISIONS.map(d => { const c = GDATA.SHIP_CLASSES[d]; return `<tr><td>${d}</td><td>${c.tier}</td><td>${c.common}</td><td>${c.maxThrust}-G</td><td>${c.damper}-G</td><td>${c.crew || 1}</td></tr>`; }).join("")}
  </table></section>`;

  html += `<section class="card"><h2>Racing Maneuvers</h2>
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

  html += `<section class="card"><h2>Data</h2>
    <p class="muted">Everything is saved automatically to this browser's local storage — closing the tab or the browser is safe. But clearing your browser's cache/site data (or opening the app in a different browser or on a different computer) will erase it, since nothing is uploaded anywhere. Use <b>Export JSON</b> to save a backup file you control, and <b>Import JSON</b> to restore it.</p>
    <div class="row"><button class="ghost" onclick="App.exportData()">Export JSON</button>
    <label class="ghost filebtn">Import JSON<input type="file" accept="application/json" onchange="App.importData(this.files[0])"></label>
    <button class="danger" onclick="App.resetAll()">Reset All Data</button></div>
  </section>`;

  html += `</div>`;
  return html;
}

// Replay path trail (see APP_CHANGES.md): as App.playRaceReplay() steps a
// ship through a Leg, a dot is dropped at the center of each square it
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
function paintReplayTrailDot(geom, laneIdx0, squarePos, color) {
  const svg = document.querySelector(".circtrack");
  if (!svg) return;
  const Q = squarePosToQ(geom, laneIdx0, squarePos);
  const { x, y } = stadiumPoint(geom.cx, geom.cy, geom.radii[laneIdx0], Q);
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", x.toFixed(1));
  dot.setAttribute("cy", y.toFixed(1));
  dot.setAttribute("r", (geom.rowGap * 0.16).toFixed(1));
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
  previewLaneSquares(val) {
    const inner = clampInt(val, 1, 999, 50);
    laneSquaresArray({ lanes: 6, innerSquares: inner }).forEach((h, i) => {
      const cell = document.getElementById(`laneSquareCol${i}`);
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
      const innerSquares = clampInt(document.getElementById("cInnerSquares").value, 1, 999, 50);
      const laps = clampInt(document.getElementById("cLaps").value, 1, 999, 3);
      STATE.courses.push({ id: uid("course"), name, division, trackType, lanes: 6, innerSquares, laps, legMode: mode, legs: [] });
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
    const laneSquares = circular ? laneSquaresArray(course) : null;
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
    const tracks = geom ? race.participants.map(p => ({ p, perLeg: buildCircularLegWaypoints(p, laneSquares, geom) })) : null;
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
        if (!startPos) startPos = { lane: p.startLane || 1, squarePos: p.startSquarePos || 0 };
        const g = document.getElementById(`circracer-${p.id}`);
        if (g) g.setAttribute("transform", circRacerTransform(geom, startPos).transform);
      });
    }
    let leg = fromLeg;
    // Linear-board per-Leg cadence (straight courses); also matches the
    // .boardfill/.boardicon CSS transition (1.2s -- see style.css) so a
    // straight course's next Leg starts the instant the current one finishes,
    // with no idle gap/pause. squareStepDelay is the circular track's
    // per-SQUARE hop cadence -- kept in sync with .circracer's own transition
    // duration (see style.css) for the same no-pause reason, just much
    // shorter since each hop covers one square instead of a whole Leg.
    // Both run at half speed of their original cadence (see APP_CHANGES.md).
    const stepDelay = 1200;
    const squareStepDelay = 200;
    function updateBoardsForLeg(legIdx) {
      race.participants.forEach(p => {
        const h = p.history || [];
        let sum = 0;
        for (let j = 0; j <= legIdx && j < h.length; j++) sum += h[j].movement;
        // Distance Tracking: progress toward the fixed finish line (lane 1's
        // own starting line) -- see renderStandings() for why the starting
        // stagger is subtracted from the required distance.
        const req = circular ? Math.max(1, course.laps * laneSquares[p.lane - 1] - (p.startSquarePos || 0)) : maxPossible;
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
          // square this ship just moved into, in its own color, so each
          // racer's path through the Leg stays visible on the track. Cleared
          // by clicking anywhere.
          paintReplayTrailDot(geom, (point.lane || 1) - 1, point.squarePos || 0, replayTrailColorFor(i));
        });
        sub += 1;
        if (sub < maxSteps) setTimeout(tick, squareStepDelay);
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
        ps.slipSquares = clampInt(ps.slipSquares, 1, Math.max(1, maxLane), ps.slipSquares || 1);
      }
      saveState(); render();
      return;
    } else if (field === "slip") {
      // Circular Track Slip (see RULE_CHANGES.md): changing direction defaults
      // the magnitude to 1 square and re-renders so the magnitude input (and its
      // max, which depends on direction) shows/updates. lockDeclarations()
      // re-clamps the final magnitude authoritatively at lock time.
      ps.slip = val;
      ps.slipSquares = val ? (ps.slipSquares || 1) : 0;
      saveState(); render();
      return;
    } else if (field === "slipSquares") {
      const p = STATE.race.participants.find(x => x.id === pid);
      const course = getCourse(STATE.race.courseId);
      // Capped by both the lanes actually available AND the declared
      // Acceleration (see RULE_CHANGES.md).
      const maxLane = Math.min(ps.slip === "left" ? p.lane - 1 : course.lanes - p.lane, ps.accel);
      ps.slipSquares = clampInt(val, 1, Math.max(1, maxLane), ps.slipSquares || 1);
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
    const others = race.participants.filter(x => x.id !== pid && !x.out && (!geom || squaresWithinManeuverRange(geom, p, x)));
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
