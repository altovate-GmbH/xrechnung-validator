// Lädt die gepinnten KoSIT-Releases nach .kosit/ (Konfiguration, Testsuite, optional Java-Validator).
// Aufruf: node scripts/fetch-kosit.mjs [--with-validator]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const pins = JSON.parse(readFileSync(new URL("./kosit.json", import.meta.url), "utf8"));
const DIR = ".kosit";
mkdirSync(DIR, { recursive: true });

function fetchAsset({ repo, tag, asset }, unzipTo) {
  const file = `${DIR}/${asset}`;
  if (!existsSync(file)) {
    const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
    console.log(`lade ${url}`);
    execFileSync("curl", ["-sSfL", "-o", file, url], { stdio: "inherit" });
  }
  if (unzipTo && !existsSync(unzipTo)) {
    mkdirSync(unzipTo, { recursive: true });
    execFileSync("unzip", ["-qo", file, "-d", unzipTo], { stdio: "inherit" });
  }
}

fetchAsset(pins.configuration, `${DIR}/config`);
fetchAsset(pins.testsuite, `${DIR}/testsuite`);
if (process.argv.includes("--with-validator")) fetchAsset(pins.validator);
console.log("KoSIT-Dateien bereit in .kosit/");
