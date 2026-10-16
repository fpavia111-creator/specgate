import { existsSync, readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { resolve } from "node:path";
import { findFiles } from "./fsutil.js";
import { resolveInside } from "./paths.js";
const TAG_RE = /@req\s+([A-Za-z0-9_./#-]+(?:\s*,\s*[A-Za-z0-9_./#-]+)*)/g;
const STR = String.raw`(["'\x60])((?:\\.|(?!\1).)+)\1`;
const SUITE_RE = new RegExp(String.raw`\b(?:describe|suite|context)(?:\.\w+)*\s*\(\s*` + STR);
const NAME_PATTERNS = [
    // JS/TS: it("..."), test('...'), specify(`...`)
    new RegExp(String.raw`\b(?:it|test|specify)(?:\.\w+)*\s*\(\s*` + STR),
    // Python
    /\bdef\s+(test_\w+)/,
    // Go
    /\bfunc\s+(Test\w+)/,
    // Java/Kotlin/C#: void name( / fun name(
    /\b(?:void|fun)\s+(\w+)\s*\(/,
    // Rust
    /\bfn\s+(\w+)\s*\(/,
];
/**
 * Find what a tag on line `from` applies to: the tag's own line (inline title
 * tag) or one of the next few lines. Stops at the first test or suite; a tag
 * that lands on a suite (describe/suite/context) is reported, not silently
 * attached to whichever test happens to follow.
 */
function findTarget(lines, from) {
    for (let i = from; i < Math.min(lines.length, from + 6); i++) {
        for (const re of NAME_PATTERNS) {
            const m = re.exec(lines[i]);
            if (m) {
                const s = SUITE_RE.exec(lines[i]);
                if (s && s.index < m.index)
                    return { kind: "suite", name: s[2] };
                return { kind: "test", name: (m[2] ?? m[1]).trim(), line: i + 1 };
            }
        }
        const s = SUITE_RE.exec(lines[i]);
        if (s)
            return { kind: "suite", name: s[2] };
    }
    return { kind: "none" };
}
const COMMENT_START = /^\s*(?:\/\/|#|\/\*|\*|--|;|<!--|%|')/;
function isTagContext(line) {
    if (COMMENT_START.test(line))
        return true;
    // Trailing comment after code: `it("x", () => {}); // @req a/b`, but not inside an open string.
    const before = line.slice(0, line.indexOf("@req")).replace(/(["'\x60])(?:\\.|(?!\1).)*\1/g, "");
    if (/(?:\/\/|#|\/\*)/.test(before) && !/["'\x60]/.test(before))
        return true;
    // Inline title tag: it("does x [@req a/b]", ...)
    for (const re of NAME_PATTERNS.slice(0, 1)) {
        const m = re.exec(line);
        if (m && m[2] && m[2].includes("@req"))
            return true;
    }
    return false;
}
export function scanTests(root, cfg) {
    const files = findFiles(root, cfg.testGlobs, cfg.ignoreGlobs);
    const out = [];
    for (const file of files) {
        let text;
        try {
            text = readFileSync(`${root}/${file}`, "utf8");
        }
        catch {
            continue;
        }
        if (!text.includes("@req"))
            continue;
        const lines = text.split(/\r?\n/);
        const suites = [];
        for (const l of lines) {
            const s = SUITE_RE.exec(l);
            if (s)
                suites.push(s[2]);
        }
        lines.forEach((line, i) => {
            TAG_RE.lastIndex = 0;
            let m;
            const refs = [];
            while ((m = TAG_RE.exec(line))) {
                refs.push(...m[1].split(",").map((s) => s.trim()).filter((s) => s.includes("/")));
            }
            if (!refs.length)
                return;
            // A tag counts only in a comment line or inside a test's title on the same line,
            // so fixtures and strings that merely mention "@req" are not mistaken for tags.
            if (!isTagContext(line))
                return;
            const target = findTarget(lines, i);
            out.push({
                file,
                line: i + 1,
                name: target.kind === "test" ? target.name : undefined,
                defLine: target.kind === "test" ? target.line : undefined,
                misplaced: target.kind === "suite" ? `tag is on suite "${target.name}"; tag each test inside it instead` : undefined,
                suites,
                refs,
            });
        });
    }
    return out;
}
/** Parse a JUnit XML report (jest-junit, vitest, pytest, go-junit-report, node --test, …) with a real XML parser. */
export function parseJUnit(xml, source = "report") {
    const errors = [];
    let doc;
    try {
        doc = new DOMParser({ onError: (level, msg) => { if (level !== "warning") errors.push(msg); } }).parseFromString(xml, "text/xml");
    }
    catch (e) {
        errors.push(e.message);
    }
    if (errors.length || !doc?.documentElement)
        throw new Error(`Could not parse JUnit XML ${source}: ${errors[0] ?? "empty document"}`);
    const cases = [];
    const nodes = doc.getElementsByTagName("testcase");
    for (let i = 0; i < nodes.length; i++) {
        const tc = nodes[i];
        const name = tc.getAttribute("name");
        if (!name)
            continue;
        let file = tc.getAttribute("file") || "";
        const suites = [];
        for (let p = tc.parentNode; p && p.nodeType === 1; p = p.parentNode) {
            if (p.tagName === "testsuite") {
                if (p.getAttribute("name"))
                    suites.unshift(p.getAttribute("name"));
                if (!file && p.getAttribute("file"))
                    file = p.getAttribute("file");
            }
        }
        const has = (t) => tc.getElementsByTagName(t).length > 0;
        const result = has("failure") || has("error") ? "failed" : has("skipped") ? "skipped" : "passed";
        const line = Number(tc.getAttribute("line")) || undefined;
        cases.push({ name: name.trim(), classname: (tc.getAttribute("classname") || "").trim(), file, line, suites, result, source });
    }
    return cases;
}
export function loadJUnit(root, paths, { confine = false } = {}) {
    const all = [];
    for (const p of paths) {
        const abs = confine ? resolveInside(root, p, "JUnit report") : resolve(root, p);
        if (!existsSync(abs))
            throw new Error(`JUnit report not found: ${p}`);
        all.push(...parseJUnit(readFileSync(abs, "utf8"), p));
    }
    return paths.length ? all : null;
}
/** A test title with any inline `[@req …]` tag removed. */
export function stripTags(name) {
    return name.replace(/\s*\[?@req\s+[A-Za-z0-9_./#,\s-]+\]?/g, "").trim();
}
const SRC_EXT = /\.(?:[cm]?[jt]sx?|py|go|java|kt|kts|rs|cs|rb|php|swift|scala)$/i;
/** Normalise a path or dotted class name to dotted form without a source extension. */
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(SRC_EXT, "").replace(/\//g, ".");
const looksLikeLocation = (s) => !!s && !/\s/.test(s) && /[./\\]/.test(s);
/** Does a JUnit file/classname hint refer to this test file? undefined = the report gives no location. */
function locationMatch(c, file) {
    const hints = [c.file, c.classname].filter(looksLikeLocation);
    if (!hints.length)
        return undefined;
    const f = norm(file);
    const dir = file.includes("/") ? norm(file.slice(0, file.lastIndexOf("/"))) : "";
    return hints.some((h) => {
        const n = norm(h);
        if (n === f || f.endsWith(`.${n}`) || n.endsWith(`.${f}`))
            return true;
        // pytest class-based tests: classname "tests.test_todos.TestDue"
        if (n.startsWith(`${f}.`) || n.includes(`.${f}.`))
            return true;
        // Go: classname is the package import path; the file's directory is its tail.
        if (file.endsWith(".go"))
            return dir ? n === dir || n.endsWith(`.${dir}`) : true;
        return false;
    });
}
/** Full names the report may use for this test: exact title, or title prefixed by its suites. */
function fullNames(test) {
    const titles = [...new Set([test.name, stripTags(test.name)])].filter(Boolean);
    const names = new Set(titles);
    for (const t of titles)
        for (const s of test.suites ?? [])
            for (const sep of [" > ", " › ", " "])
                names.add(`${s}${sep}${t}`);
    return { titles, names };
}
/**
 * Find a test's result. A JUnit case matches only on the full test name
 * (optionally with suite names from the same file, or a " > "-separated
 * path ending in exactly this title) and only if its file/classname, when
 * present, points at the same file. Never on an arbitrary name suffix.
 * Returns "ambiguous" when it cannot tell which result belongs to this test.
 */
export function matchResult(test, cases) {
    if (!test.name)
        return { result: "unknown", matches: [] };
    const { titles, names } = fullNames(test);
    const nameHit = (c) => {
        // Gradle / JUnit 5 report method names as "name()".
        if (names.has(c.name) || names.has(c.name.replace(/\(\)$/, "")))
            return true;
        const parts = c.name.split(/\s+[>›]\s+/);
        if (parts.length > 1 && titles.includes(parts[parts.length - 1]))
            return parts.slice(0, -1).every((p) => (test.suites ?? []).includes(p));
        // node:test reports the title alone with the suite as the parent <testsuite>.
        return false;
    };
    const candidates = cases.filter(nameHit);
    const located = candidates.filter((c) => locationMatch(c, test.file) === true);
    const unlocated = candidates.filter((c) => locationMatch(c, test.file) === undefined);
    let chosen;
    if (located.length) {
        // Same file: a reported line (e.g. from specgate/junit-reporter) pins the exact test;
        // otherwise retries / parametrised cases aggregate.
        const atLine = test.defLine ? located.filter((c) => c.line === test.defLine) : [];
        chosen = atLine.length ? atLine : located;
    }
    else if (unlocated.length === 1)
        chosen = unlocated;
    else if (unlocated.length > 1) {
        // Without locations, several identical names could be anyone's. Suite context can still disambiguate.
        const bySuite = unlocated.filter((c) => c.suites.length && c.suites.every((s) => (test.suites ?? []).includes(s) || looksLikeLocation(s)));
        if (bySuite.length === 1)
            chosen = bySuite;
        else
            return { result: "ambiguous", matches: unlocated };
    }
    else
        return { result: "unknown", matches: [] };
    const result = chosen.some((c) => c.result === "failed") ? "failed" : chosen.some((c) => c.result === "passed") ? "passed" : "skipped";
    return { result, matches: chosen };
}
export function resultFor(test, cases) {
    return matchResult(test, cases).result;
}
