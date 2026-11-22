// The standalone SPA: theme applied before first paint, a portal token taken
// from `#token=…` / `?token=…` (and stripped from the address bar), browser
// history routing under the injected base path.
import { bootSpa } from "@xtandard/kit/ui";
import { App } from "./App.tsx";
import * as api from "./api.ts";
import { themeStore } from "./theme.ts";
import "./styles.css";

bootSpa({
  App,
  configGlobal: "__WEBHOOKS_CONFIG__",
  themeKey: themeStore,
  tokenFromUrl: true,
  api,
  appProps: { showBrandMark: true },
});
