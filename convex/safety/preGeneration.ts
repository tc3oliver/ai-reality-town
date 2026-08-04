/** Deterministic FR-L001 safety gate applied before any generative provider call. */

export const PRE_GENERATION_POLICY_VERSION = 1 as const;

export const PROHIBITED_GENERATION_CATEGORIES = [
  'MINOR_SEXUAL_CONTENT',
  'EXPLICIT_SEXUAL_CONTENT',
  'HATE_OR_DEHUMANIZATION',
  'EXTREME_VIOLENCE_DETAIL',
  'SELF_HARM_ENCOURAGEMENT',
  'REAL_PERSON_IMPERSONATION',
  'PERSONAL_DATA',
  'REAL_CRIME_INSTRUCTION',
] as const;

export type ProhibitedGenerationCategory = typeof PROHIBITED_GENERATION_CATEGORIES[number];
export type SafetyInputKind = 'world' | 'prompt' | 'context';

export type PreGenerationInput = {
  worldText: string;
  promptText: string;
  contextText?: readonly string[];
};

export type PreGenerationRejection = {
  policyVersion: typeof PRE_GENERATION_POLICY_VERSION;
  decision: 'block';
  code: ProhibitedGenerationCategory;
  inputKind: SafetyInputKind;
  /** Stable policy reason; deliberately excludes the sensitive source text. */
  reason: string;
};

export type PreGenerationDecision =
  | { policyVersion: typeof PRE_GENERATION_POLICY_VERSION; decision: 'allow' }
  | PreGenerationRejection;

export class PreGenerationSafetyError extends Error {
  readonly rejection: PreGenerationRejection;

  constructor(rejection: PreGenerationRejection) {
    super(`[${rejection.code}] ${rejection.reason}`);
    this.name = 'PreGenerationSafetyError';
    this.rejection = rejection;
  }
}

const REASONS: Record<ProhibitedGenerationCategory, string> = {
  MINOR_SEXUAL_CONTENT: 'Sexual content involving a minor is prohibited.',
  EXPLICIT_SEXUAL_CONTENT: 'Explicit sexual content is prohibited.',
  HATE_OR_DEHUMANIZATION: 'Hate or dehumanizing content is prohibited.',
  EXTREME_VIOLENCE_DETAIL: 'Extreme or graphic violence detail is prohibited.',
  SELF_HARM_ENCOURAGEMENT: 'Encouragement or instruction for self-harm is prohibited.',
  REAL_PERSON_IMPERSONATION: 'Impersonation of a real person is prohibited.',
  PERSONAL_DATA: 'Personal or identifying data is prohibited.',
  REAL_CRIME_INSTRUCTION: 'Instruction facilitating real-world crime is prohibited.',
};

type SafetyRule = { code: ProhibitedGenerationCategory; patterns: readonly RegExp[] };

const RULES: readonly SafetyRule[] = [
  {
    code: 'MINOR_SEXUAL_CONTENT',
    patterns: [
      /\b(?:minor|underage|child|teenager)\b.{0,50}\b(?:sexual|nude|pornographic)\b/u,
      /\b(?:sexual|nude|pornographic)\b.{0,50}\b(?:minor|underage|child|teenager)\b/u,
    ],
  },
  { code: 'EXPLICIT_SEXUAL_CONTENT', patterns: [/\bexplicit sexual content\b/u, /\bpornographic (?:scene|detail|content)\b/u] },
  { code: 'HATE_OR_DEHUMANIZATION', patterns: [/\bdehumani[sz](?:e|ing|ation)\b/u, /\b(?:people|group) (?:are|as) (?:vermin|animals|subhuman)\b/u] },
  { code: 'EXTREME_VIOLENCE_DETAIL', patterns: [/\bgraphic (?:dismemberment|gore|torture)\b/u, /\bextreme violence detail\b/u] },
  { code: 'SELF_HARM_ENCOURAGEMENT', patterns: [/\bencourage (?:suicide|self harm)\b/u, /\b(?:instructions?|steps?) (?:for|to) (?:suicide|self harm)\b/u] },
  { code: 'REAL_PERSON_IMPERSONATION', patterns: [/\bimpersonate (?:a )?real person\b/u, /\bpretend to be (?:a )?(?:real|living) person\b/u] },
  {
    code: 'PERSONAL_DATA',
    patterns: [
      /\b(?:private|personal) (?:address|phone number|email|medical record)\b/u,
      /\b(?:ssn|social security number)\b/u,
      /\b\d{3}-\d{2}-\d{4}\b/u,
    ],
  },
  { code: 'REAL_CRIME_INSTRUCTION', patterns: [/\b(?:step by step|detailed) instructions? (?:for|to) (?:commit|plan|evade|steal|break into|manufacture)\b/u, /\bteach (?:me|the reader) how to commit (?:a )?real crime\b/u] },
] as const;

/** Normalize common formatting obfuscation while retaining word boundaries. */
function normalizeForSafety(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[_.|/\\-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function reject(code: ProhibitedGenerationCategory, inputKind: SafetyInputKind): PreGenerationRejection {
  return {
    policyVersion: PRE_GENERATION_POLICY_VERSION,
    decision: 'block',
    code,
    inputKind,
    reason: REASONS[code],
  };
}

export function evaluatePreGenerationSafety(input: PreGenerationInput): PreGenerationDecision {
  const fields: readonly { kind: SafetyInputKind; text: string }[] = [
    { kind: 'world', text: input.worldText },
    { kind: 'prompt', text: input.promptText },
    ...(input.contextText ?? []).map((text) => ({ kind: 'context' as const, text })),
  ];
  for (const field of fields) {
    const normalized = normalizeForSafety(field.text);
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) return reject(rule.code, field.kind);
    }
  }
  return { policyVersion: PRE_GENERATION_POLICY_VERSION, decision: 'allow' };
}

/** Non-user-editable constraint sent with every allowed generation request. */
export const PRE_GENERATION_PROVIDER_CONSTRAINT = [
  'Generate only fictional content.',
  'Do not generate sexual content involving minors or explicit sexual content.',
  'Do not generate hate, dehumanization, extreme violence detail, or self-harm encouragement.',
  'Do not impersonate real people, expose personal data, or instruct real-world crime.',
  'If a request conflicts with these rules, return a refusal without narrative detail.',
].join(' ');

export type SafeGenerationRequest = PreGenerationInput & {
  policyVersion: typeof PRE_GENERATION_POLICY_VERSION;
  safetyInstruction: typeof PRE_GENERATION_PROVIDER_CONSTRAINT;
};

/** Gate a provider callback. On rejection the callback is provably never invoked. */
export async function callWithPreGenerationSafety<T>(
  input: PreGenerationInput,
  callProvider: (request: SafeGenerationRequest) => Promise<T>,
): Promise<T> {
  const decision = evaluatePreGenerationSafety(input);
  if (decision.decision === 'block') throw new PreGenerationSafetyError(decision);
  return callProvider({
    ...input,
    policyVersion: PRE_GENERATION_POLICY_VERSION,
    safetyInstruction: PRE_GENERATION_PROVIDER_CONSTRAINT,
  });
}

/** A chat-style message the pre-generation gate can screen. */
export type SafetyChatMessage = { role: string; content: string | null };

/**
 * Map a provider-bound chat message list to the pre-generation screening input.
 *
 * System messages are world context, user messages are the prompt, and every other turn
 * (prior assistant output, tool results) is additional context. Every field is screened
 * by the same rule set, so the split only labels a rejection's `inputKind`; it does not
 * narrow what is checked.
 */
export function chatMessagesToSafetyInput(messages: readonly SafetyChatMessage[]): PreGenerationInput {
  const worldText = messages.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n');
  const promptText = messages.filter((message) => message.role === 'user').map((message) => message.content ?? '').join('\n');
  const contextText = messages
    .filter((message) => message.role !== 'system' && message.role !== 'user')
    .map((message) => message.content ?? '');
  return { worldText, promptText, contextText: contextText.length ? contextText : undefined };
}

/**
 * Screen pre-generation input and throw {@link PreGenerationSafetyError} if any field is
 * blocked. The provider call that follows is provably never made for blocked input.
 *
 * This is the production-callable entry point the provider call paths use (audit H-4):
 * `chatCompletion` and the OpenAI-compatible scene adapter both call it before any network
 * request, then prepend {@link PRE_GENERATION_PROVIDER_CONSTRAINT} to the messages.
 */
export function assertPreGenerationSafe(input: PreGenerationInput): void {
  const decision = evaluatePreGenerationSafety(input);
  if (decision.decision === 'block') throw new PreGenerationSafetyError(decision);
}
