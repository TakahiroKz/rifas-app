import type { Deps } from "./deps";
import { MIN_PASSWORD_LENGTH, verifyPassword } from "./password";
import { fail, ok, type Result } from "./result";
import { hashToken, newSessionSecrets } from "./session-token";
import type { AuthContext, Organization, User } from "./types";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_BY_EMAIL = 5;
export const MAX_FAILED_BY_IP = 20;

// Hash válido de una contraseña inexistente: iguala el tiempo de respuesta cuando el correo no existe.
const DUMMY_HASH =
  "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export interface LoginResult {
  /** Valor de la cookie de sesión. */
  token: string;
  csrfToken: string;
  expiresAt: string;
  user: User;
  organization: Organization;
}

export async function login(
  deps: Deps,
  input: { email: unknown; password: unknown; ip: string },
): Promise<Result<LoginResult>> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return fail("invalid_input", "Correo y contraseña son obligatorios");
  }
  const email = input.email.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    input.password.length === 0 ||
    input.password.length > 200
  ) {
    return fail("invalid_input", "Correo y contraseña son obligatorios");
  }

  const now = deps.clock.now();
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const failures = await deps.auth.countFailedLogins({ email, ip: input.ip, since });
  if (failures.byEmail >= MAX_FAILED_BY_EMAIL || failures.byIp >= MAX_FAILED_BY_IP) {
    return fail(
      "too_many_attempts",
      "Demasiados intentos. Espera unos minutos e inténtalo de nuevo",
    );
  }

  const found = await deps.auth.findUserByEmail(email);
  const valid = await verifyPassword(input.password, found?.passwordHash ?? DUMMY_HASH);
  const membership = found && valid ? await deps.auth.findMembership(found.id) : null;
  if (!found || !valid || !membership) {
    await deps.auth.recordFailedLogin(email, input.ip, now.toISOString());
    return fail("unauthorized", "Correo o contraseña incorrectos");
  }
  const organization = await deps.orgs.findById(membership.orgId);
  if (!organization) return fail("unauthorized", "Correo o contraseña incorrectos");

  const secrets = await newSessionSecrets();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await deps.auth.createSession({
    id: secrets.id,
    userId: found.id,
    orgId: organization.id,
    csrfToken: secrets.csrfToken,
    createdAt: now.toISOString(),
    expiresAt,
  });
  await deps.auth.clearFailedLogins(email);

  return ok({
    token: secrets.token,
    csrfToken: secrets.csrfToken,
    expiresAt,
    user: { id: found.id, email: found.email, name: found.name },
    organization,
  });
}

/** Resuelve la cookie de sesión. Nunca revela por qué falló. */
export async function authenticate(
  deps: Deps,
  token: string | undefined,
): Promise<Result<AuthContext>> {
  if (!token || token.length > 200) return fail("unauthorized", "Inicia sesión");
  const session = await deps.auth.findSession(await hashToken(token));
  if (!session || session.expiresAt <= deps.clock.now().toISOString()) {
    return fail("unauthorized", "Inicia sesión");
  }
  const organization = await deps.orgs.findById(session.orgId);
  if (!organization) return fail("unauthorized", "Inicia sesión");
  return ok({ user: session.user, organization, csrfToken: session.csrfToken });
}

export async function logout(deps: Deps, token: string | undefined): Promise<void> {
  if (token) await deps.auth.deleteSession(await hashToken(token));
}

export { MIN_PASSWORD_LENGTH };
