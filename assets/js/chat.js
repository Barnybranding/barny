// Shared order-chat panel used by both the customer order page and the
// agent workspace. RLS on public.order_messages already restricts who can
// read/send on a given order (the customer, the claimed agent, or a super
// admin) — this module just renders whatever the database allows.
import { supabase } from './supabase-client.js';
import { uploadToCloudinary, isCloudinaryConfigured } from './cloudinary-config.js';
import { skeletonLines } from './skeleton.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function timeLabel(iso) {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|heic)(\?.*)?$/i;

function bubble(message, myUserId) {
  const mine = message.sender_id === myUserId;
  const roleLabel = { customer: 'Customer', agent: 'Agent', super_admin: 'Admin' }[message.sender_role] || message.sender_role;
  const isImage = message.attachment_url && IMAGE_EXT_RE.test(message.attachment_name || message.attachment_url);
  const attachment = message.attachment_url
    ? isImage
      ? `<a class="chat-image-link" href="${escapeHtml(message.attachment_url)}" target="_blank" rel="noopener"><img class="chat-image" src="${escapeHtml(message.attachment_url)}" alt="${escapeHtml(message.attachment_name || 'Photo')}" loading="lazy"></a>`
      : `<a class="chat-attachment" href="${escapeHtml(message.attachment_url)}" target="_blank" rel="noopener">📎 ${escapeHtml(message.attachment_name || 'Attachment')}</a>`
    : '';
  return `<div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
    <div class="chat-meta">${escapeHtml(roleLabel)} · ${timeLabel(message.created_at)}</div>
    ${message.body ? `<div class="chat-body">${escapeHtml(message.body)}</div>` : ''}
    ${attachment}
  </div>`;
}

/**
 * Mounts a chat panel into `container` for the given order.
 * @param {HTMLElement} container
 * @param {string} orderId
 * @param {'customer'|'agent'|'super_admin'} myRole
 * @returns {() => void} cleanup function to unsubscribe realtime
 */
export function mountChatPanel(container, orderId, myRole) {
  container.innerHTML = `
    <div class="chat-panel">
      <div class="chat-messages" id="chatMessages">${skeletonLines(3)}</div>
      <form class="chat-form" id="chatForm">
        <input type="file" id="chatFile" hidden accept="image/*,.pdf">
        <button type="button" class="button secondary chat-attach" id="chatAttachBtn" title="Attach a file">📎</button>
        <input type="text" class="chat-input" id="chatInput" placeholder="Type a message…" autocomplete="off">
        <button type="submit" class="button chat-send">Send</button>
      </form>
      <div class="chat-file-name" id="chatFileName" hidden></div>
    </div>`;

  const messagesEl = container.querySelector('#chatMessages');
  const form = container.querySelector('#chatForm');
  const input = container.querySelector('#chatInput');
  const fileInput = container.querySelector('#chatFile');
  const attachBtn = container.querySelector('#chatAttachBtn');
  const fileNameEl = container.querySelector('#chatFileName');

  let myUserId = null;
  let channel = null;
  const renderedIds = new Set();

  function renderMessages(messages) {
    messagesEl.innerHTML = messages.length
      ? messages.map(m => bubble(m, myUserId)).join('')
      : '<div class="empty">No messages yet. Say hello.</div>';
    messages.forEach(m => renderedIds.add(m.id));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Shared by the realtime handler and the optimistic append after sending,
  // so whichever arrives first renders it and the other is a no-op.
  function appendMessage(message) {
    if (renderedIds.has(message.id)) return;
    renderedIds.add(message.id);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = bubble(message, myUserId);
    if (messagesEl.querySelector('.empty')) messagesEl.innerHTML = '';
    messagesEl.appendChild(wrapper.firstElementChild);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    myUserId = user?.id || null;

    const { data, error } = await supabase
      .from('order_messages')
      .select('id, sender_id, sender_role, body, attachment_url, attachment_name, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      messagesEl.innerHTML = `<div class="empty">Could not load messages: ${escapeHtml(error.message)}</div>`;
      return;
    }
    renderMessages(data);

    channel = supabase
      .channel(`order-messages-${orderId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}`
      }, payload => appendMessage(payload.new))
      .subscribe();
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    fileNameEl.hidden = !fileInput.files.length;
    fileNameEl.textContent = fileInput.files.length ? `Attached: ${fileInput.files[0].name}` : '';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = input.value.trim();
    const file = fileInput.files[0] || null;
    if (!body && !file) return;

    const submitBtn = form.querySelector('.chat-send');
    submitBtn.disabled = true;

    try {
      let attachment_url = null, attachment_name = null;
      if (file) {
        if (!isCloudinaryConfigured) throw new Error('File attachments are not configured.');
        const uploaded = await uploadToCloudinary(file, `barny/chat/${orderId}`);
        attachment_url = uploaded.url;
        attachment_name = file.name;
      }
      const { data: inserted, error } = await supabase.from('order_messages').insert({
        order_id: orderId,
        sender_id: myUserId,
        sender_role: myRole,
        body,
        attachment_url,
        attachment_name
      }).select('id, sender_id, sender_role, body, attachment_url, attachment_name, created_at').single();
      if (error) throw error;
      appendMessage(inserted);
      input.value = '';
      fileInput.value = '';
      fileNameEl.hidden = true;
    } catch (error) {
      alert(error.message || 'Could not send the message.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  load();

  return () => { if (channel) supabase.removeChannel(channel); };
}
