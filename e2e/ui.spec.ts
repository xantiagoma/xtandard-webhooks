import { expect, test } from "@playwright/test";

// Runs against a fresh in-memory e2e server (see playwright.config.ts and
// e2e/server.ts). Serial: the journey builds on its own state (memory storage
// persists per server), and later tests reuse ids captured by earlier ones.
test.describe.configure({ mode: "serial" });

const APP = "e2e-corp";
const EVENT_TYPE = "order.shipped";

// Captured along the journey (serial mode: one worker, shared module state).
let receiverUrl = "";
let mintedSecret = "";
let goodEndpointId = "";

test("loads the dashboard shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("@xtandard/webhooks e2e").first()).toBeVisible();
  // Seeded application is selected in the switcher; the Overview renders.
  await expect(page.getByLabel("Application")).toHaveText(/acme/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("creates an application from the creatable combobox", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Application").click();
  await page.getByPlaceholder(/Search or create/).fill(APP);
  await page.getByText(`Create application "${APP}"`).click();
  await expect(page.getByLabel("Application")).toHaveText(new RegExp(APP));
  // The switcher writes ?app= into the URL (shareable context).
  await expect(page).toHaveURL(new RegExp(`app=${APP}`));
});

test("creates an event type with a description", async ({ page }) => {
  await page.goto(`/event-types?app=${APP}`);
  await expect(page.getByRole("heading", { name: "Event Types" })).toBeVisible();
  // Seeded catalog is grouped by groupName.
  await expect(page.getByText("Billing", { exact: true })).toBeVisible();
  await expect(page.getByText("invoice.paid")).toBeVisible();

  await page.getByRole("button", { name: "New event type" }).click();
  await page.getByPlaceholder("invoice.paid").fill(EVENT_TYPE);
  await page.getByRole("button", { name: "Create event type" }).click();

  // Lands on the detail editor; add a description and save.
  await expect(page.getByRole("heading", { name: EVENT_TYPE })).toBeVisible();
  await page.getByPlaceholder("What does this event mean?").fill("An order left the warehouse");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Event type saved")).toBeVisible();
});

test("creates an endpoint and captures the secret shown once", async ({ page, request }) => {
  receiverUrl = ((await (await request.get("/e2e/receiver")).json()) as { url: string }).url;

  await page.goto(`/endpoints?app=${APP}`);
  await page.getByRole("button", { name: "New endpoint" }).click();
  await page.getByPlaceholder("https://example.com/webhooks").fill(receiverUrl);
  await page.getByPlaceholder("What receives these webhooks?").fill("e2e receiver");
  await page.getByRole("button", { name: "Create endpoint" }).click();

  // The one dialog that ever shows the signing secret.
  await expect(page.getByText("Endpoint created")).toBeVisible();
  mintedSecret = (await page.getByTestId("endpoint-secret").textContent()) ?? "";
  expect(mintedSecret).toMatch(/^whsec_/);
  await page.getByRole("button", { name: "I saved the secret" }).click();

  // Dialog routes to the endpoint detail.
  await expect(page.getByRole("heading", { name: receiverUrl })).toBeVisible();
  goodEndpointId = (await page.locator("p.font-mono", { hasText: /^ep_/ }).textContent()) ?? "";
  expect(goodEndpointId).toMatch(/^ep_/);
});

test("publishes via the API and the delivery succeeds in the UI", async ({ page, request }) => {
  const res = await request.post(`/api/applications/${APP}/messages`, {
    data: { eventType: EVENT_TYPE, payload: { orderId: "ord_1", carrier: "DHL" } },
  });
  expect(res.status()).toBe(201);
  const published = (await res.json()) as { message: { id: string }; deliveries: unknown[] };
  expect(published.deliveries.length).toBe(1);

  // Deliveries view auto-refreshes; the delivery walks pending → succeeded.
  await page.goto(`/deliveries?app=${APP}`);
  await expect(page.getByText("Succeeded").first()).toBeVisible({ timeout: 15_000 });

  // Detail shows the attempt timeline with the HTTP outcome.
  await page.locator("button", { hasText: /dlv_/ }).first().click();
  await expect(page.getByText(/Attempt #1/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("HTTP 200").first()).toBeVisible();

  // The message detail shows the signed envelope and links its deliveries.
  await page.goto(`/messages?app=${APP}`);
  await page.locator("button", { hasText: EVENT_TYPE }).first().click();
  await expect(page.getByText("Envelope")).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText(EVENT_TYPE);
  await expect(page.getByText(/msg_/).first()).toBeVisible();
});

test("an unreachable endpoint walks the schedule into dead-letter", async ({ page, request }) => {
  // Register a black-hole endpoint via the API (endpoint creation through the
  // UI is already covered above) and fan out a message to it.
  const created = await request.post(`/api/applications/${APP}/endpoints`, {
    data: { url: "http://127.0.0.1:9/blackhole", description: "unreachable" },
  });
  expect(created.status()).toBe(201);

  const res = await request.post(`/api/applications/${APP}/messages`, {
    data: { eventType: EVENT_TYPE, payload: { orderId: "ord_2" } },
  });
  expect(res.status()).toBe(201);

  // The Dead-letter filter tab shows it once the retry schedule is exhausted.
  await page.goto(`/deliveries?app=${APP}`);
  await page.getByRole("button", { name: "Dead-letter", exact: true }).click();
  await expect(page.getByText("Dead-letter").nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/3 attempts/).first()).toBeVisible({ timeout: 30_000 });
});

test("manual retry re-queues a dead-lettered delivery", async ({ page }) => {
  await page.goto(`/deliveries?app=${APP}`);
  await page.getByRole("button", { name: "Dead-letter", exact: true }).click();
  await page
    .locator("button", { hasText: /3 attempts/ })
    .first()
    .click();

  // Detail: attempt timeline + Retry on the failed delivery.
  await expect(page.getByText(/Attempt #3/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Delivery re-queued")).toBeVisible();

  // The retried attempt lands (still unreachable → fails again), proving the
  // requeue actually drove new attempts through the engine.
  await expect(page.getByText(/Attempt #4/)).toBeVisible({ timeout: 30_000 });
});

test("reveals and rotates the endpoint secret with a grace note", async ({ page }) => {
  await page.goto(`/endpoints/${goodEndpointId}?app=${APP}`);
  await expect(page.getByRole("heading", { name: receiverUrl })).toBeVisible();

  await page.getByRole("button", { name: "Reveal secret" }).click();
  await expect(page.getByTestId("current-secret")).toHaveText(mintedSecret);

  await page.getByRole("button", { name: "Rotate secret" }).first().click();
  await expect(page.getByText("Rotate signing secret")).toBeVisible();
  await expect(page.getByText(/keeps verifying until its grace window expires/)).toBeVisible();
  await page.getByRole("button", { name: "Rotate secret" }).last().click();

  await expect(page.getByText("Secret rotated")).toBeVisible();
  // New current secret + the graced predecessor still listed.
  const rotated = (await page.getByTestId("current-secret").textContent()) ?? "";
  expect(rotated).toMatch(/^whsec_/);
  expect(rotated).not.toBe(mintedSecret);
  await expect(page.getByText(/Previous — still verifying until/)).toBeVisible();
});

test("portal token renders the reduced portal chrome", async ({ page, request }) => {
  const { token } = (await (await request.get(`/e2e/portal-token?app=${APP}`)).json()) as {
    token: string;
  };
  expect(token).toMatch(/^whpt_/);

  // ?token= is the bundled SPA's portal embed affordance: the API client sends
  // it as a Bearer credential; /config then reports portal mode.
  await page.goto(`/endpoints?token=${token}`);

  // Reduced chrome: Portal badge, pinned app, no switcher, no Overview/Audit.
  await expect(page.getByText("Portal", { exact: true })).toBeVisible();
  await expect(page.getByText(APP, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Application")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Audit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Overview" })).toHaveCount(0);

  // The token's application endpoints are visible (scoped access works).
  await expect(page.getByRole("heading", { name: "Endpoints" })).toBeVisible();
  await expect(page.getByText(receiverUrl).first()).toBeVisible();

  // Event-type catalog is read-only in the portal.
  await page.getByRole("button", { name: "Event Types" }).click();
  await expect(page.getByText("read-only in the portal")).toBeVisible();
  await expect(page.getByRole("button", { name: "New event type" })).toHaveCount(0);
});
