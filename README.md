# Tuma — WhatsApp payment authentication

**Track B of the Ansai Trust Engine v0.1.** Tuma is the first tenant of the
attestation infrastructure: a WhatsApp payment-authentication flow for Kenyan
social commerce. Product name: **Trust Engine** (buyer-facing, outcome-first);
engineering name: **attestation infrastructure** (mechanism-first); the bridge
noun **attestation** is identical everywhere.

## The flow

```
vendor: CONFIRM TUMA-1042      (order moves open → awaiting_payment)
buyer:  "1"                    (STK push to their phone — Daraja sandbox)
        "2"                    (pay manually to the vendor's till)
        QHX7ABC123             (transaction code → attestation request)
engine: POST /attestations     (type=payment, contract v0.1)
webhook: attestation.completed / attestation.failed → buyer + vendor messaged
```

Only a `MATCHED` attestation tells the vendor to release the goods.

### Payment paths
1. **STK push** — `POST /api/mpesa/stk-result` receives the Daraja callback,
   extracts `MpesaReceiptNumber`, and asks the Trust Engine to attest it.
2. **Manual till payment** — the buyer replies with the M-Pesa transaction
   code; same attestation request. C2B confirmations also land on the Trust
   Engine's `/mpesa/c2b/callback` (Track A) and arrive here as webhook events.

### Failure messages (buyer)
Every failure maps to a plain-English next step; the machine `reasonCode`
never appears in a message:

| reasonCode | buyer message |
|---|---|
| `AMOUNT_MISMATCH` | "We received KSh 2,000 but this order total is KSh 2,500. Please top up the difference or contact the vendor to resolve this." |
| `RECIPIENT_MISMATCH` | pay again to the correct till |
| `CODE_NOT_FOUND` | check the code and send it again exactly |
| `STALE` | older than 24 hours — make a fresh payment |
| `DUPLICATE` | code already used for another order |
| `PENDING_CALLBACK` | waiting for M-Pesa confirmation — we will message you |

On `MATCHED`: buyer gets "Payment verified for order …", vendor gets
"Payment verified … Please release the goods."
On any failure: vendor gets "Do not release the goods yet."

### Order state machine
An order moves from `open` to `awaiting_payment`; retryable attestation
outcomes leave it in `awaiting_payment`, and a `MATCHED` result moves it to
`verified`. Webhook event claims are atomic and retryable, and notification
delivery uses a persistent outbox with separate delivery state for each
recipient.

## Contract linkage

Builds against the frozen **attestation-api-contract-v0.1**:
- `POST /attestations` `{ type: "payment", subject, payment: { channel: "mpesa", transactionCode, expectedAmount, expectedRecipient, orderRef } }`
- response attestation with `status` (`verified|unverified|pending`), `reasonCode`, display-only `reason`, `evidence`, `signature`, `prevHash`/`hash` chain
- events `attestation.completed` / `attestation.failed`
- contract file: `../drafts/attestation-api-contract-v0.1.md` (workspace drafts)

**Track A is mocked, not depended on.** `src/lib/mock-engine.ts` implements
the exact request/response shapes; `TRUST_ENGINE_MODE=mock` (default) uses
it, `=http` switches to `TRUST_ENGINE_BASE_URL` with no other code change.
Deterministic test prefixes: `OK`→MATCHED, `AMT`→AMOUNT_MISMATCH,
`RCP`→RECIPIENT_MISMATCH, `STALE`→STALE, `DUP`→DUPLICATE,
`PENDING`→PENDING_CALLBACK, anything else→CODE_NOT_FOUND.

## Endpoints (Vercel serverless, Node 20)

- `GET/POST /api/whatsapp` — WhatsApp Cloud API webhook (verify handshake + inbound messages)
- `POST /api/webhooks/attestation` — Trust Engine events (signature-verified, idempotent)
- `POST /api/mpesa/stk-result` — Daraja sandbox STK result callback
- `POST /api/orders` — order intake (creates `open` orders for vendor tooling)
- `GET /api/outbox` — authenticated scheduled worker for pending notifications

## Setup checklist — from the founder

Exact values needed; nothing here is optional for a live pilot:

1. **WhatsApp phone number ID** (Meta Business dashboard → WhatsApp → API setup)
2. **WhatsApp Business Account ID** (same place)
3. **WhatsApp permanent access token** (system user token, `whatsapp_business_messaging` scope)
4. **Webhook verify token** — any random string; we set it here AND in the Meta dashboard
5. **Vendor till / paybill number** to register for Safaricom C2B callbacks (callbacks go to the Trust Engine's `/mpesa/c2b/callback`, Track A)
6. **Daraja sandbox credentials** — consumer key, consumer secret, shortcode, LNM passkey (Safaricom Developer Portal, sandbox app)
7. **Trust Engine base URL + API key** (once Track A deploys) — until then, `TRUST_ENGINE_MODE=mock`
8. **`ATTESTATION_WEBHOOK_SECRET`** — generated shared secret; must match what Track A registers
9. **Supabase project URL and service-role key** — shared order, checkout, webhook-event, and notification-outbox storage
10. **Vendor API tokens** — configure `VENDOR_API_TOKENS` as a JSON object mapping each vendor's WhatsApp number to a unique token
11. **`WHATSAPP_APP_SECRET`** — Meta app secret for validating inbound webhook signatures
12. **`CRON_SECRET`** — secret used by the scheduled notification worker

Apply `supabase/schema.sql` to the configured Supabase project before deploying.
The `POST /api/orders` route requires an `Authorization` header using the
bearer-token scheme; the token must be mapped to the submitted `vendorId`.

Secrets land in the deployment environment / secrets manager only. Never in
code, chat, or this repo.

## Local development

```bash
npm install
npm run typecheck
npm test
```

No credentials required: everything runs against the mock engine and a
capture-sink sender in tests.

## Known v0.1 limitations

- Shared order state and notification delivery require the configured Supabase
  schema; the in-memory store is used only by tests.
- The scheduled outbox worker requires `CRON_SECRET` in the deployment environment.
- WhatsApp webhook signatures are checked against the raw request body.
- Daraja is sandbox-only per the hard limits.
- User-facing copy is standard English only — Swahili/Sheng is a later differentiator.
