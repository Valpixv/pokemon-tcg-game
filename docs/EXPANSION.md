# Pokémon tabletop expansion

The game has **16 distinct card definitions**. Twelve are Pokémon and four are Trainers. Each expanded player starts with one active, one reserve, two cards in hand and a seven-card deck before the opening draw. Multiple copies in a deck have independent card identities.

## Three matches to try

1. **A first imported model.** Choose **Choose a team**, enter seed **1024**, and select **Night Garden**. Click the active and left bench slots to register Bulbasaur and Gastly in desktop preview. Hold Gastly to inspect and release. Click to dismiss, then select **Vine Whip** beside Bulbasaur. Watch from the opposite seat with **2**, then return with **1**. When Bulbasaur takes damage, **Absorb** trades direct damage for healing.
2. **Spend a Trainer for tempo.** Choose **Magnetic Field**. Register Magnemite and Pikachu. Select **X Attack** in the hand, select Magnemite in ACTIVE, then choose **Thunder Shock**. The bonus comes from the same charge state as Charge. X Attack spends the Trainer allowance and leaves the attack available this turn. It can also be saved for a benched finisher.
3. **Rescue a damaged lead.** Choose **Flame Dash**. Keep Switch in hand through the first exchange. When Charmander is damaged, select **Switch** and Eevee on the bench. Eevee can attack immediately. Later use **Baton Pass**, select Charmander only if it can survive the next hit, and observe its preserved HP when it returns. Ordinary Retreat spends the turn. Start with **Shell Guard** instead to try blocking the next heavy hit with Withdraw or Defense Curl.

**Quick Battle** always starts the original demonstration. **Surprise me** selects two different presets. An optional solo seed reproduces the teams and shuffled decks. AI decision randomness during interactive play is separate. Rematch repeats the deck setup. New Matchup chooses another pairing while retaining the table transform. The host selects shared-mode teams under **Play at the Same Table → Host matchup**. Both players can use physical guided registration or virtual cards.

## Playable roster

| Species | HP | Moves | Role | Team | Model |
|---|---:|---|---|---|---|
| Charmander | 50 | Ember 20, Take Down 40 | Finisher with 10 recoil | Flame Dash | Imported |
| Eevee | 50 | Quick Attack 20, Baton Pass 10 | Switches to a chosen reserve after impact | Flame Dash | Imported |
| Zubat | 40 | Bite 20 | Fast contact attacker | Flame Dash | Existing |
| Squirtle | 60 | Water Gun 20, Withdraw | Blocks 10 damage from one hit | Shell Guard | Imported |
| Sandshrew | 60 | Scratch 20, Defense Curl | Blocks 20 damage from one hit | Shell Guard | Imported |
| Psyduck | 60 | Water Gun 20, Confusion 10 | Confusion clears guard and charge before damage | Shell Guard | Imported |
| Bulbasaur | 60 | Vine Whip 20, Absorb 10 | Recovers HP up to actual damage dealt | Night Garden | Imported |
| Gastly | 50 | Lick 20, Hex 10 | Hex marks a specific card for another 15 at its owner's turn end | Night Garden | Imported |
| Koffing | 60 | Suffocating Gas 20 | Gas attacker | Night Garden | Existing |
| Magnemite | 50 | Thunder Shock 20, Charge | Banks a one-use +10 bonus | Magnetic Field | Imported |
| Pikachu | 60 | Pika Punch 20, Charge | Electric contact attacker | Magnetic Field | Existing |
| Geodude | 50 | Rock Throw 30 | High-damage reserve | Magnetic Field | Existing |

**Potion** heals one damaged friendly Pokémon by up to 20. **Switch** swaps the active with a living reserve and retains the turn. **Poké Ball** takes the first Basic from the deck into the owner's private hand. **X Attack** grants one friendly Pokémon the same nonstacking bonus as Charge. Each expanded team can play one Trainer per turn. Empty Poké Ball searches and invalid targets preserve the card. Select the card again or choose Cancel to dismiss selection.

Guard persists through retreat and applies to the next direct damaging attack. Hex follows its card onto the bench and resolves once. Recoil and Hex bypass guard. The authority resolves all knockouts for the action before checking victory. A simultaneous win goes to the defending seat. When both sides require promotion the defender chooses first, then the attacker. Normal play resumes with one turn transition.

## Model credits and implementation

**Eight imported models, four existing procedural figures, zero newly authored replacement species.** All eight imports come from CableMC's Cobblemon Assets repository, revision `90dceba19cdae707bbb8c1134c6488aaa6e911dc`. They use creator-authored Bedrock geometry and texture atlases. The game constructs a Three.js bone hierarchy directly from these files. The desktop art pass adds combat poses, a flame at Charmander's tail, a small Gastly aura, and attack effects. Card portraits are separate PNGs.

Every row in the [source manifest](../public/models/sources.json) includes the direct pinned source folder, original filenames, exact runtime paths, credited creator, and license URL. The [in-game credits](../public/models/CREDITS.txt) are also reachable through Card collection. Each species directory contains a copy of the source license. The model package uses **CC BY-NC 3.0**. Pokémon characters belong to their respective owners.

| Model and texture credit | Runtime directory | Imported clip used |
|---|---|---|
| Cobblemon contributors · Bulbasaur | public/models/bulbasaur | animation.bulbasaur.battle_idle |
| Cobblemon contributors · Charmander | public/models/charmander | animation.charmander.battle_idle |
| Cobblemon contributors · Squirtle | public/models/squirtle | animation.squirtle.battle_idle |
| Cobblemon contributors · Eevee | public/models/eevee | animation.eevee.ground_idle |
| Cobblemon contributors · Gastly | public/models/gastly | animation.gastly.ground_idle |
| Cobblemon contributors · Psyduck | public/models/psyduck | animation.psyduck.ground_idle |
| Cobblemon contributors · Sandshrew | public/models/sandshrew | animation.sandshrew.battle_idle |
| Cobblemon contributors · Magnemite | public/models/magnemite | animation.magnemite.air_idle |

Geometry, texture and baked animation are loaded on first use of a species. An eight-entry maximum source cache shares geometry and textures. Visible cubes share one rigidly weighted skinned mesh per species. Each figure owns its skeleton, material, bone transforms, tint and attack pose. A spawn token discards superseded loads and disposal invalidates pending spawns. Source clips are sampled offline with `python tools/bake-model-idles.py`. Runtime playback uses numeric tracks. Eevee adds a tail wag to its held source pose. No external decoder is required.

## Verification

| Check | Result |
|---|---|
| Rules, original demo, pointer and transport regression tests | Passed with npm test. |
| All ordered preset pairings | 512 of 512 matches finished within the action cap. Thirty-two seeds per pairing including mirrors. Median per pairing ranged from 19 to 33 turns. Longest match was 41 turns. |
| Balance | Hex deals 10 on impact and 15 at turn end. Night Garden won 30 of 64 meetings with Shell Guard across both seats, up from 5 with the original 10-point mark. On a separate set of seeds (101 through 132), the same result rose from 7 to 28 wins out of 64. First-seat advantage persists. |
| Normal desktop preview | Menu selection, card inspection, registration, attacks, retreat, promotion, a complete match and rematch exercised in Edge. A synthetic pointer drove the opening. Automated choices used the game controller for the longer match. |
| Shared game | Two browser clients over the preview relay, targeted X Attack, authoritative charged hit, hidden guest view and reconnect snapshot. |
| Cold production build | Fresh page loads, browser cache disabled, all non-local page requests blocked. Checked all presets, the original exchange, all eight local imports and independent same-species instances. Checked animated vertex movement on all eight imports and captured four angles for all twelve figures beside the bundled portraits. |
| One Quest 3S | Untested on hardware. |
| Two headsets and physical alignment | Untested on hardware. |
| Quest frame time and thermal behavior | Unmeasured. Desktop draw counts describe the capture scene only. |

[Browser captures and measured draw counts](captures/expansion/verification.json) · [Four views of each playable figure](captures/expansion/roster.jpg) · [First-person tabletop](captures/expansion/garden-near.jpg)

Run `npm test` and `npm run build` for the local checks. The optional browser verification script uses an isolated headless Chromium instance exposing its local DevTools endpoint on port 9348, and starts Vite preview on loopback port 5268. Run `node tools/verify-expansion.mjs` from the repository root. It saves the verified captures under docs/captures/expansion.


### Desktop rendering measurements

At 960 × 680, each sample covers 78 stepped frames of a confirmed attack on Edge with SwiftShader. Peak full-scene draw calls fell from 196 to 135 for Quick Attack and from 174 to 139 for Vine Whip. The triangles at the slowest frame stayed at 5,584 and 5,468 respectively. The 95th-percentile frame time rose from 19.2 to 20.9 ms for Quick Attack and fell from 16.5 to 14.7 ms for Vine Whip. These are individual software-rendered desktop runs. Headset timing requires a device.

[Before batching](captures/expansion/profile-before.json) · [After batching](captures/expansion/profile-after.json)

### Matchup results

Cells show first-seat wins out of 32 seeded games. The first-seat team is the row. The opponent is the column. These are AI results for the shipped preset decks.

| First seat | Flame Dash | Shell Guard | Night Garden | Magnetic Field |
|---|---:|---:|---:|---:|
| Flame Dash | 24 | 28 | 19 | 16 |
| Shell Guard | 28 | 25 | 19 | 10 |
| Night Garden | 23 | 17 | 17 | 16 |
| Magnetic Field | 25 | 25 | 26 | 23 |

For a playable desktop build run `npm run dev`. For the built files and local two-tab relay run `npm run build`, then `npm exec -- vite preview`. For Quest use the HTTPS steps in the root README. A static file server supports the solo build. A running relay is required for shared matches.
