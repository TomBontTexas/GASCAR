# GASCAR — App Changes & Bug Fixes

This file tracks changes to the **software** — UI, architecture, workflow
features, and bug fixes — as opposed to changes to the **game's rules**.
Changes to *Warp Space: GASCAR*'s rules (revised numbers, new mechanics,
automation of a rule) belong in `RULE_CHANGES.md`, not here.

The test: does this entry change something a player or Racemaster needs to
know to run/play the race correctly? If yes, it belongs in `RULE_CHANGES.md`
instead. If it's about how the software is built, organized, or displays
things — with no effect on the actual game numbers or requirements — it's
here.

Newest entries at the top.

---

### 2026-08-25 — Fixed three more hex Slip bugs: wrong distance metric, a wrap-seam exploit, wrong scoring through curves
- **Bug #1, found via a user-annotated screenshot (numbered 1-7 showing the
  ship should have ended much farther along than it did):** the previous
  day's fix (below) scored Slip candidates via `hexLoopQ()`, a fraction of
  each lane's own total hex count. At most positions along a straight, a
  Slip's landing hex in the next lane has TWO valid choices — the
  structurally-same hex, or the one just past it — and the second carries a
  real extra hex of forward progress. But going to a LONGER lane makes that
  fraction slightly SMALLER even for the "no progress" choice (same
  numerator, bigger denominator), and the modular wraparound needed to
  handle genuine lap completions misread that tiny decrease as "advanced
  almost a full lap" — an artifact worth close to 1.0, dwarfing the
  genuinely-better candidate's small real advance. The DP, maximizing that
  broken score, picked the do-nothing candidate every time. Traced and
  confirmed directly against the user's own JSON export (movement=7,
  slipHexes=5): the fix now reaches hexPos 7, exactly matching the user's
  hand-numbered correct path.
- **Fix for #1:** replaced `hexLoopQ()`/`hexQAdvance()` with
  `hexStepAdvance()` — scores each atomic step directly (forward = always
  +1; a Slip step = the real hex-index delta between the hex it leaves and
  the hex it lands on) instead of subtracting two lane-relative fractions.
  No per-lane normalization needed; it's a direct hex-adjacency fact, not a
  cross-lane comparison. (This specific "raw index delta" scoring choice
  turned out to have its own bug once a Leg's Slip crossed a curve — see
  Bug #3 below, found the same day.)
- **Bug #2, found while verifying #1's fix:** with the new metric, the DP
  started reporting `lapsGained: 5` from a single 7-hex Leg — impossible
  (a lap is 60-90 hexes). Root cause: the ring closing back on itself makes
  a hex right at the START of one lane's walk also true-hex-adjacent to a
  hex right at the END of the neighboring lane's ring (confirmed directly —
  both are exactly one hex-width apart in real pixel coordinates). That's
  genuine (q,r) adjacency, but not "the same real position one lane over" —
  taking it let the DP chain through several lanes' own wrap points,
  collecting a huge fake score for barely moving at all.
- **Fix for #2:** `circTrackGeometry()`'s `slipNeighbors` construction now
  excludes any candidate whose structural leg-position (completed legs +
  fraction through the current leg — computed once per hex, not used for
  scoring) differs from the source hex's by more than 1.5. A real corner
  candidate never drifts by more than a fraction of 1; the wrap-seam
  artifact drifts by nearly a full 6-leg lap, so the threshold cleanly
  separates them without touching any of the proven ring geometry.
- **Bug #3, found via a user-flagged race where a heavy INWARD Slip through
  a curve landed far short of a demonstrably better path the user worked
  out by hand (hugging the inside line through the curve, gaining ground
  exiting it):** `hexStepAdvance()`'s raw hex-index delta (Fix for #1,
  above) is correct on the straights, where the two lanes' indices track
  closely (deltas of 0/1) — but wrong on the curves. A curve leg's length
  scales with the lane's own ring level directly (`k`, not `k+straightLen`
  the way a straight does), so the exact same real structural position can
  be several raw index numbers apart between adjacent lanes partway
  through a curve. Confirmed directly: lane 6 hexPos 68's only real
  neighbor in lane 5 is hexPos 64 — a structurally-neutral lane change
  (`hexLegOffset` identical on both ends, 4.0000 = 4.0000) that the raw
  index math nonetheless scored as **−4**, a fake heavy penalty pushing the
  DP away from exactly the inside-line move that should have been free (or
  better) — the opposite of the real Slingshot-style advantage of hugging
  a turn's inside line.
- **Fix for #3:** `hexStepAdvance()` now scores every step — forward and
  diagonal alike — as the change in `hexLegOffset()` (completed legs +
  fraction through the current leg, the same structural measure already
  used to filter `slipNeighbors` for Bug #2) instead of a flat +1 for
  forward and a raw index delta for diagonal. `resolveSlipPath()`'s forward
  step now scores against the *unwrapped* `hexPos + 1` rather than the
  wrapped result of `stepForward()`, so a lap-completing step reads as a
  clean +1 full lap instead of a huge fake regression back to hexPos 0.
  Re-verified against the user's own JSON export (movement=19 — a 14 base
  + 5 Slingshot bonus, inward Slip 5, through a full curve): the fix now
  lands exactly 2 hexes further than before, matching the user's own count
  ("moved an extra 2 hexes with 19 MP") — confirmed the true optimum via
  brute force, not just a different answer.
- All three fixes independently re-verified against the 28-scenario
  exhaustive brute-force proof (`test_brute_force_dp.html`) and the full
  existing hex test suite (integration, finish-leg, cosmetic, adjacency,
  migration, and the real exported-race reproduction) — all still pass.

### 2026-08-24 — Fixed hex Slip resolution: reinstated the longest-path DP
- **Bug, found via real user testing (a "Show Last Leg" screenshot showing a
  Slip that clearly could have covered more ground):** the initial hex
  conversion shipped a "Slip hexes happen first, then forward" fixed rule,
  reasoning that since every hex is the same real size, no interleaving
  could cover more distance than another. That reasoning has a hole: step
  LENGTH is uniform, but step DIRECTION depends on which lane/ring you're
  currently on, so different interleavings of forward-vs-diagonal steps
  land on genuinely different FINAL hexes — some further along the track
  than others. Verified directly against the reported race's actual data:
  every ship's Leg landed exactly on its recorded position either way (the
  fixed-order rule was internally consistent, just not optimal), confirming
  this was a real missed-optimization, not a corrupted-path bug.
- **A dead end hit while fixing it, reverted:** tried changing
  `traceLaneRing()`'s straightaway legs from `k+straightLen` (`k` = that
  lane's own ring level) to a plain constant `straightLen`, reasoning it
  would make cross-lane comparison trivial and match an intended "same
  straight length for every lane" design. This broke ring nesting — hex-ring
  corners aren't at radius-independent offsets the way a circle's are, so a
  fixed-length straight leg starting from a k-dependent corner drifted out
  of alignment with the next lane's ring. Caught by a "no hex shared between
  two lanes" test before shipping; reverted back to `k+straightLen`. Lane
  growth stays +6 hexes/lap, as it always was.
- **Fix:** `resolveSlipPath()` is a longest-path DP again (same structure as
  the original square-grid one, and the same DP guarantee), comparing
  candidates by real progress instead of a fixed order. (The specific
  distance metric shipped this day — `hexLoopQ()`, a fraction of each
  lane's own total hex count — turned out to have its own bug, caught the
  next day and replaced; see the 2026-08-25 entry above.) Proven optimal
  against a 28-scenario exhaustive brute-force search
  (`test_brute_force_dp.html`), not just spot-checked. See RULE_CHANGES.md
  for the rule-level writeup.
- `buildCircularLegWaypoints()` now also snaps just the FINAL waypoint of a
  replayed Leg to its authoritative recorded position if the algorithm has
  changed since that Leg was recorded (as just happened) — keeps old Legs'
  replay animation from ending somewhere other than the ship's real
  position, even though the lead-up path may not be a perfect re-derivation.

### 2026-08-24 — Hex track cosmetic tweaks: starting-line placement, curve shading
- **Starting line:** each lane's starting-line tick is now drawn as that
  hex's own FRONT edge — the real spine facing the direction of travel
  (`hexFrontEdge()`, using a fixed corner-pair lookup per `HEX_DIRS`
  direction) — instead of a line cut through the hex's center.
- **Curve shading:** curve (end-cap) hexes now render in a darker grey
  (`.circcell.curve` in style.css) so the two curved ends read as visually
  distinct from the straightaways at a glance. Straight hexes are unchanged.
  Also brightened the curve hexes' own grid-line stroke (`#6b7080`, up from
  the shared `--border`) — the default border color was too close in
  brightness to the new darker fill to actually see individual hexes.

### 2026-08-24 — Circular Track rendering engine rebuilt on a real hex grid
- **Engine rewrite (see RULE_CHANGES.md for the rule-level details):** the
  entire square/trapezoid rendering and movement engine was replaced with a
  genuine axial hex grid (`traceLaneRing()` in `app.js`), fixing the
  lane-to-lane misalignment that sank an earlier hex attempt. The game's
  rules haven't changed in substance — Slip, Slingshot, Crowded Field,
  Maneuver range, the staggered start, and the Fail/Fumble Movement-halving
  all still work — only the underlying grid and a few field names
  (`squarePos`→`hexPos`, `slipSquares`→`slipHexes`, `innerSquares`→
  `innerHexes`) changed. `resolveSlipPath()`'s longest-path DP (added
  2026-08-20 for the square grid) still runs, now comparing candidates via
  a hex-native loop-position metric instead of continuous real-arc-length —
  see RULE_CHANGES.md's entry for why a uniform hex grid still needs it
  (an earlier version of this entry incorrectly claimed it didn't; caught
  and fixed the same day).
- **Breaking change:** any existing Circular Track course, and any race in
  progress on one, is cleared on first load after this update (old
  square-grid positions don't map onto hex positions). Straight/Legs
  courses and races are untouched. One-time migration, see
  `migrateState()`'s `_circularTrackHexed` flag.
- Verified with ~80 headless-Chrome tests covering hex-ring construction (no
  gaps, no overlaps, correct orientation), Slip/Slingshot/Crowded Field/
  Fail-Fumble-halving behavior driven through the real `finishLeg()`, the
  clean-break migration (old circular races cleared, straight races and
  fresh hex races both left untouched), and a full click-through of every
  tab.

### 2026-08-23 — Added an Introduction tab
- **Feature:** a new first tab, "Introduction," holding the book's front
  matter/flavor text and lore (GASCAR's history, the Divisions/Circuits
  structure, Flash Division skimmer racing, Sponsors, and the Combat rule)
  — pure world-building content, no interactive elements. `renderIntroduction()`
  in app.js; new `.flavortext`/`.introcaption` styles in style.css for the
  dramatic opening lines and the image-caption-style aside.

### 2026-08-23 — Instructions tab updated for this session's rule/feature changes
- **Fix/update:** the Circular Track paragraph had fallen behind several
  rule changes made this session — it still said flat "1 Level of
  Disadvantage" for Crowded Field (now scales per ship sharing the square),
  used the stale term "Leg Finishing Score" (the actual UI term is "Leg
  Ranking Score"), and never mentioned the Pilot Fail/Fumble Movement-halving
  or the Slingshot bonus Movement rule at all. Rewrote that paragraph to
  cover all of it, and added a line under "Race — run it" documenting the
  "Show Last Leg"/"Show Entire Race" replay and its path-trail dots (also
  new this session, never previously mentioned in-app). Also dropped a
  leftover "(see RULE_CHANGES.md)" citation from the Circular Track
  paragraph — the Instructions tab is user-facing; pointers to the dev
  changelog files don't belong there.

### 2026-08-23 — Race replay path trail: dot at square center instead of outlined square
- **Feature:** on the Circular Track's "Show Last Leg"/"Show Entire Race"
  replay, each ship's path trail now drops a small colored dot at the center
  of every square it passes through, instead of recoloring that square's
  whole outline. Reads more like a breadcrumb trail and less like it's
  flagging/selecting the square itself.
- **How:** `paintReplayTrailCell()` (recolored a `.circcell` polygon's
  stroke) replaced with `paintReplayTrailDot()`, which computes the square's
  center via the same `squarePosToQ()`/`stadiumPoint()` math
  `circRacerTransform()` already uses to place the ship icon itself, and
  appends an SVG `<circle>` there instead. `REPLAY_TRAIL_CELLS` ->
  `REPLAY_TRAIL_DOTS`; clearing on click now just removes the dot elements
  rather than resetting inline stroke styles.

### 2026-08-23 — v0.02.04 — Made the new-version banner check work under local file://, too
- **Bug:** `startUpdateCheck()` used `fetch("app.js")` to re-check for a
  newer deploy, but `fetch()` is blocked for local `file://` pages (Chrome
  treats it as a cross-origin request and refuses it), so the check silently
  never ran when testing against the local copy — needed for verifying a fix
  before pushing.
- **Fix:** split the version number out into its own tiny `version.js`
  (`var LATEST_APP_VERSION = "..."`, not `const`, so it can be safely
  re-injected) and switched the check from `fetch()` to dynamically creating
  a `<script src="version.js?<cachebust>">` tag — the same loading mechanism
  index.html already uses for app.js itself, which isn't subject to the
  file:// CORS restriction. `app.js`'s `APP_VERSION` constant now reads
  `LATEST_APP_VERSION` from that file instead of hardcoding its own copy, so
  there's still only one place to bump the version. Bonus: the live site now
  re-checks a one-line file instead of re-downloading all of app.js.

### 2026-08-23 — v0.02.02 — Fixed the new-version banner showing permanently, even locally
- **Bug (supersedes the "New-version banner" entry below — that feature
  never actually worked as shipped):** `.update-banner { display: flex; ... }`
  in style.css had no `[hidden]` override. An author stylesheet rule beats
  the browser's own default `[hidden] { display: none }` rule whenever both
  apply to the same element, so the `hidden` attribute `startUpdateCheck()`
  toggles in app.js was silently ineffective — the banner rendered
  unconditionally from page load, even on the local `file://` copy where the
  version-check code returns immediately and never runs at all.
- **Fix:** added `.update-banner[hidden] { display: none; }` before the
  unconditional rule -- two selectors beats one, so it wins regardless of
  source order, and `hidden` now actually hides the element again.

### 2026-08-23 — New-version banner for tabs left open across a deploy
- **Feature:** a gold banner now appears at the top of the page ("A new
  version (vX.Y.Z) is available...") with a Refresh Now button, if this
  browser tab is still running an older `APP_VERSION` than what's currently
  deployed. Without this, a tab left open across a GitHub Pages deploy had
  no way to learn a newer version existed short of a manual hard refresh.
- **How it works:** `startUpdateCheck()` (app.js) re-fetches the deployed
  `app.js` itself with `cache: "no-store"` (bypassing the browser/CDN
  cache), regexes out its `APP_VERSION`, and compares it to the version
  already running. First check 5 seconds after load, then every 5 minutes,
  plus once whenever the tab regains focus (`visibilitychange`) — covers a
  tab left backgrounded for a long stretch without waiting for the next
  timer tick. Skipped entirely under `file://` (no server to poll against).
  Network errors are swallowed silently and just retried next tick.

### 2026-08-23 — Added an app version number, starting at 0.02.01
- **Feature:** a small `v0.02.01` line now shows at the top of the
  Instructions tab. Tracked in a single `APP_VERSION` constant near the top
  of `app.js`.
- **Versioning scheme:** bump the middle number for a change that adds a new
  feature or features; otherwise bump the last number for a bug fix.

### 2026-08-23 — Phase 0 Declare modal's "Current Leg Pilot Mk" omitted Crowded Field
- **Bug:** the Declare Intentions modal's Pilot Mk preview (added so a Pilot
  could see carried-in Advantage/Disadvantage before choosing Acceleration)
  called `netForPosition(ps, disp, "pilot", 0)` — passing `extra: 0` instead
  of the ship's `ps.crowdedFieldD`. Phase VI's actual resolution always
  included Crowded Field correctly; only this earlier preview was wrong, so
  a Pilot declaring Accel while sharing a square could see a Mk that didn't
  match what Phase VI would use.
- **Fix:** pass `ps.crowdedFieldD` as the `extra` term. It's safe to include
  here (unlike `netLegAcc`/`slipAdvantage`, which stay at 0 until
  `lockDeclarations()` because they depend on choices made in this same
  modal) because `crowdedFieldD` is already fully known — set once in
  `initLegState()` before Phase 0 even starts, from how the previous Leg
  ended.

### 2026-08-21 — Fixed `resolveSlipPath()` locking in a suboptimal Slip path (greedy → longest-path DP)
- **Bug (no rule changed — this is about correctly computing the existing
  "maximize real distance covered" rule, see RULE_CHANGES.md's Slip
  entries):** `resolveSlipPath()` decided forward-vs-diagonal at each
  atomic step by comparing only that ONE step's immediate real-distance
  gain. A locally-bigger choice right now can lock the ship out of a much
  bigger gain two steps later — reported via a replay trail that visibly
  hugged a curve's inner squares instead of the wider, faster arc it could
  have taken. Verified against an independent brute-force search: on a
  5-lane/40-inner-square track, the old greedy path covered 236 real
  distance units where the true optimum is 321 — a 36% shortfall. The
  6-lane/50-and-70-square courses used in most of this session's earlier
  testing happen to have an evenly-spaced curve-count progression that
  masked the bug entirely, which is why it slipped through until a
  differently-proportioned track exposed it.
- **Fix:** replaced the one-step greedy comparison with a longest-path DP
  — the same technique as Dijkstra's shortest-path DP, just keeping the
  maximum instead of the minimum at each state. The state at step *i* is
  fully described by *k* = how many of the declared Slip's diagonal hops
  have been used so far (the lane at that point is just `originLane +
  dir*k`, no other freedom), so only the best (max real distance)
  candidate per (i, k) needs to be kept — provably lossless here because
  real distance strictly increases with squarePos within a lane, so
  "furthest along" at a given state also dominates every possible future
  step from it. Verified against exhaustive brute force (291 lane/square/
  movement/Slip combinations, exact match every time) and confirmed the
  new DP never covers less real distance than the old greedy algorithm did,
  anywhere.
- **Follow-on fix, same change:** the old greedy silently used FEWER
  diagonal squares than declared if a lane boundary made the full amount
  unreachable (defensive handling for malformed/legacy history records fed
  in by `buildCircularLegWaypoints()`'s exact-resimulation replay path) —
  the new DP initially required reaching the FULL declared amount and
  crashed instead, which broke replay reconstruction for some in-progress
  races. Restored the same graceful degrade: if the exact declared amount
  turns out unreachable, fall back to the largest amount that is.
- Lives in `resolveSlipPath()` in `app.js`; used uniformly by `finishLeg()`,
  `lockDeclarations()`'s curve-touch projection, and
  `buildCircularLegWaypoints()`'s replay reconstruction.

---

### 2026-08-21 — REVERTED same day: Phase VI Pilot card's Crit Bonus/Fumble Penalty lines
- An earlier entry here said these lines were removed from the Leg Ranking
  Score display, following from a same-day rule-change entry that turned
  out to be a misread of the user's actual request (see RULE_CHANGES.md's
  "Base Leg Result" entry) — the user meant a different, separate score
  (`ls.baseLegResult`, the shared NPC baseline), not each Hero's own Leg
  Ranking Score. The card's "+ Crit Bonus N (...)" / "− Fumble Penalty N
  (...)" lines were restored to exactly how they always worked; nothing
  about the card's Crit/Fumble display actually changed in the end.
- Lives in `renderPhaseRollBlock()` in `app.js`.

---

### 2026-08-21 — Phase VI Pilot card's Leg Ranking Score now also previews the Slingshot bonus
- Same treatment as the halving fix below, extended to the new Slingshot
  rule (see RULE_CHANGES.md): when the declared Slip is inward and
  touches a curve, the card chains a preview onto the same Leg Ranking
  Score line — e.g. "Speed Bonus 14 = **14 ÷2 (Failed, rounded up) = 7 +
  Slingshot 3 (3 squares Slipped inward through the curve) = 10**" — so
  the card's final number matches what `finishLeg()` will actually apply,
  including the case where the halving shrinks the Movement available and
  clamps the previewed Slingshot squares down with it.
- No separate explanatory line — chained inline the same terse way as
  Crit Bonus, Fumble Penalty, and the halving before it.
- Lives in `renderPhaseRollBlock()` in `app.js`.

---

### 2026-08-21 — Phase VI Pilot card's Leg Ranking Score now shows the actual halved Movement on a Fail/Fumble
- **Reported:** a Circular Track ship Failed its Pilot Task Check (Speed
  Bonus 14) and correctly only moved 7 squares on the track once the Leg
  resolved, but the Phase VI card's "Leg Ranking Score" still just showed
  "Speed Bonus 14 = 14" with no indication the Pilot Fail/Fumble house
  rule (see RULE_CHANGES.md, 2026-08-21) was about to halve it — the card
  and the actual result on the board disagreed.
- **Fix:** the halving is now folded directly into the Leg Ranking Score
  line itself, the same terse way Crit Bonus and Fumble Penalty are
  already shown there, rather than as a separate explanatory line — e.g.
  "Leg Ranking Score: Speed Bonus 14 = **14 ÷2 (Failed, rounded up) = 7**".
  Computed from the same already-Fumble-Penalty-reduced `rankTotal` the
  rest of that line shows.
- Lives in `renderPhaseRollBlock()` in `app.js`.

---

### 2026-08-20 — Fixed the replay trail skipping a square on every lane shift, for Legs reconstructed from an earlier rule version
- **Bug:** reported via screenshot — a ship's path visibly skipped one square
  every single time it changed lanes, a consistent, repeatable pattern (not
  random noise). Only affected Legs `buildCircularLegWaypoints()` has to
  reconstruct approximately, because they were recorded under an earlier
  version of the Slip rule (this rule has changed several times today, and
  an in-progress race mixes Legs recorded under different versions of it) —
  a Leg recorded under today's exact rule already reconstructs perfectly via
  a direct re-simulation (see RULE_CHANGES.md's `resolveSlipPath()` entry).
- **Root cause:** the fallback reconstruction for a mismatched/legacy Leg
  interpolated the lane change as a straight line in real arc-length (Q)
  space, dividing the total distance into equal fractions — one per lane
  crossed. But adjacent lanes' squares are only *close to*, not exactly, the
  same real length (see `curveSplitForCourse()`), so an equal fraction of
  the total doesn't correspond to "exactly one square" in every intermediate
  lane — it systematically over- or under-shot by roughly the same amount
  on every hop, which floor-based square lookup then consistently rounded
  the same way each time.
- **Fix:** replaced the continuous interpolation with a fully discrete walk
  using the same exact `stepForward()`/`stepDiagonal()` primitives
  `resolveSlipPath()` itself uses everywhere else (forward through the
  origin lane, then one diagonal hop per lane crossed) — no floating-point
  approximation at all, so every step is a genuine, gapless, corner-touching
  move by construction. Only the very last waypoint is snapped to the Leg's
  authoritative recorded position, in case the historical rule that produced
  it genuinely disagrees with today's — a single possible discontinuity at
  the endpoint only, instead of a compounding one on every hop.
- Code: `buildCircularLegWaypoints()`'s fallback branch in `app.js`.

### 2026-08-20 — Fixed "Finish Leg & Update Board" crashing on any Circular Track race with an NPC
- **Bug:** reported as "Finish Leg & Update Board button not working" — clicking
  it did nothing, because `finishLeg()` was throwing `Cannot read properties
  of undefined (reading 'slip')` and dying silently (no visible error, no
  update to the board). Root cause: today's Slip-resolution refactor (see
  RULE_CHANGES.md, `resolveSlipPath()`) moved a `ps.slip === "left"` check
  out from inside an `if (actualSlipSquares > 0)` guard, where it was
  previously unreachable for a participant with no Slip declared. `ls.perShip`
  only has entries for HERO participants (NPCs have no Declare Intentions
  step at all), so `ps` is `undefined` for any NPC — meaning this crashed on
  literally every Circular Track race that included an NPC, as soon as the
  Leg was finished.
- **Fix:** guarded the check as `(ps && ps.slip === "left")`, matching the
  guard already used one line above it for the same reason.
- Code: `finishLeg()` in `app.js`.

### 2026-08-20 — Fixed a disconnected jump in the replay trail for pre-rework Legs
- **Bug:** reported via screenshot — the new path trail (see below) showed a
  ship's color simply vanish from one lane and reappear in another, with no
  connecting diagonal squares between them, unlike every other lane change.
  Root cause: `buildCircularLegWaypoints()` has a separate reconstruction
  path for history records from BEFORE today's forward-then-Slip rework
  (identified by having no `slipSquares` field at all) — under the OLD rule,
  a lane change was an instant hop at Declare time with no forward movement
  in the origin lane, so that branch drew the Leg's entire movement inside
  the destination lane only, with nothing at all in the origin lane during
  the lane change itself.
- **Fix:** the lane change in that legacy branch is now ALSO
  diagonal-interpolated (the same real-arc-length technique the modern
  branch already used), landing on the entry point into the new lane
  instead of the Leg's final position — so old Legs now show a connected,
  corner-touching path across every lane crossed, exactly like a Leg
  recorded under today's rules, while still not walking any of the Leg's
  movement through the origin lane first (which would overshoot and need to
  jump back — the original reason this branch existed).
- Code: `buildCircularLegWaypoints()` in `app.js`.

### 2026-08-20 — Leg replay now leaves a colored path trail per ship
On a Circular Track, as `App.playRaceReplay()` steps a ship through a square
during a replay ("Show Last Leg" or "Show Entire Race"), that square's
outline is recolored in a color unique to that ship (cycling through an
8-color palette by participant index), so each racer's actual path through
the Leg — including any Slip's diagonal lane change — stays visible on the
track after the replay finishes. Clicking anywhere on the page clears every
colored square back to normal. Each track cell got a stable id
(`circcell-<lane>-<squarePos>`, added in `renderCircularTrackSvg()`) so the
replay can look a given square up directly; a normal `render()` still
rebuilds the whole SVG from scratch, which drops any trail along with it.

### 2026-08-20 — Leg replay now runs at half speed
Both the Circular Track's per-square hop cadence and the Straight/Legs
board's per-Leg cadence (`App.playRaceReplay()`'s `squareStepDelay`/
`stepDelay`) are doubled — 100ms → 200ms per square hop, 600ms → 1.2s per
Leg — along with the matching CSS transition durations (`.circracer`,
`.boardfill`, `.boardicon`) they're kept in sync with, so replay motion
still flows without any pause between steps, just at half the original
speed. Applies to both "Show Last Leg" and "Show Entire Race."

### 2026-08-20 — Phase I card now starts collapsed each Leg
Phase I (Crew Task Check Modifications) is only relevant in an RPG-style
campaign and is otherwise unused, so it now defaults to collapsed at the
start of every Leg instead of open — one less card of noise to scroll past.
It can still be expanded manually via its own collapse button like any other
phase card; that just no longer persists into the next Leg (no phase card's
collapse state does).

### 2026-08-20 — Declare Intentions modal now shows the Pilot's current Leg Mk
- Added a "Current Leg Pilot Mk" column to the crew table in the Declare
  Intentions modal, next to Resistance Skill Mk. Shows the Pilot's effective
  Mk (crew skill + Ship AI, plus any Disadvantage/Advantage already carried
  into this Leg — e.g. from a Fumble in a prior Leg) so the Pilot can see
  where they stand before deciding what Acceleration to declare. Blank
  (em-dash) for crew who don't hold the Pilot position. Resistance, grants,
  and Maneuvers-received aren't known yet at Declare time, so they aren't
  reflected here (they show up later in Phase VI's Leg Ship Skill Mk).

### 2026-08-20 — Circular Track progress bars now show % progress toward the finish line, not raw squares moved
- **Bug:** the Standings progress bar's required-distance denominator was
  `laps × that lane's own lap distance`, ignoring that every lane's starting
  stagger is specifically calibrated to make it need LESS than a full lap's
  worth of movement to reach the finish line the first time (that's the
  entire point of a staggered start — lane 1 and an outer lane need the SAME
  real movement to complete a 1-lap race, despite the outer lane's longer
  physical lap). The old formula understated outer-lane ships' true progress.
- **Fix:** required movement is now `laps × that lane's own lap distance −
  that ship's own starting stagger`. Lap completion itself (`p.laps`,
  the win condition) was already correct — only the progress bar's math was
  off.
- Also changed what the bar's text shows: a percentage (e.g. "62%") instead
  of a raw square count, since squares moved isn't a meaningful number on its
  own (different lanes need different totals) — percentage toward the finish
  line is. Straight — Legs courses are unaffected (still show points).
- **Where:** `app.js` → `renderStandings()`, `App.playRaceReplay()`'s
  `updateBoardsForLeg()`.

---

### 2026-08-19 — Fixed replay: a multi-square Slip cut diagonally across lanes instead of stepping through them one at a time
- **Bug:** reported with a screenshot showing the correct step-by-step curve
  path (white arrows) versus what the replay actually drew (a single red
  jump cutting across several lanes at once). A multi-square Slip's lane
  change was computed as ONE Q-preserved hop straight from the origin lane to
  the final lane -- geometrically valid (every lane at a shared Q is
  touching its neighbor) but visually a big diagonal cut across the
  intervening lanes instead of the square-by-square feel the rest of the
  replay uses, especially obvious mid-curve.
- **Fix:** `buildCircularLegWaypoints()` now generates one waypoint PER LANE
  crossed during a Slip -- a 5-square Slip animates as 5 separate one-lane
  hops (each Q-preserved from where the forward-only movement ended), not
  one hop to the final lane. Only the last hop uses the Leg's authoritative
  recorded position directly, so it still lands exactly where finishLeg()
  put it.
- **Where:** `app.js` → `buildCircularLegWaypoints()` (now takes a `geom`
  parameter), `App.playRaceReplay()` (passes it through).

---

### 2026-08-19 — Fixed ship icons sitting off-center in their squares on a Circular Track
- **Bug:** reported from a screenshot at race start -- every ship icon sat
  visibly shifted from its square (toward the square's trailing/left edge
  instead of centered), most noticeable against the yellow starting-line
  ticks. Squares on a straightaway are drawn spanning `[N*squareSpacing,
  (N+1)*squareSpacing)` (see `straightCellPoints()`), but `squarePosToQ()`
  was returning `N*squareSpacing` -- that square's LEADING edge, not its
  center -- for every straight square. Curve squares were unaffected; they
  already used the spine midpoint (a true center).
- **Fix:** `squarePosToQ()` now returns `(N+0.5)*squareSpacing` for straight
  squares, matching the center convention curve squares already used.
  Everything downstream that reads a racer's position through this function
  (the live SVG marker, the Slip's Q-preserving lane change, the Slip's
  curve-touch projection) shifts by the same consistent half-square amount,
  so nothing else needed to change.
- **Where:** `app.js` → `squarePosToQ()`.

---

### 2026-08-19 — Fixed replay glitch on old saved races: Slip Legs recorded before today's forward-then-Slip rework animated backward
- **Bug:** reported as "the replay shows it moving 16, backing up five, then
  slipping five" for a 16-movement/5-Slip Leg (expected: move 11, then Slip
  5). Reproduced with a Leg recorded under the OLD Slip rules (an in-progress
  race whose earlier Legs were saved before today's "Slip happens after
  forward movement" change) -- those history entries have no `slipSquares`
  field, so the replay was treating them as "0 Slip squares" and walking the
  FULL movement (16) forward in the origin lane before jumping back to the
  real (Q-preserved) landing square in the destination lane -- a large
  backward jump right before the Slip.
- **Fix:** `buildCircularLegWaypoints()` now checks whether a history record
  actually has a `slipSquares` field. Records from today's rework (which do)
  use the new forward-then-Slip reconstruction; older records that changed
  lanes without one fall back to the OLD hop-first-then-forward
  reconstruction, matching how that Leg's movement REALLY happened under the
  rules in effect when it was recorded. Old in-progress races keep replaying
  correctly without needing to be restarted.
- **Where:** `app.js` → `buildCircularLegWaypoints()`.

---

### 2026-08-19 — Added a "Show Last Leg" replay button next to "Show Entire Race"
- New button on the Standings card, alongside the existing full-race replay,
  that plays back only the most recently completed Leg instead of the whole
  race from the start.
- Reuses the same replay machinery: boards/icons snap to their state as of
  the end of the Leg *before* the last one (instead of 0%), and — on a
  Circular Track — each racer's marker snaps to its own position from just
  before the last Leg (instead of the true starting line) before animating
  forward square by square as usual. A participant that dropped out earlier
  in the race and has no waypoints that recent stays put at its last real
  position rather than jumping back to the start.
- Both buttons disable each other while either replay is running, so the two
  can't animate over top of one another.
- **Where:** `app.js` → `App.playRaceReplay()` (new `lastLegOnly` param),
  `renderStandings()` (new `raceReplayLastLegBtn`).

---

### 2026-08-19 — Leg TN display shows "capped from N" whenever the Leg TN cap actually bound
- Reported as "TN has been 21 for four Legs in a row" -- confirmed this is
  the Leg TN cap (highest Ship Pilot Mk + 18, see RULE_CHANGES.md) binding on
  nearly every Leg, not a caching/reroll bug (Tier/Feature were verified to
  still reroll normally each Leg). For a low Pilot Mk this cap sits low
  enough that most Tier rolls exceed it, so the SAME capped number shows up
  Leg after Leg -- expected given the rule, but with no prior visibility into
  when/how often it was actually kicking in.
- The Leg header now adds a `capped from N` tag next to the Target Number
  whenever the pre-cap value (recovered from the Leg's own
  `tnTierMod`/`tnTnMod`/`baseTN`, whichever `finalMode` is in play) is higher
  than what's actually shown -- so it's immediately visible when the cap is
  the reason a Leg's TN looks unchanged, versus a Leg that would have rolled
  that TN anyway.
- **Where:** `app.js` → `legNaturalTN()`, `renderRace()`.

---

### 2026-08-19 — Circular Track: "Show Entire Race" now walks each Leg square by square instead of cutting a straight chord across curves
- Each Leg's move was ONE CSS-transitioned jump straight from the Leg's start
  position to its end position. On a straightaway that coincides with the
  track, but on a curve a straight line between two points on an arc cuts
  inside it -- visibly off the track, through the infield, for any Leg whose
  movement spanned much of a curve.
- Replaced with a per-square walk: `buildCircularLegWaypoints()` reconstructs
  every intermediate square a Leg's movement passes through (from the
  before/after `history` snapshots `finishLeg()` already records) and
  `App.playRaceReplay()` now animates through each one in turn, so the icon
  traces the actual curve instead of a chord. A Leg that included a Slip gets
  one extra leading waypoint for the lateral hop into the new lane (applied at
  Declare time, before that Leg's forward movement -- see `lockDeclarations()`),
  reconstructed from the recorded post-movement square since history doesn't
  store the intermediate post-slip one directly. Ships moving different
  distances the same Leg all still start and finish that Leg together — each
  one's own squares are spread across that Leg's shared step budget (set by
  whichever ship moved the most), so a slower ship simply finishes its Leg's
  hops early and holds position for the remainder.
- Per-square steps are quick (0.1s each, matching `.circracer`'s CSS
  transition exactly, same reasoning as the no-pause-between-Legs fix below)
  rather than the previous fixed 0.6s per whole Leg, so a Leg covering many
  squares doesn't take proportionally longer to feel sluggish.
- **Where:** `app.js` → `buildCircularLegWaypoints()`, `App.playRaceReplay()`.
  CSS: `.circracer` transition duration (`style.css`).

---

### 2026-08-19 — Circular Track: ship positions were visibly off (growing worse from lane 3 out); replay no longer pauses or spins between Legs; Phase VI caveat is Straight-course-only
- **Ship square position was inexact, worsening lane by lane.** `circRacerTransform()`
  placed a racer by converting its `squarePos` through the fraction of the
  lap's AVERAGE square size (`stadiumPerimeter(r)/laneSquares[lane]`), then
  snapping to the nearest decorative square. That average doesn't match the
  straight's own square width once a lane's curve squares differ enough in
  real size from the straight's — for the default course this was already
  off by about a whole square for lane 4, worse further out, which is what
  made the staggered starting line look uneven "from lane 3 and up." Replaced
  with `squarePosToQ()`, which indexes directly into the exact same
  straight/curve segment structure `renderCircularTrackSvg()` draws (no
  snapping needed — a square index maps to exactly one real position). The
  now-unused approximate snapping helpers (`snapQToCell()`/`snapStraightQ()`/
  `snapCurveAngle()`) were removed.
- **Ship icons appeared to spin instead of smoothly turning during replay.**
  `stadiumTangent()`'s formula for the left curved end-cap was a mathematically
  equivalent but numerically DIFFERENT branch (e.g. -180° instead of 180°) from
  the straight segments on either side of it — CSS's `rotate()` transition
  interpolates the raw numbers, so hitting that jump mid-transition animated a
  visible extra half-turn instead of the small actual turn. Reformulated to be
  numerically continuous across all 3 internal segment boundaries. The one
  remaining jump (once per lap, at the start/finish line) is handled
  separately: `circRacerTransform()` now optionally takes the racer's
  CURRENTLY-displayed rotation and re-expresses its answer as the closest
  equivalent (mod 360°) angle to it, so `App.playRaceReplay()`'s
  `circularSnapshotAt()` (which now passes this in, read off the racer `<g>`'s
  existing `transform`) never animates the long way around, for this or any
  other rotation source. This is what looked like ships "rotating instead of
  staying consistent" in their lanes — confirmed separately that a ship's
  `lane` genuinely never changes Leg to Leg without a declared Slip; there was
  no actual lane-tracking bug, only this rendering glitch.
- **"Show Entire Race" no longer pauses between Legs.** Its per-Leg step timer
  was 700ms while every animated element (`.boardfill`, `.boardicon`,
  `.circracer`) has a 0.6s CSS transition — the extra 100ms was a visible
  stop-and-settle before each Leg's move. Lowered to 600ms, matching the
  transition exactly, so the next Leg's move starts the instant the current
  one finishes.
- **Phase VI's Leg Ranking Score caveat** ("used only to determine who won
  the Leg — the d20 roll and Skill Score above do not count toward it") is
  now shown only on a Straight — Legs course. On a Circular Track this same
  score becomes movement in squares (see `finishLeg()`), not a Leg win/loss,
  so the "who won the Leg" framing doesn't apply there.
- **Where:** `app.js` → `squarePosToQ()`, `circRacerTransform()`,
  `stadiumTangent()`, `App.playRaceReplay()` (`stepDelay`,
  `circularSnapshotAt()`), `renderPhaseRollBlock()` (new `circular` param),
  `renderPhaseCrew()`/`renderPhaseVI()` (pass it through).

---

### 2026-08-19 — Circular Track: "hex"/"hexes" renamed to "square"/"squares" throughout
- Pure terminology rename, app-wide — no behavior or numbers changed. Follows
  from the tile grid rebuild below: the drawn tiles are squares and curved
  rectangles, not hexagons, so the vocabulary now matches what's on screen.
- Renamed identifiers: `LANE_HEX_INCREMENT`→`LANE_SQUARE_INCREMENT`,
  `laneHexesArray()`→`laneSquaresArray()`,
  `laneStartHexPos()`→`laneStartSquarePos()`, `hexPos`→`squarePos`,
  `startHexPos`→`startSquarePos`, `slipHexes`→`slipSquares`,
  `hexSpacing`→`squareSpacing`, course field `innerHexes`→`innerSquares`, plus
  matching UI labels/copy and DOM ids (`cInnerHexes`→`cInnerSquares`,
  `laneHexCol`→`laneSquareCol`, `previewLaneHexes()`→`previewLaneSquares()`).
  The `.circhex` CSS class is now `.circcell`.
- `migrateState()` carries forward any previously-saved course's `innerHexes`
  and any in-progress race's `hexPos`/`startHexPos`/`slipHexes` fields under
  their new names, so existing saved data isn't lost.
- Also removed `qFromA()`/`aFromQ()`/`gridVertex()`-era dead code left over
  from the old hexagon grid (superseded by the square rebuild below but never
  actually called by it).
- **Where:** `app.js` (throughout), `style.css` (`.circcell`).

---

### 2026-08-19 — Circular Track: starting line moved to each square's leading edge; ship icons sized to fit inside a square
- The yellow starting-line tick for each lane was landing on the **trailing**
  edge of that lane's starting square (the edge a ship enters from), not the
  square itself — a raw `squarePos` value is that square's trailing-edge Q,
  not its center or leading edge. Moved to the square's **leading edge** (the
  side nearer the direction of travel) by drawing it one square further along
  (`squarePos + 1`) than before.
- That first pass still didn't land the tick exactly on a grid line: it
  converted the square index through the GAMEPLAY lap fraction
  (`stadiumPerimeter(r)/laneSquares[lane]`), which is only the *average*
  square size across the whole lap and doesn't exactly match the straight's
  own square width (straight and curve squares are paced differently per
  lane -- see `curveSplitForCourse()`). Every starting square is within the
  shared straight, so the tick is now positioned directly against the
  DECORATIVE straight grid (`col * squareSpacing`) instead, which is exact.
- Ship icons were drawn at `1.2×` a straight square's own side length —
  larger than the square, overflowing into neighbors. Resized to `0.8×`,
  comfortably inside a square (curve squares run close to the same size by
  construction, so this fits there too) with room to spare.
- **Where:** `app.js` → `renderCircularTrackSvg()`'s starting-line loop,
  `circTrackGeometry()`'s `iconSize`.

---

### 2026-08-19 — Circular Track: tile grid rebuilt as squares + curved rectangles, one lane's tile count now differs from the next (supersedes the shared-vertex hexagon grid below)
- Requested change: each lane's decorative tile count must equal its
  gameplay hex count exactly (50, 54, 58, 62, 66, 70 — see RULE_CHANGES.md),
  not a uniform 50 for every lane. A single shared-vertex hexagon grid (the
  previous approach, below) fundamentally can't give neighboring lanes
  different subdivision counts and still share edges, so the whole tile grid
  was rebuilt around squares instead of hexagons:
  - **Straight tiles are true squares.** Since every lane's straight section
    has the same real length, all 6 lanes share one straight tile count `S`
    — so adjacent lanes' squares simply share an edge with no offset/phase
    math needed at all (no honeycomb stagger, unlike hexagons).
  - **Curve tiles are "curved rectangles"** (radial-sector trapezoids: two
    radial edges, two arc-chord edges), **equally sized within their own
    lane** -- lane 2's 11 curve tiles are each exactly 1/11 of that curve, not
    a mix of sizes (supersedes an initial "nested, close-to-equal" version of
    this same rebuild). Different lanes carry different curve tile counts (the
    lane-to-lane growth all comes from the curves — see RULE_CHANGES.md), so
    with every lane independently and evenly divided, neighboring lanes'
    radial edges generally land at different angles from each other.
    Gaplessness is guaranteed per shared boundary instead of a shared grid:
    the edge between lane R and lane R+1 is drawn from the UNION of both
    lanes' own angles in that stretch (`mergedBoundaryAngles()`), so whichever
    side has more subdivisions at any given spot, both sides trace the exact
    same points -- no sliver gap.
  - Straight and curve tiles use the identical radial half-band width, so the
    straight/curve transition needs no special-casing either (squares don't
    have the diagonal-vertex mismatch hexagons did there).
- Racer icons still snap to the center of whichever tile they're in
  (`circRacerTransform()`/`snapQToCell()`), now per-lane-aware on the curve
  since each lane has its own angle list there.
- **Where:** `app.js` → `curveSplitForCourse()`, `curveSpineSets()`,
  `straightCellPoints()`, `curveCellPoints()`, `circTrackGeometry()`,
  `circRacerTransform()`/`snapQToCell()`, `renderCircularTrackSvg()`. CSS:
  `.circhex` renamed to `.circcell` (style.css) since tiles are no longer
  hexagons.

---

### 2026-08-19 — Circular Track: hex grid rebuilt from shared vertices (fixes visible gaps in the curves)
- Independently-rotated regular hexagons (the previous approach) fundamentally
  can't tile a curve without gaps or overlaps: consecutive hexes were placed
  at equal arc-length steps and each individually rotated to face the local
  tangent, but as the tangent continuously turns between one hex and the
  next, two separately-rotated regular hexagons' facing edges are never
  exactly parallel/coincident — worse on tighter curves (i.e. worse on inner
  lanes), and visible even on outer ones (per the reported screenshot).
- Rebuilt from scratch as a true shared-vertex hex grid: every hex is defined
  by 6 vertices computed in a flat abstract (column, row) grid, and each
  vertex is mapped into real (x,y) individually. Two neighboring hexes
  reference the identical abstract vertex for a shared edge, so they always
  land on the exact same real point — gapless by construction, regardless of
  how distorted the mapping gets. In the curves that distortion is exactly
  the desired effect: row (lane) grid lines stay radially aligned, but real
  arc length per column grows with radius, so outer-lane hexes come out
  visibly stretched wider than inner-lane ones, not literally regular
  hexagons anymore.
- This needed a new coordinate, `Q` — arc length on the straights (same for
  every lane), raw swept angle (not scaled by radius) on the curves, so a
  radial column line crosses every lane at the same spot. Racer positions
  (which use real arc length along their OWN lane, for correct straight/curve
  proportions) convert into `Q` via the new `qFromLaneT()` before anything
  else touches them.
- Ship icons now snap to the center of whichever hex their position falls in
  (round their `Q` to the nearest grid column, then re-map that column's
  center), rather than sitting at a raw continuous position that might land
  anywhere within a hex — so icons stay centered even in a heavily-stretched
  curve hex.
- Where: `app.js` → `qLoopTotal()`, `stadiumPoint()`/`stadiumTangent()`/
  `isOnStraight()` (now take `Q`, not a per-lane arc length + radius),
  `qFromA()`/`aFromQ()`/`qFromLaneT()` (new), `hexGridVertex()`/
  `gridPointFromVertex()` (new), `circTrackGeometry()`, `circRacerTransform()`,
  `renderCircularTrackSvg()`, `lockDeclarations()`'s Slip straight/curve
  check (updated for the new signatures). Removed: `hexPolygonPoints()` (no
  longer needed — hex shape now comes entirely from mapped vertices).

---

### 2026-08-19 — Declare Intentions: Slip UI supports magnitude, plus a modal layout fix
- The Slip control in Declare Intentions now has a magnitude number input next
  to the direction dropdown (shown once a direction is picked), capped by both
  Movement Points and available lanes — see RULE_CHANGES.md for the underlying
  rule this drives. Changing direction re-renders so the input's max updates;
  the actual applied amount is always re-validated in `lockDeclarations()`
  regardless of what the input showed.
- Along the way, caught a layout bug: the Slip explanation text was a `<span>`
  sharing a `.formrow` flex row with the dropdown and number input. `.formrow`
  doesn't wrap, so a paragraph-length span got squeezed into a sliver of
  width and forced the whole modal to scroll horizontally. Moved it to its
  own `<p class="muted">` below the row instead, the same pattern the
  Racing Maneuvers section already uses for its longer explanatory text.
- Where: `app.js` → `renderDeclModal()`, `App.setDecl()`.

---

### 2026-08-18 — Circular Track: locked Declarations table shows a Pilot Total
- Even with a Slip's Disadvantage properly labeled (see the entry directly
  below), the locked Declare Intentions table still only showed "Net Leg
  Acc" — a ship that Slipped and one that didn't could show the identical
  "-3Ds" there despite the Slipped ship actually carrying one more Level of
  Disadvantage into its Pilot roll, with nothing in the table making that
  visible.
- Added a **Pilot Total** column (Circular Track courses only) showing
  `pilotExtraNet()` — Net Leg Acc plus a Slip's -1 combined — so two ships at
  the same Acceleration read differently at a glance the moment one of them
  Slips (e.g. -3Ds vs. -4Ds).
- Where: `app.js` → `renderDeclarations()`.

---

### 2026-08-18 — Circular Track: Slip's Disadvantage now shown as its own line
- The math was always correct (a Slip subtracts exactly 1 from the Pilot's
  net), but it was applied by decrementing `ps.conditions.pilot` — the same
  bucket as Phase I's manual condition toggles and carried Fumble penalties —
  so it was invisible in the Pilot roll's Advantages/Disadvantages breakdown,
  silently folded into a generic "Conditions" total with no way to tell it
  was there.
- Moved the Slip penalty into `pilotExtraNet()` instead (alongside the
  existing Acceleration/Net-Leg-Acc term), and added a dedicated "Slip" line
  to `legAdSourcesHtml()`'s breakdown — same net total, now individually
  labeled instead of disappearing into "Conditions."
- Where: `app.js` → `pilotExtraNet()`, `lockDeclarations()` (Slip no longer
  touches `ps.conditions.pilot`), `legAdSourcesHtml()`.

---

### 2026-08-18 — Circular Track: "Show Entire Race" now smoothly moves the ring too
- "Show Entire Race" only ever animated the linear progress bars — the oblong
  ring sat frozen showing the live/final state for the whole replay, since it
  was drawn once at page render and the replay loop only touched the linear
  bars' DOM nodes directly.
- First pass had the replay regenerate the whole ring SVG at every step from a
  per-Leg snapshot — that drew the right position each step, but every step
  handed the browser a brand new `<g>` element with nothing to transition
  from, so ships jumped/snapped between Legs instead of sliding, unlike the
  linear bars (which animate because they update one persistent element's
  `style.width`/`left` and let a CSS `transition` interpolate it). Fixed by
  giving each racer's `<g>` a stable id (`circracer-<id>`) that survives the
  initial render, and having the replay update only that node's `transform`
  attribute in place — `.circracer` now has `transition: transform 0.6s
  ease-out`, so it slides exactly like the linear board already did. Position
  math (`circTrackGeometry()`/`circRacerTransform()`) was factored out of
  `renderCircularTrackSvg()` so the initial draw and the replay's per-step
  updates always compute it identically.
- Per-step position still comes from the per-Leg `lane`/`laps`/`hexPos`
  snapshots `finishLeg()` already records in history — same source the linear
  bars use for their own step, just read differently since a ship's position
  on the ring isn't a simple running total the way linear progress is. The
  initial "snap back to the start" frame uses each participant's
  `startLane`/`startHexPos` (see RULE_CHANGES.md's staggered-start entry)
  rather than their live lane, which may have moved on via a Slip since the
  race finished.
- Where: `app.js` → `circTrackGeometry()`, `circRacerTransform()`,
  `renderCircularTrackSvg()`, `renderStandings()` (added `id="circtrackWrap"`),
  `App.playRaceReplay()`. New CSS: `.circracer { transition: transform ... }`
  in `style.css`.

---

### 2026-08-18 — Circular Track: standings track drawn 50% bigger
- Scaled the whole track up 50%: `STADIUM_HALF_STRAIGHT` (100→150) and
  `STADIUM_INNER_R` (36→54) both scale together, which scales the calibrated
  hex size, all lane radii, and the finish line right along with them (hex
  count per lane is a ratio of perimeter to hex spacing, and both scale by the
  same factor, so it's unchanged — confirmed unchanged: 50/55/61/66/72/77
  visual tiles per lane, same before and after). Also raised `.circtrack`'s
  CSS `max-width` from 680px to 1020px (also ×1.5) — an SVG scales to fill its
  container regardless of viewBox units, so without this the internal scale-up
  alone would have rendered at the exact same on-screen size as before.
- Where: `app.js` → `STADIUM_HALF_STRAIGHT`, `STADIUM_INNER_R`; `style.css` →
  `.circtrack`.

---

### 2026-08-18 — Circular Track: fixed track getting clipped off-canvas (bug fix)
- **Bug:** the SVG's center point (`STADIUM_CX`/`STADIUM_CY`) was hardcoded to
  values that only matched one specific outer radius. The actual outer radius
  is calibrated from the course's own hex settings and varies (e.g. with a
  different inner-lane hex count), so the drawn track was frequently off
  center from its own viewBox — the far side (bottom, in the reported case)
  extended past the viewBox edge and got clipped, while empty space piled up
  on the opposite side.
- **Fix:** the center is now computed from that render's own `vbW`/`vbH`
  (always exactly `vbW/2`, `vbH/2`), so the track is centered in its viewBox
  by construction regardless of hex size. Also widened the margin from a flat
  `+20` to `hexR + 10`, since a hex tile centered at the outer lane's radius
  still extends another `hexR` past it.
- Where: `app.js` → `stadiumPoint()` (now takes `cx`/`cy` as parameters
  instead of reading module-level constants), `renderCircularTrackSvg()`.

---

### 2026-08-18 — Circular Track: ship icons sized to fit, oriented to heading, hover-only info
- The Circular Track ring's racer icons were sized for the old smooth-circle
  layout (22px) and drawn upright, which badly overflowed the hex tiles once
  the track went hex-tiled. Icons are now sized to `hexR * 1.2` so they sit
  inside a single hex, and rotated to the same tangent direction used to
  orient the hex tiles, so a ship visibly points the way it's heading (using
  the same "art faces up natively, +90° = the tangent's 0°-is-east" convention
  the linear standings board's `.boardicon` already uses).
- The always-on name/lap `<text>` labels floating above every icon were
  unreadable once several racers were close together (they overlap at the
  starting line, since everyone begins at hexPos 0). Removed in favor of the
  `<title>` element already on each racer group, which the browser shows as a
  tooltip on hover — same information (name, lane, lap), no permanent clutter.
- Where: `app.js` → `renderCircularTrackSvg()`. Removed CSS: `.circlabel`,
  `.circlaplabel` (style.css).

---

### 2026-08-18 — Circular Track: live Leg rolling, oblong hex-tiled track visualization
- Circular Track courses no longer store a Legs array at all (`legs: []`) —
  each Leg's Tier/Feature/TN is rolled fresh the moment it's needed, by the
  new `rollCircularLeg()`, called from `initLegState()`. This also fixes a
  staleness bug: racing the same Circular Track course twice used to replay
  Leg 1's originally-rolled Tier/TN every time; now every race gets entirely
  fresh Legs (see RULE_CHANGES.md for the rule this enforces).
- Racecourse tab: since there's nothing to preview, the "View Legs" toggle is
  replaced with a note for Circular Track courses instead of an always-empty
  table.
- Race tab → Standings: added an oblong (stadium-shaped) track visualization
  for Circular Track races (`renderCircularTrackSvg()`) — two straightaways
  joined by a semicircular curve at each end, one lane per Division lane, each
  lane a ring of pointy-top hexagon tiles rather than a smooth line. Hexes are
  rotated to match the local direction of travel so they meet **flat edge to
  flat edge** along the path, and lanes sit exactly 1.5 hex-radii apart with
  alternating lanes phase-shifted half a hex — the standard hex-grid row
  spacing — so each lane's ring **interlocks with the next, with no gap
  between lanes**, the same way a honeycomb tiles. Hex size is calibrated off
  the inner lane's real hex count, so tile counts per lane land close to (not
  exactly, since one fixed hex size can't hit every lane's count precisely)
  `laneHexesArray()`'s 50/56/62/68/74/80. Racer ship icons sit at their exact
  fractional position along their own lane's path, independent of the tile
  count, with a start/finish line at the straight/curve join and a lap-count
  label. Sits above the existing linear progress bars, which are unchanged
  and still drive "Show Entire Race." New CSS: `.circtrack*`/`.circhex`/
  `.circfinish`/`.circdot`/`.circlabel`/`.circlaplabel` in `style.css`.
- Where: `app.js` → `rollCircularLeg()`, `initLegState()`, `finishLeg()`,
  `App.generateCourse()`, `renderCourse()`, `stadiumPoint()`,
  `hexPolygonPoints()`, `renderCircularTrackSvg()`, `renderStandings()`.

---

### 2026-08-18 — Circular Track course builder, standings, and Race UI
- Racecourse tab: added a **Track** selector (Straight — Legs / Circular —
  Distance Tracking). Choosing Circular swaps the builder fields to Inner Lane
  Hexes, Laps to Finish, and a live preview of all 6 lanes' hex-per-lap
  totals; the Race Type/# Legs fields only apply to Straight courses. Saved
  Racecourses show a Circular tag with lane/lap info instead of a Leg count.
- Race Setup: the course dropdown shows lap count instead of Leg count for a
  Circular course, and a note explains lanes are auto-assigned and Slips are
  available.
- Race tab: Standings, the end-of-race summary, and the "Show Entire Race"
  replay all show Lane/Lap progress and a per-racer required-distance
  percentage instead of the straight-course points bar. The Declare
  Intentions modal gets a Lane control (Slip Left/Right) on Circular Tracks,
  and the locked-declarations table gets a Lane column. The Leg header drops
  "of N" on a Circular Track since there's no fixed Leg count (see
  RULE_CHANGES.md for the underlying rule).
- `migrateState()` backfills `trackType: "legs"` onto any course saved before
  this feature existed.
- Where: `app.js` → `renderCourse()`, `App.generateCourse()`,
  `App.setDraftTrackType()`, `App.previewLaneHexes()`, `renderRaceSetup()`,
  `renderStandings()`, `renderFinalStandings()`, `App.playRaceReplay()`,
  `renderDeclarations()`, `renderDeclModal()`.

---

### 2026-08-11 — Reference tab: full Fumble Charts instead of a roll-one button
- Replaced the "🎲 roll a random Fumble" buttons with the **complete** Flash
  Division and Spaceflight Fumble Charts — all 10 entries each, Roll # + full
  text, laid out like the book's own tables. Previously you could only see one
  random result at a time and had to keep clicking to browse the chart.
- Removed the now-unused `App.rollRefFumble()` handler.
- **Where:** `app.js` → `renderReference()`.

---

### 2026-08-11 — Reference tab: Racing Maneuvers table updated
- Added a **Position** column (Pilot/Navigator/Spotter/Engineer) — the table
  previously listed all 13 Maneuvers with no indication of which position runs
  each one, left over from before Maneuvers became per-position.
- Added a short explanatory note above the table: each position runs its own
  Maneuver against a target's same position, Pilot always instigates, and target
  position only matters against Hero ships (NPCs take it as normal, cumulatively).
- **Where:** `app.js` → `renderReference()`.

---

### 2026-08-11 — Reference tab: removed the Ship Classes card
- Dropped the "Ship Classes" table (every custom Class's Tier/Thrust/Damper/Crew/
  HP/DR) from the Reference tab — it duplicated what's already on each Class's own
  card in the Shipyard tab. The Divisions table (book stat blocks) stays.
- **Where:** `app.js` → `renderReference()`.

---

### 2026-08-11 — Instructions tab expanded
- Replaced the terse 5-line list with a fuller walkthrough: a paragraph per tab
  (Shipyard, Cantina, Hangar Bay, Racecourse, Race) covering the mechanics that
  actually matter there (build-point caps and the Flash 5-G ceiling, the
  Score/Advantage cost curves, the Division-locked Ship Class picker, course Type
  → Leg count, race setup filtering), plus a dedicated 6-step breakdown of what
  happens in a Race Leg (Declarations → Phase I → Resistance → Engineer/Spotter/
  Navigator → Pilot → NPCs/Standings), including how the Pilot's TN check and the
  Leg-win ranking score are separate things.
- **Where:** `app.js` → `renderInstructions()`.

---

### 2026-08-11 — New "Instructions" tab
- A plain how-to-use-this-app tab: the intended build order (Shipyard → Cantina →
  Hangar Bay → Racecourse → Race) and what each Race phase does, plus a pointer to
  the Reference tab's tables and Export/Import. No new game content — just a guide.
- **Where:** `index.html` (nav button), `app.js` → `renderInstructions()`, `render()`.

---

### 2026-08-11 — "+ Add Ship" now has a Division picker
- A **Division dropdown** sits next to the "+ Add Ship" button (defaults to
  Comet, persists across renders in `STATE._hangarAddDivision`). New ships are
  now built directly into whichever Division is selected there, instead of
  always defaulting to Comet regardless of what you actually wanted.
- If the selected Division has no Ship Classes yet, Add Ship alerts ("No *X*
  Division Ship Classes yet. Build one in the Shipyard tab first.") instead of
  silently creating a ship in the wrong Division or with a mismatched Class.
- **Where:** `app.js` → `renderHangarBay()` (dropdown), `App.setHangarAddDivision()`
  (new), `App.addShip()` (now Division-aware).

---

### 2026-08-11 — Hangar Bay Ship Class dropdown filtered to the ship's Division
- **Bug:** the Ship Class dropdown on a Hangar Bay ship listed every Ship Class in
  the game regardless of Division, so a Nova-Division ship could be assigned a
  Spark-Division Class (and vice versa) — a legality mismatch the app never caught.
- **Fix:** the dropdown now only lists Classes whose `division` matches the ship's
  own Division. Switching a ship's Division auto-resets its Ship Class to the
  first legal Class for the new Division (or blank if it has none yet), same as a
  manual Class change already did for a mismatched icon. `addShip()` now also
  picks a Class whose Division matches what it assigns, instead of always
  defaulting to Comet regardless of the first available Class's actual Division.
- **Where:** `app.js` → `shipClassNamesForDivision()` (new), `renderShipCard()`
  (both Ship Class `<select>`s), `App.updateShip()`'s `cls` branch, `App.addShip()`.

---

### 2026-08-11 — "Destroyed" renamed to OOC (Out of Commission)
- All player-facing labels for a ship taken out at 0 HP now read **OOC** (Out of
  Commission) instead of "DESTROYED"/"destroyed":
  - Phase Card status tag: `OOC — out of race`
  - Declaration-target list tag and final-standings tag: `OOC`
  - Leg Race Log status column: `OOC` (NPCs dropped for falling behind still show
    `OUT`, unchanged)
  - Kill pop-up: "… is Out of Commission (OOC) and out of the race!"
- Internal flags/variable names (`p.out`, HP-0 "destroyed" comments) are unchanged;
  this is a display-terminology change only.
- **Where:** `app.js` → `shipStatusTags()`, `renderStandings()`, final-standings
  list, Leg Race Log table, `App.applyFumbleResult()` alert.

---

### 2026-08-11 — Phase I conditions can be locked for the Leg
- Each ship's Phase I card now has a **"Lock Conditions for this Leg"** button.
  Once locked (`ps.condLocked`), the condition checkboxes are disabled and a
  "🔒 Conditions locked" tag shows. Conditions also still auto-lock when
  Resistance is rolled, as before. Locking resets each Leg.
- `App.toggleCond` is guarded so a locked ship's conditions can't change even if
  invoked programmatically.
- **Where:** `app.js` → `initLegState()` (`condLocked`), `renderPhaseI()`,
  `App.lockConditions()`, `App.toggleCond()` guard.

---

### 2026-08-11 — Phase I card rebuilt as a per-crewman condition table
- Phase I now shows a per-crewman table (Crewman / Positions / Conditions) like
  the Resistance card, instead of one shared row of position-category checkboxes.
  Checking a condition for a crewman applies −1 to their held positions (see
  RULE_CHANGES.md). Checkboxes lock once Resistance is rolled, as before.
- **Where:** `app.js` → `renderPhaseI()`, `App.toggleCond(pid, crewId, condIdx,
  checked)`; `style.css` → `.condgrid`.
- The ship picker now lists **only ships whose Division matches the selected
  racecourse** (a Meteor course hides Flash/Spark/Comet/Nova ships, etc.).
  Changing the course re-filters the list and drops any now-ineligible picks.
- **Fix:** adding/removing an NPC (or changing the course) no longer clears the
  selected Hero ships. Ship selection and the chosen course are now persisted in
  `STATE` (`_raceSetupShips` / `_raceSetupCourse`) instead of living only in the
  DOM, so a re-render preserves them.
- **Where:** `app.js` → `renderRaceSetup()`, new `App.setRaceSetupCourse()` /
  `toggleRaceShip()`, `beginRace()` (reads persisted selection, validates
  Division).

---

### 2026-08-11 — Phase II Resistance card matches the other phase cards
- Phase II is now a per-crewman block (not a table) in the same layout as the
  other phases: a header line — `Engineer: <name>  Ship Skill Mk: 10AA  Leg Ship
  Skill Mk: 10A  vs TN 21` — an itemized **Leg Advantages/Disadvantages** line
  (`Crew skill +2As · Conditions -1D → net +1A`), then the roll line
  (`Rolled 17, 20 → chosen 20 + 10 = 30 vs TN 21 → Success`).
- The Skill Mk uses the crewman's Resistance skill; the Leg Skill Mk / net folds
  in Phase I conditions (−1 each). Old cached results fall back to the short form.
- **Where:** `app.js` → `rollResistance()` (stores dice/chosen/score/conds),
  `renderPhaseII()`, new `resistanceAdSourcesHtml()`; `style.css` → `.resistrow`.

---

### 2026-08-10 — Declaration modal: per-position Maneuver UI with descriptions
- Rebuilt the Declaration modal's Maneuver section to match the new rule (each
  position runs its own Maneuver — see RULE_CHANGES.md). There is now one row per
  position (Pilot / Navigator / Spotter / Engineer), each with its own Maneuver
  dropdown; picking one reveals that position's own target checkbox grid + Select
  All. The single shared Maneuver/Target picker is gone.
- Each dropdown option shows **name · Ds · full description**, columns padded with
  non-breaking spaces (`padNbsp`) under a monospace font (`.monoselect`).
- **Fix:** each position's target checkboxes now sit full-width under its Maneuver
  row and no longer get clipped at the modal edge — the long option text was
  forcing the flex column wider than the modal, so `min-width:0` was added down
  the flex chain and the target grid was un-indented (with a light rail).
- **Where:** `app.js` → `renderDeclModal()`, `App.setPosManeuver()` /
  `togglePosTarget()` / `togglePosAllTargets()` (replacing `toggleTarget` /
  `toggleAllTargets`), `declaredManeuversText()` / `sumPosObj()` for the locked
  summary table; `style.css` → `.manrow` / `.manhead` / `.manpos` / `.mantargets`.

---

### 2026-08-10 — Standings: aligned name column + track icon no longer overlaps the name
- Each Standings row's name-column icon now sits in a fixed-width 42px slot
  (`.thumbslot`), so every ship name starts at the same x-position — previously a
  ship with no icon (`iconThumbImg` returns "") pushed its name to the far left,
  and names hung off a bare text node, so the icon-to-name gap and the column
  drifted. The name is now its own `.boardlabel` with a consistent 8px gap.
- The **moving track icon** is inset by half an icon width at each end
  (`.boardtrack-inner { margin: 0 22px }`): the icon is centred on its position,
  so at 0% its left half used to spill back over the end of the ship name (e.g.
  onto "(NPC)"), and at 100% off the right end. It now stays within the track.
- **Where:** `app.js` → `renderStandings()`; `style.css` →
  `.boardname-inner .thumbslot` / `.boardlabel`, `.boardtrack-inner`.

---

### 2026-08-10 — Declaration Target(s): aligned columns + Select All
- The Target(s) checkbox list in the Declaration modal now uses a fixed-column
  grid (`.chkgrid`), so every column starts at the same x-position regardless of
  ship-name length — previously the inline-flex labels made the 2nd+ columns
  drift crooked on longer names. The target wrapper is `flex:1` so the grid has a
  width to fill (auto-fill columns), and the modal was widened (520→600px) so two
  columns fit comfortably.
- Added a **Select All** button (toggles to **Clear All** when everything is
  already targeted).
- Also: the ship-status fumble penalty tag now shows the A/D letter, e.g.
  `Spotter −2D` instead of `Spotter −2`.
- **Where:** `app.js` → `renderDeclModal()` (grid + button),
  `App.toggleAllTargets()`, `shipStatusTags()` (A/D letter); `style.css` →
  `.chkgrid`, `.modal-box` max-width.

---

### 2026-08-10 — Phase cards list every Leg-current Advantage/Disadvantage
- Each Phase Card now shows a **"Leg Advantages/Disadvantages"** line under the
  Skill Mk, itemizing every A/D source in effect on that position this Leg —
  Crew skill, Ship AI, carried Fumble Disadvantage + manual Conditions,
  Resistance, grants, and (Pilot only) Racing Maneuvers and Acceleration —
  ending in the net used on the dice pool. Only nonzero sources are listed.
- **Where:** `app.js` → new `legAdSourcesHtml()`, called in
  `renderPhaseRollBlock()`.

---

### 2026-08-10 — Fix: Fumble Disadvantage "Legs remaining" was off by one
- Fumble Disadvantage penalties now use an **absolute Leg window**
  (`{startLeg, endLeg}`) instead of a per-Leg countdown. The old countdown was
  decremented at each Leg's setup, so the status tag under-counted by one (and
  hid the penalty entirely on its final active Leg). Now the tag reads
  "N Legs left" correctly on every affected Leg, and "next N Legs" on the Leg
  the Fumble was rolled (which it doesn't affect).
- Cached mid-race saves are migrated (`legsRemaining` → `startLeg`/`endLeg`).
- **Where:** `app.js` → `applyFumbleAffects()` (window on create),
  `activePenalties(participant, legIndex)` (no mutation, absolute check),
  new `penaltyLegsLeft()`, `shipStatusTags()` display, `migrateState()`.

---

### 2026-08-09 — Tab menu hover: gold background, black text
- The top tab buttons now use the same hover as the crew dropdown — gold
  background with black text — matching the active tab's look.
- **Where:** `style.css` → `.tabbtn:hover`.

---

### 2026-08-09 — Hangar crew dropdown replaced with a custom listbox (gold highlight)
- The crew-assignment dropdown is no longer a native `<select>` (which can't
  colour-highlight its options). It's now a hand-rolled listbox: the closed
  button shows the selected crewman's name; the open menu lists every crewman
  with inline **`Pil-7, Nav-3A, ...`** labels (abbreviation-hyphen-Skill Mk) in
  fixed-width columns so it's clear which score is which, and the crewman's best
  skill (by effective value = score + A/D) coloured **gold** like the Cantina.
- Opens on click, closes on outside-click or after a selection (which
  re-renders). The `★`/`[bracket]` text markers are gone.
- On **hover** the row turns gold and all its text (name + skills, including the
  gold "best skill") turns **black** so it stays readable over the yellow. The
  **closed** dropdown button gets the same gold-background/black-text hover.
- **Where:** `app.js` → new `crewSkillCells` (shared with Cantina),
  `crewDropdownHtml`, `App.crewDDtoggle`/`crewDDpick`, boot outside-click
  handler; `renderShipCard` crew cell; `style.css` → `.crewdd*`. The old
  `crewSkillLineAbbrev`/`crewSelOpen`/`crewSelClose` were removed.

---

### 2026-08-09 — Crew skill summaries show Skill Mk (score + A/D)
- The Cantina header cells and the Hangar dropdown line now display each skill's
  full **Skill Mk** (raw score with its Advantage `A`/Disadvantage `D` markers,
  e.g. `3AA`, `3D`) instead of just the raw score — matching the Skill Mk column
  in the crew table.
- The "highest skill" highlight/bracket now ranks by an **effective** value
  (`score + net adv`), so an Advantage-boosted skill can outrank a higher raw
  score (e.g. `3AA` beats `4`).
- **Where:** `app.js` → new `crewSkillEff`, `crewSkillHeaderHtml`,
  `crewSkillLineAbbrev`.

---

### 2026-08-09 — Cantina header: Total Points as a matching cell, group aligned to name
- The Cantina crew card's **Total Points** is now rendered as one more cell in
  the same fixed-width column style as the five skill cells (labeled `Total`, in
  white) instead of a separate pill tag — so it lines up with the rest.
- The whole skills+Total group now sits right after the name/Unspent XP block
  (`.crewskills` margin changed from `auto` to `16px`); **Delete** is anchored
  to the right edge instead (`margin-left:auto` on the button).
- **Where:** `app.js` → `crewSkillHeaderHtml(c, total)`, `renderCantina`;
  `style.css` → `.crewskills`, `.crewskill.total`.

---

### 2026-08-09 — Crew skill summaries (Cantina header + Hangar crew dropdown)
- Each Cantina crew card now lists all five skill scores in fixed-width columns
  to the left of the Delete button (so they line up across crewmen), with the
  crewman's **highest** score highlighted in gold — quick Hero comparison.
- The Hangar Bay crew-assignment dropdown now shows each crewman's abbreviated
  skills (`Pil · Nav · Spot · Eng · Res`) with the highest in `[brackets]`, but
  **only while the list is open** — native `<option>`s can't differ open vs
  closed, so the text is swapped in on `focus` and back to name-only on `blur`
  (`App.crewSelOpen`/`crewSelClose`); the closed box shows just the name.
- **Where:** `app.js` → `crewSkillHeaderHtml`, `crewSkillLineAbbrev`,
  `CREW_SKILL_FULL/ABBR`, `renderCantina`, `renderShipCard` (crew select),
  `App.crewSelOpen`/`crewSelClose`; `style.css` → `.crewskills` / `.crewskill`.

### 2026-08-09 — Bug fix: "can't add a ship" (added into a collapsed Division)
- After the Division-tree grouping shipped, a new Ship always lands in the
  **Comet** group; if that group was collapsed the card was hidden (the header
  count still ticked up), so it looked like "+ Add Ship" did nothing. Adding a
  Ship/Ship Class now force-opens the target Division group, and changing an
  item's Division opens the group it moves into.
- **Where:** `app.js` → `App.addShip`, `App.addShipClass`, `App.addPresetShipClass`,
  `App.updateShip` (cls change), `App.updateShipClassDivision`.

### 2026-08-09 — Random Hero name generator (D100 first + last)
- New Heroes get a random name from the D100 name table: a d100 roll for the
  first name and a separate d100 roll for the last name. `+ Add Blank Crewman`
  now seeds a random name (instead of "New Crewman"), and each crew card has a
  🎲 button next to its name field to re-roll — mirroring the ship-name button.
- **Where:** `data.js` → `GDATA.HERO_FIRST_NAMES` / `GDATA.HERO_LAST_NAMES`
  (100 each); `app.js` → `rollHeroName()`, `App.rerollCrewName`, `App.addBlankCrew`,
  `renderCantina`.

### 2026-08-09 — Shipyard & Hangar grouped into collapsible Division trees
- The Shipyard's Ship Classes and the Hangar Bay's Ships are now organized under
  collapsible **Division group headers** (Flash, Spark, Comet, Meteor, Nova, in
  that order). Each header shows a count and toggles its children open/closed;
  all five Divisions always appear (empty ones show a "none yet" note).
- Shipyard groups by each Class's Division (`sc.division`); Hangar groups by each
  Ship's Division field (`ship.cls`). Collapse state per Division persists in
  `STATE._shipyardDivCollapse` / `STATE._hangarDivCollapse`.
- **Where:** `app.js` → `renderShipyard` + new `renderShipClassCard`,
  `renderHangarBay` + new `renderShipCard`, `App.toggleShipyardDiv` /
  `App.toggleHangarDiv`; `style.css` → `.divgroup` / `.divhead` / `.divbody`.

### 2026-08-09 — Per-Division ship icons (was always Spark)
- Every Division now uses its **own** 15 ship designs. Previously `shipIconPath`
  hard-coded the `Spark` art, so a Comet/Meteor/Nova/Flash ship still showed a
  Spark icon everywhere (Shipyard picker, Hangar, declaration modal, phase
  cards, standings board).
- `shipIconPath(division, number, color)` now takes the Division. A Ship resolves
  it from its Ship Class's Division (`iconDivisionOf`/`shipClassDivision`); an
  **NPC** carries an `iconDivision` set from the course's Division at race start
  (back-filled for in-progress races in `migrateState`).
- Icon **uniqueness is now per-Division** — the same number/color in another
  Division is a different ship — so a Comet class and a Flash class can both use
  icon 05. Updated `usedClassIconNumbers` (now takes a division), `usedShipIconKeys`
  (keys by `division|color|number`), the picker greying, and the pick-time
  re-checks in `App.updateShipIcon`/`App.updateShipClassIcon`. Switching a
  Class's Division drops its icon if it would collide in the new Division.
- **Where:** `app.js` → `shipIconPath`, `iconDivisionOf`, `shipClassDivision`,
  `iconThumbImg`, `renderClassIconPicker`, `renderShipIconPicker`, `renderShip`,
  `renderShipyard`, `renderStandings`, `startRace`, `migrateState`,
  `App.updateShipIcon`, `App.updateShipClassIcon`, `App.updateShipClassDivision`.

### 2026-08-09 — Bug fix: self-heal a cached race where a 0-HP Hero wasn't out
- A Hero could be at **0 HP but still racing** (`out` unset) — e.g. a race
  cached from before the out-at-0 logic shipped, or HP zeroed on a path that
  didn't flag it. `migrateState()` now runs on every load and marks any 0-HP
  Hero in an in-progress race as out, with an `outLeg` before the current Leg so
  the wreck is removed from the cards immediately (this is a repair, not a fresh
  kill) while its bar stays frozen and red on the standings board.
- **Where:** `app.js` → `migrateState()`.

### 2026-08-09 — Kill pop-up, red bars for out ships, no dead targets
- **Kill announcement:** When a Fumble roll destroys a ship, a pop-up now
  announces it using the **Fumble description** that caused the kill
  (`App.rollFumble`).
- **Declaration targets:** Ships that are out of the race (destroyed Heroes or
  removed NPCs) no longer appear in the Declaration modal's Target(s) list
  (`renderDeclModal`).
- **Standings bars:** An out ship's progress bar is drawn **red** and its row
  is tagged (`destroyed` for Heroes, `out` for NPCs) — `renderStandings` +
  `.boardfill.dead` in `style.css`. Bars stay frozen where the ship dropped out.
- **NPC removal (display side):** removed NPCs are frozen in `finishLeg`, kept
  on the board, and skipped by the NPC roll and leg-close list.

### 2026-08-09 — Wrecks linger to end of Leg; Fumble text in the Race Log
- A destroyed ship now **stays in the Phase Cards for the rest of the Leg it
  died on** — shown with its DESTROYED status and no roll controls, treated as
  "done" by the completion gates so the survivors can still close the Leg. It's
  only dropped from the cards starting the next Leg (via `activeHeroes()` keying
  off the `outLeg` it recorded). This replaces the earlier behavior that removed
  the wreck the instant it blew up.
- The Race Log now lists every **Fumble description** rolled during a Leg
  (ship name + chart text), captured in `finishLeg` and shown under that Leg's
  results table.
- The race-over check moved out of `App.rollFumble` and into `finishLeg`, so
  losing the last Hero ends the race at the Leg boundary rather than mid-Leg.
- Destroyed ships stay on the standings board (frozen at their crash position)
  and are tagged **destroyed** in the final standings.
- **Where:** `app.js` → `activeHeroes()` / `livingHeroes()`, `finishLeg()`,
  `renderLog()`, `renderPhaseI/II/Crew/VI`, `phaseIsComplete`, `renderLegClose`,
  `App.rollFumble`; `style.css` `.logfumbles`.

### 2026-08-09 — Fumble/HP display: compact per-ship status line in the Phase Cards
- Every Phase Card (I, II, Crew III–V, VI) now shows a compact **status line**
  in each hero ship's header via `shipStatusTags()`: current **HP x/y** (turns
  red when low or destroyed), a **DESTROYED — out of race** tag at 0 HP, a
  **Max N-G** tag whenever a Fumble has reduced/capped Acceleration, a **Forced
  last (N Legs)** tag, and a tag per active multi-Leg Disadvantage penalty
  (e.g. `Pilot −2 (2 more Legs)`). This is the "Fumbles in play" readout.
- When a ship rolls on the Fumble Chart, the result block now shows a plain-
  language **Applied:** summary of what the affects did (via
  `describeFumbleAffects()`) instead of the old single-penalty line, and the
  **Roll on Fumble Chart** button is hidden after the roll so a ship can't
  re-roll and stack damage/penalties in the same Leg.
- The declaration modal's Acceleration input now maxes out at the ship's
  fumble-reduced ceiling and labels it "(reduced by Fumble)" when applicable.
- The Race Log shows **DESTROYED** for the Leg a ship blew up and **OUT** for
  subsequent Legs.
- Removed the now-unused `PENALTY_FOREVER` constant (the old "rest of race"
  penalty sentinel); the new affects model uses finite per-Leg durations.
- **Where:** `app.js` → `shipStatusTags()`, `describeFumbleAffects()`,
  `renderPhaseI/II/Crew/VI`, `renderPhaseRollBlock`, `renderDeclModal`,
  `App.setDecl`, `renderLog`; `style.css` reuses `.tag.danger`.

### 2026-08-08 — "Compute Base Leg Result" now rolls all NPCs automatically
- Clicking **Compute Base Leg Result** now also rolls every NPC racer in one
  go, instead of requiring a separate click on each NPC's "Roll" button. An
  NPC's roll depends on the Base Leg Result, so this is the natural moment to
  do it. (The per-NPC Roll button remains as a harmless fallback for a race
  that was mid-leg-close under the old flow.)
- **Where:** `app.js` → `App.doBaseResult()`.

### 2026-08-07 — Feature: ship icons shown throughout the Race tab; NPCs get a random icon; standings bar shows a directional icon
- Wherever a Ship (or NPC) appears in the Race tab, its icon now shows next
  to its name: the race-setup checklist, the Declare Intentions table and
  modal, and every phase panel (I/II/III/IV/V/VI).
- **NPC racers** now get a random icon at race start -- any color, any of
  the 15 numbers -- distinct from every Hero ship and every other NPC in
  that same race (not tracked against the app-wide Ship pool, since NPCs
  are transient and only exist for the race's duration).
- **Standings bar:** each racer's icon now sits right at the leading edge of
  their progress bar, rotated 90° to point in the direction of travel (the
  bar fills left-to-right, so the icon points right) -- it's a separate
  absolutely-positioned element tracking the same percentage as the bar
  fill, not clipped by the bar's rounded corners. "Show Entire Race" moves
  the icon along with the bar during the replay animation.
- **Where:** `app.js` → `iconThumbImg()` (new, generic thumbnail for
  anything with `.iconColor`/`.iconNumber`), `pickRandomUnusedIcon()` (new),
  `startRace()` (NPC icon assignment), `renderRaceSetup()`,
  `renderDeclarations()`, `renderDeclModal()`, `renderPhaseI()`,
  `renderPhaseII()`, `renderPhaseCrew()`, `renderPhaseVI()`,
  `renderStandings()`, `App.playRaceReplay()`; `style.css` →
  `.boardtrack`, `.boardicon`.

### 2026-08-07 — Feature: Ship Class / Ship icon pickers, linked and unique app-wide
- A Ship Class (Shipyard) has an **Icon** picker: a grid of the 15 "White"
  Spark hull icons. A Ship (Hangar Bay) built from a Class has its own
  **Icon** picker for the same hull in **Red**, **Green**, or **Blue** -- a
  Ship's icon *number* always matches its Class's number (only the color is
  free), so a Class's White icon is its "spec sheet" art and its Ships are
  colored livery variants of that same hull. This also means at most 3 Ships
  (one per color) can exist for a single Class at once. Picking an icon on a
  Ship is disabled with a guidance message until its Class has one.
- **Unpicking:** clicking an already-selected icon again removes it (no
  separate Clear button). Changing a Class's icon, or switching a Ship to a
  different Class, automatically clears any now-mismatched Ship icon so it
  can't silently point at the wrong hull.
- **Uniqueness:** a Class's icon number is unique among Classes; a Ship's
  (color, number) pair is unique among Ships -- e.g. Red-07 and Green-07 can
  both be in use at once, on Ships of the same Class.
- **Current limitation:** only the Spark Division has icon art
  (`webapp/Divisions/Ship Icons/`) right now, so every Class/Ship uses this
  same set regardless of its actual Division. This can be extended per-
  Division later if more icon sets are added.
- **Where:** `data.js` → `GDATA.SHIP_ICON_DIR` / `SHIP_ICON_NUMBERS` /
  `SHIP_CLASS_ICON_COLOR` / `SHIP_ICON_COLORS`; `app.js` → `shipIconPath()`,
  `usedClassIconNumbers()`, `usedShipIconKeys()`, `renderClassIconPicker()`,
  `renderShipIconPicker()`, `App.updateShipClassIcon()` (ripples a clear to
  mismatched Ships), `App.updateShipIcon()` (validates the number matches
  the Class), `App.updateShip()` (clears icon on a Class switch);
  `style.css` → `.iconpicker`, `.iconbtn`, `.iconthumb`, `.colorlabel`.

### 2026-08-07 — Fixed: clicking the Race tab did nothing for a race already in progress
- **Bug:** The collapsible phase cards feature (below) assumed every race's
  `legState` has a `phaseCollapsed` object on it, which `initLegState()` only
  sets for a race/Leg started *after* that feature shipped. Opening the Race
  tab on a race that was already in progress threw `Cannot read properties
  of undefined` inside `renderPhaseCardOpen()`, which aborted `render()`
  entirely -- the screen just never updated, with no visible error, making
  it look like the tab click "did nothing."
- **Fix:** `renderPhaseCardOpen()` now initializes the field itself if
  missing, so it self-heals on the next load regardless of when the race was
  started.
- **Where:** `app.js` → `renderPhaseCardOpen()`.

### 2026-08-07 — Fixed: a Ship Class named after its own Division reverted to another class on every reload
- **Bug:** A one-time migration step (from the "book Divisions are no longer
  directly selectable as a Ship Class" change below) treated `ship.shipClass`
  matching any bare Division name as leftover legacy data, and reassigned it
  to `STATE.shipClasses[0].name`. That check predated a *later* change in the
  same session that explicitly allows a custom Ship Class to share its name
  with a Division (e.g. a custom "Meteor" class for the Meteor Division).
  Since `migrateState()` runs on every load, any ship using a
  same-named-as-its-Division custom Class got silently reassigned to
  whichever custom Class happened to be first in the array — every single
  reload — with no error or warning. For a save with classes ordered
  Flash/Spark/Comet/Meteor/Nova (as built via "+ Add Preset" in Division
  order), this meant a Meteor-class ship would revert to the Flash class on
  refresh.
- **Fix:** The migration now only reassigns `ship.shipClass` when it matches
  a bare Division name *and* there's no actual custom Class by that name —
  i.e. only for genuine leftover data from before custom Classes existed.
- **Where:** `app.js` → `migrateState()`.

### 2026-08-07 — Race phase cards are collapsible (manual only)
- Each Leg phase (Declare Intentions, Phase I Crew Task Check Modifications,
  Phase II Resistance, Phase III Engineer, Phase IV Spotter, Phase V
  Navigator, Phase VI Pilot) can be collapsed to just its header via a
  button, and shows a "Done" tag once every Hero has finished it — but
  collapsing is manual only. It was originally shipped as auto-collapse (the
  card would collapse itself the moment it completed); that was reverted the
  same day at the user's request in favor of the player closing cards
  themselves.
- **Where:** `app.js` → `initLegState()`, `phaseIsComplete()` /
  `renderPhaseCardOpen()`, `App.togglePhaseCollapse()`, and
  `renderDeclarations()` / `renderPhaseI()` / `renderPhaseII()` /
  `renderPhaseCrew()` / `renderPhaseVI()`.

### 2026-08-07 — UI: "2+ Hero ships recommended" hint on race setup
- No rule or requirement changed (starting a race still only requires one
  ship). The ship checklist on the race-setup screen is labeled "(2+
  recommended — 1 works, but it's boring)" as a plain nudge.
- **Where:** `app.js` → `renderRaceSetup()`.

### 2026-08-07 — Renamed: "Skip" button is now "Play It Safe"
- Purely a label change, no mechanics affected — see `RULE_CHANGES.md` for
  the underlying rule (declining an Engineer/Spotter/Navigator roll counts
  as a Failure). Button and result text now read "Play It Safe" /
  "Played It Safe" instead of "Skip" / "Skipped". Internal names
  (`skipPhase()`, `App.doSkipPhase()`, the `skipped` result flag) are
  unchanged.
- **Where:** `app.js` → `renderPhaseRollBlock()`.

### 2026-08-07 — Shipyard Preset/Default now read hull from Division data instead of hard-coding it
- Every Division's preset hull (Frame Strength/Armor/Compartmentalization —
  see `RULE_CHANGES.md` for the actual per-Division numbers) used to be
  hard-coded per action: the Shipyard's "+ Add Preset" and "Default" buttons
  always reset Armor/Compartmentalization to 0/Standard for every Division,
  and originally reset Frame Strength to "Standard" even for Flash (which is
  supposed to default to Super-Light). Both actions now read
  Frame/Armor/Compartment straight from `GDATA.SHIP_CLASSES[division]`.
- **Also fixed:** `App.updateShipClassMaxThrust()` and
  `App.updateShipClassDivision()` would have computed `Math.min(99, undefined)`
  (= `NaN`) for any Division with a points cap but no Acc-specific cap —
  caught before shipping since every Division but Flash has exactly that
  shape. Both now only apply the Acc clamp when one is actually defined.
- **Where:** `data.js` → `GDATA.SHIP_CLASSES.*.frame/armor/compartment`;
  `app.js` → `App.addPresetShipClass()`, `App.applyShipClassDefault()`,
  `App.updateShipClassMaxThrust()`, `App.updateShipClassDivision()`.

### 2026-08-07 — Crew-completeness enforcement upgraded from a colored tag to a hard Lock
- The Hangar Bay's crew-count tag and the race-setup ship checklist now show
  a 🔒 with the specific missing positions/crew when a ship isn't race-legal
  (see `RULE_CHANGES.md` for the underlying requirement), instead of just a
  colored "Crew X/Y" tag that didn't actually block anything.
- **Where:** `app.js` → `crewLockMessage()`, `renderHangarBay()`,
  `renderRaceSetup()`.

### 2026-08-07 — App behavior: Shipyard gets a Preset/Blank creation flow, mirrors Cantina
- Adding a Ship Class in the Shipyard now works like adding a crewman in the
  Cantina: a dropdown of the 5 book Divisions plus a **+ Add Preset** button
  creates a new custom Class pre-seeded with that Division's stats. A
  separate **+ Add Blank Ship Class** button keeps the old behavior (Comet,
  Acc 10, all AI stats 0) for building something from scratch.
- **Also fixed while here:** a custom Ship Class can now share a name with a
  Division (e.g. a custom "Flash" class) without being rejected as "already
  in use" — that check was a leftover from when Divisions and Ship Classes
  shared one picker. `getShipClass()` now checks custom classes before
  falling back to the book stat blocks, so a same-named custom class always
  wins for ship stats; `rollLegCount()` reads the Division's own leg dice
  directly so it can't be shadowed by a same-named class.
- **Where:** `app.js` → `App.addPresetShipClass()`, `renderShipyard()`,
  `getShipClass()`, `rollLegCount()`, `App.updateShipClassName()`.

### 2026-08-07 — Architecture: book Divisions are no longer directly selectable as a Ship Class
- **Change:** The 5 built-in Division stat blocks (Flash/Spark/Comet/Meteor/
  Nova) used to double as ready-made Ship Classes in the Hangar Bay's "Ship
  Class" dropdown. They no longer are — every ship must now use a custom
  Ship Class built in the Shipyard tab. The Shipyard's Default button still
  exists precisely for this: pick a Division, hit Default, and a new Class
  is seeded with that Division's stats as a starting point to customize or
  leave as-is.
- **Why:** Keeps "Division" (racecourse TN table, fixed 5) and "Ship Class"
  (stat block, always player-authored) cleanly separate, with the book ships
  preserved purely as reference data / Default-button source material rather
  than being mixed into the same picker as custom classes.
- **Data migration:** This was a one-time, automatic change on next load —
  any existing ships (Hangar Bay) and racecourses (Racecourse tab) were
  cleared, since they may have referenced a built-in Division directly as a
  Ship Class. Crew and any custom Ship Classes already built were untouched.
  A ship whose Ship Class becomes invalid (e.g. after its Class is deleted
  with no other Class to fall back to) shows a bare "choose a Ship Class"
  picker instead of breaking the tab.
- **Where:** `app.js` → `allShipClassNames()`, `migrateState()`,
  `App.addShip()`, `App.deleteShipClass()`, `renderHangarBay()`.

### 2026-08-07 — Fixed: Division and Ship Class were conflated into one field
- **Bug:** When Custom Ship Classes were first added, they were implemented
  as more entries in the same list as the book's Divisions, and a ship's
  single `.cls` field drove both "what Division does this ship race in" and
  "what stat block does it use." Those are two separate concepts.
- **Fix:** A ship now has two independent fields: **Division** (`.cls`, a
  dropdown restricted to the 5 built-in Divisions — ties a ship to a
  racecourse's TN table) and **Ship Class** (`.shipClass` — supplies the
  actual Tier/Acc/Damper/Min Crew/Ship AI stat block). A ship can legally
  have Division "Flash" and Ship Class "Nova" — Division no longer affects
  stats at all.
- **Migration:** Ships saved before this fix got `.shipClass` auto-filled
  from their old `.cls` value (so existing stats didn't change), and any
  ship/course whose `.cls`/`.division` didn't name a real Division fell back
  to Comet.
- **Where:** `app.js` → `migrateState()`, `allShipClassNames()`, every
  stat-driving call site (`computeShipDisplay`, `initLegState`,
  `lockDeclarations`, `rollResistance`, `renderDeclModal`, `renderPhaseII`,
  `minCrewFor`) switched from `ship.cls` to `ship.shipClass`.

### 2026-08-07 — Feature: Custom Ship Classes (user-defined ship models)
- The Shipyard (originally part of the Garage) has a "Ship Classes" card
  where you can design your own named ship models — e.g. a "Wunderbar-class"
  built for the Comet Division. See `RULE_CHANGES.md` for the point-cost
  formula and Spark AI lock these classes use.
- **Simplification:** Leg Dice (how many Legs a race in that Division rolls)
  isn't an editable field on a custom class — every one fixes it at 2d10,
  the same as Comet (this is dead cosmetic data on the class object; leg
  count generation always reads the Division's own book dice, never a
  class's). Renaming a class cascades to any ship already using it as its
  Ship Class; deleting one falls those ships back to another remaining
  Class (or is blocked if none remain).
- **Where:** `app.js` → `STATE.shipClasses`, `renderShipyard()`, and the
  `App.addShipClass` / `updateShipClassDivision` / `updateShipClassMaxThrust`
  / `updateShipClassAI` / `updateShipClassName` / `deleteShipClass` actions.

### 2026-08-06 — UX addition: Declare Intentions modal now lists crew Resistance Skill Mk
- Not a rule change. The Pilot has to weigh declared Acceleration (Speed
  Bonus, see `RULE_CHANGES.md`) against the risk of the crew failing their
  Phase II Uncompensated G-Force Resistance check, whose TN is driven
  entirely by Acceleration. The app now shows a small table at the top of
  the private Declare Intentions modal listing every crewman assigned to the
  ship, the positions they hold, and their Resistance Skill Mk, so the
  decision can be made with that information in view.
- **Where:** `app.js` → `renderDeclModal()`.

### 2026-08-06 — Fixed: Engineer/Spotter grants always landed on the Pilot
- **Bug:** Choosing "Grant to: Spotter" (or Navigator) after an Engineer or
  Spotter Task Check would still apply the Advantage/Disadvantage to the
  Pilot instead. The "Apply" button had the recipient baked in from the last
  full screen redraw, and changing the dropdown alone didn't trigger a
  redraw, so the button kept using the stale (default "Pilot") value.
- **Fix:** Changing the grant-recipient dropdown now redraws the panel
  immediately, so the Apply button always reflects the currently selected
  recipient. Not a rule change — a UI bug fix.
- **Where:** `app.js` → `App.setGrantChoice()`.

### 2026-08-06 — Standings bar redesigned as a race-track progress view
- The Race tab's standings bar shows true race-length progress, not a
  relative-to-leader comparison: every racer starts at the left (0%) and
  their bar's width is cumulative movement as a percentage of the maximum
  possible for the whole race (every Leg's winner gets points equal to the
  participant count, so max = legs × racers). Racer order never changes Leg
  to Leg — only how far each bar reaches. A "Show Entire Race" button
  replays that growth from Leg 1 forward on the same bars, live, rather than
  printing a separate snapshot per Leg.
- **Where:** `app.js` → `renderStandings()`, `App.playRaceReplay()`.
