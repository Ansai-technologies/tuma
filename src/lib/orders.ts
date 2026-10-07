/**
 * Order state machine for Tuma payment authentication.
 * open -> awaiting_payment -> verified | failed
 *
 * The store is an in-memory Map behind an OrderStore interface so Supabase
 * (orders + processed_webhook_events tables) can replace it without touching
 * the flow logic. All webhook handling is idempotent on the engine's eventId.
 */

export type OrderState = "open" | "awaiting_payment" | "verified" | "failed";

export interface Order {
  id: string; // orderRef, e.g. TUMA-1042
  vendorId: string; // vendor WhatsApp number (E.164, no +)
  buyerNumber: string; // buyer WhatsApp number (E.164, no +)
  description: string;
  amount: number; // KSh, whole shillings
  recipient: string; // vendor till / paybill number expected
  state: OrderState;
  attestationId?: string;
  lastReasonCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderStore {
  get(id: string): Promise<Order | null>;
  create(order: Order): Promise<boolean>;
  save(order: Order): Promise<void>;
  findLatestOpenByBuyer(buyerNumber: string): Promise<Order | null>;
  associateCheckout(checkoutRequestId: string, orderId: string): Promise<void>;
  findByCheckout(checkoutRequestId: string): Promise<Order | null>;
  claimEvent(eventId: string): Promise<boolean>;
  completeEvent(eventId: string): Promise<void>;
  retryEvent(eventId: string): Promise<void>;
  commitResolution(order: Order, sourceKey: string, notifications: Notification[]): Promise<void>;
  claimNotifications(orderId?: string): Promise<QueuedNotification[]>;
  markNotificationSent(id: string): Promise<void>;
  retryNotification(id: string): Promise<void>;
}

export interface Notification {
  recipient: string;
  body: string;
}

export interface QueuedNotification extends Notification {
  id: string;
  orderId: string;
}

export class InMemoryOrderStore implements OrderStore {
  orders = new Map<string, Order>();
  private checkouts = new Map<string, string>();
  private events = new Map<string, "processing" | "completed" | "retryable">();
  private notifications = new Map<string, QueuedNotification & {
    sourceKey: string;
    status: "pending" | "sending" | "sent";
  }>();

  async get(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }
  async create(order: Order): Promise<boolean> {
    if (this.orders.has(order.id)) return false;
    await this.save(order);
    return true;
  }
  async save(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order, updatedAt: new Date().toISOString() });
  }

  async findLatestOpenByBuyer(buyerNumber: string): Promise<Order | null> {
    return [...this.orders.values()]
      .filter((order) => order.buyerNumber === buyerNumber && !isTerminal(order))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  }

  async associateCheckout(checkoutRequestId: string, orderId: string): Promise<void> {
    this.checkouts.set(checkoutRequestId, orderId);
  }

  async findByCheckout(checkoutRequestId: string): Promise<Order | null> {
    const orderId = this.checkouts.get(checkoutRequestId);
    return orderId ? this.get(orderId) : null;
  }

  async claimEvent(eventId: string): Promise<boolean> {
    const status = this.events.get(eventId);
    if (status === "completed" || status === "processing") return false;
    this.events.set(eventId, "processing");
    return true;
  }

  async completeEvent(eventId: string): Promise<void> {
    this.events.set(eventId, "completed");
  }

  async retryEvent(eventId: string): Promise<void> {
    this.events.set(eventId, "retryable");
  }

  async commitResolution(order: Order, sourceKey: string, notifications: Notification[]): Promise<void> {
    this.orders.set(order.id, { ...order, updatedAt: new Date().toISOString() });
    notifications.forEach((notification, index) => {
      const id = `${sourceKey}:${index}`;
      if (!this.notifications.has(id)) {
        this.notifications.set(id, {
          ...notification,
          id,
          orderId: order.id,
          sourceKey,
          status: "pending",
        });
      }
    });
  }

  async claimNotifications(orderId?: string): Promise<QueuedNotification[]> {
    const claimed = [...this.notifications.values()].filter(
      (notification) =>
        notification.status === "pending" && (!orderId || notification.orderId === orderId)
    );
    claimed.forEach((notification) => {
      notification.status = "sending";
    });
    return claimed;
  }

  async markNotificationSent(id: string): Promise<void> {
    const notification = this.notifications.get(id);
    if (notification) notification.status = "sent";
  }

  async retryNotification(id: string): Promise<void> {
    const notification = this.notifications.get(id);
    if (notification) notification.status = "pending";
  }
}

const TERMINAL: OrderState[] = ["verified", "failed"];

export function canTransition(from: OrderState, to: OrderState): boolean {
  switch (from) {
    case "open":
      return to === "awaiting_payment";
    case "awaiting_payment":
      return to === "verified" || to === "failed";
    case "verified":
    case "failed":
      return false;
  }
}

/** Applies a transition, throwing if the move is illegal (protects terminal states). */
export function transition(order: Order, to: OrderState): Order {
  if (!canTransition(order.state, to)) {
    throw new Error(`Illegal order transition ${order.state} -> ${to}`);
  }
  return { ...order, state: to, updatedAt: new Date().toISOString() };
}

export function isTerminal(order: Order): boolean {
  return TERMINAL.includes(order.state);
}
