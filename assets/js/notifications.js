// Shared notification bell, used on both customer and staff pages. Reads
// public.notifications (RLS-scoped to the signed-in user) and subscribes to
// realtime inserts so the badge updates live.
import { supabase } from './supabase-client.js';
import { listNotifications, countUnreadNotifications, markNotificationRead, markAllNotificationsRead } from './data.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Mounts a notification bell button + dropdown into `container`.
 * @param {HTMLElement} container
 * @param {(orderId: string) => void} [onOpenOrder] optional callback when a notification linked to an order is clicked
 */
export function mountNotificationBell(container, onOpenOrder) {
  container.innerHTML = `
    <div class="notif-bell-wrap">
      <button class="notif-bell" id="notifBellBtn" aria-label="Notifications">🔔<span class="notif-badge" id="notifBadge" hidden>0</span></button>
      <div class="notif-dropdown" id="notifDropdown" hidden>
        <div class="notif-head"><b>Notifications</b><button class="notif-mark-all" id="notifMarkAll">Mark all read</button></div>
        <div class="notif-list" id="notifList"><div class="empty">Loading…</div></div>
      </div>
    </div>`;

  const bellBtn = container.querySelector('#notifBellBtn');
  const dropdown = container.querySelector('#notifDropdown');
  const badge = container.querySelector('#notifBadge');
  const list = container.querySelector('#notifList');
  const markAllBtn = container.querySelector('#notifMarkAll');

  async function refreshBadge() {
    try {
      const count = await countUnreadNotifications();
      badge.hidden = count === 0;
      badge.textContent = count > 9 ? '9+' : String(count);
    } catch (_) { /* ignore */ }
  }

  async function loadList() {
    try {
      const items = await listNotifications(20);
      list.innerHTML = items.length ? items.map(n => `
        <button class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-order="${n.order_id || ''}">
          <div class="notif-title">${escapeHtml(n.title)}</div>
          <div class="notif-body">${escapeHtml(n.body)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </button>`).join('') : '<div class="empty">No notifications yet.</div>';
    } catch (error) {
      list.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Could not load notifications.')}</div>`;
    }
  }

  bellBtn.addEventListener('click', async () => {
    const opening = dropdown.hidden;
    dropdown.hidden = !dropdown.hidden;
    if (opening) await loadList();
  });

  document.addEventListener('click', e => {
    if (!container.contains(e.target)) dropdown.hidden = true;
  });

  list.addEventListener('click', async e => {
    const item = e.target.closest('.notif-item');
    if (!item) return;
    try { await markNotificationRead(item.dataset.id); } catch (_) {}
    item.classList.remove('unread');
    refreshBadge();
    if (item.dataset.order && onOpenOrder) {
      dropdown.hidden = true;
      onOpenOrder(item.dataset.order);
    }
  });

  markAllBtn.addEventListener('click', async () => {
    try { await markAllNotificationsRead(); await loadList(); refreshBadge(); } catch (_) {}
  });

  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${user.id}`
      }, () => refreshBadge())
      .subscribe();
  });

  refreshBadge();
}
