// SF-130 (design B, contracts/routes.md § Buttons): at the right of an email's top line, [ REPLY ] [ REPLY ALL ]
// [ FORWARD ] as small framed buttons opening the email box on the same page (`base` ends with `email=`); without a
// working Gmail, one link to Settings in their place; Gmail off: nothing.
import Link from "next/link";
import type { ReplyState } from "@/server/emails/reply";
import { messages } from "@/server/messages";

export function ReplyButtons({ messageId, base, state }: { messageId: number; base: string; state: ReplyState }) {
  if (state === "off") return null;
  if (state !== "ok") {
    return (
      <span className="acts mini">
        <Link className="btn" href="/settings">
          {state === "connect" ? messages.reply_connect_gmail : messages.reply_reconnect_gmail}
        </Link>
      </span>
    );
  }
  return (
    <span className="acts mini">
      <Link className="btn" href={`${base}reply-${messageId}`} scroll={false}>
        {messages.reply_button}
      </Link>
      <Link className="btn" href={`${base}reply-all-${messageId}`} scroll={false}>
        {messages.reply_all_button}
      </Link>
      <Link className="btn" href={`${base}forward-${messageId}`} scroll={false}>
        {messages.forward_button}
      </Link>
    </span>
  );
}
