import assert from "node:assert/strict";
import { test } from "node:test";
import { matchResult, parseJUnit, scanTests } from "../dist/src/trace.js";
import { DEFAULT_CONFIG } from "../dist/src/config.js";
import { cli, junit, makeRepo, write } from "./helpers.js";
const t = (name, file = "test/a.test.js", suites = []) => ({ name, file, suites, line: 1, refs: [] });
const parse = (cases) => parseJUnit(junit(cases));
// @req trace/full-name-matching
test("bug 1: a different test whose name merely ends with the title does not count", () => {
    const r = matchResult(t("works"), parse('<testcase name="other thing works"/>'));
    assert.equal(r.result, "unknown");
});
// @req trace/full-name-matching
test("bug 1: the exact earlier repro no longer marks the requirement verified", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/a.test.js", '// @req todos/due-date#invalid-date-rejected\nit("works", () => {});\n// @req todos/sorting\nit("sorts", () => {});\n');
    write(root, "j.xml", junit('<testcase name="other thing works"/><testcase name="sorts"/>'));
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Not run: no test for todos\/due-date/);
});
// @req trace/full-name-matching
test("bug 1: results from another file are excluded when the report records files", () => {
    const cases = parse('<testcase name="works" classname="test/b.test.js"/>');
    assert.equal(matchResult(t("works"), cases).result, "unknown");
    const own = parse('<testcase name="works" classname="test/a.test.js"><failure/></testcase><testcase name="works" classname="test/b.test.js"/>');
    assert.equal(matchResult(t("works"), own).result, "failed");
});
// @req trace/ambiguous-results
test("bug 1: identical names with no file information are flagged ambiguous", async () => {
    assert.equal(matchResult(t("works"), parse('<testcase name="works"/><testcase name="works"/>')).result, "ambiguous");
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    write(root, "test/a.test.js", '// @req todos/due-date\nit("works", () => {});\n// @req todos/sorting\nit("sorts", () => {});\n');
    write(root, "j.xml", junit('<testcase name="works" classname="test"/><testcase name="works" classname="test"><failure/></testcase><testcase name="sorts"/>'));
    const r = await cli(root, ["check", "add-due-dates", "--junit", "j.xml"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Ambiguous: test\/a.test.js:1 "works" matches 2 results/);
});
// @req trace/full-name-matching
test("bug 1: suite-qualified full names match only with the file's own suites", () => {
    const vitest = parse('<testcase name="todos &gt; works" classname="test/a.test.js"/>');
    assert.equal(matchResult(t("works", "test/a.test.js", ["todos"]), vitest).result, "passed");
    assert.equal(matchResult(t("works", "test/a.test.js", []), parse('<testcase name="todos &gt; works"/>')).result, "unknown");
    const jest = parse('<testcase name="todos works" classname="todos works"/>');
    assert.equal(matchResult(t("works", "test/a.test.js", ["todos"]), jest).result, "passed");
    assert.equal(matchResult(t("works", "test/a.test.js", ["other"]), jest).result, "unknown");
});
// @req trace/full-name-matching
test("bug 1: pytest and Java classnames are matched to the file", () => {
    const py = parse('<testcase name="test_due" classname="tests.test_todos"/>');
    assert.equal(matchResult(t("test_due", "tests/test_todos.py"), py).result, "passed");
    assert.equal(matchResult(t("test_due", "tests/test_other.py"), py).result, "unknown");
    const java = parse('<testcase name="rejects" classname="com.x.TodoTest"/>');
    assert.equal(matchResult(t("rejects", "src/test/java/com/x/TodoTest.java"), java).result, "passed");
});
// @req trace/full-name-matching
test("inline [@req] title tags are matched with or without the tag", () => {
    const cases = parse('<testcase name="rejects bad dates"/>');
    assert.equal(matchResult(t("rejects bad dates [@req todos/due-date]"), cases).result, "passed");
});
// @req trace/xml-parsing
test("real XML parser: entities, CDATA and nested suites; malformed XML is an error", () => {
    const cases = parseJUnit('<?xml version="1.0"?><testsuites><testsuite name="a" file="x/a.test.js"><testsuite name="b"><testcase name="a &amp; b &lt;c&gt; &#233;"><failure><![CDATA[<boom>]]></failure></testcase></testsuite></testsuite></testsuites>');
    assert.equal(cases.length, 1);
    assert.equal(cases[0].name, "a & b <c> é");
    assert.equal(cases[0].result, "failed");
    assert.equal(cases[0].file, "x/a.test.js");
    assert.deepEqual(cases[0].suites, ["a", "b"]);
    assert.throws(() => parseJUnit("<testsuites><testcase name='x'></testsuites>"), /Could not parse JUnit XML/);
    assert.equal(parseJUnit(junit('<testcase name="s"><skipped/></testcase>'))[0].result, "skipped");
});
// @req trace/tag-placement
test("minor: a tag above describe() is reported, not attached to the first test", async () => {
    const root = makeRepo();
    write(root, "test/a.test.js", '// @req todos/due-date\ndescribe("dates", () => {\n  it("x", () => {});\n});\n');
    const scanned = scanTests(root, DEFAULT_CONFIG);
    assert.equal(scanned[0].name, undefined);
    assert.match(scanned[0].misplaced, /suite "dates"/);
    await cli(root, ["approve", "add-due-dates"]);
    const r = await cli(root, ["check", "add-due-dates"]);
    assert.match(r.out, /Misplaced tag: test\/a.test.js:1/);
    assert.match(r.out, /Untested: todos\/due-date/);
});
// @req trace/xml-parsing
test("loadJUnit reports a missing file", async () => {
    const root = makeRepo();
    assert.match((await cli(root, ["check", "add-due-dates", "--junit", "nope.xml"])).err, /not found/);
});
