# World scheduler and run state

ART-18 implements PRD 1.0 `FR-C001` and Sections 10.1–10.2 as a deterministic
slot-reservation layer. It schedules work; it does not generate content or write Canon.

## Public clock

One real 24-hour day maps to one world day with five ordered boundaries:

| Slot | Start from calendar-day anchor |
| --- | ---: |
| Morning | 00:00 |
| Noon | 06:00 |
| Afternoon | 11:00 |
| Evening | 15:00 |
| Night | 19:00 |

The Convex minute cron calls the internal all-world tick. Each due coordinate has a
stable key `world:day:N:slot:name`; a transaction checks this key before insertion, so
repeated or concurrent ticks cannot create duplicate slot work. Pausing suppresses clock
ticks. Resuming shifts the real-time anchor by the paused duration, so world time does
not catch up while paused.

A second, hourly cron (`captureAllPublicRuntimeSnapshots`, FR-N007) sweeps every public
world — paused ones included — and records a public runtime snapshot. It reads
`worldSchedules.status` and never writes it: the schedule remains the sole authority for
whether a world is running, and that status is what the public freshness verdict reports as
`paused`. See `docs/public-runtime-snapshot.md`.

## Development controls

Internal operations support exactly one next slot, five consecutive slots (one world
day), or 1–90 accelerated world days. Manual controls remain available while paused.
Development, test, and warmup schedules default `publishEnabled` to false; publication
requires an explicit configuration flag. Public mode defaults it to true.

Every slot derives a stable seed and Canon idempotency key from world/day/slot. A failed
slot is retried by transitioning the same row back to queued; its key never changes.
Thus a timeout after Canon commit resolves to the already accepted event instead of
submitting a duplicate. The downstream world-day orchestration task consumes these
queued rows and must preserve the supplied key and publication flag.

## Operations surface

All configure, pause, resume, tick, manual advance, lifecycle, retry, and inspection
functions are internal Convex operations. `worldSchedules` stores the cursor and clock;
`scheduledSlots` stores status, attempt count, seed, trigger, error, publication flag,
and committed event reference. Public clients cannot invoke scheduler controls.

Clock-controlled coverage in `scheduler.test.ts` proves slot uniqueness, five-slot
ordering, 24-hour rollover, pause/resume, manual and accelerated controls, deterministic
fixed-seed output, unpublished defaults, inspectability, invalid transitions, and
post-commit retry deduplication.

```bash
npm test -- --runInBand convex/simulation/scheduler.test.ts
npm run check
```
