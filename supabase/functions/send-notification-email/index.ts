// Called by a Supabase Database Webhook on every insert into public.notifications.
// Looks up the recipient's email and sends it via Resend. Deployed with
// --no-verify-jwt (the webhook calls it without a user session) but guarded
// by a shared secret header set on the webhook itself.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('NOTIFICATION_FROM_EMAIL') || 'Barny Branding Co. <onboarding@resend.dev>';
const WEBHOOK_SECRET = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await req.json();
    const record = payload?.record;
    if (!record?.recipient_user_id) return json({ ok: true, skipped: true });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userResp, error } = await admin.auth.admin.getUserById(record.recipient_user_id);
    if (error || !userResp?.user?.email) return json({ ok: true, skipped: true });

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: userResp.user.email,
        subject: record.title || 'Barny Branding Co. notification',
        text: record.body || ''
      })
    });

    if (!send.ok) {
      const detail = await send.text();
      console.error('Resend error:', detail);
      return json({ ok: false, error: detail }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || 'Unexpected error' }, 500);
  }
});
