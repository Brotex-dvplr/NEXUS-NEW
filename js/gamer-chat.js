/* NEXUS public gamer chat — Supabase Auth + Realtime */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let channel = null, loading = false, lastMessageId = 0, knownIds = new Set();
  const client = () => window.NEXUSLeaderboard?.getClient?.() || null;
  const user = () => window.NEXUSLeaderboard?.getUser?.() || null;
  const setStatus = (message, error = false) => {
    const el = $('chatRoomStatus');
    if (el) { el.textContent = message; el.style.color = error ? '#ff8f8f' : 'var(--muted)'; }
  };
  function timeLabel(value) {
    try { return new Date(value).toLocaleString('fa-IR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return ''; }
  }
  function appendMessage(row, scroll = false) {
    if (!row || knownIds.has(row.id)) return;
    const host = $('chatRoomMessages');
    if (!host) return;
    const welcome = host.querySelector('.chat-room-welcome');
    if (welcome) welcome.remove();
    knownIds.add(row.id);
    lastMessageId = Math.max(lastMessageId, Number(row.id) || 0);
    const current = user();
    const own = current && current.id === row.user_id;
    const article = document.createElement('article');
    article.className = 'room-message' + (own ? ' own' : '');
    const head = document.createElement('div');
    head.className = 'room-message-head';
    const name = document.createElement('b');
    name.textContent = own ? 'تو' : (row.sender_name || 'گیمر NEXUS');
    const time = document.createElement('time');
    time.dateTime = row.created_at || '';
    time.textContent = timeLabel(row.created_at);
    const body = document.createElement('p');
    body.textContent = row.message || '';
    head.append(name, time);
    article.append(head, body);
    host.append(article);
    if (scroll) host.scrollTop = host.scrollHeight;
  }
  async function loadMessages() {
    const db = client();
    if (!db || !user() || loading) return;
    loading = true;
    const host = $('chatRoomMessages');
    try {
      const { data, error } = await db.from('nexus_chat_messages')
        .select('id,user_id,sender_name,message,created_at')
        .order('id', { ascending: false }).limit(100);
      if (error) throw error;
      knownIds = new Set();
      lastMessageId = 0;
      host.innerHTML = '';
      const rows = (data || []).slice().reverse();
      if (!rows.length) {
        const welcome = document.createElement('p');
        welcome.className = 'empty chat-room-welcome';
        welcome.textContent = 'هنوز پیامی نیست؛ اولین سلام را تو بفرست! 👋';
        host.append(welcome);
      } else rows.forEach(row => appendMessage(row));
      host.scrollTop = host.scrollHeight;
      setStatus('اتصال به گروه چت برقرار است · پیام‌های تازه زنده می‌رسند.');
    } catch (error) {
      setStatus('بارگذاری پیام‌ها ناموفق بود: ' + error.message, true);
      if (host && !host.children.length) host.innerHTML = '<p class="empty">اتصال Supabase یا اجرای SQL گروه چت را بررسی کن.</p>';
    } finally { loading = false; }
  }
  function subscribe() {
    const db = client();
    if (!db || !user()) return;
    if (channel) db.removeChannel(channel);
    channel = db.channel('nexus-public-gamer-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nexus_chat_messages' }, payload => {
        appendMessage(payload.new, true);
      })
      .subscribe(state => {
        if (state === 'SUBSCRIBED') setStatus('آنلاین · پیام‌ها به‌صورت زنده به‌روزرسانی می‌شوند.');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('اتصال زنده برقرار نشد؛ دکمه تازه‌سازی را بزن.', true);
      });
  }
  async function sendMessage() {
    const db = client(), input = $('chatRoomInput'), button = $('chatRoomSend');
    if (!db || !user()) { setStatus('برای ارسال پیام ابتدا وارد حساب شو.', true); return; }
    const message = String(input?.value || '').trim();
    if (!message) { setStatus('اول پیام خودت را بنویس.'); input?.focus(); return; }
    if (message.length > 1000) { setStatus('پیام حداکثر می‌تواند ۱۰۰۰ نویسه باشد.', true); return; }
    button.disabled = true;
    try {
      const { data, error } = await db.rpc('nexus_send_chat_message', { p_message: message });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) appendMessage(row, true);
      input.value = '';
      input.focus();
      setStatus('پیامت ارسال شد.');
    } catch (error) {
      setStatus('ارسال پیام ناموفق بود: ' + error.message, true);
    } finally { button.disabled = false; }
  }
  function authUi() {
    const signedIn = !!user();
    if ($('chatRoomAuth')) $('chatRoomAuth').hidden = signedIn;
    if ($('chatRoomMain')) $('chatRoomMain').hidden = !signedIn;
    if (!signedIn) {
      if (channel) { client()?.removeChannel(channel); channel = null; }
      if ($('chatRoomMessages')) $('chatRoomMessages').innerHTML = '<p class="empty">برای دیدن پیام‌ها وارد حساب شو.</p>';
      setStatus('برای ورود به گروه چت، ابتدا وارد حساب NEXUS شو.');
    }
  }
  function bind() {
    $('chatRoomSend')?.addEventListener('click', sendMessage);
    $('chatRoomRefresh')?.addEventListener('click', loadMessages);
    $('chatRoomInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
    });
  }
  function init() {
    bind();
    authUi();
    if (user()) { loadMessages(); subscribe(); }
    window.addEventListener('nexus-auth-change', () => {
      authUi();
      if (user()) { loadMessages(); subscribe(); }
    });
    const db = client();
    if (db) db.auth.onAuthStateChange(() => setTimeout(() => {
      authUi();
      if (user()) { loadMessages(); subscribe(); }
    }, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
