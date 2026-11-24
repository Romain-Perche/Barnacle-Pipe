// A file name as a link (SF-116): plain <a>, never next/link (it would prefetch the download route). The name is a
// text node only.
import { fileHref, type FileKind } from "@/server/files/rules";

export function FileLink({ file, page, className, label, children }: {
  file: { id: number; kind: FileKind }; page: string; className?: string; label?: string; children: React.ReactNode;
}) {
  const { href, newTab } = fileHref(file, page);
  return (
    <a className={className} href={href} aria-label={label} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}
