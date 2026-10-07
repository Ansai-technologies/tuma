/**
 * Signature verification for inbound webhooks.
 * Attestation events from the Trust Engine are verified with a shared secret
 * (HMAC-SHA256 over the raw body, header X-Tuma-Signature) — the exact scheme
 * Track A ships must replace this one-to-one if it differs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(rawBody: string | Uint8Array, signature: string | null): boolean {
  const secret = process.env.ATTESTATION_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWhatsAppSignature(rawBody: Uint8Array, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
