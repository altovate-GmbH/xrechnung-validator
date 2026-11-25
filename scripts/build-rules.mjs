// Baut rules/ aus der KoSIT-Konfiguration in .kosit/config:
// - Schematron-XSLT -> SaxonJS-SEF, gzip-komprimiert
// - benötigte XSDs als ein gzip-JSON-Bündel
// - Szenarien (CustomizationID, Wurzelelement, Regelsätze, customLevel) als JSON
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, dirname, basename } from "node:path";

const CONFIG = ".kosit/config";
const OUT = "rules";
const pins = JSON.parse(readFileSync("scripts/kosit.json", "utf8"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// --- Szenarien -------------------------------------------------------------
const scenariosXml = readFileSync(join(CONFIG, "scenarios.xml"), "utf8");
const scenarios = [...scenariosXml.matchAll(/<scenario>([\s\S]*?)<\/scenario>/g)].map(([, s]) => {
  const match = /<match>([\s\S]*?)<\/match>/.exec(s)[1];
  return {
    name: /<name>([^<]*)<\/name>/.exec(s)[1].trim(),
    root: /\/\w+:(Invoice|CreditNote|CrossIndustryInvoice)\b/.exec(match)?.[1],
    customizationIds: [...match.matchAll(/'([^']+)'/g)].map((m) => m[1]),
    xsd: /<validateWithXmlSchema>[\s\S]*?<location>([^<]+)<\/location>/.exec(s)[1].trim(),
    schematron: [...s.matchAll(/<validateWithSchematron>[\s\S]*?<location>([^<]+)<\/location>/g)].map((m) => basename(m[1].trim(), ".xsl")),
    customLevels: Object.fromEntries([...s.matchAll(/<customLevel level="(\w+)">([^<]+)<\/customLevel>/g)].map((m) => [m[2].trim(), m[1]])),
  };
});
for (const sc of scenarios) if (!sc.root || !sc.customizationIds.length) throw new Error(`Szenario nicht lesbar: ${sc.name}`);
console.log(`${scenarios.length} Szenarien`);

// --- Schematron -> SEF (gzip) ------------------------------------------------
const xslFiles = [...new Set(scenarios.flatMap((s) => s.schematron))];
const xslPaths = Object.fromEntries(
  [...scenariosXml.matchAll(/<validateWithSchematron>[\s\S]*?<location>([^<]+)<\/location>/g)].map((m) => [basename(m[1].trim(), ".xsl"), m[1].trim()]),
);
// Korrekturen für SaxonJS-Rechenfehler. SaxonJS rechnet "xs:integer(...) mod 97" bei Zahlen über
// 2^53 falsch (Genauigkeitsverlust); xs:decimal rechnet exakt. Betroffen ist nur die IBAN-Prüfung
// xr:checkIBAN (BR-DE-19, BR-DE-20), deren Zahl 20 bis 40 Stellen hat. Jede Ersetzung muss genau
// einmal greifen, sonst bricht der Build ab (neue KoSIT-Version prüfen).
const PATCHES = {
  "XRechnung-UBL-validation": [IBAN_PATCH()],
  "XRechnung-CII-validation": [IBAN_PATCH()],
};
function IBAN_PATCH() {
  return {
    reason: "xr:checkIBAN: xs:integer -> xs:decimal (SaxonJS mod 97 ungenau über 2^53)",
    from: "xs:integer(string-join(for $cp in string-to-codepoints(concat(substring($normalizedIban,5)",
    to: "xs:decimal(string-join(for $cp in string-to-codepoints(concat(substring($normalizedIban,5)",
  };
}

function sourceFor(name) {
  const original = join(CONFIG, xslPaths[name]);
  const patches = PATCHES[name];
  if (!patches) return original;
  let text = readFileSync(original, "utf8");
  for (const p of patches) {
    const count = text.split(p.from).length - 1;
    if (count !== 1) throw new Error(`${name}: Korrektur "${p.reason}" greift ${count}-mal statt einmal`);
    text = text.replace(p.from, p.to);
    console.log(`${name}: ${p.reason}`);
  }
  // Neben dem Original ablegen, damit relative Verweise gleich bleiben
  const patched = original.replace(/\.xsl$/, ".patched.xsl");
  writeFileSync(patched, text);
  return patched;
}

for (const name of xslFiles) {
  const tmp = join(OUT, `${name}.sef.json`);
  execFileSync("npx", ["xslt3", `-xsl:${sourceFor(name)}`, `-export:${tmp}`, "-nogo", "-relocate:on"], { stdio: "inherit" });
  const raw = readFileSync(tmp);
  writeFileSync(`${tmp}.gz`, gzipSync(raw, { level: 9 }));
  rmSync(tmp);
  console.log(`${name}: ${(raw.length / 1048576).toFixed(1)} MB -> ${(statSync(`${tmp}.gz`).size / 1024).toFixed(0)} KB`);
}

// --- XSD-Bündel: Haupt-XSDs der Szenarien plus alle Includes/Imports --------
const xsd = {};
function addXsd(rel) {
  if (xsd[rel] !== undefined) return;
  const text = readFileSync(join(CONFIG, rel), "utf8");
  xsd[rel] = text;
  for (const m of text.matchAll(/<xsd?:(?:include|import)\b[^>]*schemaLocation="([^"]+)"/g)) {
    addXsd(relative(CONFIG, join(CONFIG, dirname(rel), m[1])));
  }
}
for (const sc of scenarios) addXsd(sc.xsd);
writeFileSync(join(OUT, "xsd.json.gz"), gzipSync(JSON.stringify(xsd), { level: 9 }));
console.log(`XSD: ${Object.keys(xsd).length} Dateien -> ${(statSync(join(OUT, "xsd.json.gz")).size / 1024).toFixed(0)} KB`);

// --- Metadaten ---------------------------------------------------------------
writeFileSync(join(OUT, "scenarios.json"), JSON.stringify({
  configuration: pins.configuration.tag,
  xrechnung: pins.configuration.xrechnung,
  scenarios: scenarios.map(({ schematron, ...rest }) => ({ ...rest, rulesets: schematron })),
}, null, 1));
console.log("rules/ fertig");
