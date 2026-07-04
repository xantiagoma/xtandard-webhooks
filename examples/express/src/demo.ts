/**
 * Shared bits for the demo app: the idempotent boot seed and the HTML page.
 * Kept separate so `index.ts` reads as pure wiring.
 */
import type { WebhooksCore } from "@xtandard/webhooks";

/**
 * Ensure the application + event type the demo publishes exist. Safe to run on
 * every boot: application creation is guarded, event-type upsert is idempotent.
 */
export async function seedIfEmpty(core: WebhooksCore): Promise<void> {
  if (!(await core.getApplication("acme"))) {
    await core.createApplication({ key: "acme", name: "Acme Inc." });
  }
  await core.upsertEventType({
    name: "user.created",
    groupName: "Users",
    description: "A new user signed up.",
  });
}

/** The demo page: a signup button whose click publishes a webhook. */
export function renderDemoPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Acme signup — @xtandard/webhooks demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
    input, button { font-size: 1rem; padding: 0.5rem 0.75rem; }
    pre { background: #f4f4f5; padding: 1rem; overflow-x: auto; }
    ol li { margin-bottom: 0.4rem; }
  </style>
</head>
<body>
  <h1>Acme signup</h1>
  <p>Each signup below calls <code>core.publish("acme", { eventType: "user.created", … })</code>
  — the app's only job. Delivery, retries, and dead-letters are the panel's problem.</p>
  <form id="signup">
    <input name="email" type="email" value="ada@example.com" required />
    <button type="submit">Sign up</button>
  </form>
  <pre id="out">(sign up to publish a user.created webhook)</pre>
  <h2>See the loop</h2>
  <ol>
    <li>Open <a href="/webhooks" target="_blank">the panel</a> → application <b>acme</b> → add an
        endpoint (any URL you control; a local receiver or a webhook viewer both work).</li>
    <li>Click <b>Sign up</b> here.</li>
    <li>Back in the panel: watch the delivery appear, with its signed attempt.</li>
  </ol>
  <script>
    document.getElementById("signup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get("email");
      const res = await fetch("/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      document.getElementById("out").textContent = JSON.stringify(await res.json(), null, 2);
    });
  </script>
</body>
</html>`;
}
