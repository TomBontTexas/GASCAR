# GASCAR — Rule Changes

This file tracks every place this app's **game rules** have changed from an
earlier printed or documented version of *Warp Space: GASCAR* — revised
numbers, new mechanics, or automation of a rule the app resolves for you.
If a Racemaster ran this race by hand from an older printed copy instead of
using the app, this is the list of things they'd need to do differently.

This file does **not** cover app features, UI, architecture, or bug fixes —
those belong in `APP_CHANGES.md`. The test: does this entry change something
a player or Racemaster needs to know to run/play the race correctly (dice,
TNs, costs, requirements, who does what when)? If yes, it's here. If it's
about how the software is built, organized, or displays things, it's not.

Newest entries at the top. Each entry notes the earlier value (where
applicable), the current value in use, and where it lives in the code.

---

### 2026-08-24 — Circular Track rebuilt on a real hex grid (supersedes the entire square-grid system below, from "each square of Slip..." (2026-08-19) through "10 extra squares added..." (2026-08-19))
- **Why:** an earlier attempt at a hex-based track (evidence still visible as
  the `hexPos`/`innerHexes` field names this migration reintroduces) had
  lane-to-lane edges that didn't line up and was abandoned in favor of
  squares. Tracing the actual cause: every curve cell in the square system
  was built by independently, evenly dividing each lane's own arc into
  equal-angle slices — a shape flexible enough to seamlessly tile a circle
  regardless of a neighboring lane's own cell count. A true regular hexagon
  can't flex that way (fixed 60°/120° angles, equal sides), so no spacing
  number could have fixed it — the technique itself was incompatible with
  real hexagons. The fix: a genuine axial hex grid, built with discrete
  hex-ring math instead of continuous angle division, where adjacent lanes
  nest perfectly by mathematical construction, not by approximation.
- **Track shape:** 6 lanes, each a hex ring at ring-level `innerRing+laneIndex`
  around a shared center, walked leg-by-leg (2 elongated "straight" legs plus
  4 curved end-cap legs per ring, the standard 6-leg hex-ring walk) — each
  lane's straight-leg length is itself ring-level-dependent
  (`ringLevel + straightLen`, not a fixed constant shared by every lane),
  which turned out to be required: an earlier version of this fix tried a
  truly fixed straightaway length shared by every lane, and it broke lane
  nesting (adjacent lanes' hex rings no longer lined up edge-to-edge), so it
  was reverted. Every lane gains **exactly 6 hexes per lap** over the one
  inside it — an exact property of hex-ring math (the +1 ring-level step
  applied across all 6 legs of the ring), the same +6 the old square system
  used. The course's configurable "inner lane size" (now `innerHexes`,
  replacing `innerSquares`) is a target the hex-ring parameters are derived
  from, not an exact count.
- **Slip still maximizes real ground covered — the distance metric changed,
  not the goal:** on the old square grid, curve/straight/lane cells were all
  different real sizes, so the longest-path DP compared cumulative real arc
  length. On a true hex grid every individual hex-step covers identical real
  distance (a genuinely hexagon-only property) — but WHICH hex a "forward"
  step reaches still depends on the current lane, so different interleavings
  of forward-vs-diagonal steps land on genuinely different FINAL hexes, some
  further along the track than others. (An earlier version of this entry
  claimed hex uniformity meant nothing was left to optimize and shipped a
  fixed "Slip first" rule — that was wrong, caught and corrected the same
  day before ever being played on: uniform step length does not imply
  uniform final position.) The DP still runs, comparing candidates by the
  real structural progress each one contributes — completed legs plus
  fraction through the current leg (straight or curve), the same measure
  used to keep a Slip from ever landing on the ring's own seam-adjacent
  wrap artifact. Both forward and Slip steps are scored the same way, so a
  Slip through a curve is judged correctly too: a curve leg's hex count
  scales with the lane's own ring level directly, unlike a straight, so
  raw hex-index numbers alone are NOT a safe stand-in for real progress
  there — an earlier version of this fix that scored by raw index instead
  undervalued (sometimes by a lot) exactly the "hug the inside line through
  the turn" move that should pay off, caught by a user who'd worked out by
  hand that it should gain real ground, not lose it. Picking whichever
  candidate actually gains the most ground at every step is what makes the
  DP worth running at all. Also supersedes the "square that shares a
  corner" adjacency rule (2026-08-19 below): a Slip now simply moves to an
  edge-adjacent hex in the neighboring lane, the natural hex equivalent, no
  corner-touching special case needed.
- **Unchanged in substance, only in unit:** the curve-touch Advantage/
  Disadvantage and Slingshot bonus (+1 Advantage per hex slipped outward,
  −1 Disadvantage per hex slipped inward; Slingshot's +1 bonus Movement per
  hex for an inward Slip touching a curve), Crowded Field (1 D per ship
  sharing an ending hex, scaling with pileup size), the 6-hex-per-lane
  staggered start, and the Pilot Fail/Fumble Movement-halving all still work
  exactly as before — only the grid they run on changed, from squares to
  hexes. Racing Maneuver range is still 2 (now hexes, via real hex distance
  — cube coordinates — instead of the old same-lane Q-conversion workaround).
- **Breaking change:** any Circular Track course and any race in progress on
  one is cleared on upgrade — old square-grid positions don't correspond to
  anything meaningful under hex rules. Straight/Legs courses and races are
  untouched. See `migrateState()`'s `_circularTrackHexed` flag in `app.js`.
- **Where:** `app.js` — the entire Circular Track geometry block
  (`traceLaneRing()`, `circTrackGeometry()`, `hexToPixel()`/`hexCorners()`,
  `renderCircularTrackSvg()`, `circRacerTransform()`), movement
  (`stepForward()`, `resolveSlipPath()`, `buildCircularLegWaypoints()`),
  `hexesWithinManeuverRange()`, `laneHexesArray()`/`laneStartHexPos()`,
  `finishLeg()`'s circular branch, and the Declare modal's Slip UI. Every
  `squarePos`/`slipSquares`/`innerSquares` field is now `hexPos`/`slipHexes`/
  `innerHexes`.

### 2026-08-21 — House rule: the Base Leg Result (shared NPC baseline) now averages Speed Bonus alone, not the full Leg Ranking Score
- **Changed value — and a correction of an earlier same-day misread of this
  request.** There are two distinct scores in play, and only one of them
  changed:
  - **Leg Ranking Score** — each Hero's OWN score (Speed Bonus, +1 per
    Critical Success Level, -1 per Fumble Level). This determines who wins
    the Leg on a straight course, AND is that Hero's own Movement on a
    Circular Track. **Unchanged** — still exactly as it always was.
  - **Base Leg Result** (`ls.baseLegResult`, computed in
    `computeBaseLegResult()`) — a single shared value, averaged across all
    (non-forced-last) Heroes, used only as the baseline NPC Performance
    rolls add their mod to. This average now uses **Speed Bonus alone**,
    not each Hero's full (Crit/Fumble-adjusted) Leg Ranking Score — so one
    Hero's lucky Critical Success or unlucky Fumble no longer skews the
    baseline every NPC's roll is built on.
- An earlier version of this entry (since corrected) mistakenly applied
  this to the Leg Ranking Score itself, which the user did NOT ask for —
  the Leg Ranking Score, and therefore every Hero's own Movement, Crit
  Bonus, and Fumble Penalty, are untouched by this change.
- Lives in `computeBaseLegResult()` in `app.js`: the averaged array now
  maps `ps.results.pilot.speedBonus` instead of `.rankTotal`.

---

### 2026-08-21 — Slingshot: an active inward Slip through a curve grants bonus Movement
- **New rule (not in an earlier printed version):** the curve at each end of
  a Circular Track represents a slingshot around a high-gravity body. A
  ship that declares an **inward** Slip ("left") whose path actually
  **touches a curve** this Leg gets **+1 bonus MP per square it actually
  Slipped** — pure extra forward movement on top of its ordinary Movement,
  not an extra Slip square. An outward Slip, or an inward Slip that stays
  entirely within a straightaway, gets nothing.
- **Gated on the ACTIVE maneuver, not on lane position.** The bonus only
  fires for a Slip actually declared and executed this Leg — a ship that is
  already sitting in the inside lane (from a previous Leg, or from never
  having moved) gets no bonus just for being there. This was a deliberate
  fix for the inside lane otherwise having no real risk/reward tension: it
  was already the shortest lap distance with no downside, and stacking a
  passive speed bonus on top of that left no reason to ever leave it.
- **Bonus magnitude follows the ACTUAL squares Slipped**, not the
  originally declared amount — if a Pilot Fail/Fumble's Movement-halving
  (see the entry below) or a lane-room/Accel clamp shrinks the Slip below
  what was declared, the bonus shrinks with it.
- The curve-touch signal reuses the existing `ps.slipAdvantage` sign from
  `lockDeclarations()` — negative only for an inward Slip that touches a
  curve — so no separate geometry check was needed.
- NPCs never receive this bonus (no Slip declaration exists for them), and
  it has no effect on straight (Legs/points) courses.
- Lives in `finishLeg()` in `app.js`, computed from `actualSlipSquares`
  right before `resolveSlipPath()` is called.

---

### 2026-08-21 — House rule: Crowded Field Disadvantage now scales with pileup size (1 D per ship), not a flat -1
- **Changed value:** the existing Crowded Field Disadvantage — a penalty
  applied to a Hero's next Leg when 2+ ships end a Leg sharing the same
  square — used to be a flat **-1 D** regardless of how many ships piled
  up. It is now **-1 D per ship in the square** (2 ships → -2, 3 ships →
  -3, etc.), measured at the beginning of the next Leg (i.e. from the
  square positions the previous Leg actually ended on).
- **Why:** introduced alongside the new Slingshot bonus above — since the
  inside lane is about to become more contested (shortest lap distance
  plus the new Slingshot payoff), a flat -1 D wasn't enough to make
  contesting it genuinely risky. Scaling with pileup size means everyone
  piling into the same tight line gets progressively more dangerous, not
  just a fixed, easily-absorbed penalty.
- Lives in `finishLeg()` (flags each Hero with the group's size instead of
  a boolean) and `initLegState()` (`crowdedFieldD: p.crowdedFieldNextLeg ?
  -p.crowdedFieldNextLeg : 0`) in `app.js`.

---

### 2026-08-21 — A failed or fumbled Pilot Task Check halves the Leg's Movement, rounded up
- **New rule (not in an earlier printed version):** if the Pilot **Fails or
  Fumbles** their own Pilot Task Check for a Leg, that Leg's Movement (MPs)
  is cut in half, rounded up (e.g. 15 → 8, 14 → 7), **before** any Slip
  calculations. A Fumble always implies a Fail (the check's chosen die is
  itself a failure), so both outcomes are covered by the same
  `!rc.success` test — there's no separate, harsher Fumble penalty here.
- This only applies to Circular Track Heroes — NPCs have no Pilot Task
  Check concept and are never halved, and straight (Legs/points) courses
  rank by finishing position rather than raw Movement, so this rule has no
  effect there.
- **Stacks with, does not replace,** the existing -1-per-Fumble-LEVEL
  penalty already baked into the Leg Ranking Score (`rankTotal`, see
  `rollPhase()`'s pilot branch: `rankTotal: sb + critBonus - fumblePenalty`
  — unaffected by the Base Leg Result change above, which only touches the
  separate, shared `ls.baseLegResult` average, not this per-Hero score). A
  genuine multi-die Fumble is hit twice: first the -1/level reduction to
  the Leg Ranking Score (and thus this Hero's own Movement), then this
  halving on the already-reduced total. Confirmed intentional by the user
  (2026-08-21) — not a bug.
- Applied first, before Slip: a declared Slip's squares (and any
  curve-touch Advantage/Disadvantage) are resolved against the
  **already-halved** Movement total, never the full pre-Fumble roll — so a
  Slip that would have comfortably fit the original Movement can end up
  clamped smaller once the halving applies.
- Lives in `finishLeg()` in `app.js`, immediately after `r.movement` is
  computed and before `resolveSlipPath()` is called.

---

### 2026-08-20 — Circular Track: a Slip's squares are now interleaved with forward movement to maximize real distance covered (supersedes "forward first, then Slip" below)
- **A Slip's diagonal lane-change squares are no longer resolved as one
  fixed block (always first, or always last) — at each square of the Leg's
  movement, whichever option (staying forward in the current lane, or —
  while Slip squares remain — hopping diagonally into the next lane over)
  covers more REAL distance is the one taken.** Adjacent lanes' squares are
  only close to, not exactly, the same physical length (see
  `curveSplitForCourse()`), and a diagonal hop lands on whichever square in
  the new lane contains the target position — not necessarily a same-length
  square — so which option gains more ground can genuinely go either way
  step to step, depending on how the two lanes' grids happen to line up
  right there. This is a correction of the immediately-preceding rule
  (reinstated the same day at the user's request as "the path that moved
  the ship farthest"): a rigid "Slip first" or "Slip last" order doesn't
  actually maximize real distance covered every time, so the resolution now
  computes it directly.
- Reported via screenshot: a multi-lane Slip's replay trail hugged the tight
  origin lane for a long stretch before staircasing out right at the very
  end, next to the ship, instead of taking the more direct route a driver
  actually cutting for distance would take.
- Worked example (from the original Slip-mechanics report): 16 squares of
  movement, 5-square Slip → the algorithm decides, one square at a time,
  where among those 16 steps each of the 5 diagonal lane-change hops
  (1→2→3→4→5→6) actually lands the most ground, rather than assuming they
  all happen consecutively at a fixed point in the sequence.
- The curve-touch Advantage/Disadvantage projection (`lockDeclarations()`)
  and the replay reconstruction (`buildCircularLegWaypoints()`) both use the
  same resolution — a Leg's projected/replayed path is whatever this
  algorithm actually computes, not an assumed order.
  `buildCircularLegWaypoints()` re-runs this exact algorithm against a Leg's
  own recorded movement/Slip squares for a perfect, step-for-step replay
  reconstruction; if that doesn't land exactly on the Leg's authoritative
  recorded position (a Leg recorded under an earlier rule version — this
  rule has changed more than once, and old in-progress races mix Legs
  recorded under different versions of it, including some with no
  `slipSquares` field at all), it falls back to diagonal-interpolating a
  smooth, connected path to that recorded position instead.
- Code: `resolveSlipPath()` (new shared resolver used by all three),
  `finishLeg()`, `lockDeclarations()`, `buildCircularLegWaypoints()` in
  `app.js`.

### 2026-08-20 — Circular Track: a Racing Maneuver can now target a ship within 2 squares (supersedes "same square or adjacent" below)
- **A Racing Maneuver can now target any ship within `MANEUVER_RANGE_SQUARES`
  (2) squares**, not just the same square or an immediately adjacent one.
  Range is measured the same way for same-lane and different-lane targets as
  before — a different lane's position is carried into the acting ship's own
  lane's square units via the exact real-arc-length (Q) conversion, so a
  square in a curve and a square on a straight are compared consistently
  rather than assuming every square is the same physical length.
- Code: `squaresWithinManeuverRange()` (renamed from `squaresAdjacentOrSame()`)
  in `app.js`, used by `renderDeclModal()`'s target list and
  `App.togglePosAllTargets()`.

### 2026-08-20 — Circular Track: a Slip's magnitude is now also capped by declared Acceleration
- A Pilot can no longer declare more squares of Slip than the ship's declared
  Acceleration (G) this Leg, even if more lanes are physically available in
  that direction. The Slip magnitude is `min(lanes available in that
  direction, declared Acceleration)`.
- This lines up with how the Slip's own curve-touch projection already
  worked: the forward-only stretch before the Slip begins is `declared
  Acceleration − Slip squares` (see the diagonal-step entry below) — a Slip
  bigger than the declared Accel was already conceptually "spending" more
  than the Leg's own G budget.
- Declared in the Declare Intentions modal: the Slip magnitude input's max
  (and its "/N max" label) reflect this cap live, and lowering Acceleration
  below an already-declared Slip re-clamps it immediately. `lockDeclarations()`
  re-clamps authoritatively at lock time either way.
- Code: `lockDeclarations()`, `App.setDecl()`, `renderDeclModal()` in `app.js`.

### 2026-08-19 — Circular Track: each square of Slip is now a diagonal, forward-advancing step (supersedes "Q-preserved, no further forward progress" below)
- **A square of Slip now advances the ship forward by one square, same as
  ordinary movement, AND changes one lane — simultaneously — instead of being
  a purely lateral hop with zero forward progress.** Reported with a
  screenshot: the correct path (drawn in white) took a visibly diagonal step
  at each lane crossed; the app was instead moving the ship sideways with no
  forward progress at all during the Slip portion. A "square that shares a
  corner" (see the house-rule entry below) touches the ORIGIN square only at
  a single point offset diagonally — that diagonal offset is real forward
  progress, not a same-position lateral shift.
- Worked example: 16 squares of movement, 5-square Slip declared → 11 squares
  forward in the current lane, THEN 5 diagonal steps, each moving one square
  forward and one lane over. The ship ends up a full 16 squares further along
  the track (not just 11) and 5 lanes over. Total forward progress always
  equals the Leg's full movement, matching what `cumulative`/lap-completion
  tracking already assumed it did.
- A multi-square Slip now animates in the replay as a proper diagonal
  staircase — one waypoint per lane crossed, each stepping both forward and
  sideways — instead of one hop straight to the final lane.
- Also fixed a related precision bug surfaced by this rework: the Slip's
  lane-to-lane conversion was rounding through the lap's AVERAGE square
  density (arc length ÷ total square count) rather than each lane's own exact
  square grid — imprecise enough that consecutive diagonal steps could round
  to the same square index instead of advancing, especially for outer lanes.
  Fixed with an exact inverse of the existing exact forward conversion.
- **Where:** `app.js` → `qToSquarePos()` (new, exact inverse of
  `squarePosToQ()`), `finishLeg()` (circular movement branch — the Slip loop
  now advances one square before crossing each lane), `lockDeclarations()`
  (Slip block — A/D projection walks the same diagonal steps),
  `buildCircularLegWaypoints()` (replay waypoints — one diagonal hop per lane
  crossed).

---

### 2026-08-19 — Circular Track: a Slip now happens AFTER as much forward movement as possible, not before any of it
- **A Slip's lane change now happens at the END of the Leg's movement, not the
  start.** Of a Leg's total squares of movement, a ship spends as many as
  possible moving straight forward in its CURRENT lane first; only once that's
  exhausted does the remaining (declared Slip) amount go toward the lane
  change itself. Example: 16 squares of movement with a 5-square Slip declared
  → 11 squares forward in the current lane, then the Slip's 5 squares change
  lanes (Q-preserved, no further forward progress). This doesn't cost
  anything beyond ordinary movement (see the "no Movement Point cost" entry
  below) — it's simply how the same total movement gets spent when some of it
  goes toward changing lanes instead of continuing straight.
- If a Fumble (or anything else) leaves the Leg's actual resolved movement
  smaller than the declared Slip amount, the Slip itself shrinks to match —
  a ship can't change more lanes than it actually moved squares this Leg.
- Mechanically, this also fixes an ordering problem: the Slip's lane change
  used to happen instantly at Declare Intentions, before the Leg's movement
  was even known (impossible to know yet, since Crit/Fumble — and the Slip's
  own Advantage/Disadvantage — hadn't resolved). It now happens once
  finishLeg() knows the Leg's real movement, same moment forward movement
  itself is applied.
- The Slip's Advantage/Disadvantage determination (see the entry below) is
  unaffected in spirit but now projects the forward-only stretch (declared
  Acceleration minus the Slip amount) in the CURRENT lane before checking the
  Slip's own landing square, matching this new order.
- **Where:** `app.js` → `finishLeg()` (circular movement branch — forward-only
  then Slip, `slipSquares` now recorded per Leg in `history`),
  `lockDeclarations()` (Slip block — no longer touches lane/squarePos, just
  clamps magnitude and computes A/D), `buildCircularLegWaypoints()` (replay
  waypoints rebuilt in the same forward-then-Slip order).

---

### 2026-08-19 — Circular Track: Slip A/D now covers the whole Leg's projected path, not just the Slip's own origin square (supersedes the "both straight" entry below)
- **A Slip costs no Advantage/Disadvantage only if the entire Leg stays on a
  straightaway** — from where the ship starts (before the Slip) through its
  *projected* end (the post-Slip lane, moved forward by the declared
  Acceleration). Starting on the straight and ending in a curve, starting in
  a curve and ending on the straight, or staying fully within a curve the
  whole way all use the curve A/D (+1 Advantage per square slipped outward,
  −1 Disadvantage per square slipped inward); only "never touches a curve at
  all" costs nothing.
- The actual end-of-Leg square isn't known at Declare Intentions — Crit/Fumble
  haven't resolved yet, and the Slip's A/D is itself one of the inputs to the
  very roll that resolves them. Declared Acceleration (already fixed at this
  point) stands in for the Leg's real distance as the best available estimate.
- **Where:** `app.js` → `isSquareOnStraight()` (new), `lockDeclarations()`
  (Slip block — `touchesCurve`). Replaces the previous `isOnStraight()`/Q-based
  single-point check, now removed.

---

### 2026-08-19 — Circular Track: Slip no longer costs Movement Points (supersedes the MP-cost part of the "Slip reworked" entry below)
- **A Slip costs no Movement Points.** Magnitude is now capped only by how
  many lanes are physically available in the chosen direction — the earlier
  `floor(Acceleration / 2)` Movement Point cap is gone, and a Slip no longer
  reduces the ship's forward movement for the Leg.
- The Advantage/Disadvantage side of the rule is unchanged: a Slip entirely
  within a straightaway still costs no Advantage/Disadvantage; a Slip through
  a curve still grants +1 Advantage per square slipped outward or costs −1
  Disadvantage per square slipped inward.
- **Where:** `app.js` → `lockDeclarations()` (magnitude clamp, no more MP
  cap), `finishLeg()` (movement no longer reduced by Slip), `renderDeclModal()`
  (magnitude input, help text), `App.setDecl()` (`slipSquares` clamp).

---

### 2026-08-19 — Circular Track: staggered-start offset changed to 4 squares/lane (supersedes the 2-square offset)
- Each lane out now starts **4 squares** further ahead than the one inside
  it (was 2). No longer derived from `LANE_SQUARE_INCREMENT/2` -- a direct,
  fixed offset (`STAGGER_PER_LANE`), independent of whatever
  `LANE_SQUARE_INCREMENT` is. Affects both the actual gameplay starting
  `squarePos` and the drawn starting-line tick for each lane (the same
  function drives both).
- **Where:** `app.js` → `STAGGER_PER_LANE`, `laneStartSquarePos()`.

---

### 2026-08-19 — Circular Track: 10 extra squares added to each straightaway
- Each of the two straightaways now carries **10 more squares** than the
  "natural" straight/curve split (straight square width roughly equal to
  lane 1's curve square width) would otherwise give it -- real extra length
  at the same square size, not the same length subdivided into more, smaller
  squares. Since there are 2 straightaways, every lane's total square count
  (and therefore its lap length/Movement Points) grows by 20; the per-lane
  curve counts and the +4/lane growth between lanes are unchanged. With the
  default 50-square inner lane, lanes 1-6 are now 70, 74, 78, 82, 86, 90
  squares/lap (was 50, 54, 58, 62, 66, 70).
- **Where:** `app.js` → `STRAIGHT_SQUARE_BONUS`, `BASE_STADIUM_HALF_STRAIGHT`,
  `curveNaturalS()`, `STADIUM_HALF_STRAIGHT` (grown to match), `laneSquaresArray()`,
  `curveSplitForCourse()`.

---

### 2026-08-19 — Leg TN cap: highest Ship Pilot Mk in the race, + 18
- A Leg's Target Number can never exceed the **highest Ship Pilot Mk among
  this race's Heroes, plus 18** — a Leg that would otherwise roll or be set
  higher is capped down to this value; one already below it is unaffected.
  "Ship Pilot Mk" is the ship's static Pilot score (crew skill + Ship AI +
  sponsor bonus/penalty — see the Shipyard/Cantina build, `computeShipDisplay()`),
  not a Leg's tactical Advantage/Disadvantage, which doesn't exist yet at the
  point a Leg's TN is set. NPCs have no Ship/crew, so only Heroes count; an
  all-NPC race falls back to a flat cap of 18.
- Applies to both track types. A straight course's Legs are pre-built and
  reusable across different races/rosters, so the cap is computed fresh each
  time a Leg is entered (using THIS race's actual roster) and applied to a
  copy — the course's own persisted Leg (and its stored TN) is never
  overwritten. A Circular Track's Legs are already rolled fresh every time
  (see below), so the cap just applies to that same fresh roll.
- **Where:** `app.js` → `legTNCap()`, `initLegState()`.

---

### 2026-08-19 — Circular Track: Initiative determines starting lanes (supersedes round-robin lane assignment)
- Every ship rolls **Initiative = d20 + its Ship's max Acceleration** once, at
  the start of the Race. An NPC has no Ship Class (see APP_CHANGES.md), so it
  rolls a bare d20.
- Lanes are assigned in Initiative order, **innermost lane to outermost,
  highest Initiative to lowest**. With more racers than lanes, assignment
  wraps back to lane 1, same as the round-robin assignment this supersedes.
- A **tie is resolved by re-rolling only the tied ships** against each other
  (Initiative = d20 + max Acceleration again), repeating if that reroll also
  ties, until every ship in the group has a strict order. A tied group's rank
  relative to the rest of the field is fixed by the original tied value — the
  reroll only orders the tied ships against each other, never past a ship
  they didn't tie with.
- **Where:** `app.js` → `startRace()`, `resolveInitiativeOrder()`,
  `breakTieOrder()`, `shipMaxAccelForInitiative()`.

---

### 2026-08-19 — Circular Track: Crowded Field — sharing a square costs the next Leg's Pilots a Disadvantage
- If **two or more ships end a Leg occupying the same square**, each of their
  **Pilots starts the next Leg with 1 Level of Disadvantage** ("Crowded
  Field" — shown as its own line in the Advantage/Disadvantage breakdown,
  same as Slip). The Disadvantage applies only to that one following Leg.
- An NPC sharing a square with a Hero still counts toward triggering this for
  that Hero, even though an NPC has no Pilot roll of its own to penalize.
- **Where:** `app.js` → `finishLeg()` (detection, end of Leg),
  `initLegState()` (`crowdedFieldD`, consumed from the participant's
  `crowdedFieldNextLeg` flag and cleared), `pilotExtraNet()`,
  `legAdSourcesHtml()`.

---

### 2026-08-19 — Circular Track: a Slip can only land in a square sharing a corner or partial side with the one left
- Refines the existing Slip rule (see the MP-cost/magnitude/A-D entry below):
  when a Slip changes lanes, the ship's new position is now carried over by
  preserving its real track position (Q) rather than reinterpreting the same
  raw square-count against the new lane's different circumference. Since
  every lane's radial band sits at the same real position for the same Q by
  construction of the whole track, this guarantees the destination square
  always shares at least a corner — a full side on the straights — with the
  square the ship left, instead of an occasional same-numbered square that
  might land somewhere unrelated in a lane of a different length.
- **Where:** `app.js` → `laneTFromQ()`, `lockDeclarations()`'s Slip block.

---

### 2026-08-19 — Racing Maneuvers: can only target a ship in the same square or an adjacent one (Circular Track only)
- On a Circular Track, a Racing Maneuver's target list is restricted to ships
  in the **same square** or a square **sharing a corner or partial side**
  with the instigating ship's own square (same lane within 1 square, or an
  adjacent lane at a touching position). Straight — Legs courses have no
  squares, so Maneuver targeting is unrestricted there, same as before.
- **Where:** `app.js` → `squaresAdjacentOrSame()`, `circularSquareDist()`,
  `renderDeclModal()`'s target list, `App.togglePosAllTargets()`.

---

### 2026-08-19 — Circular Track: per-lane hex count changed to a +4/lane progression (supersedes the +6/lane progression)
- Each lane out from the inside now carries **4 more hexes per lap** than the
  one inside it (was 6): with the default 50-hex inner lane, lanes 1-6 are
  50, 54, 58, 62, 66, 70 hexes/lap (was 50, 56, 62, 68, 74, 80). This is the
  gameplay hex count (lap length, Movement Points, Slip's lane-circumference
  math) — it's also now, exactly, the number of decorative tiles drawn for
  that lane (see APP_CHANGES.md's square-track rebuild), where previously the
  drawn tile count was a uniform 50 for every lane regardless of its real hex
  count.
- The staggered-start math is unchanged in form, just tracking the new
  increment: an unstaggered outer lane would run `LANE_HEX_INCREMENT/2` (now
  2, was 3) hexes long crossing just the first curve, so that's how far ahead
  it starts.
- **Where:** `app.js` → `LANE_HEX_INCREMENT`, `laneHexesArray()`,
  `laneStartHexPos()`.

---

### 2026-08-19 — Circular Track: Slip reworked — variable magnitude, Movement Point cost, position-dependent A/D (supersedes the flat "1 Level of Disadvantage" Slip rule)
- **Slips always cost 2 Movement Points per hex.** A ship's Movement Points
  for this purpose are its declared Acceleration (the only movement figure
  known at Declare Intentions, before Crit/Fumble resolve the Leg further) --
  so a ship can afford to Slip up to `floor(Acceleration / 2)` hexes, also
  capped by how many lanes actually exist in that direction. The MP cost
  itself is deducted from the ship's *actual* resolved forward movement this
  Leg (its Leg Finishing Score, which may differ from Acceleration once
  Crit/Fumble apply), floored at 0 -- a Slip can eat the whole Leg's movement
  but never send a ship backward.
- **A Slip entirely within a straightaway** (both the origin and destination
  hex) **costs no Advantage or Disadvantage** — Movement Points only.
- **A Slip through a curve to an outside lane grants +1 Advantage per hex**
  slipped; **to an inside lane costs −1 Disadvantage per hex** slipped. "Curve"
  here means anything that isn't entirely within a straightaway.
- Direction is unchanged from the previous entry: Left is inward (toward lane
  1), Right is outward (toward a higher lane number), matching how a driver
  steers left to move to the inside on this counterclockwise track.
- **Where:** `app.js` → `lockDeclarations()` (magnitude clamp, straight/curve
  check via the new `isOnStraight()`, signed `ps.slipAdvantage`),
  `pilotExtraNet()`, `finishLeg()` (the 2 MP/hex deduction from `r.movement`),
  `renderDeclModal()` (direction + magnitude inputs).

---

### 2026-08-18 — Circular Track: start moved to the right end of the top straight, staggered starting line
- **Start position:** the race now starts at the **far right end of the
  upper straightaway** (previously the top-left join). Ships still run
  counterclockwise from there — left along the top straight, down the left
  cap, right along the bottom straight, up the right cap, back to start.
- **Starting line:** now drawn as an individual mark **at each lane's own
  actual starting hex** rather than one straight line shared by every lane.
  Since outer lanes start staggered further ahead (see the entry below),
  a single straight line was only ever accurate for lane 1 — every other
  lane's ship actually starts partway around the first curve, ahead of
  where that line was drawn. Matches a real track's staggered start grid,
  where the starting line is a broken curve, not one straight bar.
- **Where:** `app.js` → `stadiumPoint()`/`stadiumTangent()` (start point
  moved), `laneStartHexPos()` (shared by `startRace()` and the new per-lane
  starting-line drawing in `renderCircularTrackSvg()`).

---

### 2026-08-18 — Circular Track now runs counterclockwise (supersedes the entry below)
- **Change:** the track's direction of travel is now **counterclockwise** —
  the standard real-world oval-racing convention (NASCAR and most closed
  circuits run this way) — instead of clockwise. Ships started at the
  top-left finish line at the time (see the newer entry above for where the
  start moved to since), heading down the near curve first (rather than
  along the top straightaway) — down the left, across the bottom
  (left-to-right), up the right, back along the top (right-to-left).
- **Slip direction flips again as a result:** on a counterclockwise track,
  facing the direction of travel, steering **left points toward the track's
  center** (inward, toward lane 1) and **right points away from it**
  (outward, toward a higher lane number) — a driver "goes low" on a real
  counterclockwise oval by steering left. This happens to restore the
  *original* Left/Right mapping from before the entry directly below, since
  reversing the track direction flips the correct mapping back a second time.
- **Where:** `app.js` → `stadiumPoint()`, `stadiumTangent()` (segment order
  and sweep direction reversed), `lockDeclarations()` (Slip `delta` sign),
  `renderDeclModal()` (dropdown labels).

---

### 2026-08-18 — Circular Track: Slip Left/Right direction fixed (bug fix) — superseded above
- **Bug:** Slip Left moved a ship inward (toward lane 1) and Slip Right moved
  it outward — backwards. The track runs clockwise (the top straightaway
  heads east); facing the direction of travel, steering left points away from
  the track's center and right points toward it, the same way a driver on a
  counter-clockwise NASCAR oval steers left to move to the inside lane, and
  the opposite on a clockwise one.
- **Fix:** Slip Left now moves outward (lane + 1, toward a higher lane
  number) and Slip Right moves inward (lane − 1, toward lane 1), matching
  which lane each option actually shows in the Declare Intentions dropdown.
- **Where:** `app.js` → `lockDeclarations()` (the Slip `delta` sign),
  `renderDeclModal()` (the dropdown's Lane-shown-per-option labels).

---

### 2026-08-18 — Circular Track: staggered starting positions
- **New:** Ships no longer all start a Circular Track race at hex 0 of their
  lane. Each lane out from the inside starts **3 hexes** further ahead than
  the one inside it (Lane 1: 0, Lane 2: 3, Lane 3: 6, Lane 4: 9, Lane 5: 12,
  Lane 6: 15).
- **Why 3, not the whole 6-hex increment:** the entire extra length a lane
  gains over the one inside it (6 hexes — see the Circular Track entry below)
  comes from its two curved end-caps, split evenly between them, since the
  straightaways are the same length for every lane. Crossing just the first
  curve, an unstaggered outer lane would already be running 3 hexes long per
  lane-step; starting that far ahead cancels it out, the same reasoning a real
  staggered track start uses.
- **Where:** `app.js` → `startRace()` (`stagger = LANE_HEX_INCREMENT / 2`).

---

### 2026-08-18 — Circular Track / Distance Tracking (new optional rule)
- **New:** Racecourses can now be built as a **Circular Track** instead of a
  straight sequence of Legs. A Circular Track has **6 lanes**; each lane out
  from the inside is **6 hexes** longer per lap than the one inside it (the
  inner lane defaults to 50 hexes around, so the six lanes run 50, 56, 62, 68,
  74, 80 hexes). The Racemaster sets the number of **laps** to finish.
- **Movement:** On a Circular Track, a ship's hexes moved each Leg equal its
  Leg Finishing Score (Speed Bonus ± Critical Success/Fumble levels — see the
  2026-08-11 entry below), floored at 0 — a bad Leg slows a ship, it never
  sends it backward. Hexes accumulate around the current lane; crossing the
  lap length wraps to the next lap.
- **Race length:** Because different ships can cover different distances each
  Leg, a Circular Track race has no fixed Leg count — it runs Leg by Leg until
  any racer completes the required laps, then ends immediately. A Circular
  Track has no pre-built list of Legs the way a straight course does: **roll a
  new Leg's Tier, Feature, and TN at the end of each Leg**, including the very
  first one — a Racemaster running this by hand rolls fresh every time, never
  reusing a Leg from earlier in the race or from a previous race on the same
  course.
- **Lanes:** Ships start in a lane (assigned automatically, round-robin, at
  race start). During Phase 0 (Declare Intentions), the Pilot may **Slip** one
  lane left or right instead of holding position. **Apply one Level of
  Disadvantage to the Pilot Task Check for each hex face the ship must turn to
  remain on course, including Slips** — so each Slip costs the Pilot 1 Level
  of Disadvantage for that Leg, same as any other course-forced turn.
- **Standings:** Progress is shown against each ship's own required distance
  (laps × its lane's circumference, since outer lanes must cover more ground
  for the same lap count) rather than the straight-course points system. The
  rule limiting an NPC that falls more than one Leg's movement behind
  (see the 2026-08-11 "NPC drop-behind" entry) does not apply on a Circular
  Track — it was calibrated for the points system, not hex distances.
- **Where:** `app.js` → `laneHexesArray()`, `startRace()`, `lockDeclarations()`
  (Slip resolution), `finishLeg()` (circular movement/lap/finish branch),
  `App.generateCourse()` (Track selector).

---

### 2026-08-18 — Flash Fumble #3 Acceleration cap fixed to match 2-G Damper Rating (bug fix)
- **Bug:** Flash Fumble chart entry #3 ("You push the vehicle too hard...") sets
  Acceleration down to the Damper Rating when triggered. Its flavor text has always
  said this, but the `affects` data was left at the old value of `1` after Flash
  Division's Damper Rating was changed from 1-G to 2-G earlier this session — so
  the fumble was capping Acceleration one point lower than the current rule.
- **Fix:** Fumble #3's Acceleration-set value is now `2`, matching Flash's current
  2-G Damper Rating.
- **Where:** `data.js` → `GDATA.FLASH_FUMBLES[2].affects` (`accel` entry, `value: 1` → `value: 2`).

---

### 2026-08-11 — Advantage purchase limit removed (bug fix — AAAAA was never meant to cap buying)
- **Bug:** `updateSkill()` and `updateShipClassAI()` clamped Advantage input to a
  max of 5, and `advCost()` stopped increasing past level 5 — so the AAAAA Leg cap
  (see the point-cost curves entry above) had accidentally also become a **purchase**
  cap, and any Advantage bought past level 5 was free. Neither was intended: the
  AAAAA ceiling is a Leg-only effect cap, never a buying limit.
- **Fix:** Advantage (crew skills and Ship AI) can now be bought with no upper
  limit, and its cost keeps climbing on the same doubling curve past AAAAA (AAAAAA
  = 315, AAAAAAA = 635, ...). The effective Leg skill still caps at AAAAA exactly
  as before — buying past it is legal, it's just wasted in a race.
- **Where:** `app.js` → `advCost()` (dropped the `Math.min(adv, MAX_ADV)` clamp),
  `App.updateSkill()`, `App.updateShipClassAI()` (raised the input clamp to 999).

---

### 2026-08-11 — Pilot Leg-win ranking score no longer includes the d20 roll or Skill Score
- **Change:** who wins the Leg is now decided by **Speed Bonus alone, +1 per
  Critical Success LEVEL or −1 per Fumble LEVEL** — never both, since Crit only
  happens on Advantage rolls and Fumble only on Disadvantage. The Pilot's d20 roll
  and Leg Skill Score (previously added in as `rc.total`) no longer contribute to
  the ranking score at all.
- **The TN check itself is unaffected:** the Pilot still rolls the normal dice pool
  (Score + Advantage/Disadvantage) against the Leg's TN to resolve Success/Failure
  and classify Critical/Fumble — that roll still matters, it's just no longer
  summed into who wins. A Fumble also still triggers its usual consequence roll
  (HP damage, multi-Leg Disadvantage, etc.) exactly as before.
- **New formula:** `rankTotal = Speed Bonus + Crit Bonus − Fumble Penalty`. (Old:
  `rc.total + Speed Bonus + Crit Bonus − Fumble Penalty`.)
- **Speed Bonus is now the Leg's declared Acceleration 1-for-1** (e.g. 6-G Accel =
  +6 Speed Bonus), not half of it rounded up. Since Speed Bonus is now the entire
  basis of the ranking score, Acceleration itself directly decides who wins ties
  against Crit/Fumble.
- **Where:** `app.js` → `speedBonus()`, `rollPhase()`'s `pilot` branch,
  `renderPhaseRollBlock()`'s Leg Ranking Score breakdown.

---

### 2026-08-11 — Division build points caps reinstated (as a rule, not enforced)
- **Change:** per-Division points caps are **back as the official rule**, but the
  app does **not** block or revert a build over cap — the Racemaster can build
  higher, and the Total Points display simply turns **red** when a class exceeds
  its Division's cap, so it's visible at a glance without stopping anyone. This
  **supersedes** both the "Build caps removed" entry and the earlier version of
  this entry (same day), which reverted over-cap edits with a blocking alert.
- **New caps**, set to each Division's own preset total under the current cost
  curves — the preset sits right at its cap with no headroom to spare:
  **Flash 20, Spark 30, Comet 40, Meteor 50, Nova 60.** (The old caps, before the
  new cost curves, were Flash/Spark 20, Comet 25, Meteor 30, Nova 35.)
- Flash's separate physical **5-G Max Thrust ceiling** (sub-sonic) is unaffected —
  it's a hard limit independent of the points cap, and still applies.
- An edit that keeps the total the same or lowers it is always allowed, even if
  the class is still over cap afterward — so a class pushed over cap by a
  Division switch can still be edited back down to compliance one field at a time.
- **Code:** `GDATA.DIVISION_CAPS` (data.js) restored. `mutateShipClassWithCapCheck()`
  applies edits without checking the cap; `shipClassOverCap(sc)` (app.js) is the
  new check, used to redden the Total Points tag (collapsed card) and the Total
  Points table cell (expanded card, `.danger-text`, added to style.css) whenever a
  class exceeds its cap. The Shipyard note now reads "…capped at N total points
  (a rule, not enforced here — Total Points below turns red if you build over it)."

---

### 2026-08-11 — Division preset stat blocks updated (Armor, Compartment, Ship AI)
- **Change:** the book-default stat block for each Division's Ship Class (used by
  "Default" resets and new classes) was updated to match play-tested values.
  Tier, Tonnage, Damper, Min Crew, Max Thrust, and Frame are unchanged.
- **Flash:** Spotter AI 2→**1**.
- **Spark:** Armor 1→**3**; Navigator AI Advantage 0→**+1**; Spotter AI Advantage
  0→**+1**.
- **Comet:** Armor 0→**2**; Pilot AI 2→**4**; Navigator AI 2→**3**; Spotter AI
  1→**3**.
- **Meteor:** Compartmentalization Reinforced→**Standard**; Pilot AI 1→**4**;
  Navigator AI 2→**4**; Navigator AI Advantage 0→**+1**; Spotter AI 1→**3**.
- **Nova:** Armor 4→**2**; Pilot AI 2→**5**; Navigator AI 3→**4**; Navigator AI
  Advantage 0→**+1**; Spotter AI Advantage 0→**+1**.
- **Updated preset total point cost** (Max Thrust + Ship AI + hull, under the
  current cost curves — see the "New point-cost curves" and "Ship Armor" entries
  below): **Flash 20, Spark 30, Comet 40, Meteor 50, Nova 60.** These totals are
  now also each Division's build **cap** — see "Division build points caps
  reinstated" above.
- **Where:** `data.js` → `GDATA.SHIP_CLASSES`.

---

### 2026-08-11 — Flash Division Damper Rating set to 2-G
- **Change:** Flash-class Damper Rating is now **2-G**, up from 1-G. This
  **supersedes** the 2026-08-06 entry that raised it from the book's 0-G to 1-G.
- With Flash's 5-G Max Thrust ceiling, a Flash can now compensate up to 2-G of its
  Acceleration (uncompensated G = Acc − 2), softening the G-force penalty a little.
- Damper is a fixed per-Division stat (not a purchasable value), so this applies to
  every Flash-class ship automatically.
- **Where:** `data.js` → `GDATA.SHIP_CLASSES.Flash.damper`.

---

### 2026-08-11 — Flash Division hard-capped at 5-G Max Thrust (sub-sonic)
- **Change:** Flash Division ships are physically limited to a **hard ceiling of
  5-G Max Thrust** — they're sub-sonic and cannot be built or flown faster.
  Switching a class to Flash clamps its Max Thrust down to 5; every other Division
  remains **uncapped** on thrust.
- This is the one exception to "no build caps" (see the entry below) — it's a
  physical performance limit, not a points cap.
- **Code:** `maxThrustCap(division)` in `app.js` (5 for Flash, 99 otherwise), applied
  in `updateShipClassMaxThrust()`, `updateShipClassDivision()`, and the Acc input's
  `max` attribute, with a "sub-sonic — capped at 5-G" note in the Shipyard.

---

### 2026-08-11 — Build caps removed
**SUPERSEDED same day — see "Division build points caps reinstated" above.**
- **Change:** the per-Division build caps are gone. A custom Ship Class may now buy
  **any** point total and **any** Max Thrust — nothing is blocked or reverted at
  build time. (Previously `GDATA.DIVISION_CAPS` hard-capped `shipClassTotalCost()`
  per Division — Flash/Spark 20, Comet 25, Meteor 30, Nova 35 — and Flash's Acc was
  clamped to 5-G; edits over cap were reverted with an alert.) This **supersedes**
  the earlier per-Division cap rule.
- **Rationale:** the only cap in the game is the **per-Leg AAAAA effective-skill
  ceiling**; there is deliberately no purchase ceiling, since campaign XP will keep
  climbing. Balance comes from the escalating cost curves + the Leg cap, not a wall.
- **Code:** removed `GDATA.DIVISION_CAPS` (data.js); `mutateShipClassWithCapCheck()`
  no longer checks a cap (kept as a thin apply-and-save wrapper); Max Thrust now
  clamps only to 0–99; the "capped at N total points" Shipyard note is removed.

---

### 2026-08-11 — New point-cost curves for Skills & Ship AI, plus an AAAAA Leg-skill cap
- **Why:** to discourage min/maxing (2+ crew easily reaching 10A on every position)
  in a way that survives campaign XP inflation — the pain is marginal opportunity
  cost, not a static cap XP can eventually climb over.
- **Skill/AI Score cost — now triangular:** a Score of *n* costs *n(n+1)/2* points.
  So 1→1, 2→3, 3→6, 4→10, 5→15, 6→21, 7→28, 8→36, 9→45, 10→55. (Was a flat 1
  point per Score point.) Applies to both crew skills and Ship AI stats.
- **Advantage cost — each level's increment doubles (cumulative):** A costs 5, the
  2nd level +10, the 3rd +20, the 4th +40, the 5th +80. So running totals are
  A=5, AA=15, AAA=35, AAAA=75, AAAAA=155 points. (Was a flat 10 per level.) Applies
  to both crew skills (heroes) and Ship AI.
- **Disadvantage cost — unchanged:** a flat −5 points refunded per Disadvantage
  level, with **no negative cap** (a Leg skill may fall below DDDD).
- **A fully maxed skill (10AAAAA) now costs 210 points** (55 Score + 155 Advantage),
  up from 60. Each additional maxed position is deliberately expensive, so spreading
  points is more efficient than blanketing every seat.
- **Effective Leg skill caps at AAAAA (+5):** stacked crew + Ship AI + support
  grants can never push a position's in-race Advantage above +5. Over-stacking a
  single seat past the ceiling is wasted; the Disadvantage side is uncapped.
- **Ship Armor now uses the same triangular Score curve** as Spotter/Navigator/
  Pilot: Armor level *n* costs *n(n+1)/2* (was a flat 1 point per level, so 4 Armor
  is now 10 pts, 10 Armor is 55). Damage Reduction from Armor is unchanged — only
  its point cost moved to the curve.
- **Acceleration / Max Thrust cost is unchanged (flat):** thrust is not a Skill,
  so it keeps its 1-point-per-G cost and does **not** use the triangular curve.
- **Code:** `scoreCost`, `advCost`, `skillCost`, `MAX_ADV` (=5), and the
  `Math.min(raw, MAX_ADV)` clamp in `netForPosition` in `app.js`. Costs are derived,
  so all existing heroes and ships recompute automatically — no saved data changes.

---

### 2026-08-11 — Phase I conditions apply per crewman, not by position category
- **Change:** Phase I (Crew Task Check Modifications) conditions — Drugged/Dazed/
  Stunned, Low Visibility, Under Fire, Vehicle Damaged, Wounded — are now applied
  to a **specific crewman** (like a Resistance check), imposing **−1 Disadvantage
  on every position that crewman holds**. Previously each condition hit a fixed
  category (Under Fire → all positions, Low Visibility → the Driver/Pilot).
- So a condition can now land on one crewman (e.g. Wounded on the person flying
  Pilot + Navigator affects only those two), and a ship-wide condition is applied
  by checking it for each affected crewman.
- **Conditions also apply to that crewman's Resistance check (Phase II):** each
  condition checked is −1 Disadvantage on their Resistance roll (a Wounded
  crewman resists G-forces worse, too). The Phase II roll line shows the penalty.
- **Where:** `app.js` → `renderPhaseI()`, `App.toggleCond()` (now keyed by crew),
  `rollResistance()`.
- **Rule (now enforced):** Only ships whose Division matches the racecourse's
  Division may enter it — a Meteor course is raced by Meteor ships, etc. The race
  setup ship picker filters to the course's Division, so a mismatched ship can't
  be selected. (Division already fixed each Leg's Tier / TN table / Fumble chart;
  this makes the ship-side requirement explicit.)
- **Where:** `app.js` → `renderRaceSetup()`, `beginRace()`.

---

### 2026-08-10 — Racing Maneuvers: every position may run its own, vs the target's same position
- **New Maneuver list.** Exactly one Maneuver at Disadvantage **1 / 2 / 3 for each
  crew position**, plus **Attack** (special, Tier levels):
  | Position | Lvl 1 | Lvl 2 | Lvl 3 |
  |---|---|---|---|
  | Pilot | Rub | Force Wide | Spin Attempt |
  | Navigator | Tail Wag | Cross Wake | Brake Check |
  | Spotter | Dirty Air | Sensor Ghost | Sensor Blind |
  | Engineer | Bump | Side Draft | Slam |
  Attack targets the Pilot at **Tier** levels. (Retired duplicates: Pinch, Block,
  Slide Job, Cut Off; Cross Wake, Sensor Ghost, Sensor Blind are new; Side Draft
  moved from level 3 to 2.)
- **Each position acts independently.** During Declarations, **every position**
  (Pilot, Navigator, Spotter, Engineer) may run one Maneuver from its own list
  against **the same position** on any chosen target ship(s) — the Engineer hits
  the target's Engineer, the Spotter hits the target's Spotter, and so on. This
  replaces the previous model where only the Pilot instigated a single Maneuver.
- **Self-cost is per acting position.** Each position that runs a Maneuver takes
  the instigator self-Disadvantage on **its own** Task Check (currently equal to
  the level inflicted, +1 per additional target).
- **Hero vs NPC targets:** the target position only matters for **Hero** targets
  (their four positions roll separately) — the Disadvantage lands on that same
  position. Against an **NPC** target (no per-position rolls) the Maneuver applies
  to the NPC's single roll **as normal** — and when several positions (or several
  ships) target the same NPC, those Disadvantages are **cumulative** on that NPC
  (e.g. a Pilot's Force Wide −2 and an Engineer's Slam −3 on the same NPC = −5).
- Each position's Maneuver dropdown lists that position's Maneuvers with level and
  full description.
- **Where:** `data.js` → `GDATA.MANEUVERS` (`position` field); `app.js` →
  `initLegState()` (`maneuvers`/`maneuverTargets`/`maneuverReceivedByPos`/
  `maneuverInstigatedByPos`), `lockDeclarations()`, `netForPosition()`,
  `pilotExtraNet()`, `legAdSourcesHtml()`, `renderDeclModal()`,
  `App.setPosManeuver()`/`togglePosTarget()`/`togglePosAllTargets()`.

---

### 2026-08-10 — Number of Legs is set by race Type, not Division
- **House rule:** A race's Leg count is now determined by its **Type**, the same
  for every Division:
  | Type | Leg Count |
  |---|---|
  | Drag Race | 1 |
  | Short | 2d5 |
  | Medium | 2d10 |
  | Long | 2d20 |
  Drag Race is a flat 1 Leg; the others roll two dice and sum (e.g. a Medium race
  rolling 1 and 3 = 4 Legs).
- **Supersedes** the old per-Division Leg dice (Flash 1d5, Spark 2d5, Comet 2d10,
  Meteor 3d10, Nova 4d10). Division still sets each Leg's Tier / features / TN
  table and the Fumble chart — only the *count* moved to Type.
- The course designer has a **Race Type** dropdown; the "🎲" Leg-count roll now
  rolls by Type. The chosen Type is stored on the course and shown as a tag.
- **Where:** `data.js` → `GDATA.RACE_TYPES`; `app.js` → `rollLegCount(typeName)`,
  `raceType()`, `renderCourse()` designer + saved-course tag, `generateCourse()`.

---

### 2026-08-10 — Minimum declared Acceleration is 1-G
- **House rule:** A racer's declared Acceleration for a Leg can never be **below
  1-G** — a ship is always under power, so 0-G is not a legal declaration.
- **With Fumble Acceleration reductions:** even after a Fumble cuts a ship's max
  Acceleration, the effective max never drops below 1-G (`effectiveMaxThrust`
  floors at 1), so a hard-hit ship can still declare 1-G — its Acceleration nets
  to a minimum of 1.
- **Where:** `app.js` → `App.setDecl()` (clamp lower bound 1), `initLegState()`
  (per-Leg default floored at 1), and the Declaration Acceleration input
  (`min="1"`).

---

### 2026-08-10 — Pilot: ±1 to the Leg-win score per Critical Success / Fumble
- **House rule (Critical Success):** The Pilot adds **+1 to the Leg-win ranking
  score for each Critical Success** — i.e. each Critical *level* past the first
  success die on the Pilot's Task Check (`critLevels = successCount − 1` on an
  Advantage roll). A Pilot rolling 6 dice that all beat the TN scores 5 Critical
  Successes → +5. This is **not** +1 per success die.
- **House rule (Fumble):** The Pilot subtracts **−1 from the Leg-win ranking
  score for each Fumble** — i.e. each Fumble *level* past the first failure die
  on the Pilot's Task Check (`fumbleLevels = failCount − 1` on a Disadvantage
  roll). This is **not** −1 per failure die. Critical Success and Fumble are
  mutually exclusive (Crit only on Advantage rolls, Fumble only on Disadvantage
  rolls).
- Both affect only the Leg-win ranking score (`rankTotal`), which decides
  finishing order for the Leg; neither changes the pass/fail TN check. They stack
  with the Acceleration Speed Bonus (the Fumble penalty stacks negatively).
- **Where:** `app.js` → `rollPhase()` pilot branch (`critBonus = rc.critLevels`,
  `fumblePenalty = rc.fumbleLevels`,
  `rankTotal = rc.total + speedBonus + critBonus − fumblePenalty`); shown in the
  Pilot result's "Leg Ranking Score" line in `renderPhaseRollBlock()`.

---

### 2026-08-09 — New: a last-place NPC too far behind the field is out
- **House rule:** At the end of each Leg, if the ship in **last place** is an
  **NPC** and it trails the **second-to-last ship** by **more than one full
  Leg's worth of movement** (second-to-last's cumulative movement minus the
  NPC's, greater than the racer count N — the most any ship can move in a single
  Leg), it is removed from the race. The check repeats so a fully detached tail
  of NPCs can clear in one Leg, and stops as soon as last place is a Hero or the
  gap is one Leg or less. This measures the gap to the rest of the *field*, not
  to the leader — an NPC hanging with the pack is safe even if the leader is far
  ahead. Applies to NPCs only; Hero ships are removed only by being destroyed
  (HP 0). A removed NPC stops rolling/taking Legs and its progress bar freezes
  where it dropped out (shown red).
- **Updated 2026-08-09:** the threshold was originally a flat 5 places, but the
  cumulative-point gap between adjacent ships naturally widens every Leg, so a
  flat 5 dropped NPCs almost automatically by mid-race. It now scales with the
  field (one full Leg = N movement).
- **Where:** `app.js` → `finishLeg()` (removal loop after cumulative update, gap
  compared to `N`); NPC roll/leg-close paths skip removed NPCs.

### 2026-08-09 — A destroyed ship is out; race ends when no Heroes remain
- **Rule:** Once a ship is destroyed (HP 0), it is out of the race. It is **not
  removed mid-Leg**, though — a wreck stays in the current Leg (flagged
  DESTROYED, with no further rolls, frozen at 0 movement, ranked last) until
  that Leg finishes resolving, then drops out from the next Leg on. It remains
  frozen on the standings board at the position where it crashed out.
- **Rule:** When **no Hero ships are left** (all destroyed), the race ends —
  but only once the current Leg has finished (checked in `finishLeg`), not the
  instant the last ship blows up. It then jumps to the final standings, where
  destroyed ships are flagged.
- **Where:** `app.js` → `activeHeroes()` (current-Leg roster, keeps the death
  Leg), `livingHeroes()` (race-end test), `finishLeg()`, and the Phase-Card /
  completion-gate render paths.

### 2026-08-09 — Updated Fumble charts: structured `Affects` mechanics, HP tracking, out-at-0
- **Rule source:** New printed Fumble charts (Flash and Spaceflight, d10 each)
  now carry an **Affects** column that turns each result's flavor text into
  concrete mechanics. The app resolves these automatically. Affect vocabulary:
  - `Pilot (D, Leg×N)` → that position gets **1 Level of Disadvantage** for the
    next **N** Legs. `(D×L, Leg×N)` gives **L** Levels for **N** Legs. Applies
    to any position (Pilot/Navigator/Spotter/Engineer), or all four at once.
  - `HP (Tier×M)` → the ship takes **Tier × M** points of HP damage, **reduced
    by the ship's DR** (minimum 0 after DR).
  - `Acceleration (N)` → subtract **N** from the ship's max Acceleration for the
    **rest of the race** (cumulative).
  - `Acceleration=N` → the ship's max Acceleration is **capped at N-G** for the
    rest of the race (used at N=1 on the charts).
  - `Position (Last)` / "comes in last this Leg" → the ship is **forced to
    finish last** for the listed number of Legs; it still plays its phases, its
    finishing result is just floored to last place.
- **HP:** Every ship now has a Hit Point pool (from its Frame/Tier — see the
  Ship Class hull rules) tracked for the duration of a race. Fumble HP damage
  subtracts from it.
- **Out at 0:** If a ship's HP reaches **0 it is destroyed and out of the
  race** — it makes no further progress (frozen at 0 movement) for the rest of
  the race and ranks last on every remaining Leg.
- **Acceleration cap in effect:** A ship's declared Acceleration can never
  exceed its current fumble-reduced maximum (`effectiveMaxThrust`); the
  declaration screen enforces this and shows the reduced ceiling.
- **Where it lives:** `GDATA.FLASH_FUMBLES` / `GDATA.SPACEFLIGHT_FUMBLES`
  (`data.js`, with the affect vocabulary documented inline);
  `applyFumbleAffects()`, `effectiveMaxThrust()`, `finishLeg()`,
  `startRace()`, `initLegState()` (`app.js`).

### 2026-08-07 — New: per-Division Ship Class caps (Acc + total points), with an official preset hull
- **House rule:** Every Division now has an official preset Ship Class hull
  loadout, and that preset's total point cost is a hard cap on any custom
  Ship Class built for that Division — the preset itself sits right at the
  cap with no headroom to spare:
  | Division | Frame | Armor | Compartment | Total Points (cap) |
  |---|---|---|---|---|
  | Flash | Super-Light | 0 | Standard | 20 |
  | Spark | Super-Light | 1 | Standard | 20 |
  | Comet | Super-Light | 0 | Standard | 25 |
  | Meteor | Super-Light | 2 | Reinforced | 30 |
  | Nova | Super-Light | 4 | Reinforced | 35 |
  Acc and AI stats themselves are unchanged from the book. Worked example for
  Flash: Acc(5) + Pilot(4+10 for +1 Adv) + Navigator(1) + Spotter(2) +
  Super-Light Frame(−2) = 20.
- **Additional Flash-only cap:** Flash also hard-caps Acc directly at 5-G
  (matching the book's own Flash entry) — the other 4 Divisions constrain
  Acc only indirectly, through the points cap.
- **Enforcement:** An edit is blocked only if it pushes a class's total
  *further* past its Division's cap than it already was — an edit that
  holds the total steady or lowers it is always allowed, even if the class
  is still over cap afterward. This lets a class that predates this rule (or
  was pushed over cap by switching Divisions) be brought back into
  compliance one field at a time instead of being permanently frozen.
- **Where:** `data.js` → `GDATA.SHIP_CLASSES.*.frame/armor/compartment`,
  `GDATA.DIVISION_CAPS`; `app.js` → `mutateShipClassWithCapCheck()`.

### 2026-08-07 — New: Engineer/Spotter must choose their grant target BEFORE rolling, and it's locked for every outcome
- **Change:** Previously the "Grant to:" target picker for Engineer/Spotter's
  ordinary Success/Failure grant only appeared *after* rolling (defaulting
  silently to Pilot if never touched), and a Critical Success/Fumble offered
  its own separate live choice on top of that (see the 2026-08-06 "fixed
  choice" entry below). Now the target picker appears *before* rolling, and
  neither "Roll" nor "Play It Safe" is available until a target is chosen —
  each Leg starts with no target pre-selected, so the choice has to be made
  fresh every time. Once rolled, that target is locked in for every outcome,
  including Critical Success/Fumble: the amount (1 level if locked to Pilot,
  2 levels if locked to a support position, per the 2026-08-06 rule) is
  worked out automatically with no further choice. Since nothing is left to
  decide once the dice land, the grant is also applied automatically the
  moment the roll (or Play It Safe) resolves — there's no separate "Apply"
  step at all anymore. Navigator is unaffected (its grant always targets
  Pilot, no choice to make); Pilot is unaffected (no grant mechanic at all).
- **Where:** `app.js` → `initLegState()`, `rollPhase()`, `skipPhase()`,
  `autoApplyGrant()`, `renderPhaseRollBlock()`.

### 2026-08-07 — Fixed: Ship Class crew size is an exact number, not just a floor
- **Bug:** Ship Class crew size (e.g. Flash/Spark 1, Comet 2, Meteor 2, Nova
  3) only ever acted as a *minimum* — nothing stopped a Flash or Spark
  (meant to be flown solo) from having a different crewman in every one of
  its 4 positions.
- **Fix:** Crew size is now exact, not a minimum: assigning a crewman who
  isn't already on the ship is blocked if it would push the ship's distinct
  crew count past that number. Reassigning/swapping crew that keeps the
  total the same (or lowers it) is always allowed, so a full crew can still
  be freely reshuffled — only bringing in an *additional* new person beyond
  the required count is rejected.
- **Where:** `app.js` → `App.assignCrew()`, `shipCrewComplete()`.

### 2026-08-07 — Fixed: every position must be filled to race, and enforced positions-per-crewman cap
- **Bug:** A ship's crew requirement only ever checked the number of
  *distinct* crewmen assigned across its 4 positions against its Ship
  Class's Min Crew — it never actually checked that all 4 positions had
  someone in them, and it was just a colored warning, not enforced. A ship
  with 3 empty positions and one crewman in the 4th could still pass a Min
  Crew of 1 and be treated as fine.
- **Fix:** Every position (Pilot/Navigator/Spotter/Engineer) must now be
  filled for a ship to be race-legal — this is a hard requirement, not a
  warning: starting a race or locking declarations refuses and lists exactly
  which ships/positions are missing.
- **New rule:** the same crewman may fill more than one position, but
  how many is capped by the Ship Class's crew size — with 4 positions and a
  crew size of N, one person can hold at most 4-N+1 of them (the rest must
  go to at least N-1 other people). E.g. on a 2-crew (Comet) ship, one
  crewman can cover 3 of the 4 positions, but the 4th needs someone else; on
  a 1-crew (Flash/Spark) ship, one person can fly solo across all 4; on a
  3-crew (Nova) ship, no one person can hold more than 2.
- **Where:** `app.js` → `emptyPositions()`, `maxPositionsPerCrewman()`,
  `shipCrewComplete()`, `App.assignCrew()`, `App.beginRace()` / `App.lockDecl()`.

### 2026-08-07 — New: Hit Points (Frame Strength) and Damage Reduction (Armor / Compartmentalization)
- **Book default:** Hit Points default to Tier × 3; Damage Reduction
  defaults to 0.
- **Frame Strength (modifies Hit Points, pick one):**
  - Standard — no cost, no change.
  - Super-Light Frame — refunds Tier × 2 points; divides HP by 4 (rounded up).
  - Light Frame — refunds Tier points; divides HP by 2 (rounded up).
  - Heavy Frame — costs Tier points; multiplies HP by 2.
  - Super-Heavy Frame — costs Tier × 2 points; multiplies HP by 4.
- **Armor / Compartmentalization (modifies Damage Reduction):** Armor is a
  level (1 point per level) that adds directly to DR. Compartmentalization
  (pick one, independent of Armor) then multiplies the result:
  - Standard — no cost, ×1.
  - Reinforced Compartmentalization — costs Tier points; ×2.
  - Total Compartmentalization — costs Tier × 2 points; ×3.
  - Fortress Compartmentalization — costs Tier × 3 points; ×4.
  (DR = Armor level × Compartmentalization multiplier.)
- **Where:** `data.js` → `GDATA.FRAME_STRENGTH`, `GDATA.COMPARTMENTALIZATION`;
  `app.js` → `computeHitPoints()`, `computeDamageReduction()`.

### 2026-08-07 — New: Minimum Crew per Division
- **Book default:** Division stats (p.27) didn't have a tracked "minimum
  crew" number in this app before now.
- **House rule:** Each Division has a minimum number of *distinct* crewmen
  required to fill its 4 positions — one person can't multi-hat past this
  limit. Built-in values: Flash 1, Spark 1, Comet 2, Meteor 2, Nova 3.
  (Superseded by the "exact number, not just a floor" entry above — this is
  now also a ceiling, not only a minimum.)
- **Where:** `data.js` → `crew` field on each `GDATA.SHIP_CLASSES` entry.

### 2026-08-07 — New: Custom Ship Classes use the same point-buy costing as crew
- **House rule:** A custom Ship Class costs points the same way a crewman's
  skills do (p.25: `score + 10/Advantage` or `score − 5/Disadvantage`) across
  Acc, Spotter, Navigator, and Pilot — Acc simply has no Advantage/
  Disadvantage term. Worked example: Acc 6, Spotter 2A, Navigator 5D, Pilot
  10A costs 6 + (2+10) + (5−5) + (10+10) = 38.
- **Tied to Division:** A custom class must pick which Division it's legal
  for; Tier, Damper, and Min Crew all come straight from that Division's own
  book stat block and aren't independently editable.
- **Spark lock:** Per the book's own Spark entry (Ship AI Score already 0
  across the board), any custom class legal for the Spark Division has its
  Spotter/Navigator/Pilot AI **Score** forced to 0 — only their Advantage/
  Disadvantage stays editable.
- **Where:** `app.js` → `shipClassTotalCost()`, `App.updateShipClassDivision()`.

### 2026-08-06 — New: Skipping Engineer/Spotter/Navigator counts as a Failure ("Play It Safe")
- **Book default:** The book already states "Skipping this phase is the same
  as a Failure" for Engineer, Spotter, and Navigator (Navigator adds "unless
  the Racemaster determines the pilot can see the destination"), but the app
  had no explicit way to decline a roll — you always had to roll to produce
  a result.
- **House rule / automation:** Engineer, Spotter, and Navigator now have a
  "Play It Safe" button alongside "Roll X" (labeled "Skip" when this was
  first added — see `APP_CHANGES.md` for the rename). Playing it safe
  produces a Failure result with no dice: a plain -1 Disadvantage grant,
  using the same target rules as a rolled Failure (never the Critical/Fumble
  fixed-choice options, since it can't crit or fumble). The Navigator's book
  exception for "pilot can see the destination" is left to the Racemaster's
  judgment — simply don't use it in that case.
- **Where:** `app.js` → `skipPhase()`, `App.doSkipPhase()`.

### 2026-08-06 — New: Engineer/Spotter Critical Success and Fumble grants are now a fixed choice
- **Book default:** On a Critical Success or Fumble, the Engineer may apply 2
  levels of Advantage/Disadvantage to *any one* of Spotter, Navigator, or
  Pilot; the Spotter may apply 2 levels to *any one* of Navigator or Pilot
  (p.33). Ordinary Success/Failure still grant 1 level to any allowed target.
- **House rule:** On a Critical Success or Fumble specifically, the Engineer
  and Spotter no longer have a free choice of target. Instead:
  - **Engineer** chooses between **1 level** (Advantage on Crit, Disadvantage
    on Fumble) to the **Pilot**, **2 levels** to the **Spotter**, or **2
    levels** to the **Navigator**.
  - **Spotter** chooses between **1 level** to the **Pilot** or **2 levels**
    to the **Navigator** (it has no downstream position of its own to boost).
  Ordinary Success/Failure results are unchanged (1 level, free choice among
  the normal allowed targets). The Navigator's own grant is unaffected — it
  always targets the Pilot regardless of outcome, exactly as before.
  **Superseded 2026-08-07:** this is no longer a live choice made after
  seeing the Crit/Fumble — the target (and therefore which of these amounts
  applies) is locked in before rolling at all; see the entry above.
- **Where:** `app.js` → `applyGrant()`.

### 2026-08-06 — New: Speed Bonus for declared Acceleration
- **Problem:** As written, Net Leg Acceleration (Damper − Acceleration) only ever
  hurts you for running above your Damper rating and only ever helps you for
  running below it (better Advantage/Disadvantage dice), with nothing else tying
  actual speed to the outcome. Since the Pilot Task Check alone decides who wins
  the Leg, the "optimal" play was always to declare the lowest possible
  Acceleration — backwards for a racing game.
- **House rule:** The Pilot's declared Acceleration for the Leg adds a flat
  **Speed Bonus of ceil(Acceleration ÷ 2)**, but only to a separate ranking
  score — never to the Task Check itself. Concretely: the dice pool is rolled
  and resolved against the Leg TN exactly as written in the book (chosen die
  + skill, with the existing Damper-based Advantage/Disadvantage on the dice
  pool) — Success/Failure and Critical Success/Fumble all come purely from
  that roll, completely untouched by Acceleration. Only after that TN check
  is resolved does the Speed Bonus get added, once, to produce a **Leg
  Ranking Score** (Task Check total + Speed Bonus). That Ranking Score — not
  the raw Task Check total — is what determines the Base Leg Result and who
  actually wins the Leg in Phases VII–IX. So "did you succeed on this Leg"
  is pure skill/crew performance; "who crossed the line first among those
  who succeeded" additionally rewards raw speed. Damper is untouched and
  still governs only crew comfort/dice quality, never speed itself. Rounds
  up, so odd G values still grant something (e.g., 11-G → +6).
- **Why halved, not raw Acceleration:** Raw Acceleration was tried first and
  rejected — Nova ships (max 18-G) could add +18 to a roll, single-handedly
  clearing almost any TN regardless of skill. An alternative using
  `(Acceleration − Damper)` was also rejected: because Damper scales up with
  Division about as fast as max thrust does, that formula caps out around the
  same small range (roughly +3 to +5) for every Division, erasing the
  advantage a more powerful engine (e.g., Nova) is supposed to have over a
  weaker one (e.g., Flash). Halving raw Acceleration keeps bigger engines
  meaningfully ahead (Flash +2 max vs. Nova +9 max) without letting the top
  tier trivialize every check.
- **Where:** `app.js` → `speedBonus()`, `results.pilot.rankTotal`.

### 2026-08-06 — Flash Division Damper Rating raised to 1-G
- **Book default:** Flash-class Damper Rating = 0-G (p.27, Division table).
- **House rule:** Flash-class Damper Rating = 1-G.
- **Effect:** Flash skimmers can pull 1-G before crews start taking
  Uncompensated G-Force Resistance checks (Phase II), instead of needing a
  Resistance check at any acceleration above 0.
- **Where:** `data.js` → `GDATA.SHIP_CLASSES.Flash.damper`.
