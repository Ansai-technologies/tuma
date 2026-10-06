/**
 * Trust Engine attestation events ingress.
 *   POST /api/webhooks/attestation
 * Receives attestation.completed / attestation.failed (Track A), verifies the
 * signature, and applies the outcome to the order idempotently on eventId.
 */
import type { VercelRequest, VercelResponse } from "../_types.js";
import { PaymentFlow } from "../../src/lib/flow.js";
import { createOrderStore } from "../../src/lib/supabase-order-store.js";
import { verifyWebhookSignature } from "../../src/lib/verify.js";
import type { AttestationEvent } from "../../src/lib/trust-engine.js";
import { readRawBody } from "../_body.js";

export const config = { api: { bodyParser: false } };

const store = createOrderStore();
const flow = new PaymentFlow({ store });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const signatureHeader = req.headers?.["x-tuma-signature"];
  const signature = typeof signatureHeader === "string" ? signatureHeader : null;
  let raw: Buffer;
  let event: AttestationEvent;
  try {
    raw = await readRawBody(req);
    if (!verifyWebhookSignature(raw, signature)) {
      return res.status(401).send("Unauthorized");
    }
    event = JSON.parse(raw.toString("utf8")) as AttestationEvent;
  } catch {
    return res.status(400).send("Bad payload");
  }

  if (!event || typeof event !== "object") {
    return res.status(400).send("Bad payload");
  }

  if (event.event !== "attestation.completed" && event.event !== "attestation.failed") {
    return res.status(400).send("Unknown event");
  }

  try {
    await flow.handleAttestationEvent(event);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("attestation webhook error:", err);
    // 500 so the engine retries; handleAttestationEvent is idempotent.
    return res.status(500).json({ ok: false });
  }
}
