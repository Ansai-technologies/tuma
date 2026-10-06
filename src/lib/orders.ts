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
  save(order: Order): Promise<void>;
  /** Returns true if this event was already processed (idempotency). */
  seenEvent(eventId: string): Promise<boolean>;
  markEvent(eventId: string): Promise<void>;
}

export class InMemoryOrderStore implements OrderStore {
  orders = new Map<string, Order>();
  private events = new Set<string>();

  async get(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }
  async save(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order, updatedAt: new Date().toISOString() });
  }
  async seenEvent(eventId: string): Promise<boolean> {
    return this.events.has(eventId);
  }
  async markEvent(eventId: string): Promise<void> {
    this.events.add(eventId);
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
