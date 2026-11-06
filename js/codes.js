// Room codes use the alphabet the mindmaps rules already use: no I, L, O, 0 or 1, so they survive being read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;

export function makeCode(randomInt = secureInt) {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export const normalizeCode = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isCode = (text) => CODE_RE.test(text);

// Rejection sampling keeps every letter equally likely.
function secureInt(n) {
  const limit = 256 - (256 % n);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= limit);
  return byte[0] % n;
}
