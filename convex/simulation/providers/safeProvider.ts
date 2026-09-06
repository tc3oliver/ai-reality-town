/**
 * Pre-generation safety, enforced at the PORT (ART-156 AC#3, audit finding H-4).
 *
 * ## Why a wrapper and not a base class or an interface rule
 *
 * {@link LanguageModelProvider} is a TypeScript interface. It vanishes at runtime and can compel
 * an adapter to have a method, never to do anything before that method's first statement. A base
 * class would be inherited only by adapters that chose to. A decorator applied at CONSTRUCTION is
 * the one arrangement where "the provider you were handed is gated" is a property of the value
 * rather than a promise made by whoever wrote the class.
 *
 * That is what the gate needed: `openAICompatible.ts` already screens at its own transport, but
 * that protects only the adapter that has that transport. A second adapter — a different vendor,
 * a local model, a proxy — would have its own, and would inherit nothing. Enforcement has to live
 * where every adapter is obtained, so {@link createLanguageModelProvider} is the only sanctioned
 * way to obtain one and `safeProviderBoundary.test.ts` fails the build if a second construction
 * site appears.
 *
 * ## The adapter's own gate is NOT removed, and that is deliberate
 *
 * Two gates, at different altitudes, answering different questions:
 *
 *  - HERE, at the port: the caller's semantic input — messages, embedding text — screened with a
 *    meaningful `inputKind`, before an adapter sees it at all.
 *  - In `openAICompatible.request()`: the request body AS ASSEMBLED, which is where
 *    `jsonSchema.description`, tool descriptions and `user` live. Those fields do not exist at
 *    this altitude; they are constructed by the adapter after this wrapper has returned.
 *
 * Neither subsumes the other, and the overlap is cheap — the policy is a handful of regexes over
 * text already in memory, with no I/O.
 *
 * ## What this does not do
 *
 * It does not screen provider OUTPUT. That is the post-generation classifier's job
 * (`safety/postGeneration*`), and conflating the two would leave both half-specified.
 */

import { assertPreGenerationSafe, chatMessagesToSafetyInput } from '../../safety/preGeneration';
import type {
  EmbeddingResult,
  LanguageModelProvider,
  StructuredChatRequest,
  StructuredChatResult,
} from '../provider';
import { OpenAICompatibleProvider } from './openAICompatible';
import type { OpenAICompatibleConfig } from './config';

/**
 * Wrap any {@link LanguageModelProvider} so both of its egress methods are screened first.
 *
 * Exported for tests and for a future second adapter. Production code should call
 * {@link createLanguageModelProvider} instead, so that "which adapter" and "is it gated" are
 * decided in the same place rather than by two callers who must agree.
 */
export function withPreGenerationSafety<T extends LanguageModelProvider>(provider: T): LanguageModelProvider {
  return {
    // `async`, not a plain function that throws: the port's contract is a Promise, and the
    // adapter it wraps rejects rather than throwing synchronously. A wrapper that threw before
    // returning a promise would be a DIFFERENT contract from the thing it stands in for, and
    // every caller's `.catch` would stop working the moment the gate fired — the one moment it
    // must not.
    async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
      assertPreGenerationSafe(chatMessagesToSafetyInput(request.messages));
      return provider.structuredChat(request);
    },
    /**
     * Embedding text is screened as `context`, not `prompt`: it is retrieved material — character
     * memories, private knowledge — not an instruction. The distinction only sets a rejection's
     * `inputKind`, which is the field whoever reads the rejection uses to know WHERE it came from.
     */
    async embed(text: string): Promise<EmbeddingResult> {
      assertPreGenerationSafe({ worldText: '', promptText: '', contextText: [text] });
      return provider.embed(text);
    },
  };
}

/**
 * THE way to obtain a language-model provider. Returns a gated one, always.
 *
 * The return type is deliberately the PORT and not `OpenAICompatibleProvider`: a caller that
 * could see the concrete class could also reach past the wrapper by touching a method the port
 * does not declare. Narrowing here is what makes the gate structural rather than advisory.
 */
export function createLanguageModelProvider(config: OpenAICompatibleConfig): LanguageModelProvider {
  return withPreGenerationSafety(new OpenAICompatibleProvider(config));
}
