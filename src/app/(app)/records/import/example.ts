// GET /<kind>/import/example: the example file (research.md §10). No ".csv" in the path, so the proxy covers it.
import { requireUser } from "@/server/auth/session";
import { exampleCsv, type ImportKind } from "@/server/imports/columns";

export async function exampleFile(kind: ImportKind): Promise<Response> {
  await requireUser();
  return new Response(exampleCsv(kind), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-example.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
