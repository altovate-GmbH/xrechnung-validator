# xrechnung-validator

Official **XRechnung / EN 16931** validation in pure JavaScript. No Java, no external service.

It runs the same three checks as the KoSIT validator, the reference used by German public
administration: XML schema, EN 16931 Schematron and XRechnung CIUS Schematron, including KoSIT's
scenario rules and severity overrides. Works in **Node.js, Deno (Supabase Edge Functions) and Bun**.

```bash
npx xrechnung-validator invoice.xml
```

```
VALID    invoice.xml  (EN16931 XRechnung (UBL Invoice))
INVALID  other.xml  (1 rule error(s))
  [BR-DE-15] Das Element "Buyer reference" (BT-10) muss übermittelt werden.
```

> **Deutsch:** Prüft E-Rechnungen (XRechnung und EN 16931, UBL und CII) nach den offiziellen
> KoSIT-Regeln, direkt in JavaScript. Jede Version wird gegen den Java-Validator der KoSIT
> getestet: Regeln, Szenario und Urteil müssen übereinstimmen. Deutsche Kurzfassung unten.

## Why

From 1 January 2027, German companies above EUR 800,000 annual turnover must send e-invoices;
from 2028 all companies must. Anything that writes invoices needs to know before sending
whether the file passes. Until now, the official check required running the Java-based
KoSIT validator or calling a third-party service. This package removes that step.

## Same verdict as the official validator

Every release is checked against the KoSIT Java validator on all instances of the official
XRechnung test suite plus deliberately broken invoices (`test/fixtures`). The triggered rules
(code and level), the matched scenario and the final accept/reject verdict must be identical.

| | |
|---|---|
| Rules | KoSIT configuration v2026-08-31 (XRechnung 3.0.2, CEN rules 1.3.16) |
| Reference | KoSIT validator 1.6.3 |
| Test cases | 110, identical results in Node 24, Deno 2.9 and Bun 1.3 |
| Syntaxes | UBL Invoice, UBL CreditNote, UN/CEFACT CII |
| Specifications | XRechnung, XRechnung Extension, XRechnung CVD, plain EN 16931 |

## Install

```bash
npm install xrechnung-validator
```

Requires Node.js 18.17+ (or Deno 2 / Bun 1.1+). Package size about 0.7 MB.

## Usage

```js
import { validate } from "xrechnung-validator";

const result = await validate(xmlStringOrBytes);

result.valid;         // true = KoSIT verdict "accept"
result.scenario;      // "EN16931 XRechnung (UBL Invoice)", null if not an XRechnung / EN 16931 document
result.schemaErrors;  // [{ message, line }] XML schema errors (no Schematron run, as in KoSIT)
result.errors;        // [{ code: "BR-DE-15", level: "error", text, location }]
result.warnings;      // rules downgraded by KoSIT appear here (level vs. originalLevel)
result.messages;      // everything, including information
```

`valid` follows KoSIT exactly: a scenario must match (via the specification identifier, BT-24),
the XML schema must pass, and no rule may remain at level `error` after KoSIT's overrides.

### Supabase Edge Functions / Deno

```ts
import { validate } from "npm:xrechnung-validator";

Deno.serve(async (req) => Response.json(await validate(await req.text())));
```

Measured on a hosted Supabase Edge Function with a 420 KB invoice: 82 to 142 MB heap
(limit 256 MB), about 0.5 to 0.9 s CPU per validation (limit 2 s). **Validate one invoice per
request.** Ten large invoices in a single request exceed the CPU limit.

### CLI

```bash
npx xrechnung-validator *.xml            # exit code 1 if any file is invalid
npx xrechnung-validator invoice.xml --json
npx xrechnung-validator --version         # bundled rule version
```

Useful in CI: fail the build if a generated sample invoice no longer validates.

## Performance

First validation about 0.3 to 0.5 s (rules load once per process), then 50 to 200 ms per invoice
depending on size. Only the rules for the detected syntax (UBL or CII) are loaded.

## What this is not

- It checks the **XML**. It does not extract XML from ZUGFeRD / Factur-X PDFs (yet) and does
  not check PDF/A conformance.
- It is not tax advice. A valid result means the KoSIT rules pass, not that the invoice is
  correct in every respect.
- Browsers are not supported in 0.1. The npm build of SaxonJS targets Node.js.

## How it works

The official Schematron rules are already XSLT. At build time they are compiled with
[`xslt3`](https://www.npmjs.com/package/xslt3) to SaxonJS export files and gzip-compressed
(21 MB to 0.55 MB). At runtime [SaxonJS](https://www.saxonica.com/saxonjs/) executes them, and
[libxml2-wasm](https://github.com/jameslan/libxml2-wasm) handles the XML schema check.
Scenario selection and severity overrides are read from KoSIT's `scenarios.xml`.

## Updating to new KoSIT rules

```bash
# edit scripts/kosit.json (new tags), then:
npm run fetch:kosit -- --with-validator
npm run build:rules
JAVA=/path/to/java node scripts/make-expected.mjs   # new reference from the Java validator
npm run build && npm test
```

## Licenses

Code: Apache-2.0. Bundled rules keep their licenses: XRechnung rules (KoSIT) Apache-2.0,
EN 16931 rules (European Commission / CEN) EUPL-1.2. Details in [NOTICE](NOTICE).
SaxonJS is a dependency under the Saxonica license and is not bundled.

Not affiliated with KoSIT, CEN or Saxonica.

---

## Kurzfassung auf Deutsch

`xrechnung-validator` prüft XRechnung- und EN-16931-Rechnungen (UBL und CII) mit den
offiziellen KoSIT-Regeln: XML-Schema, EN-16931-Schematron, XRechnung-Schematron, dazu die
KoSIT-Szenarien und Herabstufungen. Das Urteil `valid` entspricht dem „accept" des
KoSIT-Validators. Jede Version wird mit dem Java-Validator abgeglichen.

Läuft in Node, Deno (auch Supabase Edge Functions) und Bun, ohne Java und ohne externen Dienst.
In Edge Functions eine Rechnung pro Aufruf prüfen (CPU-Grenze 2 s).

Keine Steuerberatung. Gebaut und gepflegt von [altovate](https://altovate.de).
