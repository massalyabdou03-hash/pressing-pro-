import { sb, $, esc, fmt, fmtPhone, waLink, dateShort, dateTime, subState, PRICE_MONTH, q, errMsg, toast, I, qrBlock } from './core.js';

const root = $('#root');
const S = { user: null, rows: [], filter: 'tous', search: '', offline: false, at: null };
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
const isNet = e => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network|fetch|timeout|ERR_/i.test(String((e && e.message) || e || ''));
const CK = () => 'pp-admin:' + (S.user ? S.user.id : 'x');
const cacheGet = () => { try { return JSON.parse(localStorage.getItem(CK()) || 'null'); } catch (e) { return null; } };
const cacheSet = v => { try { localStorage.setItem(CK(), JSON.stringify(v)); } catch (e) {} };
function showCached() {
  const c = cacheGet();
  if (!c) { root.innerHTML = '<div class="auth"><div class="card stack"><h2>Pas de connexion</h2><p class="hint">L’admin n’a encore jamais été ouvert avec internet sur ce téléphone. Reconnecte-toi une fois pour pouvoir le consulter hors ligne.</p><button class="btn" type="button" data-a="reload">Réessayer</button></div></div>'; return; }
  S.offline = true; S.at = c.at; S.rows = c.rows; S.rows.forEach(r => { r.ss = subState(r); }); render();
}
window.addEventListener('online', () => { if (S.user) load(); });

sb.auth.onAuthStateChange((ev, session) => setTimeout(() => start(session), 0));

async function start(session) {
  if (!session) { S.user = null; renderLogin(); return; }
  if (S.user && S.user.id === session.user.id) return;
  S.user = session.user;
  let ok = false;
  try { ok = await q(sb.rpc('is_platform_admin')); } catch (e) { if (isNet(e)) { showCached(); return; } ok = false; }
  if (!ok) {
    root.innerHTML = '<div class="auth"><div class="card stack"><h2>Accès refusé</h2><p class="hint">Le compte ' + esc(S.user.email) + ' n’est pas administrateur de Pressing Pro.</p><button class="btn" id="out" type="button">Se déconnecter</button></div></div>';
    $('#out').onclick = () => sb.auth.signOut();
    return;
  }
  await load();
}

function renderLogin() {
  root.innerHTML = '<div class="auth"><form class="card stack" id="f" novalidate>' +
    '<div class="hstack"><span class="logo">' + I.shield + '</span><div><div class="brandname">Admin Pressing Pro</div><div class="brandsub">Réservé au propriétaire de la plateforme</div></div></div>' +
    '<div class="field"><label for="e">Email</label><input class="inp" id="e" type="email" autocomplete="email" required></div>' +
    '<div class="field"><label for="p">Mot de passe</label><input class="inp" id="p" type="password" autocomplete="current-password" required></div>' +
    '<p class="err" id="err" hidden></p><button class="btn primary block" type="submit">Se connecter</button>' +
    '<p class="hint">Même compte que sur l’app. Pas encore de compte ? <a href="app.html#signup">Crée-le ici</a> avec ton email administrateur.</p></form></div>';
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#e').value.trim(), password: $('#p').value });
    if (error) { err.textContent = errMsg(error); err.hidden = false; }
  });
}

async function load() {
  try { S.rows = await q(sb.rpc('admin_overview')); S.offline = false; S.at = new Date().toISOString(); cacheSet({ rows: S.rows, at: S.at }); }
  catch (e) {
    if (isNet(e)) { showCached(); return; }
    root.innerHTML = '<div class="auth"><div class="card"><p class="err">' + esc(errMsg(e)) + '</p></div></div>'; return;
  }
  S.rows.forEach(r => { r.ss = subState(r); });
  render();
}

const FILTERS = [
  ['tous', 'Tous', () => true],
  ['active', 'Payants', r => r.ss.k === 'active'],
  ['trial', 'En essai', r => r.ss.k === 'trial'],
  ['soon', 'Expirent sous 7 j', r => (r.ss.k === 'active' || r.ss.k === 'trial') && r.ss.days <= 7],
  ['expired', 'Expirés', r => r.ss.k === 'expired'],
  ['suspended', 'Suspendus', r => r.ss.k === 'suspended']
];
const BADGE = { trial: 'b-info', active: 'b-ok', expired: 'b-bad', suspended: 'b-bad' };

function render() {
  const R = S.rows;
  const n = k => R.filter(r => r.ss.k === k).length;
  const mrr = n('active') * PRICE_MONTH;
  const t30 = R.reduce((s, r) => s + r.orders_30d, 0);
  const vol30 = R.reduce((s, r) => s + Number(r.revenue_30d), 0);
  const counts = {}; FILTERS.forEach(([k, , f]) => { counts[k] = R.filter(f).length; });
  root.innerHTML = '<div class="adm">' +
    '<div class="adm-top"><span class="logo">' + I.shield + '</span><div class="grow"><div class="brandname">Admin Pressing Pro</div><div class="brandsub">' + esc(S.user.email) + '</div></div>' +
      '<button class="btn sm" type="button" data-a="qr">' + I.qr + ' QR de l’app</button><button class="btn sm" type="button" data-a="reload">Actualiser</button><a class="btn sm" href="app.html">Ouvrir l’app</a><button class="btn sm ghost" type="button" data-a="logout">' + I.logout + ' Déconnexion</button></div>' +
    (S.offline ? '<div class="banner off" role="status">' + I.wifiOff + '<span style="flex:1"><b>Hors connexion.</b> Chiffres du ' + esc(dateTime(S.at)) + '. Les actions (prolonger, suspendre) reviennent avec le réseau.</span></div>' : '') +
    '<section class="card stack" id="qr-card" hidden style="margin-bottom:14px;align-items:center"><h2 style="font-size:17px">Fais scanner ce code aux gérants de pressing</h2>' + qrBlock(location.origin + '/', 'Ils arrivent sur la présentation de Pressing Pro et peuvent créer leur compte (30 jours gratuits). Fais une capture d’écran pour le partager.') + '</section>' +
    '<section class="hero" style="margin-bottom:14px"><div class="k">Revenu mensuel (abonnés payants)</div><div class="v">' + fmt(mrr) + ' <small>FCFA / mois</small></div>' +
      '<div class="tiles"><div class="tile"><div class="k">Pressings</div><div class="v">' + R.length + '</div></div><div class="tile"><div class="k">Payants</div><div class="v">' + n('active') + '</div></div><div class="tile"><div class="k">En essai</div><div class="v">' + n('trial') + '</div></div></div></section>' +
    '<div class="kpis" style="margin-bottom:14px"><div class="kpi"><div class="k">Expirés</div><div class="v" style="color:var(--bad)">' + n('expired') + '</div></div><div class="kpi"><div class="k">Suspendus</div><div class="v">' + n('suspended') + '</div></div>' +
      '<div class="kpi"><div class="k">Tickets créés (30 j)</div><div class="v">' + fmt(t30) + '</div></div><div class="kpi"><div class="k">Encaissé par les pressings (30 j)</div><div class="v">' + fmt(vol30) + '</div></div></div>' +
    '<div class="stack"><div><label class="sr" for="as">Rechercher</label><input class="inp" id="as" type="search" value="' + esc(S.search) + '" placeholder="Nom, email, téléphone, quartier"></div>' +
    '<div class="chips scroll" role="group" aria-label="Filtrer">' + FILTERS.map(([k, l]) => '<button type="button" class="chip" data-a="filter" data-f="' + k + '" aria-pressed="' + (S.filter === k) + '">' + l + ' <span class="n">' + counts[k] + '</span></button>').join('') + '</div>' +
    '<section class="card" style="padding:4px 16px" id="plist"></section></div></div>';
  $('#as').addEventListener('input', e => { S.search = e.target.value; renderList(); });
  renderList();
}

function renderList() {
  const f = FILTERS.find(x => x[0] === S.filter)[2];
  const t = S.search.trim().toLowerCase();
  const list = S.rows.filter(f).filter(r => !t || [r.name, r.owner_email, r.phone, r.address].some(v => String(v || '').toLowerCase().includes(t)));
  $('#plist').innerHTML = list.length ? list.map(r => {
    const ss = r.ss;
    const until = ss.days >= 0 ? 'jusqu’au ' + dateShort(r.paid_until) + ' (' + ss.days + ' j)' : 'depuis le ' + dateShort(r.paid_until);
    const msg = 'Bonjour, ici Pressing Pro. ' + (ss.k === 'trial' ? 'Votre essai gratuit pour « ' + r.name + ' » se termine le ' + dateShort(r.paid_until) + '. ' : ss.k === 'expired' ? 'L’abonnement de « ' + r.name + ' » a expiré. ' : '') +
      'Pour continuer : ' + fmt(PRICE_MONTH) + ' FCFA / mois par Wave ou Orange Money. Merci !';
    return '<div class="prow">' +
      '<div style="min-width:0"><div class="nm">' + esc(r.name) + '</div><div class="sub">' + esc([r.owner_email, fmtPhone(r.phone), r.address].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="sub">Inscrit le ' + esc(dateShort(r.created_at)) + (r.last_activity ? ' · dernier ticket ' + esc(dateTime(r.last_activity)) : ' · aucun ticket') + '</div></div>' +
      '<div><span class="badge ' + BADGE[ss.k] + '">' + ss.l + '</span><div class="sub" style="margin-top:4px">' + esc(until) + '</div></div>' +
      '<div class="stat"><b>' + r.orders_30d + '</b> tickets 30 j · <b>' + r.customers + '</b> clients<br><b>' + fmt(r.revenue_30d) + '</b> F encaissés 30 j · ' + r.members + ' compte' + (r.members > 1 ? 's' : '') + '</div>' +
      '<div class="acts">' +
        '<button class="btn sm primary" type="button" data-a="add" data-id="' + r.id + '" data-m="1">+1 mois</button>' +
        '<button class="btn sm" type="button" data-a="add" data-id="' + r.id + '" data-m="3">+3 mois</button>' +
        '<button class="btn sm" type="button" data-a="trial" data-id="' + r.id + '">Essai +7 j</button>' +
        (ss.k === 'suspended' ? '<button class="btn sm" type="button" data-a="unsuspend" data-id="' + r.id + '">Réactiver</button>' : '<button class="btn sm danger" type="button" data-a="suspend" data-id="' + r.id + '">Suspendre</button>') +
        (r.phone ? '<a class="btn sm wa" href="' + esc(waLink(r.phone, msg)) + '" target="_blank" rel="noopener">' + I.wa + ' Relancer</a>' : '') +
      '</div></div>';
  }).join('') : '<div class="empty"><b>Aucun pressing</b>' + (S.rows.length ? 'pour ce filtre.' : 'Partage le lien de l’app pour avoir tes premiers inscrits.') + '</div>';
}

async function setSub(id, status, until) {
  await q(sb.rpc('admin_set_subscription', { p_id: id, p_status: status, p_paid_until: until ? until.toISOString() : null }));
}
function base(r) { return new Date(Math.max(Date.now(), new Date(r.paid_until).getTime())); }

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, r = S.rows.find(x => x.id === b.dataset.id);
  try {
    if (a === 'reload') return load();
    if (a === 'qr') { const c = $('#qr-card'); c.hidden = !c.hidden; return; }
    if (a === 'logout') { await sb.auth.signOut(); return; }
    if (a === 'filter') { S.filter = b.dataset.f; document.querySelectorAll('[data-a="filter"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); return renderList(); }
    if (!r) return;
    if (S.offline || !navigator.onLine) { toast('Connexion nécessaire pour modifier un abonnement.', 'bad'); return; }
    b.disabled = true;
    if (a === 'add') {
      const m = parseInt(b.dataset.m, 10), d = base(r); d.setMonth(d.getMonth() + m);
      if (!confirm('Activer « ' + r.name + ' » jusqu’au ' + dateShort(d) + ' (' + fmt(m * PRICE_MONTH) + ' FCFA) ?')) { b.disabled = false; return; }
      await setSub(r.id, 'active', d); toast('Abonnement prolongé', 'ok');
    } else if (a === 'trial') {
      const d = base(r); d.setDate(d.getDate() + 7);
      await setSub(r.id, r.status === 'active' ? 'active' : 'trial', d); toast('7 jours ajoutés', 'ok');
    } else if (a === 'suspend') {
      if (!confirm('Suspendre « ' + r.name + ' » ? Le pressing passera en lecture seule.')) { b.disabled = false; return; }
      await setSub(r.id, 'suspended', null); toast('Pressing suspendu', 'ok');
    } else if (a === 'unsuspend') {
      await setSub(r.id, new Date(r.paid_until) > new Date() ? 'active' : 'trial', null); toast('Pressing réactivé', 'ok');
    }
    await load();
  } catch (err) { toast(errMsg(err), 'bad'); b.disabled = false; }
});
