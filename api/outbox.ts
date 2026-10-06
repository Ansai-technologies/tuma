import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "./_types.js";
import { PaymentFlow } from "../src/lib/flow.js";
import { createOrderStore } from "../src/lib/supabase-order-store.js";

const store = createOrderStore();
const flow = new PaymentFlow({ store });

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers?.authorization;
  if (!secret || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  if (!authorized(req)) return res.status(401).send("Unauthorized");
  try {
    await flow.flushOutbox();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("outbox delivery error:", err);
    return res.status(500).json({ ok: false });
  }
}
