import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/src/mcp.js";
import { makeRepo, write } from "./helpers.js";
async function connect(root) {
    const server = createServer(root);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
}
const text = (r) => r.content.map((c) => c.text).join("");
// @req integration/mcp-server
test("MCP: lists tools and has no approve tool", async () => {
    const c = await connect(makeRepo());
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["check", "drift", "list_changes", "new_change", "show_change", "signoff_status", "write_plan"]);
    const r = await c.callTool({ name: "list_changes", arguments: {} });
    assert.match(text(r), /add-due-dates/);
});
// @req integration/mcp-server
test("bug 6: MCP refuses a root outside SPECGATE_ROOT", async () => {
    const root = makeRepo();
    const other = makeRepo();
    const c = await connect(root);
    for (const bad of [other, "..", "/etc", join(root, "..")]) {
        const r = await c.callTool({ name: "list_changes", arguments: { root: bad } });
        assert.equal(r.isError, true, bad);
        assert.match(text(r), /outside/);
    }
    write(root, "sub/specgate.json", "{}");
    assert.equal((await c.callTool({ name: "list_changes", arguments: { root: "sub" } })).isError, undefined);
});
// @req integration/mcp-server
test("bug 6: MCP only accepts slug change ids", async () => {
    const c = await connect(makeRepo());
    for (const bad of ["../../etc", "a/b", "Add_Dates", ".hidden", ""]) {
        for (const name of ["show_change", "new_change", "write_plan", "signoff_status"]) {
            const r = await c.callTool({ name, arguments: { change: bad, capability: "x" } });
            assert.equal(r.isError, true, `${name} ${bad}`);
        }
    }
    assert.equal((await c.callTool({ name: "show_change", arguments: { change: "add-due-dates" } })).isError, undefined);
});
// @req integration/mcp-server
test("bug 6: MCP check refuses JUnit paths outside the root", async () => {
    const c = await connect(makeRepo());
    const r = await c.callTool({ name: "check", arguments: { change: "add-due-dates", junit: ["../../etc/passwd"] } });
    assert.equal(r.isError, true);
    assert.match(text(r), /outside/);
});
// @req integration/mcp-server
test("bug 6: CLI rejects traversal change ids too", async () => {
    const { cli } = await import("./helpers.js");
    const r = await cli(makeRepo(), ["show", "../../../etc"]);
    assert.match(r.err, /Invalid change id/);
    void mkdtempSync; void tmpdir;
});
