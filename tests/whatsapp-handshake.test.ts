import { beforeEach, describe, expect, it, vi } from "vitest";

// The handler module runs createOrderStore() at import time, which needs
// dummy Supabase env; WHATSAPP_VERIFY_TOKEN is toggled per test.
beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key";
  delete process.env.WHATSAPP_VERIFY_TOKEN;
});

async function loadHandler() {
  const mod = await import("../api/whatsapp.js");
  return mod.default as (req: any, res: any) => Promise<void>;
}

function fakeRes() {
  const sent: Array<{ code: number; body: unknown }> = [];
  const res = {
    status(code: number) {
      return {
        send(body: unknown) {
          sent.push({ code, body });
        },
        json(body: unknown) {
          sent.push({ code, body });
        },
      };
    },
  };
  return { res, sent };
}

function getReq(query: Record<string, string | undefined>): any {
  return {
    method: "GET",
    query,
    headers: {},
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true, value: undefined }) };
    },
  };
}

describe("whatsapp subscription handshake", () => {
  it("rejects the handshake when WHATSAPP_VERIFY_TOKEN is unset (fail closed)", async () => {
    const handler = await loadHandler();
    const { res, sent } = fakeRes();
    // No hub.verify_token at all: previously `undefined === undefined` accepted this.
    await handler(getReq({ "hub.mode": "subscribe", "hub.challenge": "abc" }), res);
    expect(sent).toEqual([{ code: 403, body: "Forbidden" }]);
  });

  it("accepts the handshake with the correct token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "secret-token";
    const handler = await loadHandler();
    const { res, sent } = fakeRes();
    await handler(
      getReq({ "hub.mode": "subscribe", "hub.verify_token": "secret-token", "hub.challenge": "abc" }),
      res,
    );
    expect(sent).toEqual([{ code: 200, body: "abc" }]);
  });

  it("rejects the handshake with the wrong token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "secret-token";
    const handler = await loadHandler();
    const { res, sent } = fakeRes();
    await handler(
      getReq({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "abc" }),
      res,
    );
    expect(sent).toEqual([{ code: 403, body: "Forbidden" }]);
  });
});
