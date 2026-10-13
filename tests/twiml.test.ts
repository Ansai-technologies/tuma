import { describe, expect, it } from "vitest";
import { twiml } from "../src/lib/twiml.js";

// Regression guard for the 2026-10-13 silent-reply bug: the webhook ran,
// the order moved, but Twilio created NO outbound message from replies
// whose <Message> carried attributes — first to-only, then to+from
// (verified against the Twilio console message log). The reply must be
// the bare quickstart shape: <Message>body</Message>, no attributes.
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
