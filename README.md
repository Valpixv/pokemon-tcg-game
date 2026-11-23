# Pokémon Tabletop Battle

A mixed-reality card battle for Meta Quest 3S. It runs in Quest Browser over WebXR, with color passthrough and hand tracking. You place a miniature arena on a real table, register your cards in outlined slots, and pinch to make your active creature attack. A mouse-driven browser preview plays the same match on a PC.

Quick Battle opens the original Zubat versus Pikachu demo. **Choose a team** opens four expanded presets with eight imported Pokémon, and **Card collection** shows all 12 Pokémon and four Trainers. Models, textures and card artwork are served locally. The card rules are custom to this tabletop format.

[Expansion roster, playthroughs and verification](docs/EXPANSION.md) · [Model credits and noncommercial license terms](public/models/CREDITS.txt) · [Card artwork source](https://github.com/PokeAPI/sprites)

## Run it

```powershell
npm install
```

**Browser preview (PC, mouse):**

```powershell
npm run dev
```

Open http://localhost:5173 and choose **Quick Battle**. Or go straight in with http://localhost:5173/?mode=quick.

| Input | Action |
|---|---|
| Left-click | Pinch |
| Hold left-click on a card (~0.75 s) | Inspect |
| Right-drag | Orbit |
| Wheel | Zoom |
| `1` / `2` (or the HUD buttons) | Your seat / opposite seat |

**Quest 3S (passthrough + hands):**

```powershell
npm run dev:quest
```

1. The terminal prints a `Network:` URL such as `https://192.168.1.20:5173`. Allow Node through Windows Firewall if asked.
2. On the headset, open that URL in Quest Browser. The headset and the PC must be on the same Wi-Fi.
3. Accept the self-signed certificate warning. WebXR requires HTTPS.
4. Tap **Quick Battle**. Allow passthrough and hand tracking if the browser asks.
5. Point at the centre of the table and pinch. Rotate with **⟲/⟳** or **FACE ME**, use **SMALLER/LARGER** if the table is small, then **CONFIRM**.
6. Put your cards in the white outlines and pinch each slot to confirm it, or pick **USE VIRTUAL CARDS**.

**Two headsets at one table:**

1. Both headsets open the same `dev:quest` URL.
2. One player taps **Play at the Same Table → HOST** and reads out the 4-letter room code. The other enters the code and taps **JOIN**.
3. Each player pinches the same two physical points, in the same order: the arena centre, then a point on the **host's** side of the table.
4. Check the preview (centreline and HOST/GUEST labels), then **CONFIRM**.

**Two-client simulation (no headsets):** with `npm run dev` running, open these in two browser tabs:

- http://localhost:5173/?mode=host&room=TEST
- http://localhost:5173/?mode=guest&room=TEST

**Tests:** `npm test` runs the rules engine, the AI, the pointer/pinch logic, and host/guest sync over an in-memory link (25 tests).

**Browser test harness (dev only):** with a preview page open, run this in its console. It drives the game through the real pointer path and steps time deterministically:

```js
const H = await import('/tools/harness.js'); await H.ready(); await H.register();
await H.openingBite();          // presses the first move, stops 2 frames after its impact
H.snapshot(); await H.profile(1.5); H.counts();
```

[tools/harness.js](tools/harness.js) is never imported by the game and isn't part of the production build.

## How it fits together

- [src/rules/](src/rules/): pure rules (`engine.js`), editable data (`data.js`) and the AI (`ai.js`). No rendering, no XR.
- [src/net/match.js](src/net/match.js): one authoritative peer (`Authority`) and `MatchClient`s.
  - A pinch, mouse click, AI decision or network request all become the same `{type, ...}` action. That action is validated by `applyAction`.
  - Request IDs and sequence numbers stop a repeated pinch or a repeated message from applying twice.
  - A reconnecting client gets a state snapshot with no events, so the last hit is never replayed.
- [server/relay.js](server/relay.js): a tiny room relay on the dev server (`/relay`). It forwards messages and never runs rules.
- [src/view/](src/view/): arena, procedural creatures, effects, card faces (with bundled Pokémon illustrations), panels and synthesized spatial sounds.
  - Everything hangs off one `tableRoot` whose origin is the arena centre, so Reposition moves it all together.
- [src/game/app.js](src/game/app.js): placement → registration → battle.
  - Animations are driven only by confirmed events. HP bars end on the confirmed state.
- [src/input/pointer.js](src/input/pointer.js): a single input path for mouse, hands and controllers.
  - Hover focus comes before commit. Buttons fire on press; cards fire a tap on release, or an inspect after a hold.
  - A new pinch needs the previous one released. Losing tracking cancels a hold and changes nothing else.
- [src/xr/xr.js](src/xr/xr.js): the immersive-ar session, hand/controller rays, and table surfaces.
  - Surface lookup tries detected planes, then hit-test, then an adjustable virtual plane.
  - Table anchors persist when the browser supports it.

## Card registration that actually exists

- **Guided manual registration.** The slot asks for a specific card; you place it and pinch the slot to confirm. This is the only physical-card path.
- **Virtual cards.** Pinch a card in the small hand, then pinch the slot.
- **No automatic recognition.** WebXR in Quest Browser gives no camera image to recognize cards from.
- **No shared spatial anchors.** WebXR does not offer them, so two-headset alignment uses the manual two-point method.

## The first minute (Quick Battle)

1. Point at the centre of the table and pinch. Turn the footprint so the arrow points at you, then **CONFIRM**.
2. Put Zubat in **ACTIVE** and Koffing in the left **BENCH**, then pinch each slot. The slot flashes when it is confirmed. Or choose **USE VIRTUAL CARDS**: pinch a card in the hand, then its slot.
3. Hold over Koffing. A dark pill with three dots appears over the card, and the dots fill over 0.75 s. Koffing's card then rises out of the bench slot and settles left of the stadium, so both figures stay visible. Any pinch dismisses it.
4. Pinch **BITE**. The button pushes in on the first frame and the callout appears on the next. About 0.35 s later the impact lands: the violet bloom, the purple-tinted recoil, the sound and the HP drain all start together. Pikachu settles at 40/60.
5. About a second later the opponent's reply lands: a jagged yellow burst with a dark rim around Zubat. Zubat settles at 20/40.

## Polish pass (this revision)

These are the problems found while playing the previous build from the default seat, and what changed. Captures are in [docs/captures/before](docs/captures/before) and [docs/captures/after](docs/captures/after). All are 1280×800 CSS px at DPR 1.5 from the default seat camera unless the file name says otherwise, and were reached with the harness steps above.

| What was rough (before) | Change |
|---|---|
| At impact, Zubat's dart parked it directly between the player and Pikachu, hiding the bloom and the recoil behind its back (`before/5-bite-impact+2f`). | The dart rises and swings to the side, so contact happens above and beside the target. The effect blooms at the actual contact point. One confirmed impact event starts the sound, the effect peak, a short local light, a tinted recoil with follow-through, and the HP drain, all on the same frame (`after/5a`–`5c`). |
| From your seat, your own creature's HP bar landed right on top of the far creature (`before/2-opening-seat0`). | Bars are placed per viewer. The far creature's bar sits just above its measured height. The near creature's bar sits low and to the viewer's left. Both seats get this automatically (`after/2`, `after/4`). |
| The three hold dots were 6 mm, white and flat on a light card, and couldn't be seen from the seat. The preview popped in at the centre and hid both figures (`before/3a`, `before/3b`). | A raised dark meter whose three dots fill with real hold progress. The preview rises out of the held card and sits left of centre. Dismissing it sends it back to the card (`after/3a`, `after/3b`). |
| From the opposite seat, the upright card backs hid Zubat completely (`before/4`). | The upright lineup sits lower and further back, below both seats' sight lines to both figures (`after/4`). |
| Every impact compiled 2 new shader programs, because effects disposed their materials and three.js then freed the programs. | Effect shaders are compiled and drawn once before the first attack, and kept. |

Other changes:

- **Buttons:** distinct rest, focus, press and unavailable looks. Unavailable buttons are hatched and show an amber rim on focus. All of them read on light and dark tables.
- **Explanations:** messages such as "Koffing is at full HP" and "Bench a Pokémon to retreat" now appear beside whatever you touched, as well as on the side panel.
- **Pointer feel:**
  - Focus stays put within a few mm, so tremor at the BITE/RETREAT edge doesn't flicker.
  - A hold tolerates about 1 cm of drift and cancels predictably after 0.15 s away.
  - A pinch one frame after a release is no longer dropped.
  - The XR ray is lightly smoothed (35 ms time constant, independent of frame rate).
- **Arena:** the markings use a polygon offset instead of a 0.4 mm height gap.
- **Memory:** creature meshes and board resources are freed on knockout, rematch and exit.
- **Startup:** the game no longer hangs when the tab opens in the background (`image.decode()` could stay pending).
- **Readability:** larger panel and HP text. The banner and Rematch button stay clear of the figures.
- **Feedback:** knockout markers pop, and slots flash on confirmation.
- **Menu:** the room field is labelled, Enter joins, and status text is announced to screen readers.

Not changed: creature shapes and card artwork. Only motion, timing, placement and effects were touched.

## Test record (this revision)

| Area | Result | Evidence |
|---|---|---|
| Rules (Node) | **Pass** | 25/25 tests. Covers: opening HP; Bite 60→40, then the scripted Pika Punch 40→20; Charge adds +10 once; retreat keeps HP; Potion (invalid target, valid heal, cap, once per turn); bench; knockout, score, promotion, win; rematch reset; hidden hands; 60 AI-vs-AI matches. New: empty deck skips the draw, End Turn handover, retreat explanation. |
| Pointer logic (Node) | **Pass** | 6 new tests: first-frame commit; release required before a repeat; latched one-frame tap; BITE/RETREAT edge with tremor; hold tremor vs. deliberate cancel; tracking loss mid-hold. |
| Browser pointer input (desktop Chrome 156, mouse through the real pointer path) | **Pass** | Registration. Inspecting Koffing twice and then pressing Bite at once left the state unchanged. Six rapid presses produced one attack. Bite → 40/60 and the reply → 20/40, with the slot label and log agreeing and one impact event per attack. Potion with nothing damaged. Retreat → cancel. Bench from hand. Potion on full-HP Koffing (card kept), then on Zubat (healed). End Turn. A dimmed Retreat explains itself. Retreat to Koffing, then Suffocating Gas (20). Forced Charge: indicator shown, opponent HP unchanged, next hit 30, indicator cleared. A full match with 5 knockouts, promotions that kept reserve HP, 8 empty-deck turns and the loss screen. Hints vanish when a player attacks first. |
| Rematch and exit | **Pass** | Rematch clears HP, charge, markers, hints, effects, the preview and input locks, and keeps placement. Geometries per rematch: before 157 → 204 → 246 → 288 (+42 each); after 151 → 156 → 156 → 156. Three exits to the menu each drop back to 10 geometries, 9 textures and 0 interactables. |
| Browser relay (two tabs, dev server) | **Pass** | Host Bite and guest Pika Punch agree on both clients, with one attack event each. A guest reload restores HP, actives, score and turn from a snapshot, with no replayed attack. The host's hand stays hidden (0 visible / 2 held). |
| Production build | **Pass** | Served with `vite preview` on port 4173: every request goes to localhost, and the relay answers there too. |
| Desktop frame time (Chrome 156, AMD Radeon iGPU via ANGLE/D3D11, 1280×800 at DPR 1.5; step + render timed with `gl.finish`; 600 frames over two exchanges) | **Improved** | Shader programs compiled during attacks: 7 before (the first Bite impact frame took 95.7 ms), 0 after. After: median 4.8 ms, p95 7.9 ms, p99 13 ms, max 26.6 ms (first exchange only). Draw calls about 170–190, unchanged. Idle frames on this machine spiked to 65 ms, so single max values aren't reliable. **These are desktop numbers, not headset numbers.** |
| Menu | **Pass** (desktop, 375×812) | Both launch choices, the tutorial preference, the room code and the join error text are reachable in tab order. No horizontal overflow; the focus outline is visible. |
| **One Quest 3S** | **Untested** | Still to check on the headset: passthrough; how pinch and ray smoothing feel; near/far selection; hand occlusion; tracking loss during inspect; plane detection and hit-test; anchors; realignment after reposition; legibility at arm's length; browser version, refresh rate, frame time and thermals. |
| **Two Quest headsets** | **Untested** | Two-point alignment accuracy, whether the arena rim and effects land in the same place for both seats, drift and recovery. |
