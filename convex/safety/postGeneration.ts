import { PROHIBITED_GENERATION_CATEGORIES, type ProhibitedGenerationCategory } from './preGeneration';

export const POST_GENERATION_POLICY_VERSION = 1 as const;
export const POST_GENERATION_LABELS = ['allow', 'allow_with_warning', 'withhold', 'human_review_required'] as const;
export type PostGenerationLabel = (typeof POST_GENERATION_LABELS)[number];
export type PostGenerationContentKind = 'scene' | 'public_artifact';

export type PostGenerationCandidate = {
  classificationId: string;
  worldId: string;
  sourceId: string;
  kind: PostGenerationContentKind;
  text: string;
  coreFactIds: string[];
};

export type PostGenerationClassification = {
  policyVersion: typeof POST_GENERATION_POLICY_VERSION;
  classificationId: string;
  worldId: string;
  sourceId: string;
  kind: PostGenerationContentKind;
  label: PostGenerationLabel;
  reasonCodes: string[];
  warningCodes: string[];
  classifiedTextHash: string;
};

export class PostGenerationSafetyError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'PostGenerationSafetyError';
  }
}

const WITHHOLD = new Set<ProhibitedGenerationCategory>([
  'MINOR_SEXUAL_CONTENT', 'EXPLICIT_SEXUAL_CONTENT', 'HATE_OR_DEHUMANIZATION',
  'EXTREME_VIOLENCE_DETAIL', 'SELF_HARM_ENCOURAGEMENT', 'REAL_CRIME_INSTRUCTION',
]);
const REVIEW = new Set<ProhibitedGenerationCategory>(['REAL_PERSON_IMPERSONATION', 'PERSONAL_DATA']);

const CATEGORY_PATTERNS: Readonly<Record<ProhibitedGenerationCategory, readonly RegExp[]>> = {
  MINOR_SEXUAL_CONTENT: [/(?:minor|underage|child).{0,40}(?:sexual|nude|pornographic)/u],
  EXPLICIT_SEXUAL_CONTENT: [/explicit sexual content/u, /pornographic (?:scene|detail|content)/u],
  HATE_OR_DEHUMANIZATION: [/dehumani[sz](?:e|ing|ation)/u, /(?:people|group) (?:are|as) (?:vermin|subhuman)/u],
  EXTREME_VIOLENCE_DETAIL: [/graphic (?:dismemberment|gore|torture)/u, /extreme violence detail/u],
  SELF_HARM_ENCOURAGEMENT: [/encourage (?:suicide|self harm)/u, /instructions? (?:for|to) (?:suicide|self harm)/u],
  REAL_PERSON_IMPERSONATION: [/impersonate (?:a )?real person/u, /pretend to be (?:a )?(?:real|living) person/u],
  PERSONAL_DATA: [/(?:private|personal) (?:address|phone number|email|medical record)/u, /\d{3}-\d{2}-\d{4}/u],
  REAL_CRIME_INSTRUCTION: [/(?:step by step|detailed) instructions? (?:for|to) (?:commit|plan|evade|steal|break into|manufacture)/u],
};

const WARNING_PATTERNS: readonly { code: string; pattern: RegExp }[] = [
  { code: 'NON_GRAPHIC_VIOLENCE', pattern: /(?:injury|injured|blood|fight|assault)/u },
  { code: 'SELF_HARM_REFERENCE', pattern: /(?:suicide|self harm)/u },
];

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[_.|/\\-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Stable non-cryptographic content fingerprint; raw unsafe text is never persisted. */
function textHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function validateCandidate(candidate: PostGenerationCandidate): void {
  for (const [field, value] of [['classificationId', candidate.classificationId], ['worldId', candidate.worldId], ['sourceId', candidate.sourceId]] as const) {
    if (value.trim().length === 0) throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', `${field} is required`);
  }
  if (candidate.kind !== 'scene' && candidate.kind !== 'public_artifact') {
    throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', 'unsupported content kind');
  }
  if (new Set(candidate.coreFactIds).size !== candidate.coreFactIds.length || candidate.coreFactIds.some((id) => id.trim().length === 0)) {
    throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', 'core Fact IDs must be unique and non-empty');
  }
}

export function classifyPostGeneration(candidate: PostGenerationCandidate): PostGenerationClassification {
  validateCandidate(candidate);
  const content = normalized(candidate.text);
  const detected = PROHIBITED_GENERATION_CATEGORIES.filter((category) =>
    CATEGORY_PATTERNS[category].some((pattern) => pattern.test(content)));
  const warningCodes = WARNING_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(({ code }) => code);
  const label: PostGenerationLabel = detected.some((category) => WITHHOLD.has(category))
    ? 'withhold'
    : detected.some((category) => REVIEW.has(category))
      ? 'human_review_required'
      : warningCodes.length > 0 ? 'allow_with_warning' : 'allow';
  return {
    policyVersion: 1, classificationId: candidate.classificationId, worldId: candidate.worldId,
    sourceId: candidate.sourceId, kind: candidate.kind, label, reasonCodes: detected,
    warningCodes, classifiedTextHash: textHash(candidate.text),
  };
}

export function assertSanitizedSummaryFidelity(original: PostGenerationCandidate, sanitized: PostGenerationCandidate): void {
  validateCandidate(original);
  validateCandidate(sanitized);
  if (original.worldId !== sanitized.worldId || original.sourceId !== sanitized.sourceId
      || original.kind !== sanitized.kind || original.coreFactIds.length !== sanitized.coreFactIds.length
      || original.coreFactIds.some((id, index) => id !== sanitized.coreFactIds[index])) {
    throw new PostGenerationSafetyError('SAFETY_CORE_FACT_MISMATCH', 'sanitized summary must retain identical ordered core Fact IDs');
  }
}

export type PublicationGateResult = {
  publishable: boolean;
  classification: PostGenerationClassification;
};

/** Fail closed. Classification errors become review records and never call publication. */
export async function gatePostGenerationPublication(
  candidate: PostGenerationCandidate,
  publish: (candidate: PostGenerationCandidate) => Promise<void>,
  classifier: (candidate: PostGenerationCandidate) => PostGenerationClassification = classifyPostGeneration,
): Promise<PublicationGateResult> {
  let classification: PostGenerationClassification;
  try {
    classification = classifier(candidate);
  } catch {
    classification = {
      policyVersion: 1, classificationId: candidate.classificationId, worldId: candidate.worldId,
      sourceId: candidate.sourceId, kind: candidate.kind, label: 'human_review_required',
      reasonCodes: ['CLASSIFIER_FAILURE'], warningCodes: [], classifiedTextHash: textHash(candidate.text),
    };
  }
  const publishable = classification.label === 'allow' || classification.label === 'allow_with_warning';
  if (publishable) await publish(candidate);
  return { publishable, classification };
}
