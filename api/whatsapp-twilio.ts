/**
 * Twilio WhatsApp webhook (sandbox).
 *   POST /api/whatsapp-twilio — inbound buyer/vendor messages via Twilio
 *
 * Twilio POSTs application/x-www-form-urlencoded with an X-Twilio-Signature
 * header (HMAC-SHA1 of the full request URL plus the sorted params, keyed by
 * the Auth Token). Message routing mirrors api/whatsapp.ts (Meta Cloud API
 * path): the vendor confirms with "CONFIRM <ref>", buyer replies drive
 * payment on their open order.
 *
 * SANDBOX CONSTRAINT: the Twilio REST API rejects free-form WhatsApp sends
 * in the sandbox (error 21654, "ContentSid Required"). Replies MUST go back
 * synchronously as TwiML in the webhook response, so the flow's sender is a
 * per-request capture sink and everything captured is returned as
 * <Response><Message> items. (Production senders allow REST Body sends;
 * see src/lib/whatsapp.ts.)
 *
 * SANDBOX GOTCHA (learned live 2026-10-13): replies only work on the
 * ACTIVATED WhatsApp sandbox (+1 415 523 8886, join phrase per console).
 * The trial TRYOUT surface (+1 737 250 8034) also POSTs here — signature
 * verifies, state moves — but never delivers the TwiML response as a
 * message. A day of "silent replies" was that, not the TwiML shape.
 *
 * Configure in Twilio Console -> Messaging -> Try it out -> WhatsApp sandbox
 * -> "Receive a message": https://<tuma-host>/api/whatsapp-twilio
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { PaymentFlow } from "../src/lib/flow.js";
import { createOrderStore } from "../src/lib/supabase-order-store.js";
import { copy } from "../src/lib/copy.js";
import { readRawBody } from "./_body.js";
import { verifyTwilioSignature } from "../src/lib/verify.js";
import { twiml } from "../src/lib/twiml.js";

export const config = { api: { bodyParser: false } };

const store = createOrderStore();

function stripWhatsAppPrefix(addr: string): string {
  const s = addr.startsWith("whatsapp:") ? addr.slice("whatsapp:".length) : addr;
  return s.startsWith("+") ? s.slice(1) : s;
}



export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const sendXml = (xml: string) => {
    const r: any = res;
    if (typeof r.setHeader === "function") r.setHeader("Content-Type", "text/xml; charset=utf-8");
    return res.status(200).send(xml);
  };
  const signatureHeader = req.headers?.["x-twilio-signature"];
  const signature = typeof signatureHeader === "string" ? signatureHeader : null;
  let params: URLSearchParams;
  try {
    const raw = await readRawBody(req);
    params = new URLSearchParams(raw.toString("utf8"));
    const host = req.headers?.host;
    const hostStr = typeof host === "string" ? host : "";
    const url = "https://" + hostStr + "/api/whatsapp-twilio";
    console.log("twilio webhook hit", {
      sid: params.get("MessageSid"),
      from: params.get("From"),
      url: url,
    });
    if (!verifyTwilioSignature(url, params, signature)) {
      console.warn("twilio signature mismatch", { url: url });
      return res.status(401).send("Unauthorized");
    }
  } catch {
    return res.status(400).send("Bad payload");
  }

  const captured: Array<{ to: string; body: string }> = [];
  const flow = new PaymentFlow({
    store,
    sender: async (to: string, body: string) => {
      captured.push({ to, body });
    },
  });

  try {
    const from = stripWhatsAppPrefix(params.get("From") || "");
    const text = params.get("Body") || "";
    console.log("twilio webhook routed", { from: from, textLength: text.length });
    if (!from || !text) return sendXml(twiml([]));

    // Vendor confirms an order: "CONFIRM TUMA-1042"
    if (/^confirm\s+\S+/i.test(text)) {
      const ref = text.split(/\s+/)[1].toUpperCase();
      const order = await store.get(ref);
      if (!order) {
        captured.push({ to: from, body: "Sorry, I could not find order " + ref + "." });
        return sendXml(twiml(captured));
      }
      if (from !== order.vendorId) return sendXml(twiml([]));
      await flow.confirmOrder(order);
      return sendXml(twiml(captured));
    }

    // Otherwise this is a buyer reply on their open order: find their
    // latest non-terminal order and route the reply.
    const order = await flow.findOpenOrderFor(from);
    if (!order) {
      captured.push({ to: from, body: copy.unrecognized() });
      return sendXml(twiml(captured));
    }
    await flow.handleBuyerReply(order, text);
    return sendXml(twiml(captured));
  } catch (err) {
    console.error("twilio whatsapp webhook error:", err);
    try {
      return sendXml(twiml(captured));
    } catch {
      return res.status(200).send("ok");
    }
  }
}
