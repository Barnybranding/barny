import { supabase, assertConfigured } from './supabase-client.js';

export async function signUp({ email, password, fullName, phone, companyName, address }) {
  assertConfigured();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || '',
        phone: phone || '',
        company_name: companyName || '',
        address: address || ''
      },
      emailRedirectTo: new URL('./login.html?verified=1', location.href).href
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  assertConfigured();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  assertConfigured();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  assertConfigured();
  const redirectTo = new URL('./reset-password.html?mode=update', location.href).href;
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  assertConfigured();
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}
