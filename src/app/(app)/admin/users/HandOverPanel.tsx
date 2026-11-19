"use client";
// The hand-over panel above the Users table (SF-92 design B). Client only to update the question and the
// explanation as the user choice changes; the form posts to a server action and works without JavaScript.
// It never shows who the people are: only how many.
import Link from "next/link";
import { useState } from "react";
import { messages, templates } from "@/server/messages";

type Props = {
  fromUserId: number;
  fromName: string;
  count: number;
  users: { id: number; name: string }[];
  error?: string;
  action: (formData: FormData) => Promise<void>;
};

export function HandOverPanel({ fromUserId, fromName, count, users, error, action }: Props) {
  const [chosenId, setChosenId] = useState("");
  const chosen = users.find((u) => String(u.id) === chosenId)?.name;
  return (
    <form action={action} className="handover" aria-label={messages.handover_to_label}>
      <input type="hidden" name="userId" value={fromUserId} />
      <p className="q">{chosen ? templates.handover_question(fromName, count, chosen) : ""}</p>
      {error && (
        <p className="handover-err" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <select className="input" name="toUserId" aria-label={messages.handover_to_label} value={chosenId} onChange={(e) => setChosenId(e.target.value)}>
          <option value="">{messages.handover_choose}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn solid" type="submit">
          {messages.handover_button}
        </button>
        <Link className="btn link" href="/admin/users">
          {messages.handover_cancel}
        </Link>
      </div>
      <p className="hint">{chosen ? templates.handover_explain(chosen) : messages.handover_explain_unchosen}</p>
    </form>
  );
}
