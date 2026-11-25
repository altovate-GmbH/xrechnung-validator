// Paritätstest: jedes Ergebnis muss dem offiziellen KoSIT-Java-Validator entsprechen.
// Testrechnungen: KoSIT-Testsuite (.kosit/, per npm run fetch:kosit) + test/fixtures (absichtlich fehlerhaft).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { validate } from "../dist/index.js";

const expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const files = Object.keys(expected.files);

test("Testsuite vorhanden", () => {
  assert.ok(existsSync(".kosit/testsuite"), "Erst npm run fetch:kosit ausführen");
});

for (const file of files) {
  test(file, async () => {
    const exp = expected.files[file];
    const r = await validate(readFileSync(file));
    assert.equal(r.scenario, exp.scenario, "Szenario");
    assert.equal(r.schemaErrors.length > 0, exp.schemaError, "XSD-Urteil");
    assert.deepEqual(r.messages.map((m) => `${m.code}|${m.originalLevel}`).sort(), exp.messages, "Regelmeldungen");
    assert.equal(r.valid, exp.accept, "Gesamturteil");
  });
}
