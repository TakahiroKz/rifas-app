/**
 * Restablece la contraseña de un administrador y cierra todas sus sesiones abiertas.
 *
 *   pnpm admin:reset-password --email leo@ejemplo.com [--remote]
 *
 * La contraseña se pide por consola (oculta) o se toma de ADMIN_PASSWORD.
 * Por defecto actúa sobre la base LOCAL; con --remote, sobre la de producción.
 */
import { hashPassword, MIN_PASSWORD_LENGTH } from "@rifas/core";
import { arg, askPassword, fail, flag, q, runD1 } from "./lib";

const email = arg("email")?.trim().toLowerCase();
const remote = flag("remote");
if (!email) fail("falta --email");

// Se comprueba que el usuario exista antes de tocar nada.
const check = runD1(`SELECT COUNT(*) AS n FROM users WHERE email = ${q(email)};`, remote);
if (!check.ok) fail("no se pudo consultar la base de datos");
if (!/"n":\s*1\b/.test(check.output)) fail(`no existe un administrador con el correo ${email}`);

const password = await askPassword("Nueva contraseña (oculta): ");
if (password.length < MIN_PASSWORD_LENGTH)
  fail(`la contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);

const sql = [
  `UPDATE users SET password_hash = ${q(await hashPassword(password))} WHERE email = ${q(email)};`,
  `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${q(email)});`,
  `DELETE FROM login_attempts WHERE email = ${q(email)};`,
].join("\n");

const done = runD1(sql, remote);
if (!done.ok) fail("no se pudo actualizar la contraseña");
console.log(
  `\nContraseña actualizada para ${email} (${remote ? "producción" : "local"}). Se cerraron sus sesiones abiertas.`,
);
