#!/usr/bin/env node
/**
 * SpecGate MCP server. Gives a coding agent read access to specs, sign-off
 * state and traceability, and lets it draft changes and plans.
 *
 * Deliberately has no "approve" tool: sign-off is a human act, recorded with
 * the `specgate approve` CLI and protected by CODEOWNERS review.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { approvalStatus } from "./approval.js";
import { listChangeIds, loadChange } from "./changes.js";
import { loadConfig } from "./config.js";
import { checkChange, checkLiving, renderMarkdown } from "./gate.js";
import { newChange, writePlan } from "./scaffold.js";
import { renderRequirementDrift, requirementDrift } from "./drift.js";
import { loadJUnit } from "./trace.js";
import { CHANGE_ID_RE } from "./ids.js";
import { resolveInside } from "./paths.js";
const VERSION = "0.3.0";
export function createServer(defaultRoot = process.env.SPECGATE_ROOT ?? process.cwd()) {
    const server = new McpServer({ name: "specgate", version: VERSION });
    if (!existsSync(defaultRoot))
        throw new Error(`SPECGATE_ROOT ${defaultRoot} does not exist`);
    const base = realpathSync(resolve(defaultRoot));
    const rootArg = { root: z.string().optional().describe("Repository root, which must be SPECGATE_ROOT (or the server's working directory) or a folder inside it.") };
    const changeId = z.string().regex(CHANGE_ID_RE, "change ids are lowercase kebab-case slugs");
    const ok = (text) => ({ content: [{ type: "text", text }] });
    const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
    const ctx = (root) => {
        const r = root === undefined ? base : resolveInside(base, root, "root");
        return { root: r, cfg: loadConfig(r) };
    };
    server.registerTool("list_changes", { description: "List in-flight OpenSpec changes with their sign-off state and requirement count.", inputSchema: rootArg }, async ({ root }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const rows = listChangeIds(r, cfg).map((id) => {
                const c = loadChange(r, cfg, id);
                return { id, signoff: approvalStatus(r, cfg, c).state, requirements: c.requirements.length, problems: c.issues.length };
            });
            return ok(JSON.stringify(rows, null, 2));
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("show_change", {
        description: "Show a change's requirements and scenarios with the exact ids tests must carry as `@req <id>` tags, plus spec problems and sign-off state.",
        inputSchema: { ...rootArg, change: changeId },
    }, async ({ root, change }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const c = loadChange(r, cfg, change);
            const st = approvalStatus(r, cfg, c);
            return ok(JSON.stringify({
                id: c.id,
                signoff: { state: st.state, summary: st.summary },
                requirements: c.requirements.map((q) => ({
                    tag: `@req ${q.id}`,
                    op: q.op,
                    title: q.title,
                    statement: q.body,
                    scenarios: q.scenarios.map((s) => ({ tag: `@req ${s.id}`, title: s.title, steps: s.body })),
                })),
                problems: c.issues,
            }, null, 2));
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("new_change", {
        description: "Scaffold an OpenSpec change folder (proposal.md, specs/<capability>/spec.md, tasks.md). Fill in the files afterwards; TODO placeholders block sign-off.",
        inputSchema: { ...rootArg, change: changeId, capability: z.string(), why: z.string().optional() },
    }, async ({ root, change, capability, why }) => {
        try {
            const { root: r, cfg } = ctx(root);
            return ok(`Created:\n${newChange(r, cfg, change, capability, why).join("\n")}`);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("signoff_status", {
        description: "Report whether a change is signed off. Agents cannot sign off; when the state is not 'approved', show the human the returned command to run.",
        inputSchema: { ...rootArg, change: changeId },
    }, async ({ root, change }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const c = loadChange(r, cfg, change);
            const st = approvalStatus(r, cfg, c);
            const ask = st.state === "approved"
                ? ""
                : `\n\nTo sign off, a reviewer reads ${c.relDir}/proposal.md and specs/, then runs:\n  npx specgate approve ${c.id} --role "<role>" --note "<optional>"`;
            return ok(`${st.state}: ${st.summary}${c.issues.length ? `\nSpec problems: ${c.issues.map((i) => i.message).join("; ")}` : ""}${ask}`);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("write_plan", {
        description: "Write plan.md for a signed-off change: one test-first task per requirement, each naming the @req tag its tests need. Refuses if the change is not signed off or the spec changed after sign-off.",
        inputSchema: { ...rootArg, change: changeId, force: z.boolean().optional() },
    }, async ({ root, change, force }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const res = writePlan(r, cfg, change, { force });
            return ok(`Wrote ${res.path}\n\n${res.content}`);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("check", {
        description: "Run the gate: sign-off valid and every requirement covered by a @req-tagged test that passed. Pass JUnit XML report paths to include pass/fail. Omit `change` to check the living specs.",
        inputSchema: { ...rootArg, change: changeId.optional(), junit: z.array(z.string()).optional() },
    }, async ({ root, change, junit }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const results = junit?.length ? loadJUnit(r, junit, { confine: true }) : null;
            const report = change ? checkChange(r, cfg, change, results) : checkLiving(r, cfg, results);
            return ok(renderMarkdown(report));
        }
        catch (e) {
            return fail(e);
        }
    });
    server.registerTool("drift", {
        description: "Show which requirements of a change were changed, added or removed since its last sign-off, with a line diff. Read-only.",
        inputSchema: { ...rootArg, change: changeId },
    }, async ({ root, change }) => {
        try {
            const { root: r, cfg } = ctx(root);
            const c = loadChange(r, cfg, change);
            const st = approvalStatus(r, cfg, c);
            return ok(renderRequirementDrift(c.id, requirementDrift(r, c, [...st.valid, ...st.outdated])));
        }
        catch (e) {
            return fail(e);
        }
    });
    return server;
}
const invokedDirectly = (() => {
    try {
        return fileURLToPath(import.meta.url) === realpathSync(process.argv[1] ?? "");
    }
    catch {
        return false;
    }
})();
if (invokedDirectly) {
    const server = createServer();
    await server.connect(new StdioServerTransport());
}
