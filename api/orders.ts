/**
 * Order intake endpoint for vendor tooling / field app.
 *   POST /api/orders  { id, vendorId, buyerNumber, description, amount, recipient }
 * Creates the order in "open" state. The vendor then sends CONFIRM <ref> in
 * WhatsApp to move it to awaiting_payment.
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { InMemoryOrderStore } from "../src/lib/orders.js";

const store = new InMemoryOrderStore(); // TODO: shared store (Supabase)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const { id, vendorId, buyerNumber, description, amount, recipient } = req.body ?? {};
  if (!id || !vendorId || !buyerNumber || !description || !amount || !recipient) {
    return res.status(400).json({ error: "id, vendorId, buyerNumber, description, amount, recipient are required" });
  }
  const now = new Date().toISOString();
  const order = {
    id: String(id).toUpperCase(),
    vendorId: String(vendorId),
    buyerNumber: String(buyerNumber),
    description: String(description),
    amount: Number(amount),
    recipient: String(recipient),
    state: "open" as const,
    createdAt: now,
    updatedAt: now,
  };
  await store.save(order);
  return res.status(201).json(order);
}
