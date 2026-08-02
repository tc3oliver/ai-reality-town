import { MISTWOOD_PUBLIC_WORLD_ID } from './mistwoodSeed';

export type PublicWorldRegistration = { worldId: string; slug: string; name: string };

const PUBLIC_WORLDS: readonly PublicWorldRegistration[] = [
  { worldId: MISTWOOD_PUBLIC_WORLD_ID, slug: 'mistwood', name: 'Mistwood' },
];

export function listPublicWorlds(): PublicWorldRegistration[] {
  return PUBLIC_WORLDS.map((world) => ({ ...world }));
}

export function resolvePublicWorld(routeIdOrSlug: string): PublicWorldRegistration | null {
  const world = PUBLIC_WORLDS.find((candidate) => candidate.worldId === routeIdOrSlug || candidate.slug === routeIdOrSlug);
  return world ? { ...world } : null;
}

