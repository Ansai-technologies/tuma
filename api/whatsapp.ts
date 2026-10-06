/**
 * WhatsApp Cloud API webhook.
 *   GET  /api/whatsapp  — subscription verification (hub.verify_token)
 *   POST /api/whatsapp  — inbound buyer/vendor messages
 *
 * Message routing is deliberately small for v0.1: the vendor confirms an
 * order with "CONFIRM <ref>", and the buyer's replies drive payment.
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { PaymentFlow } from "../src/lib/flow.js";
import { InMemoryOrderStore } from "../src/lib/orders.js";
import { copy } from "../src/lib/copy.js";
import { sendWhatsAppText } from "../src/lib/whatsapp.js";

const store = new InMemoryOrderStore(); // TODO: Supabase OrderStore
const flow = new PaymentFlow({ store });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    // WhatsApp subscription verification handshake.
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge as string);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      if (!message?.from || !message?.text?.body) return res.status(200).send("ok");

      const from: string = message.from;
      const text: string = message.text.body;

      // Vendor confirms an order: "CONFIRM TUMA-1042"
      if (/^confirm\s+\S+/i.test(text)) {
        const ref = text.split(/\s+/)[1].toUpperCase();
        const order = await store.get(ref);
        if (!order) {
          await sendWhatsAppText(from, `Sorry, I could not find order ${ref}.`);
          return res.status(200).send("ok");
        }
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
      console.error("whatsapp webhook error:", err);
      return res.status(200).send("ok"); // ack anyway to stop retries
    }
  }

  return res.status(405).send("Method not allowed");
}
