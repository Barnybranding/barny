import { isSupabaseConfigured, supabase, requireUser } from './supabase-client.js';
import { signIn, signUp, signOut, sendPasswordReset, updatePassword } from './auth.js';
import { getMyProfile, updateMyProfile, listMyOrders, getMyOrder } from './data.js';

const $ = selector => document.querySelector(selector);
const page = document.body.dataset.page;

function message(text, type = 'error') {
  const box = $('#message');
  if (!box) return;
  box.textContent = text;
  box.className = `message ${type} show`;
  box.setAttribute('role', type === 'error' ? 'alert' : 'status');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function friendlyAuthError(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (raw.includes('invalid login credentials')) return 'The email address or password is incorrect.';
  if (raw.includes('email not confirmed')) return 'Please confirm your email address before signing in.';
  if (raw.includes('user already registered') || raw.includes('already been registered')) return 'An account already exists for this email address. Try signing in or resetting your password.';
  if (raw.includes('password should be') || raw.includes('weak password')) return 'Choose a stronger password with at least 8 characters, including a letter and a number.';
  if (raw.includes('rate limit')) return 'Too many attempts were made. Please wait briefly and try again.';
  if (raw.includes('network') || raw.includes('fetch')) return 'We could not connect to the account service. Check your connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPhone(value) {
  return /^[+\d][\d\s()-]{7,19}$/.test(value);
}

function validPassword(value) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function setBusy(form, busy, label) {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function requireConfiguration() {
  if (isSupabaseConfigured) return true;
  message('Portal setup is not complete yet. Add the Supabase project URL and anon key to assets/js/supabase-config.js.');
  return false;
}

function safeReturn(defaultPath = './dashboard.html') {
  const requested = new URLSearchParams(location.search).get('returnTo');
  if (!requested || requested.includes('://') || requested.startsWith('//')) return defaultPath;
  return requested;
}

async function initLogin() {
  if (!requireConfiguration()) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) location.replace(safeReturn());
  const params = new URLSearchParams(location.search);
  if (params.has('verified')) message('Email confirmed. You can now sign in.', 'success');
  if (params.has('registered')) message('Your account was created. Please confirm your email, then sign in.', 'success');
  if (params.has('reset')) message('Your password was updated. Sign in with your new password.', 'success');
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!validEmail(email)) return message('Enter a valid email address.');
    if (!password) return message('Enter your password.');
    setBusy(event.currentTarget, true, 'Signing in…');
    try {
      await signIn(email, password);
      location.replace(safeReturn());
    } catch (error) {
      message(friendlyAuthError(error));
      setBusy(event.currentTarget, false);
    }
  });
}

async function initRegister() {
  if (!requireConfiguration()) return;
  const { error: readinessError } = await supabase.from('customers').select('id').limit(1);
  if (readinessError?.code === 'PGRST205' || String(readinessError?.message || '').includes("Could not find the table")) {
    message('Customer registration is temporarily unavailable while the secure database is being initialized. Please contact Barny Branding Co. or try again later.');
    $('#registerForm').querySelector('button[type="submit"]').disabled = true;
    return;
  }
  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const fullName = $('#fullName').value.trim();
    const email = $('#email').value.trim();
    const phone = $('#phone').value.trim();
    const companyName = $('#companyName').value.trim();
    const password = $('#password').value;
    if (fullName.length < 2) return message('Enter your full name.');
    if (!validEmail(email)) return message('Enter a valid email address.');
    if (!validPhone(phone)) return message('Enter a valid phone number.');
    if (companyName.length < 2) return message('Enter your company or organization name.');
    if (!validPassword(password)) return message('Use at least 8 characters, including a letter and a number.');
    if (password !== $('#confirmPassword').value) return message('The passwords do not match.');
    setBusy(event.currentTarget, true, 'Creating account…');
    try {
      const data = await signUp({
        email, password, fullName, phone, companyName, address: ''
      });
      // The database trigger creates public.customers in the same signup transaction.
      if (data.session) {
        location.replace('./dashboard.html');
        return;
      }
      // Supabase returns no session when email confirmation is enabled.
      location.replace('./login.html?registered=1');
    } catch (error) {
      message(friendlyAuthError(error));
      setBusy(event.currentTarget, false);
    }
  });
}

async function initReset() {
  if (!requireConfiguration()) return;
  const updateMode = new URLSearchParams(location.search).get('mode') === 'update';
  $('#requestReset').hidden = updateMode;
  $('#updatePassword').hidden = !updateMode;
  $('#requestReset').addEventListener('submit', async event => {
    event.preventDefault(); setBusy(event.currentTarget, true, 'Sending…');
    const email = $('#email').value.trim();
    if (!validEmail(email)) { setBusy(event.currentTarget, false); return message('Enter a valid email address.'); }
    try {
      await sendPasswordReset(email);
      message('If an account exists for that address, a secure reset link has been sent.', 'success');
    } catch (error) { message(friendlyAuthError(error)); }
    finally { setBusy(event.currentTarget, false); }
  });
  $('#updatePassword').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('#password').value;
    if (!validPassword(password)) return message('Use at least 8 characters, including a letter and a number.');
    if (password !== $('#confirmPassword').value) return message('The passwords do not match.');
    setBusy(event.currentTarget, true, 'Updating…');
    try {
      await updatePassword(password);
      message('Password updated successfully.', 'success');
      setTimeout(() => location.replace('./login.html?reset=1'), 900);
    } catch (error) { message(friendlyAuthError(error)); }
    finally { setBusy(event.currentTarget, false); }
  });
}

function money(value) {
  return value == null ? 'Quote pending' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value);
}
function date(value) {
  return value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(value)) : 'Not set';
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

async function initDashboard() {
  if (!requireConfiguration()) return;
  const user = await requireUser(); if (!user) return;
  $('#logout').addEventListener('click', async event => { event.currentTarget.disabled = true; event.currentTarget.textContent = 'Logging out…'; await signOut(); location.replace('./login.html'); });
  try {
    const [profile, orders] = await Promise.all([getMyProfile(), listMyOrders()]);
    $('#welcome').textContent = `Welcome, ${profile.full_name || 'Customer'}`;
    $('#profileName').value = profile.full_name || '';
    $('#profileEmail').value = profile.email || '';
    $('#profilePhone').value = profile.phone || '';
    $('#profileCompany').value = profile.company_name || '';
    $('#profileAddress').value = profile.address || '';
    const list = $('#orders');
    list.innerHTML = orders.length ? orders.map(order => `
      <article class="order-card">
        <div><h3>${escapeHtml(order.order_number)}</h3>
          <div class="order-meta"><span>${date(order.order_date)}</span><span>${order.order_items.length} item(s)</span><span>${money(order.total_amount)}</span></div>
        </div>
        <div><span class="status ${escapeHtml(order.order_status)}">${escapeHtml(order.order_status.replaceAll('_',' '))}</span><br><a href="./order.html?id=${encodeURIComponent(order.id)}">View order</a></div>
      </article>`).join('') : '<div class="empty"><h3>No orders yet</h3><p>Your submitted website quote requests will appear here.</p><a class="button" href="../barny-ordering-site.html">Browse products</a></div>';
  } catch (error) { message(error.message || 'Unable to load the dashboard.'); }
  $('#profileForm').addEventListener('submit', async event => {
    event.preventDefault(); setBusy(event.currentTarget, true, 'Saving…');
    try {
      await updateMyProfile({ full_name: $('#profileName').value.trim(), phone: $('#profilePhone').value.trim(), company_name: $('#profileCompany').value.trim(), address: $('#profileAddress').value.trim() });
      message('Profile updated.', 'success');
    } catch (error) { message(error.message || 'Unable to update the profile.'); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.dashboard-panel').forEach(panel => panel.hidden = panel.id !== button.dataset.panel);
    document.querySelectorAll('[data-panel]').forEach(item => item.classList.toggle('active', item === button));
  }));
}

async function initOrder() {
  if (!requireConfiguration()) return;
  const user = await requireUser(); if (!user) return;
  $('#logout').addEventListener('click', async event => { event.currentTarget.disabled = true; event.currentTarget.textContent = 'Logging out…'; await signOut(); location.replace('./login.html'); });
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return message('No order was selected.');
  try {
    const order = await getMyOrder(id);
    $('#orderNumber').textContent = order.order_number;
    $('#orderSummary').innerHTML = `
      <div><small>Order status</small><strong>${escapeHtml(order.order_status.replaceAll('_',' '))}</strong></div>
      <div><small>Payment status</small><strong>${escapeHtml(order.payment_status.replaceAll('_',' '))}</strong></div>
      <div><small>Delivery status</small><strong>${escapeHtml(order.delivery_status.replaceAll('_',' '))}</strong></div>
      <div><small>Expected delivery</small><strong>${date(order.expected_delivery_date)}</strong></div>
      <div><small>Tracking number</small><strong>${escapeHtml(order.tracking_number || 'Not assigned')}</strong></div>
      <div><small>Order total</small><strong>${money(order.total_amount)}</strong></div>`;
    $('#items').innerHTML = order.order_items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${item.quantity}</td><td>${money(item.unit_price)}</td><td>${money(item.subtotal)}</td></tr>`).join('');
    $('#timeline').innerHTML = [...order.order_status_history].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).map(item => `<div class="timeline-item"><h4>${escapeHtml(item.status.replaceAll('_',' '))}</h4><p>${escapeHtml(item.description || '')}</p><small>${date(item.created_at)}</small></div>`).join('');
  } catch (error) { message(error.message || 'This order could not be loaded.'); }
}

if (isSupabaseConfigured && ['dashboard', 'order'].includes(page)) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
      location.replace('./login.html');
    }
  });
}

({ login: initLogin, register: initRegister, reset: initReset, dashboard: initDashboard, order: initOrder }[page] || (() => {}))();
