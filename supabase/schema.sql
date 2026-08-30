-- Barny Branding Co. customer portal foundation
-- Run in a new Supabase project's SQL Editor as the project owner.
-- No passwords are stored here. Authentication is handled exclusively by Supabase Auth.

begin;

create extension if not exists pgcrypto;

-- Human-readable order number sequence. Only database functions use it.
create sequence if not exists public.barny_order_number_seq start 1001;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  company_name text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_email_not_blank check (length(trim(email)) > 3)
);

-- Membership in this table grants administrative database access.
-- There is deliberately no client-side INSERT policy for this table.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_date timestamptz not null default now(),
  total_amount numeric(14,2),
  payment_status text not null default 'not_set',
  order_status text not null default 'quote_requested',
  delivery_status text not null default 'not_scheduled',
  delivery_address text,
  expected_delivery_date date,
  actual_delivery_date date,
  tracking_number text unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_nonnegative check (total_amount is null or total_amount >= 0),
  constraint orders_payment_status_valid check (payment_status in
    ('not_set','quote_pending','unpaid','partially_paid','paid','refunded','cancelled')),
  constraint orders_order_status_valid check (order_status in
    ('quote_requested','under_review','negotiating','quote_sent','quote_agreed',
     'artwork_pending','artwork_review','artwork_approved','in_production',
     'quality_check','ready_for_delivery','completed','on_hold','cancelled')),
  constraint orders_delivery_status_valid check (delivery_status in
    ('not_scheduled','scheduled','processing','ready_for_dispatch','dispatched',
     'in_transit','ready_for_collection','delivered','delivery_failed','returned','cancelled')),
  constraint orders_delivery_dates_valid check (
    actual_delivery_date is null or expected_delivery_date is null or
    actual_delivery_date >= order_date::date
  )
);

create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_order_date_idx on public.orders(order_date desc);
create index if not exists orders_order_status_idx on public.orders(order_status);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_name text not null,
  quantity integer not null,
  unit_price numeric(14,2),
  subtotal numeric(14,2),
  constraint order_items_product_not_blank check (length(trim(product_name)) > 0),
  constraint order_items_quantity_valid check (quantity between 1 and 100000),
  constraint order_items_unit_price_nonnegative check (unit_price is null or unit_price >= 0),
  constraint order_items_subtotal_nonnegative check (subtotal is null or subtotal >= 0)
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists order_status_history_order_idx
  on public.order_status_history(order_id, created_at desc);

-- Detailed delivery record. The summary fields remain on orders for fast dashboard display.
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  delivery_address text,
  courier_name text,
  tracking_number text,
  delivery_status text not null default 'not_scheduled',
  expected_delivery_date date,
  actual_delivery_date date,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint deliveries_status_valid check (delivery_status in
    ('not_scheduled','scheduled','processing','ready_for_dispatch','dispatched',
     'in_transit','ready_for_collection','delivered','delivery_failed','returned','cancelled'))
);

create index if not exists deliveries_status_idx on public.deliveries(delivery_status);

-- ---------- Utility and audit functions ----------

drop function if exists public.is_admin(uuid);
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sequence_value bigint;
begin
  sequence_value := nextval('public.barny_order_number_seq');
  return 'BBC-' || to_char(current_date, 'YYYY') || '-' || lpad(sequence_value::text, 6, '0');
end;
$$;

revoke all on function public.next_order_number() from public, anon, authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.sync_customer_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.email is distinct from new.email then
    update public.customers
       set email = coalesce(new.email, email), updated_at = now()
     where auth_user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_customer_email();

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
  end if;
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
drop trigger if exists orders_set_updated_at on public.orders;
drop trigger if exists deliveries_set_updated_at on public.deliveries;
drop trigger if exists status_history_set_updated_at on public.order_status_history;
drop trigger if exists orders_log_status_change on public.orders;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();
create trigger status_history_set_updated_at
  before update on public.order_status_history
  for each row execute function public.set_updated_at();
create trigger orders_log_status_change
  after update of order_status on public.orders
  for each row execute function public.log_order_status_change();

create or replace function public.sync_order_delivery_details()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.deliveries (
    order_id, delivery_address, tracking_number, delivery_status,
    expected_delivery_date, actual_delivery_date, delivered_at, updated_by
  ) values (
    new.id, new.delivery_address, new.tracking_number, new.delivery_status,
    new.expected_delivery_date, new.actual_delivery_date,
    case when new.delivery_status = 'delivered' then coalesce(new.actual_delivery_date::timestamptz, now()) else null end,
    auth.uid()
  )
  on conflict (order_id) do update set
    delivery_address = excluded.delivery_address,
    tracking_number = excluded.tracking_number,
    delivery_status = excluded.delivery_status,
    expected_delivery_date = excluded.expected_delivery_date,
    actual_delivery_date = excluded.actual_delivery_date,
    delivered_at = excluded.delivered_at,
    updated_by = excluded.updated_by,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_sync_delivery_details on public.orders;
create trigger orders_sync_delivery_details
  after update of delivery_address, tracking_number, delivery_status,
    expected_delivery_date, actual_delivery_date on public.orders
  for each row execute function public.sync_order_delivery_details();

-- Customers use this controlled function to create quote-stage orders.
-- Prices and company-controlled statuses are not accepted from the browser.
create or replace function public.create_customer_order(
  requested_delivery_address text,
  customer_notes text,
  items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_customer_id uuid;
  new_order_id uuid;
  invalid_item_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into current_customer_id
  from public.customers
  where auth_user_id = auth.uid();

  if current_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'At least one order item is required';
  end if;

  select count(*) into invalid_item_count
  from jsonb_to_recordset(items) as x(product_name text, quantity integer)
  where length(trim(coalesce(product_name, ''))) = 0
     or quantity is null
     or quantity < 1
     or quantity > 100000;

  if invalid_item_count > 0 then
    raise exception 'One or more order items are invalid';
  end if;

  insert into public.orders (
    order_number, customer_id, delivery_address, notes,
    total_amount, payment_status, order_status, delivery_status
  ) values (
    public.next_order_number(), current_customer_id,
    nullif(trim(requested_delivery_address), ''),
    nullif(trim(customer_notes), ''),
    null, 'quote_pending', 'quote_requested', 'not_scheduled'
  ) returning id into new_order_id;

  insert into public.order_items (order_id, product_name, quantity, unit_price, subtotal)
  select new_order_id, trim(x.product_name), x.quantity, null, null
  from jsonb_to_recordset(items) as x(product_name text, quantity integer);

  insert into public.order_status_history(order_id, status, description, updated_by)
  values (new_order_id, 'quote_requested',
          'Quote request received. Barny Branding Co. will review the requirements and discuss the customer budget.',
          auth.uid());

  insert into public.deliveries(order_id, delivery_address, delivery_status, updated_by)
  values (new_order_id, nullif(trim(requested_delivery_address), ''), 'not_scheduled', auth.uid());

  return new_order_id;
end;
$$;

revoke all on function public.create_customer_order(text, text, jsonb) from public, anon;
grant execute on function public.create_customer_order(text, text, jsonb) to authenticated;

-- ---------- Row Level Security ----------

alter table public.customers enable row level security;
alter table public.admin_users enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.deliveries enable row level security;

-- Customers: own profile only. Administrators can view all profiles.
create policy customers_select_own_or_admin on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

create policy customers_update_own_or_admin on public.customers
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_admin())
  with check (auth_user_id = auth.uid() or public.is_admin());

-- Admin membership is visible only to the logged-in member and administrators.
-- No insert/update/delete client policy is provided.
create policy admin_users_select_self_or_admin on public.admin_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Orders: customers can read their own. Only administrators can mutate directly.
create policy orders_select_own_or_admin on public.orders
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.customers c
      where c.id = orders.customer_id and c.auth_user_id = auth.uid()
    )
  );

create policy orders_admin_insert on public.orders
  for insert to authenticated
  with check (public.is_admin());
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy orders_admin_delete on public.orders
  for delete to authenticated
  using (public.is_admin());

-- Items: customers read items through ownership of the parent order.
create policy order_items_select_own_or_admin on public.order_items
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id = order_items.order_id and c.auth_user_id = auth.uid()
    )
  );
create policy order_items_admin_insert on public.order_items
  for insert to authenticated with check (public.is_admin());
create policy order_items_admin_update on public.order_items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_items_admin_delete on public.order_items
  for delete to authenticated using (public.is_admin());

-- Status history: customers can read their own timeline; administrators manage it.
create policy history_select_own_or_admin on public.order_status_history
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id = order_status_history.order_id and c.auth_user_id = auth.uid()
    )
  );
create policy history_admin_insert on public.order_status_history
  for insert to authenticated with check (public.is_admin());
create policy history_admin_update on public.order_status_history
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy history_admin_delete on public.order_status_history
  for delete to authenticated using (public.is_admin());

-- Deliveries: customers can read their own delivery information but cannot change it.
create policy deliveries_select_own_or_admin on public.deliveries
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id = deliveries.order_id and c.auth_user_id = auth.uid()
    )
  );
create policy deliveries_admin_insert on public.deliveries
  for insert to authenticated with check (public.is_admin());
create policy deliveries_admin_update on public.deliveries
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy deliveries_admin_delete on public.deliveries
  for delete to authenticated using (public.is_admin());

-- ---------- API privileges ----------
revoke all on public.customers, public.admin_users, public.orders, public.order_items,
  public.order_status_history, public.deliveries from anon;

-- Authenticated customers can read only rows allowed by RLS.
grant select on public.customers, public.admin_users, public.orders, public.order_items,
  public.order_status_history, public.deliveries to authenticated;

-- Profile edits are restricted to customer-editable columns.
grant update (full_name, phone, company_name, address, updated_at)
  on public.customers to authenticated;

-- These privileges are useful to admins; RLS blocks normal customers from mutations.
grant insert, update, delete on public.orders, public.order_items,
  public.order_status_history, public.deliveries to authenticated;

grant usage on schema public to authenticated;

commit;

-- BOOTSTRAP AN ADMIN (run manually in Supabase SQL Editor after that person signs up):
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
-- Do not expose a service-role key in frontend code.
