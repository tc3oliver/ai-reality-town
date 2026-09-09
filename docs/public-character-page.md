# Public character page (FR-I005)

`src/components/public/CharacterPage.tsx`, over the pure model in `characterRoute.ts`.

FR-I005 lists ten public fields. ART-43 delivered the page and closed with **AC#1 unchecked**,
because several of those fields had no published source at the time. ART-151 re-checked each one
against what is actually published today and delivered what had since become deliverable. This is
the record of that assessment — field by field, with the source named — so the next person does not
have to re-derive it.

## 1. The ten fields, as of ART-151

| FR-I005 field | State | Source, or the reason there is none |
| --- | --- | --- |
| 姓名 (name) | Delivered | `character:<id>` projection, `name` |
| 圖像 (image) | **Delivered by ART-151** | `CharacterSprite` over `MISTWOOD_CHARACTER_VISUALS` — the same binding the homepage and the live map resolve, so one character cannot draw as two figures (FR-N004) |
| 年齡與職業 (age, occupation) | Delivered | `character:<id>`, `age` / `occupation` |
| 公開背景 (public background) | Delivered | `character:<id>`, `publicProfile` |
| 目前狀態 (current state) | **Completed by ART-151** | health / emotion / finance came from `character:<id>`; the LOCATION did not. `currentLocationId` had been in the payload since ART-43 and was never rendered, so 「目前狀態」 said nothing about where the character was. The name is resolved against the published Live projection's `locations` |
| 公開目標 (public goal) | Delivered | `character:<id>`, `publicGoal` |
| 主要關係 (primary relationships) | **Delivered by ART-151** | The published FR-I007 relationship graph (ART-44), filtered to edges touching this character. **Scoped** — see §3 |
| 最近重大事件 (recent major events) | Delivered | `timeline:<worldId>`, filtered to entries naming this character |
| 所屬 Arc (arcs) | **Delivered by ART-151** | The published Live projection's `activeScenes` + `activeArcs`, through `characterCurrentArcs` — the same function the live map's character card calls (§2) |
| 觀眾已知秘密 (viewer-known secrets) | **Still unavailable** | No read model publishes the revealed/unrevealed status of a Canon secret. See §4 |
| 角色不知道但觀眾知道的資訊 (dramatic irony) | **Still unavailable** | Nothing publishes a per-character knowledge GAP against public knowledge. See §4 |

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

- **Reading the per-pair `relationship:<pairKey>` models.** Nothing published maps a character to
  the pairs they are in, so the page would have to enumerate pairs it cannot enumerate.
- **Publishing a per-character relationship index.** That is a second home for a fact the graph
  already holds, and the two could disagree.

The graph carries **no character text** — no name, occupation or summary — on purpose: a past
day's graph is published once and never rebuilt, so any name baked into it would be frozen against
a later withhold (ART-132). The page therefore renders the other character's **id** as a link to
their own page, which IS rebuilt on every commit and carries the withhold for free.

## 4. What is still missing, and what would supply it

Two FR-I005 fields have no source anywhere in the deployment, and no partial one:

- **觀眾已知秘密.** A secret becomes viewer-known when the event that reveals it is published. The
  knowledge ledger knows which secrets exist and `publicRead` knows which events are published, but
  nothing joins them, and no read model carries a secret's revealed status. Publishing this needs a
  projection that can prove the revealing event is published before it names the secret — the
  failure mode is publishing an *unrevealed* secret, which FR-I005's 不得公開 list forbids
  explicitly.
- **角色不知道但觀眾知道的資訊.** Dramatic irony is a difference between two sets: what the viewer
  can see published, and what a given character's knowledge ledger holds. Both halves exist;
  nothing computes the difference, and the difference has never been published in any form.

These are recorded as an explicit scoped follow-up rather than as a silent gap, and ART-43's AC#1
stays unchecked until that task closes. Marking AC#1 done with eight of ten fields would make the
criterion say something untrue about the other two.
