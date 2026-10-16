import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { codeDrift, lineDiff } from "../dist/src/drift.js";
import { loadConfig } from "../dist/src/config.js";
import { SPEC, cli, git, makeRepo, write } from "./helpers.js";
const SPEC_FILE = "openspec/changes/add-due-dates/specs/todos/spec.md";
// @req drift/requirement-drift
test("drift: sign-off stores a per-requirement snapshot", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    const a = JSON.parse(readFileSync(join(root, "openspec/changes/add-due-dates/approvals.json"), "utf8")).approvals[0];
    assert.deepEqual(Object.keys(a.snapshot.requirements).sort(), ["todos/due-date", "todos/sorting"]);
    assert.match(a.snapshot.requirements["todos/due-date"], /SHALL store a due date/);
    assert.match(a.snapshot.proposal, /Users miss deadlines/);
});
// @req drift/requirement-drift
test("drift: changed, added and removed requirements are reported with a diff", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    const edited = SPEC.replace("SHALL sort todos by due date", "SHALL sort todos by priority")
        .replace("### Requirement: Due date\nThe system SHALL store a due date on a todo.\n\n#### Scenario: Invalid date rejected\n- **WHEN** a todo is saved with an invalid date\n- **THEN** it is rejected\n\n", "")
        + "\n### Requirement: Tags\nThe system SHALL let users tag todos.\n\n#### Scenario: Tagged\n- **WHEN** a tag is added\n- **THEN** it is shown\n";
    writeFileSync(join(root, SPEC_FILE), edited);
    const d = await cli(root, ["drift", "add-due-dates"]);
    assert.equal(d.code, 1);
    assert.match(d.out, /Changed: todos\/sorting/);
    assert.match(d.out, /- The system SHALL sort todos by due date\./);
    assert.match(d.out, /\+ The system SHALL sort todos by priority\./);
    assert.match(d.out, /Added: todos\/tags/);
    assert.match(d.out, /Removed: todos\/due-date/);
    const c = await cli(root, ["check", "add-due-dates"]);
    assert.equal(c.code, 1);
    assert.match(c.out, /Drift: todos\/sorting changed after sign-off by lead@x.com/);
    assert.match(c.out, /Drift: todos\/tags was added after sign-off/);
    assert.match(c.out, /Drift: todos\/due-date was removed after sign-off/);
    await cli(root, ["check", "add-due-dates", "--write"]);
    assert.match(readFileSync(join(root, "openspec/changes/add-due-dates/traceability.md"), "utf8"), /## Drift since sign-off[\s\S]*```diff/);
});
// @req drift/requirement-drift
test("drift: no drift after approval; 0.2 approvals without a snapshot still work", async () => {
    const root = makeRepo();
    assert.match((await cli(root, ["drift", "add-due-dates"])).out, /never signed off/);
    await cli(root, ["approve", "add-due-dates"]);
    const d = await cli(root, ["drift", "add-due-dates"]);
    assert.equal(d.code, 0);
    assert.match(d.out, /no drift/);
    const p = join(root, "openspec/changes/add-due-dates/approvals.json");
    const data = JSON.parse(readFileSync(p, "utf8"));
    delete data.approvals[0].snapshot;
    writeFileSync(p, JSON.stringify(data));
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 0, "old approvals remain valid");
    writeFileSync(join(root, SPEC_FILE), SPEC + "\nextra\n");
    const old = await cli(root, ["drift", "add-due-dates"]);
    assert.equal(old.code, 1);
    assert.match(old.out, /before SpecGate 0\.3\.0 and has no snapshot/);
});
// @req drift/requirement-drift
test("lineDiff", () => {
    assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), ["  a", "- b", "+ x", "  c"]);
    assert.deepEqual(lineDiff("", "a"), ["+ a"]);
});
function areaRepo(extra = {}) {
    const root = makeRepo({ config: { approvers: ["lead@x.com"], areas: { todos: ["src/todos/**"] }, ...extra } });
    write(root, "src/todos/due.js", "export {};\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    git(root, "checkout", "-qb", "pr");
    return root;
}
// @req drift/code-drift
test("code drift: area code changed without a spec change fails; with one passes", async () => {
    const root = areaRepo();
    write(root, "src/todos/due.js", "export const x = 1;\n");
    write(root, "src/other.js", "1;\n");
    write(root, "test/x.test.js", "it('x', () => {});\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "code");
    const r = await cli(root, ["drift", "--base", "main"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Code drift: src\/todos\/due.js is in the area of todos but no spec for it changed/);
    assert.match(r.out, /warning: Unmapped code: src\/other.js/);
    assert.match(r.out, /warning: Untagged test: test\/x.test.js/);
    write(root, "openspec/changes/add-due-dates/specs/todos/spec.md", SPEC + "\n");
    const ok = codeDrift(root, loadConfig(root), "main");
    assert.equal(ok.passed, true, JSON.stringify(ok.findings));
    const c = await cli(root, ["check", "--all", "--base", "main"]);
    assert.match(c.out, /code drift since base/);
});
// @req drift/code-drift
test("code drift: requireAreaCoverage makes unmapped code an error; bad refs and config are rejected", async () => {
    const root = areaRepo({ requireAreaCoverage: true });
    write(root, "lib/new.js", "1;\n");
    const r = codeDrift(root, loadConfig(root), "main");
    assert.equal(r.passed, false);
    assert.equal(r.findings[0].rule, "unmapped-code");
    assert.match((await cli(root, ["drift", "--base=-x"])).err, /Invalid --base/);
    assert.match((await cli(root, ["drift", "--base", "nosuch"])).err, /not found/);
    const bad = makeRepo({ config: { areas: { todos: [] } } });
    assert.match((await cli(bad, ["list"])).err, /areas.todos must be a non-empty list/);
});
