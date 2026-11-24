// covers SF-116 FR-015 (T009): local runs use the in-app fake Storage: the storage module reaches fakeStorage() in
// process, the browser reaches the same fake through /dev/fake-storage/..., which answers 404 outside development/test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignedUploadUrl, newStoragePath, objectInfo, readHead, signedUrl } from "@/server/files/storage";
import * as route from "@/app/dev/fake-storage/[...path]/route";

afterEach(() => vi.unstubAllEnvs());

const call = (method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}) => {
  const u = new URL(url);
  const rest = u.pathname.replace(/^\/dev\/fake-storage\//, "").split("/");
  const handler = route[method as "GET" | "PUT"];
  return handler(new Request(url, { method, body, headers }), { params: Promise.resolve({ path: rest }) });
};

describe("/dev/fake-storage", () => {
  it("takes the browser's PUT and GET on the same fake the server uses", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const path = newStoragePath();
    const { url } = await createSignedUploadUrl(path);
    expect(url.startsWith("http://localhost:3000/dev/fake-storage/object/upload/sign/crm-files/files/")).toBe(true);
    const put = await call("PUT", url, "%PDF-1.4 hello", { "content-type": "application/pdf" });
    expect(put.status).toBe(200);
    expect(await objectInfo(path)).toEqual({ size: 14, contentType: "application/pdf" });
    expect(new TextDecoder().decode(await readHead(path, 5))).toBe("%PDF-");
    const get = await call("GET", await signedUrl(path, { download: "a.pdf" }));
    expect(get.headers.get("content-disposition")).toMatch(/^attachment; filename="a.pdf"/);
    expect(await get.text()).toBe("%PDF-1.4 hello");
  });

  it.each([
    ["production", undefined, ""],
    ["test", "preview", ""],
    ["test", undefined, "https://abc.supabase.co"],
  ])("answers 404 with APP_ENV=%s, VERCEL_ENV=%s, SUPABASE_URL=%s", async (appEnv, vercelEnv, supabaseUrl) => {
    vi.stubEnv("APP_ENV", appEnv);
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("SUPABASE_URL", supabaseUrl);
    vi.stubEnv("SUPABASE_SECRET_KEY", "k");
    const res = await call("GET", "http://localhost:3000/dev/fake-storage/object/sign/crm-files/files/x?token=y");
    expect(res.status).toBe(404);
  });
});
