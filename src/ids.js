/** Change ids must be simple kebab-case slugs: no path separators, dots or traversal. */
export const CHANGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isChangeId(id) {
    return typeof id === "string" && id.length <= 128 && CHANGE_ID_RE.test(id);
}
export function assertChangeId(id) {
    if (!isChangeId(id))
        throw new Error(`Invalid change id ${JSON.stringify(id)}: use lowercase letters, digits and single hyphens (e.g. add-due-dates).`);
    return id;
}
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function isEmail(s) {
    return typeof s === "string" && EMAIL_RE.test(s);
}
