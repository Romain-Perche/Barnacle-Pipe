import { describe, expect, it } from "vitest";
import {
  decideSignIn,
  displayNameFor,
  firstName,
  isBarnacleEmail,
  isSafeNext,
  normalizeEmail,
} from "@/server/auth/rules";

const active = { status: "active" as const };
const deactivated = { status: "deactivated" as const };
const google = (email: string, extra: Partial<{ emailVerified: boolean; hd: string | null }> = {}) => ({
  email,
  emailVerified: true,
  hd: null,
  ...extra,
});

describe("normalizeEmail / isBarnacleEmail", () => {
  // covers FR-013, edge case "  jd@barnacle.ai  "
  it("trims and lowercases", () => {
    expect(normalizeEmail("  JD@Barnacle.AI  ")).toBe("jd@barnacle.ai");
  });
  // covers FR-002, FR-013
  it("accepts only barnacle.ai addresses", () => {
    expect(isBarnacleEmail("Mikey@Barnacle.ai")).toBe(true);
    expect(isBarnacleEmail("  new.person@barnacle.ai ")).toBe(true);
    expect(isBarnacleEmail("me@gmail.com")).toBe(false);
    expect(isBarnacleEmail("x@barnacle.ai.evil.com")).toBe(false);
    expect(isBarnacleEmail("x@sub.barnacle.ai")).toBe(false);
    expect(isBarnacleEmail("@barnacle.ai")).toBe(false);
    expect(isBarnacleEmail("")).toBe(false);
  });
});

describe("decideSignIn", () => {
  // covers edge case "Mikey@Barnacle.ai" vs "mikey@barnacle.ai", US1 scenario 2
  it("lets an active listed user in (case-insensitive lookup is done by the caller on the normalised email)", () => {
    expect(decideSignIn(google("Mikey@Barnacle.ai"), active, null)).toBe("ok");
  });
  // covers US1 scenario 5, FR-002
  it("refuses a non-barnacle.ai account with domain", () => {
    expect(decideSignIn(google("me@gmail.com"), null, "me@gmail.com")).toBe("domain");
    expect(decideSignIn(google("me@gmail.com"), active, null)).toBe("domain");
  });
  // covers clarification "unverified email is refused"
  it("refuses an unverified email with domain", () => {
    expect(decideSignIn(google("ada@barnacle.ai", { emailVerified: false }), active, null)).toBe("domain");
  });
  // covers FR-002 (real Google hd claim)
  it("refuses an hd that is not barnacle.ai, and accepts hd barnacle.ai", () => {
    expect(decideSignIn(google("ada@barnacle.ai", { hd: "evil.com" }), active, null)).toBe("domain");
    expect(decideSignIn(google("ada@barnacle.ai", { hd: "barnacle.ai" }), active, null)).toBe("ok");
  });
  // covers US2 scenario 6, edge case "first admin deactivated"
  it("refuses a deactivated user with removed, even the first admin", () => {
    expect(decideSignIn(google("ada@barnacle.ai"), deactivated, null)).toBe("removed");
    expect(decideSignIn(google("boss@barnacle.ai"), deactivated, "boss@barnacle.ai")).toBe("removed");
  });
  // covers FR-003, FR-004, US1 scenario 3
  it("creates the first admin only when no record exists", () => {
    expect(decideSignIn(google("Boss@Barnacle.ai"), null, "boss@barnacle.ai")).toBe("create_first_admin");
    expect(decideSignIn(google("boss@barnacle.ai"), active, "boss@barnacle.ai")).toBe("ok");
  });
  // covers US1 scenario 4
  it("refuses an unlisted barnacle.ai account with not_allowed", () => {
    expect(decideSignIn(google("someone@barnacle.ai"), null, "boss@barnacle.ai")).toBe("not_allowed");
    expect(decideSignIn(google("someone@barnacle.ai"), null, null)).toBe("not_allowed");
  });
});

describe("isSafeNext", () => {
  // covers FR-009 (no open redirect)
  it("keeps in-app paths", () => {
    expect(isSafeNext("/admin/users")).toBe("/admin/users");
    expect(isSafeNext("/admin/users?error=duplicate")).toBe("/admin/users?error=duplicate");
  });
  it("replaces anything else with /", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://x", "/auth/end", "/auth/google/start", "", null, undefined, "admin"]) {
      expect(isSafeNext(bad)).toBe("/");
    }
  });
});

describe("names", () => {
  // covers US1 scenario 2 ("Hello, <first name>")
  it("firstName is the first word", () => {
    expect(firstName("Ada Fake")).toBe("Ada");
    expect(firstName("  new.person ")).toBe("new.person");
  });
  // covers edge case "never signed in: name is the local part"
  it("displayNameFor uses the Google name, else the local part", () => {
    expect(displayNameFor("jd@barnacle.ai", "J D")).toBe("J D");
    expect(displayNameFor("jd@barnacle.ai", "  ")).toBe("jd");
    expect(displayNameFor("jd@barnacle.ai", null)).toBe("jd");
  });
});
