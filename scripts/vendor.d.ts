// Ambient types for build-only deps that ship no declarations.

declare module "postcss-prefix-selector" {
  import type { Plugin } from "postcss";

  interface PrefixSelectorOptions {
    prefix: string;
    exclude?: (string | RegExp)[];
    transform?: (
      prefix: string,
      selector: string,
      prefixedSelector: string,
      filePath?: string,
    ) => string;
  }

  export default function prefixSelector(options: PrefixSelectorOptions): Plugin;
}
