import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './supabase-config.js';

export { isSupabaseConfigured };

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'barny-auth-session'
      }
    })
  : null;

export function assertConfigured() {
  if (!supabase) {
    throw new Error('Supabase has not been configured. Add the project URL and anon key to assets/js/supabase-config.js.');
  }
}

export async function getCurrentUser() {
  assertConfigured();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function requireUser(redirectTo = './login.html') {
  const user = await getCurrentUser();
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    location.replace(`${redirectTo}?returnTo=${returnTo}`);
    return null;
  }
  return user;
}

export async function requireAdmin(redirectTo = '../account/dashboard.html') {
  const user = await requireUser('../account/login.html');
  if (!user) return null;
  const { data, error } = await supabase.rpc('is_admin');
  if (error || data !== true) {
    location.replace(redirectTo);
    return null;
  }
  return user;
}

export async function requireSuperAdmin(redirectTo = './index.html') {
  const user = await requireAdmin(redirectTo);
  if (!user) return null;
  const { data, error } = await supabase.rpc('is_super_admin');
  if (error || data !== true) {
    location.replace(redirectTo);
    return null;
  }
  return user;
}

// 'super_admin', 'agent' or null (not staff). Assumes the caller already
// knows a user is signed in.
export async function getStaffRole() {
  assertConfigured();
  const { data: isSuper } = await supabase.rpc('is_super_admin');
  if (isSuper) return 'super_admin';
  const { data: isStaff } = await supabase.rpc('is_admin');
  if (isStaff) return 'agent';
  return null;
}
