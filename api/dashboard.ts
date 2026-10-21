/**
 * Vendor dashboard screen.
 *   GET /dashboard?token=<DASHBOARD_TOKEN>[&vendor=<vendorId>]
 * (served via vercel.json rewrite /dashboard -> /api/dashboard)
 *
 * Live view of orders: when the Trust Engine verifies a payment, the order
 * flips to "cleared for delivery" here with its details. Auto-refreshes.
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { timingSafeEqual } from "node:crypto";

function authorized(req: VercelRequest): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return false;
  const q = req.query?.token;
  const supplied = typeof q === "string" ? q : "";
  const a = Buffer.from(token);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PAGE_CSS = [
  ":root{color-scheme:light}",
  "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
  "background:#f4f6f8;color:#17222c;margin:0;padding:0}",
  "header{background:#17222c;color:#fff;padding:18px 24px;display:flex;",
  "align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}",
  "header h1{font-size:18px;margin:0;font-weight:600}",
  "header h1 .tuma{color:#22d3ee}",
  "#live{font-size:13px;color:#9fb3c8}",
  "#live .dot{display:inline-block;width:8px;height:8px;border-radius:50%;",
  "background:#34d399;margin-right:6px}",
  "main{max-width:960px;margin:0 auto;padding:20px 16px 60px}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}",
  ".card{background:#fff;border-radius:14px;padding:16px 18px;",
  "box-shadow:0 1px 3px rgba(16,24,40,.08);border:1px solid #e6eaef}",
  ".card .row{display:flex;justify-content:space-between;align-items:center;gap:8px}",
  ".card .oid{font-size:12px;color:#667085;font-weight:600;letter-spacing:.02em}",
  ".badge{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap}",
  ".b-open{background:#eef1f4;color:#475467}",
  ".b-await{background:#fef3e2;color:#b54708}",
  ".b-verified{background:#e6f9ef;color:#067647}",
  ".card h2{font-size:20px;margin:10px 0 2px}",
  ".card .amt{font-size:15px;color:#344054;margin:0 0 8px}",
  ".meta{font-size:13px;color:#667085;margin:2px 0}",
  ".banner{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:600}",
  ".banner.ok{background:#e6f9ef;color:#067647}",
  ".banner.wait{background:#fef3e2;color:#b54708}",
  "details{margin-top:10px;font-size:12.5px;color:#475467}",
  "details summary{cursor:pointer;font-weight:600;color:#344054}",
  ".kv{margin:6px 0;word-break:break-all}",
  ".kv b{color:#17222c}",
  ".wa{background:#f0f4ff;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12.5px}",
  ".wa .to{font-size:11px;color:#667085;margin-bottom:4px}",
  "#err{display:none;background:#fdecea;color:#b42318;border:1px solid #f5c6c0;",
  "border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px}",
  ".empty{color:#667085;text-align:center;padding:40px 0}",
].join("\n");

function pageHtml(token: string, vendor: string): string {
  const dataUrl =
    "/api/vendor/orders?token=" + encodeURIComponent(token) +
    (vendor ? "&vendor=" + encodeURIComponent(vendor) : "");
  const script = [
    "(function(){",
    "var DATA_URL = " + JSON.stringify(dataUrl) + ";",
    "var main = document.getElementById('orders');",
    "var live = document.getElementById('live');",
    "var err = document.getElementById('err');",
    "var openDetails = {};",
    "function el(tag, cls, text){",
    "  var e = document.createElement(tag);",
    "  if (cls) e.className = cls;",
    "  if (text != null) e.textContent = text;",
    "  return e;",
    "}",
    "function fmtTime(iso){",
    "  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }",
    "}",
    "function badge(state){",
    "  var b = el('span');",
    "  if (state === 'verified') { b.className = 'badge b-verified'; b.textContent = 'Cleared for delivery'; }",
    "  else if (state === 'awaiting_payment') { b.className = 'badge b-await'; b.textContent = 'Awaiting payment'; }",
    "  else { b.className = 'badge b-open'; b.textContent = state || 'Open'; }",
    "  return b;",
    "}",
    "function card(o){",
    "  var c = el('div', 'card');",
    "  var top = el('div', 'row');",
    "  top.appendChild(el('span', 'oid', o.id));",
    "  top.appendChild(badge(o.state));",
    "  c.appendChild(top);",
    "  c.appendChild(el('h2', null, o.description));",
    "  c.appendChild(el('p', 'amt', 'KSh ' + Number(o.amount).toLocaleString()));",
    "  c.appendChild(el('p', 'meta', 'Buyer: ' + o.buyerNumber + '  ·  Till: ' + o.recipient));",
    "  var banner = el('div');",
    "  if (o.state === 'verified') {",
    "    banner.className = 'banner ok';",
    "    banner.textContent = 'Payment verified — cleared for delivery.';",
    "  } else if (o.state === 'awaiting_payment') {",
    "    banner.className = 'banner wait';",
    "    banner.textContent = 'Waiting on M-Pesa confirmation — do not deliver yet.';",
    "  }",
    "  if (banner.className) c.appendChild(banner);",
    "  var det = el('details');",
    "  if (openDetails[o.id]) det.open = true;",
    "  det.addEventListener('toggle', function(){ openDetails[o.id] = det.open; });",
    "  det.appendChild(el('summary', null, 'Details'));",
    "  det.appendChild(el('p', 'kv', ''));",
    "  var kv = det.lastChild;",
    "  kv.appendChild(el('b', null, 'Attestation: '));",
    "  kv.appendChild(document.createTextNode(o.attestationId || '—'));",
    "  if (o.lastReasonCode) {",
    "    var kv2 = el('p', 'kv', '');",
    "    kv2.appendChild(el('b', null, 'Last check: '));",
    "    kv2.appendChild(document.createTextNode(o.lastReasonCode));",
    "    det.appendChild(kv2);",
    "  }",
    "  var kv3 = el('p', 'kv', '');",
    "  kv3.appendChild(el('b', null, 'Updated: '));",
    "  kv3.appendChild(document.createTextNode(fmtTime(o.updatedAt)));",
    "  det.appendChild(kv3);",
    "  if (o.notifications && o.notifications.length) {",
    "    det.appendChild(el('p', 'kv', ''));",
    "    det.lastChild.appendChild(el('b', null, 'WhatsApp messages queued:'));",
    "    o.notifications.forEach(function(n){",
    "      var w = el('div', 'wa');",
    "      w.appendChild(el('div', 'to', 'To ' + n.recipient));",
    "      w.appendChild(document.createTextNode(n.body));",
    "      det.appendChild(w);",
    "    });",
    "  }",
    "  c.appendChild(det);",
    "  return c;",
    "}",
    "function render(orders){",
    "  main.textContent = '';",
    "  if (!orders.length) {",
    "    main.appendChild(el('p', 'empty', 'No orders yet.')); return;",
    "  }",
    "  var g = el('div', 'grid');",
    "  orders.forEach(function(o){ g.appendChild(card(o)); });",
    "  main.appendChild(g);",
    "}",
    "function tick(){",
    "  fetch(DATA_URL).then(function(r){",
    "    if (!r.ok) throw new Error('HTTP ' + r.status);",
    "    return r.json();",
    "  }).then(function(d){",
    "    err.style.display = 'none';",
    "    render(d.orders || []);",
    "    live.innerHTML = '';",
    "    var dot = el('span', 'dot'); live.appendChild(dot);",
    "    live.appendChild(document.createTextNode('Live · updated ' + new Date().toLocaleTimeString()));",
    "  }).catch(function(e){",
    "    err.style.display = 'block';",
    "    err.textContent = 'Could not refresh orders (' + e.message + '). Retrying…';",
    "  });",
    "}",
    "tick();",
    "setInterval(tick, 5000);",
    "})();",
  ].join("\n");
  return (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Tuma · Vendor dashboard</title>" +
    "<link rel='icon' type='image/svg+xml' href='/favicon.svg'>" +
    "<style>" + PAGE_CSS + "</style></head><body>" +
    "<header><h1><span class='tuma'>Tuma</span> · Vendor dashboard</h1>" +
    "<span id='live'><span class='dot'></span>Connecting…</span></header>" +
    "<main><div id='err'></div><div id='orders'><p class='empty'>Loading orders…</p></div></main>" +
    "<script>" + script + "</scr" + "ipt>" +
    "</body></html>"
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  if (!authorized(req)) {
    return res
      .status(401)
      .send("Unauthorized. Open /dashboard?token=<DASHBOARD_TOKEN>.");
  }
  const q = req.query?.token;
  const token = typeof q === "string" ? q : "";
  const vq = req.query?.vendor;
  const vendor = typeof vq === "string" ? vq : "";
  const html = pageHtml(token, vendor);
  const r: any = res;
  if (typeof r.setHeader === "function") r.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
