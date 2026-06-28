import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

export interface PrivacyArgs {
  app_id: string;
  /** Set true if the app collects no data at all ("Data Not Collected"). */
  data_not_collected?: boolean;
}

/**
 * The App Privacy nutrition label (data collection) is NOT exposed by the
 * public App Store Connect API: `apps` has no appDataUsages relationship and
 * `/v1/appDataUsages` returns "resource does not exist" (probed live 2026-06-26).
 * fastlane has the same gap. So this tool returns the exact, ready-to-apply
 * steps plus a deep link instead of pretending to write.
 */
export async function setPrivacyNutrition(
  args: PrivacyArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Configuring the privacy nutrition label");
  if (gate) return gate;

  const url = `https://appstoreconnect.apple.com/apps/${args.app_id}/distribution/privacy`;

  if (args.data_not_collected) {
    return (
      "App Privacy: 'Data Not Collected'.\n\n" +
      "Apple does not expose the privacy nutrition label through its public API " +
      "(no appDataUsages resource), so set it once in App Store Connect:\n\n" +
      `1. Open ${url}\n` +
      "2. Click 'Get Started' (or 'Edit').\n" +
      "3. Answer 'No, we do not collect data from this app'.\n" +
      "4. Click 'Publish'.\n\n" +
      "This is a one-time setup; it persists across versions. Required before submit_for_review."
    );
  }

  return (
    "App Privacy must be configured in App Store Connect (not API-addressable).\n\n" +
    `Open ${url}, click 'Get Started', and declare each data type you collect, its purpose, ` +
    "and whether it is linked to the user or used for tracking. If you collect nothing, " +
    "re-run with data_not_collected: true for the exact steps. Required before submit_for_review."
  );
}
