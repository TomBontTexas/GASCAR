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
   mechanical (the Ship Class's construction-point budget, flavor crew size)
   comes from Tier alone. A Ship Class's construction-point budget is simply
   Tier x 10 (see tierBuildPoints() in app.js) -- crew size (flavor only) is
   the one thing still kept in a per-Tier table. */
GDATA.TIERS = {
  1: { crew: 1 },
  2: { crew: 2 },
  3: { crew: 3 },
  4: { crew: 4 }
};

/* ---------- Divisions: flavor name -> Tier + which Leg Feature flavor pool
   (FLASH_LEG_FEATURES vs SPACE_LEG_FEATURES) it draws from. No other
   mechanical effect -- Tier alone drives crew size, build points, and TN. ---------- */
GDATA.DIVISIONS = ["Flash", "Spark", "Comet", "Meteor", "Nova"];
GDATA.DIVISION_TIER = { Flash: 1, Spark: 1, Comet: 2, Meteor: 3, Nova: 4 };
GDATA.DIVISION_ATMOSPHERIC = { Flash: true, Spark: false, Comet: false, Meteor: false, Nova: false };

/* ---------- Ship Class build stats (see RULE_CHANGES.md 2026-10-04) ----------
   A Ship Class carries six mechanical numbers -- Thrust, Hit Points,
   Control, Gunner, Damage, Armor -- bought up on its Division's
   construction-point budget (Tier x 10, see tierBuildPoints() in app.js).
   Every stat (except Damage, see below) starts at its own free baseline
   (GDATA.STAT_BASE) rather than 0 -- a Ship Class that spends nothing is
   still a competent, generic hull. Raising a stat by one point ABOVE its
   baseline costs 1 construction point, the next point costs 2 more (3
   total), the next costs 3 more (6 total), and so on -- see
   mkStepCost()/mkCumulativeCost() in app.js. Thrust is measured in G's.
   Control has no mechanical effect wired in yet -- it exists to be built
   against once a rule hooks into it.

   Damage is special: its baseline is a flat 1D6, not a number. cls.damage
   stores only the BONUS above that die (starting at 0, same cost
   progression as everything else -- +1 costs 1pt, +2 costs 3pt total, +3
   costs 6pt total...), and the actual roll (1D6 + bonus) happens when an
   Attack is resolved (see resolveTurn() in app.js), not baked into a single
   number the way every other stat is. */
GDATA.SHIP_STATS = ["thrust", "points", "control", "gunner", "damage", "armor"];
GDATA.STAT_BASE = { thrust: 3, points: 10, control: 5, gunner: 5, armor: 1 }; // damage has no baseline NUMBER -- see GDATA.DAMAGE_BASE_DIE
GDATA.DAMAGE_BASE_DIE = { n: 1, d: 6 };

/* ---------- Crewmen (Circus Astralis, see RULE_CHANGES.md 2026-10-05) ----------
   Each crewman starts at Pilot-5 and Gunner-5, then receives 5 points to
   divide between the two skills, at one point per increase -- a one-time
   build, no XP, no leveling after creation. A ship's crew shares one Pilot
   and one Gunner value; any additional crew members are flavor only. */
GDATA.CREWMAN_BASE = 5;
GDATA.CREWMAN_SPLIT_POINTS = 5;

/* ---------- Gear table (Circus Astralis) ----------
   Each Leg a ship may shift gear by at most one level (0-5). Movement is the
   listed dice plus the ship's Thrust (gear 0 has no movement at all). The
   modifier is the Task Check modifier applied to that Leg's Control Task
   Check (see RULE_CHANGES.md 2026-10-05): AA = two levels of Advantage,
   A = one, D = one Disadvantage, DD = two. */
GDATA.GEAR_TABLE = {
  0: { dice: 0, mod: null },
  1: { dice: 1, mod: "AA" },
  2: { dice: 2, mod: "A" },
  3: { dice: 3, mod: null },
  4: { dice: 4, mod: "D" },
  5: { dice: 5, mod: "DD" }
};
GDATA.MAX_GEAR = 5;
GDATA.DIE_SIDES = 6; // movement and damage both roll 1D6

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

/* ---------- Fumble Chart (Circus Astralis, see RULE_CHANGES.md 2026-10-05) ----------
   Roll 2D10, once per Fumble (a Control Task Check where both dice fail when
   at Disadvantage counts as one Fumble -- see rollCheck()'s fumbleLevels).
   Low rolls are beneficial, the middle is annoying, high rolls catastrophic.
   Entries are indexed by (roll - 2). `affects` is the structured mechanics
   applied automatically (see applyFumbleAffects() in app.js):
     { type: "hp", tierMult }        -- Tier x tierMult HP, reduced by Armor (min 0).
     { type: "loseHexes", amount }   -- lose this many hexes of this turn's movement; a
                                         NEGATIVE amount is a GAIN of that many bonus hexes.
     { type: "laneShift", dir, forced } -- one lane "in" (toward lane 1) or "out". If the
                                         lane is not available, a forced shift throws the
                                         ship off the track; an unforced one does nothing.
     { type: "gearReset", to }       -- gear becomes `to` (applies from the next Leg).
     { type: "nextLegD", amount }    -- this many levels of Disadvantage on the next Control check.
     { type: "stopped" }             -- this turn's movement ends right now. */
GDATA.FUMBLE_CHART = [
  { roll: 2, text: "Somehow you turn the near-disaster into a thing of beauty—the crowd roars. Gain 5 bonus hexes.", affects: [{ type: "loseHexes", amount: -5 }] },
  { roll: 3, text: "A reckless save that had no business working, works anyway. Gain 4 bonus hexes.", affects: [{ type: "loseHexes", amount: -4 }] },
  { roll: 4, text: "You ride the chaos like you planned it all along. Gain 3 bonus hexes.", affects: [{ type: "loseHexes", amount: -3 }] },
  { roll: 5, text: "A sloppy line turns into a lucky draft. Gain 2 bonus hexes.", affects: [{ type: "loseHexes", amount: -2 }] },
  { roll: 6, text: "Pure luck puts you on the smoothest line on the track. Gain 1 bonus hex.", affects: [{ type: "loseHexes", amount: -1 }] },
  { roll: 7, text: "You catch a bad line and bleed off speed correcting for it. Lose 1 hex.", affects: [{ type: "loseHexes", amount: 1 }] },
  { roll: 8, text: "Pushed 1 hex toward the inside of the track, if available.", affects: [{ type: "laneShift", dir: "in", forced: false }] },
  { roll: 9, text: "Pushed 1 hex toward the outside of the track, if available.", affects: [{ type: "laneShift", dir: "out", forced: false }] },
  { roll: 10, text: "You overcorrect hard and scrub off speed. Lose 2 hexes.", affects: [{ type: "loseHexes", amount: 2 }] },
  { roll: 11, text: "A glancing hit rattles the frame. Tier × 1 HP.", affects: [{ type: "hp", tierMult: 1 }] },
  { roll: 12, text: "A hard wobble costs you ground recovering control. Lose 3 hexes.", affects: [{ type: "loseHexes", amount: 3 }] },
  { roll: 13, text: "A hard knock shoves you toward the inside. Tier × 1 HP + lane shift in.", affects: [{ type: "hp", tierMult: 1 }, { type: "laneShift", dir: "in", forced: true }] },
  { roll: 14, text: "A solid knock sends you well off your line. Tier × 1 HP + lose 2 hexes.", affects: [{ type: "hp", tierMult: 1 }, { type: "loseHexes", amount: 2 }] },
  { roll: 15, text: "A heavy hit rattles the whole frame. Tier × 2 HP.", affects: [{ type: "hp", tierMult: 2 }] },
  { roll: 16, text: "A heavy hit shoves you hard toward the outside. Tier × 2 HP + lane shift out.", affects: [{ type: "hp", tierMult: 2 }, { type: "laneShift", dir: "out", forced: true }] },
  { roll: 17, text: "A heavy hit costs you serious ground while recovering. Tier × 2 HP + lose 3 hexes.", affects: [{ type: "hp", tierMult: 2 }, { type: "loseHexes", amount: 3 }] },
  { roll: 18, text: "Something critical buckles—Drop to Gear-1 next Leg. Tier × 3 HP + gear reset + DD next turn.", affects: [{ type: "hp", tierMult: 3 }, { type: "gearReset", to: 1 }, { type: "nextLegD", amount: 2 }] },
  { roll: 19, text: "A brutal hit sends you reeling toward the inside, bleeding ground. Tier × 3 HP + lose 4 hexes + lane shift in.", affects: [{ type: "hp", tierMult: 3 }, { type: "loseHexes", amount: 4 }, { type: "laneShift", dir: "in", forced: true }] },
  { roll: 20, text: "Total loss of control—a catastrophic hit, drop to Gear-0, and the Leg ends right there. Tier × 4 HP + gear reset + stopped.", affects: [{ type: "hp", tierMult: 4 }, { type: "gearReset", to: 0 }, { type: "stopped" }] }
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
