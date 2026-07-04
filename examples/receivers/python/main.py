"""FastAPI receiver verifying with the OFFICIAL `standardwebhooks` library.

Run it (uv resolves fastapi/uvicorn/standardwebhooks from pyproject.toml):

    uv run main.py                    # listens on :8000
    PORT=8100 uv run main.py

Then, from ../: `bun run send.ts` (RECEIVER_URL defaults to :8000/webhook).

The secret is the Standard Webhooks spec's example value; the sender pins its
endpoint to the same one. The library expects the base64 part (no `whsec_`
prefix), like Svix's.
"""

import os

import uvicorn
from fastapi import FastAPI, Request, Response
from standardwebhooks.webhooks import Webhook, WebhookVerificationError

SECRET = os.environ.get("WEBHOOK_SECRET", "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")

wh = Webhook(SECRET.removeprefix("whsec_"))
app = FastAPI()


@app.post("/webhook")
async def webhook(request: Request):
    payload = (await request.body()).decode("utf-8")
    headers = dict(request.headers)  # lowercase keys: webhook-id / -timestamp / -signature
    try:
        envelope = wh.verify(payload, headers)
    except WebhookVerificationError as err:
        print(f"REJECTED: {err}")
        return Response("invalid signature", status_code=401)
    print(f"verified {envelope['type']}: {envelope['data']}")
    return {"ok": True}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Python receiver on http://127.0.0.1:{port}/webhook")
    uvicorn.run(app, host="127.0.0.1", port=port)
