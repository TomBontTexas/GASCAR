/* GASCAR — static game data.
   Circus Maximus conversion (see RULE_CHANGES.md 2026-10-03): every car is a
   single entity on the track, resolved with a single d20+Advantage/
   Disadvantage roll per Leg on top of a Circus-Maximus-style gear die for
   movement. A Ship is a Ship Class (the hull's mechanical build) plus one
   assigned Crewman (the pilot, who alone has Skill) -- see the Ship Class /
   Crewman sections below and Shipyard/Cantina/Hangar Bay in app.js. Crew
   size beyond that one Crewman is flavor only, sized by Tier. */

const GDATA = {};

/* ---------- Tier table: the one progression axis ----------
   Division (below) is flavor only and just PICKS a Tier -- everything
   mechanical (the Ship Class's build-point budget, flavor crew size) comes
   from Tier alone. buildPoints starts at Circus Maximus's own flat 6 (Tier 1)
   and gains +1 per Tier. */
GDATA.TIERS = {
  1: { crew: 1, buildPoints: 6 },
  2: { crew: 2, buildPoints: 7 },
  3: { crew: 3, buildPoints: 8 },
  4: { crew: 4, buildPoints: 9 }
};

/* ---------- Divisions: flavor name -> Tier + which Leg Feature flavor pool
   (FLASH_LEG_FEATURES vs SPACE_LEG_FEATURES) it draws from. No other
   mechanical effect -- Tier alone drives crew size, build points, and TN. ---------- */
GDATA.DIVISIONS = ["Flash", "Spark", "Comet", "Meteor", "Nova"];
GDATA.DIVISION_TIER = { Flash: 1, Spark: 1, Comet: 2, Meteor: 3, Nova: 4 };
GDATA.DIVISION_ATMOSPHERIC = { Flash: true, Spark: false, Comet: false, Meteor: false, Nova: false };

/* ---------- Ship Class build stats (see RULE_CHANGES.md 2026-10-03: Ship
   Class reintroduced) ----------
   A Ship Class carries five mechanical numbers -- Thrust, Health, Armor,
   Attack, Damage -- bought up from a 0 baseline on its Division's Tier-scaled
   build-point pool (GDATA.TIERS). Every stat uses the SAME triangular cost
   progression: raising a stat from level N to N+1 costs N+1 points (1, then
   2 more, then 3 more...). A stat's current level IS its "Mk" number (e.g.
   "Mk1 Thrust") -- see mkStepCost()/mkCumulativeCost() in app.js. Thrust is
   measured in G's. Damage is a flat number (not a die) -- this conversion
   uses ONE dice system (d20 + Advantage/Disadvantage) everywhere, no
   secondary damage dice. */
GDATA.SHIP_STATS = ["thrust", "health", "armor", "attack", "damage"];

/* ---------- Crewman Skill (see RULE_CHANGES.md 2026-10-03: Skill split off
   the ship onto a Crewman, Cantina tab) ----------
   Every Crewman starts at Skill Mk5 for free. Raising it further uses the
   SAME triangular progression as Ship Class stats (Mk5->Mk6 costs 6, Mk6->Mk7
   costs 7, ...), but spent from the Crewman's own banked XP, not a Tier
   budget -- XP is earned by racing, not bought at creation. See
   GDATA.CREWMAN_XP for how much a race pays out. */
GDATA.CREWMAN_SKILL_BASE = 5;
// Judgment call (see RULE_CHANGES.md) -- easy to retune later. Every Hero
// participant that FINISHES the race (completes the required laps, any
// placement) banks `finish` XP for its assigned Crewman; whoever wins
// (1st place) additionally banks `win` on top of that.
GDATA.CREWMAN_XP = { finish: 1, win: 2 };

/* ---------- Movement Category (GASCAR's own gear table, revised 2026-10-03) ----------
   Shift by at most 1 level per Leg (clamped 0-5, starts at 0). The rolled
   dice (plus the car's own Thrust stat) are that Leg's hex movement --
   rolled unconditionally every Leg, independent of the Skill Check below. */
GDATA.GEAR_DICE = { 0: null, 1: { n: 1, d: 10 }, 2: { n: 2, d: 10 }, 3: { n: 1, d: 20 }, 4: { n: 2, d: 20 }, 5: { n: 3, d: 20 } };
GDATA.MAX_GEAR = 5;
GDATA.HIGH_GEAR_TRIGGER = 4; // gear 4 or 5 is "high gear" -- one of the Skill Check triggers

/* ---------- Ship icon art (webapp/Divisions/Ship Icons/) ----------
   Every Division has its own full 15-number x 4-color set. A Ship Class
   picks one of its Division's 15 White silhouettes (its hull shape); a Ship
   built from that Class picks a Red/Green/Blue color for that SAME number,
   so every Ship built from one Class shares its hull shape but never looks
   identical to another Ship. Icons are unique PER DIVISION, not app-wide --
   the same number/color in a different Division is a different, unrelated
   piece of art. NPCs (no Class of their own) get a random Red/Green/Blue
   number assigned at race start instead. See usedClassIconNumbers()/
   usedShipIconKeys() in app.js. */
GDATA.SHIP_ICON_DIR = "Divisions/Ship Icons/";
GDATA.SHIP_ICON_NUMBERS = ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15"];
GDATA.SHIP_CLASS_ICON_COLOR = "White";
GDATA.SHIP_ICON_COLORS = ["Red", "Green", "Blue"];

/* ---------- Race Name Generator (p.21, 1d10 x3) ---------- */
GDATA.RACE_NAME = {
  die1: ["Iron","Black","Red","Silver","Solar","Outer","Dust","Thunder","Crimson","Ghost"],
  die2: ["Ring","Belt","Drift","Orbit","Run","Pass","Loop","Circuit","Gauntlet","Slingshot"],
  die3: ["Classic","Invitational","Cup","Challenge","Trial","Derby","Race","Grand Prix","Championship","Trophy"]
};

/* ---------- Ship Name Generator (p.15, 1d50 x2) ---------- */
GDATA.SHIP_NAME = {
  left: ["Bad","Black","Blue","Bluebonnet","Brass","Burning","Cactus","Chain","Cold","Coyote",
         "Cutlass","Cutthroat","Dead","Dust","Fast","Fire","Ghost","Grave","Hard","Hell",
         "High","Hot","Iron","King","Little","Longhorn","Lucky","Mean","Needlejack","Night",
         "Prairie","Quickfang","Rattlespur","Razorback","Red","Rio","Silver","Sky","Spinebreaker","Spitfire",
         "Spurfire","Star","Steel","Storm","Switchblade","Thunder","Viperjack","Widowmaker","Wild","Reroll"],
  right: ["Bastard","Bronco","Burner","Colt","Comet","Coyote","Cutter","Dancer","Dart","Devil",
          "Fang","Fury","Ghost","Halo","Horn","Howler","Iron","King","Knife","Lance",
          "Last","Lightning","Longhorn","Luck","Maverick","Medicine","Mercy","Meteor","Mustang","Needle",
          "Prowler","Razor","Reckoner","Rider","Rio","Ripper","Runner","Saddle","Spur","Stallion",
          "Sting","Streak","Strike","Talon","Trouble","Vandal","Viper","Widow","Wrangler","Reroll"]
};
/* Hero name generator (see App.rollHeroName): roll a d100 for the first name and
   another d100 for the last name, from these two independent columns. */
GDATA.HERO_FIRST_NAMES = [
  "Betty","Julie","Barbara","Margaret","Gerald","Tonya","Doris","Donald","Timothy","Janet",
  "Maria","Stephanie","Joyce","Anthony","Patrick","Carol","Benjamin","Robin","David","Brian",
  "Keith","Brenda","Helen","Evelyn","Sharon","Brittany","Karen","Jason","Ralph","Debra",
  "Gary","Jean","Lawrence","Annie","Jack","Amy","Grace","Laura","Thomas","William",
  "Lisa","James","Jeffrey","Alexis","Cheryl","Deborah","Kevin","Shirley","Terry","Nicholas",
  "Kimberly","Bruce","Willie","George","Ruby","Edward","Matthew","Albert","Zachary","Sarah",
  "Henry","Roger","Christian","Mark","Logan","Lillian","Louis","Amanda","Diana","Roy",
  "Bryan","Denise","Megan","Rachel","Mary","Ann","Bobby","Adam","Kenneth","Samantha",
  "Sandra","Wayne","Carl","Noah","Patricia","Jeremy","Jordan","Raymond","Amber","Linda",
  "Gregory","Daniel","Larry","Alan","Paula","Olivia","Carolyn","Robert","Billy","Randy"
];
GDATA.HERO_LAST_NAMES = [
  "Harrison","Stevens","Jimenez","Henderson","Stone","Guzman","Evans","Alexander","Morales","Jordan",
  "Turner","Mitchell","Gray","Morgan","Martin","Diaz","Webb","Rose","Fernandez","Garcia",
  "Thomas","Hamilton","Mendoza","Cook","Phillips","Edwards","Young","Foster","Gomez","Hayes",
  "Tucker","Wells","Ramirez","James","Coleman","Rogers","Davis","Graham","Robinson","Rice",
  "Warren","Gonzalez","Gordon","Shaw","Black","Reynolds","Mason","Myers","Price","Tran",
  "Dixon","Hughes","Burns","Watson","Meyer","Howard","Griffin","Hunt","Powell","Scott",
  "White","Nguyen","Daniels","Perez","Palmer","Nelson","Murray","Sanders","Morris","Baker",
  "Salazar","Vargas","Long","Kelly","Ward","Silva","Castillo","Anderson","Bennett","Adams",
  "Campbell","Hicks","Schmidt","Ramos","Crawford","Herrera","Boyd","Holmes","Marshall","Gonzales",
  "Simpson","Ross","Jones","Porter","Lewis","Hernandez","Green","Richardson","Hill","Lee"
];

/* ---------- Flash Division Leg Feature table (p.22, 1d50) ----------
   Flavor text + a TN modifier, chosen by whichever Division a race's course
   uses for flavor (Flash = atmospheric, everything else = deep-space). Pure
   narration + TN variance -- no other mechanical hook. */
GDATA.FLASH_LEG_FEATURES = [
  ["Canyon wall slalom through narrow rock spires", 2],
  ["Wide open desert sprint across flat terrain", -1],
  ["Low altitude pass over broken basalt fields", 1],
  ["Skimming across a salt flat dust storm", 2],
  ["Checkpoint gate through refinery towers", 1],
  ["Threading abandoned mining rigs", 2],
  ["Long straight canyon corridor", -1],
  ["Climbing turn around a mesa plateau", 1],
  ["High-speed pass through wind turbine farm", 2],
  ["Beacon pass above rolling sand dunes", 0],
  ["Urban skyline corridor between towers", 2],
  ["Checkpoint beneath elevated maglev rails", 1],
  ["Industrial pipe maze fly-through", 2],
  ["Wide river valley drift Leg", -1],
  ["Skimming above dense jungle canopy", 1],
  ["Volcanic field with rising thermal plumes", 2],
  ["Ice field with reflective glare", 1],
  ["Checkpoint through mountain pass", 2],
  ["Rolling hill terrain with blind rises", 1],
  ["Wide open grassland sprint", -2],
  ["Checkpoint above floating ocean platforms", 1],
  ["Island chain zig-zag course", 2],
  ["Coastal cliffside run", 1],
  ["Storm front turbulence", 2],
  ["Calm atmosphere glide segment", -1],
  ["Urban industrial district rooftop pass", 1],
  ["Checkpoint inside construction scaffold", 2],
  ["Broken canyon arch fly-through", 2],
  ["Checkpoint above cargo convoy", 0],
  ["Magnetic interference from heavy industry", 1],
  ["Thick fog bank obscuring terrain", 2],
  ["Dust devil turbulence", 1],
  ["Clear visibility high-speed sprint", -2],
  ["Checkpoint through collapsed bridge structure", 2],
  ["Low pass through narrow canyon shadow", 1],
  ["Strong crosswind over plateau", 2],
  ["Checkpoint over geothermal vent field", 1],
  ["Skimming over shallow ocean waves", 1],
  ["Checkpoint inside a massive quarry pit", 2],
  ["Rockslide debris scattered across course", 2],
  ["Long downhill canyon acceleration", -1],
  ["Tight hairpin around mesa column", 2],
  ["Checkpoint through natural stone arch", 1],
  ["Checkpoint above racing grandstand corridor", 0],
  ["High altitude drift above canyon basin", -1],
  ["Severe storm turbulence", 3],
  ["Checkpoint between two hovering cargo lifters", 2],
  ["Urban night, reduced visibility", 1],
  ["Low cloud layer obscuring terrain", 2],
  ["Perfect clear-air sprint Leg", -2]
];

/* ---------- Spark/Comet/Meteor/Nova Leg Feature table (p.23, 1d50) ---------- */
GDATA.SPACE_LEG_FEATURES = [
  ["Planetary slingshot around a rocky world", 1],
  ["Slingshot around a gas giant", 2],
  ["Slingshot around a moon", 0],
  ["Wide orbital pass around a station beacon", -1],
  ["Beacon flyby inside a debris cluster", 1],
  ["High-speed pass through an asteroid belt corridor", 2],
  ["Close approach to a tumbling asteroid", 1],
  ["Navigation through a dense debris field", 2],
  ["Threading a broken satellite graveyard", 1],
  ["Flyby of a drifting cargo convoy", 0],
  ["Atmospheric skim across a rocky world", 2],
  ["Atmospheric skim across a gas giant cloud deck", 3],
  ["Atmospheric skim through violent storms", 4],
  ["Atmospheric skim across calm upper atmosphere", 1],
  ["Atmospheric skim across an ocean world", 2],
  ["Slingshot through a double-moon gravity well", 3],
  ["Slingshot between binary asteroids", 2],
  ["Gravitational anomaly corridor", 3],
  ["Microgravity turbulence zone", 1],
  ["Stable gravitational channel", -1],
  ["Pass through a planetary ring system", 2],
  ["Ring system with dense ice fragments", 3],
  ["Ring system with wide particle spacing", 0],
  ["Ring system with electromagnetic disturbances", 2],
  ["Ring system slingshot exit gate", 1],
  ["Flyby of a solar research beacon", -1],
  ["Flyby of a mining platform checkpoint", -1],
  ["Flyby of a navigation buoy cluster", 0],
  ["Flyby through a cargo traffic lane", 1],
  ["Flyby through a controlled traffic corridor", -1],
  ["Narrow canyon between two asteroid clusters", 3],
  ["Fast pass along a comet tail", 2],
  ["Crossing through a light dust cloud", 0],
  ["Crossing through ionized plasma haze", 2],
  ["Crossing through solar flare interference", 3],
  ["Navigation through drifting wreckage", 2],
  ["Navigation through abandoned mining equipment", 1],
  ["Navigation through automated defense buoy remnants", 2],
  ["Navigation through drifting ice fragments", 1],
  ["Navigation through metallic debris fragments", 2],
  ["Hard braking checkpoint around a dwarf planet", 2],
  ["Slingshot through a planetary Lagrange point", -1],
  ["Tight orbit around a navigation beacon", 1],
  ["Spiral approach to a station checkpoint", 2],
  ["Long drift Leg ending at a beacon", -2],
  ["Double checkpoint slingshot maneuver", 3],
  ["Slingshot around a rapidly spinning asteroid", 3],
  ["Close pass over a volcanic moon", 2],
  ["Pass through magnetosphere interference", 2],
  ["Clear deep-space sprint between beacons", -2]
];

/* ---------- Racing Maneuvers (Circus Maximus conversion, see RULE_CHANGES.md) ----------
   One Maneuver per car per Leg, car vs. car -- no crew positions left to
   target. Nudge/Block/Ram always land: they deal Disadvantage to the target
   AND trigger that Leg's Skill Check for both cars; the instigator pays its
   own `selfD` in Disadvantage on its own Skill Check regardless of outcome.
   Attack is the odd one out and the only one with its OWN d20+Advantage/
   Disadvantage roll (the car's Attack score vs the Leg's TN, resolved via
   the same rollCheck() as everything else) -- a miss does nothing beyond
   the instigator's selfD; a hit deals the instigator's own Damage stat,
   reduced by the target's Armor, to the target's HP (see
   applyAttackDamage() in app.js). This gives the Attack build stat an
   actual purpose instead of being a dead number on an auto-hit. Uniform for
   a Hero or NPC target -- everyone has HP now, no "NPCs have no HP"
   special case. */
GDATA.MANEUVERS = [
  { name: "Nudge", desc: "A light tap to unsettle the target's line.", selfD: 1, targetD: 1 },
  { name: "Block", desc: "Cut across the target's line, forcing them wide.", selfD: 1, targetD: 2 },
  { name: "Ram", desc: "A hard, deliberate hit to shove the target off its mark.", selfD: 2, targetD: 3 },
  { name: "Attack", desc: "Fire weapons at the target: roll the instigator's own Attack score vs the Leg's TN. A hit deals the instigator's Damage stat (reduced by the target's Armor) to the target's HP; a miss does nothing further. Still costs the instigator Tier Disadvantage either way. Usually illegal.", selfD: "Tier", targetD: null }
];

/* ---------- Out-of-Control Chart (Circus Maximus's stumble chart, converted to
   GASCAR's hex track -- see RULE_CHANGES.md 2026-10-03) ----------
   Rolled 1D10, once per Fumble Level (see rollCheck()'s fumbleLevels) on a
   failed Skill Check -- every roll's effects apply; they stack. One
   universal chart for every car, Tier and Division don't change which chart
   is used (see RULE_CHANGES.md). `affects` is the exact, structured
   mechanics applied automatically (see applyOutOfControlAffects() in
   app.js):
     { type: "hp", tierMult }      -- Tier x tierMult HP damage, reduced by Armor (min 0).
     { type: "loseHexes", amount } -- lose this many hexes of this Leg's own movement (min 0 total).
     { type: "laneShift", dir }    -- pushed 1 lane "in" (toward lane 1) or "out" (toward the highest lane), if room.
     { type: "gearReset" }         -- Movement Category drops to 1 for next Leg.
     { type: "stopped" }           -- this Leg's movement ends right now (0 hexes left to move). */
GDATA.OUT_OF_CONTROL = [
  { text: "Out of control, but you recover -- no ill effect.", affects: [] },
  { text: "Out of control -- you lose ground, falling back a couple hexes.", affects: [{ type: "loseHexes", amount: 2 }] },
  { text: "Out of control -- pushed toward the inside of the track.", affects: [{ type: "laneShift", dir: "in" }] },
  { text: "Out of control -- pushed toward the outside of the track.", affects: [{ type: "laneShift", dir: "out" }] },
  { text: "Out of control -- you lose significant ground this Leg.", affects: [{ type: "loseHexes", amount: 4 }] },
  { text: "Out of control -- a glancing hit rattles the hull.", affects: [{ type: "hp", tierMult: 1 }] },
  { text: "Out of control -- a hard knock, and you're shoved toward the inside.", affects: [{ type: "hp", tierMult: 1 }, { type: "laneShift", dir: "in" }] },
  { text: "Out of control -- a solid hit to the hull.", affects: [{ type: "hp", tierMult: 2 }] },
  { text: "Out of control -- a solid hit, and you lose ground recovering.", affects: [{ type: "hp", tierMult: 2 }, { type: "loseHexes", amount: 3 }] },
  { text: "Skids out completely -- a heavy hit, dropped to first gear, and your Leg ends right there.", affects: [{ type: "hp", tierMult: 3 }, { type: "gearReset" }, { type: "stopped" }] }
];

/* ---------- Preset "house" ships (name + suggested Division), purely flavor for quick-add ---------- */
GDATA.PRESET_SHIPS = [
  { name: "Little Mercy", cls: "Comet" },
  { name: "Iron Sting", cls: "Comet" },
  { name: "Red Needle", cls: "Spark" },
  { name: "Razorback", cls: "Meteor" },
  { name: "Thunder King", cls: "Nova" },
  { name: "Skimmer 99", cls: "Flash" }
];
