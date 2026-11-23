import { FilePage } from "../../records/import/ImportPages";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: Search }) {
  return <FilePage kind="people" searchParams={searchParams} />;
}
