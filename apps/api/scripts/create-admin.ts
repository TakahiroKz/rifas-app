/**
 * Crea el primer administrador (y su organización si no existe). No hay registro abierto.
 *
 *   pnpm admin:create --email leo@ejemplo.com --name "Leo" \
 *     --org-slug finaura --org-name "Capital Finaura" --whatsapp 573001112233 [--remote]
 *
 * La contraseña se pide por consola (oculta) o se toma de ADMIN_PASSWORD. Por defecto
 * actúa sobre la base LOCAL; con --remote, sobre la de producción.
 */
import { randomUUID } from "node:crypto";
import { hashPassword, isValidPhone, isValidSlug, MIN_PASSWORD_LENGTH } from "@rifas/core";
import { arg, askPassword, fail, flag, q, runD1 } from "./lib";

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const orgSlug = arg("org-slug");
const orgName = arg("org-name")?.trim();
const whatsapp = arg("whatsapp");
const remote = flag("remote");

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

const done = runD1(sql, remote);
if (!done.ok) fail("no se pudo escribir en la base de datos (¿el correo ya existe?)");
console.log(
  `\nAdministrador creado: ${email} → organización "${orgSlug}" (${remote ? "producción" : "local"}).`,
);
