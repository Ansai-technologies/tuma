/**
 * WhatsApp sender — Meta Cloud API or Twilio, chosen by environment.
 *
 * Meta path (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID): the original
 * scaffold; live once his Meta account recovery lands.
 *
 * Twilio path (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM):
 * active when set — takes precedence. TWILIO_WHATSAPP_FROM looks like
 * "whatsapp:+17372508034" (sandbox or provisioned sender).
 *
 * All credentials come from environment (see .env.example).
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

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

/** Send via Twilio's Messages API (works with the WhatsApp sandbox). */
async function sendViaTwilio(
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  const cfg = twilioConfig();
  if (!cfg) throw new Error("Twilio is not configured");
  const { accountSid, authToken, from } = cfg;
  const credentials = Buffer.from(accountSid + ":" + authToken).toString("base64");
  const form = new URLSearchParams({
    From: from,
    To: "whatsapp:+" + to,
    Body: body,
  });
  const res = await fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Messages.json",
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + credentials,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { sid?: string };
  return { messageId: json.sid ?? "unknown" };
}

/** Send a plain text message to a WhatsApp number (E.164, digits only, no +). */
export async function sendWhatsAppText(
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  if (twilioConfig()) return sendViaTwilio(to, body);
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
