# Barny Branding Co. — platform setup

Supabase Authentication handles all passwords, sessions, email verification and password recovery — no custom password storage exists anywhere in this repo. Row Level Security (RLS) is the source of truth for every permission; the frontend checks are a convenience, not the actual security boundary.

**Status on the live project (`yrazvsrgiawfdhsailyj`):** all migrations through `005_realtime_and_fixes.sql` have been applied. `assets/js/supabase-config.js` and `assets/js/cloudinary-config.js` already point at the live project. Live at **https://www.barny.online** (also served at `barny.vercel.app` and the bare `barny.online`, which redirects to `www`). Supabase Auth's Site URL and redirect allow-list are set to the real domain, and Auth emails go through Resend's SMTP relay (`noreply@barny.online`) instead of Supabase's shared, heavily-rate-limited default sender — see section 8.

## 1. Account tiers

- **super_admin** — the business owner. Full access to everything: all orders/chats, agent management, the product catalogue.
- **agent** — customer-facing staff, created only by a super admin (via `create-agent`, never through public registration). Can see the shared waiting list of unclaimed quote requests and any order they've personally claimed.
- **customer** — self-registers through `account/register.html`, unchanged from before.

Role is stored in `public.admin_users.role` (`'agent'` or `'super_admin'`). `public.is_admin()` means "any staff member"; `public.is_super_admin()` means specifically the owner tier.

### Bootstrapping the first super admin

There's no one to invite the very first super admin, so this one step stays manual: have that person register normally through `account/register.html`, confirm their email, then run in the Supabase SQL Editor:

```sql
insert into public.admin_users (user_id, role)
select id, 'super_admin' from auth.users where email = 'YOUR_EMAIL';
```

Every agent after that is created by a super admin from `admin/agents.html`, which calls the `create-agent` Edge Function — no more manual SQL for staff accounts.

## 2. Quote → chat → payment flow

1. A customer adds products to their cart and submits a quote request (`create_customer_order`). It lands in the **waiting list** — visible to every agent and super admin, `claimed_by` is `null`.
2. Any available agent calls `claim_quote(order_id)` (atomic — fails if someone else claimed it first). The customer is notified.
3. Chat happens in `order_messages`, visible only to the order's customer, its current claimed agent, and any super admin. Attachments are uploaded to Cloudinary from the browser and the resulting URL is stored on the message.
4. If the claimed agent goes offline, any other agent (or super admin) can call `take_over_quote(order_id)` to reassign it to themselves — there is no presence/online tracking, take-over is simply always available so no chat gets stuck.
5. The agent sets a price (`total_amount`) and negotiates status through the same fields as before (`order_status`, `payment_status`, etc.).
6. Once a price is agreed, the customer pays online (Flutterwave integration is not wired up yet — see the note in section 5). Payment success is the **only** status flip that happens automatically; production → delivery → delivered are still flipped manually by staff.

## 3. Product catalogue

`product_categories` and `products` replace the old hardcoded array in `barny-ordering-site.html`. Anyone (including anonymous visitors) can read active rows; only a super admin can create/edit/delete categories or products (RLS-enforced, not just hidden UI). Images are hosted on Cloudinary — `image_url` + `image_public_id` are stored per product.

The original 234 hardcoded products (with their embedded images, re-uploaded to Cloudinary) have been migrated into these tables as the initial seed data, grouped into the categories that were already implicit in the storefront markup.

## 4. Edge Functions

Location: `supabase/functions/`. Deploy with the Supabase CLI (needs `supabase login` with a personal access token from your Supabase account, then `supabase link --project-ref yrazvsrgiawfdhsailyj`):

```bash
supabase functions deploy create-agent
supabase functions deploy manage-agent
supabase functions deploy send-notification-email --no-verify-jwt
```

- **`create-agent`** — super-admin-only. Invites a new staff member by email (`role: 'agent'` metadata) and adds them to `admin_users`.
- **`manage-agent`** — super-admin-only. `{ action: 'promote' | 'demote' | 'deactivate', user_id }`.
- **`send-notification-email`** — called by a **Database Webhook** (not a user), so it's deployed with `--no-verify-jwt` and instead checks a shared secret header.

All three functions are deployed and live on the project. Secrets are already set (`RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_WEBHOOK_SECRET`) via `supabase secrets set`. `barny.online` is verified in Resend and `NOTIFICATION_FROM_EMAIL` is `Barny Branding Co. <noreply@barny.online>` — confirmed delivering (checked via the Resend API's send log).

**Webhook wiring**: this project didn't have the Dashboard's Database Webhooks helper (`supabase_functions.http_request`) pre-provisioned, so `supabase/migrations/003_notification_webhook.sql` wires `public.notifications` inserts to `send-notification-email` directly via the `pg_net` extension instead — functionally identical to a Dashboard-created webhook. The shared secret is stored in **Supabase Vault** (`select vault.create_secret(value, 'notification_webhook_secret', ...)`), never committed to the repo; the trigger function looks it up by name at call time.

A payment-verification function (`verify-flutterwave-payment`) is planned but not built yet — Flutterwave integration was deliberately deferred.

## 5. Notifications

Every notable event (new quote request → all staff, new chat message → the other party, claim/take-over → customer, order status change → customer) writes a row to `public.notifications` via a security-definer trigger/function — never directly from the browser. The `send-notification-email` webhook turns each new row into an email via Resend. The frontend also reads `notifications` directly (RLS-scoped to `recipient_user_id = auth.uid()`) for the in-app notification bell.

## 6. Row Level Security summary

A customer can: read/update their own profile, read their own orders/items/history/deliveries, create a quote-stage order through `create_customer_order`, and read/send chat messages on their own orders. A customer cannot: read another customer's records, directly write order status/price/payment fields, or add themselves as staff.

An agent can: see the waiting list and any order they've claimed (past or present), chat on those orders, update those orders' status/price/delivery fields. An agent cannot: see or act on orders claimed by another agent, manage other staff accounts, or write to the product catalogue.

A super admin can do everything above, plus: see and act on every order regardless of claim, invite/promote/demote/deactivate agents, and manage the product catalogue.

## 7. Hosting

Plain HTML + ES modules, no build step. Deployed to Vercel as a static site from the [Barnybranding/barny](https://github.com/Barnybranding/barny) GitHub repo; Edge Functions live in Supabase, not in Vercel. ES modules require serving over `http(s)://`, not `file://`. Custom domain: `barny.online` (apex 308-redirects to `www.barny.online`, which is what Supabase's Site URL points at).

## 8. Email delivery

Two independent senders, both routed through Resend's verified `barny.online` domain:

- **Auth emails** (confirmation, password reset, etc.) — Supabase's built-in mailer, reconfigured to use Resend's SMTP relay instead of Supabase's shared/rate-limited default: `smtp.resend.com:465`, user `resend`, password = the Resend API key, sender `noreply@barny.online`. Set via `PATCH /v1/projects/{ref}/config/auth` (`smtp_host`/`smtp_port`/`smtp_user`/`smtp_pass`/`smtp_admin_email`/`smtp_sender_name`) — there's no CLI command for this, it's Dashboard/Management-API only.
- **Notification emails** (new quote, new chat message, etc.) — the `send-notification-email` Edge Function calling the Resend HTTP API directly, `NOTIFICATION_FROM_EMAIL` secret.

Both were verified sending for real (not just configured) by triggering a live signup and checking Resend's send log.

The project-wide Auth email rate limit (`rate_limit_email_sent`, an hourly figure — there's no separate daily setting) is set to 10/hour (~240/day headroom).

## 9. Catalogue image cleanup

`delete-cloudinary-asset` (super-admin-only Edge Function) deletes a Cloudinary asset by `public_id`, signing the request server-side with `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` secrets (never exposed to the browser — the unsigned upload preset used for uploads can't delete anything). `catalogue-admin.js` calls it automatically: after a product's image is replaced, the old one is deleted; after a product is deleted, its image is deleted. Both are best-effort (a Cloudinary hiccup won't block or fail the actual save/delete) and verified working end-to-end with a disposable test product.

## 10. Production recommendations still open

- Add CAPTCHA/Turnstile to signup and password reset.
- Configure database backups.
- Build and wire up `verify-flutterwave-payment` before accepting real payments; never let the browser mark a payment as successful directly.
