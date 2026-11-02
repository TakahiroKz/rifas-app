import type { AuthContext } from "@rifas/core";
import { authenticate } from "@rifas/core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { readSessionCookie } from "./cookies";
import { toHttpError } from "./errors";

export type AdminEnv = AppEnv & { Variables: AppEnv["Variables"] & { auth: AuthContext } };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Si el navegador envía Origin, debe ser el mismo sitio. */
export function sameOrigin(requestUrl: string, origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

export const forbiddenOrigin = {
  error: { code: "forbidden", message: "Origen no permitido" },
};

/** Sesión obligatoria. En peticiones que modifican datos exige además el token CSRF. */
export const requireAuth: MiddlewareHandler<AdminEnv> = async (c, next) => {
  c.header("Cache-Control", "no-store");

  const result = await authenticate(c.get("deps"), readSessionCookie(c));
  if (!result.ok) {
    const { status, body } = toHttpError(result.error);
    return c.json(body, status);
  }

  if (MUTATING.has(c.req.method)) {
    if (!sameOrigin(c.req.url, c.req.header("Origin"))) return c.json(forbiddenOrigin, 403);
    if (c.req.header("X-CSRF-Token") !== result.value.csrfToken) {
      return c.json({ error: { code: "forbidden", message: "Token CSRF inválido" } }, 403);
    }
  }

  c.set("auth", result.value);
  await next();
};
