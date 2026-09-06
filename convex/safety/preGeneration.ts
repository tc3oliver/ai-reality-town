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

/**
 * The English rule set.
 *
 * Every pattern here uses `\b`, which is why it screens English and ONLY English: `\b` is a
 * transition between a `\w` character and a non-`\w` one, and CJK ideographs are not `\w`, so a
 * boundary never occurs *between* two Han characters. `/\b色情\b/` matches only when the phrase
 * happens to sit next to ASCII. See {@link ZH_RULES}.
 */
const EN_RULES: readonly SafetyRule[] = [
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

/**
 * The Traditional Chinese rule set (ART-156, audit finding H-4).
 *
 * ## Why this exists
 *
 * The gate had callers but screened nothing this system generates. Every prompt instructs the
 * model to 「Write every narrative text field in Traditional Chinese (zh-TW)」
 * (`simulation/providers/openAICompatible.ts` `proposeEvent`), the world is Mistwood, the
 * characters speak Chinese, and the entire rule set was sixteen English phrases behind `\b`.
 * The two paths the previous round recorded as "covered" were covered in name only: the gate ran,
 * matched nothing it could ever match, and returned `allow`.
 *
 * ## Why these patterns look different from the English ones
 *
 * No `\b`, anywhere. Written Chinese has no inter-word delimiter, so a word-boundary assertion
 * between two Han characters is not merely unhelpful — it can never be satisfied, which is the
 * whole defect. These are substring and bounded-proximity patterns instead.
 *
 * The proximity windows are `.{0,20}` rather than the English rules' `.{0,50}` because Chinese is
 * far denser per character: 20 characters is roughly a clause, which is the same span 50 Latin
 * characters covers. A window that is too wide turns a rule into a co-occurrence detector for two
 * unrelated sentences.
 *
 * ## What this is and is not
 *
 * A deterministic keyword gate, exactly as the English half is. It is not a classifier and does
 * not claim to be: it catches material stated plainly, which is what a PRE-generation gate on
 * OUR OWN assembled prompt is for — the text being screened is composed by this system from its
 * own world state, not typed by an adversary. Adversarial viewer text is a different surface with
 * a different control (`safety/viewerInput.ts`), and generated OUTPUT has its own post-generation
 * classifier. Recording that boundary matters, because "the gate is keyword-based" is a fair
 * criticism of a control that has to resist evasion and an irrelevant one for a control that
 * does not.
 */
const ZH_RULES: readonly SafetyRule[] = [
  {
    code: 'MINOR_SEXUAL_CONTENT',
    patterns: [
      /(?:未成年|未滿十八|末成年|兒童|幼童|小孩|孩童|青少年|國中生|國小生)[\s\S]{0,20}(?:性行為|性愛|性交|裸體|裸露|色情|猥褻|情色)/u,
      /(?:性行為|性愛|性交|裸體|裸露|色情|猥褻|情色)[\s\S]{0,20}(?:未成年|未滿十八|兒童|幼童|小孩|孩童|青少年|國中生|國小生)/u,
    ],
  },
  {
    code: 'EXPLICIT_SEXUAL_CONTENT',
    patterns: [/露骨(?:的)?性(?:描寫|描述|內容|愛場面)/u, /色情(?:內容|描寫|場景|情節)/u, /性愛(?:細節|過程)(?:描寫|描述)/u],
  },
  {
    code: 'HATE_OR_DEHUMANIZATION',
    patterns: [
      /非人化/u,
      /(?:劣等|低等)(?:民族|人種|種族)/u,
      /(?:這些人|那些人|他們)(?:是|就是|根本是)(?:畜生|牲畜|害蟲|寄生蟲|次等人)/u,
    ],
  },
  {
    code: 'EXTREME_VIOLENCE_DETAIL',
    patterns: [/(?:分屍|碎屍|斷肢)(?:的)?(?:細節|過程|描寫)/u, /(?:凌虐|虐殺|酷刑|血腥)(?:的)?(?:細節|過程描寫|畫面描寫)/u],
  },
  {
    code: 'SELF_HARM_ENCOURAGEMENT',
    patterns: [
      /(?:鼓勵|慫恿|教唆|勸)[\s\S]{0,10}(?:自殺|自殘|輕生)/u,
      /(?:自殺|自殘|輕生)(?:的)?(?:方法|步驟|教學|指南)/u,
    ],
  },
  {
    code: 'REAL_PERSON_IMPERSONATION',
    patterns: [/(?:冒充|假扮|假冒|扮演)(?:成)?(?:真實|現實中的|在世的)(?:人物|人士|名人|政治人物)/u],
  },
  {
    code: 'PERSONAL_DATA',
    patterns: [
      /(?:身分證字號|身份證字號|國民身分證號)/u,
      /(?:住(?:家|址)|居住)(?:地址|住址)/u,
      /(?:個人|私人)(?:的)?(?:電話號碼|手機號碼|電子郵件|病歷|醫療紀錄)/u,
      // Taiwan national identification number: one letter, 1 or 2, then eight digits. The
      // character class is lower-case because `normalizeForSafety` has already lower-cased the
      // text by the time any pattern runs — an `[A-Z]` here would match nothing, which is the
      // same class of silent no-op this task exists to remove.
      /(?<![a-z0-9])[a-z][12]\d{8}(?!\d)/u,
    ],
  },
  {
    code: 'REAL_CRIME_INSTRUCTION',
    patterns: [
      /(?:詳細|逐步|一步一步)(?:的)?(?:步驟|教學|作法|方法)[\s\S]{0,20}(?:犯罪|竊盜|偷竊|闖空門|破門|製毒|製作(?:炸彈|毒品)|洗錢|逃避追查)/u,
      /(?:教(?:我|你|讀者)|示範)[\s\S]{0,10}(?:如何)?[\s\S]{0,10}(?:製作炸彈|製造毒品|製毒|洗錢|闖空門|規避查緝)/u,
    ],
  },
] as const;

/**
 * Both rule sets, screened together against every field.
 *
 * A single list rather than a language guess: mixed-script text is the normal case here — a
 * Chinese narrative prompt wrapped in an English system instruction — so detecting "the language"
 * and picking one set would create exactly the gap this task closed.
 */
const RULES: readonly SafetyRule[] = [...EN_RULES, ...ZH_RULES];

/**
 * Normalize common formatting obfuscation while retaining word boundaries.
 *
 * `toLocaleLowerCase('en-US')` is a no-op for Han characters, so it is neither the cause of the
 * H-4 language gap nor a problem for the Chinese rules — worth stating, because the finding
 * mentioned it and fixing the wrong thing here would have left the real defect (the patterns)
 * in place. It is kept because the English rules depend on it.
 *
 * NFKC is load-bearing for the Chinese half in a way it is not for the English half: it folds
 * full-width Latin and full-width digits — `Ａ１２３４５６７８` — onto their ASCII forms, so a
 * full-width identification number is screened by the same pattern as a half-width one.
 */
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
