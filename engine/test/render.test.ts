import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEvidence } from "../src/score.js";
import { renderCaseFile, renderReply, tweetLength } from "../src/render.js";
import { curveCoin, healthyCoin, ruggyCoin, DEMO_NOW } from "../src/fixtures.js";

const now = new Date(DEMO_NOW);

test("every reply fits in one post and has no links", () => {
  for (const ev of [healthyCoin, ruggyCoin, curveCoin]) {
    const reply = renderReply(scoreEvidence(ev, now));
    assert.ok(tweetLength(reply) <= 280, `${tweetLength(reply)} chars:\n${reply}`);
    assert.doesNotMatch(reply, /https?:\/\//);
    assert.match(reply, /NFA, DYOR/);
  }
});

test("reply leads with the ticker and score", () => {
  const reply = renderReply(scoreEvidence(healthyCoin, now));
  const [l1, l2] = reply.split("\n");
  assert.equal(l1, "🦉 Case file: $EXMPL");
  assert.match(l2!, /^Hoot score \d+\/100 · /);
});

test("red flags come before good news", () => {
  const reply = renderReply(scoreEvidence(ruggyCoin, now));
  // Authority lines always come first; check the ordering of everything after them.
  const lines = reply.split("\n").filter((l) => /^(✅|⚠️|🚩)/.test(l) && !/authority|Mint & freeze/.test(l));
  const firstGood = lines.findIndex((l) => l.startsWith("✅"));
  const lastBad = lines.map((l) => l.startsWith("🚩")).lastIndexOf(true);
  assert.ok(firstGood === -1 || firstGood > lastBad);
});

test("a tight limit drops detail lines but keeps the header and footer", () => {
  const reply = renderReply(scoreEvidence(ruggyCoin, now), 120);
  assert.ok(tweetLength(reply) <= 120);
  assert.match(reply, /Hoot score/);
  assert.match(reply, /NFA, DYOR/);
});

test("tweetLength counts emoji as 2", () => {
  assert.equal(tweetLength("abc"), 3);
  assert.equal(tweetLength("🦉"), 2);
  assert.equal(tweetLength("⚠️"), 2);
});

test("case file lists what wasn't checked", () => {
  const md = renderCaseFile(scoreEvidence(curveCoin, now));
  assert.match(md, /## Not checked/);
  assert.match(md, /creator wallet/);
  assert.match(md, /Not financial advice/);
});
