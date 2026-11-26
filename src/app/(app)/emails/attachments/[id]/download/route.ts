// GET /emails/attachments/<id>/download (SF-127 contracts/routes.md § download route, research.md §9): the session,
// the private rule (attachmentAccess → visibleConversation; hidden or missing → the same empty 404), then the bytes from
// Gmail through a working mailbox holding the email, streamed as a download (never shown by the browser). No working
// mailbox → a 303 back to the conversation with the "can't be fetched from Gmail right now" notice.
import { requireUser } from "@/server/auth/session";
import { attachmentAccess, fetchAttachment } from "@/server/emails/attachments";
import { contentDisposition } from "@/server/emails/rules";
import { parseId } from "@/server/records/list-query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHUNK = 1024 * 1024;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await requireUser();
  const id = parseId((await params).id);
  const access = id === null ? null : await attachmentAccess(user.id, id);
  if (!access) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const got = await fetchAttachment(access);
  const { conversationId, messageId } = access.attachment;
  if (got === "unavailable") {
    return new Response(null, {
      status: 303,
      headers: { location: `/emails/${conversationId}?notice=attachment-unavailable#email-${messageId}`, "cache-control": "no-store" },
    });
  }
  const bytes = got.bytes;
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(at, at + CHUNK));
      at += CHUNK;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": contentDisposition(access.attachment.name),
      "content-length": String(bytes.length),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
