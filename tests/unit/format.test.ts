// covers clarification "last sign-in in UK time, like 19 Nov 2026, 09:12, or Never" (US2 scenario 1)
import { describe, expect, it } from "vitest";
import { formatLastSignIn } from "@/server/format";

describe("formatLastSignIn", () => {
  it("writes UK time as '19 Nov 2026, 09:12'", () => {
    expect(formatLastSignIn(new Date("2026-11-19T09:12:00Z"))).toBe("19 Nov 2026, 09:12"); // GMT
    expect(formatLastSignIn(new Date("2026-07-01T08:05:00Z"))).toBe("01 Jul 2026, 09:05"); // BST
  });
  it("uses three-letter months (Sep, not Sept)", () => {
    expect(formatLastSignIn(new Date("2026-09-05T23:30:00Z"))).toBe("06 Sep 2026, 00:30");
  });
  it("writes Never when the user never signed in", () => {
    expect(formatLastSignIn(null)).toBe("Never");
  });
});

// covers US2 scenario 1 (Users header: "1 USER · 1 ADMIN", "2 USERS · 2 ADMINS")
import { countLabel } from "@/server/format";
describe("countLabel", () => {
  it("is singular for 1 and plural otherwise", () => {
    expect(countLabel(1, "USER")).toBe("1 USER");
    expect(countLabel(1, "ADMIN")).toBe("1 ADMIN");
    expect(countLabel(2, "ADMIN")).toBe("2 ADMINS");
    expect(countLabel(0, "ADMIN")).toBe("0 ADMINS");
  });
});
