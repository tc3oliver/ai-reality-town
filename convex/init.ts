import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { detectMismatchedLLMProvider } from './util/llm';

// ART-112: this mutation used to bootstrap the inherited a16z demo world (default engine,
// default map, LLM-driven demo agents) and is invoked by `predev` (`convex dev --run init
// --until-success`) on every dev-server start. The a16z engine is retired; there is no
// longer a demo world to create. Kept as a no-op (rather than removed) so `predev` keeps
// working without a package.json change, and so the one still-relevant check --
// misconfigured LLM provider detection, used by the real ART simulation pipeline -- keeps
// running on every dev-server start.
//
// ART-128 (FR-O009): `internalMutation`, not `mutation`. As a public mutation this was
// reachable by any anonymous client holding the deployment URL, and it SUCCEEDED --
// PRD 2.0 §18.1 sets successful public mutations to exactly zero. `predev` is unaffected:
// `convex dev --run` authenticates with the deployment admin key, which reaches internal
// functions (the same path the dashboard uses to run them).
const init = internalMutation({
  args: {
    numAgents: v.optional(v.number()),
  },
  handler: async () => {
    detectMismatchedLLMProvider();
  },
});
export default init;
