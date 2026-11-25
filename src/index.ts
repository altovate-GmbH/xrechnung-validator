// xrechnung-validator: offizielle KoSIT-Prüfung (XSD + EN16931- und XRechnung-Schematron) in reinem JavaScript.
// Ablauf wie beim KoSIT-Validator: Szenario wählen -> XSD -> Schematron -> customLevel anwenden -> Urteil.
import SaxonJS from "saxon-js";
import {
  XmlBufferInputProvider,
  XmlDocument,
  XmlParseError,
  XmlValidateError,
  XsdValidator,
  xmlRegisterInputProvider,
} from "libxml2-wasm";

export type Level = "error" | "warning" | "information";
export type Syntax = "UBL-Invoice" | "UBL-CreditNote" | "CII";

export interface RuleMessage {
  /** Regel-ID, z. B. "BR-DE-15" */
  code: string;
  /** Wirksames Level nach den KoSIT-Herabstufungen (customLevel) */
  level: Level;
  /** Level, wie es die Regel selbst meldet */
  originalLevel: Level;
  /** Meldungstext aus der Regel */
  text: string;
  /** XPath der betroffenen Stelle */
  location?: string;
}

export interface SchemaError {
  message: string;
  line?: number;
}

export interface ValidationResult {
  /** true = KoSIT-Urteil "accept" */
  valid: boolean;
  wellFormed: boolean;
  syntax: Syntax | null;
  /** Name des KoSIT-Szenarios, null wenn keines passt */
  scenario: string | null;
  /** Fehler der XSD-Prüfung; bei XSD-Fehlern wird (wie bei KoSIT) kein Schematron geprüft */
  schemaErrors: SchemaError[];
  /** Alle Schematron-Meldungen */
  messages: RuleMessage[];
  errors: RuleMessage[];
  warnings: RuleMessage[];
  rules: { configuration: string; xrechnung: string };
}

export interface ValidateOptions {
  /**
   * Basis-URL des rules/-Ordners, falls die Regeldateien nicht neben dem Paket liegen
   * (z. B. bei eigenem CDN). Standard: rules/ im installierten Paket.
   */
  rulesUrl?: string | URL;
}

interface Scenario {
  name: string;
  root: "Invoice" | "CreditNote" | "CrossIndustryInvoice";
  customizationIds: string[];
  xsd: string;
  rulesets: string[];
  customLevels: Record<string, Level>;
}

interface ScenarioFile {
  configuration: string;
  xrechnung: string;
  scenarios: Scenario[];
}

// Namensräume der drei Wurzelelemente
const ROOT_NS: Record<Scenario["root"], string> = {
  Invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  CreditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  CrossIndustryInvoice: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
};
const SYNTAX: Record<Scenario["root"], Syntax> = {
  Invoice: "UBL-Invoice",
  CreditNote: "UBL-CreditNote",
  CrossIndustryInvoice: "CII",
};
const NS = {
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  rsm: ROOT_NS.CrossIndustryInvoice,
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
};
// Pfad der Spezifikationskennung je Syntax (BT-24)
const ID_XPATH: Record<Scenario["root"], string> = {
  Invoice: "/*/cbc:CustomizationID",
  CreditNote: "/*/cbc:CustomizationID",
  CrossIndustryInvoice: "/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID",
};
// Präfix für die im Speicher abgelegten XSD-Dateien
const XSD_SCHEME = "xrechnung-validator:/";
// Schematron-Flags auf KoSIT-Level abbilden (KoSIT behandelt "fatal" als Fehler)
const FLAG_LEVEL: Record<string, Level> = { fatal: "error", error: "error", warning: "warning", information: "information" };

const DEFAULT_RULES_URL = new URL("../rules/", import.meta.url);

// --- Laden der Regeldateien (Node, Bun, Deno, Browser) ------------------------

async function readAsset(base: URL, name: string): Promise<Uint8Array> {
  const url = new URL(name, base);
  const isDeno = "Deno" in globalThis;
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (url.protocol === "file:" && !isDeno && proc?.versions?.node) {
    // Node und Bun: fetch kann keine file:-URLs
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`xrechnung-validator: Regeldatei nicht ladbar: ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

// Caches pro Regel-URL: bleiben im Prozess/Isolat erhalten, Folgeprüfungen sind dadurch schnell
interface RuleCache {
  scenarios: Promise<ScenarioFile>;
  sef: Map<string, Promise<unknown>>;
  xsd: Promise<Record<string, string>> | null;
  validators: Map<string, XsdValidator>;
}
const caches = new Map<string, RuleCache>();
let providerRegistered = false;

function cacheFor(base: URL): RuleCache {
  const key = base.href;
  let c = caches.get(key);
  if (!c) {
    c = {
      scenarios: readAsset(base, "scenarios.json").then((b) => JSON.parse(new TextDecoder().decode(b)) as ScenarioFile),
      sef: new Map(),
      xsd: null,
      validators: new Map(),
    };
    caches.set(key, c);
  }
  return c;
}

function loadSef(base: URL, c: RuleCache, name: string): Promise<unknown> {
  let p = c.sef.get(name);
  if (!p) {
    p = readAsset(base, `${name}.sef.json.gz`).then(gunzipText).then((t) => JSON.parse(t));
    c.sef.set(name, p);
  }
  return p;
}

async function xsdValidator(base: URL, c: RuleCache, rel: string): Promise<XsdValidator> {
  const cached = c.validators.get(rel);
  if (cached) return cached;
  c.xsd ??= readAsset(base, "xsd.json.gz").then(gunzipText).then((t) => JSON.parse(t));
  const files = await c.xsd;
  if (!providerRegistered) {
    const enc = new TextEncoder();
    const buffers: Record<string, Uint8Array> = {};
    for (const [path, text] of Object.entries(files)) buffers[XSD_SCHEME + path] = enc.encode(text);
    xmlRegisterInputProvider(new XmlBufferInputProvider(buffers));
    providerRegistered = true;
  }
  const schemaDoc = XmlDocument.fromString(files[rel], { url: XSD_SCHEME + rel });
  const v = XsdValidator.fromDoc(schemaDoc);
  c.validators.set(rel, v);
  return v;
}

// --- Auswertung der Schematron-Ausgabe (SVRL) ---------------------------------

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m,
  );
}
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : undefined;
}

function parseSvrl(svrl: string, customLevels: Record<string, Level>): RuleMessage[] {
  const out: RuleMessage[] = [];
  for (const m of svrl.matchAll(/<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\1>/g)) {
    const code = attr(m[2], "id") ?? "";
    const originalLevel = FLAG_LEVEL[attr(m[2], "flag") ?? "error"] ?? "error";
    // Viele Regeltexte beginnen mit "[CODE]"; das steht schon in code
    const raw = decode(/<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(m[3])?.[1] ?? "").trim();
    const text = raw.startsWith(`[${code}]`) ? raw.slice(code.length + 2).trim() : raw;
    out.push({ code, level: customLevels[code] ?? originalLevel, originalLevel, text, location: attr(m[2], "location") });
  }
  return out;
}

// --- Öffentliche API -----------------------------------------------------------

/**
 * Prüft eine E-Rechnung (XRechnung oder EN 16931, UBL oder CII) nach den offiziellen KoSIT-Regeln.
 * Ergebnis entspricht dem Urteil des KoSIT-Validators ("accept" = valid).
 */
export async function validate(xml: string | Uint8Array, options: ValidateOptions = {}): Promise<ValidationResult> {
  const base = options.rulesUrl ? new URL(options.rulesUrl) : DEFAULT_RULES_URL;
  const c = cacheFor(base);
  const meta = await c.scenarios;
  const text = typeof xml === "string" ? xml : new TextDecoder().decode(xml);
  const result: ValidationResult = {
    valid: false,
    wellFormed: true,
    syntax: null,
    scenario: null,
    schemaErrors: [],
    messages: [],
    errors: [],
    warnings: [],
    rules: { configuration: meta.configuration, xrechnung: meta.xrechnung },
  };

  let doc: XmlDocument;
  try {
    doc = XmlDocument.fromString(text);
  } catch (e) {
    if (e instanceof XmlParseError) {
      result.wellFormed = false;
      result.schemaErrors = (e.details ?? []).map((d) => ({ message: d.message.trim(), line: d.line }));
      if (!result.schemaErrors.length) result.schemaErrors.push({ message: e.message });
      return result;
    }
    throw e;
  }

  try {
    // Szenario wie KoSIT: Wurzelelement + exakte Spezifikationskennung, erstes passendes gewinnt
    const root = doc.root;
    const rootName = (Object.keys(ROOT_NS) as Scenario["root"][]).find(
      (r) => root.name === r && root.namespaceUri === ROOT_NS[r],
    );
    if (!rootName) return result;
    result.syntax = SYNTAX[rootName];
    const ids = doc.find(ID_XPATH[rootName], NS).map((n) => n.content);
    const scenario = meta.scenarios.find((s) => s.root === rootName && ids.some((id) => s.customizationIds.includes(id)));
    if (!scenario) return result;
    result.scenario = scenario.name;

    // XSD
    const xsd = await xsdValidator(base, c, scenario.xsd);
    try {
      xsd.validate(doc);
    } catch (e) {
      if (e instanceof XmlValidateError) {
        result.schemaErrors = (e.details ?? []).map((d) => ({ message: d.message.trim(), line: d.line }));
        if (!result.schemaErrors.length) result.schemaErrors.push({ message: e.message });
        return result;
      }
      throw e;
    }
  } finally {
    doc.dispose();
  }

  // Schematron (nur die Regelsätze dieses Szenarios werden geladen)
  const scenario = meta.scenarios.find((s) => s.name === result.scenario)!;
  const sefs = await Promise.all(scenario.rulesets.map((r) => loadSef(base, c, r)));
  for (const sef of sefs) {
    const out = SaxonJS.transform(
      { stylesheetInternal: sef, sourceText: text, destination: "serialized" },
      "sync",
    ).principalResult as string;
    result.messages.push(...parseSvrl(out, scenario.customLevels));
  }
  result.errors = result.messages.filter((m) => m.level === "error");
  result.warnings = result.messages.filter((m) => m.level === "warning");
  result.valid = result.errors.length === 0;
  return result;
}

/** Version der gebündelten KoSIT-Regeln */
export async function rulesVersion(options: ValidateOptions = {}): Promise<{ configuration: string; xrechnung: string }> {
  const meta = await cacheFor(options.rulesUrl ? new URL(options.rulesUrl) : DEFAULT_RULES_URL).scenarios;
  return { configuration: meta.configuration, xrechnung: meta.xrechnung };
}
