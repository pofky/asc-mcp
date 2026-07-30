import { describe, it, expect } from "vitest";
import {
  pickEditableAppInfo,
  pickAuditAppInfo,
  noEditableAppInfoMessage,
  fetchAppInfos,
  type AppInfoRecord,
} from "../src/app-info.js";

/**
 * Reported by a customer on v1.8.2: an app with a live appInfo plus a draft one
 * got 409 "The field 'name' can not be modified in the current state", because
 * the code read appInfos with limit=1 and Apple returns the live record first.
 * Verified against the real API: one of my own apps returns exactly that pair
 * (READY_FOR_SALE then WAITING_FOR_REVIEW).
 */
function rec(state: string, id = state.toLowerCase()): AppInfoRecord {
  return {
    id,
    state,
    editable: ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"].includes(state),
    raw: { id, attributes: { appStoreState: state } },
  };
}

describe("pickEditableAppInfo", () => {
  it("skips the live record Apple returns first and takes the draft", () => {
    const picked = pickEditableAppInfo([rec("READY_FOR_SALE"), rec("PREPARE_FOR_SUBMISSION")]);
    expect(picked?.state).toBe("PREPARE_FOR_SUBMISSION");
  });

  it("takes the only record when it is editable", () => {
    expect(pickEditableAppInfo([rec("PREPARE_FOR_SUBMISSION")])?.state).toBe("PREPARE_FOR_SUBMISSION");
  });

  it("returns null when everything is locked, rather than a doomed PATCH", () => {
    expect(pickEditableAppInfo([rec("READY_FOR_SALE"), rec("WAITING_FOR_REVIEW")])).toBeNull();
  });

  it("treats a rejected app as editable, since that is when you fix the name", () => {
    expect(pickEditableAppInfo([rec("READY_FOR_SALE"), rec("METADATA_REJECTED")])?.state).toBe("METADATA_REJECTED");
  });
});

describe("pickAuditAppInfo", () => {
  it("prefers the editable draft", () => {
    expect(pickAuditAppInfo([rec("READY_FOR_SALE"), rec("PREPARE_FOR_SUBMISSION")])?.state).toBe(
      "PREPARE_FOR_SUBMISSION",
    );
  });

  it("audits the in-review record over the live one, since that is the submission", () => {
    expect(pickAuditAppInfo([rec("READY_FOR_SALE"), rec("WAITING_FOR_REVIEW")])?.state).toBe("WAITING_FOR_REVIEW");
  });

  it("falls back to the live record when it is all there is", () => {
    expect(pickAuditAppInfo([rec("READY_FOR_SALE")])?.state).toBe("READY_FOR_SALE");
  });

  it("handles the newer state vocabulary", () => {
    expect(pickAuditAppInfo([rec("READY_FOR_DISTRIBUTION"), rec("PREPARE_FOR_SUBMISSION")])?.state).toBe(
      "PREPARE_FOR_SUBMISSION",
    );
  });

  it("returns null for an empty list", () => {
    expect(pickAuditAppInfo([])).toBeNull();
  });
});

describe("noEditableAppInfoMessage", () => {
  it("names the states present and the way out", () => {
    const msg = noEditableAppInfoMessage([rec("READY_FOR_SALE"), rec("WAITING_FOR_REVIEW")], "name, subtitle");
    expect(msg).toContain("name, subtitle");
    expect(msg).toContain("READY_FOR_SALE, WAITING_FOR_REVIEW");
    expect(msg).toContain("create_version");
  });

  it("says so when the app has no appInfo at all", () => {
    expect(noEditableAppInfoMessage([], "name")).toContain("Confirm the app_id");
  });
});

describe("fetchAppInfos", () => {
  it("asks for every appInfo with its state, not just the first", async () => {
    const calls: Array<{ path: string; params?: Record<string, string> }> = [];
    const client = {
      get: async (path: string, params?: Record<string, string>) => {
        calls.push({ path, params });
        return {
          data: [
            { id: "live", attributes: { appStoreState: "READY_FOR_SALE", state: "READY_FOR_DISTRIBUTION" } },
            { id: "draft", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION", state: "PREPARE_FOR_SUBMISSION" } },
          ],
        };
      },
    } as never;

    const { infos } = await fetchAppInfos(client, "123");
    expect(calls[0].path).toBe("/v1/apps/123/appInfos");
    expect(calls[0].params?.limit).toBe("50");
    expect(calls[0].params?.["fields[appInfos]"]).toContain("appStoreState");
    expect(infos.map((i) => i.editable)).toEqual([false, true]);
  });

  it("prefers appStoreState but falls back to state", async () => {
    const client = {
      get: async () => ({ data: [{ id: "x", attributes: { state: "PREPARE_FOR_SUBMISSION" } }] }),
    } as never;
    const { infos } = await fetchAppInfos(client, "1");
    expect(infos[0]).toMatchObject({ state: "PREPARE_FOR_SUBMISSION", editable: true });
  });
});
