/**
 * Vendor dashboard data endpoint.
 *   GET /api/vendor/orders?token=<DASHBOARD_TOKEN>[&vendor=<vendorId>]
 * Returns orders (newest first) with masked buyer numbers and queued
 * WhatsApp notifications, for the vendor dashboard screen.
 */
import type { VercelRequest, VercelResponse } from "../_types.js";
import { timingSafeEqual } from "node:crypto";

function authorized(req: VercelRequest): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return false;
  const q = req.query?.token;
  const supplied = typeof q === "string" ? q : "";
  const a = Buffer.from(token);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function mask(num: unknown): string {
  const s = String(num ?? "");
  if (s.length <= 6) return s;
  return s.slice(0, 4) + "..." + s.slice(-3);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Server not configured" });
  const headers = { apikey: key, Authorization: "Bearer " + key };
  const vq = req.query?.vendor;
  const vendor = typeof vq === "string" && vq ? vq : "";
  try {
    let orderQuery = "orders?select=*&order=created_at.desc&limit=100";
    if (vendor) orderQuery += "&vendor_id=eq." + encodeURIComponent(vendor);
    const or_ = await fetch(url + "/rest/v1/" + orderQuery, { headers });
    if (!or_.ok) throw new Error("orders fetch failed: " + or_.status);
    const orders = (await or_.json()) as any[];
    const ids = orders.map((o) => o.id).filter(Boolean);
    let notes: any[] = [];
    if (ids.length > 0) {
      const nq =
        "notification_outbox?select=order_id,recipient,body&order_id=in.(" +
        ids.map((id) => encodeURIComponent(String(id))).join(",") +
        ")";
      const nr = await fetch(url + "/rest/v1/" + nq, { headers });
      if (nr.ok) notes = (await nr.json()) as any[];
    }
    const byOrder: Record<string, any[]> = {};
    for (const n of notes) {
      const list = byOrder[n.order_id] || [];
      list.push({ recipient: mask(n.recipient), body: n.body });
      byOrder[n.order_id] = list;
    }
    res.status(200).json({
      orders: orders.map((o) => ({
        id: o.id,
        vendorId: o.vendor_id,
        buyerNumber: mask(o.buyer_number),
        description: o.description,
        amount: o.amount,
        recipient: o.recipient,
        state: o.state,
        attestationId: o.attestation_id ?? null,
        lastReasonCode: o.last_reason_code ?? null,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
        notifications: byOrder[o.id] || [],
      })),
    });
  } catch (err) {
    console.error("dashboard orders error:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
}
