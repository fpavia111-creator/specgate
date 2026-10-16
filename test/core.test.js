import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, junit, makeRepo, write } from "./helpers.js";
const T = "@" + "req";
const TESTS = `// ${T} todos/due-date#invalid-date-rejected
it("rejects an invalid due date", () => {});
// ${T} todos/sorting
it("sorts by due date", () => {});
`;
// @req gate/coverage-gate
// @req gate/plan-requires-sign-off
// @req signoff/sign-off-record
// @req reports/traceability-record
test("core flow: new, validate, approve, plan, check passes and writes the record", async () => {
    const root = makeRepo();
    assert.equal((await cli(root, ["validate", "add-due-dates"])).code, 0);
    assert.equal((await cli(root, ["plan", "add-due-dates"])).code, 2, "plan refused before sign-off");
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 1);
    const ap = await cli(root, ["approve", "add-due-dates", "--role", "Product owner"]);
    assert.equal(ap.code, 0, ap.err);
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 0);
    assert.equal((await cli(root, ["plan", "add-due-dates"])).code, 0);
    write(root, "test/todos.test.js", TESTS);
    write(root, "reports/junit.xml", junit('<testcase name="rejects an invalid due date" classname="test"/><testcase name="sorts by due date" classname="test"/>'));
    const r = await cli(root, ["check", "add-due-dates", "--junit", "reports/junit.xml", "--write"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASS {2}change add-due-dates: 2\/2 requirements verified, sign-off approved/);
    const rec = JSON.parse(readFileSync(join(root, "openspec/changes/add-due-dates/traceability.json"), "utf8"));
    assert.equal(rec.passed, true);
    assert.equal(rec.approval.approvers[0].email, "lead@x.com");
    assert.ok(existsSync(join(root, "openspec/changes/add-due-dates/traceability.md")));
});
// @req signoff/stale-on-change
test("editing the spec after sign-off makes it stale and fails the gate", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    appendFileSync(join(root, "openspec/changes/add-due-dates/proposal.md"), "More.\n");
    const s = await cli(root, ["status", "add-due-dates"]);
    assert.equal(s.code, 1);
    assert.match(s.out, /stale/);
});
// @req gate/valid-specs
test("new scaffolds a change whose TODOs block validation and approval", async () => {
    const root = makeRepo();
    assert.equal((await cli(root, ["new", "add-tags", "--capability", "todos"])).code, 0);
    const v = await cli(root, ["validate", "add-tags"]);
    assert.equal(v.code, 1);
    assert.match(v.out, /TODO placeholder/);
    assert.match((await cli(root, ["approve", "add-tags"])).err, /problem/);
});
// @req gate/coverage-gate
test("failing and missing tests fail the gate", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/todos.test.js", TESTS);
    write(root, "j.xml", junit('<testcase name="rejects an invalid due date" classname="test"><failure message="x"/></testcase>'));
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Failing: todos\/due-date/);
    assert.match(r.out, /Not run: no test for todos\/sorting/);
});
// @req gate/plan-requires-sign-off
test("bug 4: generated plan names the real specgate:tdd skill", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    await cli(root, ["plan", "add-due-dates"]);
    const plan = readFileSync(join(root, "openspec/changes/add-due-dates/plan.md"), "utf8");
    assert.match(plan, /specgate:tdd /);
    assert.doesNotMatch(plan, /tdd-from-spec/);
    assert.ok(existsSync(new URL("../skills/tdd/SKILL.md", import.meta.url)));
});
