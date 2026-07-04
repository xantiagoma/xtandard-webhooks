/**
 * A bare TypeScript receiver verifying with `@xtandard/webhooks/receiver` —
 * zero dependencies beyond the package, works in any WinterCG runtime.
 *
 *   bun install && bun run main.ts       # listens on :8000
 *   PORT=8100 bun run main.ts
 *
 * Then, from ../: `bun run send.ts` (RECEIVER_URL defaults to :8000/webhook).
 *
 * Unlike the Python/Go receivers (which use the official Standard Webhooks
 * libraries), verifyWebhook takes the full `whsec_…` secret as-is.
 */
import { verifyWebhook } from "@xtandard/webhooks/receiver";

const SECRET = process.env.WEBHOOK_SECRET ?? "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const port = Number(process.env.PORT) || 8000;

Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/webhook" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const envelope = await verifyWebhook(request, SECRET);
      console.log(`verified ${envelope.type}:`, envelope.data);
      return Response.json({ ok: true });
    } catch (err) {
      console.log(`REJECTED: ${err instanceof Error ? err.message : err}`);
      return new Response("invalid signature", { status: 401 });
    }
  },
});

console.log(`TypeScript receiver on http://127.0.0.1:${port}/webhook`);
