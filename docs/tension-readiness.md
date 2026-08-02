# Initial Tension Readiness

ART-7 implements the FR-A003 hard gate in `convex/canon/tensionReadiness.ts`. A world
cannot enter ART-8 warmup unless the latest persisted report passes every requirement.

## Required evidence

| Check | Minimum | Evidence source |
| --- | ---: | --- |
| Interest conflicts | 3 | Explicit profile records with at least two valid characters |
| Private secrets | 3 | Character seed secret records |
| Resource/debt dependencies | 2 | Explicit dependent/provider records |
| Misconceptions | 2 | Seed knowledge whose `truthStatus` is `false` |
| Emotional tensions | 2 | Explicit profile records with at least two valid characters |
| Town-wide shared misunderstanding | 1 | Existing history referenced by a belief held by every primary character |
| Launchable main arc | 1 | Candidate with premise, current question, trigger, and valid core characters |

The versioned profile validates every character and history reference before persistence.
Counts below a threshold are not schema errors: they produce a stored report with the
exact `required`, `actual`, `missingBy`, evidence ids, and an administrator-readable
message for each deficit.

## Server boundary

- `evaluateWorldTensionReadiness` is an internal mutation that derives secret,
  misconception, character, and history evidence from validated seeds and atomically
  stores the profile and report.
- `getTensionReadinessReport` is an internal query for the future authenticated
  operations interface; no secret content is copied into the report.
- `requireWarmupReadiness` is the mandatory internal guard for ART-8. It throws the stable
  `WORLD_NOT_READY_FOR_WARMUP` code when no passing report exists.

The profile declares launchable arc candidates only. Story Arc creation/lifecycle remains
owned by ART-29/64/65; warmup orchestration remains ART-8.

## Verification

```bash
npm test -- --runInBand --runTestsByPath convex/canon/tensionReadiness.test.ts
npm run check
```
