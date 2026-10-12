/**
 * Twilio WhatsApp webhook (sandbox-ready).
 *   POST /api/whatsapp-twilio — inbound buyer/vendor messages via Twilio
 *
 * Twilio POSTs application/x-www-form-urlencoded with an X-Twilio-Signature
 * header (HMAC-SHA1 of the full request URL plus the sorted params, keyed by
 * the Auth Token). Message routing mirrors api/whatsapp.ts (Meta Cloud API
 * path); the vendor confirms with "CONFIRM <ref>", buyer replies drive
 * payment on their open order.
 *
 * Configure in Twilio Console -> Messaging -> Try it out -> WhatsApp sandbox
 * -> "Receive a message": https://<tuma-host>/api/whatsapp-twilio
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { PaymentFlow } from "../src/lib/flow.js";
import { createOrderStore } from "../src/lib/supabase-order-store.js";
import { copy } from "../src/lib/copy.js";
import { sendWhatsAppText } from "../src/lib/whatsapp.js";
import { readRawBody } from "./_body.js";
import { verifyTwilioSignature } from "../src/lib/verify.js";

export const config = { api: { bodyParser: false } };

const store = createOrderStore();
const flow = new PaymentFlow({ store });

function stripWhatsAppPrefix(addr: string): string {
  const s = addr.startsWith("whatsapp:") ? addr.slice("whatsapp:".length) : addr;
  return s.startsWith("+") ? s.slice(1) : s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const signatureHeader = req.headers?.["x-twilio-signature"];
  const signature = typeof signatureHeader === "string" ? signatureHeader : null;
  let params: URLSearchParams;
  try {
    const raw = await readRawBody(req);
    params = new URLSearchParams(raw.toString("utf8"));
    const host = req.headers?.host;
    const hostStr = typeof host === "string" ? host : "";
    const url = "https://" + hostStr + "/api/whatsapp-twilio";
    if (!verifyTwilioSignature(url, params, signature)) {
      return res.status(401).send("Unauthorized");
    }
  } catch {
    return res.status(400).send("Bad payload");
  }
  try {
    const from = stripWhatsAppPrefix(params.get("From") || "");
    const text = params.get("Body") || "";
    if (!from || !text) return res.status(200).send("ok");

    // Vendor confirms an order: "CONFIRM TUMA-1042"
    if (/^confirm\s+\S+/i.test(text)) {
      const ref = text.split(/\s+/)[1].toUpperCase();
      const order = await store.get(ref);
      if (!order) {
        await sendWhatsAppText(from, "Sorry, I could not find order " + ref + ".");
        return res.status(200).send("ok");
      }
      if (from !== order.vendorId) return res.status(200).send("ok");
      await flow.confirmOrder(order);
      return res.status(200).send("ok");
    }

    // Otherwise this is a buyer reply on their open order: find their
    // latest non-terminal order and route the reply.
    const order = await flow.findOpenOrderFor(from);
    if (!order) {
      await sendWhatsAppText(from, copy.unrecognized());
      return res.status(200).send("ok");
    }
    await flow.handleBuyerReply(order, text);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("twilio whatsapp webhook error:", err);
    return res.status(200).send("ok"); // ack anyway to stop retries
  }
}
