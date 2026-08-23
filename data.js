/* GASCAR — static game data transcribed from
   "Warp Space: The Hangar Bay — GASCAR".
   All tables live here so app.js stays pure logic. */

const GDATA = {};

/* ---------- Division / Ship Class table (p.27) + AI stats from each Design block ---------- */
GDATA.SHIP_CLASSES = {
  Flash:  { tier: 1, tonnage: "5 tons", common: "Skimmer", maxThrust: 5,  damper: 2,  crew: 1,
            legDice: { n: 1, d: 5 }, frame: "Super-Light Frame", armor: 0, compartment: "Standard",
            ai: { control: 4, controlAdv: 1, nav: 1, navAdv: 0, sensors: 1, sensorsAdv: 0 } },
  Spark:  { tier: 1, tonnage: "25-ton", common: "Skiff", maxThrust: 11, damper: 6,  crew: 1,
            legDice: { n: 2, d: 5 }, frame: "Super-Light Frame", armor: 3, compartment: "Standard",
            ai: { control: 0, controlAdv: 1, nav: 0, navAdv: 1, sensors: 0, sensorsAdv: 1 } },
  Comet:  { tier: 2, tonnage: "100-ton", common: "Sloop", maxThrust: 14, damper: 9,  crew: 2,
            legDice: { n: 2, d: 10 }, frame: "Super-Light Frame", armor: 2, compartment: "Standard",
            ai: { control: 4, controlAdv: 1, nav: 3, navAdv: 0, sensors: 3, sensorsAdv: 0 } },
  Meteor: { tier: 3, tonnage: "500-ton", common: "Cutter", maxThrust: 17, damper: 12, crew: 2,
            legDice: { n: 3, d: 10 }, frame: "Super-Light Frame", armor: 2, compartment: "Standard",
            ai: { control: 4, controlAdv: 1, nav: 4, navAdv: 1, sensors: 3, sensorsAdv: 0 } },
  Nova:   { tier: 4, tonnage: "2,000-ton", common: "Clipper", maxThrust: 18, damper: 15, crew: 3,
            legDice: { n: 4, d: 10 }, frame: "Super-Light Frame", armor: 2, compartment: "Reinforced Compartmentalization",
            ai: { control: 5, controlAdv: 1, nav: 4, navAdv: 1, sensors: 2, sensorsAdv: 1 } }
};
GDATA.DIVISIONS = ["Flash", "Spark", "Comet", "Meteor", "Nova"];

/* ---------- Determine Number of Legs (by race Type, not Division) ----------
   Drag Race = 1 Leg flat; the rest roll dice and sum. Leg count is independent
   of Division now -- a Medium race is 2d10 Legs whether it's Flash or Nova. */
GDATA.RACE_TYPES = [
  { name: "Drag Race", dice: { n: 1, d: 1 }, label: "1 Leg" },        // always 1
  { name: "Short",     dice: { n: 2, d: 5 },  label: "2d5 Legs" },
  { name: "Medium",    dice: { n: 2, d: 10 }, label: "2d10 Legs" },
  { name: "Long",      dice: { n: 2, d: 20 }, label: "2d20 Legs" }
];

/* ---------- Ship icon art (webapp/Divisions/Ship Icons/) ----------
   Only the Spark set exists so far (15 numbered hull silhouettes). White is
   reserved for Ship Classes (the "master" icon shown in the Shipyard); Red/
   Green/Blue are for individual Ships built from a Class, so two ships never
   look identical on the board. Each icon is unique app-wide once assigned --
   see App.updateShipClassIcon()/App.updateShipIcon() in app.js. */
GDATA.SHIP_ICON_DIR = "Divisions/Ship Icons/";
GDATA.SHIP_ICON_NUMBERS = ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15"];
GDATA.SHIP_CLASS_ICON_COLOR = "White";
GDATA.SHIP_ICON_COLORS = ["Red", "Green", "Blue"];

/* House rule (see RULE_CHANGES.md): each Division hard-caps a custom Ship
   Class's total build (Max Thrust + Ship AI + hull), set to that Division's own
   preset total under the current cost curves -- i.e. the preset itself sits right
   at its Division's cap with no headroom to spare. Flash also has a separate
   physical 5-G Max Thrust ceiling (see maxThrustCap() in app.js). */
GDATA.DIVISION_CAPS = {
  Flash:  { maxPoints: 20 },
  Spark:  { maxPoints: 30 },
  Comet:  { maxPoints: 40 },
  Meteor: { maxPoints: 50 },
  Nova:   { maxPoints: 60 }
};

/* ---------- Hull: Hit Points (Frame Strength) and Damage Reduction (Armor / Compartmentalization) ----------
   Hit Points default to Tier x3; Damage Reduction defaults to 0. costFactor is
   multiplied by Tier for the point cost (negative = refund). hpOp/multiplier
   describe how the option modifies the base value -- see computeHitPoints()/
   computeDamageReduction() in app.js. */
GDATA.FRAME_STRENGTH = [
  { name: "Standard", costFactor: 0, hpOp: null },
  { name: "Super-Light Frame", costFactor: -2, hpOp: "div4" },
  { name: "Light Frame", costFactor: -1, hpOp: "div2" },
  { name: "Heavy Frame", costFactor: 1, hpOp: "mul2" },
  { name: "Super-Heavy Frame", costFactor: 2, hpOp: "mul4" }
];
GDATA.COMPARTMENTALIZATION = [
  { name: "Standard", costFactor: 0, multiplier: 1 },
  { name: "Reinforced Compartmentalization", costFactor: 1, multiplier: 2 },
  { name: "Total Compartmentalization", costFactor: 2, multiplier: 3 },
  { name: "Fortress Compartmentalization", costFactor: 3, multiplier: 4 }
];

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

/* ---------- Flash Division Leg Feature table (p.22, 1d50) ---------- */
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

/* ---------- Racing Maneuvers (p.31) ----------
   The Pilot always instigates a Maneuver, but each one now targets a specific
   crew POSITION on the victim (see RULE_CHANGES.md). Against a HERO target the
   Disadvantage lands on that position's Task Check; against an NPC (which has no
   per-position rolls) it just applies to the NPC's single roll as normal. One
   Maneuver per position at each Disadvantage level 1/2/3, plus Attack (special,
   Tier levels, targets Pilot). */
GDATA.MANEUVERS = [
  { name: "Rub", desc: "A light nudge to unsettle the target without compromising position.", position: "pilot", disadv: 1 },
  { name: "Force Wide", desc: "Push the target off the optimal racing line.", position: "pilot", disadv: 2 },
  { name: "Spin Attempt", desc: "Attempt to destabilize the target completely.", position: "pilot", disadv: 3 },
  { name: "Tail Wag", desc: "Wag the vehicle's stern to interfere with the target's course corrections.", position: "navigator", disadv: 1 },
  { name: "Cross Wake", desc: "Cut across the target's plotted line, forcing a mid-Leg replot.", position: "navigator", disadv: 2 },
  { name: "Brake Check", desc: "Sudden deceleration to disrupt the target's spacing and reaction time.", position: "navigator", disadv: 3 },
  { name: "Dirty Air", desc: "Disrupt the airflow and sensor clarity of a trailing ship.", position: "spotter", disadv: 1 },
  { name: "Sensor Ghost", desc: "Spoof a phantom contact, splitting the target's sensor attention.", position: "spotter", disadv: 2 },
  { name: "Sensor Blind", desc: "Flood the target's sensors, washing out their read of the course ahead.", position: "spotter", disadv: 3 },
  { name: "Bump", desc: "A firm hit that forces a reactor power drop.", position: "engineer", disadv: 1 },
  { name: "Side Draft", desc: "Override the target's Damper correction to steal momentum and destabilize it.", position: "engineer", disadv: 2 },
  { name: "Slam", desc: "Heavy contact intended to significantly disrupt performance.", position: "engineer", disadv: 3 },
  { name: "Attack", desc: "Fire ship weapons at opponent. Usually illegal.", position: "pilot", disadv: "Tier" }
];

/* ---------- NPC Performance table (p.35, 1d6) ---------- */
GDATA.NPC_PERFORMANCE = [
  { roll: 1, name: "Scramble", desc: "Something goes wrong: poor approach, traffic, or system hiccup.", mod: -3 },
  { roll: 2, name: "Unstable", desc: "The ship struggles to hold a clean line, making constant corrections.", mod: -2 },
  { roll: 3, name: "Steady Pace", desc: "Controlled and conservative.", mod: -1 },
  { roll: 4, name: "Clean Run", desc: "Efficient and precise execution.", mod: 0 },
  { roll: 5, name: "Overdriven", desc: "Pushed hard, uneven performance.", mod: 1 },
  { roll: 6, name: "Aggressive Push", desc: "Right on the edge, strong gains.", mod: 2 }
];

/* ---------- Crew Task Check Modifications (p.32) ---------- */
GDATA.CONDITIONS = [
  { name: "Drugged / Dazed / Stunned", who: "All" },
  { name: "Low Visibility", who: "Driver" },
  { name: "Under Fire", who: "All" },
  { name: "Vehicle Damaged (per Major/Catastrophic Hit)", who: "All" },
  { name: "Wounded", who: "All" }
];

/* ---------- Maneuver Fumble Charts (p.38, updated) ----------
   Rolled 1D10 on a Pilot Fumble. Each entry's `affects` array is the exact,
   structured game mechanics the app applies automatically (see RULE_CHANGES.md
   and rollFumble()/applyFumbleAffects() in app.js). Affect types:
     { type: "disadvantage", position, levels, legs }
         -- position gets `levels` Levels of Disadvantage for the next `legs` Legs.
     { type: "hp", tierMult }
         -- ship takes (Tier x tierMult) HP damage, reduced by its DR (min 0).
            If HP hits 0 the ship is out of the race.
     { type: "accel", mode: "reduce"|"set", value }
         -- "reduce": lower the ship's max thrust by `value` for the rest of the
            race (cumulative). "set": cap the ship's max thrust at `value` for the
            rest of the race.
     { type: "last", legs }
         -- ship is forced to finish LAST for `legs` Legs (this Leg + next legs-1);
            it still plays its phases, its result is just floored to last place.
   The `affects` column on the printed chart is authoritative over the flavor
   text where they differ. */
GDATA.FLASH_FUMBLES = [
  { text: "The Driver is not paying attention. The vessel vaults into 2-1/2 inward somersaults. It would have probably landed upright, but it tried to add in a tuck at the last moment. Out for the remainder of the race.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 2, legs: 3 }, { type: "hp", tierMult: 3 }, { type: "last", legs: 3 } ] },
  { text: "Your overcorrection causes a harsh swerve that rolls the vehicle once. It's dead in the water or on the side of the road. Engineer can restart it, but he's at two Levels of Disadvantage for the next two Legs. The vehicle comes in last this Leg.",
    affects: [ { type: "disadvantage", position: "engineer", levels: 2, legs: 2 }, { type: "hp", tierMult: 2 }, { type: "last", legs: 1 } ] },
  { text: "You push the vehicle too hard. The transmission will eat itself if you Accelerate past the Damper Rating. Engineer is shook up and at one Level of Disadvantage for the next two Legs. The ship takes Tier x 2 HP.",
    affects: [ { type: "disadvantage", position: "engineer", levels: 1, legs: 2 }, { type: "hp", tierMult: 2 }, { type: "accel", mode: "set", value: 2 } ] },
  { text: "That mud puddle/swell was deeper than you thought. The vehicle jerks sharply, putting undue stress on all its systems. Pilot takes one Level of Disadvantage on the next Leg. The vehicle takes Tier x 2 HP.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 2 }, { type: "hp", tierMult: 2 } ] },
  { text: "Your reckless maneuvering causes a brief loss of control, leading to a wild, uncontrolled ride. It ends without a crash but leaves everyone's heart racing. Engineer is at one Level of Disadvantage on the next Leg.",
    affects: [ { type: "disadvantage", position: "engineer", levels: 1, legs: 1 } ] },
  { text: "Where did you learn to drive? Everyone close to you puts as much distance between you and themselves as possible. Vehicle takes Tier x 2 HP.",
    affects: [ { type: "hp", tierMult: 2 } ] },
  { text: "Your harsh maneuvers stress the vessel's frame, causing minor structural strain. Vehicle takes Tier HP.",
    affects: [ { type: "hp", tierMult: 1 } ] },
  { text: "Did you learn to drive from a correspondence course? Pilot takes one Level of Disadvantage for the next two Legs.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 2 } ] },
  { text: "Your erratic driving nearly causes a major accident. You manage to avoid a collision by inches, leaving bystanders shaken and the vehicle scratched and dented. It was captured on video; news at 11. Pilot takes one level of Disadvantage for the next Leg while he grows accustomed to the slight pull to the left...",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 1 } ] },
  { text: "Slow down, Scooter! You took that last turn a bit too tight, resulting in a minor scrape or bump. It's more embarrassing than harmful.",
    affects: [] }
];
GDATA.SPACEFLIGHT_FUMBLES = [
  { text: "Patience, Grasshopper. You engage the thrusters before feeding the course to the computer, causing the ship to hurtle off in a random direction at full Acceleration. All crewmembers are at two Levels of Disadvantage for the next Leg as they try to gets things back under control. Needless to say, the ship comes in last this Leg.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 2, legs: 1 }, { type: "disadvantage", position: "navigator", levels: 2, legs: 1 }, { type: "disadvantage", position: "spotter", levels: 2, legs: 1 }, { type: "disadvantage", position: "engineer", levels: 2, legs: 1 }, { type: "last", legs: 1 } ] },
  { text: "Incoming! You almost didn't see that asteroid! Spotter is at two Levels of Disadvantage for the next two Legs as he regains his composure. Ship takes Tier x 2 HP, and comes in last place this Leg.",
    affects: [ { type: "disadvantage", position: "spotter", levels: 2, legs: 2 }, { type: "hp", tierMult: 2 }, { type: "last", legs: 1 } ] },
  { text: "In a bid to save time and energy, you attempt a last minute slingshot maneuver. Clearly, you missed the lesson in Pilot school where you're supposed to reverse inertial dampers for half the run; they remind you with smoke signals. Navigator is at one Level of Disadvantage for two Legs as he works to correct the upcoming plots. Ship takes Tier x 2 HP, and Acceleration is reduced by 1-G for the remainder of the Race.",
    affects: [ { type: "disadvantage", position: "navigator", levels: 1, legs: 2 }, { type: "hp", tierMult: 2 }, { type: "accel", mode: "reduce", value: 1 } ] },
  { text: "You forgot to release the parking brake. Inertial dampers scream as you drag them through spacetime. Pilot is at one Level of Disadvantage for the next two Legs as the the Engineer adds his screams over the intercom. Ship takes Tier x 2 HP.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 2 }, { type: "hp", tierMult: 2 } ] },
  { text: "You push the ship's gyroscopes beyond their limits, causing a loss of spatial orientation. Engineer is at one Level of Disadvantage for the next Leg while he recalibrates.",
    affects: [ { type: "disadvantage", position: "engineer", levels: 1, legs: 1 } ] },
  { text: "Piloting in 3-D is a ballet, not parkour. The Pilot overcorrects, sending the vessel at full speed towards the nearest structure or ship. The vessel takes Tier x 2 HP before the pilot gets things back under control.",
    affects: [ { type: "hp", tierMult: 2 } ] },
  { text: "You're gaining confidence but still manage to bump into something (station's docking arm, etc.). Superficial damage plus Tier HP.",
    affects: [ { type: "hp", tierMult: 1 } ] },
  { text: "In a sloth-like manner, your plotted course takes you through a planetary ring, an asteroid belt, or a well-documented meteor storm. Pilot is at one Level of Disadvantage for the next two Legs.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 2 } ] },
  { text: "Poor takeoff/landing/docking damages the landing gear/docking clamps. If cruising, it's the gravitics, attitude jets, or control surfaces. Pilot is at one Level of Disadvantage for the next Leg.",
    affects: [ { type: "disadvantage", position: "pilot", levels: 1, legs: 1 } ] },
  { text: "Bad tacos from the night before rumble around in your stomach and leave particularly pungent odors on the bridge.",
    affects: [] }
];

/* ---------- Archetype Abilities (p.15) ---------- */
GDATA.ARCHETYPE_ABILITIES = [
  { name: "Shipmate", cost: 10, prereq: "None", desc: "Has experience working aboard spaceships. Operates without Disadvantage in generic spaceborne operations." },
  { name: "Racer", cost: 5, prereq: "Shipmate", desc: "Can work under the brutal acceleration and constant maneuvering of racing vessels. Gains Advantage on Uncompensated G-Force Resistance Task Checks." },
  { name: "Race Driver", cost: 10, prereq: "None", desc: "Gains Advantage on Drive Task Checks made during high-speed maneuvering in groundcraft, including anti-gravity surfacecraft." },
  { name: "Race Pilot", cost: 10, prereq: "Shipmate", desc: "Gains Advantage on Pilot Task Checks made during high-speed maneuvering: slingshot passes, atmospheric skimming, and other maneuvers." },
  { name: "Race Navigator", cost: 10, prereq: "Shipmate", desc: "Gains Advantage on Navigator Task Checks made to plot race legs, gravitational slingshots, checkpoint approaches, and other course calculations." },
  { name: "Race Spotter", cost: 10, prereq: "Shipmate", desc: "Gains Advantage on Spotter Task Checks when using sensors to detect navigational dangers such as debris, gravitational anomalies, and traffic." },
  { name: "Race Engineer", cost: 10, prereq: "Shipmate", desc: "Gains Advantage on Engineer Task Checks related to the engines, reactor, or hull." },
  { name: "Ace Racer", cost: 10, prereq: "Racer, Race Pilot | Race Navigator", desc: "Recognized as an elite competitor in one racing division. Once per race, may specify what all dice roll on one Task Check." }
];

/* ---------- Preset crew from "Stars of the Show" (p.16-20) ---------- */
GDATA.PRESET_CREW = [
  { name: "Calder Canetti", pilot: { score: 10, adv: 1 }, navigator: { score: 10, adv: 0 }, spotter: { score: 3, adv: 0 }, engineer: { score: 3, adv: 0 }, resistance: { score: 0, adv: 0 } },
  { name: "Zera Nivak", pilot: { score: 9, adv: 1 }, navigator: { score: 8, adv: 0 }, spotter: { score: 5, adv: 0 }, engineer: { score: 8, adv: 0 }, resistance: { score: 3, adv: 1 } },
  { name: "Raxen Vhal", pilot: { score: 12, adv: 1 }, navigator: { score: 9, adv: 0 }, spotter: { score: 5, adv: 0 }, engineer: { score: 7, adv: 0 }, resistance: { score: 7, adv: 1 } },
  { name: "Loren Cade", pilot: { score: 5, adv: 0 }, navigator: { score: 6, adv: 0 }, spotter: { score: 10, adv: 1 }, engineer: { score: 9, adv: 1 }, resistance: { score: 7, adv: 0 } },
  { name: "Nikhail \"Chief\" Kuznetsov", pilot: { score: 4, adv: 0 }, navigator: { score: 3, adv: 0 }, spotter: { score: 9, adv: 0 }, engineer: { score: 10, adv: 2 }, resistance: { score: 5, adv: 1 } }
];

/* ---------- Preset "house" ships (name + suggested class), purely flavor for quick-add ---------- */
GDATA.PRESET_SHIPS = [
  { name: "Little Mercy", cls: "Comet" },
  { name: "Iron Sting", cls: "Comet" },
  { name: "Red Needle", cls: "Spark" },
  { name: "Razorback", cls: "Meteor" },
  { name: "Thunder King", cls: "Nova" },
  { name: "Skimmer 99", cls: "Flash" }
];
