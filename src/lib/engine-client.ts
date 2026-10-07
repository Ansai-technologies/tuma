/**
 * Trust Engine client factory. Reads TRUST_ENGINE_MODE:
 *   mock  -> in-process MockTrustEngine (default; Track A not yet deployed)
 *   http  -> HttpTrustEngine against TRUST_ENGINE_BASE_URL
 * The switch is config-only: both honor the frozen contract shapes.
 */
import type { Attestation, CreateAttestationRequest, TrustEngineClient } from "./trust-engine.js";
import { MockTrustEngine } from "./mock-engine.js";

class HttpTrustEngine implements TrustEngineClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  async createAttestation(req: CreateAttestationRequest): Promise<Attestation> {
    const res = await fetch(`${this.baseUrl}/attestations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Trust Engine error ${res.status}`);
    return (await res.json()) as Attestation;
  }

  async getAttestation(id: string): Promise<Attestation | null> {
    const res = await fetch(`${this.baseUrl}/attestations/${id}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Trust Engine error ${res.status}`);
    return (await res.json()) as Attestation;
  }
}

export function clientFor(): TrustEngineClient {
  const mode = (process.env.TRUST_ENGINE_MODE ?? "mock").toLowerCase();
  if (mode === "http") {
    const baseUrl = process.env.TRUST_ENGINE_BASE_URL;
    const apiKey = process.env.TRUST_ENGINE_API_KEY ?? "";
    if (!baseUrl) throw new Error("TRUST_ENGINE_BASE_URL is required when TRUST_ENGINE_MODE=http");
    return new HttpTrustEngine(baseUrl, apiKey);
  }
  return new MockTrustEngine();
}
