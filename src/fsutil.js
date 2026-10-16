import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
/** Convert a glob (`**`, `*`, `?`) into an anchored RegExp over `/`-separated paths. */
export function globToRegExp(glob) {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                // `**/` matches zero or more directories; a trailing `**` matches anything.
                if (glob[i + 2] === "/") {
                    re += "(?:.*/)?";
                    i += 2;
                }
                else {
                    re += ".*";
                    i += 1;
                }
            }
            else {
                re += "[^/]*";
            }
        }
        else if (c === "?") {
            re += "[^/]";
        }
        else {
            re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${re}$`);
}
export function matchesAny(path, globs) {
    return globs.some((g) => g.test(path));
}
/** Walk `root` and return repo-relative, `/`-separated paths of files matching `include` but not `exclude`. */
export function findFiles(root, include, exclude) {
    const inc = include.map(globToRegExp);
    const exc = exclude.map(globToRegExp);
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const name of entries) {
            const abs = join(dir, name);
            const rel = relative(root, abs).split(sep).join("/");
            let st;
            try {
                st = statSync(abs);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                if (matchesAny(rel + "/", exc) || matchesAny(rel + "/x", exc))
                    continue;
                walk(abs);
            }
            else if (st.isFile() && matchesAny(rel, inc) && !matchesAny(rel, exc)) {
                out.push(rel);
            }
        }
    };
    walk(root);
    return out.sort();
}
