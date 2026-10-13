/**
 * Build the TwiML document returned to Twilio for a WhatsApp webhook.
 *
 * The reply is deliberately BARE — <Message> with no to/from attributes,
 * the shape in Twilio's own WhatsApp quickstart: a response message is a
 * reply in the inbound conversation.
 *
 * History (2026-10-13): replies were silently lost for a day and three
 * TwiML shapes were tried before the real cause surfaced — the messages
 * were being sent to Twilio's trial TRYOUT surface (+1 737 250 8034),
 * whose configured webhook fires the handler (state moves, signatures
 * verify) but never turns the response into a WhatsApp message; the
 * actual sandbox (+1 415 523 8886) had never been activated, and its
 * reply webhook still pointed at a Twilio demo function. On the real
 * sandbox the bare reply works. The attributes were never the bug.
 *
 * Consequence that IS real: a webhook reply can only reach the person
 * who just messaged. Copies addressed to anyone else (e.g. the buyer
 * when the vendor sends CONFIRM) must travel via the notification
 * outbox, never via this document.
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
