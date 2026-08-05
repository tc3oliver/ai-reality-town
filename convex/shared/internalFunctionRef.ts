import { makeFunctionReference } from 'convex/server';
import type { FunctionReference, RegisteredAction, RegisteredMutation, RegisteredQuery } from 'convex/server';

/**
 * ART-142: the generated `internal`/`api` union (`convex/_generated/api.d.ts`) spans every
 * exported Convex function in the repo. Once that union grows large enough, a deep property
 * access like `internal.a.b.c` pushes TypeScript's type-instantiation checker past its fixed,
 * non-configurable complexity limit -- `tsc` sometimes hard-fails with TS2589, and
 * typescript-eslint's separate type-aware pass instead silently resolves the expression to
 * `any`, cascading into `no-unsafe-*` errors at every downstream use. Neither is a defect in
 * the referenced function itself.
 *
 * `makeFunctionReference` builds the exact runtime shape (`{ [functionName]: "module/path:name" }`)
 * that `internal.module.path.name` resolves to, without ever reading the generated union, so it
 * carries none of that cost. `Export` should be `typeof theActualExportedFunction` (a type-only
 * import from the target module), so `Args`/`ReturnType` stay derived from -- and in sync with --
 * that function's real signature instead of being hand-typed and free to drift.
 */
type ExportedArgs<Export> = Export extends RegisteredMutation<any, infer Args, any>
  ? Args
  : Export extends RegisteredQuery<any, infer Args, any>
    ? Args
    : Export extends RegisteredAction<any, infer Args, any>
      ? Args
      : never;

type ExportedReturn<Export> = Export extends RegisteredMutation<any, any, infer Ret>
  ? Awaited<Ret>
  : Export extends RegisteredQuery<any, any, infer Ret>
    ? Awaited<Ret>
    : Export extends RegisteredAction<any, any, infer Ret>
      ? Awaited<Ret>
      : never;

type ExportedType<Export> = Export extends RegisteredMutation<any, any, any>
  ? 'mutation'
  : Export extends RegisteredQuery<any, any, any>
    ? 'query'
    : Export extends RegisteredAction<any, any, any>
      ? 'action'
      : never;

export function internalFunctionRef<Export>(
  path: string,
): FunctionReference<ExportedType<Export>, 'internal', ExportedArgs<Export>, ExportedReturn<Export>> {
  return makeFunctionReference(path) as unknown as FunctionReference<
    ExportedType<Export>,
    'internal',
    ExportedArgs<Export>,
    ExportedReturn<Export>
  >;
}

/** Same as {@link internalFunctionRef}, for functions registered with `query`/`mutation`/`action` (public visibility). */
export function publicFunctionRef<Export>(
  path: string,
): FunctionReference<ExportedType<Export>, 'public', ExportedArgs<Export>, ExportedReturn<Export>> {
  return makeFunctionReference(path) as FunctionReference<
    ExportedType<Export>,
    'public',
    ExportedArgs<Export>,
    ExportedReturn<Export>
  >;
}
