-- Wires public.notifications inserts to the send-notification-email Edge
-- Function using pg_net, since this project's Database Webhooks UI helper
-- (supabase_functions.http_request) was not pre-provisioned. Functionally
-- equivalent to a Dashboard-created webhook.
--
-- The shared webhook secret is stored in Supabase Vault (never in this
-- file / git) under the name 'notification_webhook_secret':
--   select vault.create_secret('<value>', 'notification_webhook_secret', 'send-notification-email shared secret');

begin;

create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault, pg_temp
as $$
declare
  shared_secret text;
begin
  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  perform net.http_post(
    url := 'https://yrazvsrgiawfdhsailyj.supabase.co/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(shared_secret, '')
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_email on public.notifications;
create trigger notifications_dispatch_email
  after insert on public.notifications
  for each row execute function public.dispatch_notification_email();

commit;
