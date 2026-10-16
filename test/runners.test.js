import assert from "node:assert/strict";
import { test } from "node:test";
import { matchResult, parseJUnit } from "../dist/src/trace.js";
const t = (name, file, suites = [], defLine) => ({ name, file, suites, defLine, line: 1, refs: [] });
const one = (xml, tt) => matchResult(tt, parseJUnit(xml)).result;
// @req trace/test-runners
test("runners: Jest (jest-junit default templates, optional absolute file attribute)", () => {
    const xml = '<testsuites><testsuite name="todos"><testcase classname="todos rejects bad dates" name="todos rejects bad dates" file="/home/ci/repo/test/todos.test.js"/></testsuite></testsuites>';
    assert.equal(one(xml, t("rejects bad dates", "test/todos.test.js", ["todos"])), "passed");
    assert.equal(one(xml, t("rejects bad dates", "test/other.test.js", ["todos"])), "unknown");
});
// @req trace/test-runners
test("runners: Vitest (file as suite and classname, ' > ' full names)", () => {
    const xml = '<testsuites><testsuite name="test/todos.test.ts"><testcase classname="test/todos.test.ts" name="todos &gt; dates &gt; rejects bad dates"><failure/></testcase></testsuite></testsuites>';
    assert.equal(one(xml, t("rejects bad dates", "test/todos.test.ts", ["todos", "dates"])), "failed");
    assert.equal(one(xml, t("rejects bad dates", "test/todos.test.ts", ["todos"])), "unknown");
});
// @req trace/test-runners
test("runners: pytest (module and class classnames, file attribute)", () => {
    const xml = '<testsuites><testsuite name="pytest"><testcase classname="tests.test_todos" name="test_due" file="tests/test_todos.py" line="3"/><testcase classname="tests.test_todos.TestSort" name="test_sorted"/></testsuite></testsuites>';
    assert.equal(one(xml, t("test_due", "tests/test_todos.py")), "passed");
    assert.equal(one(xml, t("test_sorted", "tests/test_todos.py")), "passed");
    assert.equal(one(xml, t("test_sorted", "tests/test_other.py")), "unknown");
});
// @req trace/test-runners
test("runners: Go (go-junit-report package classnames, subtests)", () => {
    const xml = '<testsuites><testsuite name="github.com/acme/app/todos"><testcase classname="github.com/acme/app/todos" name="TestDue"/><testcase classname="github.com/acme/app/todos" name="TestDue/invalid"><failure/></testcase></testsuite><testsuite name="github.com/acme/app/users"><testcase classname="github.com/acme/app/users" name="TestDue"><failure/></testcase></testsuite></testsuites>';
    assert.equal(one(xml, t("TestDue", "todos/due_test.go")), "passed");
    assert.equal(one(xml, t("TestDue", "users/due_test.go")), "failed");
    assert.equal(one(xml, t("TestDue", "billing/due_test.go")), "unknown");
});
// @req trace/test-runners
test("runners: Java (Maven Surefire and Gradle 'name()' style)", () => {
    const surefire = '<testsuite name="com.acme.TodoTest"><testcase name="rejectsInvalid" classname="com.acme.TodoTest"/></testsuite>';
    assert.equal(one(surefire, t("rejectsInvalid", "src/test/java/com/acme/TodoTest.java")), "passed");
    const gradle = '<testsuite name="com.acme.TodoTest"><testcase name="rejectsInvalid()" classname="com.acme.TodoTest"/></testsuite>';
    assert.equal(one(gradle, t("rejectsInvalid", "src/test/java/com/acme/TodoTest.java")), "passed");
    assert.equal(one(gradle, t("rejectsInvalid", "src/test/java/com/acme/OtherTest.java")), "unknown");
});
