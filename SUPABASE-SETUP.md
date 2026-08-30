# Barny Branding Co. — Supabase backend setup

The repository now contains a Supabase-ready authentication, database and portal foundation. No custom password storage is used. Passwords, sessions, email verification and password recovery are handled by Supabase Authentication.

## 1. Create and configure the Supabase project

1. Create a Supabase project.
2. In **SQL Editor**, run `supabase/schema.sql` once as the project owner.
3. Open **Authentication → Providers → Email** and enable email/password authentication.
4. Keep email confirmation enabled for production.
5. Under **Authentication → URL Configuration**, add the production website URL and these redirect URLs:
   - `/account/login.html`
   - `/account/reset-password.html`
   - `/account/dashboard.html`
6. Copy the project URL and public anonymous key from **Project Settings → API**.
7. Put only those two public values in `assets/js/supabase-config.js`.

Never place the Supabase service-role key in HTML, JavaScript, Git, localStorage or any browser-accessible file.

## 2. Create the first administrator

Administrators must first create a normal account through `account/register.html` and confirm their email. Then run this in the Supabase SQL Editor, replacing the email:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
```

There is no browser policy that allows a normal user to add themselves to `admin_users`. The operation must be completed by the database owner or a trusted server using the service role.

## 3. Pages and modules

### Customer pages

- `account/register.html` — Supabase signup
- `account/login.html` — Supabase email/password login
- `account/reset-password.html` — reset email and password update
- `account/dashboard.html` — own profile and own orders
- `account/order.html` — own order items, payment/delivery summary and status history

### Admin page

- `admin/index.html` — authenticated admin order management

The admin page is protected in two layers:

1. The frontend checks the `is_admin()` database function.
2. PostgreSQL Row Level Security rejects unauthorized reads and writes even if someone bypasses the interface.

### JavaScript

- `assets/js/supabase-config.js` — public project URL and anon key
- `assets/js/supabase-client.js` — singleton client, session and access guards
- `assets/js/auth.js` — signup, login, logout and password reset
- `assets/js/data.js` — profile/order/customer-safe data access and admin operations
- `assets/js/account-page.js` — account page controllers
- `assets/js/admin-page.js` — admin page controller
- `assets/js/home-order-integration.js` — converts an authenticated website quote cart into a database order

## 4. Order submission behavior

Before Supabase is configured, the existing website and Web3Forms quote behavior remain available.

After Supabase is configured:

1. A customer builds a quote cart on the existing website.
2. On quote submission, signed-out customers are directed to Supabase login.
3. A signed-in customer’s cart is submitted through `create_customer_order()`.
4. The database—not the browser—assigns ownership, order number and initial statuses.
5. Prices are left `NULL` while Barny and the customer negotiate specifications and budget.
6. The order, items, initial history entry and delivery placeholder are created together.
7. The customer is sent to the protected order page.

The browser cannot submit payment status, order status, unit prices, totals or company-controlled delivery fields through this function.

## 5. Row Level Security summary

A customer can:

- Read their own customer profile
- Update only their own editable profile fields
- Read only their own orders
- Read only items belonging to their orders
- Read only history belonging to their orders
- Read only delivery records belonging to their orders
- Create a quote-stage order through the controlled database function

A customer cannot:

- Read another customer’s records
- Directly insert, update or delete orders
- Change payment status
- Change order status
- Set prices or totals
- Change company-controlled delivery information
- Add themselves as an administrator

An administrator is an authenticated Supabase user whose UUID is present in `public.admin_users`. Admin RLS policies allow order-management operations and status changes are written to `order_status_history` by a database trigger.

## 6. Hosting requirements

Serve the project over HTTPS through a web server. ES modules do not work reliably when pages are opened directly using `file://`. The site can be deployed to Netlify, Vercel, Cloudflare Pages or another static host.

The Supabase JavaScript SDK is currently imported as an ES module from `esm.sh`. If the project later adopts Vite, install `@supabase/supabase-js` through npm and replace that import with the package import.

## 7. Production recommendations before launch

- Configure a custom SMTP provider for reliable authentication emails.
- Add CAPTCHA or Supabase Turnstile protection to signup and password reset.
- Test every RLS policy using two separate customer accounts and one admin account.
- Configure database backups.
- Keep service-role operations in Supabase Edge Functions.
- Add rate limiting and server-side validation before integrating payments.
- Do not let a browser mark a payment as successful; use a verified payment webhook.
