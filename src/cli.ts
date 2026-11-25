#!/usr/bin/env node
// CLI: xrechnung-validator <datei.xml> [...] [--json] [--quiet]
// Exit-Code 0 = alle gültig, 1 = mindestens eine ungültig, 2 = Aufruffehler
import { readFile } from "node:fs/promises";
import { validate, rulesVersion, type ValidationResult } from "./index.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const quiet = args.includes("--quiet");
const files = args.filter((a) => !a.startsWith("--"));

if (args.includes("--version") || args.includes("-v")) {
  const r = await rulesVersion();
  console.log(`xrechnung-validator rules: KoSIT configuration ${r.configuration}, XRechnung ${r.xrechnung}`);
  process.exit(0);
}
if (!files.length || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: xrechnung-validator <invoice.xml> [...] [--json] [--quiet]

Validates e-invoices (XRechnung, EN 16931; UBL and CII) against the official
KoSIT rules: XML schema, EN 16931 schematron and XRechnung CIUS schematron.

  --json     print results as JSON
  --quiet    print only invalid files
  --version  print the bundled rule version

Exit code: 0 all valid, 1 at least one invalid, 2 usage error`);
  process.exit(files.length ? 0 : 2);
}

function printHuman(file: string, r: ValidationResult) {
  if (r.valid) {
    if (!quiet) console.log(`VALID    ${file}  (${r.scenario}${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ""})`);
    return;
  }
  const reason = !r.wellFormed ? "not well-formed XML" : !r.syntax ? "not a UBL or CII invoice" : !r.scenario ? "no matching XRechnung/EN 16931 specification identifier (BT-24)" : r.schemaErrors.length ? "XML schema errors" : `${r.errors.length} rule error(s)`;
  console.log(`INVALID  ${file}  (${reason})`);
  for (const e of r.schemaErrors) console.log(`  schema${e.line ? ` line ${e.line}` : ""}: ${e.message}`);
  for (const e of r.errors) console.log(`  [${e.code}] ${e.text}`);
}

let anyInvalid = false;
const all: Record<string, ValidationResult> = {};
for (const f of files) {
  let r: ValidationResult;
  try {
    r = await validate(await readFile(f));
  } catch (e) {
    console.error(`ERROR    ${f}: ${(e as Error).message}`);
    process.exit(2);
  }
  anyInvalid ||= !r.valid;
  if (json) all[f] = r;
  else printHuman(f, r);
}
if (json) console.log(JSON.stringify(all, null, 2));
process.exit(anyInvalid ? 1 : 0);
