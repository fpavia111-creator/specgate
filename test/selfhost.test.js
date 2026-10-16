import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cli } from "./helpers.js";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// @req gate/valid-specs
test("self-host: SpecGate's own specs are valid", async () => {
    const r = await cli(ROOT, ["validate"]);
    assert.equal(r.code, 0, r.out);
});
// @req gate/coverage-gate
test("self-host: every SpecGate requirement has a tagged test and no tag points at nothing", async () => {
    const r = await cli(ROOT, ["check", "--all", "--json"]);
    assert.equal(r.code, 0, r.out);
    const [living] = JSON.parse(r.out);
    assert.ok(living.requirements.length >= 20, `${living.requirements.length} requirements`);
    const untested = living.requirements.filter((q) => q.tests.length === 0).map((q) => q.id);
    assert.deepEqual(untested, []);
    assert.deepEqual(living.orphanRefs, []);
});
