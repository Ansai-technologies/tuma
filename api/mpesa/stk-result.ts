/**
 * Daraja STK result callback (sandbox).
 *   POST /api/mpesa/stk-result
 * Daraja posts the buyer's PIN outcome here. On success we extract the
 * M-Pesa transaction code and hand it to the Trust Engine for attestation.
 */
import type { VercelRequest, VercelResponse } from "../_types.js";
import { PaymentFlow } from "../../src/lib/flow.js";
import { createOrderStore } from "../../src/lib/supabase-order-store.js";
import { allowlistPermits, callerIp } from "../../src/lib/net.js";

const store = createOrderStore();
const flow = new PaymentFlow({ store });

interface StkCallbackItem {
  Name: string;
  Value?: string | number;
}
interface StkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: { Item: StkCallbackItem[] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  // Daraja does not sign result callbacks, so the caller allowlist IS the
  // authentication. Fail closed: an empty/unset allowlist rejects everything
  // unless MPESA_CALLBACK_ALLOWLIST_BYPASS=true (sandbox/local testing only —
  // never in production). Denied caller IPs are logged so the real Safaricom
  // egress IPs can be allowlisted iteratively.
  const allowlist = process.env.MPESA_CALLBACK_ALLOWLIST ?? "";
  const bypass = process.env.MPESA_CALLBACK_ALLOWLIST_BYPASS === "true";
  const ip = callerIp(req);
  if (!bypass && !allowlistPermits(allowlist, ip)) {
    console.warn(`STK result callback denied for non-allowlisted caller ${ip || "(unknown)"}`);
    return res.status(403).send("Forbidden");
  }
  try {
    const cb = req.body?.Body?.stkCallback as StkCallback | undefined;
    if (!cb) return res.status(400).send("Bad payload");

    const items = cb.CallbackMetadata?.Item ?? [];
    const transactionCode = String(
      items.find((i) => i.Name === "MpesaReceiptNumber")?.Value ?? ""
    );

    if (cb.ResultCode !== 0 || !transactionCode) {
      console.log("STK unsuccessful or incomplete:", cb.ResultCode, cb.ResultDesc);
      return res.status(200).send("ok");
    }

    const order = await store.findByCheckout(cb.CheckoutRequestID);
    if (!order) {
      console.error("STK result for unknown checkout:", cb.CheckoutRequestID);
      return res.status(200).send("ok");
    }
    await flow.submitTransactionCode(order, transactionCode);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("stk-result error:", err);
    return res.status(200).send("ok");
  }
}
