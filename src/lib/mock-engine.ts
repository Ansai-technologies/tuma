/**
 * In-process mock of the Trust Engine attestation infrastructure (Track A),
 * implementing the exact POST /attestations shapes from contract v0.1.
 *
 * Deterministic outcomes are driven by the transaction code prefix so the
 * Tuma flow is testable end-to-end without the real core:
 *   OK....     -> MATCHED            (status verified)
 *   AMT....    -> AMOUNT_MISMATCH    (status unverified)
 *   RCP....    -> RECIPIENT_MISMATCH (status unverified)
 *   STALE....  -> STALE              (status unverified)
 *   DUP....    -> DUPLICATE          (status unverified)
 *   PENDING... -> PENDING_CALLBACK   (status pending)
 *   anything else -> CODE_NOT_FOUND  (status unverified)
 *
 * Replace with Track A's real HTTP endpoint when it is live — no other
 * code changes required (see clientFor() in ./engine-client.ts).
 */
import { createHash } from "node:crypto";
import type {
  Attestation,
  CreateAttestationRequest,
  TrustEngineClient,
} from "./trust-engine.js";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function outcomeForCode(code: string): {
  status: Attestation["status"];
  reasonCode: string;
  amount?: number;
} {
  const c = code.trim().toUpperCase();
  if (c.startsWith("OK")) return { status: "verified", reasonCode: "MATCHED", amount: 2500 };
  if (c.startsWith("AMT")) return { status: "unverified", reasonCode: "AMOUNT_MISMATCH", amount: 2000 };
  if (c.startsWith("RCP")) return { status: "unverified", reasonCode: "RECIPIENT_MISMATCH", amount: 2500 };
  if (c.startsWith("STALE")) return { status: "unverified", reasonCode: "STALE", amount: 2500 };
  if (c.startsWith("DUP")) return { status: "unverified", reasonCode: "DUPLICATE", amount: 2500 };
  if (c.startsWith("PENDING")) return { status: "pending", reasonCode: "PENDING_CALLBACK", amount: 2500 };
  return { status: "unverified", reasonCode: "CODE_NOT_FOUND" };
}

export class MockTrustEngine implements TrustEngineClient {
  private attestations = new Map<string, Attestation>();
  private counter = 0;
  private prevHash = "genesis";

  async createAttestation(req: CreateAttestationRequest): Promise<Attestation> {
    const outcome = outcomeForCode(req.payment.transactionCode);
    const att: Attestation = {
      id: `att_mock_${++this.counter}`,
      type: "payment",
      status: outcome.status,
      reasonCode: outcome.reasonCode,
      reason:
        outcome.reasonCode === "MATCHED"
          ? `Transaction ${req.payment.transactionCode} matched: KSh ${req.payment.expectedAmount.toLocaleString("en-KE")} to Till ${req.payment.expectedRecipient}.`
          : `Transaction ${req.payment.transactionCode}: ${outcome.reasonCode.replace(/_/g, " ").toLowerCase()}.`,
      evidence: {
        transactionCode: req.payment.transactionCode,
        amount: outcome.amount,
        sender: "2547***123",
      },
      signedAt: new Date().toISOString(),
      signature: sha256Hex(`${this.counter}:mock-signature`),
      prevHash: this.prevHash,
      hash: "",
    };
    att.hash = sha256Hex(JSON.stringify({ ...att, hash: "" }));
    this.prevHash = att.hash;
    this.attestations.set(att.id, att);
    return att;
  }

  async getAttestation(id: string): Promise<Attestation | null> {
    return this.attestations.get(id) ?? null;
  }
}
