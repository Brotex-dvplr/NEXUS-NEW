/* NEXUS friend challenges: Supabase-backed XP duels and shareable invite links. */
(() => {
  const initialInviteCode = new URLSearchParams(location.search).get('challenge') || '';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stateLabel = status => ({waiting:'منتظر دوست',active:'در حال رقابت',completed:'پایان‌یافته',cancelled:'لغوشده'}[status] || status);
  const dateText = value => value ? new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
  const setStatus = (text, error = false) => {
    const el = $('socialStatus');
    if (el) { el.textContent = text; el.style.color = error ? '#ff8f8f' : 'var(--muted)'; }
  };
  const client = () => window.NEXUSLeaderboard?.getClient?.() || null;
  const user = () => window.NEXUSLeaderboard?.getUser?.() || null;
  const makeInviteLink = code => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('challenge', code);
    url.hash = 'friends';
    return url.toString();
  };
  const inviteCodeFrom = value => {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text);
      const fromUrl = url.searchParams.get('challenge');
      if (fromUrl) return fromUrl.trim().toLowerCase();
    } catch {}
    const match = text.match(/[a-f0-9]{12}/i);
    return (match ? match[0] : text).trim().toLowerCase();
  };
  function updateAuth() {
    const signedIn = !!user();
    if ($('socialAuthNotice')) $('socialAuthNotice').hidden = signedIn;
    if ($('socialMain')) $('socialMain').hidden = !signedIn;
    if (signedIn) setStatus('حساب آنلاین متصل است؛ می‌توانی دعوت بسازی یا دعوت دوستت را بپذیری.');
    else setStatus('برای ساختن یا پذیرفتن چالش، ابتدا وارد حساب آنلاین NEXUS شو.');
  }
  async function refreshChallenges() {
    const db = client(), current = user(), host = $('socialChallenges');
    if (!host) return;
    if (!db || !current) {
      host.innerHTML = '<p class="empty">برای مشاهده چالش‌ها وارد حساب آنلاین شو.</p>';
      updateAuth();
      return;
    }
    host.innerHTML = '<p class="empty">در حال دریافت چالش‌ها…</p>';
    const { data, error } = await db.from('nexus_challenges')
      .select('id,invite_code,creator_id,opponent_id,status,duration_hours,creator_delta,opponent_delta,winner_id,created_at,accepted_at,expires_at,completed_at')
      .or('creator_id.eq.' + current.id + ',opponent_id.eq.' + current.id)
      .order('created_at', { ascending: false }).limit(30);
    if (error) {
      host.innerHTML = '<p class="empty">چالش‌ها بارگذاری نشدند. مطمئن شو فایل <code>supabase/social-challenges.sql</code> در Supabase اجرا شده است.</p>';
      setStatus('خطا در بارگذاری چالش‌ها: ' + error.message, true);
      return;
    }
    if (!data?.length) {
      host.innerHTML = '<p class="empty">هنوز چالشی نداری. یک لینک دعوت بساز و برای دوستت بفرست! ✨</p>';
      return;
    }
    const ids = [...new Set(data.flatMap(c => [c.creator_id, c.opponent_id]).filter(Boolean))];
    const { data: profiles } = await db.from('nexus_profiles').select('user_id,display_name').in('user_id', ids);
    const names = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name]));
    host.innerHTML = data.map(c => {
      const isCreator = c.creator_id === current.id;
      const opponent = c.opponent_id ? (names[c.opponent_id] || 'دوست NEXUS') : '';
      const creator = names[c.creator_id] || 'بازیکن NEXUS';
      const friendName = isCreator ? opponent : creator;
      const winnerText = c.status !== 'completed' ? '' : (!c.winner_id ? 'نتیجه مساوی شد 🤝' : (c.winner_id === current.id ? 'تو برنده شدی! 🏆' : 'دوستت برنده شد 🏆'));
      const scores = c.status === 'completed'
        ? '<div class="listrow"><span><b>' + esc(creator) + '</b><small>XP در بازه</small></span><strong>+' + Number(c.creator_delta || 0).toLocaleString('fa-IR') + '</strong></div><div class="listrow"><span><b>' + esc(opponent || 'دوست') + '</b><small>XP در بازه</small></span><strong>+' + Number(c.opponent_delta || 0).toLocaleString('fa-IR') + '</strong></div><p class="tag">' + esc(winnerText) + '</p>'
        : '';
      const invite = c.status === 'waiting' && isCreator
        ? '<label>لینک دعوت<input class="field" readonly value="' + esc(makeInviteLink(c.invite_code)) + '"></label><button class="btn" type="button" data-copy-challenge="' + esc(c.invite_code) + '"><i data-lucide="copy"></i>کپی لینک دعوت</button>'
        : '';
      const timer = c.status === 'active'
        ? '<p class="empty">پایان چالش: ' + esc(dateText(c.expires_at)) + '</p>' +
          (Date.now() >= new Date(c.expires_at).getTime()
            ? '<button class="btn primary" type="button" data-finish-challenge="' + esc(c.id) + '">ثبت نتیجه نهایی</button>'
            : '<p class="tag">هنوز زمان باقی است؛ با کسب XP آنلاین رقابت کن.</p>')
        : '';
      return '<article class="card" style="cursor:default;margin-bottom:12px"><div class="actions" style="margin-top:0;align-items:center"><span class="tag">' + esc(stateLabel(c.status)) + '</span><span class="muted">' + Number(c.duration_hours) + ' ساعت</span></div><h3 style="margin-top:12px">' + (c.status === 'waiting' ? 'دعوت از دوست' : 'دوئل با ' + esc(friendName || 'دوست')) + '</h3><p class="muted">ایجاد: ' + esc(dateText(c.created_at)) + (c.accepted_at ? ' · شروع: ' + esc(dateText(c.accepted_at)) : '') + '</p>' + invite + timer + scores + '</article>';
    }).join('');
    if (window.lucide) window.lucide.createIcons();
  }
  async function createChallenge() {
    const db = client();
    if (!db || !user()) { setStatus('برای ساخت چالش ابتدا وارد حساب شو.', true); return; }
    const button = $('socialCreate');
    button.disabled = true;
    try {
      const duration = Number($('socialDuration').value);
      const { data, error } = await db.rpc('nexus_create_challenge', { p_duration_hours: duration });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.invite_code) throw new Error('پاسخ ساخت دعوت نامعتبر بود.');
      $('socialInviteLink').value = makeInviteLink(result.invite_code);
      $('socialInviteResult').hidden = false;
      setStatus('لینک دعوت ساخته شد! آن را برای دوستت بفرست.');
      await refreshChallenges();
    } catch (error) {
      setStatus('ساخت چالش ناموفق بود: ' + error.message, true);
    } finally { button.disabled = false; }
  }
  async function acceptChallenge() {
    const db = client();
    if (!db || !user()) { setStatus('برای پذیرفتن دعوت ابتدا وارد حساب شو.', true); return; }
    const code = inviteCodeFrom($('socialInviteCode').value);
    if (!code || code.length < 8) { setStatus('کد یا لینک دعوت معتبر وارد کن.', true); return; }
    const button = $('socialAccept');
    button.disabled = true;
    try {
      const { data, error } = await db.rpc('nexus_accept_challenge', { p_invite_code: code });
      if (error) throw error;
      $('socialInviteCode').value = '';
      setStatus('دعوت پذیرفته شد! دوئل XP شروع شد؛ موفق باشی. ⚔️');
      const url = new URL(location.href);
      url.searchParams.delete('challenge');
      url.hash = 'friends';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      await refreshChallenges();
    } catch (error) {
      setStatus('پذیرفتن دعوت ناموفق بود: ' + error.message, true);
    } finally { button.disabled = false; }
  }
  async function finishChallenge(id, button) {
    const db = client();
    if (!db || !user()) { setStatus('ابتدا وارد حساب شو.', true); return; }
    button.disabled = true;
    try {
      const { data, error } = await db.rpc('nexus_finish_challenge', { p_challenge_id: id });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status !== 'completed') throw new Error('نتیجه نهایی دریافت نشد.');
      setStatus('نتیجه ثبت شد! بازیکن اول: +' + Number(result.creator_delta || 0).toLocaleString('fa-IR') + ' XP · بازیکن دوم: +' + Number(result.opponent_delta || 0).toLocaleString('fa-IR') + ' XP');
      await refreshChallenges();
    } catch (error) {
      setStatus('ثبت نتیجه ناموفق بود: ' + error.message, true);
      button.disabled = false;
    }
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('لینک دعوت کپی شد؛ برای دوستت بفرست.');
    } catch {
      const input = $('socialInviteLink');
      if (input) { input.focus(); input.select(); }
      setStatus('کپی خودکار در این مرورگر در دسترس نیست؛ لینک را انتخاب و کپی کن.', true);
    }
  }
  function bind() {
    $('socialCreate')?.addEventListener('click', createChallenge);
    $('socialAccept')?.addEventListener('click', acceptChallenge);
    $('socialRefresh')?.addEventListener('click', refreshChallenges);
    $('socialCopyInvite')?.addEventListener('click', () => copyText($('socialInviteLink').value));
    $('socialShareInvite')?.addEventListener('click', async () => {
      const url = $('socialInviteLink').value;
      if (!url) return;
      if (navigator.share) {
        try { await navigator.share({ title: 'چالش دوستانه NEXUS', text: 'بیا با هم در NEXUS رقابت XP کنیم!', url }); }
        catch (error) { if (error?.name !== 'AbortError') setStatus('اشتراک‌گذاری انجام نشد؛ لینک را کپی کن.', true); }
      } else await copyText(url);
    });
    $('socialChallenges')?.addEventListener('click', event => {
      const copy = event.target.closest('[data-copy-challenge]');
      if (copy) { copyText(makeInviteLink(copy.dataset.copyChallenge)); return; }
      const finish = event.target.closest('[data-finish-challenge]');
      if (finish) finishChallenge(finish.dataset.finishChallenge, finish);
    });
  }
  function init() {
    if (initialInviteCode && $('socialInviteCode')) $('socialInviteCode').value = initialInviteCode;
    bind();
    updateAuth();
    refreshChallenges();
    const db = client();
    if (db) db.auth.onAuthStateChange(() => setTimeout(() => { updateAuth(); refreshChallenges(); }, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();