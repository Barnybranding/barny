import { supabase, assertConfigured } from './supabase-client.js';

export async function getMyProfile() {
  assertConfigured();
  const { data, error } = await supabase
    .from('customers')
    .select('id, auth_user_id, full_name, email, phone, company_name, address, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(changes) {
  assertConfigured();
  const allowed = ['full_name', 'phone', 'company_name', 'address'];
  const clean = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key))
  );
  const { data, error } = await supabase
    .from('customers')
    .update(clean)
    .select('id, full_name, email, phone, company_name, address, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function listMyOrders() {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_date, total_amount, payment_status, order_status,
      delivery_status, expected_delivery_date, actual_delivery_date, tracking_number,
      order_items(id, product_name, quantity, unit_price, subtotal)
    `)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getMyOrder(orderId) {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_date, total_amount, payment_status, order_status,
      delivery_status, delivery_address, expected_delivery_date, actual_delivery_date,
      tracking_number, notes, created_at, updated_at,
      order_items(id, product_name, quantity, unit_price, subtotal),
      order_status_history(id, status, description, created_at, updated_at),
      deliveries(id, delivery_address, courier_name, tracking_number, delivery_status,
        expected_delivery_date, actual_delivery_date, dispatched_at, delivered_at, notes)
    `)
    .eq('id', orderId)
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
// RLS rejects these operations for every normal customer.
export async function adminListOrders() {
  assertConfigured();
  const { data, error } = await supabase
    .from('orders')
    .select(`*, customers(id, full_name, email, phone, company_name), order_items(*)`)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data;
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
