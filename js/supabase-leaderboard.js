/* NEXUS v2.1.5 · Cyberpunk permanent XP ranks and profile cosmetics. */
(() => {
  const cfg = window.NEXUS_SUPABASE_CONFIG;
  let client = null, channel = null;
  const $ = id => document.getElementById(id);
  const status = (text, error = false) => {
    const el = $('sbStatus');
    if (el) { el.textContent = text; el.style.color = error ? '#ff8f8f' : 'var(--muted)'; }
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cleanAlias = value => String(value || '').trim().toLowerCase();
  const validAlias = value => /^[a-z0-9][a-z0-9_.-]{2,19}$/.test(value);
  // Supabase Auth requires an email or phone. A reserved .invalid address lets
  // the UI use nicknames only; it is never a real inbox and is never displayed.
  const authEmail = alias => cleanAlias(alias) + '@nexus.invalid';

  const RANKS = [
    { name: 'BRONZE', title: 'شروع مسیر', min: 0, max: 499, color: '#d99a6c', emblem: 'I' },
    { name: 'SILVER', title: 'بازیکن فعال', min: 500, max: 1499, color: '#c7d6e8', emblem: 'II' },
    { name: 'GOLD', title: 'بازیکن حرفه‌ای', min: 1500, max: 3499, color: '#ffd166', emblem: 'III' },
    { name: 'DIAMOND', title: 'الیت', min: 3500, max: 6999, color: '#45d9ff', emblem: 'IV' },
    { name: 'MASTER', title: 'استاد بازی', min: 7000, max: 11999, color: '#ff5d78', emblem: 'V' },
    { name: 'NEXUS GOD', title: 'افسانه‌ای', min: 12000, max: Infinity, color: '#ba9bff', emblem: 'VI' }
  ];
  function getRank(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    const index = RANKS.findIndex(rank => xp <= rank.max);
    const currentIndex = index < 0 ? RANKS.length - 1 : index;
    const rank = RANKS[currentIndex];
    const next = RANKS[currentIndex + 1] || null;
    const progress = next ? Math.max(0, Math.min(100, ((xp - rank.min) / (next.min - rank.min)) * 100)) : 100;
    return { ...rank, xp, next, progress, remaining: next ? Math.max(0, next.min - xp) : 0 };
  }
  function rankChip(totalXp) {
    const rank = getRank(totalXp);
    return '<small class="rank-chip" style="--rank-color:' + rank.color + '">' + esc(rank.name) + '</small>';
  }
  function renderRank(totalXp) {
    const host = $('sbRankCard');
    if (!host) return;
    const rank = getRank(totalXp);
    host.dataset.rank = rank.name.toLowerCase().replace(/\s+/g, '-');
    host.style.setProperty('--rank-color', rank.color);
    $('sbRankEmblem').innerHTML = '<svg viewBox="0 0 32 25" aria-hidden="true"><path d="M3 6.5 9.3 12 15.9 2.5 22.5 12 29 6.5 26 21H6Z"/><path d="M6 23H26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>' + esc(rank.emblem) + '</span>';
    $('sbRankName').textContent = rank.name;
    $('sbRankDescription').textContent = rank.title;
    $('sbRankXp').textContent = rank.xp.toLocaleString() + ' XP';
    $('sbRankProgress').style.width = rank.progress + '%';
    $('sbRankProgressText').textContent = rank.next ? rank.remaining.toLocaleString() + ' XP تا رتبه بعدی' : 'بالاترین رتبه باز شده!';
    $('sbRankNext').textContent = rank.next ? rank.next.name : 'MAX RANK';
  }

  async function profile(user) {
    const { data, error } = await client.from('nexus_profiles')
      .select('user_id,display_name,total_xp,avatar_url').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  function renderAuth(user, p) {
    if ($('sbAuthBox')) $('sbAuthBox').hidden = !!user;
    if ($('sbUserBox')) $('sbUserBox').hidden = !user;
    if ($('sbUserEmail')) $('sbUserEmail').textContent = user ? 'نام مستعار: ' + (p?.display_name || user.user_metadata?.display_name || 'کاربر NEXUS') : '';
    if ($('sbDisplayName')) $('sbDisplayName').value = user ? (p?.display_name || user.user_metadata?.display_name || '') : '';
    renderAvatar(p?.avatar_url || user?.user_metadata?.avatar_url || '');
    renderRank(p?.total_xp || 0);
    const fileInput = $('sbAvatarFile');
    const chooseFileButton = $('sbAvatarChooseFile');
    const removeButton = $('sbAvatarRemove');
    if (fileInput) fileInput.disabled = !user;
    if (chooseFileButton) chooseFileButton.disabled = !user;
    if (removeButton) removeButton.disabled = !user;
    window.NEXUS_SUPABASE_USER = user || null;
    window.dispatchEvent(new CustomEvent('nexus-auth-change', { detail: { user: user || null } }));
  }
  function renderAvatar(url) {
    const host = $('sbAvatarPreview');
    if (host) {
      host.innerHTML = url
        ? '<img src="' + esc(url) + '" alt="آواتار پروفایل" referrerpolicy="no-referrer">'
        : '<i data-lucide="user-round"></i>';
      if (window.lucide) window.lucide.createIcons({ root: host });
    }
    document.querySelectorAll('[data-avatar-url]').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.avatarUrl === (url || '') ? 'true' : 'false');
    });
  }
  async function selectAvatar(url) {
    const user = window.NEXUS_SUPABASE_USER;
    if (!client || !user) throw new Error('ابتدا وارد حساب شو.');
    if (!url || !url.startsWith('https://api.dicebear.com/9.x/')) throw new Error('آواتار انتخاب‌شده معتبر نیست.');
    status('در حال ذخیره آواتار…');
    const { error: profileError } = await client.from('nexus_profiles')
      .update({ avatar_url: url }).eq('user_id', user.id);
    if (profileError) throw profileError;
    const { error: metaError } = await client.auth.updateUser({ data: { avatar_url: url } });
    if (metaError) throw metaError;
    renderAvatar(url);
    await renderLeaderboard();
    status('آواتار جدید ذخیره شد! 🎮');
  }
  async function uploadAvatar(file) {
    const user = window.NEXUS_SUPABASE_USER;
    if (!client || !user) throw new Error('ابتدا وارد حساب شو.');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('فقط عکس JPG، PNG یا WebP مجاز است.');
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('حجم عکس باید حداکثر ۲ مگابایت باشد.');
    }
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = user.id + '/avatar-' + Date.now() + '.' + ext;
    status('در حال آپلود عکس…');
    const { error: uploadError } = await client.storage.from('avatars').upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type
    });
    if (uploadError) throw uploadError;
    const { data } = client.storage.from('avatars').getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) throw new Error('لینک عمومی عکس ساخته نشد؛ تنظیم Public bucket را بررسی کن.');
    const { error: profileError } = await client.from('nexus_profiles')
      .update({ avatar_url: url }).eq('user_id', user.id);
    if (profileError) throw profileError;
    const { error: metaError } = await client.auth.updateUser({ data: { avatar_url: url } });
    if (metaError) throw metaError;
    renderAvatar(url);
    await renderLeaderboard();
    status('عکس پروفایل آپلود و ذخیره شد! 🎉');
  }
  async function removeAvatar() {
    if (!window.NEXUS_SUPABASE_USER) throw new Error('ابتدا وارد حساب شو.');
    const user = window.NEXUS_SUPABASE_USER;
    const { error: profileError } = await client.from('nexus_profiles')
      .update({ avatar_url: null }).eq('user_id', user.id);
    if (profileError) throw profileError;
    const { error } = await client.auth.updateUser({ data: { avatar_url: null } });
    if (error) throw error;
    renderAvatar('');
    await renderLeaderboard();
    status('آواتار پیش‌فرض فعال شد.');
  }
  async function renderLeaderboard() {
    if (!client || (!$('sbLeaderboardRows') && !$('homeLeaderboardRows'))) return;
    const { data, error } = await client.from('nexus_leaderboard')
      .select('rank,user_id,display_name,total_xp,avatar_url').order('rank', { ascending: true }).limit(3);
    if (error) { status('خطا در دریافت رتبه‌ها: ' + error.message, true); return; }
    // The leaderboard view now returns avatar_url with each public profile row.
    const rowsHtml = !data?.length
      ? '<p class="empty">هنوز کسی در لیدربورد ثبت نشده است. اولین نفر باش! 🚀</p>'
      : data.map(r => {
        const avatarUrl = r.avatar_url || '';
        const avatarHtml = avatarUrl
          ? '<img src="' + esc(avatarUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
          : '<i data-lucide="user-round" aria-hidden="true"></i>';
        return '<div class="listrow"><div class="avatar">' + avatarHtml +
          '</div><span><b>' + esc(r.display_name) + '</b><small>' +
          (Number(r.rank) === 1 ? 'پیشتاز NEXUS' : 'بازیکن جهانی') +
          '</small>' + rankChip(r.total_xp) + '</span><strong>' + Number(r.total_xp).toLocaleString() + ' XP</strong></div>';
      }).join('');
    if ($('sbLeaderboardRows')) $('sbLeaderboardRows').innerHTML = rowsHtml;
    if ($('homeLeaderboardRows')) $('homeLeaderboardRows').innerHTML = rowsHtml;
    if (window.lucide) {
      if ($('sbLeaderboardRows')) window.lucide.createIcons({ root: $('sbLeaderboardRows') });
      if ($('homeLeaderboardRows')) window.lucide.createIcons({ root: $('homeLeaderboardRows') });
    }
  }
  async function refreshAuth() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) { renderAuth(null, null); return; }
    try { renderAuth(user, await profile(user)); }
    catch (e) { status('پروفایل بارگذاری نشد: ' + e.message, true); }
  }
  function bind() {
    $('sbAvatarChooseFile')?.addEventListener('click', () => {
      const fileInput = $('sbAvatarFile');
      if (fileInput && !fileInput.disabled) fileInput.click();
      else status('برای انتخاب عکس ابتدا وارد حساب شو.', true);
    });
    $('sbAvatarFile')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try { await uploadAvatar(file); }
      catch (err) {
        status('آپلود عکس ناموفق: ' + err.message + ' — Bucket به نام avatars و Policy آپلود را بررسی کن.', true);
      }
    });
    $('sbAvatarPicker')?.addEventListener('click', async e => {
      const button = e.target.closest('[data-avatar-url]');
      if (!button) return;
      try { await selectAvatar(button.dataset.avatarUrl); }
      catch (err) { status('ذخیره آواتار ناموفق: ' + err.message, true); }
    });
    $('sbAvatarRemove')?.addEventListener('click', async () => {
      try { await removeAvatar(); }
      catch (err) { status('حذف عکس ناموفق: ' + err.message, true); }
    });

    $('sbSignInForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const alias = cleanAlias($('sbLoginName').value);
      try {
        if (!validAlias(alias)) throw new Error('نام مستعار باید ۳ تا ۲۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
        const { error } = await client.auth.signInWithPassword({
          email: authEmail(alias), password: $('sbLoginPassword').value
        });
        if (error) throw error;
        status('ورود موفق بود.');
      } catch (err) { status('ورود ناموفق: ' + err.message, true); }
    });
    $('sbSignUpForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const alias = cleanAlias($('sbSignupName').value);
      try {
        if (!validAlias(alias)) throw new Error('نام مستعار باید ۳ تا ۲۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
        const password = $('sbSignupPassword').value;
        if (password.length < 8 || password.length > 72) throw new Error('رمز عبور باید ۸ تا ۷۲ کاراکتر باشد.');
        const { data, error } = await client.auth.signUp({
          email: authEmail(alias), password,
          options: { data: { display_name: alias } }
        });
        if (error) throw error;
        if (!data.session) {
          status('حساب درخواست شد، اما تأیید ایمیل هنوز فعال است. در Supabase تنظیم Confirm email را خاموش کن و دوباره تلاش کن.', true);
          return;
        }
        status('حساب ساخته شد! نام مستعارت را برای ورود به خاطر بسپار.');
        await refreshAuth(); await renderLeaderboard();
      } catch (err) { status('ساخت حساب ناموفق: ' + err.message, true); }
    });
    $('sbSaveName')?.addEventListener('click', async () => {
      try {
        const user = window.NEXUS_SUPABASE_USER;
        if (!user) throw new Error('ابتدا وارد حساب شو.');
        const name = String($('sbDisplayName')?.value || '').trim();
        if (name.length < 2 || name.length > 24) throw new Error('نام نمایشی باید بین ۲ تا ۲۴ نویسه باشد.');
        const { error } = await client.from('nexus_profiles').update({ display_name: name }).eq('user_id', user.id);
        if (error) throw error;
        status('نام نمایشی ذخیره شد.');
        await refreshAuth();
        await renderLeaderboard();
      } catch (err) { status('ذخیره نام ناموفق: ' + err.message, true); }
    });
    $('sbSignOut')?.addEventListener('click', async () => {
      const { error } = await client.auth.signOut();
      status(error ? error.message : 'از حساب خارج شدی.', !!error);
    });
    $('sbCompleteMission')?.addEventListener('click', async () => {
      try {
        if (!window.NEXUS_SUPABASE_USER) throw new Error('برای ثبت XP ابتدا وارد حساب شو.');
        const { data, error } = await client.rpc('nexus_award_activity', { p_activity_key: 'daily_mission' });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        status(row?.already_awarded ? 'امتیاز مأموریت امروز قبلاً ثبت شده.' : '+' + row?.awarded + ' XP ثبت شد!');
        if (row?.total_xp != null) renderRank(row.total_xp);
        await renderLeaderboard();
      } catch (err) { status('ثبت مأموریت ناموفق: ' + err.message, true); }
    });
  }
  async function init() {
    if (!cfg?.url || cfg.url.includes('YOUR_PROJECT_REF') || !cfg?.anonKey || cfg.anonKey.includes('YOUR_SUPABASE')) {
      status('برای فعال‌شدن لیدربورد، اطلاعات پروژه Supabase را در supabase-config.js قرار بده.', true); return;
    }
    if (!window.supabase?.createClient) { status('کتابخانه Supabase بارگذاری نشد؛ اینترنت را بررسی کن.', true); return; }
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    bind();
    await refreshAuth();
    await renderLeaderboard();
    channel = client.channel('nexus-leaderboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nexus_profiles' }, renderLeaderboard)
      .subscribe((state, err) => {
        if (state === 'SUBSCRIBED') status('اتصال آنلاین برقرار است • لیدربورد زنده');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          status('به‌روزرسانی زنده برقرار نشد؛ دکمه تازه‌سازی را امتحان کن.' + (err?.message ? ' ' + err.message : ''), true);
        }
      });
    client.auth.onAuthStateChange(() => { setTimeout(refreshAuth, 0); setTimeout(renderLeaderboard, 0); });
  }
  window.NEXUSLeaderboard = {
    refresh: renderLeaderboard,
    getClient: () => client,
    getUser: () => window.NEXUS_SUPABASE_USER || null,
    award: async activityKey => {
      if (!client) throw new Error('Supabase هنوز پیکربندی نشده است.');
      const { data, error } = await client.rpc('nexus_award_activity', { p_activity_key: activityKey });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.total_xp != null) renderRank(row.total_xp);
      await renderLeaderboard();
      return row;
    }
  };
  document.addEventListener('DOMContentLoaded', () => init().catch(e => status('راه‌اندازی ناموفق: ' + e.message, true)));
})();