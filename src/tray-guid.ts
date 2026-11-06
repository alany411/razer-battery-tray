import { createHash } from "node:crypto";

// Fixed for good: changing it gives every tray icon a new GUID (see ADR 0003).
const TRAY_NAMESPACE = "07a8b5d6-3eef-472f-abd9-c5ef006a1169";

/** The RFC 9562 version 5 (SHA-1, name-based) UUID of `name` in `namespace`. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * The GUID of the tray icon for `key`, so Windows remembers its show or hide choice across
 * unplug, replug and restarts. The exe path is part of it because Windows binds an unsigned
 * app's GUID to the path that first used it.
 */
export function trayGuid(exePath: string, key: string): string {
  return uuidV5(TRAY_NAMESPACE, `${exePath}\0${key}`);
}
