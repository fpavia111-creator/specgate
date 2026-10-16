import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isEmail } from "./ids.js";
export const CONFIG_FILE = "specgate.json";
export const DEFAULT_CONFIG = {
    openspecDir: "openspec",
    testGlobs: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/test_*.py",
        "**/*_test.py",
        "**/*_test.go",
        "**/test/**",
        "**/tests/**",
        "**/__tests__/**",
    ],
    ignoreGlobs: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.venv/**", "**/vendor/**"],
    requiredApprovals: 1,
    approvers: [],
    requireScenarioCoverage: false,
    github: { approverLogins: {}, requireReviewOnHead: false },
    areas: {},
    requireAreaCoverage: false,
};
/** Throws on any invalid setting, so a typo can never silently weaken the gate. */
export function validateConfig(cfg, where = CONFIG_FILE) {
    const bad = (m) => { throw new Error(`${where}: ${m}`); };
    if (typeof cfg.openspecDir !== "string" || !cfg.openspecDir || isAbsolute(cfg.openspecDir) || cfg.openspecDir.split(/[\\/]/).includes(".."))
        bad("openspecDir must be a relative path inside the repository");
    if (!Number.isInteger(cfg.requiredApprovals) || cfg.requiredApprovals < 1)
        bad(`requiredApprovals must be a whole number of at least 1 (got ${JSON.stringify(cfg.requiredApprovals)})`);
    if (!Array.isArray(cfg.approvers) || cfg.approvers.some((a) => !isEmail(a)))
        bad("approvers must be a list of email addresses (names are not accepted: anyone can set any name)");
    for (const k of ["testGlobs", "ignoreGlobs"])
        if (!Array.isArray(cfg[k]) || cfg[k].some((g) => typeof g !== "string"))
            bad(`${k} must be a list of strings`);
    if (typeof cfg.requireScenarioCoverage !== "boolean")
        bad("requireScenarioCoverage must be true or false");
    if (typeof cfg.areas !== "object" || cfg.areas === null || Array.isArray(cfg.areas))
        bad("areas must be an object mapping capability to a list of globs");
    for (const [cap, globs] of Object.entries(cfg.areas))
        if (!Array.isArray(globs) || !globs.length || globs.some((g) => typeof g !== "string" || !g))
            bad(`areas.${cap} must be a non-empty list of globs`);
    if (typeof cfg.requireAreaCoverage !== "boolean")
        bad("requireAreaCoverage must be true or false");
    const gh = cfg.github;
    if (typeof gh !== "object" || gh === null || typeof gh.approverLogins !== "object" || gh.approverLogins === null)
        bad("github.approverLogins must be an object mapping approver email to GitHub login");
    for (const [email, login] of Object.entries(gh.approverLogins))
        if (!isEmail(email) || typeof login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(login))
            bad(`github.approverLogins entry ${JSON.stringify(email)} must map an email to a GitHub login`);
    return cfg;
}
export function parseConfig(text, where) {
    const raw = JSON.parse(text);
    const cfg = { ...DEFAULT_CONFIG, ...raw, github: { ...DEFAULT_CONFIG.github, ...(raw.github ?? {}) } };
    return validateConfig(cfg, where);
}
export function loadConfig(root) {
    const path = join(root, CONFIG_FILE);
    if (!existsSync(path))
        return { ...DEFAULT_CONFIG, areas: {}, github: { ...DEFAULT_CONFIG.github, approverLogins: {} } };
    return parseConfig(readFileSync(path, "utf8"), path);
}
