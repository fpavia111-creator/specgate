import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { detectAutomation } from "../dist/src/agent.js";
import { parseArgs } from "../dist/src/cli.js";
import { cli, makeRepo } from "./helpers.js";
const tty = { isTTY: true };
// @req signoff/email-only-approvers
test("bug 2: approvers lists must be emails; a name entry is a config error", async () => {
    const root = makeRepo({ approvers: ["Lead"] });
    assert.match((await cli(root, ["status", "add-due-dates"])).err, /approvers must be a list of email addresses/);
});
// @req signoff/email-only-approvers
test("bug 2: a matching display name with a different email is rejected", async () => {
    const root = makeRepo();
    const r = await cli(root, ["approve", "add-due-dates", "--as", "Lead <other@evil.com>"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /other@evil.com is not in the approvers list/);
    assert.equal((await cli(root, ["approve", "add-due-dates", "--as", "Someone <LEAD@x.com>"])).code, 0, "email match is case-insensitive");
});
// @req signoff/email-only-approvers
test("bug 2: hand-edited approvals.json entries with unlisted emails do not count", async () => {
    const root = makeRepo();
    await cli(root, ["approve", "add-due-dates"]);
    const p = join(root, "openspec/changes/add-due-dates/approvals.json");
    const data = JSON.parse(readFileSync(p, "utf8"));
    data.approvals[0].email = "evil@x.com";
    writeFileSync(p, JSON.stringify(data));
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 1);
});
// @req signoff/refuse-automation
test("bug 3: approve refuses in an agent or non-interactive context", async () => {
    const root = makeRepo();
    for (const env of [{ CLAUDECODE: "1" }, { CURSOR_AGENT: "1" }, { CI: "true" }]) {
        const r = await cli(root, ["approve", "add-due-dates"], { env, detect: "real" });
        assert.equal(r.code, 2);
        assert.match(r.err, /Refusing to sign off/);
    }
    // The test runner itself has no TTY, so the real detector refuses too.
    assert.match((await cli(root, ["approve", "add-due-dates"], { detect: "real" })).err, /not a terminal/);
    assert.equal((await cli(root, ["approve", "add-due-dates", "--i-am-human"], { env: { CLAUDECODE: "1" }, detect: "real" })).code, 0);
});
// @req signoff/refuse-automation
test("bug 3: detectAutomation", () => {
    assert.deepEqual(detectAutomation({}, tty, tty), []);
    assert.deepEqual(detectAutomation({ CLAUDECODE: "1" }, tty, tty), ["CLAUDECODE is set"]);
    assert.deepEqual(detectAutomation({ CI: "false" }, tty, tty), []);
    assert.equal(detectAutomation({}, {}, tty).length, 1);
});
// @req gate/config-validation
test("bug 7: --required must be a positive whole number", async () => {
    for (const bad of ["abc", "0", "-1", "1.5", ""]) {
        const root = makeRepo();
        const r = await cli(root, ["init", "--required", bad]);
        assert.equal(r.code, 2, `--required ${bad}`);
        assert.match(r.err, /--required must be a whole number/);
    }
    const root = makeRepo();
    assert.equal((await cli(root, ["init", "--required", "2", "--approver", "a@b.co"])).code, 0);
    assert.match((await cli(makeRepo(), ["init", "--approver", "Lead"])).err, /--approver must be an email/);
});
// @req gate/config-validation
test("bug 7: invalid requiredApprovals in specgate.json is rejected", async () => {
    for (const v of [null, 0, "2", 1.5]) {
        const root = makeRepo({ config: { approvers: [], requiredApprovals: v } });
        assert.match((await cli(root, ["list"])).err, /requiredApprovals must be a whole number/);
    }
});
// @req signoff/quorum
test("quorum counts distinct approvers", async () => {
    const root = makeRepo({ config: { approvers: ["a@x.com", "b@x.com"], requiredApprovals: 2 } });
    await cli(root, ["approve", "add-due-dates", "--as", "A <a@x.com>"]);
    await cli(root, ["approve", "add-due-dates", "--as", "A <a@x.com>"]);
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 1);
    await cli(root, ["approve", "add-due-dates", "--as", "B <b@x.com>"]);
    assert.equal((await cli(root, ["status", "add-due-dates"])).code, 0);
});
// @req integration/cli-arguments
test("minor: --key=value keeps everything after the first =", () => {
    const a = parseArgs(["approve", "x", "--note=a=b=c", "--as=Jane <j@x.com>", "--write"]);
    assert.equal(a.flags.get("note")[0], "a=b=c");
    assert.equal(a.flags.get("as")[0], "Jane <j@x.com>");
    assert.equal(a.flags.get("write")[0], "true");
});
