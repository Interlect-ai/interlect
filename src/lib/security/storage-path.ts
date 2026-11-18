/**
 * A storage path a user handed us. The path is checked by its leading folders, so it
 * must not be able to leave them: no `.` or `..` segment, no empty segment (`//`, leading or
 * trailing `/`), and none of the characters a URL or the storage server can turn into one
 * (`%` for `%2e%2e`/`%2f`, `\`, `?`, `#`, control characters). Same rule as
 * `public.is_safe_storage_path` in the database (0100).
 */
const UNSAFE_CHARACTER = /[\\%?#]/;

export function isSafeStoragePath(path: string): boolean {
  if (!path || path.length > 1000 || UNSAFE_CHARACTER.test(path)) return false;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The path is safe and lies in `folder` (given without its trailing `/`). */
export function isStoragePathIn(path: string, folder: string): boolean {
  return isSafeStoragePath(path) && path.startsWith(`${folder}/`);
}
