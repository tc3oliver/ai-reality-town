# Deterministic Fixtures

The versioned Mistwood domain fixture lives in `convex/canon/mistwoodFixture.ts` and is
created with `createMistwoodFixture()`. It has a fixed seed (`20260803`), fixed clock
values, accepted events, a snapshot, and expected full projection. Callers receive fresh
copies so mutation in one test cannot contaminate another.

The fixture test proves every event passes structural and Canon validation in sequence,
full replay equals incremental reduction, and snapshot replay reaches the same projection.
It is intentionally small: it validates reusable domain/workflow mechanics, not the final
12–20-character public Mistwood content, which is owned by ART-77.

`FakeSimulationProvider` consumes the explicit integer `SimulationInput.seed`. A fixed
seed and scenario produce byte-equivalent structured proposals. Its focused tests remove
the LLM credential and replace clock, randomness, and network functions with throwing
stubs, proving the fake path runs offline without those facilities.

Run the focused evidence with:

```bash
npm test -- --runInBand --runTestsByPath \
  convex/simulation/fakeProvider.test.ts \
  convex/simulation/workflow.test.ts \
  convex/canon/mistwoodFixture.test.ts
```

Seven-, thirty-, and ninety-world-day harnesses are deliberately not implemented here:
ART-60 owns deterministic 7/30/90 execution, and ART-73 owns the extended 90-day
resilience and quality gate.
