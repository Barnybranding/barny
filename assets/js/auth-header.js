import { supabase, isSupabaseConfigured } from './supabase-client.js';

const accountLink = document.querySelector('.head-action.user');

if (accountLink && isSupabaseConfigured) {
  const render = session => {
    const label = accountLink.querySelector('.label');
    if (session?.user) {
      accountLink.href = 'account/dashboard.html';
      accountLink.classList.add('signed-in');
      if (label) label.textContent = 'My Dashboard';
      accountLink.setAttribute('aria-label', 'Open customer dashboard');
    } else {
      accountLink.href = 'account/login.html';
      accountLink.classList.remove('signed-in');
      if (label) label.textContent = 'Login';
      accountLink.setAttribute('aria-label', 'Customer login');
    }
  };
  const { data } = await supabase.auth.getSession();
  render(data.session);
  supabase.auth.onAuthStateChange((_event, session) => render(session));
}
