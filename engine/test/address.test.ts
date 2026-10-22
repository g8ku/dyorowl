import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAddress, isOnCurve, isSolanaAddress } from "../src/util/address.js";

const WALLET = "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK"; // on-curve (keypair-style)
const PDA = "Esb5p2wnCJemyYRKPs8Tc3yVgs6LSBQb51oSX9jTiHsN"; // off-curve

test("recognises valid Solana addresses", () => {
  assert.ok(isSolanaAddress(WALLET));
  assert.ok(isSolanaAddress("So11111111111111111111111111111111111111112"));
  assert.ok(!isSolanaAddress("0x1234abcd"));
  assert.ok(!isSolanaAddress("not an address at all"));
  assert.ok(!isSolanaAddress(WALLET.replace("T", "0"))); // 0 isn't base58
});

test("tells wallets from program-derived addresses", () => {
  assert.equal(isOnCurve(WALLET), true);
  assert.equal(isOnCurve(PDA), false);
});

test("pulls the contract address out of a tweet", () => {
  assert.equal(extractAddress(`@dyorowl check this one ${WALLET} 🙏`), WALLET);
  assert.equal(extractAddress("@dyorowl what do you think of this coin?"), undefined);
});
