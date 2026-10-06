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
  InMemoryOrderStore,
  type Order,
  type OrderStore,
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
      await initiateStkPush({
        phoneNumber: order.buyerNumber,
        amount: order.amount,
        orderRef: order.id,
      });
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
    // Terminal outcomes are resolved here; PENDING_CALLBACK waits for the
    // attestation.completed webhook from the engine's C2B ingress.
    if (attestation.status !== "pending") {
      await this.resolveAttestation(order, attestation.reasonCode, attestation);
    }
  }

  /**
   * Idempotent attestation webhook handler (attestation.completed / .failed).
   * Safe to call with duplicate deliveries: the engine's eventId is the key.
   */
  async handleAttestationEvent(event: AttestationEvent): Promise<void> {
    const store = this.deps.store;
    if (await store.seenEvent(event.eventId)) return;
    await store.markEvent(event.eventId);

    const orderRef = event.attestation.evidence.orderRef as string | undefined;
    const order = orderRef ? await store.get(orderRef) : null;
    if (!order || isTerminal(order)) return;

    await this.resolveAttestation(order, event.attestation.reasonCode, event.attestation);
  }

  private async resolveAttestation(
    order: Order,
    reasonCode: string,
    attestation: { evidence: { amount?: number | unknown } }
  ): Promise<void> {
    const store = this.deps.store;
    if (reasonCode === "MATCHED") {
      await store.save(transition(order, "verified"));
      await this.send(order.buyerNumber, copy.buyerVerified(order.id));
      await this.send(order.vendorId, copy.vendorVerified(this.orderSummary(order)));
    } else {
      await store.save(transition(order, "failed"));
      const received = typeof attestation.evidence.amount === "number" ? attestation.evidence.amount : undefined;
      await this.send(order.buyerNumber, copy.buyerFailed(reasonCode, order.amount, received));
      await this.send(order.vendorId, copy.vendorFailed(order.id));
    }
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
    const store = this.deps.store;
    if (store instanceof InMemoryOrderStore) {
      const open = [...store.orders.values()]
        .filter((o) => o.buyerNumber === buyerNumber && !isTerminal(o))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return open[0] ?? null;
    }
    return null;
  }
}
