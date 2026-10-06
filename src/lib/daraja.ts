/**
 * Daraja (Safaricom) sandbox STK push — sandbox only, per the hard limits.
 * Credentials arrive via environment (see .env.example); nothing is hardcoded.
 *
 * Flow: initiateStkPush() -> buyer's phone shows PIN prompt -> Daraja posts the
 * result to /api/mpesa/stk-result -> Tuma asks the Trust Engine to attest the
 * payment (transactionCode from the STK result) -> attestation events drive
 * the buyer/vendor messages.
 */

interface DarajaTokenResponse {
  access_token: string;
  expires_in: string;
}

async function darajaToken(): Promise<string> {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("Daraja is not configured: set DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET");
  const creds = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${creds}` } }
  );
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const json = (await res.json()) as DarajaTokenResponse;
  return json.access_token;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export interface StkPushParams {
  phoneNumber: string; // E.164 digits, e.g. 254712345678
  amount: number; // KSh whole shillings
  orderRef: string; // becomes the AccountReference in Daraja
}

export interface StkPushResult {
  CheckoutRequestID: string;
  MerchantRequestID: string;
}

/** Dispatch an STK push to the buyer's phone (Daraja SANDBOX only). */
export async function initiateStkPush({ phoneNumber, amount, orderRef }: StkPushParams): Promise<StkPushResult> {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callbackUrl = process.env.DARAJA_STK_CALLBACK_URL;
  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error("Daraja is not configured: set DARAJA_SHORTCODE, DARAJA_PASSKEY, DARAJA_STK_CALLBACK_URL");
  }
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
  const token = await darajaToken();
  const res = await fetch("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: orderRef,
      TransactionDesc: `Tuma order ${orderRef}`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Daraja STK push failed ${res.status}: ${detail}`);
  }
  const result = (await res.json()) as Partial<StkPushResult>;
  if (!result.CheckoutRequestID || !result.MerchantRequestID) {
    throw new Error("Daraja STK push response did not include request IDs");
  }
  return {
    CheckoutRequestID: result.CheckoutRequestID,
    MerchantRequestID: result.MerchantRequestID,
  };
}

/** Mask a phone number for messages, e.g. 254712345678 -> 0712***678. */
export function maskPhone(phoneNumber: string): string {
  const local = phoneNumber.startsWith("254") ? `0${phoneNumber.slice(3)}` : phoneNumber;
  if (local.length < 7) return "***";
  return `${local.slice(0, 4)}***${local.slice(-3)}`;
}
