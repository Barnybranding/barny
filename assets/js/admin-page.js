import { isSupabaseConfigured, requireAdmin } from './supabase-client.js';
import { signOut } from './auth.js';
import { adminListOrders, adminUpdateOrder } from './data.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let orders = [];
let selectedId = null;

function message(text, type = 'error') {
  const box = $('#message'); box.textContent = text; box.className = `message ${type} show`;
}
function money(value) {
  return value == null ? 'Pending' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value);
}
function render() {
  $('#adminOrders').innerHTML = orders.length ? orders.map(order => `<article class="order-card">
    <div><h3>${escapeHtml(order.order_number)}</h3><div class="order-meta"><span>${escapeHtml(order.customers?.full_name || '')}</span><span>${escapeHtml(order.customers?.email || '')}</span><span>${order.order_items?.length || 0} items</span><span>${money(order.total_amount)}</span></div></div>
    <div><span class="status">${escapeHtml(order.order_status.replaceAll('_',' '))}</span><br><button class="button secondary" data-edit="${order.id}">Manage</button></div>
  </article>`).join('') : '<div class="empty">No orders found.</div>';
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => selectOrder(button.dataset.edit));
}
function selectOrder(id) {
  const order = orders.find(item => item.id === id); if (!order) return;
  selectedId = id; $('#editor').hidden = false; $('#selectedNumber').textContent = order.order_number;
  $('#orderStatus').value = order.order_status; $('#paymentStatus').value = order.payment_status;
  $('#deliveryStatus').value = order.delivery_status; $('#totalAmount').value = order.total_amount ?? '';
  $('#expectedDate').value = order.expected_delivery_date || ''; $('#trackingNumber').value = order.tracking_number || '';
  $('#deliveryAddress').value = order.delivery_address || ''; $('#notes').value = order.notes || '';
  $('#editor').scrollIntoView({ behavior: 'smooth' });
}

async function init() {
  if (!isSupabaseConfigured) return message('Configure Supabase in assets/js/supabase-config.js before using the admin portal.');
  const admin = await requireAdmin(); if (!admin) return;
  $('#logout').onclick = async () => { await signOut(); location.replace('../account/login.html'); };
  try { orders = await adminListOrders(); render(); }
  catch (error) { message(error.message || 'Unable to load orders.'); }
  $('#adminOrderForm').onsubmit = async event => {
    event.preventDefault(); if (!selectedId) return;
    const button = event.submitter; button.disabled = true; button.textContent = 'Saving…';
    try {
      const updated = await adminUpdateOrder(selectedId, {
        order_status: $('#orderStatus').value, payment_status: $('#paymentStatus').value,
        delivery_status: $('#deliveryStatus').value,
        total_amount: $('#totalAmount').value === '' ? null : Number($('#totalAmount').value),
        expected_delivery_date: $('#expectedDate').value || null,
        tracking_number: $('#trackingNumber').value.trim() || null,
        delivery_address: $('#deliveryAddress').value.trim() || null,
        notes: $('#notes').value.trim() || null
      });
      orders = orders.map(order => order.id === selectedId ? { ...order, ...updated } : order);
      render(); message('Order updated. Status changes are recorded in the customer timeline.', 'success');
    } catch (error) { message(error.message || 'The order could not be updated.'); }
    finally { button.disabled = false; button.textContent = 'Save order update'; }
  };
}
init();
