"use client";
// [ ADD FILE ] of "// FILES" (SF-116 contracts/routes.md § Server actions): picks one or more files, then for each in
// turn: the same checks as the server (validateFile), startFileUpload, a PUT of the file straight to the signed
// address with "Uploading <name>… <n>%", finishFileUpload. Then the section is refreshed, "File added." when at least
// one was listed and one line per refused file. File names are text nodes only.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { validateFile } from "@/server/files/rules";
import { messages, templates } from "@/server/messages";
import { finishFileUpload, startFileUpload } from "./file-actions";

type Notice = { ok: boolean; text: string };

function refusal(code: string, name: string): string {
  switch (code) {
    case "file_too_large":
    case "file_empty":
    case "file_name_too_long":
      return templates[code](name);
    case "files_archived":
    case "file_record_not_found":
    case "files_unreachable":
      return messages[code];
    default:
      return templates.file_upload_failed(name);
  }
}

// The file goes straight to Storage (never through the app): true once Storage answered 2xx.
export function put(url: string, contentType: string, file: File, onProgress: (n: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.floor((e.loaded * 100) / e.total));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve(false);
    xhr.send(file);
  });
}

const failed = { error: "file_upload_failed" } as const;

export function AddFiles({ kind, id }: { kind: "deal" | "person" | "organisation"; id: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  async function upload(files: File[]) {
    setBusy(true);
    setNotices([]);
    const refused: string[] = [];
    let added = 0;
    for (const file of files) {
      const valid = validateFile({ name: file.name, size: file.size });
      if (!valid.ok) {
        refused.push(templates[valid.code](file.name));
        continue;
      }
      setProgress(templates.file_uploading(file.name, 0));
      const start = await startFileUpload({ kind, id, name: file.name, size: file.size }).catch(() => failed);
      if ("error" in start) {
        refused.push(refusal(start.error, file.name));
        continue;
      }
      const stored = await put(start.url, start.contentType, file, (n) => setProgress(templates.file_uploading(file.name, n)));
      if (!stored) {
        refused.push(templates.file_upload_failed(file.name));
        continue;
      }
      const finish = await finishFileUpload({ uploadId: start.uploadId }).catch(() => failed);
      if ("error" in finish) {
        refused.push(refusal(finish.error, file.name));
        continue;
      }
      added++;
    }
    setProgress(null);
    setBusy(false);
    setNotices([...(added > 0 ? [{ ok: true, text: messages.file_added }] : []), ...refused.map((text) => ({ ok: false, text }))]);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <>
      <button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}>
        [ ADD FILE ]
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Files to add"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          if (files.length > 0) void upload(files);
        }}
      />
      {(progress || notices.length > 0) && (
        <div className="upload-status">
          {progress && (
            <p className="uploading" role="status">
              {progress}
            </p>
          )}
          {notices.map((n, i) =>
            n.ok ? (
              <p key={i} className="notice" role="status">
                {n.text}
              </p>
            ) : (
              <p key={i} className="err" role="alert">
                {n.text}
              </p>
            ),
          )}
        </div>
      )}
    </>
  );
}
