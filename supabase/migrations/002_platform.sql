-- Barny Branding Co. — platform migration
-- Run AFTER supabase/schema.sql on the same project.
-- Adds: staff roles (agent/super_admin), a fully editable product catalogue,
-- quote claiming/take-over, order chat, payment reference columns, and
-- in-app notifications. No service-role key is used anywhere in this file —
-- everything relies on RLS + security-definer functions, same as schema.sql.

begin;

-- ============================================================
-- 1. Staff roles
-- ============================================================

alter table public.admin_users add column if not exists role text not null default 'agent';

alter table public.admin_users drop constraint if exists admin_users_role_valid;
alter table public.admin_users add constraint admin_users_role_valid
  check (role in ('agent', 'super_admin'));

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.admin_users a where a.user_id = auth.uid() and a.role = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- Agent/super-admin accounts are created through the create-agent Edge
-- Function (auth.admin.inviteUserByEmail with role metadata) and must not
-- also get a customer profile row.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') = 'agent' then
    return new;
  end if;

  insert into public.customers (
    auth_user_id, full_name, email, phone, company_name, address
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'company_name', ''),
    nullif(new.raw_user_meta_data ->> 'address', '')
  )
  on conflict (auth_user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2. Product catalogue (replaces the hardcoded storefront array)
-- ============================================================

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text not null default '',
  image_url text,
  image_public_id text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(is_active);
create index if not exists product_categories_sort_idx on public.product_categories(sort_order);
create index if not exists products_sort_idx on public.products(category_id, sort_order);

drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;

drop policy if exists categories_select_all on public.product_categories;
create policy categories_select_all on public.product_categories
  for select using (true);
drop policy if exists categories_super_admin_insert on public.product_categories;
create policy categories_super_admin_insert on public.product_categories
  for insert to authenticated with check (public.is_super_admin());
drop policy if exists categories_super_admin_update on public.product_categories;
create policy categories_super_admin_update on public.product_categories
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists categories_super_admin_delete on public.product_categories;
create policy categories_super_admin_delete on public.product_categories
  for delete to authenticated using (public.is_super_admin());

drop policy if exists products_select_active_or_staff on public.products;
create policy products_select_active_or_staff on public.products
  for select using (is_active or public.is_admin());
drop policy if exists products_super_admin_insert on public.products;
create policy products_super_admin_insert on public.products
  for insert to authenticated with check (public.is_super_admin());
drop policy if exists products_super_admin_update on public.products;
create policy products_super_admin_update on public.products
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists products_super_admin_delete on public.products;
create policy products_super_admin_delete on public.products
  for delete to authenticated using (public.is_super_admin());

grant select on public.product_categories, public.products to anon, authenticated;
grant insert, update, delete on public.product_categories, public.products to authenticated;

-- ============================================================
-- 3. Quote claiming / take-over
-- ============================================================

alter table public.orders add column if not exists claimed_by uuid references public.admin_users(user_id) on delete set null;
alter table public.orders add column if not exists claimed_at timestamptz;
create index if not exists orders_claimed_by_idx on public.orders(claimed_by);

-- Visibility/management helpers shared by orders, items, history, deliveries and chat.
create or replace function public.can_view_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_super_admin()
    or exists (
      select 1 from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id = target_order_id and c.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
      where o.id = target_order_id and public.is_admin()
        and (o.claimed_by is null or o.claimed_by = auth.uid())
    );
$$;

create or replace function public.can_manage_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_super_admin() or exists (
    select 1 from public.orders o where o.id = target_order_id and o.claimed_by = auth.uid()
  );
$$;

create or replace function public.can_view_order_chat(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_manage_order(target_order_id) or exists (
    select 1 from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.id = target_order_id and c.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.can_view_order(uuid) from public;
revoke all on function public.can_manage_order(uuid) from public;
revoke all on function public.can_view_order_chat(uuid) from public;
grant execute on function public.can_view_order(uuid) to authenticated;
grant execute on function public.can_manage_order(uuid) to authenticated;
grant execute on function public.can_view_order_chat(uuid) to authenticated;

create or replace function public.claim_quote(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only staff can claim a quote request';
  end if;

  update public.orders
    set claimed_by = auth.uid(), claimed_at = now()
    where id = target_order_id and claimed_by is null
    returning * into updated_order;

  if updated_order.id is null then
    raise exception 'This request has already been claimed by another agent';
  end if;

  insert into public.notifications (recipient_user_id, type, order_id, title, body)
  select c.auth_user_id, 'quote_claimed', updated_order.id,
         'An agent is reviewing your request',
         'Your quote request ' || updated_order.order_number || ' is now being handled by our team.'
  from public.customers c where c.id = updated_order.customer_id;

  return updated_order;
end;
$$;

create or replace function public.take_over_quote(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only staff can take over a quote request';
  end if;

  update public.orders
    set claimed_by = auth.uid(), claimed_at = now()
    where id = target_order_id
    returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order not found';
  end if;

  insert into public.notifications (recipient_user_id, type, order_id, title, body)
  select c.auth_user_id, 'quote_claimed', updated_order.id,
         'A new agent picked up your request',
         'Your quote request ' || updated_order.order_number || ' is now being handled by a member of our team.'
  from public.customers c where c.id = updated_order.customer_id;

  return updated_order;
end;
$$;

create or replace function public.release_quote(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only staff can release a quote request';
  end if;

  update public.orders
    set claimed_by = null, claimed_at = null
    where id = target_order_id and (claimed_by = auth.uid() or public.is_super_admin())
    returning * into updated_order;

  if updated_order.id is null then
    raise exception 'Order not found or not claimed by you';
  end if;

  return updated_order;
end;
$$;

revoke all on function public.claim_quote(uuid) from public, anon;
revoke all on function public.take_over_quote(uuid) from public, anon;
revoke all on function public.release_quote(uuid) from public, anon;
grant execute on function public.claim_quote(uuid) to authenticated;
grant execute on function public.take_over_quote(uuid) to authenticated;
grant execute on function public.release_quote(uuid) to authenticated;

-- Re-scope orders/items/history/deliveries RLS around claim ownership.
drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_scoped on public.orders
  for select to authenticated using (public.can_view_order(id));

drop policy if exists orders_admin_insert on public.orders;
create policy orders_super_admin_insert on public.orders
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists orders_admin_update on public.orders;
create policy orders_staff_update on public.orders
  for update to authenticated using (public.can_manage_order(id)) with check (public.can_manage_order(id));

drop policy if exists orders_admin_delete on public.orders;
create policy orders_super_admin_delete on public.orders
  for delete to authenticated using (public.is_super_admin());

drop policy if exists order_items_select_own_or_admin on public.order_items;
create policy order_items_select_scoped on public.order_items
  for select to authenticated using (public.can_view_order(order_id));
drop policy if exists order_items_admin_insert on public.order_items;
create policy order_items_staff_insert on public.order_items
  for insert to authenticated with check (public.can_manage_order(order_id));
drop policy if exists order_items_admin_update on public.order_items;
create policy order_items_staff_update on public.order_items
  for update to authenticated using (public.can_manage_order(order_id)) with check (public.can_manage_order(order_id));
drop policy if exists order_items_admin_delete on public.order_items;
create policy order_items_staff_delete on public.order_items
  for delete to authenticated using (public.can_manage_order(order_id));

drop policy if exists history_select_own_or_admin on public.order_status_history;
create policy history_select_scoped on public.order_status_history
  for select to authenticated using (public.can_view_order(order_id));
drop policy if exists history_admin_insert on public.order_status_history;
create policy history_staff_insert on public.order_status_history
  for insert to authenticated with check (public.can_manage_order(order_id));
drop policy if exists history_admin_update on public.order_status_history;
create policy history_staff_update on public.order_status_history
  for update to authenticated using (public.can_manage_order(order_id)) with check (public.can_manage_order(order_id));
drop policy if exists history_admin_delete on public.order_status_history;
create policy history_staff_delete on public.order_status_history
  for delete to authenticated using (public.can_manage_order(order_id));

drop policy if exists deliveries_select_own_or_admin on public.deliveries;
create policy deliveries_select_scoped on public.deliveries
  for select to authenticated using (public.can_view_order(order_id));
drop policy if exists deliveries_admin_insert on public.deliveries;
create policy deliveries_staff_insert on public.deliveries
  for insert to authenticated with check (public.can_manage_order(order_id));
drop policy if exists deliveries_admin_update on public.deliveries;
create policy deliveries_staff_update on public.deliveries
  for update to authenticated using (public.can_manage_order(order_id)) with check (public.can_manage_order(order_id));
drop policy if exists deliveries_admin_delete on public.deliveries;
create policy deliveries_staff_delete on public.deliveries
  for delete to authenticated using (public.can_manage_order(order_id));

-- Customer-visible order status changes now also raise a notification.
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.order_status is distinct from new.order_status then
    insert into public.order_status_history(order_id, status, description, updated_by)
    values (
      new.id,
      new.order_status,
      'Order status changed from ' || old.order_status || ' to ' || new.order_status,
      auth.uid()
    );

    insert into public.notifications (recipient_user_id, type, order_id, title, body)
    select c.auth_user_id, 'order_status_changed', new.id,
           'Order ' || new.order_number || ' status updated',
           'Status changed to ' || replace(new.order_status, '_', ' ') || '.'
    from public.customers c where c.id = new.customer_id;
  end if;
  return new;
end;
$$;

-- ============================================================
-- 4. Order chat
-- ============================================================

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'agent', 'super_admin')),
  body text not null default '',
  attachment_url text,
  attachment_name text,
  created_at timestamptz not null default now(),
  constraint order_messages_body_or_attachment check (length(trim(body)) > 0 or attachment_url is not null)
);

create index if not exists order_messages_order_id_idx on public.order_messages(order_id, created_at);

alter table public.order_messages enable row level security;

drop policy if exists order_messages_select on public.order_messages;
create policy order_messages_select on public.order_messages
  for select to authenticated using (public.can_view_order_chat(order_id));
drop policy if exists order_messages_insert on public.order_messages;
create policy order_messages_insert on public.order_messages
  for insert to authenticated with check (
    public.can_view_order_chat(order_id) and sender_id = auth.uid()
  );

grant select, insert on public.order_messages to authenticated;

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders;
  customer_user_id uuid;
begin
  select * into order_row from public.orders where id = new.order_id;
  select auth_user_id into customer_user_id from public.customers where id = order_row.customer_id;

  if new.sender_id = customer_user_id then
    if order_row.claimed_by is not null then
      insert into public.notifications(recipient_user_id, type, order_id, title, body)
      values (order_row.claimed_by, 'new_message', new.order_id,
              'New message on ' || order_row.order_number, left(new.body, 200));
    else
      insert into public.notifications(recipient_user_id, type, order_id, title, body)
      select a.user_id, 'new_message', new.order_id,
             'New message on ' || order_row.order_number, left(new.body, 200)
      from public.admin_users a;
    end if;
  else
    insert into public.notifications(recipient_user_id, type, order_id, title, body)
    values (customer_user_id, 'new_message', new.order_id,
            'New reply on ' || order_row.order_number, left(new.body, 200));
  end if;
  return new;
end;
$$;

drop trigger if exists order_messages_notify on public.order_messages;
create trigger order_messages_notify
  after insert on public.order_messages
  for each row execute function public.notify_new_message();

-- ============================================================
-- 5. Payment reference columns (values are only ever written by the
--    verify-flutterwave-payment Edge Function using the service role key —
--    never directly by a browser client)
-- ============================================================

alter table public.orders add column if not exists payment_reference text unique;
alter table public.orders add column if not exists payment_verified_at timestamptz;

-- ============================================================
-- 6. In-app notifications
-- ============================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  order_id uuid references public.orders(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications(recipient_user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_user_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

-- No client insert policy: every notification is written by a security-definer
-- function/trigger (claim/take_over_quote, order status changes, new
-- messages) or the verify-flutterwave-payment Edge Function.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify_new_quote_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (recipient_user_id, type, order_id, title, body)
  select a.user_id, 'new_quote_request', new.id,
         'New quote request ' || new.order_number,
         'A customer submitted a new quote request awaiting an agent.'
  from public.admin_users a;
  return new;
end;
$$;

drop trigger if exists orders_notify_new_quote on public.orders;
create trigger orders_notify_new_quote
  after insert on public.orders
  for each row execute function public.notify_new_quote_request();

commit;

-- After this migration:
-- 1. Bootstrap the first super admin (same idea as the old admin bootstrap,
--    but set the role):
--      insert into public.admin_users (user_id, role)
--      select id, 'super_admin' from auth.users where email = 'YOUR_EMAIL';
-- 2. See SUPABASE-SETUP.md for Edge Function deployment (create-agent,
--    manage-agent, verify-flutterwave-payment, send-notification-email) and
--    the Database Webhook that wires notifications -> email.
