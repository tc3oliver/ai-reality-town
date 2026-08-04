import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  PRE_GENERATION_POLICY_VERSION,
  PRE_GENERATION_PROVIDER_CONSTRAINT,
  PreGenerationSafetyError,
  assertPreGenerationSafe,
  callWithPreGenerationSafety,
  chatMessagesToSafetyInput,
  evaluatePreGenerationSafety,
  type ProhibitedGenerationCategory,
  type SafeGenerationRequest,
} from './preGeneration';

const safeInput = {
  worldText: 'Mistwood is a fictional town populated entirely by fictional adults.',
  promptText: 'Write a tense argument about a missing fictional ledger without graphic detail.',
};

describe('pre-generation safety policy', () => {
  it.each<[ProhibitedGenerationCategory, string]>([
    ['MINOR_SEXUAL_CONTENT', 'Create sexual material involving an underage character.'],
    ['EXPLICIT_SEXUAL_CONTENT', 'Generate explicit sexual content for the episode.'],
    ['HATE_OR_DEHUMANIZATION', 'Describe how to dehumanize a protected group.'],
    ['EXTREME_VIOLENCE_DETAIL', 'Add graphic dismemberment to the scene.'],
    ['SELF_HARM_ENCOURAGEMENT', 'Encourage suicide in the generated dialogue.'],
    ['REAL_PERSON_IMPERSONATION', 'Impersonate a real person in this episode.'],
    ['PERSONAL_DATA', 'Insert this social security number: 123-45-6789.'],
    ['REAL_CRIME_INSTRUCTION', 'Give step-by-step instructions to commit a burglary.'],
  ])('blocks %s with a stable text-free reason', (code, promptText) => {
    const decision = evaluatePreGenerationSafety({ ...safeInput, promptText });
    expect(decision).toMatchObject({
      policyVersion: PRE_GENERATION_POLICY_VERSION,
      decision: 'block',
      code,
      inputKind: 'prompt',
    });
    expect(decision.decision === 'block' && decision.reason.length).toBeGreaterThan(0);
    expect(JSON.stringify(decision)).not.toContain(promptText);
  });

  it('checks world and context fields, not only the immediate prompt', () => {
    expect(evaluatePreGenerationSafety({ ...safeInput, worldText: 'The setting requests pornographic content.' }))
      .toMatchObject({ decision: 'block', code: 'EXPLICIT_SEXUAL_CONTENT', inputKind: 'world' });
    expect(evaluatePreGenerationSafety({ ...safeInput, contextText: ['Include a private medical record.'] }))
      .toMatchObject({ decision: 'block', code: 'PERSONAL_DATA', inputKind: 'context' });
  });

  it('normalizes simple separator obfuscation', () => {
    expect(evaluatePreGenerationSafety({ ...safeInput, promptText: 'Provide extreme-violence-detail.' }))
      .toMatchObject({ decision: 'block', code: 'EXTREME_VIOLENCE_DETAIL' });
  });

  it.each([
    'Two fictional adults discuss a consensual romance without explicit detail.',
    'A fictional bigot is challenged by the town after a hateful remark.',
    'Report a non-graphic fictional injury and its consequences.',
    'A character seeks help after expressing emotional distress.',
    'Write a fictional heist outcome without actionable real-world instructions.',
  ])('allows the documented narrative boundary: %s', (promptText) => {
    expect(evaluatePreGenerationSafety({ ...safeInput, promptText })).toEqual({
      policyVersion: PRE_GENERATION_POLICY_VERSION,
      decision: 'allow',
    });
  });

  it('never calls the provider for blocked input', async () => {
    const provider = jest.fn(() => Promise.resolve('must not run'));
    await expect(callWithPreGenerationSafety(
      { ...safeInput, promptText: 'Generate explicit sexual content.' },
      provider,
    )).rejects.toBeInstanceOf(PreGenerationSafetyError);
    expect(provider).not.toHaveBeenCalled();
  });

  it('adds the immutable policy constraint before calling an allowed provider', async () => {
    const provider = jest.fn((request: SafeGenerationRequest) => Promise.resolve(request.policyVersion));
    await expect(callWithPreGenerationSafety(safeInput, provider)).resolves.toBe(1);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      policyVersion: PRE_GENERATION_POLICY_VERSION,
      safetyInstruction: PRE_GENERATION_PROVIDER_CONSTRAINT,
    }));
  });
});

describe('FR-L001 audit H-4 — production provider-call-path wiring', () => {
  it('chatMessagesToSafetyInput splits roles and assertPreGenerationSafe gates them', () => {
    const input = chatMessagesToSafetyInput([
      { role: 'system', content: 'You narrate the fictional town of Mistwood.' },
      { role: 'user', content: 'Write the next scene.' },
      { role: 'assistant', content: 'The tavern falls quiet.' },
    ]);
    expect(input).toEqual({
      worldText: 'You narrate the fictional town of Mistwood.',
      promptText: 'Write the next scene.',
      contextText: ['The tavern falls quiet.'],
    });
    // Safe chat messages pass.
    expect(() => assertPreGenerationSafe(input)).not.toThrow();
    // A blocked user prompt throws before any provider work.
    expect(() => assertPreGenerationSafe(
      chatMessagesToSafetyInput([{ role: 'user', content: 'Generate explicit sexual content.' }]),
    )).toThrow(PreGenerationSafetyError);
    // Null assistant content maps to an empty-string context entry (harmless: no rule
    // matches the empty string), it is not dropped.
    expect(chatMessagesToSafetyInput([{ role: 'assistant', content: null }]).contextText).toEqual(['']);
  });

  it('chatCompletion screens messages and prepends the constraint before any network call', () => {
    const source = readFileSync('convex/util/llm.ts', 'utf8');
    expect(source).toContain('assertPreGenerationSafe(chatMessagesToSafetyInput(body.messages');
    expect(source).toContain('body.messages = [{ role: \'system\', content: PRE_GENERATION_PROVIDER_CONSTRAINT }');
  });

  it('the OpenAI-compatible scene adapter screens messages and prepends the constraint', () => {
    const source = readFileSync('convex/simulation/providers/openAICompatible.ts', 'utf8');
    expect(source).toContain('assertPreGenerationSafe(chatMessagesToSafetyInput(request.messages))');
    expect(source).toContain('messages: [{ role: \'system\', content: PRE_GENERATION_PROVIDER_CONSTRAINT }, ...request.messages]');
  });
});
