# Public character page (FR-I005)

`src/components/public/CharacterPage.tsx`, over the pure model in `characterRoute.ts`.

FR-I005 lists ten public fields. ART-43 delivered the page and closed with **AC#1 unchecked**,
because several of those fields had no published source at the time. ART-151 re-checked each one
against what is actually published today and delivered what had since become deliverable; ART-169
delivered the last two. This is the record of that assessment — field by field, with the source
named — so the next person does not have to re-derive it.

## 1. The ten fields, as of ART-169

| FR-I005 field | State | Source, or the reason there is none |
| --- | --- | --- |
| 姓名 (name) | Delivered | `character:<id>` projection, `name` |
| 圖像 (image) | **Delivered by ART-151** | `CharacterSprite` over `MISTWOOD_CHARACTER_VISUALS` — the same binding the homepage and the live map resolve, so one character cannot draw as two figures (FR-N004) |
| 年齡與職業 (age, occupation) | Delivered | `character:<id>`, `age` / `occupation` |
| 公開背景 (public background) | Delivered | `character:<id>`, `publicProfile` |
| — | — | **Not published since ART-175:** `fear` and `behaviorRules` were on the projection allowlist, rendered by nothing, and on neither of FR-I005's lists. `behaviorRules` is model-steering text whose seeded value names the character's private goal. See `convex/publicRead/worldCharacterProjection.ts` |
| 目前狀態 (current state) | **Completed by ART-151** | health / emotion / finance came from `character:<id>`; the LOCATION did not. `currentLocationId` had been in the payload since ART-43 and was never rendered, so 「目前狀態」 said nothing about where the character was. The name is resolved against the published Live projection's `locations` |
| 公開目標 (public goal) | Delivered | `character:<id>`, `publicGoal` |
| 主要關係 (primary relationships) | **Delivered by ART-151** | The published FR-I007 relationship graph (ART-44), filtered to edges touching this character. **Scoped** — see §3 |
| 最近重大事件 (recent major events) | Delivered | `timeline:<worldId>`, filtered to entries naming this character |
| 所屬 Arc (arcs) | **Delivered by ART-151** | The published Live projection's `activeScenes` + `activeArcs`, through `characterCurrentArcs` — the same function the live map's character card calls (§2) |
| 觀眾已知秘密 (viewer-known secrets) | **Delivered by ART-169** | The `viewerKnowledge:<characterId>` read model, joining `worldSecrets` × Canon's public facts × the editorial publication lifecycle × the safety gate. See §4 |
| 角色不知道但觀眾知道的資訊 (dramatic irony) | **Delivered by ART-169** | The same read model: published public facts the character's knowledge ledger does not hold. See §4 |

## 2. 「所屬 Arc」 has one definition, not two

The live map's character card has answered 「這個角色現在在哪些 Arc 裡」 since ART-124, from the
same published `activeScenes`. ART-151 moved that rule out of `components/live/characterCardModel.ts`
— where it was a private helper — into `components/public/characterRoute.ts`, and both surfaces now
call `characterCurrentArcs`.

The direction is forced: `clientLive` may depend on `clientPublic` and the reverse would be a
cycle, so the shared rule has to live on the public side. The rule itself is unchanged — arcs of
scenes that are still `active` and that name the character as a participant, deduplicated by arc
id with the first scene winning.

An arc the character is in but that the Live projection does not list among `activeArcs` is
rendered under its **id** rather than dropped. The membership is the published fact; a missing
title is a gap in the arc list, not evidence that the membership is untrue.

## 3. 「主要關係」 is scoped, and the page says so

The page reads the FR-I007 graph for the CURRENT world day and keeps the edges touching this
character. That graph is deliberately scoped: to the current arc's neighbourhood, to a seven-day
change window, and to thirty nodes (`docs/scoped-relationship-graph.md`). So an empty list means
**"none within that scope"**, which is a different claim from "this character has no
relationships" — and the page publishes `以第 N 日的關係圖為準…` beneath the list rather than
leaving a viewer to make the stronger reading.

Two alternatives were considered and rejected:

- **Reading the per-pair `relationship:<pairKey>` models.** Nothing published mapped a character to
  the pairs they are in, so the page would have had to enumerate pairs it cannot enumerate. This
  page's refusal and the graph's were the two that left that model with no reader, and ART-182
  retired it; the alternative is now not merely rejected but gone.
- **Publishing a per-character relationship index.** That is a second home for a fact the graph
  already holds, and the two could disagree.

The graph carries **no character text** — no name, occupation or summary — on purpose: a past
day's graph is published once and never rebuilt, so any name baked into it would be frozen against
a later withhold (ART-132). The page therefore renders the other character's **id** as a link to
their own page, which IS rebuilt on every commit and carries the withhold for free.

## 4. 觀眾已知秘密 and 角色不知道但觀眾知道的資訊 (ART-169)

Both live in one read model, `viewerKnowledge:<characterId>`, built by
`convex/publicRead/viewerKnowledgeProjection.ts` and published by its `…Functions.ts`. It is a
kind of its own rather than two fields on `character:<id>` because it is the only public payload
in the deployment whose contents depend on the **editorial publication lifecycle** rather than on
Canon alone: an administrator publishing an Episode moves it while no event has been accepted.

### 4.1 A secret is not a stored fact — it is a join

A `worldSecrets` row is seed data (`{ secretId, content, initialKnowerCharacterIds }`) written once
by `importWorld`. No event creates one, no state change reveals one, and nothing anywhere carries a
"revealed" flag. ART-169 deliberately did **not** add one. A secret is viewer-known exactly when:

1. some accepted event created a **public** Canon fact whose value quotes the secret's content,
2. that event was cited by an Episode whose **current** publication record is `published`, and
3. that event's Scene is not currently withheld.

Each clause is an existing answer owned by an existing module. Clause 1 is the rule
`convex/quality/continuity.ts` already scans leaks with — since ART-169 both call `quotesSecret` in
`convex/shared/secretText.ts`, because two copies would have drifted and the drift would have been
invisible: the leak detector would have cleared a publication the character page had already made.

The revealing fact must still be **current**. A correction that closes it out leaves Canon no
longer asserting it, and republishing the secret from a closed fact would be this projection
asserting what its own source withdrew.

### 4.2 `ready` is not `published`, and today nothing is published

Of the seven publication statuses only `published` releases anything. That matters more than it
looks: **FR-K004 reserves `publish` for an administrator**, the post-commit pipeline's port type
excludes it (`convex/operations/postCommitLive.ts`), and no operator command in the deployment
invokes it. So every Episode in a running world sits at `ready`, and **both fields are empty in
Mistwood today**.

That is the correct behaviour for the rule FR-I005's 不得公開 list demands — treating `ready` as
released would make essentially every secret in the world public — but it does mean the sections
render their empty state until an administrator can publish. The missing operator entry point is a
reachability gap in FR-K004, not in FR-I005, and is tracked as its own task rather than papered
over here.

### 4.3 Dramatic irony, and the two visibility policies

角色不知道但觀眾知道的資訊 is the difference between the published public facts a viewer can see and
the fact ids this character's knowledge ledger holds. Nothing writes to the ledger, and the builder
has **no rumor input at all** — so "a private rumor belief leaked into the public payload" is not a
case that is checked and rejected, it is a case with no code path.

Two visibility policies meet here and they are deliberately different:

- A fact is **publishable as irony** at `public` **or** `canon` visibility, because
  `publicFactsFrom` and `characterSourceFrom` already publish both — calling them invisible would
  report irony that is not ironic.
- A fact **reveals a secret** only at `public`, which is `continuity`'s rule unchanged.

So a `canon`-visibility fact can be publishable in itself while being the only thing in the world
saying a secret out loud. Such a row is dropped and counted in `redactedRowCount` rather than
published or thrown away silently.

### 4.4 What the payload publishes about its own limits

- `omittedSecretCount` / `omittedIronyFactCount` — what the caps left out.
- `redactedRowCount` — rows dropped by §4.3.
- `consideredWorldDays` / `oldestConsideredWorldDay` — how far back the join could see. The wiring
  reads a bounded window of the newest `VIEWER_KNOWLEDGE_EPISODE_WINDOW` Episodes so its cost does
  not grow with the world's age, which means a secret revealed before that window is not reported.
  The page states the window beneath the list, so an empty section reads as "nothing within it"
  rather than "nothing".

### 4.5 The read-model sanitizer had to be given one exception

`sanitizeForPublic` strips any key matching `/secret/i` at any depth. It silently deleted
`viewerKnownSecrets` on the way into the row — the projection built the field, the store dropped
it, and the page rendered an empty section with nothing to explain why. The fix is a per-kind
allowlist (`KIND_ALLOWED_PRIVATE_KEYS`), not a rename: the filter matches key NAMES, so a payload
can always dodge it by not naming what it carries, and a carve-out that is written down and pinned
by a test is auditable where a quietly renamed field is not. What protects the viewer was never
that filter — it is the per-row publication join above.

### 4.6 When it is recomputed

Three triggers, because the payload has three independent sources of change:

- every accepted event, LAST in post-commit stage 19 (downstream of `rebuildLiveProjection` and
  `rebuildOnboardingSummary`, which that stage's own comments explain twice);
- every safety override, through `refreshPublicTextModels` — the list a new Canon-text-carrying
  read model is supposed to be added to, and which has now been forgotten twice before;
- a publication transition, which is the administrator's own path and must refresh this model in
  the same transaction.

ART-43's AC#1 is checked as of ART-169: all ten FR-I005 fields have a published source and the page
renders every one.
