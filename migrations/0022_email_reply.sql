-- SF-130: a reply or forward names the email it answers, so the sent email joins that email's conversation even when
-- it starts a new Gmail thread in the sender's mailbox (research.md §1). No hand link is made for it: the record
-- columns stay null.
alter table email_sends add column reply_message_id bigint null references email_messages (id) on delete set null;
