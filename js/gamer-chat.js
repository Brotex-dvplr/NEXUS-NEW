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
    article.dataset.messageId = String(row.id);
    article.append(head, body);
    if (current && current.id !== row.user_id) {
      const reportButton = document.createElement('button');
      reportButton.type = 'button';
      reportButton.className = 'chat-report-btn';
      reportButton.textContent = '⚑ گزارش پیام';
      reportButton.setAttribute('aria-label', 'گزارش پیام ' + (row.sender_name || 'گیمر'));
      reportButton.addEventListener('click', () => reportMessage(row, reportButton));
      article.append(reportButton);
    }
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
  function moderationStatus(message, error = false) {
    const el = $('chatModerationStatus');
    if (el) { el.textContent = message; el.style.color = error ? '#ff8f8f' : 'var(--muted)'; }
  }
  async function reportMessage(row, button) {
    const db = client();
    if (!db || !user()) { setStatus('برای گزارش پیام ابتدا وارد حساب شو.', true); return; }
    const reason = window.prompt('دلیل گزارش را کوتاه بنویس (اختیاری):', 'پیام نامناسب یا اسپم');
    if (reason === null) return;
    if (reason.trim().length > 300) { setStatus('دلیل گزارش حداکثر ۳۰۰ نویسه است.', true); return; }
    if (button) button.disabled = true;
    try {
      const { error } = await db.rpc('nexus_report_chat_message', {
        p_message_id: Number(row.id),
        p_reason: reason.trim() || null
      });
      if (error) throw error;
      setStatus('گزارش پیام ثبت شد؛ ممنون که به امن‌تر شدن NEXUS کمک می‌کنی.');
      if (button) { button.textContent = 'گزارش شد'; button.disabled = true; }
    } catch (error) {
      setStatus(error.message?.includes('already reported') ? 'این پیام را قبلاً گزارش کرده‌ای.' : 'ثبت گزارش ناموفق بود: ' + error.message, true);
      if (button) button.disabled = false;
    }
  }
  function removeMessageFromRoom(messageId) {
    const host = $('chatRoomMessages');
    const item = host?.querySelector('[data-message-id="' + String(messageId) + '"]');
    if (item) item.remove();
    knownIds.delete(Number(messageId));
    if (host && !host.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty chat-room-welcome';
      empty.textContent = 'پیامی در اتاق نیست؛ اولین پیام را بفرست! 👋';
      host.append(empty);
    }
  }
  async function loadAdminReports() {
    const db = client();
    if (!db || !user()) return;
    const list = $('chatReportList');
    if (!list) return;
    moderationStatus('در حال بارگذاری گزارش‌ها…');
    list.replaceChildren();
    try {
      const { data, error } = await db.rpc('nexus_admin_list_chat_reports');
      if (error) throw error;
      if (!data || !data.length) {
        moderationStatus('گزارش بازی برای نمایش وجود ندارد. گزارش‌های جدید اینجا ظاهر می‌شوند.');
        return;
      }
      data.forEach(report => {
        const card = document.createElement('article');
        card.className = 'chat-report-card';
        const meta = document.createElement('div');
        meta.className = 'chat-report-meta';
        const fields = [
          'گزارش‌دهنده: ' + (report.reporter_name || 'گیمر'),
          'فرستنده پیام: ' + (report.message_sender_name || 'گیمر'),
          'وضعیت: ' + (report.status === 'open' ? 'در انتظار بررسی' : report.status === 'resolved' ? 'رسیدگی‌شده' : 'ردشده'),
          'شناسه پیام: ' + report.message_id
        ];
        fields.forEach(value => { const span = document.createElement('span'); span.textContent = value; meta.append(span); });
        const messageLabel = document.createElement('b'); messageLabel.textContent = 'متن پیام گزارش‌شده';
        const message = document.createElement('p'); message.textContent = report.message_text || '[متن در دسترس نیست]';
        const reasonLabel = document.createElement('b'); reasonLabel.textContent = 'دلیل گزارش';
        const reason = document.createElement('p'); reason.textContent = report.reason || 'دلیلی وارد نشده است.';
        card.append(meta, messageLabel, message, reasonLabel, reason);
        if (report.admin_note) { const note = document.createElement('p'); note.textContent = 'یادداشت مدیر: ' + report.admin_note; card.append(note); }
        if (report.status === 'open') {
          const actions = document.createElement('div'); actions.className = 'chat-report-actions';
          const resolve = document.createElement('button'); resolve.type = 'button'; resolve.className = 'btn primary'; resolve.textContent = 'علامت‌گذاری به‌عنوان رسیدگی‌شده';
          resolve.addEventListener('click', () => reviewReport(report.report_id, 'resolved'));
          const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'btn'; dismiss.textContent = 'رد گزارش';
          dismiss.addEventListener('click', () => reviewReport(report.report_id, 'dismissed'));
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn'; remove.textContent = 'حذف پیام';
          remove.addEventListener('click', () => deleteReportedMessage(report.message_id));
          actions.append(resolve, dismiss, remove); card.append(actions);
        }
        list.append(card);
      });
      moderationStatus('تعداد گزارش‌های نمایش‌داده‌شده: ' + data.length + ' (حداکثر ۲۰۰ مورد اخیر).');
    } catch (error) {
      moderationStatus('بارگذاری گزارش‌ها ناموفق بود: ' + error.message, true);
    }
  }
  async function reviewReport(reportId, status) {
    const db = client();
    try {
      const note = status === 'dismissed' ? (window.prompt('یادداشت مدیر (اختیاری):', '') || '').trim() : '';
      const { error } = await db.rpc('nexus_admin_review_chat_report', {
        p_report_id: Number(reportId), p_status: status, p_note: note || null
      });
      if (error) throw error;
      await loadAdminReports();
    } catch (error) { moderationStatus('به‌روزرسانی گزارش ناموفق بود: ' + error.message, true); }
  }
  async function deleteReportedMessage(messageId) {
    if (!window.confirm('پیام از اتاق چت حذف شود؟ گزارش برای سابقه باقی می‌ماند.')) return;
    const db = client();
    try {
      const { error } = await db.rpc('nexus_admin_delete_chat_message', { p_message_id: Number(messageId) });
      if (error) throw error;
      removeMessageFromRoom(messageId);
      await loadAdminReports();
      setStatus('پیام حذف شد و سابقه گزارش حفظ شد.');
    } catch (error) { moderationStatus('حذف پیام ناموفق بود: ' + error.message, true); }
  }
  async function checkAdminAccess() {
    const db = client(), panel = $('chatModerationPanel');
    if (!panel) return;
    if (!db || !user()) { panel.hidden = true; return; }
    try {
      const { data, error } = await db.rpc('nexus_chat_is_admin');
      if (error) throw error;
      panel.hidden = data !== true;
      if (data === true) await loadAdminReports();
    } catch (error) {
      panel.hidden = true;
      console.warn('NEXUS moderation access check failed:', error.message);
    }
  }
  function bind() {
    $('chatRoomSend')?.addEventListener('click', sendMessage);
    $('chatRoomRefresh')?.addEventListener('click', loadMessages);
    $('chatModerationRefresh')?.addEventListener('click', loadAdminReports);
    $('chatRoomInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
    });
  }
  function init() {
    bind();
    authUi();
    if (user()) { loadMessages(); subscribe(); }
    checkAdminAccess();
    window.addEventListener('nexus-auth-change', () => {
      authUi();
      if (user()) { loadMessages(); subscribe(); }
      checkAdminAccess();
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
