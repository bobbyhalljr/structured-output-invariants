type Line = { sku: string; quantity: number; unitCents: number };
type Invoice = { currency: "USD"; lines: Line[]; totalCents: number };
type Result = { ok: true; value: Invoice } | { ok: false; reason: string };
// Trusted application data, never supplied by the model.
const catalog = new Map([["widget", 1250], ["cable", 500]]);
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) =>
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const integer = (x: unknown, min: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= min;
export function validate(raw: string): Result {
  if (raw.length > 10000) return { ok: false, reason: "input_limit" };
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return { ok: false, reason: "invalid_json" }; }
  if (!object(x) || !exact(x, ["currency", "lines", "totalCents"]) ||
      x.currency !== "USD" || !integer(x.totalCents, 0) ||
      !Array.isArray(x.lines) || x.lines.length < 1 || x.lines.length > 100)
    return { ok: false, reason: "shape" };
  const lines: Line[] = [];
  const seen = new Set<string>();
  let computed = 0;
  for (const row of x.lines) {
    if (!object(row) || !exact(row, ["sku", "quantity", "unitCents"]) ||
        typeof row.sku !== "string" || !integer(row.quantity, 1) ||
        !integer(row.unitCents, 0)) return { ok: false, reason: "line_shape" };
    if (seen.has(row.sku)) return { ok: false, reason: "duplicate_sku" };
    seen.add(row.sku);
    const price = catalog.get(row.sku);
    if (price === undefined) return { ok: false, reason: "unknown_sku" };
    if (price !== row.unitCents) return { ok: false, reason: "price_mismatch" };
    const subtotal = row.quantity * price;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(computed + subtotal))
      return { ok: false, reason: "arithmetic_overflow" };
    computed += subtotal;
    lines.push({ sku: row.sku, quantity: row.quantity, unitCents: price });
  }
  if (computed !== x.totalCents) return { ok: false, reason: "total_mismatch" };
  // Copy only validated fields. A success result is data, not payment authorization.
  return { ok: true, value: { currency: "USD", lines, totalCents: computed } };
}
const good = { currency: "USD", lines: [{ sku: "widget", quantity: 2, unitCents: 1250 },
  { sku: "cable", quantity: 1, unitCents: 500 }], totalCents: 3000 };
const one = (line: unknown, totalCents = 1250) => ({ currency: "USD", lines: [line], totalCents });
const cases: [string, unknown, string][] = [
  ["valid", good, "accepted"],
  ["wrong total", { ...good, totalCents: 2999 }, "total_mismatch"],
  ["invented SKU", one({ sku: "ghost", quantity: 1, unitCents: 1250 }), "unknown_sku"],
  ["changed price", one({ sku: "widget", quantity: 1, unitCents: 1 }, 1), "price_mismatch"],
  ["duplicate SKU", { ...good, lines: [good.lines[0], good.lines[0]], totalCents: 5000 }, "duplicate_sku"],
  ["fractional quantity", one({ sku: "widget", quantity: 1.5, unitCents: 1250 }), "line_shape"],
  ["zero quantity", one({ sku: "widget", quantity: 0, unitCents: 1250 }), "line_shape"],
  ["string money", { ...good, totalCents: "3000" }, "shape"],
  ["wrong currency", { ...good, currency: "EUR" }, "shape"],
  ["extra root key", { ...good, dispatch: true }, "shape"],
  ["extra line key", one({ ...good.lines[0], discount: 1 }), "line_shape"],
  ["empty lines", { ...good, lines: [] }, "shape"],
  ["unsafe integer", { ...good, totalCents: 9007199254740992 }, "shape"],
  ["overflow", one({ sku: "widget", quantity: Number.MAX_SAFE_INTEGER, unitCents: 1250 }), "arithmetic_overflow"],
  ["null", null, "shape"],
  ["too many lines", { ...good, lines: Array(101).fill(good.lines[0]) }, "shape"]
];
let passed = 0;
function check(name: string, raw: string, expected: string) {
  const r = validate(raw); const actual = r.ok ? "accepted" : r.reason;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
  console.log(`${name}: ${actual}`); passed++;
}
for (const [name, value, expected] of cases) check(name, JSON.stringify(value), expected);
check("malformed JSON", "{", "invalid_json");
check("input limit", " ".repeat(10001), "input_limit");
console.log(`Checks passed: ${passed}/${passed}`);
