import { describe, it, expect } from "vitest";
import { EDITABLE_VERSION_STATES } from "../src/editable.js";

describe("editable version states", () => {
  it("is the single shared definition used by metadata/build/submit tools", () => {
    // Drift between per-tool copies previously let a rejected-binary version be
    // edited but not re-attached/submitted. Lock the contents here.
    for (const s of [
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
      "INVALID_BINARY",
    ]) {
      expect(EDITABLE_VERSION_STATES.has(s)).toBe(true);
    }
  });

  it("does not treat in-review / live states as editable", () => {
    for (const s of ["WAITING_FOR_REVIEW", "IN_REVIEW", "READY_FOR_SALE", "PENDING_DEVELOPER_RELEASE"]) {
      expect(EDITABLE_VERSION_STATES.has(s)).toBe(false);
    }
  });
});
