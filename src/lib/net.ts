/**
 * Minimal IPv4 caller-allowlist helpers (no dependencies).
 * Used to authenticate Daraja result callbacks, which Safaricom does not sign.
 */
export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

/** True when `ip` falls inside `cidr` (bare IP = /32). Malformed input never matches. */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const baseInt = ipToInt(base);
  const ipInt = ipToInt(ip);
  if (baseInt === null || ipInt === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : ((~0 << (32 - bits)) >>> 0);
  return (baseInt & mask) === (ipInt & mask);
}

/** Comma-separated allowlist of IPs/CIDRs. Empty list permits nothing (fail closed). */
export function allowlistPermits(allowlist: string, ip: string): boolean {
  return allowlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => cidrContains(entry, ip));
}

export interface CallerInfo {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** Best-effort caller IP: X-Forwarded-For first (Vercel sits behind a proxy), then socket. */
export function callerIp(req: CallerInfo): string {
  const fwd = req.headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = (first ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}
