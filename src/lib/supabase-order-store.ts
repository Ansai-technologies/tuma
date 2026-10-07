import type { Order, OrderStore, Notification, QueuedNotification } from "./orders.js";

interface StoredOrder {
  id: string;
  vendor_id: string;
  buyer_number: string;
  description: string;
  amount: number;
  recipient: string;
  state: Order["state"];
  attestation_id: string | null;
  last_reason_code: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredNotification {
  id: string;
  order_id: string;
  recipient: string;
  body: string;
}

export class SupabaseOrderStore implements OrderStore {
  constructor(private readonly url: string, private readonly serviceKey: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: "Bearer " + this.serviceKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Order store request failed: ${response.status}`);
    }
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<any> {
    return this.request(`rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  private fromRow(row: StoredOrder): Order {
    return {
      id: row.id,
      vendorId: row.vendor_id,
      buyerNumber: row.buyer_number,
      description: row.description,
      amount: row.amount,
      recipient: row.recipient,
      state: row.state,
      attestationId: row.attestation_id ?? undefined,
      lastReasonCode: row.last_reason_code ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRow(order: Order): StoredOrder {
    return {
      id: order.id,
      vendor_id: order.vendorId,
      buyer_number: order.buyerNumber,
      description: order.description,
      amount: order.amount,
      recipient: order.recipient,
      state: order.state,
      attestation_id: order.attestationId ?? null,
      last_reason_code: order.lastReasonCode ?? null,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }

  async get(id: string): Promise<Order | null> {
    const query = new URLSearchParams({ id: `eq.${id}`, select: "*" });
    const rows = (await this.request(`orders?${query}`)) as StoredOrder[];
    return rows[0] ? this.fromRow(rows[0]) : null;
  }

  async create(order: Order): Promise<boolean> {
    try {
      await this.request("orders", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(this.toRow(order)),
      });
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes(": 409")) return false;
      throw err;
    }
  }

  async save(order: Order): Promise<void> {
    await this.request("orders?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(this.toRow(order)),
    });
  }

  async findLatestOpenByBuyer(buyerNumber: string): Promise<Order | null> {
    const query = new URLSearchParams({
      buyer_number: `eq.${buyerNumber}`,
      state: "not.in.(verified,failed)",
      select: "*",
      order: "created_at.desc",
      limit: "1",
    });
    const rows = (await this.request(`orders?${query}`)) as StoredOrder[];
    return rows[0] ? this.fromRow(rows[0]) : null;
  }

  async associateCheckout(checkoutRequestId: string, orderId: string): Promise<void> {
    await this.request("stk_checkouts?on_conflict=checkout_request_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ checkout_request_id: checkoutRequestId, order_id: orderId }),
    });
  }

  async findByCheckout(checkoutRequestId: string): Promise<Order | null> {
    const query = new URLSearchParams({
      checkout_request_id: `eq.${checkoutRequestId}`,
      select: "order_id",
    });
    const rows = (await this.request(`stk_checkouts?${query}`)) as Array<{ order_id: string }>;
    return rows[0] ? this.get(rows[0].order_id) : null;
  }

  async claimEvent(eventId: string): Promise<boolean> {
    return (await this.rpc("claim_webhook_event", { p_event_id: eventId })) === true;
  }

  async completeEvent(eventId: string): Promise<void> {
    await this.request(`processed_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
  }

  async retryEvent(eventId: string): Promise<void> {
    await this.request(`processed_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "retryable", updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
  }

  async commitResolution(order: Order, sourceKey: string, notifications: Notification[]): Promise<void> {
    await this.rpc("commit_order_resolution", {
      p_order: this.toRow(order),
      p_source_key: sourceKey,
      p_notifications: notifications,
    });
  }

  async claimNotifications(orderId?: string): Promise<QueuedNotification[]> {
    const rows = (await this.rpc("claim_outbox_notifications", {
      p_order_id: orderId ?? null,
    })) as StoredNotification[];
    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      recipient: row.recipient,
      body: row.body,
    }));
  }

  async markNotificationSent(id: string): Promise<void> {
    await this.updateNotification(id, "sent");
  }

  async retryNotification(id: string): Promise<void> {
    await this.updateNotification(id, "pending");
  }

  private async updateNotification(id: string, status: "sent" | "pending"): Promise<void> {
    await this.request(`notification_outbox?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
  }
}

export function createOrderStore(): SupabaseOrderStore {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Order store is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return new SupabaseOrderStore(url.replace(/\/$/, ""), serviceKey);
}
