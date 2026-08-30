import { isSupabaseConfigured, supabase } from './supabase-client.js';
import { signIn, signOut } from './auth.js';

const $ = selector => document.querySelector(selector);

function message(text, type = 'error') {
  const box = $('#message');
  if (!box) return;
  box.textContent = text;
  box.className = `message ${type} show`;
}

function friendlyAuthError(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (raw.includes('invalid login credentials')) return 'The email address or password is incorrect.';
  if (raw.includes('email not confirmed')) return 'Please confirm your email address before signing in.';
  if (raw.includes('rate limit')) return 'Too many attempts were made. Please wait briefly and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

function safeReturn(defaultPath = './index.html') {
  const requested = new URLSearchParams(location.search).get('returnTo');
  if (!requested || requested.includes('://') || requested.startsWith('//')) return defaultPath;
  return requested;
}

async function init() {
  if (!isSupabaseConfigured) return message('Portal setup is not complete yet.');

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    const { data: isStaff } = await supabase.rpc('is_admin');
    if (isStaff) { location.replace(safeReturn()); return; }
  }

  $('#staffLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || !password) return message('Enter your email and password.');

    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Signing in…';
    try {
      await signIn(email, password);
      const { data: isStaff, error } = await supabase.rpc('is_admin');
      if (error || !isStaff) {
        await signOut();
        message('This account is not authorized for staff access. If you believe this is a mistake, contact a super admin.');
        return;
      }
      location.replace(safeReturn());
    } catch (error) {
      message(friendlyAuthError(error));
    } finally {
      button.disabled = false; button.textContent = 'Sign in';
    }
  });
}

init();
