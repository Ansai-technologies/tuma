/**
 * Order intake endpoint for vendor tooling / field app.
 *   POST /api/orders  { id, vendorId, buyerNumber, description, amount, recipient }
 * Creates the order in "open" state. The vendor then sends CONFIRM <ref> in
 * WhatsApp to move it to awaiting_payment.
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { createOrderStore } from "../src/lib/supabase-order-store.js";
import { timingSafeEqual } from "node:crypto";

const store = createOrderStore();

function isAuthorizedVendor(req: VercelRequest, vendorId: string): boolean {
  const configured = process.env.VENDOR_API_TOKENS;
  const authorization = req.headers?.authorization;
  if (!configured || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  let tokens: Record<string, string>;
  try {
    tokens = JSON.parse(configured) as Record<string, string>;
  } catch {
    return false;
  }
  const expected = tokens[vendorId];
  const supplied = authorization.slice("Bearer ".length);
  if (typeof expected !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const { id, vendorId, buyerNumber, description, amount, recipient } = req.body ?? {};
  if (!id || !vendorId || !buyerNumber || !description || amount == null || !recipient) {
    return res.status(400).json({ error: "id, vendorId, buyerNumber, description, amount, recipient are required" });
  }
  const normalizedVendorId = String(vendorId);
  if (!isAuthorizedVendor(req, normalizedVendorId)) return res.status(401).send("Unauthorized");
  if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be a positive whole number" });
  }
  const normalizedId = String(id).toUpperCase();
  const now = new Date().toISOString();
  const order = {
    id: normalizedId,
    vendorId: normalizedVendorId,
    buyerNumber: String(buyerNumber),
    description: String(description),
    amount: Number(amount),
    recipient: String(recipient),
    state: "open" as const,
    createdAt: now,
    updatedAt: now,
  };
  if (!(await store.create(order))) return res.status(409).json({ error: "order already exists" });
  return res.status(201).json(order);
}
