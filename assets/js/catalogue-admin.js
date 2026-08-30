import { isSupabaseConfigured, requireSuperAdmin } from './supabase-client.js';
import { signOut } from './auth.js';
import {
  listCategoriesAdmin, createCategory, updateCategory, deleteCategory,
  listProductsAdmin, createProduct, updateProduct, deleteProduct
} from './data.js';
import { uploadToCloudinary, isCloudinaryConfigured } from './cloudinary-config.js';
import { mountNotificationBell } from './notifications.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

let categories = [];
let products = [];
let editingProductId = null;

function message(text, type = 'error') {
  const box = $('#message');
  box.textContent = text;
  box.className = `message ${type} show`;
}

function renderCategories() {
  $('#categoryList').innerHTML = categories.length ? categories.map(c => `
    <article class="order-card">
      <div><h3>${escapeHtml(c.name)}</h3><div class="order-meta"><span>Sort ${c.sort_order}</span><span>${products.filter(p => p.category_id === c.id).length} product(s)</span></div></div>
      <div class="order-card-actions"><button class="button secondary" data-rename="${c.id}">Rename</button><button class="button dark" data-delete-cat="${c.id}">Delete</button></div>
    </article>`).join('') : '<div class="empty">No categories yet.</div>';

  $('#productCategory').innerHTML = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  $('#categoryList').querySelectorAll('[data-rename]').forEach(btn => btn.onclick = async () => {
    const cat = categories.find(c => c.id === btn.dataset.rename);
    const name = prompt('New category name:', cat.name);
    if (!name || !name.trim()) return;
    try { await updateCategory(cat.id, { name: name.trim() }); message('Category updated.', 'success'); await loadAll(); }
    catch (error) { message(error.message || 'Could not update the category.'); }
  });
  $('#categoryList').querySelectorAll('[data-delete-cat]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this category? It must have no products left in it.')) return;
    try { await deleteCategory(btn.dataset.deleteCat); message('Category deleted.', 'success'); await loadAll(); }
    catch (error) { message(error.message || 'Could not delete the category (it may still have products).'); }
  });
}

function renderProducts() {
  $('#productList').innerHTML = products.length ? products.map(p => `
    <article class="order-card">
      <div style="display:flex;gap:12px;align-items:center">
        ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:4px">` : ''}
        <div><h3>${escapeHtml(p.name)} ${p.is_active ? '' : '<small style="color:var(--red)">(inactive)</small>'}</h3>
        <div class="order-meta"><span>${escapeHtml(p.product_categories?.name || '')}</span><span>Sort ${p.sort_order}</span></div></div>
      </div>
      <div class="order-card-actions"><button class="button secondary" data-edit-product="${p.id}">Edit</button><button class="button dark" data-delete-product="${p.id}">Delete</button></div>
    </article>`).join('') : '<div class="empty">No products yet.</div>';

  $('#productList').querySelectorAll('[data-edit-product]').forEach(btn => btn.onclick = () => startEdit(btn.dataset.editProduct));
  $('#productList').querySelectorAll('[data-delete-product]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try { await deleteProduct(btn.dataset.deleteProduct); message('Product deleted.', 'success'); await loadAll(); }
    catch (error) { message(error.message || 'Could not delete the product.'); }
  });
}

function startEdit(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  editingProductId = productId;
  $('#productFormHeading').textContent = `Editing: ${p.name}`;
  $('#productId').value = p.id;
  $('#productName').value = p.name;
  $('#productCategory').value = p.category_id;
  $('#productDescription').value = p.description || '';
  $('#productSort').value = p.sort_order;
  $('#productActive').checked = p.is_active;
  $('#productImage').value = '';
  $('#productCancel').hidden = false;
  $('#productForm').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  editingProductId = null;
  $('#productFormHeading').textContent = 'Add a product';
  $('#productForm').reset();
  $('#productActive').checked = true;
  $('#productCancel').hidden = true;
}

async function loadAll() {
  try {
    [categories, products] = await Promise.all([listCategoriesAdmin(), listProductsAdmin()]);
    renderCategories();
    renderProducts();
  } catch (error) {
    message(error.message || 'Unable to load the catalogue.');
  }
}

async function init() {
  if (!isSupabaseConfigured) return message('Configure Supabase in assets/js/supabase-config.js before using the admin portal.');
  const admin = await requireSuperAdmin(); if (!admin) return;

  $('#logout').onclick = async () => { await signOut(); location.replace('../account/login.html'); };
  mountNotificationBell($('#notifBellContainer'));

  await loadAll();

  $('#categoryForm').onsubmit = async event => {
    event.preventDefault();
    try {
      await createCategory({ name: $('#categoryName').value.trim(), sort_order: Number($('#categorySort').value) || 0 });
      $('#categoryForm').reset(); $('#categorySort').value = 0;
      message('Category added.', 'success');
      await loadAll();
    } catch (error) { message(error.message || 'Could not add the category.'); }
  };

  $('#productCancel').onclick = resetForm;

  $('#productForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true; button.textContent = 'Saving…';
    try {
      let image_url, image_public_id;
      const file = $('#productImage').files[0];
      if (file) {
        if (!isCloudinaryConfigured) throw new Error('Cloudinary is not configured.');
        const uploaded = await uploadToCloudinary(file, 'barny/products');
        image_url = uploaded.url;
        image_public_id = uploaded.publicId;
      }
      const payload = {
        name: $('#productName').value.trim(),
        category_id: $('#productCategory').value,
        description: $('#productDescription').value.trim(),
        sort_order: Number($('#productSort').value) || 0,
        is_active: $('#productActive').checked
      };
      if (image_url) { payload.image_url = image_url; payload.image_public_id = image_public_id; }

      if (editingProductId) {
        await updateProduct(editingProductId, payload);
        message('Product updated.', 'success');
      } else {
        await createProduct(payload);
        message('Product added.', 'success');
      }
      resetForm();
      await loadAll();
    } catch (error) {
      message(error.message || 'Could not save the product.');
    } finally {
      button.disabled = false; button.textContent = 'Save product';
    }
  };
}

init();
