// Super-admin-only: deletes a Cloudinary asset by public_id. Used when a
// product's image is replaced or the product itself is deleted, so old
// images don't pile up forever. The Cloudinary API secret never reaches
// the browser -- only this function holds it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLOUDINARY_CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME')!;
const CLOUDINARY_API_KEY = Deno.env.get('CLOUDINARY_API_KEY')!;
const CLOUDINARY_API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET')!;

async function sha1Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    if (rpcErr || !isSuper) return json({ error: 'Only a super admin can delete catalogue assets' }, 403);

    const { public_id } = await req.json();
    if (!public_id || typeof public_id !== 'string') {
      return json({ error: 'public_id is required' }, 400);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sha1Hex(`public_id=${public_id}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`);

    const form = new FormData();
    form.append('public_id', public_id);
    form.append('api_key', CLOUDINARY_API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: 'POST',
      body: form
    });
    const cloudBody = await cloudRes.json();

    if (!cloudRes.ok || (cloudBody.result !== 'ok' && cloudBody.result !== 'not found')) {
      return json({ error: cloudBody.error?.message || 'Cloudinary deletion failed', cloudBody }, 502);
    }

    return json({ ok: true, result: cloudBody.result });
  } catch (err) {
    return json({ error: (err as Error).message || 'Unexpected error' }, 500);
  }
});
