const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verifica un token de Cloudflare Turnstile. Lanza si el servicio de verificación no responde. */
export async function verifyTurnstile(input: {
  secret: string;
  token: string;
  ip?: string | undefined;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const body = new FormData();
  body.append("secret", input.secret);
  body.append("response", input.token);
  if (input.ip) body.append("remoteip", input.ip);

  const res = await (input.fetchFn ?? fetch)(VERIFY_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`Turnstile respondió ${res.status}`);
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
