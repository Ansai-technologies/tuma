import { describe, expect, it } from "vitest";
import { twiml } from "../src/lib/twiml.js";

// Regression guard for the 2026-10-13 silent-reply bug: the webhook ran,
// the order moved, but Twilio dropped every reply because <Message>
// named a "to" without a "from".
describe("twiml replies", () => {
  it("names both to and from on every message", () => {
    const xml = twiml(
      [{ to: "254798435456", body: "Order confirmed." }],
      "whatsapp:+17372508034",
    );
    expect(xml).toContain('<Message to="whatsapp:+254798435456" from="whatsapp:+17372508034">');
    expect(xml).toContain("Order confirmed.");
    expect(xml).toContain("<Response>");
  });

  it("escapes XML in message bodies", () => {
    const xml = twiml([{ to: "254700000000", body: "a <b> & c" }], "whatsapp:+17372508034");
    expect(xml).toContain("a &lt;b&gt; &amp; c");
  });

  it("renders an empty response for no messages", () => {
    const xml = twiml([], "whatsapp:+17372508034");
    expect(xml).toContain("<Response>");
    expect(xml).not.toContain("<Message");
  });
});
