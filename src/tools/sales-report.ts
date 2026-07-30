import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";

export const salesReportDefinition = {
  name: "sales_report",
  description:
    "Download a sales/downloads summary report for a date range. Shows units sold, proceeds, and territory breakdown. Pro feature - requires license key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vendor_number: {
        type: "string",
        description:
          "Your vendor number, 8 to 9 digits, from App Store Connect > Sales and Trends (or Payments and Financial Reports > Vendor ID). Omit it and the tool tells you where to look.",
      },
      frequency: {
        type: "string",
        enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
        description: "Report frequency (default: DAILY).",
      },
      report_date: {
        type: "string",
        description:
          "Report date in YYYY-MM-DD format. For WEEKLY reports, use any date in the desired week. For MONTHLY, use YYYY-MM. Default: yesterday.",
      },
    },
    required: [],
  },
};

export async function salesReport(
  client: ASCClient,
  args: { vendor_number?: string; frequency?: string; report_date?: string },
  tier: Tier,
): Promise<string> {
  if (tier !== "pro") {
    return (
      "Sales reports require a Pro license ($9/mo).\n" +
      "Get your license at: https://buy.polar.sh/polar_cl_Ta3OxEA1EbRyYNPFtSsRXgYWBCCtjwMxlbAeW35RLuu\n\n" +
      "Set ASC_LICENSE_KEY in your MCP server config to unlock."
    );
  }

  // An agent cannot discover the vendor number: it is only shown in the ASC
  // website. Say where it is instead of failing schema validation, which used to
  // surface as a raw zod dump.
  if (!args.vendor_number) {
    return (
      "Need your vendor number first. Find it in App Store Connect > Sales and Trends, " +
      "top-left account picker (or Payments and Financial Reports > Vendor ID). " +
      "It is 8 to 9 digits, the same for every app in the account, and worth saving: " +
      "https://appstoreconnect.apple.com/trends\n\n" +
      "Then call sales_report again with vendor_number set."
    );
  }

  const frequency = args.frequency || "DAILY";
  const reportDate =
    args.report_date || getYesterday();

  let tsv: string;
  try {
    tsv = await client.getReport({
      reportType: "SALES",
      reportSubType: "SUMMARY",
      frequency,
      vendorNumber: args.vendor_number,
      reportDate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Invalid vendor number")) {
      return "Invalid vendor number. Find yours in App Store Connect → Sales and Trends → top right (Vendor ID).";
    }
    if (msg.includes("404")) {
      return `No sales report available for ${reportDate}. Reports may take 1-2 days to appear.`;
    }
    return `Error fetching sales report: ${msg}`;
  }

  if (tsv.startsWith("No report")) {
    return tsv;
  }

  // Parse TSV into structured summary
  const lines = tsv.trim().split("\n");
  if (lines.length < 2) {
    return "Report returned no data rows.";
  }

  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i]?.trim() || "";
    });
    return row;
  });

  // Aggregate by title
  const byTitle = new Map<
    string,
    { units: number; proceeds: number; currency: string }
  >();

  for (const row of rows) {
    const title = row["Title"] || row["Product Type Identifier"] || "Unknown";
    const units = parseFloat(row["Units"] || "0");
    const proceeds = parseFloat(row["Developer Proceeds"] || "0");
    const currency = row["Currency of Proceeds"] || "USD";

    const existing = byTitle.get(title) || { units: 0, proceeds: 0, currency };
    existing.units += units;
    existing.proceeds += proceeds;
    byTitle.set(title, existing);
  }

  let totalUnits = 0;
  let totalProceeds = 0;

  let result = `## Sales Report - ${frequency} - ${reportDate}\n\n`;
  result += `| App | Units | Proceeds |\n`;
  result += `|-----|------:|--------:|\n`;

  for (const [title, data] of byTitle) {
    result += `| ${title} | ${data.units} | ${data.proceeds.toFixed(2)} ${data.currency} |\n`;
    totalUnits += data.units;
    totalProceeds += data.proceeds;
  }

  result += `| **Total** | **${totalUnits}** | **${totalProceeds.toFixed(2)}** |\n\n`;
  result += `*${rows.length} rows in raw report.*\n`;

  return result;
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
