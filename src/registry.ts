import { execFile } from "node:child_process";

/** The data of value `name` in `reg query` output, or undefined if it is not listed. */
export function parseRegValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

/** Reads one value with `reg query`; undefined if it is missing or reg fails. */
export function queryRegValue(key: string, name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // reg exits with an error when the value does not exist.
    execFile("reg", ["query", key, "/v", name], { windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : parseRegValue(stdout, name));
    });
  });
}
