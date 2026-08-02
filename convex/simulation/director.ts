import { isTimeSlot, type TimeSlot } from '../canon/eventTypes';

export const MAX_MAJOR_SCENES_PER_SLOT = 3;

export const DIRECTOR_PACING_STAGES = ['setup', 'development', 'escalation', 'turning_point', 'climax', 'aftermath'] as const;
export type DirectorPacingStage = (typeof DIRECTOR_PACING_STAGES)[number];

export type DirectorArcContext = {
  arcId: string;
  currentQuestion: string;
  status: 'active' | 'escalating' | 'climax' | 'resolving';
};

export type DirectorCharacterContext = {
  characterId: string;
  currentGoal: string;
  currentLocationId: string;
  slotsSinceMajorAppearance: number;
};

export type DirectorPlanContext = {
  schemaVersion: 1;
  directorRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  activeArcs: DirectorArcContext[];
  unresolvedQuestions: string[];
  recentMajorEventIds: string[];
  characters: DirectorCharacterContext[];
  viewerInterventionEventIds: string[];
  environmentFactIds: string[];
  repetitionScore: number;
  pacingStage: DirectorPacingStage;
};

export type DirectorSceneCandidate = {
  sceneId: string;
  directorRunId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  locationId: string;
  participantIds: string[];
  trigger: string;
  dramaticPressure: string;
  arcIds: string[];
  protectedFactIds: string[];
  expectedStateChangeTypes: string[];
};

export type DirectorPlan = {
  schemaVersion: 1;
  directorRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  scenes: DirectorSceneCandidate[];
};

export class DirectorPlanError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'DirectorPlanError';
  }
}

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'must be an object', path);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (record: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'unknown field is not allowed', `${path}.${unknown}`);
};

const nonempty = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'must be a non-empty string', path);
  }
  return value;
};

const uniqueStrings = (value: unknown, path: string, allowEmpty = true): string[] => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'must be an array of strings', path);
  }
  const result = value.map((entry, index) => nonempty(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'must not contain duplicates', path);
  }
  return result;
};

const worldDay = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'must be a non-negative integer', path);
  }
  return value as number;
};

const timeSlot = (value: unknown, path: string): TimeSlot => {
  if (!isTimeSlot(value)) throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'invalid world time slot', path);
  return value;
};

export function parseDirectorPlanContext(value: unknown): DirectorPlanContext {
  const record = object(value, 'context');
  exactKeys(record, [
    'schemaVersion', 'directorRunId', 'worldId', 'worldDay', 'timeSlot', 'activeArcs',
    'unresolvedQuestions', 'recentMajorEventIds', 'characters', 'viewerInterventionEventIds',
    'environmentFactIds', 'repetitionScore', 'pacingStage',
  ], 'context');
  if (record.schemaVersion !== 1) throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'unsupported schema version', 'context.schemaVersion');
  if (!Array.isArray(record.activeArcs) || !Array.isArray(record.characters)) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'arc and character context arrays are required');
  }
  const activeArcs = record.activeArcs.map((raw, index): DirectorArcContext => {
    const arc = object(raw, `context.activeArcs[${index}]`);
    exactKeys(arc, ['arcId', 'currentQuestion', 'status'], `context.activeArcs[${index}]`);
    if (!['active', 'escalating', 'climax', 'resolving'].includes(String(arc.status))) {
      throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'arc status is not active-family', `context.activeArcs[${index}].status`);
    }
    return { arcId: nonempty(arc.arcId, `context.activeArcs[${index}].arcId`),
      currentQuestion: nonempty(arc.currentQuestion, `context.activeArcs[${index}].currentQuestion`),
      status: arc.status as DirectorArcContext['status'] };
  });
  const characters = record.characters.map((raw, index): DirectorCharacterContext => {
    const character = object(raw, `context.characters[${index}]`);
    exactKeys(character, ['characterId', 'currentGoal', 'currentLocationId', 'slotsSinceMajorAppearance'], `context.characters[${index}]`);
    return {
      characterId: nonempty(character.characterId, `context.characters[${index}].characterId`),
      currentGoal: nonempty(character.currentGoal, `context.characters[${index}].currentGoal`),
      currentLocationId: nonempty(character.currentLocationId, `context.characters[${index}].currentLocationId`),
      slotsSinceMajorAppearance: worldDay(character.slotsSinceMajorAppearance, `context.characters[${index}].slotsSinceMajorAppearance`),
    };
  });
  if (new Set(activeArcs.map(({ arcId }) => arcId)).size !== activeArcs.length
      || new Set(characters.map(({ characterId }) => characterId)).size !== characters.length) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'arc and character IDs must be unique');
  }
  if (typeof record.repetitionScore !== 'number' || !Number.isFinite(record.repetitionScore)
      || record.repetitionScore < 0 || record.repetitionScore > 1) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'repetitionScore must be from 0 to 1', 'context.repetitionScore');
  }
  if (!DIRECTOR_PACING_STAGES.includes(record.pacingStage as DirectorPacingStage)) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'invalid pacing stage', 'context.pacingStage');
  }
  return {
    schemaVersion: 1, directorRunId: nonempty(record.directorRunId, 'context.directorRunId'),
    worldId: nonempty(record.worldId, 'context.worldId'), worldDay: worldDay(record.worldDay, 'context.worldDay'),
    timeSlot: timeSlot(record.timeSlot, 'context.timeSlot'), activeArcs,
    unresolvedQuestions: uniqueStrings(record.unresolvedQuestions, 'context.unresolvedQuestions'),
    recentMajorEventIds: uniqueStrings(record.recentMajorEventIds, 'context.recentMajorEventIds'), characters,
    viewerInterventionEventIds: uniqueStrings(record.viewerInterventionEventIds, 'context.viewerInterventionEventIds'),
    environmentFactIds: uniqueStrings(record.environmentFactIds, 'context.environmentFactIds'),
    repetitionScore: record.repetitionScore, pacingStage: record.pacingStage as DirectorPacingStage,
  };
}

export function parseAndValidateDirectorPlan(value: unknown, contextValue: unknown): DirectorPlan {
  const context = parseDirectorPlanContext(contextValue);
  const record = object(value, 'plan');
  exactKeys(record, ['schemaVersion', 'directorRunId', 'worldId', 'worldDay', 'timeSlot', 'scenes'], 'plan');
  if (record.schemaVersion !== 1 || !Array.isArray(record.scenes)) {
    throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'plan schema and scenes are required');
  }
  if (record.scenes.length > MAX_MAJOR_SCENES_PER_SLOT) {
    throw new DirectorPlanError('DIRECTOR_SCENE_LIMIT', `a slot may contain at most ${MAX_MAJOR_SCENES_PER_SLOT} major scenes`, 'plan.scenes');
  }
  const directorRunId = nonempty(record.directorRunId, 'plan.directorRunId');
  const planWorldId = nonempty(record.worldId, 'plan.worldId');
  const planWorldDay = worldDay(record.worldDay, 'plan.worldDay');
  const planTimeSlot = timeSlot(record.timeSlot, 'plan.timeSlot');
  if (directorRunId !== context.directorRunId || planWorldId !== context.worldId
      || planWorldDay !== context.worldDay || planTimeSlot !== context.timeSlot) {
    throw new DirectorPlanError('DIRECTOR_RUN_CONFLICT', 'plan envelope must match Director Run context');
  }
  const characters = new Map(context.characters.map((entry) => [entry.characterId, entry]));
  const arcIds = new Set(context.activeArcs.map(({ arcId }) => arcId));
  const usedCharacters = new Set<string>();
  const sceneIds = new Set<string>();
  const scenes = record.scenes.map((raw, index): DirectorSceneCandidate => {
    const path = `plan.scenes[${index}]`;
    const scene = object(raw, path);
    exactKeys(scene, [
      'sceneId', 'directorRunId', 'worldDay', 'timeSlot', 'locationId', 'participantIds',
      'trigger', 'dramaticPressure', 'arcIds', 'protectedFactIds', 'expectedStateChangeTypes',
    ], path);
    const sceneId = nonempty(scene.sceneId, `${path}.sceneId`);
    if (sceneIds.has(sceneId)) throw new DirectorPlanError('DIRECTOR_SCENE_CONFLICT', 'scene IDs must be unique', `${path}.sceneId`);
    sceneIds.add(sceneId);
    const participants = uniqueStrings(scene.participantIds, `${path}.participantIds`, false);
    const locationId = nonempty(scene.locationId, `${path}.locationId`);
    for (const participantId of participants) {
      const participant = characters.get(participantId);
      if (!participant) throw new DirectorPlanError('DIRECTOR_UNKNOWN_REFERENCE', 'unknown participant', `${path}.participantIds`);
      if (participant.currentLocationId !== locationId) {
        throw new DirectorPlanError('DIRECTOR_LOCATION_CONFLICT', 'participant is not available at scene location', `${path}.locationId`);
      }
      if (usedCharacters.has(participantId)) {
        throw new DirectorPlanError('DIRECTOR_TIME_CONFLICT', 'a character cannot be in two major scenes in one slot', `${path}.participantIds`);
      }
      usedCharacters.add(participantId);
    }
    const sceneArcIds = uniqueStrings(scene.arcIds, `${path}.arcIds`);
    if (sceneArcIds.some((arcId) => !arcIds.has(arcId))) {
      throw new DirectorPlanError('DIRECTOR_UNKNOWN_REFERENCE', 'scene references a non-active arc', `${path}.arcIds`);
    }
    if (nonempty(scene.directorRunId, `${path}.directorRunId`) !== directorRunId
        || worldDay(scene.worldDay, `${path}.worldDay`) !== planWorldDay
        || timeSlot(scene.timeSlot, `${path}.timeSlot`) !== planTimeSlot) {
      throw new DirectorPlanError('DIRECTOR_RUN_CONFLICT', 'scene must trace to the same Director Run and slot', path);
    }
    return {
      sceneId, directorRunId, worldDay: planWorldDay, timeSlot: planTimeSlot, locationId,
      participantIds: participants, trigger: nonempty(scene.trigger, `${path}.trigger`),
      dramaticPressure: nonempty(scene.dramaticPressure, `${path}.dramaticPressure`), arcIds: sceneArcIds,
      protectedFactIds: uniqueStrings(scene.protectedFactIds, `${path}.protectedFactIds`),
      expectedStateChangeTypes: uniqueStrings(scene.expectedStateChangeTypes, `${path}.expectedStateChangeTypes`),
    };
  });
  return { schemaVersion: 1, directorRunId, worldId: planWorldId, worldDay: planWorldDay, timeSlot: planTimeSlot, scenes };
}
