import { isSupabaseConfigured, supabase } from './supabase-client.js';
import { createQuoteOrder, updateMyProfile } from './data.js';

// The public catalogue remains fully functional before Supabase is configured.
// Once configured, this capture-phase handler securely converts quote carts into database orders.
if (isSupabaseConfigured) {
  const form = document.querySelector('#quoteForm');
  if (form) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        localStorage.setItem('barnyPendingCheckout', '1');
        const returnTo = encodeURIComponent('../barny-ordering-site.html?resumeQuote=1');
        location.href = `account/login.html?returnTo=${returnTo}`;
        return;
      }

      let cart = {};
      try { cart = JSON.parse(localStorage.getItem('barnyCart') || '{}'); } catch (_) {}
      const items = Object.entries(cart).map(([id, quantity]) => {
        const button = document.querySelector(`.product-open[data-id="${CSS.escape(id)}"]`);
        const productName = button?.closest('.product')?.querySelector('h3')?.textContent?.trim();
        return { product_name: productName, quantity: Number(quantity) };
      }).filter(item => item.product_name && item.quantity > 0);

      if (!items.length) {
        document.querySelector('#toast').textContent = 'Your quote cart is empty.';
        document.querySelector('#toast').classList.add('show');
        return;
      }

      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = 'Creating order…';
      try {
        await updateMyProfile({
          full_name: document.querySelector('#quoteForm [name="name"]')?.value.trim() || '',
          phone: document.querySelector('#quoteForm [name="phone"]')?.value.trim() || '',
          company_name: document.querySelector('#quoteForm [name="organisation"]')?.value.trim() || ''
        });
        const notes = document.querySelector('#quoteItems')?.value.trim() || 'Website quote-cart submission';
        const orderId = await createQuoteOrder({ deliveryAddress: '', notes, items });
        localStorage.removeItem('barnyCart');
        localStorage.removeItem('barnyPendingCheckout');
        location.href = `account/order.html?id=${encodeURIComponent(orderId)}`;
      } catch (error) {
        const toast = document.querySelector('#toast');
        toast.textContent = error.message || 'The order could not be created.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
        submit.disabled = false; submit.textContent = 'Send quote request';
      }
    }, true);
  }

  // Resume checkout after a customer signs in, without losing the local quote cart.
  const resumeQuote = new URLSearchParams(location.search).has('resumeQuote') || localStorage.getItem('barnyPendingCheckout') === '1';
  if (resumeQuote) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      document.querySelector('#cartBtn')?.click();
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'You are signed in. Review your cart and request your quote.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
      }
    }
  }
}
