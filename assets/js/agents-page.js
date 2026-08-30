import { isSupabaseConfigured, requireSuperAdmin } from './supabase-client.js';
import { signOut } from './auth.js';
import { listStaff, inviteAgent, promoteAgent, demoteAgent, deactivateAgent } from './data.js';
import { mountNotificationBell } from './notifications.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

let myUserId = null;

function message(text, type = 'error') {
  const box = $('#message');
  box.textContent = text;
  box.className = `message ${type} show`;
}

function date(value) {
  return value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(value)) : 'Not set';
}

function staffRow(person) {
  const isMe = person.user_id === myUserId;
  return `<article class="order-card">
    <div><h3>${escapeHtml(person.email)}</h3>
      <div class="order-meta"><span>${person.role === 'super_admin' ? 'Super admin' : 'Agent'}</span><span>Joined ${date(person.created_at)}</span>${isMe ? '<span>(you)</span>' : ''}</div>
    </div>
    <div class="order-card-actions">
      ${!isMe && person.role === 'agent' ? `<button class="button secondary" data-promote="${person.user_id}">Promote to super admin</button>` : ''}
      ${!isMe && person.role === 'super_admin' ? `<button class="button secondary" data-demote="${person.user_id}">Demote to agent</button>` : ''}
      ${!isMe ? `<button class="button dark" data-deactivate="${person.user_id}">Deactivate</button>` : ''}
    </div>
  </article>`;
}

async function loadStaff() {
  try {
    const staff = await listStaff();
    const list = $('#staffList');
    list.innerHTML = staff.length ? staff.map(staffRow).join('') : '<div class="empty">No staff accounts yet.</div>';
    list.querySelectorAll('[data-promote]').forEach(btn => btn.onclick = () => runAction(() => promoteAgent(btn.dataset.promote), 'Promoted to super admin.'));
    list.querySelectorAll('[data-demote]').forEach(btn => btn.onclick = () => runAction(() => demoteAgent(btn.dataset.demote), 'Demoted to agent.'));
    list.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = () => {
      if (!confirm('Deactivate this staff account? They will lose access immediately.')) return;
      runAction(() => deactivateAgent(btn.dataset.deactivate), 'Account deactivated.');
    });
  } catch (error) {
    message(error.message || 'Unable to load staff accounts.');
  }
}

async function runAction(fn, successMessage) {
  try { await fn(); message(successMessage, 'success'); await loadStaff(); }
  catch (error) { message(error.message || 'That action failed.'); }
}

async function init() {
  if (!isSupabaseConfigured) return message('Configure Supabase in assets/js/supabase-config.js before using the admin portal.');
  const admin = await requireSuperAdmin(); if (!admin) return;
  myUserId = admin.id;

  $('#logout').onclick = async () => { await signOut(); location.replace('../account/login.html'); };
  mountNotificationBell($('#notifBellContainer'));

  await loadStaff();

  $('#inviteForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true; button.textContent = 'Sending…';
    try {
      await inviteAgent({ email: $('#inviteEmail').value.trim(), full_name: $('#inviteName').value.trim() });
      message('Invite sent. The new agent will receive an email to set their password.', 'success');
      $('#inviteForm').reset();
      await loadStaff();
    } catch (error) {
      message(error.message || 'Could not send the invite.');
    } finally {
      button.disabled = false; button.textContent = 'Send invite';
    }
  };
}

init();
