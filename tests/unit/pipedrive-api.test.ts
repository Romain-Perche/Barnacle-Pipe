// covers SF-117 FR-002, FR-022, SC-007: the Pipedrive calls map answers and errors; the token never goes in an address
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipedriveRefused, PipedriveSlowDown, PipedriveUnreachable, retrySeconds, TIMEOUT_MS, whoAmI, listPersons } from "@/server/pipedrive/api";
import { installFakePipedrive } from "../fakes/pipedrive";

const TOKEN = "test-token-secret-123456";
function setUp() {
  const fake = installFakePipedrive();
  fake.addCompany({ token: TOKEN, user: { id: 7, name: "Fake Person", email: "linus@barnacle.ai" }, companyId: 1001, companyName: "Fakeco Pipedrive" });
  return fake;
}
afterEach(() => vi.useRealTimers());

describe("Pipedrive calls", () => {
  it("whoAmI maps id, name, company_id and company_name", async () => {
    setUp();
    await expect(whoAmI(TOKEN)).resolves.toEqual({ id: 7, name: "Fake Person", companyId: 1001, companyName: "Fakeco Pipedrive" });
  });
  it("401 → PipedriveRefused (unknown or refused token)", async () => {
    const fake = setUp();
    await expect(whoAmI("test-token-unknown")).rejects.toBeInstanceOf(PipedriveRefused);
    fake.refuseToken(TOKEN);
    await expect(whoAmI(TOKEN)).rejects.toBeInstanceOf(PipedriveRefused);
  });
  it("500 or a network error → PipedriveUnreachable", async () => {
    const fake = setUp();
    fake.failNext(500);
    await expect(whoAmI(TOKEN)).rejects.toBeInstanceOf(PipedriveUnreachable);
    fake.failNext("network");
    await expect(whoAmI(TOKEN)).rejects.toBeInstanceOf(PipedriveUnreachable);
  });
  it("no answer within 10 seconds → PipedriveUnreachable", async () => {
    vi.useFakeTimers();
    const fake = setUp();
    fake.hangNext();
    const call = whoAmI(TOKEN);
    const caught = call.catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await caught).toBeInstanceOf(PipedriveUnreachable);
  });
  it("429 → PipedriveSlowDown with Retry-After's seconds", async () => {
    const fake = setUp();
    fake.slowDownEvery(1, 8);
    const e = await listPersons(TOKEN, { cursor: null, limit: 10, marketing: false }).catch((x) => x);
    expect(e).toBeInstanceOf(PipedriveSlowDown);
    expect(e.seconds).toBe(8);
  });
  it("retrySeconds: Retry-After, else x-ratelimit-reset, else 10, within 1–300", () => {
    expect(retrySeconds(new Headers({ "retry-after": "8" }))).toBe(8);
    expect(retrySeconds(new Headers({ "x-ratelimit-reset": "3" }))).toBe(3);
    expect(retrySeconds(new Headers())).toBe(10);
    expect(retrySeconds(new Headers({ "retry-after": "9999" }))).toBe(300);
    expect(retrySeconds(new Headers({ "retry-after": "0" }))).toBe(1);
    expect(retrySeconds(new Headers({ "retry-after": "soon" }))).toBe(10);
  });
  it("never puts the token in a request address, and errors carry no part of it", async () => {
    const fake = setUp();
    await whoAmI(TOKEN);
    await listPersons(TOKEN, { cursor: null, limit: 10, marketing: true });
    fake.refuseToken(TOKEN);
    const e = (await whoAmI(TOKEN).catch((x: Error) => x)) as Error;
    expect(fake.requests.length).toBe(3);
    for (const r of fake.requests) expect(JSON.stringify(r)).not.toContain(TOKEN.slice(0, 10));
    expect(`${e.message} ${e.stack}`).not.toContain(TOKEN.slice(0, 10));
  });
});
