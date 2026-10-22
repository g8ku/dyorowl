/**
 * Solana address helpers: base58 decoding, validation, and the on-curve check
 * used to tell normal wallets from program-derived addresses (PDAs).
 */
import { ed25519 } from "@noble/curves/ed25519";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = INDEX.get(ch);
    if (v === undefined) throw new Error(`invalid base58 character "${ch}"`);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** True if the string decodes to a 32-byte Solana public key. */
export function isSolanaAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return base58Decode(s).length === 32;
  } catch {
    return false;
  }
}

/**
 * Wallets controlled by a private key sit on the ed25519 curve. PDAs (pools,
 * bonding curves, lockers, vesting vaults) are deliberately off-curve, so an
 * off-curve owner means "a program controls these tokens", not a person.
 */
export function isOnCurve(address: string): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(base58Decode(address));
    return true;
  } catch {
    return false;
  }
}

/** Pull the first thing that looks like a Solana address out of free text (e.g. a tweet). */
export function extractAddress(text: string): string | undefined {
  for (const m of text.matchAll(/[1-9A-HJ-NP-Za-km-z]{32,44}/g)) {
    if (isSolanaAddress(m[0])) return m[0];
  }
  return undefined;
}

export const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
