import { describe, expect, it } from "vitest";
import { allowlistPermits, callerIp, cidrContains } from "../src/lib/net.js";

describe("cidrContains", () => {
  it("matches exact IPs and CIDR ranges", () => {
    expect(cidrContains("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(cidrContains("1.2.3.4", "1.2.3.5")).toBe(false);
    expect(cidrContains("10.0.0.0/8", "10.1.2.3")).toBe(true);
    expect(cidrContains("10.0.0.0/8", "11.0.0.1")).toBe(false);
    expect(cidrContains("196.201.214.0/24", "196.201.214.37")).toBe(true);
    expect(cidrContains("196.201.214.0/24", "196.201.215.37")).toBe(false);
  });
  it("rejects malformed input without throwing", () => {
    expect(cidrContains("not-an-ip", "1.2.3.4")).toBe(false);
    expect(cidrContains("1.2.3.4/33", "1.2.3.4")).toBe(false);
    expect(cidrContains("1.2.3.4", "999.1.1.1")).toBe(false);
    expect(cidrContains("", "")).toBe(false);
  });
});

describe("allowlistPermits", () => {
  it("permits listed callers and denies everything else (fail closed)", () => {
    const list = "196.201.214.10, 10.0.0.0/8";
    expect(allowlistPermits(list, "196.201.214.10")).toBe(true);
    expect(allowlistPermits(list, "10.9.9.9")).toBe(true);
    expect(allowlistPermits(list, "8.8.8.8")).toBe(false);
    expect(allowlistPermits("", "10.9.9.9")).toBe(false);
  });
});

describe("callerIp", () => {
  it("prefers X-Forwarded-For and strips IPv4-mapped IPv6", () => {
    expect(callerIp({ headers: { "x-forwarded-for": "196.201.214.10, 10.0.0.1" } })).toBe(
      "196.201.214.10",
    );
    expect(callerIp({ headers: {}, socket: { remoteAddress: "::ffff:1.2.3.4" } })).toBe("1.2.3.4");
    expect(callerIp({})).toBe("");
  });
});
