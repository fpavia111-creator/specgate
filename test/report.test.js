import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, junit, makeRepo, write } from "./helpers.js";
const T = "@" + "req";
async function failingRepo() {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/a.test.js", `// ${T} todos/due-date\nit("rejects <bad> | dates", () => {});\n`);
    write(root, "j.xml", junit('<testcase name="rejects &lt;bad&gt; | dates"><failure/></testcase>'));
    return root;
}
// @req reports/output-formats
test("reports: --write also writes a self-contained, escaped HTML record", async () => {
    const root = await failingRepo();
    await cli(root, ["check", "add-due-dates", "--junit", "j.xml", "--write"]);
    const html = readFileSync(join(root, "openspec/changes/add-due-dates/traceability.html"), "utf8");
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /rejects &lt;bad&gt; \| dates/);
    assert.doesNotMatch(html, /<script|<bad>/);
    const md = readFileSync(join(root, "openspec/changes/add-due-dates/traceability.md"), "utf8");
    assert.match(md, /rejects <bad> \\\| dates/, "pipes escaped in Markdown tables");
});
// @req reports/output-formats
test("reports: SARIF 2.1.0 with locations and rule ids", async () => {
    const root = await failingRepo();
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml", "--format", "sarif"]);
    assert.equal(r.code, 1);
    const sarif = JSON.parse(r.out);
    assert.equal(sarif.version, "2.1.0");
    const res = sarif.runs[0].results;
    const failing = res.find((x) => x.ruleId === "failing");
    assert.equal(failing.locations[0].physicalLocation.artifactLocation.uri, "openspec/changes/add-due-dates/specs/todos/spec.md");
    assert.equal(failing.locations[0].physicalLocation.region.startLine, 3);
    assert.ok(res.some((x) => x.ruleId === "untested" && x.properties.requirement === "todos/sorting"));
    assert.deepEqual(sarif.runs[0].tool.driver.rules.map((x) => x.id), ["failing", "untested"]);
});
// @req reports/output-formats
test("reports: GitHub annotations are escaped workflow commands", async () => {
    const root = await failingRepo();
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml", "--format", "github"]);
    const lines = r.out.trim().split("\n");
    assert.ok(lines.every((l) => /^::(error|warning) file=[^:]+,line=\d+,title=SpecGate [a-z-]+::/.test(l)), r.out);
    assert.ok(lines.some((l) => l.includes("Failing%3A") === false && l.includes("Failing: todos/due-date")));
});
// @req reports/output-formats
test("reports: PR comment summary has a stable marker, table and findings; files via --summary/--sarif/--out", async () => {
    const root = await failingRepo();
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml", "--summary", join(root, "s.md"), "--sarif", join(root, "s.sarif"), "--annotations", join(root, "a.txt"), "--format", "pr-comment", "--out", join(root, "o.md")]);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    const s = readFileSync(join(root, "s.md"), "utf8");
    assert.ok(s.startsWith("<!-- specgate:summary -->\n### SpecGate: ❌ FAIL"));
    assert.match(s, /\| change add-due-dates \| FAIL \| 0\/2 \| approved \|/);
    assert.match(s, /2 finding\(s\)/);
    assert.equal(readFileSync(join(root, "o.md"), "utf8"), s);
    assert.equal(JSON.parse(readFileSync(join(root, "s.sarif"), "utf8")).version, "2.1.0");
    assert.match(readFileSync(join(root, "a.txt"), "utf8"), /^::error /);
    assert.match((await cli(root, ["check", "add-due-dates", "--format", "pdf"])).err, /--format must be one of/);
});
// @req reports/traceability-record
test("reports: JSON keeps the 0.2 shape and adds findings and drift; snapshots are not copied into it", async () => {
    const root = await failingRepo();
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml", "--json"]);
    const [j] = JSON.parse(r.out);
    for (const k of ["scope", "generatedAt", "passed", "approval", "requirements", "orphanRefs", "problems", "findings", "drift"])
        assert.ok(k in j, k);
    assert.equal(j.approval.approvers[0].snapshot, undefined);
    assert.equal(j.findings.length, j.problems.length);
});
