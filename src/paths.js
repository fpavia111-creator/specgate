import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
/** Resolve `p` against `base` and refuse anything that escapes it (including via symlinks). */
export function resolveInside(base, p, what = "path") {
    const baseReal = existsSync(base) ? realpathSync(base) : resolve(base);
    let abs = resolve(baseReal, p);
    if (existsSync(abs))
        abs = realpathSync(abs);
    const rel = relative(baseReal, abs);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..")))
        return abs;
    throw new Error(`${what} ${JSON.stringify(p)} is outside ${baseReal}`);
}
