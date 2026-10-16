/**
 * JUnit reporter for node:test that records each test's file, so SpecGate can
 * tell identically named tests in different files apart.
 *
 *   node --test --test-reporter=specgate/junit-reporter --test-reporter-destination=reports/junit.xml
 *
 * Each file becomes a <testsuite file="…">; describe() blocks become nested
 * <testsuite>s; every <testcase> also carries file= and line=.
 */
import { relative, sep } from "node:path";
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const rel = (f) => (f ? relative(process.cwd(), f.startsWith("file://") ? new URL(f).pathname : f).split(sep).join("/") : "");
export function buildXml(events) {
    const files = new Map(); // file -> root node
    const stacks = new Map(); // file -> stack of open suite nodes by nesting
    const node = (name) => ({ name, children: [], cases: [] });
    for (const { type, data } of events) {
        if (!data || !/^test:(start|pass|fail)$/.test(type))
            continue;
        const file = rel(data.file);
        if (!files.has(file)) {
            files.set(file, node(file || "unknown"));
            stacks.set(file, []);
        }
        const stack = stacks.get(file);
        const parent = (n) => (n > 0 && stack[n - 1]) || files.get(file);
        if (type === "test:start") {
            // Provisionally a suite; it becomes a case if it finishes as a test.
            const s = node(data.name);
            stack.length = data.nesting;
            stack[data.nesting] = s;
            s.parent = parent(data.nesting);
            continue;
        }
        const own = stack[data.nesting];
        const isSuite = data.details?.type === "suite";
        if (isSuite) {
            if (own)
                own.parent.children.push(own);
            continue;
        }
        const tc = {
            name: data.name,
            file,
            line: data.line,
            time: ((data.details?.duration_ms ?? 0) / 1000).toFixed(6),
            result: type === "test:fail" ? "failed" : data.skip !== undefined || data.todo !== undefined ? "skipped" : "passed",
            message: type === "test:fail" ? String(data.details?.error?.cause?.message ?? data.details?.error?.message ?? "failed") : "",
        };
        (own?.parent ?? parent(data.nesting)).cases.push(tc);
    }
    const out = ['<?xml version="1.0" encoding="utf-8"?>', "<testsuites>"];
    const emit = (n, depth, file) => {
        const pad = "\t".repeat(depth);
        out.push(`${pad}<testsuite name="${esc(n.name)}" file="${esc(file)}">`);
        for (const c of n.cases) {
            const attrs = `name="${esc(c.name)}" classname="${esc(file)}" file="${esc(c.file)}"${c.line ? ` line="${c.line}"` : ""} time="${c.time}"`;
            if (c.result === "passed")
                out.push(`${pad}\t<testcase ${attrs}/>`);
            else if (c.result === "skipped")
                out.push(`${pad}\t<testcase ${attrs}><skipped/></testcase>`);
            else
                out.push(`${pad}\t<testcase ${attrs}><failure message="${esc(c.message)}"/></testcase>`);
        }
        for (const ch of n.children)
            emit(ch, depth + 1, file);
        out.push(`${pad}</testsuite>`);
    };
    for (const [file, root] of files)
        emit(root, 1, file);
    out.push("</testsuites>", "");
    return out.join("\n");
}
export default async function* specgateJUnitReporter(source) {
    const events = [];
    for await (const e of source)
        events.push(e);
    yield buildXml(events);
}
