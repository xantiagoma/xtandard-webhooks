import { defineUiConfig } from "@xtandard/kit/build";

// Separate build for the bundled admin SPA: src/ui → dist/ui (emptied first),
// served by the panel handler. `base: "./"` keeps asset URLs relative so the SPA
// works under any mount path (/webhooks, /admin, ...) via the injected <base> tag.
export default defineUiConfig();
