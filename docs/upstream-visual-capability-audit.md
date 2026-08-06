# Upstream AI Town Visual Capability Audit (ART-107 / FR-N001)

This audit produces the authoritative inventory PRD 2.0 §10.3's engine-retirement
decision depends on: what to keep (renderer), what to retire (server-side engine), and
which Convex mutations/actions are currently reachable from the public game UI. It also
resolves the Mistwood dataset ambiguity flagged during the PRD 2.0 Requirement Matrix
review. Evidence for every claim below was gathered by reading the current source tree
and by actually booting the renderer (see §5); nothing here is inferred from memory of
the original a16z template.

> **Correction (2026-08-05, during ART-112 implementation):** three dispositions below
> turned out to be wrong once actually executed, not just read. `convex/aiTown/movement.ts`
> and `location.ts` import `Game`/`Player` (both retired) and cannot compile standalone —
> they are retired, not preserved. `convex/testing.ts`'s `stop`/`resume`/`kick` call
> `stopEngine`/`startEngine`/`kickEngine` from the now-deleted `aiTown/main.ts` and would
> crash if kept; the whole file retires (this incident's containment mechanism does not
> survive ART-112, by design — the engine it froze no longer exists to be frozen). See
> ADR-0004 and §9 below for the corrected, as-shipped disposition.

## 1. Renderer inventory

> **Update (ART-113 / FR-N002):** `PixiViewport.tsx`, `PixiStaticMap.tsx` and
> `Character.tsx` moved to `src/components/world/` and were made read-only — `Character`'s
> `onClick` prop is gone, and both it and the tile container now take no pointer events.
> The paths below are the ones this audit found; see
> [`read-only-world-shell.md`](read-only-world-shell.md) for the shell that owns them now.

| Item | Status | Notes |
|---|---|---|
| `src/components/PixiGame.tsx` | **Needs modification** | Pure PixiJS scene composition (Viewport + StaticMap + Player list) is reusable; the click-to-move handler (`onMapPointerUp` → `useSendInput(engineId, 'moveTo')`, line 36/80) and the human-player zoom effect are engine-coupled and are removed by ART-112. |
| `src/components/PixiViewport.tsx` | **Reusable as-is** | Thin `PixiComponent` wrapper around `pixi-viewport`'s `Viewport` (drag, pinch, wheel, decelerate, clamp, zoom). Zero Convex/aiTown imports. |
| `src/components/PixiStaticMap.tsx` | **Reusable as-is** | Blits `WorldMap.bgTiles`/`objectTiles` layers plus animated decorative sprites (campfire/sparkle/waterfall/splash/windmill). Only imports `WorldMap`/`AnimatedSprite` *types* from `convex/aiTown/worldMap.ts` (a data shape, not engine lifecycle) — see §2. |
| `src/components/Character.tsx` | **Reusable as-is** | Pure sprite/animation renderer. Props are plain values (`textureUrl`, `spritesheetData`, `x`, `y`, `orientation`, `isMoving`, `isThinking`, `isSpeaking`, `emoji`, `isViewer`, `speed`, `onClick`) — **zero** dependency on any `aiTown`/Convex type. This is the component the future Visual Runtime (FR-N010) should drive directly from ART's own projection data. |
| `src/components/Player.tsx` | **Dead once ART-112 lands** | Thin adapter from a16z's live `ServerPlayer`/`ServerGame`/`Conversation`/`Location` state to `Character.tsx` props (speaking/thinking derived from `game.world.conversations`/`agents`). Not reusable as-is — FR-N010 will need a new adapter from ART's own projection, but `Character.tsx` underneath is unaffected. |
| `data/spritesheets/{f1-f8,p1-p3,player}.ts` + `types.ts` | **Reusable as-is** | Character spritesheet pixel data and animation frame definitions. No engine coupling. |
| `data/animations/{campfire,gentlesparkle,gentlesplash,gentlewaterfall,windmill}.json` | **Reusable as-is** | Decorative environment animation spritesheets, consumed by `PixiStaticMap.tsx`. |
| `data/gentle.js` (+ `assets/gentle-obj.png` tileset) | **Reusable as-is, but content is generic** | The current tilemap is the stock a16z demo map, not Mistwood. It is a valid *tileset* to reuse (per the PRD 2.0 decision to rebuild a Mistwood-specific map from this tileset) but its current tile layout has no relationship to Mistwood's eight locations. Building the actual Mistwood map layout is separate, later work (not this task). |
| `data/convertMap.js` | **Reusable as-is (tooling)** | Offline script that produced `gentle.js` from the Tiled map export; useful again when building the Mistwood-specific map. |
| `data/characters.ts` | **Dead / a16z-demo-specific** | Hardcoded a16z demo character roster (`Lucky`, `Bob`, `Stella`, …) with LLM personas, referenced only by `Player.tsx` (dead) to resolve `character.textureUrl`/`spritesheetData` by name. The *shape* (name → spritesheet/texture mapping) is a useful reference for `CharacterVisualBinding` (ART-111) but the content itself does not carry over. |
| Collision / pathfinding | **Retired, corrected from "preserve"** | `convex/aiTown/movement.ts`'s `blocked()`/`findRoute()`/`movePlayer()`/`stopPlayer()` all take a `Game` and/or `Player` parameter (imported directly from `./game`/`./player`), not just `WorldMap`. Confirmed at ART-112 implementation time: the file cannot compile once `game.ts`/`player.ts`'s lifecycle is removed, so it retires with them. `convex/util/geometry.ts`/`util/minheap.ts` (generic math/heap primitives movement.ts itself depends on) have zero such coupling and are preserved instead — a future Visual Runtime's pathfinding still has to be written against them from scratch (FR-N010), not resumed from this file. |
| Viewport drag/pan/zoom, click-to-select | **Reusable as-is** | `PixiViewport.tsx` (`.drag().pinch({}).wheel().decelerate().clamp(...).setZoom(...).clampZoom(...)`); click-to-select-a-character is `Character.tsx`'s own `Container interactive pointerdown={onClick}` (line 87), independent of `moveTo`. |

`package.json`: `pixi.js@^7.2.4`, `@pixi/react@^7.1.0`, `pixi-viewport@^5.0.1`.

## 2. Data-shape modules that must be preserved (not "lifecycle")

Three files live under `convex/aiTown/` but are pure data/type definitions the preserved
renderer depends on, not simulation lifecycle. ART-112 keeps these:

- `convex/aiTown/worldMap.ts` — `WorldMap`/`AnimatedSprite` classes (tile dimensions, layers, animated-sprite placements). Imported by `PixiStaticMap.tsx`, `serverGame.ts`.
- `convex/aiTown/ids.ts` — generic `GameId<T>` branded-string helper. Imported by `convex/schema.ts` itself (`conversationId`, `playerId`) and by renderer-adjacent types.
- ~~`convex/aiTown/location.ts`~~ — **correction:** its only importer was `Player.tsx` (retired). Retired along with it, not preserved (see the correction note above).

`convex/aiTown/schema.ts`, `convex/agent/schema.ts`, and `convex/engine/schema.ts` (Convex
table definitions) are also preserved unchanged, per PRD 2.0 §10.3: "a16z engine tables
become inert; no Canon schema change." Removing table *definitions* while historical rows
still exist would fail Convex's schema validation on deploy; ART-112 does not attempt a
data migration.

## 3. a16z server-side engine entry points, classified against §10.3

| Capability | Files | §10.3 disposition |
|---|---|---|
| World execution loop | `convex/aiTown/main.ts` (`runStep`, `startEngine`, `kickEngine`, `stopEngine`, `createEngine`, `sendInput` mutation), `convex/aiTown/game.ts` (`Game` class, `loadWorld`/`saveWorld`) | **Retire** |
| Agent reasoning | `convex/aiTown/agent.ts`, `agentDescription.ts`, `agentInputs.ts`, `agentOperations.ts`; `convex/agent/conversation.ts`, `memory.ts`, `embeddingsCache.ts` | **Retire** (confirmed zero importers from `convex/simulation`, `knowledge`, `story`, `canon`, `publicRead`, `operations`, `safety`, `editorial`, `recaps`, `viewer`, `observability` — see §4) |
| Chat / conversation state | `convex/aiTown/conversation.ts`, `conversationMembership.ts` | **Retire** |
| Input queue plumbing | `convex/aiTown/inputHandler.ts`, `inputs.ts`, `insertInput.ts` | **Retire** (only called by `main.ts`/`testing.ts`/`world.ts`'s engine mutations, all themselves retiring) |
| Human Player | `convex/aiTown/player.ts`, `playerDescription.ts`; `convex/world.ts`: `joinWorld` (:128), `leaveWorld` (:161) | **Retire** |
| Heartbeat-driven restart | `convex/world.ts`: `heartbeatWorld` (:29) | **Retire** |
| Crons | `convex/crons.ts`: `stop inactive worlds` → `world.stopInactiveWorlds` (:69), `restart dead worlds` → `world.restartDeadWorlds` (:84) | **Retire** |
| Client input dispatch | `convex/world.ts`: `sendWorldInput` (:186) | **Retire** |
| Chat write path | `convex/messages.ts`: `writeMessage` | **Retire** |
| Dev-only freeze/resume | `convex/testing.ts`: `stop`, `resume`, `stopAllowed`, `kick` | **Retire, corrected from "preserve"** — `stop`/`resume`/`kick` call `stopEngine`/`startEngine`/`kickEngine` from `aiTown/main.ts`; once that file is gone, calling them would crash. This was the exact mechanism used for this incident's containment, but it is retiring *by design*, not oversight: once the engine it froze no longer exists, "freezing" it is meaningless, and "Preserve: admin emergency controls" in ART-112's scope refers to ART's own FR-K006 kill switch (`convex/simulation/emergencyStopOperations.ts`), a separate, unrelated system that is unaffected. |
| Read-only world-state queries | `convex/world.ts`: `defaultWorldStatus` (:19), `worldState` (:203), `gameDescriptions` (:227), `userStatus` (:114), `previousConversation` (:251) | **Retire together with their only callers** (`Game.tsx`, `PixiGame.tsx`, `PlayerDetails.tsx`, `serverGame.ts`, `InteractButton.tsx` — none of these are used by any ART/public-read surface) |
| Emergency-stop guard | `convex/simulation/emergencyStopOperations.ts` (`isPublicWorldEmergencyStopped`, `assertPublicWorldAdmitsSimulation`) | **Preserve unchanged** — this is ART's own FR-K006 kill switch; `heartbeatWorld`/`restartDeadWorlds` merely call into it today. Its two call sites inside the retired functions disappear along with those functions; the module itself, and its use elsewhere in the ART pipeline, is untouched. |

## 4. Client-triggerable Convex mutations/actions reachable from the game UI

| Call | File:line | Retires with |
|---|---|---|
| `api.world.heartbeatWorld` | `src/hooks/useWorldHeartbeat.ts:11` | Engine lifecycle |
| `api.world.joinWorld` | `src/components/buttons/InteractButton.tsx:21` | Human Player |
| `api.world.leaveWorld` | `src/components/buttons/InteractButton.tsx:22` | Human Player |
| `api.world.sendWorldInput` (via `useSendInput`) | `src/hooks/sendInput.ts:48` | Input queue |
| — `moveTo` | `src/components/PixiGame.tsx:36` | " |
| — `startTyping` | `src/components/MessageInput.tsx:27` | " |
| — `startConversation`, `acceptInvite`, `rejectInvite`, `leaveConversation` | `src/components/PlayerDetails.tsx:51-54` | " |
| `api.messages.writeMessage` | `src/components/MessageInput.tsx:26` | Chat write path |
| `api.testing.stop` / `api.testing.resume` | `src/components/FreezeButton.tsx:11-12` | Public-page UI only; mutations preserved as an operator control (see §3) |

No other client file calls `useMutation`/`useAction` (verified: `grep -rl "useMutation\|useAction" src` returns exactly `FreezeButton.tsx`, `MessageInput.tsx`, `InteractButton.tsx`, `useWorldHeartbeat.ts`; `PixiGame.tsx`'s `moveTo` goes through `useSendInput`, found separately). Every one of these entry points retires with ART-112; none are used by any ART/public-read page (`Homepage`, `EpisodeList`, `EpisodeDetail`, `LiveView`, `CharacterPage`, `TimelineView`, `ArcDetailPage`).

## 5. Renderer actually booted (AC#3)

Booted `http://localhost:5173/ai-town` (the bare, no-hash route) in a real browser against
the current dev deployment, **after** this session's engine-stop containment action (world
`stoppedByDeveloper`, `engine.running: false`). Observed:

- The PixiJS canvas renders correctly: the stock a16z "gentle" tilemap (forest, waterfall,
  camp) with full drag/pan/zoom.
- The footer correctly reflects containment state — the freeze toggle reads **"Unfreeze"**
  (confirms `FreezeButton.tsx` correctly derives `frozen = defaultWorld?.status ===
  'stoppedByDeveloper'`).
- No characters are visible in the initial viewport (last-known static positions from
  before the stop, off-screen at default zoom) — expected, since `worldState`/
  `gameDescriptions` are ordinary reads of stored rows and do not require `engine.running`.
- Confirmed via `npx convex data engines` immediately before and after: `generationNumber`
  and `running` were unchanged by booting/loading the page. Booting the renderer does not
  restart the engine.

## 6. Why current public pages don't use the dynamic renderer (AC#4)

The bare `/ai-town` route (rendering `<Game />`) and the six PRD-2.0-era public pages
(`#home`, `#episodes/…`, `#episode/…`, `#live/…`, `#character/…`, `#timeline/…`,
`#arc/…`) are two entirely separate systems that have never been connected:

- `<Game />` → `PixiGame.tsx` reads **only** `api.world.worldState` /
  `api.world.gameDescriptions` — the a16z engine's own `worlds`/`playerDescriptions`/
  `worldMap` tables, populated exclusively by `aiTown/main:runStep`.
- The public pages read **only** the ART `publicRead` model
  (`convex/publicRead/readModel*.ts`), sourced from Canon Accepted Events
  (`mistwoodSeed.ts` → Canon events → reducer → snapshots → public read model).

There is currently **no code path anywhere** that feeds Mistwood Canon data into the
PixiJS renderer, or vice versa. The renderer displays the generic a16z demo world; the
public pages display Mistwood narrative text. This is not a bug being fixed here — it is
exactly the gap PRD 2.0's Visual Runtime work (ART-113 read-only shell, ART-114 Visual
Runtime, ART-115 Public Dynamic Projection) exists to close.

## 7. Minimal restoration path to a rendering public view (AC#5)

Not built in this task (ART-112 explicitly excludes FR-N002/FR-N010). For the record, the
shortest path once ART-112 lands:

1. ART-113 mounts a **new**, read-only PixiJS shell on the public surface, composed from
   the preserved renderer (`PixiViewport`, `PixiStaticMap`, `Character`) — not from `Game`/
   `PixiGame`/`Player`, which retire with this task.
2. ART-114/115 feed that shell from ART's own `PublicCharacterMotion` projection
   (`convex/publicRead/liveState.ts` + the new Visual Binding), never from `aiTown`'s
   `worldState`/`gameDescriptions`.
3. A Mistwood-specific map is built from the `gentle.js`/`gentle-obj.png` tileset (§1),
   replacing the generic demo layout. **Delivered by ART-109** as `data/mistwood.ts`
   (see `docs/mistwood-tilemap.md`).
4. `Character.tsx` is driven directly with `textureUrl`/`spritesheetData` resolved from
   `CharacterVisualBinding` (ART-111) instead of the retired `data/characters.ts` roster.

## 8. Mistwood dataset disambiguation (AC#8/#9/#10)

Three distinct Mistwood-named datasets exist in the repository:

| Dataset | File | Status |
|---|---|---|
| **Production Mistwood Seed** | `convex/canon/mistwoodSeed.ts` | The real seed: twelve residents (Lin Yingxue, Gao Wenrui, Su Meizhen, He Jun, Qiu An, Luo Shan, Tang Ruoxi, Shen Kai, Pei Lan, Wu Zhen, Fang Yue, Zhao Ming) across eight real locations (`mistwood-station`, `mistwood-paper`, `mistwood-clinic`, `mistwood-hall`, `mistwood-mill`, `mistwood-square`, `mistwood-inn`, `mistwood-orchard`). This is the only dataset any V2 production-acceptance work may use. |
| **Legacy Canon Test Fixture** (rebuilt in place by this task) | `convex/canon/mistwoodFixture.ts` (filename unchanged) | Previously two invented characters (Cassia, Rowan) at `mistwood-market`/`mistwood-grove` — locations that do not exist in the production seed. Predates PRD 2.0; used by three pre-existing, unrelated Canon foundation tests (`convex/canon/reducer.test.ts`, `convex/canon/replay.test.ts`, `convex/knowledge/canonCognitionIntegration.test.ts`) plus its own `mistwoodFixture.test.ts`. **Decision: rebuilt in place, not renamed.** Now reuses two real production seed IDs (Lin Yingxue at `mistwood-paper`, Wu Zhen at `mistwood-station`) instead of Cassia/Rowan, eliminating the ambiguity without changing the filename. Two of the three dependent tests hard-coded the old IDs in assertions and were updated to match (mechanical, no weakening of what they check); the third only checks fixture self-consistency and needed no change. **Renaming was tried first and reverted**: it reliably reproduced a hard `TS2589` "type instantiation is excessively deep" failure in unrelated files (`convex/music.ts`, `src/components/public/ArcDetailPage.tsx`, and ~10 files under `convex/operations`/`convex/simulation` via ESLint's `no-unsafe-*` rules) — confirmed via a fresh clean-checkout reproduction (not flaky) that this repository's generated Convex `internal`/`api` type union is large enough that file renames alone can perturb TypeScript's type-instantiation order past a hard depth limit for unrelated call sites. A content-only change to the same filename does not trigger it. This is a real, pre-existing, latent fragility in the codebase's TypeScript/Convex-codegen interaction, unrelated to this fixture's correctness — flagged for the user as its own follow-up, not fixed here. |
| **V2 Visual Runtime Fixture** | None exists yet | No V2 task (ART-108–ART-140) has created a dedicated visual-runtime test fixture as of this audit. Any future one must derive its character/location IDs from `mistwoodSeed.ts`, never from the legacy fixture's old Cassia/Rowan IDs (now removed). |

**Binding rule (must be followed by every downstream task):** V2 Dynamic Live production
acceptance — **ART-119 production acceptance, ART-137, ART-138** — must never use invented
test-only character/location IDs; always use the production Mistwood seed
(`convex/canon/mistwoodSeed.ts`). Those tasks' descriptions have been updated to state this
rule (see backlog task edits accompanying this audit).

## 9. Summary disposition

- **Retire (ART-112, as shipped):** `convex/aiTown/main.ts`, `game.ts`, `agentInputs.ts`,
  `agentOperations.ts`, `conversationMembership.ts` *(correction: not needed — kept;
  `conversation.ts` needs it)*, `inputHandler.ts`, `inputs.ts`, `insertInput.ts`,
  `location.ts` *(correction: retired, not preserved — see note above)*, `movement.ts`
  *(correction: retired, not preserved — see note above)*; `convex/agent/conversation.ts`,
  `memory.ts`, `embeddingsCache.ts`; `convex/engine/abstractGame.ts`, `historicalObject.ts`;
  `convex/world.ts` (entire file — every remaining function was only reachable from
  retiring callers); `convex/messages.ts` (entire file); `convex/testing.ts` *(correction:
  entire file retires — see note above)*; the two crons; `src/components/Game.tsx`,
  `PixiGame.tsx`, `Player.tsx`, `PlayerDetails.tsx`, `MessageInput.tsx`, `Messages.tsx`,
  `DebugPath.tsx`, `PositionIndicator.tsx`, `DebugTimeManager.tsx`, `FreezeButton.tsx`,
  `InteractButton.tsx`; `src/hooks/useWorldHeartbeat.ts`, `sendInput.ts`, `serverGame.ts`,
  `useHistoricalTime.ts`, `useHistoricalValue.ts`; `data/characters.ts`.
  `convex/aiTown/player.ts`, `agent.ts`, `conversation.ts` are reduced (not deleted) to
  their `serialized*` validator plus a minimal inert class, since `aiTown/schema.ts` still
  needs the validators for historical-row compatibility.
- **Preserve (data/renderer):** `PixiViewport.tsx`, `PixiStaticMap.tsx`, `Character.tsx`,
  `data/spritesheets/*`, `data/animations/*`, `data/gentle.js`, `data/convertMap.js`,
  `convex/aiTown/worldMap.ts`, `ids.ts`, `conversationMembership.ts`,
  `playerDescription.ts`, `agentDescription.ts`, the reduced `player.ts`/`agent.ts`/
  `conversation.ts`, and all three `schema.ts` files (tables become inert, not deleted).
  `convex/util/geometry.ts` and `util/minheap.ts` are also preserved: generic math/heap
  utilities with zero Game/Player coupling, unlike `movement.ts`.
- **Preserve (ART pipeline, unaffected — confirmed zero cross-imports):** `convex/canon`,
  `simulation`, `knowledge`, `story`, `editorial`, `recaps`, `publicRead`, `viewer`,
  `operations`, `safety`, `observability`.
