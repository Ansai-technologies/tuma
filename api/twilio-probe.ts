/**
 * Diagnostic probe for the Twilio WhatsApp sandbox reply path.
 *   POST /api/twilio-probe
 *
 * No signature check, no database, no flow logic: it logs what arrived
 * and returns a hardcoded minimal TwiML reply. Point the sandbox webhook
 * at this URL temporarily to bisect "our handler's response" vs "the
 * sandbox plumbing": if this reply lands on the phone, the plumbing is
 * fine and the fault is inside /api/whatsapp-twilio; if it doesn't, the
 * fault is in the sandbox configuration/account, not in our code.
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { readRawBody } from "./_body.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const raw = await readRawBody(req);
    const params = new URLSearchParams(raw.toString("utf8"));
    console.log("twilio probe hit", {
      method: req.method,
      from: params.get("From"),
      to: params.get("To"),
      body: params.get("Body"),
      sid: params.get("MessageSid"),
    });
  } catch (err) {
    console.error("twilio probe read error:", err);
  }
  const r: any = res;
  if (typeof r.setHeader === "function") r.setHeader("Content-Type", "text/xml; charset=utf-8");
  return res
    .status(200)
    .send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tuma probe OK — the webhook reply path works.</Message></Response>');
}
