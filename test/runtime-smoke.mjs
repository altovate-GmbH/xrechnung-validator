// Kurztest für andere Laufzeiten (Deno, Bun): gleiche Urteile wie die Java-Referenz?
import { readFileSync } from "node:fs";
import { validate } from "../dist/index.js";
const expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8")).files;
let ok = 0, bad = [];
const t = performance.now();
for (const [file, exp] of Object.entries(expected)) {
  const r = await validate(readFileSync(file));
  const same = r.valid === exp.accept && r.scenario === exp.scenario && JSON.stringify(r.messages.map((m) => `${m.code}|${m.originalLevel}`).sort()) === JSON.stringify(exp.messages);
  same ? ok++ : bad.push(file);
}
console.log(`${ok}/${Object.keys(expected).length} identisch in ${Math.round(performance.now() - t)} ms`, bad);
if (bad.length) process.exit(1);
