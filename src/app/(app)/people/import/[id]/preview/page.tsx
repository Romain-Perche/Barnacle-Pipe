import { PreviewPage } from "../../../../records/import/ImportPages";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  return <PreviewPage kind="people" params={params} searchParams={searchParams} />;
}
