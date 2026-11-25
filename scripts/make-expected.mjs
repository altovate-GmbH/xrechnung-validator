// Erzeugt test/expected.json aus dem offiziellen KoSIT-Java-Validator (Referenz für die Paritätstests).
// Voraussetzung: node scripts/fetch-kosit.mjs --with-validator, Java 17+ (JAVA=/pfad/zu/java möglich)
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";

const pins = JSON.parse(readFileSync("scripts/kosit.json", "utf8"));
const JAVA = process.env.JAVA ?? "java";
const OUT = ".kosit/reports";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".xml") ? [join(d, e.name)] : []));
}
const files = [...walk(".kosit/testsuite/instances"), ...walk("test/fixtures")];
try {
  execFileSync(JAVA, ["-jar", `.kosit/${pins.validator.asset}`, "-s", ".kosit/config/scenarios.xml", "-r", ".kosit/config", "-o", OUT, ...files], { stdio: "ignore" });
} catch (e) {
  // KoSIT liefert als Exit-Code die Zahl abgelehnter Dateien; Berichte sind trotzdem vollständig
  if (typeof e.status !== "number" || e.status <= 0) throw e;
}

const expected = {};
for (const f of files) {
  const rep = readFileSync(join(OUT, basename(f, ".xml") + "-report.xml"), "utf8");
  expected[f] = {
    accept: /<rep:accept/.test(rep),
    scenario: /<rep:scenarioMatched><s:scenario><s:name>([^<]*)/.exec(rep)?.[1] ?? null,
    schemaError: /<rep:message id="val-xsd/.test(rep),
    // Regel|Level, wie die Regel sie meldet (customLevel wirkt erst im Urteil)
    messages: [...rep.matchAll(/<rep:message id="val-sch[^"]*" level="([^"]*)"[^>]*code="([^"]*)"/g)].map((m) => `${m[2]}|${m[1]}`).sort(),
  };
}
writeFileSync("test/expected.json", JSON.stringify({ validator: pins.validator.tag, configuration: pins.configuration.tag, files: expected }, null, 1));
console.log(`${files.length} Referenzergebnisse in test/expected.json`);
