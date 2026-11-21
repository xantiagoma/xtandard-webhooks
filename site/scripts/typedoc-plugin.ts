// A local TypeDoc plugin for the API reference (loaded by astro.config.ts):
//
// 1. A function whose return type is annotated with one of the package's own type aliases is
//    documented with that alias (`webhooksElysia(options): WebhooksElysiaPlugin`), as written. TypeDoc
//    otherwise prints the type the checker resolves the alias to — for the Elysia adapters, the
//    plugin's full inferred `Elysia<…, object & object & …>` generics.
// 2. A symbol several entry points export is documented once (see apiOwners in astro.config.ts);
//    the others get a reference. Those are recorded in `.astro/api-reexports.json` so
//    scripts/api-overviews.ts can list them on each re-exporting module's page.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  Converter,
  ReflectionKind,
  type Application,
  type DeclarationReflection,
  type ReferenceReflection,
} from "typedoc";
import ts from "typescript";

/** Where api-overviews.ts reads the re-exports from (site/.astro/, git-ignored). */
export const reexportsFile = join(import.meta.dirname, "../.astro/api-reexports.json");

/**
 * A re-export: `name` in module `module` is documented in `owner` as the `kind` member `target`
 * (a different name for a renamed or `default` export).
 */
export type Reexport = {
  module: string;
  name: string;
  owner: string;
  kind: string;
  target: string;
};

/** The generated folder for each member kind (typedoc-plugin-markdown's defaults). */
const kindDirs: [ReflectionKind, string][] = [
  [ReflectionKind.Function, "functions"],
  [ReflectionKind.Class, "classes"],
  [ReflectionKind.Interface, "interfaces"],
  [ReflectionKind.TypeAlias, "type-aliases"],
  [ReflectionKind.Variable, "variables"],
  [ReflectionKind.Enum, "enumerations"],
  [ReflectionKind.Namespace, "namespaces"],
];

export function load(app: Application): void {
  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, signature, node) => {
    const typeNode = node && "type" in node ? node.type : undefined;
    if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return;
    let symbol = context.checker.getSymbolAtLocation(typeNode.typeName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = context.checker.getAliasedSymbol(symbol);
    const declaration = symbol?.declarations?.[0];
    if (
      !declaration ||
      !ts.isTypeAliasDeclaration(declaration) ||
      declaration.getSourceFile().fileName.includes("/node_modules/")
    )
      return;
    signature.type = context.converter.convertType(context, typeNode);
  });

  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const reexports: Reexport[] = [];
    for (const ref of context.project.getReflectionsByKind(ReflectionKind.Reference)) {
      const module = ref.parent;
      const target = (ref as ReferenceReflection).tryGetTargetReflectionDeep() as
        | DeclarationReflection
        | undefined;
      const owner = target?.parent;
      const kind = target && kindDirs.find(([k]) => target.kindOf(k))?.[1];
      if (!module?.kindOf(ReflectionKind.Module) || !owner?.kindOf(ReflectionKind.Module) || !kind)
        continue;
      reexports.push({
        module: module.name,
        name: ref.name,
        owner: owner.name,
        kind,
        target: target.name,
      });
    }
    mkdirSync(dirname(reexportsFile), { recursive: true });
    writeFileSync(reexportsFile, JSON.stringify(reexports, null, 2));
  });
}
