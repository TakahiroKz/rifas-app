import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Literal SQL con comillas simples escapadas. */
export const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Contraseña desde ADMIN_PASSWORD o pedida por consola sin mostrarla. */
export async function askPassword(prompt = "Contraseña (oculta): "): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  process.stdout.write(prompt);
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) =>
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

/** Ejecuta SQL contra la base D1 local o remota con wrangler. Devuelve la salida JSON de wrangler. */
export function runD1(sql: string, remote: boolean): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "rifas-d1-"));
  const file = join(dir, "script.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "rifas-db",
        remote ? "--remote" : "--local",
        "--file",
        file,
        "--json",
      ],
      { encoding: "utf8" },
    );
    return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
