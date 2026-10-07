/**
 * PaymentFlow — the Tuma payment-authentication orchestration.
 *
 * Buyer pays either by STK push (Daraja sandbox) or manually to the vendor's
 * till. Either way, the payment is attested by the Trust Engine (Track A) and
 * only a MATCHED attestation releases the goods.
 */
import { clientFor } from "./engine-client.js";
import { initiateStkPush, maskPhone } from "./daraja.js";
import { sendWhatsAppText } from "./whatsapp.js";
import { copy } from "./copy.js";
import type { TrustEngineClient, AttestationEvent } from "./trust-engine.js";
import {
  transition,
  isTerminal,
  type Order,
  type OrderStore,
  type Notification,
} from "./orders.js";

export interface PaymentFlowDeps {
  store: OrderStore;
  engine?: TrustEngineClient;
  /** Swappable sender: real WhatsApp in prod, capture sink in tests. */
  sender?: (to: string, body: string) => Promise<void>;
}

export class PaymentFlow {
  private engine: TrustEngineClient;
  private send: (to: string, body: string) => Promise<void>;

  constructor(private deps: PaymentFlowDeps) {
    this.engine = deps.engine ?? clientFor();
    this.send = deps.sender ?? (async (to, body) => {
      await sendWhatsAppText(to, body);
    });
  }

  private orderSummary(o: Order) {
    return { orderRef: o.id, description: o.description, amount: o.amount, till: o.recipient };
  }

  /** Vendor confirms an order in chat -> moves to awaiting_payment, buyer is asked how to pay. */
  async confirmOrder(order: Order): Promise<Order> {
    const moved = transition(order, "awaiting_payment");
    await this.deps.store.save(moved);
    await this.send(moved.buyerNumber, copy.orderConfirmed(this.orderSummary(moved)));
    return moved;
  }

  /** Buyer replied "1": dispatch STK push to their phone. */
  async startStkPayment(order: Order): Promise<void> {
    try {
      const result = await initiateStkPush({
        phoneNumber: order.buyerNumber,
        amount: order.amount,
        orderRef: order.id,
      });
      // The STK result callback correlates ONLY via CheckoutRequestID, so this
      // link must survive. Retry briefly: a lost link means a paid order whose
      // callback can never be matched ("unknown checkout", payment unattested).
      let linked = false;
      for (let attempt = 1; attempt <= 3 && !linked; attempt++) {
        try {
          await this.deps.store.associateCheckout(result.CheckoutRequestID, order.id);
          linked = true;
        } catch (err) {
          console.error(
            `associateCheckout attempt ${attempt}/3 failed (order ${order.id}, checkout ${result.CheckoutRequestID}):`,
            err,
          );
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!linked) {
        console.error(
          `STK checkout ${result.CheckoutRequestID} could not be linked to order ${order.id} — ` +
            `manual reconciliation required if the buyer completes the prompt.`,
        );
      }
      await this.send(order.buyerNumber, copy.stkSent(order.amount, maskPhone(order.buyerNumber)));
    } catch (err) {
      console.error("STK push failed:", err);
      await this.send(order.buyerNumber, copy.stkFailed());
    }
  }

  /** Buyer replied "2": send manual till-payment instructions. */
  async startManualPayment(order: Order): Promise<void> {
    await this.send(order.buyerNumber, copy.manualInstructions(order.amount, order.recipient));
  }

  /**
   * Buyer supplied a transaction code (typed or from the STK result callback).
   * Ask the Trust Engine to attest the payment against the order's expectations.
   */
  async submitTransactionCode(order: Order, transactionCode: string): Promise<void> {
    const attestation = await this.engine.createAttestation({
      type: "payment",
      subject: { kind: "person", id: order.buyerNumber },
      payment: {
        channel: "mpesa",
        transactionCode: transactionCode.trim(),
        expectedAmount: order.amount,
        expectedRecipient: order.recipient,
        orderRef: order.id,
      },
    });
    order.attestationId = attestation.id;
    order.lastReasonCode = attestation.reasonCode;
    await this.deps.store.save(order);
    const sourceKey = `attestation:${attestation.id}`;
    if (attestation.status === "pending") {
      await this.deps.store.commitResolution(order, sourceKey, [
        { recipient: order.buyerNumber, body: copy.buyerFailed("PENDING_CALLBACK", order.amount) },
      ]);
    } else {
      await this.resolveAttestation(order, attestation.reasonCode, attestation, sourceKey);
    }
    await this.flushOutbox(order.id);
  }

  /**
   * Idempotent attestation webhook handler (attestation.completed / .failed).
   * Safe to call with duplicate deliveries: the engine's eventId is the key.
   */
  async handleAttestationEvent(event: AttestationEvent): Promise<void> {
    const store = this.deps.store;
    if (!(await store.claimEvent(event.eventId))) return;
    try {
      const orderRef = event.attestation.evidence.orderRef as string | undefined;
      const order = orderRef ? await store.get(orderRef) : null;
      if (!order) throw new Error("Attestation event references an unknown order");
      if (!isTerminal(order)) {
        await this.resolveAttestation(
          order,
          event.attestation.reasonCode,
          event.attestation,
          `event:${event.eventId}`
        );
        await this.flushOutbox(order.id);
      }
      await store.completeEvent(event.eventId);
    } catch (err) {
      await store.retryEvent(event.eventId);
      throw err;
    }
  }

  private async resolveAttestation(
    order: Order,
    reasonCode: string,
    attestation: { id?: string; evidence: { amount?: number | unknown } },
    sourceKey: string
  ): Promise<void> {
    const store = this.deps.store;
    const resolved = { ...order, attestationId: attestation.id ?? order.attestationId, lastReasonCode: reasonCode };
    let updated: Order;
    let notifications: Notification[];
    if (reasonCode === "MATCHED") {
      updated = transition(resolved, "verified");
      notifications = [
        { recipient: order.buyerNumber, body: copy.buyerVerified(order.id) },
        { recipient: order.vendorId, body: copy.vendorVerified(this.orderSummary(order)) },
      ];
    } else {
      updated = { ...resolved, state: "awaiting_payment" };
      if (reasonCode === "PENDING_CALLBACK") {
        notifications = [
          { recipient: order.buyerNumber, body: copy.buyerFailed(reasonCode, order.amount) },
        ];
      } else {
        const received = typeof attestation.evidence.amount === "number" ? attestation.evidence.amount : undefined;
        notifications = [
          { recipient: order.buyerNumber, body: copy.buyerFailed(reasonCode, order.amount, received) },
          { recipient: order.vendorId, body: copy.vendorFailed(order.id) },
        ];
      }
    }
    await store.commitResolution(updated, sourceKey, notifications);
  }

  async flushOutbox(orderId?: string): Promise<void> {
    const notifications = await this.deps.store.claimNotifications(orderId);
    const failures: unknown[] = [];
    for (const notification of notifications) {
      try {
        await this.send(notification.recipient, notification.body);
        await this.deps.store.markNotificationSent(notification.id);
      } catch (err) {
        await this.deps.store.retryNotification(notification.id);
        failures.push(err);
      }
    }
    if (failures.length) throw failures[0];
  }

  /** Route a buyer's free-text reply while the order awaits payment. */
  async handleBuyerReply(order: Order, text: string): Promise<void> {
    const t = text.trim();
    if (t === "1") return this.startStkPayment(order);
    if (t === "2") return this.startManualPayment(order);
    // Looks like an M-Pesa transaction code (e.g. QHX7ABC123) — attest it.
    if (/^[A-Za-z0-9]{6,15}$/.test(t)) return this.submitTransactionCode(order, t);
    await this.send(order.buyerNumber, copy.unrecognized());
  }

  /** Latest non-terminal order for a buyer number (Supabase: indexed query). */
  async findOpenOrderFor(buyerNumber: string): Promise<Order | null> {
    return this.deps.store.findLatestOpenByBuyer(buyerNumber);
  }
}
