import { supabase, assertConfigured } from './supabase-client.js';
import { SUPABASE_URL } from './supabase-config.js';

async function callEdgeFunction(name, body) {
  assertConfigured();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Request failed.');
  return json;
}

// Explicit auth_user_id filters below are required, not just belt-and-braces:
// staff accounts can SELECT/UPDATE every customer row under RLS (needed so
// agents/super admins can look up whoever they're chatting with), so an
// unfiltered "my profile" query or update would touch every customer's row
// once the caller is staff.
export async function getMyProfile() {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('customers')
    .select('id, auth_user_id, full_name, email, phone, company_name, address, created_at, updated_at')
    .eq('auth_user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(changes) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = ['full_name', 'phone', 'company_name', 'address'];
  const clean = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key))
  );
  const { data, error } = await supabase
    .from('customers')
    .update(clean)
    .eq('auth_user_id', user.id)
    .select('id, full_name, email, phone, company_name, address, updated_at')
    .single();
  if (error) throw error;
  return data;
}

// Same reasoning as getMyProfile/updateMyProfile above: RLS lets staff see
// orders that aren't "theirs" as a customer (the waiting list, their claims,
// or everything for a super admin), so these explicitly scope to the
// caller's own customer_id rather than trusting an unfiltered query.
export async function listMyOrders() {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_date, total_amount, payment_status, order_status,
      delivery_status, expected_delivery_date, actual_delivery_date, tracking_number,
      order_items(id, product_name, quantity, unit_price, subtotal),
      customers!inner(auth_user_id)
    `)
    .eq('customers.auth_user_id', user.id)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getMyOrder(orderId) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_date, total_amount, payment_status, order_status,
      delivery_status, delivery_address, expected_delivery_date, actual_delivery_date,
      tracking_number, notes, created_at, updated_at,
      order_items(id, product_name, quantity, unit_price, subtotal),
      order_status_history(id, status, description, created_at, updated_at),
      deliveries(id, delivery_address, courier_name, tracking_number, delivery_status,
        expected_delivery_date, actual_delivery_date, dispatched_at, delivered_at, notes),
      customers!inner(auth_user_id)
    `)
    .eq('id', orderId)
    .eq('customers.auth_user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function createQuoteOrder({ deliveryAddress = '', notes = '', items }) {
  assertConfigured();
  if (!Array.isArray(items) || !items.length) throw new Error('At least one item is required.');
  const cleanItems = items.map(item => ({
    product_name: String(item.product_name || '').trim(),
    quantity: Number(item.quantity)
  }));
  const { data, error } = await supabase.rpc('create_customer_order', {
    requested_delivery_address: deliveryAddress,
    customer_notes: notes,
    items: cleanItems
  });
  if (error) throw error;
  return data;
}

// Admin functions still require an authenticated user in public.admin_users.
// RLS rejects these operations for every normal customer. RLS also scopes
// what each query actually returns: a plain agent only ever sees unclaimed
// orders plus orders they've claimed, regardless of which of these is called;
// a super admin sees everything.
const STAFF_ORDER_COLUMNS = `*, customers(id, full_name, email, phone, company_name), order_items(*)`;

export async function listWaitingQuotes() {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(STAFF_ORDER_COLUMNS)
    .is('claimed_by', null)
    .order('order_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listMyClaimedOrders() {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('orders')
    .select(STAFF_ORDER_COLUMNS)
    .eq('claimed_by', user.id)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function adminListOrders() {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(STAFF_ORDER_COLUMNS)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data;
}

function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

export async function listCategoriesAdmin() {
  assertConfigured();
  const { data, error } = await supabase.from('product_categories').select('*').order('sort_order');
  if (error) throw error;
  return data;
}

export async function createCategory({ name, sort_order = 0 }) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('product_categories')
    .insert({ name: name.trim(), slug: `${slugify(name)}-${Date.now().toString(36)}`, sort_order, created_by: user.id })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, changes) {
  assertConfigured();
  const { data, error } = await supabase.from('product_categories').update(changes).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  assertConfigured();
  const { error } = await supabase.from('product_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function listProductsAdmin() {
  assertConfigured();
  const { data, error } = await supabase
    .from('products')
    .select('*, product_categories(name)')
    .order('category_id')
    .order('sort_order');
  if (error) throw error;
  return data;
}

export async function createProduct(product) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('products')
    .insert({
      category_id: product.category_id,
      name: product.name.trim(),
      slug: `${slugify(product.name)}-${Date.now().toString(36)}`,
      description: product.description || '',
      image_url: product.image_url || null,
      image_public_id: product.image_public_id || null,
      sort_order: product.sort_order || 0,
      is_active: product.is_active !== false,
      created_by: user.id,
      updated_by: user.id
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, changes) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('products')
    .update({ ...changes, updated_by: user.id })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  assertConfigured();
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

export async function listStaff() {
  assertConfigured();
  const { data, error } = await supabase.rpc('list_staff');
  if (error) throw error;
  return data;
}

export async function inviteAgent({ email, full_name }) {
  return callEdgeFunction('create-agent', { email, full_name });
}

export async function promoteAgent(userId) {
  return callEdgeFunction('manage-agent', { action: 'promote', user_id: userId });
}

export async function demoteAgent(userId) {
  return callEdgeFunction('manage-agent', { action: 'demote', user_id: userId });
}

export async function deactivateAgent(userId) {
  return callEdgeFunction('manage-agent', { action: 'deactivate', user_id: userId });
}

export async function adminGetOrder(orderId) {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(STAFF_ORDER_COLUMNS)
    .eq('id', orderId)
    .single();
  if (error) throw error;
  return data;
}

export async function claimQuote(orderId) {
  assertConfigured();
  const { data, error } = await supabase.rpc('claim_quote', { target_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function takeOverQuote(orderId) {
  assertConfigured();
  const { data, error } = await supabase.rpc('take_over_quote', { target_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function releaseQuote(orderId) {
  assertConfigured();
  const { data, error } = await supabase.rpc('release_quote', { target_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function listNotifications(limit = 30) {
  assertConfigured();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, order_id, title, body, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function countUnreadNotifications() {
  assertConfigured();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationRead(id) {
  assertConfigured();
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  assertConfigured();
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (error) throw error;
}

export async function adminUpdateOrder(orderId, changes) {
  assertConfigured();
  const allowed = [
    'total_amount', 'payment_status', 'order_status', 'delivery_status',
    'delivery_address', 'expected_delivery_date', 'actual_delivery_date',
    'tracking_number', 'notes'
  ];
  const clean = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key))
  );
  const { data, error } = await supabase
    .from('orders')
    .update(clean)
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
