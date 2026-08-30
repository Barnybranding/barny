// Super-admin-only: invites a new staff member by email and adds them to
// admin_users with role 'agent'. The service-role key never leaves this
// function; the caller is authenticated and authorized using their own JWT.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401);

    const { data: isSuper, error: rpcErr } = await userClient.rpc('is_super_admin');
    if (rpcErr || !isSuper) return json({ error: 'Only a super admin can create agent accounts' }, 403);

    const { email, full_name } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return json({ error: 'A valid email address is required' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role: 'agent', full_name: full_name || '' }
    });
    if (inviteErr) return json({ error: inviteErr.message }, 400);

    const { error: insertErr } = await admin
      .from('admin_users')
      .insert({ user_id: invited.user.id, role: 'agent' });
    if (insertErr) return json({ error: insertErr.message }, 400);

    return json({ ok: true, userId: invited.user.id, email });
  } catch (err) {
    return json({ error: (err as Error).message || 'Unexpected error' }, 500);
  }
});
