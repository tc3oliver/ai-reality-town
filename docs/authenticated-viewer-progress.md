# Authenticated viewer follows and progress (FR-J003 / ART-71)

`convex/viewer/authenticatedProgress.ts` (pure) and the three handlers in
`convex/viewer/viewerProgressFunctions.ts`. Extends ART-39's anonymous progress rather than
replacing it — see `docs/device-return-recap.md` for the device half.

## 1. What ART-39 left, deliberately

FR-H004 AC#7 reads 「匿名裝置進度與已登入進度不得跨身分讀取或修改;合併或遷移必須明確、經授權且
無損」. ART-39 delivered the first clause and refused to simulate the second, for a reason it wrote
down: 「已登入進度」 was a **provably empty set**. A merge written then would have had no second
operand, its authorization predicate no credential to consult, and its losslessness could only have
been demonstrated against a fabricated identity — evidence about the test, not about the system.

Two things changed. ART-104 configured the identity provider (`convex/auth.config.ts` declares
Clerk when `CLERK_JWT_ISSUER_DOMAIN` is set), and `VIEWER_KEY_NAMESPACES` has carried an unreachable
`auth` namespace since ART-39 **for exactly this task**.

## 2. The key, and why it is digested

`authViewerKey(subject)` stores `auth:<digest>`, never the subject. A Clerk `sub` is a stable
account identifier — *more* identifying than a browser token, not less — so it gets the treatment
`schema.ts` already gives the device digest: a leaked row must not be correlatable back to a value
that still identifies someone.

The one real difference from the device path is that the subject is **trusted**, and that is
Convex's doing rather than ours: `ctx.auth.getUserIdentity()` returns a value only after Convex has
verified the JWT against the configured issuer. So where `viewerProgress.ts` has to say plainly that
「deviceKey 是一項主張,不是身分」, this module does not — with the corresponding obligation that
**no handler may accept a subject as an argument**. A `subject` parameter would turn a verified
identity back into a claim, and `publicReadOnlyGuarantee.test.ts` pins the argument lists
exhaustively so one cannot appear.

## 3. One new mutation, not three

FR-J003 needs an authenticated viewer to read, write and merge. Only the merge became a new
surface:

- `getViewerProgress` and `recordViewerProgress` now **prefer a verified identity over the presented
  token**. Folding rather than adding is both fewer endpoints and safer: with two, a signed-in
  client could reach the anonymous row by calling the wrong one — a bug that looks like nothing and
  quietly reports the wrong history. With one, the choice is not the caller's to get wrong.
- `mergeDeviceProgressIntoAccount` is genuinely new, because AC#7 requires the merge to be
  **explicit** rather than a side effect of signing in.

The device-key **shape** check now applies only to callers who presented a token. An authenticated
caller supplies none, so `evaluateViewerProgressSubmission` takes `identityVerified` rather than
being handed a synthetic token that satisfies the pattern — a fabricated value would make the check
pass while describing nothing. Everything else still applies, the attempt budget included: a
verified identity is not a licence to enumerate the world's character and arc ids.

## 4. The write gate moved 2 → 3

`viewerWriteBoundary.maxViewerMutations` is 3. Following the precedent ART-39 set
(`docs/device-return-recap.md` §3), this is a deliberate widening in **four** places that must all
agree or `check` fails:

| Place | What it holds |
| --- | --- |
| `publicFunctionSurface.allowed` | the function, with `gate: viewer` |
| `viewerWriteBoundary.allowed` | the same path and name |
| `viewerWriteBoundary.maxViewerMutations` | the number |
| `check-boundaries.test.mjs` + `publicReadOnlyGuarantee.test.ts` | the **exhaustive list**, so a fourth write cannot arrive by replacing one of these |

What still holds after the widening:

- `anonymous` still means read-only; `validatePolicy` refuses any anonymous mutation.
- Viewer writes still live only in `convex/viewer`, still name the safety symbols
  `requiredSymbols` demands (now including `planProgressMerge`), and still name no Canon writer.
- **No new client root.** The merge is reached from `src/components/recap`, already a declared write
  root. The number of client surfaces a viewer can write from did not move, which is why
  `readOnlyWorldSurface.test.ts` asserts the two bounds separately rather than as one number.

## 5. The merge: 明確, 經授權, 無損

Three words, three properties, each enforced by a different part of the code.

**明確.** Its own operation. Nothing merges as a side effect of signing in — a viewer who signs in
on a shared machine has not asked for that machine's history, and a test asserts the account row
carries only what the account wrote.

**經授權.** The caller must present **both** a verified identity and the device token. Holding the
token is the only evidence the anonymous history is theirs to claim; the identity is the only thing
that says which account claims it. Neither alone is enough — an unauthenticated caller with a
perfect token is refused `VIEWER_NOT_AUTHENTICATED` and writes nothing.

**無損.** A union, with a stated rule per field:

| Field | Rule |
| --- | --- |
| follows | union, account's own first under the cap |
| position | the **further** of the two — progress is a high-water mark, and an unparseable stored id is treated as no information rather than as day 0, so it cannot drag a viewer backwards |
| spoiler mode | the account's own is kept; a disagreement is **reported** so a client can offer the choice rather than silently deciding it |

Anything the caps could not keep is returned in `droppedCharacterIds` / `droppedArcIds`, and
`mergeWasLossless` is a computed property rather than an assertion. This is the half a careless test
gets wrong: asserting the merged record is well-formed passes just as happily when four follows were
discarded.

**The device row is left exactly as it was.** Deleting it would make a merge that went wrong
unrecoverable; the two namespaces exist so both operands can coexist. That also makes the merge
idempotent — running it twice adds nothing the second time.

## 6. The evidence boundary, stated

No live Clerk credential exists in this repository, and none was created: `CLERK_JWT_ISSUER_DOMAIN`
and `VITE_CLERK_PUBLISHABLE_KEY` are deployment secrets. So what is **not** proven here is Convex's
JWT verification — which is Convex's code, not this repository's.

What *is* proven is everything downstream of it: given an identity, which row each call reaches,
that two accounts cannot see each other, that neither can see the device row, and that the merge
holds all three of AC#7's properties. The handler suite drives the real `_handler` against an
in-memory `ctx` whose `auth` returns the identity under test, which is the same seam Convex fills
in production.

Activating the live path needs the runbook in `docs/agent/OPERATOR-AUTH.md` steps 3–4 and nothing
in this repository.
