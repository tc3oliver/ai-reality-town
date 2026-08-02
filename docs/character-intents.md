# Knowledge-scoped character intents

ART-20 implements PRD FR-C003.

Each intent context belongs to one character, Director Run, world day, and time slot. It
contains only a source-proven persona summary, current goal/emotion/location, the bounded
authorized memory retrieval result, that character's knowledge and assets, reachable
locations, and active Arc context. Persistence replays Canon and checks seed records to
prove that knowledge, memories, assets, and current location belong to the target
character; a caller cannot inject another character's private cognition.

Provider output is parsed into a closed structured Intent contract. It may state an
attempt, rationale, target, desired location, urgency, and the exact context IDs used. It
cannot contain state changes, outcomes, dialogue, or unknown fields and never writes
Canon. Unauthorized cognition references are rejected. An otherwise valid attempt at an
unreachable location is deterministically downgraded to a zero-urgency `wait` intent with
a stable reason.

Validated contexts and intents are stored idempotently by `intentRunId` behind internal
Convex functions and remain traceable to their Director Run.

Focused verification:

```bash
npm test -- --runTestsByPath convex/simulation/characterIntent.test.ts
```
