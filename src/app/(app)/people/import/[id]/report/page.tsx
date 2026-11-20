import { ReportPage } from "../../../../records/import/ImportPages";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ReportPage kind="people" params={params} />;
}
