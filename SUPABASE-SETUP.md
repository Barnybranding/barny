# Barny Branding Co. — platform setup

Supabase Authentication handles all passwords, sessions, email verification and password recovery — no custom password storage exists anywhere in this repo. Row Level Security (RLS) is the source of truth for every permission; the frontend checks are a convenience, not the actual security boundary.

**Status on the live project (`yrazvsrgiawfdhsailyj`):** `supabase/schema.sql` and `supabase/migrations/002_platform.sql` have both been applied. `assets/js/supabase-config.js` and `assets/js/cloudinary-config.js` already point at the live project. Remaining manual steps are below.

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
- **`send-notification-email`** — called by a **Database Webhook** (not a user), so it's deployed with `--no-verify-jwt` and instead checks a shared secret header. Set it up in the Dashboard: **Database → Webhooks → Create a new hook** → table `notifications`, event `INSERT`, target the deployed function URL, and add an HTTP header `x-webhook-secret: <same value as NOTIFICATION_WEBHOOK_SECRET>`.

Required secrets (`supabase secrets set NAME=value`) — `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by the platform, everything else is not:

```bash
supabase secrets set RESEND_API_KEY=your_resend_key
supabase secrets set NOTIFICATION_FROM_EMAIL="Barny Branding Co. <onboarding@resend.dev>"
supabase secrets set NOTIFICATION_WEBHOOK_SECRET=a_random_string_you_pick
```

`NOTIFICATION_FROM_EMAIL` currently uses Resend's shared test address because no sending domain has been verified yet — real delivery to non-test inboxes will be limited until a domain is added and verified in Resend, at which point update this secret to an address on that domain.

A payment-verification function (`verify-flutterwave-payment`) is planned but not built yet — Flutterwave integration was deliberately deferred.

## 5. Notifications

Every notable event (new quote request → all staff, new chat message → the other party, claim/take-over → customer, order status change → customer) writes a row to `public.notifications` via a security-definer trigger/function — never directly from the browser. The `send-notification-email` webhook turns each new row into an email via Resend. The frontend also reads `notifications` directly (RLS-scoped to `recipient_user_id = auth.uid()`) for the in-app notification bell.

## 6. Row Level Security summary

A customer can: read/update their own profile, read their own orders/items/history/deliveries, create a quote-stage order through `create_customer_order`, and read/send chat messages on their own orders. A customer cannot: read another customer's records, directly write order status/price/payment fields, or add themselves as staff.

An agent can: see the waiting list and any order they've claimed (past or present), chat on those orders, update those orders' status/price/delivery fields. An agent cannot: see or act on orders claimed by another agent, manage other staff accounts, or write to the product catalogue.

A super admin can do everything above, plus: see and act on every order regardless of claim, invite/promote/demote/deactivate agents, and manage the product catalogue.

## 7. Hosting

Plain HTML + ES modules, no build step. Deployed to Vercel as a static site from the [Barnybranding/barny](https://github.com/Barnybranding/barny) GitHub repo; Edge Functions live in Supabase, not in Vercel. ES modules require serving over `http(s)://`, not `file://`.

## 8. Production recommendations before launch

- Configure a custom SMTP provider for Supabase auth emails (separate from the Resend notification emails above).
- Add CAPTCHA/Turnstile to signup and password reset.
- Verify a sending domain in Resend so notification emails aren't limited to the shared test address.
- Test every RLS policy with two customer accounts, two agent accounts and one super admin account.
- Configure database backups.
- Build and wire up `verify-flutterwave-payment` before accepting real payments; never let the browser mark a payment as successful directly.
