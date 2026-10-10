A model returns an invoice. The JSON parses. Every field has the right type. The total is still wrong.

Two widgets at 1,250 cents plus one cable at 500 cents should total 3,000 cents. The model says 2,999. A shape check can accept that response while your application loses a cent.

That is the boundary I want to build today: accept structured data only after the application checks the rules it owns.

## Three questions, three checks

1. **Can I parse it?** Valid JSON is a syntax property.
2. **Does it have the expected shape?** Allowed fields, types, ranges, and collection sizes are structural constraints.
3. **Does it agree with trusted application state?** Catalog membership, current prices, unique item references, and recomputed totals are business invariants.

![Three validation boundaries: parse, shape, invariants](https://raw.githubusercontent.com/bobbyhalljr/structured-output-invariants/main/images/pipeline.png)

[JSON Schema documents numeric constraints](https://json-schema.org/understanding-json-schema/reference/numeric) such as integer types and minimum values, and [object constraints](https://json-schema.org/understanding-json-schema/reference/object) such as required and additional properties. Those constraints are useful. In this invoice example, a conventional shape schema does not also fetch your current catalog or calculate the sum of quantity times price.

Put those checks in application code. This is a statement about the boundary we implement here, not a claim that every schema system has identical expressive limits.

Also, `JSON.parse(raw) as Invoice` does not validate anything at runtime. [TypeScript removes type assertions during compilation](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html). Start with `unknown`, inspect it, then construct validated data.

## Build the boundary in TypeScript

The complete runnable source, fixtures, diagrams, and exact output are in [structured-output-invariants on GitHub](https://github.com/bobbyhalljr/structured-output-invariants).

No API key. No model call. The fixture responses stand in for untrusted model output so the acceptance rules can be exercised deterministically.

Prerequisites: Node.js 22 or later with npm, plus network access for the first install. Tested with Node.js 22.20.0 and TypeScript 5.9.3.

```sh
git clone https://github.com/bobbyhalljr/structured-output-invariants.git
cd structured-output-invariants
npm ci
npm test
```

The trusted catalog lives in application code:

```ts
const catalog = new Map([
  ["widget", 1250],
  ["cable", 500],
]);
```

The model does not get to redefine prices by echoing a number. The input validator requires USD, exact root and line keys, one to 100 lines, positive safe integer quantities, and nonnegative safe integer cent values. It rejects unexpected fields rather than silently letting a future downstream consumer interpret them.

We also cap the input at 10,000 JavaScript string code units before parsing. That is a small local guard, not a byte limit or a complete network resource policy.

After the structural checks, each line passes through the semantic gate:

```ts
if (seen.has(row.sku))
  return { ok: false, reason: "duplicate_sku" };
seen.add(row.sku);

const price = catalog.get(row.sku);
if (price === undefined)
  return { ok: false, reason: "unknown_sku" };
if (price !== row.unitCents)
  return { ok: false, reason: "price_mismatch" };

const subtotal = row.quantity * price;
if (!Number.isSafeInteger(subtotal) ||
    !Number.isSafeInteger(computed + subtotal))
  return { ok: false, reason: "arithmetic_overflow" };
computed += subtotal;
```

Why check arithmetic as well as inputs? Two safe integers can produce a result outside JavaScript's safe integer range. The local example checks each multiplication and running sum before accepting them.

We use integer cents for this USD-only example. That keeps ordinary cent amounts out of floating point decimal arithmetic. It does not define a universal money format for every currency or pricing system.

The final boundary is explicit:

```ts
if (computed !== x.totalCents)
  return { ok: false, reason: "total_mismatch" };

return {
  ok: true,
  value: { currency: "USD", lines, totalCents: computed },
};
```

Success returns a new object made from validated fields. Failure returns a bounded reason code. Nothing dispatches a payment, sends an email, or writes an invoice.

![An accepted invoice totals 3000 cents; the same-shaped invoice claiming 2999 is rejected](https://raw.githubusercontent.com/bobbyhalljr/structured-output-invariants/main/images/invariants.png)

## Exact tested output

`npm test` compiles the committed TypeScript before running the cases. After the npm command headers, the program prints:

```text
valid: accepted
wrong total: total_mismatch
invented SKU: unknown_sku
changed price: price_mismatch
duplicate SKU: duplicate_sku
fractional quantity: line_shape
zero quantity: line_shape
string money: shape
wrong currency: shape
extra root key: shape
extra line key: line_shape
empty lines: shape
unsafe integer: shape
overflow: arithmetic_overflow
null: shape
too many lines: shape
malformed JSON: invalid_json
input limit: input_limit
Checks passed: 18/18
```

These are local fixture checks, not an accuracy score for an LLM. The runner throws if any acceptance or rejection reason differs from its expected result.

The most useful case is the wrong total: the object keeps the expected fields and types, but the semantic gate rejects it. The invented SKU and changed price cases show a different failure mode: model output can be internally consistent and still contradict trusted state.

## What this toy does not prove

This is an invoice-data tutorial, not production billing software. There is no tax, discount, currency conversion, shipping, refunds, or fractional quantity support. Rejecting duplicate SKUs is a deliberate simplification; a real invoice may allow separate lines for the same product.

The catalog is static. In production, tie validation and writes to a consistent catalog version or transaction so a price cannot change between checking and committing. Enforce tenant access when reading that catalog. Record the policy version and rejection reason without logging sensitive model payloads by default.

A successful result does not establish customer intent, authenticity of the source document, permission to purchase, or readiness to execute a side effect. Add authorization and idempotency at the execution boundary.

There is no automatic repair loop. If you ask a model to retry, bound the retries and run the same validator again. A second response is still untrusted input.

## The engineering takeaway

Structured output helps you consume a response. Application invariants decide whether that response is usable for a particular job.

Keep trusted facts outside the model payload. Recompute derived values. Make rejection visible. Then put a separate authorization boundary around the side effect.

That is the kind of boundary I care about while building [Roster](https://get-roster.com): AI employees that do real work need application-owned acceptance rules around the data they produce.

