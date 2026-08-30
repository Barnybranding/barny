// Barny Branding Co. — dynamic storefront catalogue.
// Replaces the old hardcoded PRODUCTS array: categories and products are
// fetched from Supabase (public read, RLS-enforced) and rendered into the
// same markup/classes the original static catalogue used, so the existing
// CSS needs no changes. Also owns the quote cart, product modal and quote
// form submission that used to live inline in the storefront page —
// everything that depended on the product list.
import { supabase, isSupabaseConfigured } from './supabase-client.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

const ADD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></svg>';
const ARROW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';

let byId = {};
let current = null;
let cart = {};
try { cart = JSON.parse(localStorage.getItem('barnyCart') || '{}'); } catch (_) {}

function tagline(categoryName) {
  const stripped = categoryName.replace(/\s*branding\s*$/i, '');
  return `Branded essentials for ${stripped}.`;
}

function toast(text) {
  const box = $('#toast');
  if (!box) return;
  box.textContent = text;
  box.classList.add('show');
  setTimeout(() => box.classList.remove('show'), 2200);
}

function save() {
  localStorage.setItem('barnyCart', JSON.stringify(cart));
  renderCart();
}

function add(id) {
  cart[id] = (cart[id] || 0) + 1;
  save();
  toast('Added. Request a quote when ready—we’ll discuss your budget.');
}

function renderCart() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const countEl = $('#cartCount');
  if (countEl) countEl.textContent = count;
  const list = $('#cartList');
  if (!list) return;
  const ids = Object.keys(cart);
  if (!ids.length) {
    list.innerHTML = '<div class="cart-empty"><h3>Your quote cart is empty</h3><p>Add products while browsing the catalogue.</p></div>';
    return;
  }
  list.innerHTML = ids.map(id => {
    const p = byId[id];
    if (!p) return '';
    return `<div class="cart-item"><img src="${escapeHtml(p.img || '')}" alt=""><div><h4>${escapeHtml(p.name)}</h4><small>${escapeHtml(p.cat)}</small><div class="qty"><button data-minus="${id}">−</button><b>${cart[id]}</b><button data-plus="${id}">+</button></div></div><button class="remove" data-remove="${id}">Remove</button></div>`;
  }).join('');
}

function openProduct(id) {
  const p = byId[id];
  if (!p) return;
  current = id;
  $('#modalImg').src = p.img || '';
  $('#modalTitle').textContent = p.name;
  $('#modalCat').textContent = p.cat;
  $('#modalDesc').textContent = p.desc;
  $('#productModal').classList.add('open');
}

function productCard(p) {
  return `<article class="product" data-name="${escapeHtml(p.name.toLowerCase())}" data-cat="${escapeHtml(p.cat.toLowerCase())}">
    <button class="wish" aria-label="Save ${escapeHtml(p.name)}">♡</button>
    <button class="product-open" data-id="${p.id}"><img loading="lazy" src="${escapeHtml(p.img || '')}" alt="${escapeHtml(p.name)}"></button>
    <div class="product-copy"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.desc)}</p><div class="rating">★★★★★ <span>Custom made</span></div><button class="add" data-id="${p.id}">${ADD_ICON} Add to quote</button></div>
  </article>`;
}

function categoryShelf(category, products) {
  const shelfId = `cat-${category.slug}`;
  return `<section class="shelf" id="${shelfId}"><header class="shelf-head"><div><h2>${escapeHtml(category.name)}</h2><p>${escapeHtml(tagline(category.name))}</p></div><button class="see-all" data-expand="${shelfId}">See all ${ARROW_ICON}</button></header><div class="rail">${products.map(productCard).join('')}</div></section>`;
}

async function loadCatalogue() {
  const root = $('#catalogueRoot');
  if (!root) return;
  if (!isSupabaseConfigured) {
    root.innerHTML = '<div class="empty"><h3>Catalogue unavailable</h3><p>The store is not connected to its database yet.</p></div>';
    return;
  }
  try {
    const [{ data: categories, error: catError }, { data: products, error: prodError }] = await Promise.all([
      supabase.from('product_categories').select('id, name, slug, sort_order').order('sort_order'),
      supabase.from('products').select('id, category_id, name, description, image_url, sort_order').eq('is_active', true).order('sort_order')
    ]);
    if (catError) throw catError;
    if (prodError) throw prodError;

    const byCategory = new Map(categories.map(c => [c.id, { ...c, products: [] }]));
    byId = {};
    for (const p of products) {
      const category = byCategory.get(p.category_id);
      if (!category) continue;
      const entry = { id: p.id, name: p.name, desc: p.description || '', img: p.image_url, cat: category.name };
      category.products.push(entry);
      byId[p.id] = entry;
    }

    const shelves = [...byCategory.values()].filter(c => c.products.length);
    root.innerHTML = shelves.length
      ? shelves.map(c => categoryShelf(c, c.products)).join('')
      : '<div class="empty"><h3>No products yet</h3><p>Check back soon.</p></div>';

    renderCart();
  } catch (error) {
    root.innerHTML = `<div class="empty"><h3>Could not load the catalogue</h3><p>${escapeHtml(error.message || 'Please try again shortly.')}</p></div>`;
  }
}

function wireStaticControls() {
  $('#modalAdd')?.addEventListener('click', () => { if (current) add(current); $('#productModal').classList.remove('open'); });
  $('#modalClose')?.addEventListener('click', () => $('#productModal').classList.remove('open'));
  $('#cartBtn')?.addEventListener('click', () => $('#cartOverlay').classList.add('open'));
  $('#cartClose')?.addEventListener('click', () => $('#cartOverlay').classList.remove('open'));
  $('#cartOverlay')?.addEventListener('click', e => { if (e.target.id === 'cartOverlay') e.currentTarget.classList.remove('open'); });
  $('#cartList')?.addEventListener('click', e => {
    const b = e.target;
    if (b.dataset.plus) { cart[b.dataset.plus]++; save(); }
    if (b.dataset.minus) { cart[b.dataset.minus]--; if (cart[b.dataset.minus] < 1) delete cart[b.dataset.minus]; save(); }
    if (b.dataset.remove) { delete cart[b.dataset.remove]; save(); }
  });
  $('#requestAll')?.addEventListener('click', () => {
    const ids = Object.keys(cart);
    if (!ids.length) return toast('Add a product first');
    $('#quoteItems').value = ids.map(id => `${cart[id]} × ${byId[id]?.name || ''}`).join('\n');
    $('#cartOverlay').classList.remove('open');
    $('#quoteModal').classList.add('open');
  });
  $('#quoteClose')?.addEventListener('click', () => $('#quoteModal').classList.remove('open'));

  // Bubble-phase, mirroring the original inline handler. When Supabase is
  // configured, home-order-integration.js intercepts submission in the
  // capture phase and stops it from reaching here.
  $('#quoteForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true; b.textContent = 'Sending…';
    try {
      const r = await fetch(e.currentTarget.action, { method: 'POST', body: new FormData(e.currentTarget), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('send failed');
      cart = {}; save();
      $('#quoteModal').classList.remove('open');
      toast('Quote request sent successfully');
    } catch (_) {
      toast('Could not send. Please try again.');
    } finally {
      b.disabled = false; b.textContent = 'Send quote request';
    }
  });
}

function wireCatalogueDelegation() {
  const root = $('#catalogueRoot');
  if (!root) return;
  root.addEventListener('click', e => {
    const addBtn = e.target.closest('.add');
    if (addBtn) { add(addBtn.dataset.id); return; }
    const openBtn = e.target.closest('.product-open');
    if (openBtn) { openProduct(openBtn.dataset.id); return; }
    const wishBtn = e.target.closest('.wish');
    if (wishBtn) {
      wishBtn.textContent = wishBtn.textContent === '♡' ? '♥' : '♡';
      toast(wishBtn.textContent === '♥' ? 'Saved to favourites' : 'Removed from favourites');
      return;
    }
    const expandBtn = e.target.closest('[data-expand]');
    if (expandBtn) {
      const shelf = document.getElementById(expandBtn.dataset.expand);
      if (shelf) {
        shelf.classList.toggle('expanded');
        expandBtn.firstChild.textContent = shelf.classList.contains('expanded') ? 'Collapse ' : 'See all ';
      }
    }
  });
}

wireStaticControls();
wireCatalogueDelegation();
loadCatalogue();
