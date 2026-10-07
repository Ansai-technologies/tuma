import { describe, it, expect } from "vitest";
import { PaymentFlow } from "../src/lib/flow.js";
import { InMemoryOrderStore, transition, canTransition, type Order } from "../src/lib/orders.js";
import { MockTrustEngine } from "../src/lib/mock-engine.js";
import { copy } from "../src/lib/copy.js";

function makeOrder(partial: Partial<Order> = {}): Order {
  const now = new Date().toISOString();
  return {
    id: "TUMA-1042",
    vendorId: "254700111222",
    buyerNumber: "254712345678",
    description: "2x kikoi blankets",
    amount: 2500,
    recipient: "567890",
    state: "open",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("state machine", () => {
  it("allows open -> awaiting_payment -> verified", () => {
    let o = makeOrder();
    o = transition(o, "awaiting_payment");
    expect(o.state).toBe("awaiting_payment");
    o = transition(o, "verified");
    expect(o.state).toBe("verified");
  });
  it("rejects transitions out of terminal states", () => {
    const o = makeOrder({ state: "verified" });
    expect(() => transition(o, "awaiting_payment")).toThrow();
  });
  it("rejects skipping awaiting_payment", () => {
    expect(canTransition("open", "verified")).toBe(false);
  });
});

describe("mock trust engine contract shapes", () => {
  it("returns attestation with all contract fields", async () => {
    const engine = new MockTrustEngine();
    const att = await engine.createAttestation({
      type: "payment",
      subject: { kind: "person", id: "254712345678" },
      payment: {
        channel: "mpesa",
        transactionCode: "OK12345678",
        expectedAmount: 2500,
        expectedRecipient: "567890",
        orderRef: "TUMA-1042",
      },
    });
    expect(att.status).toBe("verified");
    expect(att.reasonCode).toBe("MATCHED");
    expect(att.hash).toBeTruthy();
    expect(att.prevHash).toBeTruthy();
    expect(att.signature).toBeTruthy();
    expect(att.evidence.transactionCode).toBe("OK12345678");
  });
  it("hash chain advances", async () => {
    const engine = new MockTrustEngine();
    const a = await engine.createAttestation({ type: "payment", subject: { kind: "person", id: "x" }, payment: { channel: "mpesa", transactionCode: "OK1", expectedAmount: 1, expectedRecipient: "1", orderRef: "O1" } });
    const b = await engine.createAttestation({ type: "payment", subject: { kind: "person", id: "x" }, payment: { channel: "mpesa", transactionCode: "OK2", expectedAmount: 1, expectedRecipient: "1", orderRef: "O2" } });
    expect(b.prevHash).toBe(a.hash);
  });
});

describe("payment flow", () => {
  function setup() {
    const store = new InMemoryOrderStore();
    const sent: Array<{ to: string; body: string }> = [];
    const flow = new PaymentFlow({
      store,
      engine: new MockTrustEngine(),
      sender: async (to, body) => {
        sent.push({ to, body });
      },
    });
    return { store, sent, flow };
  }

  it("full happy path: confirm -> code -> MATCHED -> verified, both parties messaged", async () => {
    const { store, sent, flow } = setup();
    const order = makeOrder();
    await store.save(order);

    const confirmed = await flow.confirmOrder(makeOrder());
    expect(confirmed.state).toBe("awaiting_payment");
    expect(sent.some((m) => m.to === "254712345678" && m.body.includes("TUMA-1042"))).toBe(true);

    const stored = await store.get("TUMA-1042");
    await flow.submitTransactionCode(stored!, "OK12345678");

    const done = await store.get("TUMA-1042");
    expect(done!.state).toBe("verified");
    expect(sent.some((m) => m.to === "254712345678" && m.body.includes("Payment verified"))).toBe(true);
    expect(sent.some((m) => m.to === "254700111222" && m.body.includes("release the goods"))).toBe(true);
  });

  it("amount mismatch -> failed with clear next-step message", async () => {
    const { store, sent, flow } = setup();
    await store.save(makeOrder({ state: "awaiting_payment" }));
    const stored = await store.get("TUMA-1042");
    await flow.submitTransactionCode(stored!, "AMT12345678");

    const done = await store.get("TUMA-1042");
    expect(done!.state).toBe("awaiting_payment");
    const buyer = sent.find((m) => m.to === "254712345678");
    expect(buyer!.body).toContain("KSh 2,000");
    expect(buyer!.body).toContain("KSh 2,500");
    expect(buyer!.body).not.toContain("AMOUNT_MISMATCH");
  });

  it("pending callback acknowledges the buyer without closing the order", async () => {
    const { store, sent, flow } = setup();
    await store.save(makeOrder({ state: "awaiting_payment" }));
    const stored = await store.get("TUMA-1042");
    await flow.submitTransactionCode(stored!, "PENDING123456");

    expect((await store.get("TUMA-1042"))!.state).toBe("awaiting_payment");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("waiting for confirmation from M-Pesa");
  });

  it("attestation webhook is idempotent on duplicate eventId", async () => {
    const { store, sent, flow } = setup();
    await store.save(makeOrder({ state: "awaiting_payment" }));
    const event = {
      event: "attestation.completed" as const,
      eventId: "evt_1",
      attestation: {
        id: "att_1",
        type: "payment" as const,
        status: "verified" as const,
        reasonCode: "MATCHED",
        reason: "ok",
        evidence: { transactionCode: "OK1", orderRef: "TUMA-1042" },
        signedAt: new Date().toISOString(),
        signature: "s",
        prevHash: "p",
        hash: "h",
      },
    };
    await flow.handleAttestationEvent(event);
    await flow.handleAttestationEvent(event); // duplicate delivery
    const buyerMsgs = sent.filter((m) => m.to === "254712345678");
    expect(buyerMsgs).toHaveLength(1);
    const done = await store.get("TUMA-1042");
    expect(done!.state).toBe("verified");
  });

  it("retries failed notification delivery independently", async () => {
    const store = new InMemoryOrderStore();
    const sent: Array<{ to: string; body: string }> = [];
    let failVendorOnce = true;
    const flow = new PaymentFlow({
      store,
      engine: new MockTrustEngine(),
      sender: async (to, body) => {
        if (to === "254700111222" && failVendorOnce) {
          failVendorOnce = false;
          throw new Error("temporary send failure");
        }
        sent.push({ to, body });
      },
    });
    await store.save(makeOrder({ state: "awaiting_payment" }));
    const event = {
      event: "attestation.completed" as const,
      eventId: "evt_retry",
      attestation: {
        id: "att_retry",
        type: "payment" as const,
        status: "verified" as const,
        reasonCode: "MATCHED",
        reason: "ok",
        evidence: { transactionCode: "OK1", orderRef: "TUMA-1042" },
        signedAt: new Date().toISOString(),
        signature: "s",
        prevHash: "p",
        hash: "h",
      },
    };

    await expect(flow.handleAttestationEvent(event)).rejects.toThrow("temporary send failure");
    await flow.handleAttestationEvent(event);
    await flow.flushOutbox();

    expect(sent.filter((message) => message.to === "254712345678")).toHaveLength(1);
    expect(sent.filter((message) => message.to === "254700111222")).toHaveLength(1);
  });

  it("buyer reply routing: 1 = STK, 2 = manual, code = attest", async () => {
    const { store, sent, flow } = setup();
    const o1 = makeOrder({ id: "TUMA-1", state: "awaiting_payment" });
    await store.save(o1);
    // "2" path does not need Daraja
    await flow.handleBuyerReply(o1, "2");
    expect(sent.some((m) => m.body.includes("till 567890"))).toBe(true);
    // code path
    await flow.handleBuyerReply(o1, "OK99999999");
    const done = await store.get("TUMA-1");
    expect(done!.state).toBe("verified");
  });

  it("looks up the latest open order and correlates STK checkout IDs", async () => {
    const store = new InMemoryOrderStore();
    const older = makeOrder({ id: "TUMA-1", createdAt: "2025-01-01T00:00:00.000Z" });
    const newer = makeOrder({ id: "TUMA-2", createdAt: "2025-01-02T00:00:00.000Z" });
    await store.save(older);
    await store.save(newer);
    await store.associateCheckout("ws_CO_1", newer.id);

    expect((await store.findLatestOpenByBuyer(newer.buyerNumber))?.id).toBe(newer.id);
    expect((await store.findByCheckout("ws_CO_1"))?.id).toBe(newer.id);
  });
});

describe("copy guardrails", () => {
  it("no Swahili or Sheng in user-facing copy", () => {
    const samples = [
      copy.orderConfirmed({ orderRef: "T-1", description: "x", amount: 100, till: "1" }),
      copy.stkSent(100, "0712***678"),
      copy.manualInstructions(100, "1"),
      copy.buyerVerified("T-1"),
      copy.vendorVerified({ orderRef: "T-1", description: "x", amount: 100, till: "1" }),
      ...["AMOUNT_MISMATCH", "RECIPIENT_MISMATCH", "CODE_NOT_FOUND", "STALE", "DUPLICATE", "PENDING_CALLBACK", "OTHER"].map((c) =>
        copy.buyerFailed(c, 2500, 2000)
      ),
      copy.vendorFailed("T-1"),
      copy.unrecognized(),
    ];
    const forbidden = /\b(karibu|asante|sawa|poa|niaje|mambo|shwari|lipa pesa)\b/i;
    for (const s of samples) expect(s).not.toMatch(forbidden);
    for (const s of samples) expect(s).not.toContain("Sheng");
  });
  it("machine reasonCodes never leak into buyer messages", () => {
    expect(copy.buyerFailed("AMOUNT_MISMATCH", 2500, 2000)).not.toContain("AMOUNT_MISMATCH");
  });
});
