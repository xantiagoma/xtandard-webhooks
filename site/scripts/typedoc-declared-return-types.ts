// A TypeDoc plugin: a function whose return type is annotated with a type alias
// (`function webhooksElysia(…): WebhooksElysiaPlugin`) shows that alias, linked. TypeDoc otherwise
// renders the type the alias resolves to, which loses the name when the alias stands for a class
// instance (`ReturnType<typeof f>` → `Elysia`) — the documented name is the point of the alias.
import { Converter, type Application, type Context, type SignatureReflection } from "typedoc";
import ts from "typescript";

export function load(app: Application): void {
  app.converter.on(
    Converter.EVENT_CREATE_SIGNATURE,
    (context: Context, signature: SignatureReflection, declaration?: ts.Declaration) => {
      const node = declaration && ts.isFunctionLike(declaration) ? declaration.type : undefined;
      if (!node || !ts.isTypeReferenceNode(node) || node.typeArguments) return;
      const symbol = context.checker.getSymbolAtLocation(node.typeName);
      if (!symbol) return;
      const target = context.resolveAliasedSymbol(symbol);
      if (!(target.flags & ts.SymbolFlags.TypeAlias)) return;
      signature.type = context.createSymbolReference(target, context, node.typeName.getText());
    },
  );
}
