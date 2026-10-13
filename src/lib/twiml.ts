/**
 * Build the TwiML document returned to Twilio for a WhatsApp webhook.
 *
 * Deliberately BARE: <Message> carries NO to/from attributes. Twilio's
 * WhatsApp sandbox silently creates NO outbound message when the reply
 * <Message> carries attributes (verified 2026-10-13 against the console
 * message log: inbound webhooks ran, zero outbound SIDs existed — first
 * with to-only, then with to+from). The bare form — the shape in Twilio's
 * own WhatsApp quickstart — is a reply in the inbound conversation, which
 * is the only delivery the webhook response can be trusted to make.
 *
 * Consequence: a webhook reply can only reach the person who just
 * messaged. Copies addressed to anyone else (e.g. the buyer when the
 * vendor sends CONFIRM) must travel via the notification outbox, never
 * via this document.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// `to` is accepted for caller bookkeeping (and future outbox routing)
// but deliberately NOT rendered — see the note above.
export function twiml(messages: Array<{ to?: string; body: string }>): string {
  const parts = messages.map(
    (m) => `  <Message>${escapeXml(m.body)}</Message>`,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' +
    parts.join("\n") +
    (parts.length ? "\n" : "") +
    "</Response>"
  );
}
