// Preview an image or a PDF in the browser; any other kind is downloaded: see ../../file-route.ts (SF-116).
import { fileRoute } from "../../file-route";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return fileRoute((await params).id, "preview");
}
