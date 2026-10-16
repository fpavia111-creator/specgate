import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAutomation } from "../dist/src/agent.js";
import { scanTests } from "../dist/src/trace.js";
import { DEFAULT_CONFIG } from "../dist/src/config.js";
import { makeRepo, write } from "./helpers.js";
const T = "@" + "req";
// @req signoff/refuse-automation
test("automation check: piped stdout is fine, only stdin matters", () => {
    assert.deepEqual(detectAutomation({}, { isTTY: true }), []);
    assert.deepEqual(detectAutomation({}, { isTTY: true }, { isTTY: false }), []);
    assert.deepEqual(detectAutomation({}, { isTTY: false }), ["stdin is not a terminal"]);
});
// @req trace/tag-placement
test("tags count only in comments or test titles, not in strings", () => {
    const root = makeRepo();
    write(root, "test/a.test.js", [
        `// ${T} todos/due-date`,
        `it("a", () => {});`,
        `it("b [${T} todos/sorting]", () => {});`,
        `it("c", () => {}); // ${T} todos/due-date#invalid-date-rejected`,
        `write(root, "x", '// ${T} todos/fixture\\nit("d", () => {})');`,
        `const s = "${T} todos/in-string"; it("e", () => {});`,
        `  # ${T} todos/py-style`,
        `def test_f(): pass`,
    ].join("\n"));
    const refs = scanTests(root, DEFAULT_CONFIG).map((t) => `${t.refs[0]}=${t.name}`);
    assert.deepEqual(refs, ["todos/due-date=a", "todos/sorting=b [@req todos/sorting]", "todos/due-date#invalid-date-rejected=c", "todos/py-style=test_f"]);
});
