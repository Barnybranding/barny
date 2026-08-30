-- Enables Supabase Realtime for chat + notifications (the publication had
-- no tables at all, which is why new messages/notifications only appeared
-- after a manual page reload instead of live).

begin;

alter publication supabase_realtime add table public.order_messages;
alter publication supabase_realtime add table public.notifications;

commit;
