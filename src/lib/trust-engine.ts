/**
 * Shared shapes from the frozen Attestation API contract v0.1.
 * Product name: Trust Engine. Engineering name: attestation infrastructure.
 * Bridge noun "attestation" is identical everywhere.
 */

export type AttestationType = "identity" | "payment" | "record";

export type PaymentReasonCode =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "CODE_NOT_FOUND"
  | "STALE"
  | "DUPLICATE"
  | "PENDING_CALLBACK";

export type AttestationStatus = "verified" | "unverified" | "pending";

export interface PaymentInput {
  channel: "mpesa";
  transactionCode: string;
  expectedAmount: number;
  expectedRecipient: string;
  orderRef: string;
}

export interface CreateAttestationRequest {
  type: "payment";
  subject: { kind: "person" | "business" | "agent"; id: string };
  payment: PaymentInput;
}

export interface AttestationEvidence {
  transactionCode: string;
  amount?: number;
  sender?: string;
  [key: string]: unknown;
}

export interface Attestation {
  id: string;
  type: AttestationType;
  status: AttestationStatus;
  reasonCode: PaymentReasonCode | string;
  /** Human-readable reason: display-only, may change. reasonCode is the stable signal. */
  reason: string;
  evidence: AttestationEvidence;
  signedAt: string;
  signature: string;
  prevHash: string;
  hash: string;
}

export type AttestationEventType = "attestation.completed" | "attestation.failed";

export interface AttestationEvent {
  event: AttestationEventType;
  eventId: string;
  attestation: Attestation;
}

/**
 * Client interface over the Trust Engine (Track A). Implementations must honor
 * the exact request/response shapes above — the MockTrustEngine in
 * ./mock-engine.ts does, and the HttpTrustEngine swaps in when the real
 * core is reachable. Toggle with TRUST_ENGINE_MODE=mock|http.
 */
export interface TrustEngineClient {
  createAttestation(req: CreateAttestationRequest): Promise<Attestation>;
  getAttestation(id: string): Promise<Attestation | null>;
}
