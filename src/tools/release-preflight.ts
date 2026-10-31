import type { ASCClient } from "../client.js";
import { requirePro } from "../gate.js";
import { runPreflight, type PreflightArgs, type PreflightDeps } from "../preflight/run.js";
import type { Tier } from "../types.js";

export async function releasePreflight(
  client: ASCClient,
  args: PreflightArgs,
  tier: Tier,
  deps?: PreflightDeps,
): Promise<string> {
  const gate = requirePro(tier, "Release preflight audit", "release_preflight");
  if (gate) return gate;
  return runPreflight(client, args, deps);
}
