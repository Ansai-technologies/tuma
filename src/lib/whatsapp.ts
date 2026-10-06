/**
 * WhatsApp Business Cloud API sender — scaffold only.
 * All credentials come from environment (see .env.example). No real sends in
 * this module are possible without them; the function surface is fully shaped.
 */

export interface WhatsAppSendResult {
  messageId: string;
}

export function whatsappConfig() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error(
      "WhatsApp is not configured: set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID"
    );
  }
  return { token, phoneNumberId };
}

/** Send a plain text message to a WhatsApp number (E.164, digits only, no +). */
export async function sendWhatsAppText(
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  const { token, phoneNumberId } = whatsappConfig();
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  return { messageId: json.messages?.[0]?.id ?? "unknown" };
}
