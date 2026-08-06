import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface GroupAttrs {
  name: string;
  isInternalGroup: boolean;
}
interface BuildAttrs {
  version: string;
  processingState: string;
}

/** List the app's TestFlight beta groups. */
export async function listBetaGroups(
  client: ASCClient,
  args: { app_id: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Listing beta groups", "list_beta_groups");
  if (gate) return gate;

  const res = await client.get<GroupAttrs>("/v1/betaGroups", {
    "filter[app]": args.app_id,
    "fields[betaGroups]": "name,isInternalGroup",
    limit: "50",
  });
  const groups = Array.isArray(res.data) ? res.data : [res.data];
  if (!groups.length) return "No beta groups. Create one in TestFlight first.";
  return (
    "Beta groups:\n" +
    groups
      .map((g) => `- ${g.attributes.name} [${g.id}]${g.attributes.isInternalGroup ? " (internal)" : ""}`)
      .join("\n")
  );
}

/** Assign a build to a TestFlight beta group so testers can install it. */
export async function assignBuildToGroup(
  client: ASCClient,
  args: { app_id: string; group_id: string; build_id?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Assigning a build to TestFlight", "assign_build_to_group");
  if (gate) return gate;

  let buildId = args.build_id;
  let buildVersion = buildId ?? "";
  if (!buildId) {
    const res = await client.get<BuildAttrs>("/v1/builds", {
      "filter[app]": args.app_id,
      "filter[processingState]": "VALID",
      sort: "-uploadedDate",
      "fields[builds]": "version",
      limit: "1",
    });
    const builds = Array.isArray(res.data) ? res.data : [res.data];
    const newest = builds[0];
    if (!newest) return "No processed (VALID) build available. Check list_builds.";
    buildId = newest.id;
    buildVersion = newest.attributes.version;
  }

  await client.post(`/v1/betaGroups/${args.group_id}/relationships/builds`, {
    data: [{ type: "builds", id: buildId }],
  });
  return `Assigned build ${buildVersion} [${buildId}] to beta group ${args.group_id}. Testers can now install it.`;
}

/** Invite an external tester by email and add them to a beta group. */
export async function inviteBetaTester(
  client: ASCClient,
  args: { group_id: string; email: string; first_name?: string; last_name?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Inviting a beta tester", "invite_beta_tester");
  if (gate) return gate;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email)) {
    return `"${args.email}" is not a valid email.`;
  }

  await client.post("/v1/betaTesters", {
    data: {
      type: "betaTesters",
      attributes: {
        email: args.email,
        firstName: args.first_name ?? "",
        lastName: args.last_name ?? "",
      },
      relationships: {
        betaGroups: { data: [{ type: "betaGroups", id: args.group_id }] },
      },
    },
  });
  return `Invited ${args.email} to beta group ${args.group_id}. Apple emails them a TestFlight invite.`;
}
