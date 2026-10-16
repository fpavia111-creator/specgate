import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const yml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const script = yml.split("run: |\n")[1].split("\n").map((l) => l.replace(/^ {8}/, "")).join("\n");
function runAction(env) {
    const dir = mkdtempSync(join(tmpdir(), "sg-action-"));
    const bin = join(dir, "bin");
    execFileSync("mkdir", [bin]);
    writeFileSync(join(bin, "npx"), `#!/bin/bash\nprintf '%s\\n' "$@" >> "${dir}/npx-args"\necho PASS\n`);
    writeFileSync(join(bin, "git"), `#!/bin/bash\nexit 0\n`);
    chmodSync(join(bin, "npx"), 0o755);
    chmodSync(join(bin, "git"), 0o755);
    const r = spawnSync("bash", ["-c", script], {
        cwd: dir, encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: join(dir, "summary"), GITHUB_OUTPUT: join(dir, "output"), SG_DRIFT: "false", SG_SARIF: "specgate.sarif", SG_JUNIT: "reports/junit.xml", SG_CHANGE: "", SG_VERSION: "0.3.0", SG_VERIFY: "true", SG_EVENT: "push", SG_BASE_REF: "", ...env },
    });
    return { ...r, dir, args: existsSync(join(dir, "npx-args")) ? readFileSync(join(dir, "npx-args"), "utf8") : "" };
}
// @req integration/github-action
test("bug 5: action.yml never interpolates inputs into the script and pins the version", () => {
    assert.doesNotMatch(script, /\$\{\{/);
    assert.match(yml, /default: "0\.3\.0"/);
    assert.doesNotMatch(yml, /latest/);
});
// @req integration/github-action
test("bug 5: hostile inputs are rejected or passed as plain arguments", () => {
    const evil = runAction({ SG_CHANGE: 'x"; touch pwned; echo "' });
    assert.equal(evil.status, 2);
    assert.ok(!existsSync(join(evil.dir, "pwned")));
    const v = runAction({ SG_VERSION: "latest; touch pwned" });
    assert.equal(v.status, 2);
    assert.ok(!existsSync(join(v.dir, "pwned")));
    const j = runAction({ SG_JUNIT: "a.xml $(touch pwned) b.xml" });
    assert.equal(j.status, 0, j.stderr);
    assert.ok(!existsSync(join(j.dir, "pwned")));
    assert.match(j.args, /^@kurtfrancisco\/specgate@0\.3\.0$/m);
    assert.match(j.args, /^\$\(touch$/m);
});
// @req integration/github-action
test("action runs verify-approvals on pull requests", () => {
    const r = runAction({ SG_EVENT: "pull_request", SG_BASE_REF: "main" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.args, /^verify-approvals$/m);
    assert.match(r.args, /^origin\/main$/m);
});
