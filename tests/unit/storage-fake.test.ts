// covers SF-116 FR-015, FR-010 (T014): the Storage fake follows Supabase's OpenAPI file (a wrong field, a missing
// field, an unknown query parameter fail) and behaves like Storage (one-path tokens, 60 s read addresses, no overwrite,
// attachment on download, 25 MB limit), through the app's storage module.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSignedUploadUrl, newStoragePath, objectInfo, readHead, removeObjects, signedUrl } from "@/server/files/storage";
import { StorageFake } from "../fakes/storage";

const fake = new StorageFake();
beforeAll(() => void fake.install());
afterAll(() => fake.uninstall());

const auth = { authorization: "Bearer fake-storage-key", apikey: "fake-storage-key" };
const url = (route: string) => `${fake.baseUrl}${route}`;

describe("schema checks", () => {
  it("refuses a body property the schema does not have (expires on /object/sign)", async () => {
    await expect(
      fake.fetch(url("/object/sign/crm-files/files/a"), { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 60, expires: 1 }) }),
    ).rejects.toThrow(/no property "expires"/);
  });
  it("refuses a body without a required property (expiresIn)", async () => {
    await expect(
      fake.fetch(url("/object/sign/crm-files/files/a"), { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" }),
    ).rejects.toThrow(/needs "expiresIn"/);
  });
  it("refuses a wrong type (expiresIn as a string)", async () => {
    await expect(
      fake.fetch(url("/object/sign/crm-files/files/a"), { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: "60" }) }),
    ).rejects.toThrow(/expiresIn must be integer/);
  });
  it("refuses paths instead of prefixes on the bulk delete", async () => {
    await expect(
      fake.fetch(url("/object/crm-files"), { method: "DELETE", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ paths: ["files/a"] }) }),
    ).rejects.toThrow(/no property "paths"/);
  });
  it("refuses an unknown query parameter and an unknown path", async () => {
    await expect(fake.fetch(url("/object/sign/crm-files/files/a?token=x&filename=a.pdf"))).rejects.toThrow(/"filename" is not in the schema/);
    await expect(fake.fetch(url("/object/rename/crm-files/files/a"), { method: "PATCH", headers: auth })).rejects.toThrow(/no PATCH/);
  });
});

describe("the happy path and Storage's rules", () => {
  it("signs an upload, takes the PUT once, reads info and the first bytes, signs a 60 s read, gives an attachment", async () => {
    const path = newStoragePath();
    expect(path).toMatch(/^files\/[0-9a-f-]{36}$/);
    const { url: upload } = await createSignedUploadUrl(path);
    expect(upload.startsWith(`${fake.baseUrl}/object/upload/sign/crm-files/${path}?token=`)).toBe(true);
    const bytes = new TextEncoder().encode("%PDF-1.4 fake content");
    const put = await fake.fetch(upload, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ Key: `crm-files/${path}` });
    const again = await fake.fetch(upload, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes });
    expect(again.status).toBe(409);

    expect(await objectInfo(path)).toEqual({ size: bytes.length, contentType: "application/pdf" });
    expect(await objectInfo("files/none")).toBeNull();
    expect(new TextDecoder().decode(await readHead(path, 5))).toBe("%PDF-");

    const read = await signedUrl(path, { download: "契約 a_b.pdf" });
    expect(read).toContain("&download=%E5%A5%91%E7%B4%84%20a_b.pdf");
    const got = await fake.fetch(read);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-disposition")).toMatch(/^attachment; filename="__ a_b.pdf"; filename\*=UTF-8''/);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    const inline = await fake.fetch(await signedUrl(path));
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect(inline.headers.get("content-type")).toBe("application/pdf");

    const sign = fake.requests.filter((r) => r.route.startsWith("/object/sign/") && r.method === "POST");
    expect(sign.every((r) => (r.body as { expiresIn: number }).expiresIn === 60)).toBe(true);

    fake.advance(61_000);
    const late = await fake.fetch(read);
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ error: "InvalidJWT" });
    fake.advance(0);

    await removeObjects([path, "files/never-there"]);
    expect(await objectInfo(path)).toBeNull();
  });

  it("gives a token for one path only, refuses a wrong key and a body over 25 MB", async () => {
    const a = newStoragePath();
    const b = newStoragePath();
    const { url: upload } = await createSignedUploadUrl(a);
    const token = new URL(upload).searchParams.get("token");
    const other = await fake.fetch(url(`/object/upload/sign/crm-files/${b}?token=${token}`), { method: "PUT", body: "x" });
    expect(other.status).toBe(400);
    const noKey = await fake.fetch(url(`/object/info/authenticated/crm-files/${a}`), { headers: { authorization: "Bearer wrong", apikey: "wrong" } });
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toMatchObject({ statusCode: "403" });
    const big = await fake.fetch(upload, { method: "PUT", body: new Uint8Array(26_214_401) });
    expect(big.status).toBe(413);
    // An upload token never reads.
    const read = await fake.fetch(url(`/object/sign/crm-files/${a}?token=${token}`));
    expect(read.status).toBe(400);
  });

  it("answers down() as unreachable", async () => {
    fake.down();
    await expect(objectInfo("files/x")).rejects.toThrow("Storage can't be reached");
    fake.down(false);
  });
});
