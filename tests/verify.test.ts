import { createHmac } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { verifyWebhookSignature, verifyWhatsAppSignature } from "../src/lib/verify.js";

const originalAttestationSecret = process.env.ATTESTATION_WEBHOOK_SECRET;
const originalWhatsAppSecret = process.env.WHATSAPP_APP_SECRET;

afterEach(() => {
  if (originalAttestationSecret === undefined) delete process.env.ATTESTATION_WEBHOOK_SECRET;
  else process.env.ATTESTATION_WEBHOOK_SECRET = originalAttestationSecret;
  if (originalWhatsAppSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = originalWhatsAppSecret;
});

describe("webhook signatures", () => {
  it("verifies WhatsApp signatures against the exact raw request bytes", () => {
    process.env.WHATSAPP_APP_SECRET = "unit-test-secret";
    const raw = Buffer.from('{ "entry" : [], "count": 1 }');
    const digest = createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex");

    expect(verifyWhatsAppSignature(raw, `sha256=${digest}`)).toBe(true);
    expect(
      verifyWhatsAppSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), `sha256=${digest}`)
    ).toBe(false);
  });

  it("verifies attestation signatures against the exact raw request bytes", () => {
    process.env.ATTESTATION_WEBHOOK_SECRET = "unit-test-secret";
    const raw = Buffer.from('{"event":"attestation.completed"}');
    const digest = createHmac("sha256", process.env.ATTESTATION_WEBHOOK_SECRET).update(raw).digest("hex");

    expect(verifyWebhookSignature(raw, digest)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(`${raw.toString()}\n`), digest)).toBe(false);
  });
});
