// A message next to a form field. Duplicate / "already exists" messages link to the record named.
import Link from "next/link";
import { fieldMessage } from "@/server/messages";
import type { FieldError as Err } from "@/server/records/rules";

export function FieldError({ error, id }: { error?: Err; id?: string }) {
  if (!error) return null;
  const text = fieldMessage(error);
  if (!text) return null;
  return (
    <p className="ferr" id={id} role="alert">
      {error.href ? <Link href={error.href}>{text}</Link> : text}
    </p>
  );
}
