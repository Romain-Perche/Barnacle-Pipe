"use client";
// Step 1 FILE (SF-103 research.md §2): the file is checked for size here, then sent in parts of 512 KiB (Vercel and
// server actions refuse larger request bodies); the server reads and checks it. Errors are fixed messages only.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ImportKind } from "@/server/imports/columns";
import { MAX_BYTES, PART_BYTES } from "@/server/imports/csv";
import { messageFor, messages, templates } from "@/server/messages";
import { finishUpload, startImport, uploadPart } from "./actions";

type Props = {
  kind: ImportKind;
  // An own ready import ([ BACK ] from the columns step): [ NEXT ] goes on with it unless another file is chosen.
  chosen: { id: number; fileName: string; rowCount: number; next: string } | null;
  initialError: string | null;
};

export function FileStep({ kind, chosen, initialError }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function send(file: File): Promise<string | null> {
    if (file.size > MAX_BYTES) return "import_too_large";
    if (file.size === 0) return "import_no_rows";
    const started = await startImport(kind, file.name, file.size);
    if ("error" in started) return started.error;
    for (let index = 0, at = 0; at < file.size; index++, at += PART_BYTES) {
      const fd = new FormData();
      fd.set("id", String(started.id));
      fd.set("index", String(index));
      fd.set("part", file.slice(at, at + PART_BYTES));
      const part = await uploadPart(fd);
      if ("error" in part) return part.error;
    }
    const fd = new FormData();
    fd.set("id", String(started.id));
    const done = await finishUpload(fd);
    if ("error" in done) return done.error;
    router.push(done.next);
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      if (chosen) router.push(chosen.next);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = await send(file);
      if (code) {
        setError(code);
        setBusy(false);
      }
    } catch {
      setError("import_upload_failed");
      setBusy(false);
    }
  }

  return (
    <form className="import-file" onSubmit={onSubmit}>
      {error && (
        <p className="err" role="alert">
          {messageFor(error) ?? messages.import_upload_failed}
        </p>
      )}
      <p className="hint">{messages.import_note}</p>
      {chosen && (
        <p className="chosen">
          Chosen: <span className="nm">{chosen.fileName}</span> ({templates.import_rows(chosen.rowCount)})
        </p>
      )}
      <label className="field">
        <span>{chosen ? "Choose another file" : "CSV file"}</span>
        <input ref={input} className="input" type="file" name="file" accept=".csv,text/csv" required={!chosen} disabled={busy} />
      </label>
      <div className="import-acts">
        <a className="btn" href={`/${kind}/import/example`} download>
          [ DOWNLOAD EXAMPLE FILE ]
        </a>
        <button className="btn solid" type="submit" disabled={busy}>
          [ NEXT ]
        </button>
      </div>
    </form>
  );
}
