// Super-admin-only: promote an agent to super_admin, demote a super_admin
// back to agent, or deactivate a staff account entirely (removes them from
// admin_users and bans the auth user so they can no longer sign in).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ACTIONS = new Set(['promote', 'demote', 'deactivate']);

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
    if (rpcErr || !isSuper) return json({ error: 'Only a super admin can manage agent accounts' }, 403);

    const { action, user_id } = await req.json();
    if (!ACTIONS.has(action) || !user_id) {
      return json({ error: 'action must be promote, demote or deactivate, and user_id is required' }, 400);
    }
    if (user_id === user.id && action === 'deactivate') {
      return json({ error: 'You cannot deactivate your own account' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (action === 'promote') {
      const { error } = await admin.from('admin_users').update({ role: 'super_admin' }).eq('user_id', user_id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === 'demote') {
      const { error } = await admin.from('admin_users').update({ role: 'agent' }).eq('user_id', user_id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === 'deactivate') {
      const { error: delErr } = await admin.from('admin_users').delete().eq('user_id', user_id);
      if (delErr) return json({ error: delErr.message }, 400);
      const { error: banErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: '876000h' });
      if (banErr) return json({ error: banErr.message }, 400);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: (err as Error).message || 'Unexpected error' }, 500);
  }
});
