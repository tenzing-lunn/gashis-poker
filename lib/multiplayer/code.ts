// Table codes: six letters a friend can read out or type, e.g. `KQMXWD`. Framework-free: shared by the
// worker in table-server/ (which maps a code to its Durable Object with `idFromName`) and the browser.
//
// The alphabet leaves out I, L and O, which look like 1, 1 and 0. Codes are uppercase on the wire and in
// URLs; people may type them in any case. 23^6 ≈ 148M codes; a code is reused only after its table closed.

export const TABLE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const TABLE_CODE_LENGTH = 6;

const CODE_RE = new RegExp(`^[${TABLE_CODE_ALPHABET}]{${TABLE_CODE_LENGTH}}$`);

/** Exactly six alphabet letters, uppercase. */
export const isTableCode = (s: string): boolean => CODE_RE.test(s);

/** The code in canonical (uppercase) form, from a code typed in any case; null when it is not one. */
export function normalizeTableCode(s: string): string | null {
  const code = s.trim().toUpperCase();
  return isTableCode(code) ? code : null;
}

/** A random code. `random` returns a uniform uint32 (use a CSPRNG in production). */
export function randomTableCode(random: () => number): string {
  const n = TABLE_CODE_ALPHABET.length;
  // Rejection sampling: drop the top values that would make some letters likelier than others.
  const limit = Math.floor(2 ** 32 / n) * n;
  let code = "";
  while (code.length < TABLE_CODE_LENGTH) {
    const r = random() >>> 0;
    if (r < limit) code += TABLE_CODE_ALPHABET[r % n];
  }
  return code;
}

/**
 * Draws codes until `tryClaim` accepts one (it refuses a code a live table already holds) and returns it.
 * Throws after `maxTries` refusals.
 */
export async function claimFreshCode(
  tryClaim: (code: string) => Promise<boolean>,
  random: () => number,
  maxTries = 8,
): Promise<string> {
  for (let i = 0; i < maxTries; i++) {
    const code = randomTableCode(random);
    if (await tryClaim(code)) return code;
  }
  throw new Error(`No free table code after ${maxTries} tries`);
}
