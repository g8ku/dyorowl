#!/usr/bin/env node
/**
 * Usage:
 *   npm run case -- <contract address>          long-form case file
 *   npm run case -- <contract address> --reply  the X reply only
 *   npm run case -- <contract address> --json   full report as JSON
 *   npm run demo                                sample cases, no network
 */
import { investigate, renderCaseFile, renderReply, scoreEvidence, tweetLength } from "./index.js";
import { InvalidAddressError } from "./analyze.js";
import { curveCoin, healthyCoin, ruggyCoin, DEMO_NOW } from "./fixtures.js";
import type { Report } from "./types.js";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; fall back to the environment and defaults
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const mint = args.find((a) => !a.startsWith("--"));

function print(report: Report) {
  if (flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (flags.has("--reply")) {
    const reply = renderReply(report);
    console.log(reply);
    console.log(`\n(${tweetLength(reply)}/280)`);
  } else {
    console.log(renderCaseFile(report));
    console.log("\n--- X reply ---");
    console.log(renderReply(report));
  }
}

async function main() {
  if (flags.has("--demo")) {
    const now = new Date(DEMO_NOW);
    for (const ev of [healthyCoin, curveCoin, ruggyCoin]) {
      print(scoreEvidence(ev, now));
      console.log("\n" + "=".repeat(60) + "\n");
    }
    console.log("Sample data only. These coins are made up.");
    return;
  }

  if (!mint) {
    console.error("Give me a contract address: npm run case -- <address>   (or npm run demo)");
    process.exit(1);
  }

  const report = await investigate(mint);
  print(report);
}

main().catch((err: unknown) => {
  if (err instanceof InvalidAddressError) console.error(`🦉 ${err.message}`);
  else console.error(`🦉 The owl couldn't open this case: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
