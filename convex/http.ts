import { httpRouter } from 'convex/server';

/**
 * The deployment's HTTP surface: intentionally empty (ART-128 / FR-O009).
 *
 * An `httpAction` is the one Convex registration that answers an unauthenticated
 * request with no framework-level auth step of its own, so every route added here
 * has to carry its own authentication, and any that does not is anonymously
 * reachable by anyone holding the deployment URL. This file used to route
 * `POST /replicate_webhook` to the inherited a16z background-music generator, which
 * verified no signature: an anonymous POST made the server fetch an
 * attacker-influenced URL, store the unbounded response, and insert a row. The whole
 * module was dead code (zero callers) and was deleted rather than authenticated.
 *
 * Convex requires this file to exist and default-export a router. The public read
 * surface is served entirely by `query` functions, so there is nothing to route:
 * `architecture/module-boundaries.json` lists `httpAction` under
 * `publicFunctionSurface.forbiddenRegistrations`, and `npm run check:architecture`
 * fails the build if one reappears anywhere under `convex/`.
 */
const http = httpRouter();
export default http;
