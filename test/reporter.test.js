import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseJUnit } from "../dist/src/trace.js";
import { cli, makeRepo, write } from "./helpers.js";
const REPORTER = fileURLToPath(new URL("../dist/src/reporter.js", import.meta.url));
const T = "@" + "req";
function runNodeTests(root, files) {
    mkdirSync(join(root, "reports"), { recursive: true });
    // A nested node --test must not think it is a child of this test run.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test", `--test-reporter=${REPORTER}`, "--test-reporter-destination=reports/junit.xml", ...files], { cwd: root, encoding: "utf8", env });
    return { ...r, xml: readFileSync(join(root, "reports/junit.xml"), "utf8") };
}
// @req trace/node-test-reporter
test("node:test reporter records file, line and suites for every test", () => {
    const root = makeRepo();
    write(root, "test/a.test.mjs", 'import {describe,it} from "node:test";\ndescribe("grp", () => {\n  it("works", () => {});\n  it.skip("later", () => {});\n});\nit("fails & <breaks>", () => { throw new Error("x"); });\n');
    const r = runNodeTests(root, ["test/a.test.mjs"]);
    assert.equal(r.status, 1);
    const cases = parseJUnit(r.xml);
    const byName = Object.fromEntries(cases.map((c) => [c.name, c]));
    assert.equal(byName.works.file, "test/a.test.mjs");
    assert.equal(byName.works.line, 3);
    assert.deepEqual(byName.works.suites, ["test/a.test.mjs", "grp"]);
    assert.equal(byName.later.result, "skipped");
    assert.equal(byName["fails & <breaks>"].result, "failed");
});
// @req trace/node-test-reporter
test("node:test reporter closes the ambiguity gap for same-named tests in different files", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/a.test.mjs", `import {it} from "node:test";\n// ${T} todos/due-date\nit("works", () => {});\n// ${T} todos/sorting\nit("sorts", () => {});\n`);
    write(root, "test/b.test.mjs", 'import {it} from "node:test";\nit("works", () => { throw new Error("other file"); });\n');
    runNodeTests(root, ["test/a.test.mjs", "test/b.test.mjs"]);
    const c = await cli(root, ["check", "add-due-dates", "--junit", "reports/junit.xml"]);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /PASS {2}change add-due-dates: 2\/2/);
});
// @req trace/node-test-reporter
test("node:test reporter pins the right test by line when names repeat in one file", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/a.test.mjs", `import {describe,it} from "node:test";\ndescribe("x", () => { it("works", () => { throw new Error("no"); }); });\n// ${T} todos/due-date\nit("works", () => {});\n// ${T} todos/sorting\nit("sorts", () => {});\n`);
    runNodeTests(root, ["test/a.test.mjs"]);
    const c = await cli(root, ["check", "add-due-dates", "--junit", "reports/junit.xml"]);
    assert.equal(c.code, 0, c.out);
});
