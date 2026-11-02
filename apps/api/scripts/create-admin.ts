/**
 * Crea el primer administrador (y su organización si no existe). No hay registro abierto.
 *
 *   pnpm admin:create --email leo@ejemplo.com --name "Leo" \
 *     --org-slug finaura --org-name "Capital Finaura" --whatsapp 573001112233 [--remote]
 *
 * La contraseña se pide por consola (oculta) o se toma de ADMIN_PASSWORD. Por defecto
 * actúa sobre la base LOCAL; con --remote, sobre la de producción.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword, isValidPhone, isValidSlug, MIN_PASSWORD_LENGTH } from "@rifas/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function askPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  process.stdout.write("Contraseña (oculta): ");
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

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const orgSlug = arg("org-slug");
const orgName = arg("org-name")?.trim();
const whatsapp = arg("whatsapp");
const remote = process.argv.includes("--remote");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email no es válido");
if (!name || name.length < 2) fail("--name es obligatorio");
if (!isValidSlug(orgSlug)) fail("--org-slug no es válido (minúsculas, números y guiones)");
if (!orgName || orgName.length < 2) fail("--org-name es obligatorio");
if (!isValidPhone(whatsapp)) fail("--whatsapp debe tener 10 a 15 dígitos, sin '+'");

const password = await askPassword();
if (password.length < MIN_PASSWORD_LENGTH)
  fail(`la contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);

const now = new Date().toISOString();
const userId = randomUUID();
const sql = [
  `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (${q(userId)}, ${q(email)}, ${q(await hashPassword(password))}, ${q(name)}, ${q(now)});`,
  `INSERT OR IGNORE INTO organizations (id, name, slug, whatsapp_phone, created_at) VALUES (${q(randomUUID())}, ${q(orgName)}, ${q(orgSlug)}, ${q(whatsapp)}, ${q(now)});`,
  `INSERT INTO memberships (user_id, org_id, role) VALUES (${q(userId)}, (SELECT id FROM organizations WHERE slug = ${q(orgSlug)}), 'owner');`,
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "rifas-admin-"));
const file = join(dir, "create-admin.sql");
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
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) fail("no se pudo escribir en la base de datos (¿el correo ya existe?)");
  console.log(
    `\nAdministrador creado: ${email} → organización "${orgSlug}" (${remote ? "producción" : "local"}).`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
