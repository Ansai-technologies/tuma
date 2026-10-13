import { describe, expect, it } from "vitest";
import { twiml } from "../src/lib/twiml.js";

// The reply is the bare quickstart shape: <Message>body</Message>, no
// attributes — a response message is a reply in the inbound conversation,
// so naming to/from adds nothing and risks the platform treating it as
// an originated message instead. (The 2026-10-13 silent replies turned
// out to be Twilio's un-activated sandbox, not this document — but the
// bare shape is the canonical one and stays.)
describe("twiml replies", () => {
  it("emits bare Message elements with no to/from attributes", () => {
    const xml = twiml([{ to: "254798435456", body: "Order confirmed." }]);
    expect(xml).toContain("<Message>");
    expect(xml).toContain("Order confirmed.");
    expect(xml).toContain("<Response>");
    expect(xml).not.toContain("to=");
    expect(xml).not.toContain("from=");
  });

  it("escapes XML in message bodies", () => {
    const xml = twiml([{ to: "254700000000", body: "a <b> & c" }]);
    expect(xml).toContain("a &lt;b&gt; &amp; c");
  });

  it("renders an empty response for no messages", () => {
    const xml = twiml([]);
    expect(xml).toContain("<Response>");
    expect(xml).not.toContain("<Message");
  });
});
