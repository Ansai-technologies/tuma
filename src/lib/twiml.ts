/**
 * TwiML construction for synchronous WhatsApp replies (Twilio sandbox path).
 *
 * Twilio rule: a <Message> in a webhook response that names a "to" MUST
 * also name a "from" — the Twilio number that received the inbound message.
 * A to-only message is silently dropped by Twilio (the webhook returns 200
 * and nothing reaches the phone), which is why every reply built here
 * carries both attributes.
 */

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build the TwiML response for captured reply messages.
 * `fromAddr` is the Twilio address the inbound message arrived on
 * (the webhook's "To" parameter, e.g. "whatsapp:+17372508034").
 */
export function twiml(messages: Array<{ to: string; body: string }>, fromAddr: string): string {
  const items = messages
    .map(
      (m) =>
        '  <Message to="whatsapp:+' +
        m.to.replace(/^\+/, "") +
        '" from="' +
        fromAddr +
        '">' +
        escapeXml(m.body) +
        "</Message>",
    )
    .join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + items + "\n</Response>";
}
