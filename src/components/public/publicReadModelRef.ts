import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { getPublishedReadModel as getPublishedReadModelExport } from '../../../convex/publicRead/readModelFunctions';

/**
 * ART-142: every public page reads through this one query. Referencing it via
 * `api.publicRead.readModelFunctions.getPublishedReadModel` in each page file used to work,
 * but the generated `api` union is large enough that fixing (or breaking) any one call site
 * shifts which other identical call site tips TypeScript's type-instantiation checker past its
 * complexity limit -- see {@link publicFunctionRef}. One shared, explicitly typed reference
 * keeps every page off that union entirely instead of leaving it a game of whack-a-mole.
 */
export const getPublishedReadModelRef = publicFunctionRef<typeof getPublishedReadModelExport>(
  'publicRead/readModelFunctions:getPublishedReadModel',
);
