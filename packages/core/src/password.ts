// PBKDF2-SHA256 con WebCrypto (disponible en Workers y Node). 100 000 iteraciones es el máximo
// que admite Workers. Formato: pbkdf2$<iteraciones>$<sal base64>$<hash base64>.

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Comparación en tiempo constante. Devuelve false ante cualquier formato inválido. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterText, saltText, hashText] = stored.split("$");
  const iterations = Number(iterText);
  if (
    scheme !== "pbkdf2" ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !saltText ||
    !hashText
  ) {
    return false;
  }
  try {
    const expected = fromBase64(hashText);
    const actual = await derive(password, fromBase64(saltText), iterations);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
    return diff === 0;
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 10;
