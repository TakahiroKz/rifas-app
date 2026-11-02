const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** SHA-256 hex. En la base solo se guarda este hash, nunca el token de la cookie. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export async function newSessionSecrets() {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const csrfToken = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  return { token, id: await hashToken(token), csrfToken };
}
