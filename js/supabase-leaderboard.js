/* NEXUS leaderboard: Supabase Auth accounts keyed by nickname, no email collected. */
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

  async function profile(user) {
    const { data, error } = await client.from('nexus_profiles')
      .select('user_id,display_name,total_xp').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  function renderAuth(user, p) {
    if ($('sbAuthBox')) $('sbAuthBox').hidden = !!user;
    if ($('sbUserBox')) $('sbUserBox').hidden = !user;
    if ($('sbUserEmail')) $('sbUserEmail').textContent = user ? 'نام مستعار: ' + (p?.display_name || user.user_metadata?.display_name || 'کاربر NEXUS') : '';
    window.NEXUS_SUPABASE_USER = user || null;
  }
  async function renderLeaderboard() {
    if (!client || !$('sbLeaderboardRows')) return;
    const { data, error } = await client.from('nexus_leaderboard')
      .select('rank,user_id,display_name,total_xp').order('rank', { ascending: true }).limit(100);
    if (error) { status('خطا در دریافت رتبه‌ها: ' + error.message, true); return; }
    $('sbLeaderboardRows').innerHTML = !data?.length
      ? '<p class="empty">هنوز کسی در لیدربورد ثبت نشده است. اولین نفر باش! 🚀</p>'
      : data.map(r => '<div class="listrow"><div class="avatar">' +
        (Number(r.rank) <= 3 ? ['🥇','🥈','🥉'][Number(r.rank)-1] : Number(r.rank)) +
        '</div><span><b>' + esc(r.display_name) + '</b><small>' +
        (Number(r.rank) === 1 ? 'پیشتاز NEXUS' : 'بازیکن جهانی') +
        '</small></span><strong>' + Number(r.total_xp).toLocaleString() + ' XP</strong></div>').join('');
  }
  async function refreshAuth() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) { renderAuth(null, null); return; }
    try { renderAuth(user, await profile(user)); }
    catch (e) { status('پروفایل بارگذاری نشد: ' + e.message, true); }
  }
  function bind() {
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
      .subscribe();
    client.auth.onAuthStateChange(() => { setTimeout(refreshAuth, 0); setTimeout(renderLeaderboard, 0); });
    status('اتصال آنلاین برقرار است • لیدربورد زنده');
  }
  window.NEXUSLeaderboard = {
    refresh: renderLeaderboard,
    award: async activityKey => {
      if (!client) throw new Error('Supabase هنوز پیکربندی نشده است.');
      const { data, error } = await client.rpc('nexus_award_activity', { p_activity_key: activityKey });
      if (error) throw error;
      await renderLeaderboard();
      return Array.isArray(data) ? data[0] : data;
    }
  };
  document.addEventListener('DOMContentLoaded', () => init().catch(e => status('راه‌اندازی ناموفق: ' + e.message, true)));
})();