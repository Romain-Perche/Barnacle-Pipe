// GET /files/<id>/download and /files/<id>/preview (SF-116 contracts/routes.md § Routes, research.md §3): the session,
// then the private rules on every request (fileAccess → visibleFile), then a 303 to a Storage address valid for 60
// seconds made after the check. Anything else → /files/unavailable?reason=hidden|gone|unreachable. Every answer has
// Cache-Control: no-store and Referrer-Policy: no-referrer. No file byte ever passes through the app.
import { requireUser } from "@/server/auth/session";
import { fileAccess } from "@/server/files/files";
import { isPreviewable, safeDownloadName } from "@/server/files/rules";
import { signedUrl, StorageUnreachable } from "@/server/files/storage";
import { parseId } from "@/server/records/list-query";

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export async function fileRoute(idParam: string, mode: "download" | "preview"): Promise<Response> {
  const user = await requireUser();
  const access = await fileAccess(user.id, parseId(idParam));
  if (access.status !== "ok") return seeOther(`/files/unavailable?reason=${access.status}`);
  const file = access.file;
  if (mode === "preview" && !isPreviewable(file.kind)) return seeOther(`/files/${file.id}/download`);
  try {
    return seeOther(await signedUrl(file.storagePath, mode === "download" ? { download: safeDownloadName(file.name) } : {}));
  } catch (e) {
    if (e instanceof StorageUnreachable) return seeOther("/files/unavailable?reason=unreachable");
    throw e;
  }
}
