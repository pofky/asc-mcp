import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

export interface EUTraderArgs {
  app_id: string;
}

/**
 * EU Digital Services Act "trader status" is required before an app can stay
 * available in the EU. Apple does not expose it through the public App Store
 * Connect API (no trader attribute on apps; no dedicated resource, probed live
 * 2026-06-26), so this returns the exact steps plus a deep link.
 */
export async function setEUTraderStatus(args: EUTraderArgs, tier: Tier): Promise<string> {
  const gate = requirePro(tier, "Declaring EU trader status");
  if (gate) return gate;

  const url = `https://appstoreconnect.apple.com/apps/${args.app_id}/distribution/info`;

  return (
    "EU trader status (Digital Services Act) is not API-addressable; declare it once in App Store Connect:\n\n" +
    `1. Open ${url} (App Information).\n` +
    "2. Find 'Trader Status' and choose Trader or Non-Trader.\n" +
    "   - If you sell paid apps or in-app purchases in the EU, you are a Trader and must publish your\n" +
    "     name, address, email, and phone, which Apple shows on your EU product pages.\n" +
    "   - Non-Trader removes EU availability for paid distribution.\n" +
    "3. Complete the contact details under Business > and save.\n\n" +
    "Required before an app with EU availability can pass review. This is a legal decision: confirm with the account owner."
  );
}
