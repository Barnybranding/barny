import { isSupabaseConfigured, requireAdmin, getStaffRole, supabase } from './supabase-client.js';
import { signOut } from './auth.js';
import {
  listWaitingQuotes, listMyClaimedOrders, adminListOrders, adminGetOrder,
  adminUpdateOrder, claimQuote, takeOverQuote
} from './data.js';
import { mountChatPanel } from './chat.js';
import { mountNotificationBell } from './notifications.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

let myUserId = null;
let myRole = null; // 'agent' | 'super_admin'
let selectedId = null;
let unmountChat = null;
const listCache = { waiting: [], mine: [], all: [] };

function message(text, type = 'error') {
  const box = $('#message');
  box.textContent = text;
  box.className = `message ${type} show`;
}

function money(value) {
  return value == null ? 'Pending' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value);
}

function date(value) {
  return value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(value)) : 'Not set';
}

function orderCard(order, mode) {
  const claimed = Boolean(order.claimed_by);
  let actionHtml = '';
  if (mode === 'waiting') {
    actionHtml = `<button class="button" data-claim="${order.id}">Claim</button>`;
  } else if (mode === 'all' && claimed && order.claimed_by !== myUserId) {
    actionHtml = `<button class="button secondary" data-select="${order.id}">View</button><button class="button" data-takeover="${order.id}">Take over</button>`;
  } else {
    actionHtml = `<button class="button secondary" data-select="${order.id}">Manage</button>`;
  }
  const claimedLabel = claimed
    ? (order.claimed_by === myUserId ? '<span class="claimed-by">Claimed by you</span>' : '<span class="claimed-by">Claimed by another agent</span>')
    : '<span class="claimed-by">Unclaimed</span>';
  return `<article class="order-card">
    <div><h3>${escapeHtml(order.order_number)}</h3>
      <div class="order-meta"><span>${escapeHtml(order.customers?.full_name || '')}</span><span>${escapeHtml(order.customers?.email || '')}</span><span>${order.order_items?.length || 0} items</span><span>${money(order.total_amount)}</span></div>
    </div>
    <div class="order-card-actions"><span class="status">${escapeHtml(order.order_status.replaceAll('_', ' '))}</span>${mode !== 'waiting' ? claimedLabel : ''}${actionHtml}</div>
  </article>`;
}

function renderList(elId, orders, mode) {
  const el = $(elId);
  el.innerHTML = orders.length ? orders.map(o => orderCard(o, mode)).join('') : '<div class="empty">Nothing here right now.</div>';
  el.querySelectorAll('[data-claim]').forEach(btn => btn.onclick = () => doClaim(btn.dataset.claim));
  el.querySelectorAll('[data-takeover]').forEach(btn => btn.onclick = () => doTakeOver(btn.dataset.takeover));
  el.querySelectorAll('[data-select]').forEach(btn => btn.onclick = () => selectOrder(btn.dataset.select));
}

async function loadWaiting() {
  try { listCache.waiting = await listWaitingQuotes(); renderList('#waitingOrders', listCache.waiting, 'waiting'); }
  catch (error) { message(error.message || 'Unable to load the waiting list.'); }
}

async function loadMine() {
  try { listCache.mine = await listMyClaimedOrders(); renderList('#mineOrders', listCache.mine, 'mine'); }
  catch (error) { message(error.message || 'Unable to load your chats.'); }
}

async function loadAll() {
  try { listCache.all = await adminListOrders(); renderList('#allOrders', listCache.all, 'all'); }
  catch (error) { message(error.message || 'Unable to load all orders.'); }
}

async function doClaim(orderId) {
  try {
    await claimQuote(orderId);
    message('Quote claimed. You can now chat with the customer.', 'success');
    await Promise.all([loadWaiting(), loadMine()]);
    selectOrder(orderId);
  } catch (error) { message(error.message || 'Could not claim this request.'); }
}

async function doTakeOver(orderId) {
  try {
    await takeOverQuote(orderId);
    message('You have taken over this chat.', 'success');
    await Promise.all([loadMine(), loadAll()]);
    selectOrder(orderId);
  } catch (error) { message(error.message || 'Could not take over this order.'); }
}

async function selectOrder(orderId) {
  let order;
  try { order = await adminGetOrder(orderId); }
  catch (error) { return message(error.message || 'Order not found.'); }

  selectedId = orderId;
  $('#editor').hidden = false;
  $('#selectedNumber').textContent = order.order_number;
  $('#orderStatus').value = order.order_status;
  $('#paymentStatus').value = order.payment_status;
  $('#deliveryStatus').value = order.delivery_status;
  $('#totalAmount').value = order.total_amount ?? '';
  $('#expectedDate').value = order.expected_delivery_date || '';
  $('#trackingNumber').value = order.tracking_number || '';
  $('#deliveryAddress').value = order.delivery_address || '';
  $('#notes').value = order.notes || '';

  const takeOverBtn = $('#takeOverBtn');
  if (order.claimed_by && order.claimed_by !== myUserId) {
    takeOverBtn.hidden = false;
    takeOverBtn.onclick = () => doTakeOver(orderId);
    $('#claimedByLabel').textContent = 'Currently claimed by another agent — you can view but not edit until you take over.';
    $('#adminOrderForm').querySelectorAll('input,select,textarea,button[type=submit]').forEach(el => el.disabled = true);
  } else {
    takeOverBtn.hidden = true;
    $('#claimedByLabel').textContent = order.claimed_by ? 'Claimed by you.' : 'Not yet claimed — claim it to chat and manage this order.';
    $('#adminOrderForm').querySelectorAll('input,select,textarea,button[type=submit]').forEach(el => el.disabled = false);
  }

  if (unmountChat) { unmountChat(); unmountChat = null; }
  unmountChat = mountChatPanel($('#chatContainer'), orderId, myRole);

  $('#editor').scrollIntoView({ behavior: 'smooth' });
}

function switchPanel(panelId) {
  document.querySelectorAll('.dashboard-panel').forEach(panel => panel.hidden = panel.id !== panelId);
  document.querySelectorAll('.sidebar [data-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.panel === panelId));
}

async function init() {
  if (!isSupabaseConfigured) return message('Configure Supabase in assets/js/supabase-config.js before using the admin portal.');
  const admin = await requireAdmin(); if (!admin) return;
  myUserId = admin.id;
  myRole = await getStaffRole();

  const roleBadge = $('#roleBadge');
  roleBadge.hidden = false;
  roleBadge.textContent = myRole === 'super_admin' ? 'Super Admin' : 'Agent';

  if (myRole === 'super_admin') {
    $('#allOrdersTab').hidden = false;
    $('#agentsLink').hidden = false;
    $('#catalogueLink').hidden = false;
  }

  $('#logout').onclick = async () => { await signOut(); location.replace('../admin/login.html'); };

  document.querySelectorAll('.sidebar [data-panel]').forEach(btn => btn.addEventListener('click', () => {
    switchPanel(btn.dataset.panel);
    if (btn.dataset.panel === 'allPanel') loadAll();
  }));

  mountNotificationBell($('#notifBellContainer'), orderId => selectOrder(orderId));

  await Promise.all([loadWaiting(), loadMine()]);

  $('#adminOrderForm').onsubmit = async event => {
    event.preventDefault();
    if (!selectedId) return;
    const button = event.submitter;
    button.disabled = true; button.textContent = 'Saving…';
    try {
      await adminUpdateOrder(selectedId, {
        order_status: $('#orderStatus').value, payment_status: $('#paymentStatus').value,
        delivery_status: $('#deliveryStatus').value,
        total_amount: $('#totalAmount').value === '' ? null : Number($('#totalAmount').value),
        expected_delivery_date: $('#expectedDate').value || null,
        tracking_number: $('#trackingNumber').value.trim() || null,
        delivery_address: $('#deliveryAddress').value.trim() || null,
        notes: $('#notes').value.trim() || null
      });
      message('Order updated. Status changes are recorded in the customer timeline.', 'success');
      await Promise.all([loadMine(), myRole === 'super_admin' ? loadAll() : Promise.resolve()]);
    } catch (error) { message(error.message || 'The order could not be updated.'); }
    finally { button.disabled = false; button.textContent = 'Save order update'; }
  };
}

init();
