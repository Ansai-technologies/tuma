/**
 * Trust Engine attestation events ingress.
 *   POST /api/webhooks/attestation
 * Receives attestation.completed / attestation.failed (Track A), verifies the
 * signature, and applies the outcome to the order idempotently on eventId.
 */
import type { VercelRequest, VercelResponse } from "../_types.js";
import { PaymentFlow } from "../../src/lib/flow.js";
import { InMemoryOrderStore } from "../../src/lib/orders.js";
import { verifyWebhookSignature } from "../../src/lib/verify.js";
import type { AttestationEvent } from "../../src/lib/trust-engine.js";

const store = new InMemoryOrderStore(); // TODO: shared store (Supabase)
const flow = new PaymentFlow({ store });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const raw = JSON.stringify(req.body ?? {});
  if (!verifyWebhookSignature(raw, req.headers?.["x-tuma-signature"] as string ?? null)) {
    return res.status(401).send("Unauthorized");
  }

  const event = req.body as AttestationEvent;
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
