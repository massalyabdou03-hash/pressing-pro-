import {
  sb, $, esc, fmt, money, digits, fmtPhone, waLink, todayIso, addDaysIso, dayLabel, dateTime, dateShort,
  ticketNo, startOfDay, STATUS, STEPS, METHODS, DEFECTS, CATEGORIES, subState, supportLink, PRICE_MONTH,
  q, errMsg, toast, I, qrBlock, TRACK_BASE
} from './core.js';

/* =========================================================
   État
   ========================================================= */
const S = {
  user: null, member: null, pressing: null, types: [],
  orders: null, filter: 'actifs', search: '',
  draft: null, newCat: 'Tous',
  cashPeriod: 'jour', clientSearch: '',
  recovery: false, authMode: location.hash === '#signup' ? 'signup' : 'login',
  seq: 0
};
const root = $('#root');
const H = {}, HI = {}, HC = {}, HF = {}, HK = {};

const pid = () => S.pressing.id;
const settings = () => Object.assign({ express_pct: 50, loyalty_every: 10, loyalty_pct: 20, hours: '', delivery_fee: 1000 }, S.pressing.settings || {});
const canWrite = () => { const k = subState(S.pressing).k; return k === 'trial' || k === 'active'; };
const isOwner = () => S.member && S.member.role === 'owner';
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
const parseAmt = v => parseInt(digits(v) || '0', 10);
const trackUrl = o => o.track_code
  ? (TRACK_BASE || location.origin) + '/t/' + o.track_code
  : new URL('suivi.html', location.href.split('#')[0]).href + '?t=' + o.track_token;
const uid = () => Math.random().toString(36).slice(2, 9);

/* =========================================================
   Événements délégués
   ========================================================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && H[t.dataset.act]) H[t.dataset.act](t, e);
});
document.addEventListener('input', e => {
  const t = e.target.closest('[data-in]');
  if (t && HI[t.dataset.in]) HI[t.dataset.in](t, e);
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-ch]');
  if (t && HC[t.dataset.ch]) HC[t.dataset.ch](t, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (f && HF[f.dataset.form]) { e.preventDefault(); HF[f.dataset.form](f, e); }
});
document.addEventListener('keydown', e => {
  const t = e.target.closest('[data-key]');
  if (t && HK[t.dataset.key]) HK[t.dataset.key](t, e);
  if (e.key === 'Escape') closeModal();
});

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); }
  catch (e) { console.error(e); toast(errMsg(e), 'bad'); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

/* =========================================================
   Modal
   ========================================================= */
function openModal(title, body) {
  closeModal();
  const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.id = 'scrim';
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'modal-t');
  m.innerHTML = '<div class="modal-h"><h2 id="modal-t">' + esc(title) + '</h2><button type="button" class="iconbtn" data-act="modal-close" aria-label="Fermer">' + I.x + '</button></div>' + body;
  scrim.addEventListener('click', closeModal);
  document.body.append(scrim, m);
  const f = m.querySelector('input,select,textarea'); if (f) f.focus();
  return m;
}
function closeModal() { const a = $('#modal'), b = $('#scrim'); if (a) a.remove(); if (b) b.remove(); }
H['modal-close'] = closeModal;

/* =========================================================
   Démarrage et authentification
   ========================================================= */
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; setTimeout(renderRecovery, 0); return; }
  setTimeout(() => start(session), 0);
});

async function start(session) {
  if (S.recovery) return;
  if (!session) { S.user = null; S.pressing = null; renderAuth(); return; }
  if (S.user && S.user.id === session.user.id) return;
  S.user = session.user;
  try { await loadContext(); }
  catch (e) { console.error(e); root.innerHTML = '<div class="auth"><div class="card stack"><p class="err">' + esc(errMsg(e)) + '</p><button class="btn" data-act="reload" type="button">Réessayer</button></div></div>'; }
}
H.reload = () => location.reload();

async function loadContext() {
  const rows = await q(sb.from('members').select('role,display_name,pressing_id,pressings(*)').eq('user_id', S.user.id));
  if (!rows.length) { renderOnboard(); return; }
  S.member = rows[0];
  S.pressing = rows[0].pressings;
  await loadTypes();
  if (!location.hash || location.hash === '#signup') location.hash = '#/';
  route();
}
async function loadTypes() {
  S.types = await q(sb.from('garment_types').select('*').eq('pressing_id', pid()).order('category').order('name'));
}

function authShell(inner) {
  return '<div class="auth"><div class="card stack">' +
    '<div class="hstack"><span class="logo">' + I.logo + '</span><div><div class="brandname">Pressing Pro</div><div class="brandsub">Le logiciel des pressings au Sénégal</div></div></div>' +
    inner + '</div></div>';
}
function renderAuth() {
  const m = S.authMode;
  let form;
  if (m === 'forgot') {
    form = '<form class="stack" data-form="forgot" novalidate>' +
      '<p class="hint">Saisis ton email : tu recevras un lien pour choisir un nouveau mot de passe.</p>' +
      '<div class="field"><label for="a-email">Email</label><input class="inp" id="a-email" name="email" type="email" autocomplete="email" required></div>' +
      '<p class="err" id="a-err" hidden></p><p class="hint" id="a-ok" hidden></p>' +
      '<button class="btn primary block" type="submit">Envoyer le lien</button>' +
      '<button class="btn ghost block" type="button" data-act="auth-mode" data-m="login">Retour à la connexion</button></form>';
  } else {
    const su = m === 'signup';
    form = '<div class="seg" role="group" aria-label="Connexion ou inscription">' +
      '<button type="button" data-act="auth-mode" data-m="login" aria-pressed="' + !su + '">Connexion</button>' +
      '<button type="button" data-act="auth-mode" data-m="signup" aria-pressed="' + su + '">Créer un compte</button></div>' +
      '<form class="stack" data-form="' + (su ? 'signup' : 'login') + '" novalidate>' +
      (su ? '<div class="field"><label for="a-name">Ton prénom et nom</label><input class="inp" id="a-name" name="name" autocomplete="name" required></div>' : '') +
      '<div class="field"><label for="a-email">Email</label><input class="inp" id="a-email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="a-pass">Mot de passe' + (su ? ' (6 caractères minimum)' : '') + '</label><input class="inp" id="a-pass" name="password" type="password" autocomplete="' + (su ? 'new-password' : 'current-password') + '" required minlength="6"></div>' +
      '<p class="err" id="a-err" hidden></p><p class="hint" id="a-ok" hidden></p>' +
      '<button class="btn primary block" type="submit">' + (su ? 'Créer mon compte' : 'Se connecter') + '</button>' +
      (su ? '<p class="hint">30 jours d’essai gratuit, sans engagement. Ensuite ' + fmt(PRICE_MONTH) + ' FCFA par mois.</p>'
          : '<button class="btn ghost block" type="button" data-act="auth-mode" data-m="forgot">Mot de passe oublié ?</button>') +
      '</form>';
  }
  root.innerHTML = authShell(form);
}
H['auth-mode'] = t => { S.authMode = t.dataset.m; renderAuth(); };
function authMsg(err, ok) {
  const e = $('#a-err'), o = $('#a-ok');
  if (e) { e.hidden = !err; e.textContent = err || ''; }
  if (o) { o.hidden = !ok; o.textContent = ok || ''; }
}
HF.login = (f) => busy(f.querySelector('[type=submit]'), async () => {
  authMsg();
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) authMsg(errMsg(error));
});
HF.signup = (f) => busy(f.querySelector('[type=submit]'), async () => {
  authMsg();
  const name = f.name.value.trim(), email = f.email.value.trim(), password = f.password.value;
  if (!name) return authMsg('Indique ton nom.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Email invalide.');
  if (password.length < 6) return authMsg('Le mot de passe doit faire au moins 6 caractères.');
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.href.split('#')[0] } });
  if (error) return authMsg(errMsg(error));
  if (!data.session) authMsg('', 'Compte créé ! Ouvre l’email de confirmation envoyé à ' + email + ', puis reviens te connecter ici.');
});
HF.forgot = (f) => busy(f.querySelector('[type=submit]'), async () => {
  authMsg();
  const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.href.split('#')[0] });
  if (error) return authMsg(errMsg(error));
  authMsg('', 'Si un compte existe pour cet email, le lien vient d’être envoyé.');
});
function renderRecovery() {
  root.innerHTML = authShell('<form class="stack" data-form="newpass" novalidate><h2>Nouveau mot de passe</h2>' +
    '<div class="field"><label for="a-pass">Nouveau mot de passe</label><input class="inp" id="a-pass" name="password" type="password" autocomplete="new-password" minlength="6" required></div>' +
    '<p class="err" id="a-err" hidden></p><button class="btn primary block" type="submit">Enregistrer</button></form>');
}
HF.newpass = (f) => busy(f.querySelector('[type=submit]'), async () => {
  if (f.password.value.length < 6) return authMsg('6 caractères minimum.');
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  if (error) return authMsg(errMsg(error));
  S.recovery = false; toast('Mot de passe modifié', 'ok');
  const { data } = await sb.auth.getSession(); start(data.session);
});
H.logout = async () => { await sb.auth.signOut(); S.user = null; S.pressing = null; S.orders = null; S.draft = null; location.hash = ''; renderAuth(); };

/* ---------- premier lancement ---------- */
function renderOnboard() {
  const name = (S.user.user_metadata && S.user.user_metadata.name) || '';
  root.innerHTML = '<div class="auth"><div class="stack" style="width:min(520px,100%)">' +
    '<div class="hstack"><span class="logo">' + I.logo + '</span><div><div class="brandname">Bienvenue' + (name ? ' ' + esc(firstName(name)) : '') + ' !</div><div class="brandsub">Dernière étape avant ton premier ticket</div></div></div>' +
    '<form class="card stack" data-form="create-pressing" novalidate><h2>Je crée mon pressing</h2>' +
    '<div class="field"><label for="o-name">Nom du pressing</label><input class="inp" id="o-name" name="pname" required placeholder="Ex. Pressing de la Médina"></div>' +
    '<div class="row2"><div class="field"><label for="o-phone">Téléphone</label><input class="inp" id="o-phone" name="phone" type="tel" placeholder="77 000 00 00"></div>' +
    '<div class="field"><label for="o-addr">Quartier / adresse</label><input class="inp" id="o-addr" name="address" placeholder="Ex. Sacré-Cœur 3"></div></div>' +
    '<p class="err" id="o-err" hidden></p><button class="btn primary block" type="submit">Créer mon pressing (30 jours gratuits)</button>' +
    '<p class="hint">Un catalogue d’habits avec des prix de départ est créé pour toi. Tu pourras tout modifier.</p></form>' +
    '<form class="card stack" data-form="join-pressing" novalidate><h2>Je rejoins l’équipe d’un pressing</h2>' +
    '<p class="hint">Demande le code à 6 caractères au gérant (Réglages › Équipe).</p>' +
    '<div class="row2"><div class="field"><label for="j-code">Code</label><input class="inp" id="j-code" name="code" autocomplete="off" style="text-transform:uppercase;letter-spacing:.15em" maxlength="6"></div>' +
    '<div class="field"><label for="j-name">Ton prénom</label><input class="inp" id="j-name" name="dname" value="' + esc(name) + '"></div></div>' +
    '<p class="err" id="j-err" hidden></p><button class="btn block" type="submit">Rejoindre</button></form>' +
    '<button class="btn ghost" type="button" data-act="logout">' + I.logout + ' Se déconnecter</button></div></div>';
}
HF['create-pressing'] = (f) => busy(f.querySelector('[type=submit]'), async () => {
  const err = $('#o-err'); err.hidden = true;
  if (f.pname.value.trim().length < 2) { err.textContent = 'Indique le nom du pressing.'; err.hidden = false; return; }
  try { await q(sb.rpc('create_pressing', { p_name: f.pname.value.trim(), p_phone: f.phone.value.trim(), p_address: f.address.value.trim() })); }
  catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
  toast('Pressing créé. Bienvenue !', 'ok'); location.hash = '#/'; await loadContext();
});
HF['join-pressing'] = (f) => busy(f.querySelector('[type=submit]'), async () => {
  const err = $('#j-err'); err.hidden = true;
  try { await q(sb.rpc('join_pressing', { p_code: f.code.value.trim(), p_name: f.dname.value.trim() })); }
  catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
  toast('Tu as rejoint l’équipe', 'ok'); location.hash = '#/'; await loadContext();
});

/* =========================================================
   Routeur et coque
   ========================================================= */
window.addEventListener('hashchange', () => { if (S.pressing) route(); });

function parseRoute() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(qs || '') };
}
function route() {
  closeModal();
  const { parts, params } = parseRoute();
  const seq = ++S.seq;
  const v = parts[0] || '';
  const nav = v === 't' ? '' : (v === 'c' ? 'clients' : v);
  shell(nav === '' && v !== 't' ? 'tickets' : nav);
  const views = {
    '': () => viewTickets(seq), 'new': () => viewNew(seq, params), 't': () => viewTicket(seq, parts[1], params),
    'clients': () => viewClients(seq), 'c': () => viewClient(seq, parts[1]), 'caisse': () => viewCaisse(seq), 'reglages': () => viewSettings(seq)
  };
  (views[v] || views[''])().catch(e => { console.error(e); if (seq === S.seq) main().innerHTML = '<div class="card"><p class="err">' + esc(errMsg(e)) + '</p></div>'; });
  window.scrollTo(0, 0);
}
const main = () => $('#main');
const alive = seq => seq === S.seq;

function shell(active) {
  const p = S.pressing, ss = subState(p);
  let banner = '';
  const pay = supportLink('Bonjour, je veux (ré)activer l’abonnement Pressing Pro pour « ' + p.name + ' ».');
  if (ss.k === 'expired' || ss.k === 'suspended') {
    banner = '<div class="banner bad">' + I.clock + '<span style="flex:1">' + (ss.k === 'suspended' ? 'Compte suspendu.' : 'Abonnement expiré.') +
      ' L’app est en lecture seule. Réactivation : ' + fmt(PRICE_MONTH) + ' FCFA / mois.</span>' +
      (pay ? '<a class="btn sm" href="' + esc(pay) + '" target="_blank" rel="noopener">Réactiver</a>' : '') + '</div>';
  } else if (ss.k === 'trial' && ss.days <= 7) {
    banner = '<div class="banner warn">' + I.clock + '<span style="flex:1">Essai gratuit : ' + Math.max(0, ss.days) + ' jour' + (ss.days > 1 ? 's' : '') + ' restant' + (ss.days > 1 ? 's' : '') + '.</span>' +
      (pay ? '<a class="btn sm" href="' + esc(pay) + '" target="_blank" rel="noopener">S’abonner</a>' : '') + '</div>';
  }
  const link = (id, href, icon, label, cls) => '<a href="' + href + '"' + (cls ? ' class="' + cls + '"' : '') + (active === id ? ' aria-current="page"' : '') + '>' + (cls === 'new' ? '<span>' + icon + '</span>' : icon) + label + '</a>';
  root.innerHTML =
    '<div class="shell">' +
    '<nav class="nav" aria-label="Sections">' +
      '<div class="nav-brand"><span class="logo">' + I.logo + '</span><div style="min-width:0"><div class="brandname">Pressing Pro</div><div class="brandsub">' + esc(p.name) + '</div></div></div>' +
      link('new', '#/new', I.plus, 'Nouveau', 'new') +
      link('tickets', '#/', I.ticket, 'Tickets') +
      link('clients', '#/clients', I.users, 'Clients') +
      link('caisse', '#/caisse', I.cash, 'Caisse') +
      link('reglages', '#/reglages', I.gear, 'Réglages') +
      '<div class="nav-foot">' + esc(S.user.email || '') + '</div>' +
    '</nav>' +
    '<header class="topbar"><span class="logo">' + I.logo + '</span><div style="flex:1;min-width:0"><div class="brandname">' + esc(p.name) + '</div><div class="brandsub">' + esc(cap(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))) + '</div></div></header>' +
    '<main class="main" id="main-wrap">' + banner + '<div id="main"><p class="muted">Chargement…</p></div></main>' +
    '</div>';
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function needWrite() {
  if (canWrite()) return true;
  toast('Abonnement expiré : réactive-le pour continuer.', 'bad');
  return false;
}

/* =========================================================
   Tickets
   ========================================================= */
const FILTERS = [
  ['actifs', 'En cours', o => ['recu', 'lavage', 'pret'].includes(o.status)],
  ['recu', 'Reçus', o => o.status === 'recu'],
  ['lavage', 'En lavage', o => o.status === 'lavage'],
  ['pret', 'Prêts', o => o.status === 'pret'],
  ['oublies', 'Oubliés', o => o.status === 'pret' && o.ready_at && (Date.now() - new Date(o.ready_at)) > 7 * 864e5],
  ['impayes', 'Impayés', o => o.status !== 'annule' && o.paid < o.total],
  ['retire', 'Retirés', o => o.status === 'retire'],
  ['tous', 'Tous', () => true]
];
async function loadOrders(force) {
  if (S.orders && !force) return S.orders;
  S.orders = await q(sb.from('orders')
    .select('id,number,status,total,paid,due_at,express,delivery,created_at,ready_at,picked_at,customers(id,name,phone),order_items(name,qty)')
    .eq('pressing_id', pid()).order('created_at', { ascending: false }).limit(500));
  return S.orders;
}
const itemsSummary = items => (items || []).map(i => i.qty + ' ' + i.name.toLowerCase()).join(' · ');
const isLate = o => (o.status === 'recu' || o.status === 'lavage') && o.due_at && o.due_at < todayIso();

async function viewTickets(seq) {
  const [orders, pays] = await Promise.all([
    loadOrders(true),
    q(sb.from('payments').select('amount').eq('pressing_id', pid()).gte('created_at', startOfDay().toISOString()))
  ]);
  if (!alive(seq)) return;
  const t0 = startOfDay().getTime();
  const cashToday = pays.reduce((s, p) => s + p.amount, 0);
  const depToday = orders.filter(o => new Date(o.created_at).getTime() >= t0 && o.status !== 'annule').length;
  const ready = orders.filter(o => o.status === 'pret').length;
  const dueAll = orders.filter(o => o.status !== 'annule').reduce((s, o) => s + Math.max(0, o.total - o.paid), 0);
  const counts = {}; FILTERS.forEach(([k, , f]) => { counts[k] = orders.filter(f).length; });
  main().innerHTML =
    '<div class="stack">' +
    '<section class="hero" aria-label="Résumé du jour"><div class="k">Encaissé aujourd’hui</div><div class="v">' + fmt(cashToday) + ' <small>FCFA</small></div>' +
      '<div class="tiles"><div class="tile"><div class="k">Dépôts du jour</div><div class="v">' + depToday + '</div></div>' +
      '<div class="tile"><div class="k">Prêts à retirer</div><div class="v">' + ready + '</div></div>' +
      '<div class="tile"><div class="k">À encaisser</div><div class="v">' + fmt(dueAll) + '</div></div></div></section>' +
    '<div style="position:relative"><label for="tk-q" class="sr">Rechercher un ticket</label>' +
      '<span style="position:absolute;left:13px;top:13px;width:20px;height:20px;color:var(--muted)">' + I.search + '</span>' +
      '<input class="inp" id="tk-q" type="search" data-in="tk-q" value="' + esc(S.search) + '" placeholder="N° de ticket, nom ou téléphone" style="padding-left:42px"></div>' +
    '<div class="chips scroll" role="group" aria-label="Filtrer">' +
      FILTERS.map(([k, l]) => '<button type="button" class="chip" data-act="tk-filter" data-f="' + k + '" aria-pressed="' + (S.filter === k) + '">' + l + ' <span class="n">' + counts[k] + '</span></button>').join('') +
    '</div>' +
    '<section class="card" style="padding:4px 14px"><div class="list" id="tk-list"></div></section>' +
    '</div>';
  renderTicketList();
}
function renderTicketList() {
  const box = $('#tk-list'); if (!box) return;
  const f = (FILTERS.find(x => x[0] === S.filter) || FILTERS[0])[2];
  const term = S.search.trim().toLowerCase(), dterm = digits(term);
  let list = S.orders.filter(f);
  if (term) {
    list = S.orders.filter(o =>
      (dterm && (String(o.number) === dterm.replace(/^0+/, '') || digits(o.customers && o.customers.phone).includes(dterm))) ||
      (o.customers && o.customers.name.toLowerCase().includes(term)));
  }
  if (!list.length) {
    box.innerHTML = S.orders.length
      ? '<div class="empty"><b>Aucun ticket ici</b>Change de filtre ou de recherche.</div>'
      : '<div class="empty"><b>Pas encore de ticket</b>Crée ton premier dépôt : ça prend moins d’une minute.<div style="margin-top:12px"><a class="btn primary" href="#/new">' + I.plus + ' Nouveau dépôt</a></div></div>';
    return;
  }
  box.innerHTML = list.slice(0, 200).map(o => {
    const st = STATUS[o.status], rest = o.total - o.paid;
    return '<a class="li" href="#/t/' + o.id + '"><span class="tno">' + ticketNo(o.number) + '</span>' +
      '<span class="mid"><span class="t">' + esc(o.customers ? o.customers.name : 'Client supprimé') + (o.express ? ' <span class="badge b-warn">Express</span>' : '') + '</span>' +
      '<span class="s" style="display:block">' + esc(itemsSummary(o.order_items)) + '</span></span>' +
      '<span class="r"><span class="badge ' + (isLate(o) ? 'b-bad' : st.c) + '">' + (isLate(o) ? 'En retard' : st.l) + '</span>' +
      '<span style="font-size:12px" class="' + (o.status === 'annule' ? 'muted' : (rest > 0 ? 'due' : 'paid')) + '">' + (o.status === 'annule' ? '—' : (rest > 0 ? 'Reste ' + fmt(rest) : 'Payé')) + '</span></span></a>';
  }).join('');
}
H['tk-filter'] = t => { S.filter = t.dataset.f; S.search = ''; const i = $('#tk-q'); if (i) i.value = ''; document.querySelectorAll('[data-act="tk-filter"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); renderTicketList(); };
HI['tk-q'] = t => { S.search = t.value; renderTicketList(); };

/* =========================================================
   Nouveau dépôt
   ========================================================= */
const newDraft = () => ({ customer: { id: null, name: '', phone: '' }, custCount: 0, lines: [], express: false, delivery: false, due: addDaysIso(2), notes: '', advance: '', method: 'especes', saveNew: true });

async function viewNew(seq, params) {
  if (!S.draft) S.draft = newDraft();
  const d = S.draft;
  const cid = params.get('c');
  if (cid && d.customer.id !== cid) {
    const c = await q(sb.from('customers').select('id,name,phone').eq('id', cid).maybeSingle());
    if (c) await pickCustomer(c, false);
  }
  if (!alive(seq)) return;
  renderNew();
}
function renderNew() {
  const d = S.draft, st = settings();
  const cats = ['Tous'].concat(CATEGORIES.filter(c => S.types.some(t => t.active && t.category === c)));
  if (!cats.includes(S.newCat)) S.newCat = 'Tous';
  const types = S.types.filter(t => t.active && (S.newCat === 'Tous' || t.category === S.newCat));
  main().innerHTML =
    '<div class="page-h"><a class="iconbtn" href="#/" aria-label="Retour aux tickets">' + I.back + '</a><div class="grow"><h1>Nouveau dépôt</h1></div>' +
      ((d.lines.length || d.customer.name) ? '<button class="btn sm ghost" type="button" data-act="nw-reset">Tout effacer</button>' : '') + '</div>' +
    '<div class="two-col"><div class="stack">' +
    '<section class="card stack" aria-labelledby="nw-c-t"><div class="sec-t" id="nw-c-t">Client</div>' +
      '<div class="row2">' +
        '<div class="field" style="position:relative"><label for="nw-phone">Téléphone (WhatsApp)</label><input class="inp" id="nw-phone" type="tel" autocomplete="off" data-in="nw-phone" value="' + esc(fmtPhone(d.customer.phone)) + '" placeholder="77 123 45 67"><div id="nw-sugg-phone"></div></div>' +
        '<div class="field" style="position:relative"><label for="nw-name">Nom</label><input class="inp" id="nw-name" autocomplete="off" data-in="nw-name" value="' + esc(d.customer.name) + '" placeholder="Nom du client"><div id="nw-sugg-name"></div></div>' +
      '</div><div id="nw-cinfo">' + custInfo() + '</div></section>' +
    '<section class="card stack" aria-labelledby="nw-a-t"><div class="card-h" style="margin:0"><h2 id="nw-a-t">Habits</h2><span class="muted" id="nw-count"></span></div>' +
      '<div style="position:relative"><label for="nw-item" class="sr">Nom de l’habit</label>' +
        '<div style="display:flex;gap:8px"><input class="inp" id="nw-item" data-in="nw-item" data-key="nw-item" autocomplete="off" placeholder="Tape un habit : bazin, chemise, rideau…">' +
        '<button class="btn primary" type="button" data-act="nw-additem">Ajouter</button></div><div id="nw-sugg-item"></div></div>' +
      '<p class="hint">Un habit qui n’est pas dans la liste ? Tape son nom, ajoute-le, puis indique le prix.</p>' +
      '<div class="chips scroll" role="group" aria-label="Catégories">' + cats.map(c => '<button type="button" class="chip sm" data-act="nw-cat" data-c="' + esc(c) + '" aria-pressed="' + (S.newCat === c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<div class="catgrid">' + (types.length ? types.map(catBtn).join('') : '<p class="hint">Catalogue vide : ajoute tes habits dans Réglages.</p>') + '</div>' +
      '<div id="nw-lines"></div></section>' +
    '<section class="card stack" aria-labelledby="nw-o-t"><div class="sec-t" id="nw-o-t">Options et paiement</div>' +
      '<div class="chips">' +
        '<button type="button" class="chip" data-act="nw-express" aria-pressed="' + d.express + '">' + I.bolt + ' Express +' + st.express_pct + ' %</button>' +
        '<button type="button" class="chip" data-act="nw-delivery" aria-pressed="' + d.delivery + '">' + I.truck + ' Livraison +' + fmt(st.delivery_fee) + ' F</button></div>' +
      '<div class="row2"><div class="field"><label for="nw-due">Prêt le</label><input class="inp" id="nw-due" type="date" data-ch="nw-due" min="' + todayIso() + '" value="' + esc(d.due) + '"></div>' +
        '<div class="field"><label for="nw-adv">Avance payée (FCFA)</label><input class="inp" id="nw-adv" inputmode="numeric" data-in="nw-adv" value="' + (d.advance ? fmt(d.advance) : '') + '" placeholder="0"></div></div>' +
      '<div class="chips" role="group" aria-label="Mode de paiement">' + Object.keys(METHODS).filter(k => k !== 'autre').map(k => '<button type="button" class="chip sm" data-act="nw-method" data-m="' + k + '" aria-pressed="' + (d.method === k) + '">' + METHODS[k] + '</button>').join('') + '</div>' +
      '<div class="field"><label for="nw-notes">Note (facultatif)</label><textarea class="inp" id="nw-notes" data-in="nw-notes" maxlength="500" placeholder="Ex. sans amidon, livrer à Ouakam…">' + esc(d.notes) + '</textarea></div>' +
      '<label class="hstack" style="font-size:14px;font-weight:600"><input type="checkbox" data-ch="nw-savenew"' + (d.saveNew ? ' checked' : '') + ' style="width:20px;height:20px"> Ajouter les nouveaux habits au catalogue</label>' +
    '</section></div>' +
    '<div><section class="card stack sumbar" id="nw-sum" aria-label="Total"></section></div></div>' +
    '<div class="nw-spacer"></div><div class="nw-bar" id="nw-bar" hidden></div>';
  renderLines(); renderSum();
}
const qtyOf = name => S.draft.lines.filter(l => l.name.toLowerCase() === name.toLowerCase()).reduce((s, l) => s + l.qty, 0);
function catBtn(t) {
  const n = qtyOf(t.name);
  return '<button type="button" class="catbtn' + (n ? ' on' : '') + '" data-act="nw-addtype" data-id="' + t.id + '" aria-label="' + esc(t.name) + ', ' + fmt(t.price) + ' francs' + (n ? ', ' + n + ' dans ce dépôt' : '') + '">' +
    '<b>' + esc(t.name) + '</b><span>' + fmt(t.price) + ' F</span>' + (n ? '<i class="cnt" aria-hidden="true">' + n + '</i>' : '') + '</button>';
}
function syncCatBtns() {
  document.querySelectorAll('.catbtn[data-id]').forEach(b => {
    const t = S.types.find(x => x.id === b.dataset.id); if (!t) return;
    const n = qtyOf(t.name);
    b.classList.toggle('on', n > 0);
    let c = b.querySelector('.cnt');
    if (n && !c) { c = document.createElement('i'); c.className = 'cnt'; c.setAttribute('aria-hidden', 'true'); b.appendChild(c); }
    if (c) { if (n) c.textContent = n; else c.remove(); }
    b.setAttribute('aria-label', t.name + ', ' + fmt(t.price) + ' francs' + (n ? ', ' + n + ' dans ce dépôt' : ''));
  });
}
function custInfo() {
  const d = S.draft, st = settings();
  if (d.customer.id) {
    let loy = '';
    if (st.loyalty_every > 0) {
      const n = d.custCount + 1;
      loy = n % st.loyalty_every === 0
        ? '<span class="badge b-warn">' + I.star + ' ' + n + 'e dépôt : −' + st.loyalty_pct + ' % fidélité</span>'
        : '<span class="muted" style="font-size:13px">Fidélité : ' + (d.custCount % st.loyalty_every) + ' / ' + st.loyalty_every + '</span>';
    }
    return '<div class="hstack"><span class="badge b-ok">' + I.check + ' Client connu · ' + d.custCount + ' dépôt' + (d.custCount > 1 ? 's' : '') + '</span>' + loy +
      '<button type="button" class="btn sm ghost" data-act="nw-unlink">Changer de client</button></div>';
  }
  if (d.customer.name || d.customer.phone) return '<span class="badge b-info">Nouveau client</span>';
  return '<p class="hint">Tape le numéro : si le client est déjà venu, il s’affiche.</p>';
}
function lineCustom(name) { return !S.types.some(t => t.name.toLowerCase() === name.toLowerCase()); }
function renderLines() {
  const box = $('#nw-lines'); if (!box) return;
  const d = S.draft;
  const n = d.lines.reduce((s, l) => s + l.qty, 0);
  const c = $('#nw-count'); if (c) c.textContent = n ? n + ' pièce' + (n > 1 ? 's' : '') : '';
  syncCatBtns();
  if (!d.lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="sec-t" style="margin:6px 0 2px">Dans ce dépôt</div>' + d.lines.map(l =>
    '<div class="cart-line">' +
      '<div style="min-width:0"><div style="font-weight:800">' + esc(l.name) + (lineCustom(l.name) ? ' <span class="badge b-info">nouveau</span>' : '') + '</div>' +
        '<div class="hstack" style="margin-top:6px;gap:6px"><label class="sr" for="pr-' + l.k + '">Prix par pièce de ' + esc(l.name) + '</label>' +
        '<input class="price-inp" id="pr-' + l.k + '" inputmode="numeric" data-in="nw-price" data-k="' + l.k + '" value="' + (l.price ? fmt(l.price) : '') + '" placeholder="Prix"><span class="muted" style="font-size:13px">F / pièce</span></div></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><div class="qty">' +
        '<button type="button" data-act="nw-qty" data-k="' + l.k + '" data-d="-1" aria-label="Une pièce de moins">−</button><b>' + l.qty + '</b>' +
        '<button type="button" data-act="nw-qty" data-k="' + l.k + '" data-d="1" aria-label="Une pièce de plus">+</button></div>' +
        '<b class="num" id="lt-' + l.k + '">' + fmt(l.qty * l.price) + ' F</b></div>' +
      '<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px">' +
        '<div style="display:flex;gap:8px"><label class="sr" for="co-' + l.k + '">Couleur ou détail</label><input class="mini-inp" id="co-' + l.k + '" data-in="nw-color" data-k="' + l.k + '" value="' + esc(l.color) + '" placeholder="Couleur, marque, détail…">' +
        '<button type="button" class="btn sm ghost danger" data-act="nw-del" data-k="' + l.k + '" aria-label="Retirer ' + esc(l.name) + '">' + I.trash + '</button></div>' +
        '<div class="chips" role="group" aria-label="Défauts constatés">' + DEFECTS.map(df => '<button type="button" class="chip sm def" data-act="nw-def" data-k="' + l.k + '" data-v="' + df + '" aria-pressed="' + l.defects.includes(df) + '">' + df + '</button>').join('') + '</div>' +
      '</div></div>').join('');
}
function draftTotals() {
  const d = S.draft, st = settings();
  const sub = d.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const extra = d.express ? Math.round(sub * st.express_pct / 100) : 0;
  const dfee = d.delivery ? st.delivery_fee : 0;
  const disc = (d.customer.id && st.loyalty_every > 0 && st.loyalty_pct > 0 && (d.custCount + 1) % st.loyalty_every === 0) ? Math.round(sub * st.loyalty_pct / 100) : 0;
  const total = sub + extra + dfee - disc;
  const adv = Math.min(parseAmt(d.advance), total);
  return { sub, extra, dfee, disc, total, adv, rest: total - adv };
}
function renderSum() {
  const box = $('#nw-sum'); if (!box) return;
  const t = draftTotals(), d = S.draft;
  const row = (l, v, cls) => '<div><span class="muted">' + l + '</span><b class="num ' + (cls || '') + '">' + v + '</b></div>';
  box.innerHTML = '<div class="sec-t">Récapitulatif</div><div class="totals">' +
    row('Sous-total', fmt(t.sub) + ' F') +
    (t.extra ? row('Express', '+ ' + fmt(t.extra) + ' F') : '') +
    (t.dfee ? row('Livraison', '+ ' + fmt(t.dfee) + ' F') : '') +
    (t.disc ? row('Remise fidélité', '− ' + fmt(t.disc) + ' F', 'paid') : '') +
    '<div class="big"><span>Total</span><span class="num">' + money(t.total) + '</span></div>' +
    row('Avance', fmt(t.adv) + ' F', 'paid') + row('Reste à payer', fmt(t.rest) + ' F', t.rest > 0 ? 'due' : 'paid') +
    '</div>' +
    '<button class="btn primary block" type="button" data-act="nw-submit"' + (d.lines.length ? '' : ' disabled') + '>' + I.ticket + ' Créer le ticket</button>' +
    (t.total > 0 && t.rest > 0 ? '<button class="btn sm ghost" type="button" data-act="nw-fullpay">Le client paie tout maintenant</button>' : '') +
    '<p class="hint">Prêt le ' + esc(dayLabel(d.due)) + '.</p>';
  const bar = $('#nw-bar');
  if (bar) {
    const n = d.lines.reduce((s, l) => s + l.qty, 0);
    bar.hidden = !n;
    bar.innerHTML = n ? '<div style="flex:1;min-width:0"><b>' + n + ' pièce' + (n > 1 ? 's' : '') + '</b> · ' + fmt(t.total) + ' FCFA<div style="font-size:12px;opacity:.8">' + esc(d.lines.map(l => l.qty + ' ' + l.name.toLowerCase()).join(', ')) + '</div></div>' +
      '<button type="button" class="btn sm" data-act="nw-submit" style="flex:none">' + I.check + ' Créer le ticket</button>' : '';
  }
}
function addLine(name, price) {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return;
  const d = S.draft;
  const same = d.lines.find(l => l.name.toLowerCase() === name.toLowerCase() && !l.color && !l.defects.length);
  if (same) same.qty++;
  else d.lines.push({ k: uid(), name: name.charAt(0).toUpperCase() + name.slice(1), qty: 1, price: price || 0, color: '', defects: [] });
  renderLines(); renderSum();
  const last = d.lines[d.lines.length - 1];
  if (!price && !same && last) { const p = $('#pr-' + last.k); if (p) p.focus(); }
}
const findLine = k => S.draft.lines.find(l => l.k === k);
H['nw-cat'] = t => { S.newCat = t.dataset.c; renderNew(); };
H['nw-addtype'] = t => {
  const ty = S.types.find(x => x.id === t.dataset.id); if (!ty) return;
  addLine(ty.name, ty.price);
  t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
};
function addFromInput() {
  const inp = $('#nw-item'); if (!inp) return;
  const v = inp.value.trim(); if (!v) { inp.focus(); return; }
  const ty = S.types.find(x => x.name.toLowerCase() === v.toLowerCase());
  addLine(ty ? ty.name : v, ty ? ty.price : 0);
  inp.value = ''; $('#nw-sugg-item').innerHTML = '';
}
H['nw-additem'] = addFromInput;
HK['nw-item'] = (t, e) => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } };
HI['nw-item'] = t => {
  const v = t.value.trim().toLowerCase(), box = $('#nw-sugg-item');
  if (!v) { box.innerHTML = ''; return; }
  const m = S.types.filter(x => x.active && x.name.toLowerCase().includes(v)).slice(0, 6);
  const exact = m.some(x => x.name.toLowerCase() === v);
  box.innerHTML = '<div class="sugg">' + m.map(x => '<button type="button" data-act="nw-sugg-type" data-id="' + x.id + '"><span>' + esc(x.name) + '</span><span class="muted">' + fmt(x.price) + ' F</span></button>').join('') +
    (exact ? '' : '<button type="button" data-act="nw-additem"><span>Ajouter « ' + esc(t.value.trim()) + ' »</span><span class="muted">nouvel habit</span></button>') + '</div>';
};
H['nw-sugg-type'] = t => { const ty = S.types.find(x => x.id === t.dataset.id); if (ty) addLine(ty.name, ty.price); const i = $('#nw-item'); i.value = ''; $('#nw-sugg-item').innerHTML = ''; i.focus(); };
H['nw-qty'] = t => {
  const l = findLine(t.dataset.k); if (!l) return;
  l.qty += parseInt(t.dataset.d, 10);
  if (l.qty <= 0) S.draft.lines = S.draft.lines.filter(x => x !== l);
  renderLines(); renderSum();
};
H['nw-del'] = t => { S.draft.lines = S.draft.lines.filter(x => x.k !== t.dataset.k); renderLines(); renderSum(); };
H['nw-def'] = t => {
  const l = findLine(t.dataset.k); if (!l) return;
  const v = t.dataset.v;
  l.defects = l.defects.includes(v) ? l.defects.filter(x => x !== v) : l.defects.concat(v);
  t.setAttribute('aria-pressed', String(l.defects.includes(v)));
};
HI['nw-price'] = t => {
  const l = findLine(t.dataset.k); if (!l) return;
  const n = parseAmt(t.value); l.price = Math.min(n, 10000000);
  t.value = n ? fmt(n) : '';
  const lt = $('#lt-' + l.k); if (lt) lt.textContent = fmt(l.qty * l.price) + ' F';
  renderSum();
};
HI['nw-color'] = t => { const l = findLine(t.dataset.k); if (l) l.color = t.value.slice(0, 40); };
H['nw-express'] = () => { const d = S.draft; d.express = !d.express; if (d.express && d.due > addDaysIso(1)) d.due = addDaysIso(1); if (!d.express && d.due < addDaysIso(2)) d.due = addDaysIso(2); renderNew(); };
H['nw-delivery'] = () => { S.draft.delivery = !S.draft.delivery; renderNew(); };
HC['nw-due'] = t => { S.draft.due = t.value || addDaysIso(2); renderSum(); };
HI['nw-adv'] = t => { const n = parseAmt(t.value); S.draft.advance = n; t.value = n ? fmt(n) : ''; renderSum(); };
H['nw-method'] = t => { S.draft.method = t.dataset.m; document.querySelectorAll('[data-act="nw-method"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); };
HI['nw-notes'] = t => { S.draft.notes = t.value; };
HC['nw-savenew'] = t => { S.draft.saveNew = t.checked; };
H['nw-fullpay'] = () => { const t = draftTotals(); S.draft.advance = t.total; const i = $('#nw-adv'); if (i) i.value = fmt(t.total); renderSum(); };
H['nw-reset'] = () => { if (confirm('Effacer ce dépôt en cours ?')) { S.draft = newDraft(); renderNew(); } };
H['nw-unlink'] = () => { S.draft.customer = { id: null, name: '', phone: '' }; S.draft.custCount = 0; renderNew(); $('#nw-phone').focus(); };

let suggT = null;
function custSuggest(field, value) {
  const d = S.draft;
  if (d.customer.id) { d.customer.id = null; d.custCount = 0; $('#nw-cinfo').innerHTML = custInfo(); renderSum(); }
  const box = $(field === 'phone' ? '#nw-sugg-phone' : '#nw-sugg-name');
  const other = $(field === 'phone' ? '#nw-sugg-name' : '#nw-sugg-phone'); if (other) other.innerHTML = '';
  clearTimeout(suggT);
  const term = field === 'phone' ? digits(value) : value.trim().replace(/[,()*%:\\]/g, '');
  if ((field === 'phone' && term.length < 3) || (field === 'name' && term.length < 2)) { box.innerHTML = ''; return; }
  suggT = setTimeout(async () => {
    try {
      let qb = sb.from('customers').select('id,name,phone').eq('pressing_id', pid()).limit(5);
      qb = field === 'phone' ? qb.like('phone', '%' + term + '%') : qb.ilike('name', '%' + term + '%');
      const rows = await q(qb);
      if (!rows.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="sugg">' + rows.map(c => '<button type="button" data-act="nw-pickc" data-id="' + c.id + '" data-name="' + esc(c.name) + '" data-phone="' + esc(c.phone) + '"><span><b>' + esc(c.name) + '</b></span><span class="muted">' + esc(fmtPhone(c.phone)) + '</span></button>').join('') + '</div>';
    } catch (e) { box.innerHTML = ''; }
  }, 220);
}
HI['nw-phone'] = t => { S.draft.customer.phone = digits(t.value); custSuggest('phone', t.value); if (!S.draft.customer.id) $('#nw-cinfo').innerHTML = custInfo(); };
HI['nw-name'] = t => { S.draft.customer.name = t.value; custSuggest('name', t.value); if (!S.draft.customer.id) $('#nw-cinfo').innerHTML = custInfo(); };
async function pickCustomer(c, rerender = true) {
  const { count } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', c.id).neq('status', 'annule');
  S.draft.customer = { id: c.id, name: c.name, phone: c.phone };
  S.draft.custCount = count || 0;
  if (rerender) {
    $('#nw-phone').value = fmtPhone(c.phone); $('#nw-name').value = c.name;
    $('#nw-sugg-phone').innerHTML = ''; $('#nw-sugg-name').innerHTML = '';
    $('#nw-cinfo').innerHTML = custInfo(); renderSum();
  }
}
H['nw-pickc'] = t => busy(null, () => pickCustomer({ id: t.dataset.id, name: t.dataset.name, phone: t.dataset.phone }));

H['nw-submit'] = t => {
  if (!needWrite()) return;
  const d = S.draft;
  if (!d.lines.length) return toast('Ajoute au moins un habit.', 'bad');
  if (!d.customer.id && !d.customer.name.trim()) {
    toast('Indique le nom du client.', 'bad');
    const n = $('#nw-name'); n.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => n.focus({ preventScroll: true }), 300);
    return;
  }
  const noPrice = d.lines.filter(l => !l.price);
  if (noPrice.length && !confirm(noPrice.map(l => l.name).join(', ') + ' : pas de prix. Créer quand même (gratuit) ?')) return;
  const tot = draftTotals();
  busy(t, async () => {
    const res = await q(sb.rpc('create_order', {
      p_pressing: pid(),
      p_customer: { id: d.customer.id, name: d.customer.name.trim(), phone: d.customer.phone },
      p_items: d.lines.map(l => ({ name: l.name, qty: l.qty, unit_price: l.price, color: l.color, defects: l.defects.join(', ') })),
      p_opts: { express: d.express, delivery: d.delivery, delivery_fee: settings().delivery_fee, due_at: d.due, notes: d.notes, advance: tot.adv, method: d.method, save_new_types: d.saveNew }
    }));
    const hadNew = d.saveNew && d.lines.some(l => lineCustom(l.name));
    S.draft = null; S.orders = null;
    if (hadNew) await loadTypes();
    toast('Ticket ' + ticketNo(res.number) + ' créé', 'ok');
    location.hash = '#/t/' + res.id + '?new=1';
  });
};

/* =========================================================
   Ticket
   ========================================================= */
let CUR = null;
async function viewTicket(seq, id, params) {
  const o = await q(sb.from('orders').select('*, customers(*), order_items(*), payments(*)').eq('id', id).maybeSingle());
  if (!alive(seq)) return;
  if (!o) { main().innerHTML = '<div class="card empty"><b>Ticket introuvable</b><a href="#/">Retour aux tickets</a></div>'; return; }
  o.payments.sort((a, b) => a.created_at.localeCompare(b.created_at));
  CUR = o;
  renderTicket(params.get('new') === '1');
}
function msgs(o) {
  const p = S.pressing, st = settings(), c = o.customers || {}, rest = o.total - o.paid;
  const prenom = firstName(c.name);
  const hi = 'Bonjour' + (prenom ? ' ' + prenom : '');
  const no = '*Ticket n° ' + String(o.number).padStart(4, '0') + '*';
  const n = o.order_items.reduce((s, i) => s + i.qty, 0);
  const due = o.due_at ? new Date(o.due_at + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) : '';
  const pay = rest > 0 ? 'reste ' + fmt(rest) + ' F' : 'payé';
  return {
    confirm: hi + ', votre linge est bien reçu ✅\n' + no + ' · ' + n + ' pièce' + (n > 1 ? 's' : '') + ' · ' + p.name + '\n' +
      'Total ' + fmt(o.total) + ' F · ' + pay + (due ? ' · prêt ' + due : '') + '\n' +
      'Suivi sécurisé : ' + trackUrl(o),
    ready: hi + ', votre linge est prêt ✅\n' + no + ' · ' + pay + '\n' + p.name + (st.hours ? ', ouvert ' + st.hours : ''),
    remind: hi + ', petit rappel : ' + fmt(rest) + ' F à régler pour le ' + no.replace('Ticket', 'ticket') + ' (' + p.name + '). Merci !'
  };
}
function renderTicket(isNew) {
  const o = CUR, st = STATUS[o.status], c = o.customers || {}, rest = o.total - o.paid, phone = c.phone;
  const extra = o.total - o.subtotal - o.delivery_fee + o.discount;
  const idx = STEPS.indexOf(o.status);
  const next = { recu: ['lavage', 'Mettre en lavage'], lavage: ['pret', 'Marquer prêt'], pret: ['retire', 'Remettre au client'] }[o.status];
  const m = msgs(o);
  const wa = (k, label, cls) => phone
    ? '<a class="btn ' + (cls || '') + '" href="' + esc(waLink(phone, m[k])) + '" target="_blank" rel="noopener">' + I.wa + ' ' + label + '</a>'
    : '';
  main().innerHTML =
    '<div class="page-h"><a class="iconbtn" href="#/" aria-label="Retour aux tickets">' + I.back + '</a>' +
      '<div class="grow"><h1>Ticket ' + ticketNo(o.number) + '</h1><div class="muted" style="font-size:13px">Déposé le ' + esc(dateTime(o.created_at)) + '</div></div>' +
      '<span class="badge ' + st.c + '" style="font-size:13px">' + st.l + '</span></div>' +
    (isNew ? '<div class="card stack" style="border-color:var(--ok);margin-bottom:14px"><div class="hstack"><span class="badge b-ok">' + I.check + ' Ticket créé</span><span class="muted">Envoie la confirmation et imprime le ticket.</span></div>' +
      '<div class="hstack">' + (wa('confirm', 'Envoyer le ticket sur WhatsApp', 'wa') || '<span class="hint">Pas de numéro : utilise « Partager ».</span>') + '<button class="btn" type="button" data-act="tk-share">' + I.link + ' Partager</button>' +
      '<button class="btn" type="button" data-act="tk-qr">' + I.qr + ' QR code</button><button class="btn" type="button" data-act="tk-print">' + I.print + ' Imprimer le ticket</button><a class="btn ghost" href="#/new">' + I.plus + ' Dépôt suivant</a></div></div>' : '') +
    '<div class="two-col"><div class="stack">' +
    '<section class="card stack">' +
      '<div class="hstack" style="flex-wrap:nowrap"><span class="avatar">' + esc(initials(c.name)) + '</span>' +
        '<div style="flex:1;min-width:0"><a href="#/c/' + (c.id || '') + '" style="font-weight:800;color:var(--ink);text-decoration:none">' + esc(c.name || 'Client supprimé') + '</a><div class="muted" style="font-size:13px">' + esc(fmtPhone(phone) || 'Pas de numéro') + '</div></div>' +
        (phone ? '<a class="iconbtn" href="tel:' + esc(digits(phone)) + '" aria-label="Appeler">' + I.phone + '</a>' : '') + '</div>' +
      (o.status === 'annule' ? '<p class="err">Ce ticket est annulé.</p>' :
      '<div class="steps" aria-label="Avancement">' + STEPS.map((s, i) => '<div class="st' + (i < idx ? ' done' : '') + (i === idx ? ' cur' : '') + '"><i></i>' + STATUS[s].l + '</div>').join('') + '</div>' +
      (next ? '<button class="btn primary block" type="button" data-act="tk-next" data-to="' + next[0] + '">' + next[1] + '</button>' : '<p class="hint">Remis au client le ' + esc(dateTime(o.picked_at)) + '.</p>') +
      (idx > 0 ? '<button class="btn sm ghost" type="button" data-act="tk-prev">Revenir à l’étape précédente</button>' : '')) +
    '</section>' +
    '<section class="card"><div class="card-h"><h2>Habits</h2><span class="muted">' + o.order_items.reduce((s, i) => s + i.qty, 0) + ' pièces' + (o.express ? ' · <span class="badge b-warn">Express</span>' : '') + '</span></div>' +
      '<div class="list">' + o.order_items.map(i => '<div class="li" style="cursor:default;min-height:0"><span class="mid"><span class="t">' + i.qty + ' × ' + esc(i.name) + '</span>' +
        ((i.color || i.defects) ? '<span class="s" style="display:block;white-space:normal">' + esc([i.color, i.defects ? '⚠ ' + i.defects : ''].filter(Boolean).join(' · ')) + '</span>' : '') +
        '</span><span class="num" style="font-weight:700">' + fmt(i.qty * i.unit_price) + ' F</span></div>').join('') + '</div>' +
      '<div style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px">' +
        (extra > 0 ? '<div class="kv"><span class="muted">Express</span><b>+ ' + fmt(extra) + ' F</b></div>' : '') +
        (o.delivery_fee ? '<div class="kv"><span class="muted">Livraison</span><b>+ ' + fmt(o.delivery_fee) + ' F</b></div>' : '') +
        (o.discount ? '<div class="kv"><span class="muted">Remise fidélité</span><b class="paid">− ' + fmt(o.discount) + ' F</b></div>' : '') +
        '<div class="kv big"><span>Total</span><span class="num">' + money(o.total) + '</span></div>' +
        '<div class="kv"><span class="muted">Payé</span><b class="paid num">' + fmt(o.paid) + ' F</b></div>' +
        '<div class="kv"><span>Reste</span><b class="num ' + (rest > 0 ? 'due' : 'paid') + '">' + fmt(rest) + ' F</b></div></div>' +
      (o.payments.length ? '<div class="sec-t" style="margin-top:8px">Paiements</div>' + o.payments.map(p => '<div class="kv" style="font-size:14px"><span class="muted">' + esc(dateTime(p.created_at)) + ' · ' + METHODS[p.method] + '</span><b class="num">' + fmt(p.amount) + ' F</b></div>').join('') : '') +
      (rest > 0 && o.status !== 'annule' ? '<button class="btn ok block" type="button" data-act="tk-pay" style="margin-top:10px">' + I.cash + ' Encaisser</button>' : '') +
    '</section></div>' +
    '<div class="stack">' +
    '<section class="card stack"><h2 style="font-size:17px">Prévenir le client</h2>' +
      (phone ? '<div class="stack" style="gap:8px">' + wa('ready', 'Linge prêt', o.status === 'pret' ? 'wa' : '') + wa('confirm', 'Envoyer le ticket') + (rest > 0 ? wa('remind', 'Rappel de paiement') : '') + '</div>'
             : '<p class="hint">Ajoute un numéro au client pour lui écrire sur WhatsApp.</p>') +
      '<button class="btn" type="button" data-act="tk-qr">' + I.qr + ' QR code à scanner</button>' +
      '<div class="hstack"><button class="btn ghost" type="button" data-act="tk-share">' + I.link + ' Partager (SMS, autre)</button><button class="btn ghost" type="button" data-act="tk-copylink">Copier le lien</button></div>' +
      '<p class="hint">Le message contient le ticket complet et le lien de suivi <b>' + esc(trackUrl(o).replace(/^https?:\/\//, '')) + '</b>.</p></section>' +
    '<section class="card stack"><h2 style="font-size:17px">Imprimer</h2><div class="hstack">' +
      '<button class="btn" type="button" data-act="tk-print">' + I.print + ' Ticket client</button>' +
      '<button class="btn" type="button" data-act="tk-labels">' + I.tag + ' Étiquettes (' + o.order_items.reduce((s, i) => s + i.qty, 0) + ')</button></div>' +
      '<p class="hint">Format ticket de caisse 80 mm, avec QR code de suivi.</p></section>' +
    '<section class="card stack"><h2 style="font-size:17px">Détails</h2>' +
      '<div class="field"><label for="tk-due">Prêt le</label><input class="inp" id="tk-due" type="date" data-ch="tk-due" value="' + esc(o.due_at || '') + '"></div>' +
      '<div class="field"><label for="tk-notes">Note</label><textarea class="inp" id="tk-notes" data-ch="tk-notes" maxlength="500">' + esc(o.notes) + '</textarea></div>' +
      (o.status !== 'annule' && o.status !== 'retire' && isOwner() ? '<button class="btn sm ghost danger" type="button" data-act="tk-cancel">Annuler ce ticket</button>' : '') +
    '</section></div></div>';
}
async function setStatus(to) {
  const patch = { status: to };
  if (to === 'pret') patch.ready_at = new Date().toISOString();
  if (to === 'retire') patch.picked_at = new Date().toISOString();
  if (to === 'recu' || to === 'lavage') patch.ready_at = null;
  if (to !== 'retire') patch.picked_at = null;
  const rows = await q(sb.from('orders').update(patch).eq('id', CUR.id).select('id'));
  if (!rows.length) throw new Error('Action refusée. Ton abonnement est peut-être expiré.');
  Object.assign(CUR, patch); S.orders = null;
}
H['tk-next'] = t => {
  if (!needWrite()) return;
  const to = t.dataset.to, rest = CUR.total - CUR.paid;
  if (to === 'retire' && rest > 0) {
    if (confirm('Il reste ' + money(rest) + ' à payer. Encaisser maintenant ?')) { openPay(true); return; }
    if (!confirm('Remettre le linge sans encaisser le reste ?')) return;
  }
  busy(t, async () => {
    await setStatus(to);
    toast(to === 'pret' ? 'Ticket prêt. Préviens le client sur WhatsApp.' : 'Statut mis à jour', 'ok');
    renderTicket(false);
  });
};
H['tk-prev'] = t => { if (!needWrite()) return; const i = STEPS.indexOf(CUR.status); if (i > 0) busy(t, async () => { await setStatus(STEPS[i - 1]); renderTicket(false); }); };
H['tk-cancel'] = t => { if (!needWrite()) return; if (confirm('Annuler le ticket ' + ticketNo(CUR.number) + ' ?')) busy(t, async () => { await setStatus('annule'); renderTicket(false); }); };
HC['tk-due'] = t => { if (!needWrite()) return; busy(null, async () => { await q(sb.from('orders').update({ due_at: t.value || null }).eq('id', CUR.id)); CUR.due_at = t.value || null; S.orders = null; toast('Date enregistrée', 'ok'); }); };
HC['tk-notes'] = t => { if (!needWrite()) return; busy(null, async () => { await q(sb.from('orders').update({ notes: t.value.slice(0, 500) }).eq('id', CUR.id)); CUR.notes = t.value; toast('Note enregistrée', 'ok'); }); };
H['tk-qr'] = () => {
  openModal('Suivi du ticket ' + ticketNo(CUR.number),
    qrBlock(trackUrl(CUR), 'Le client ouvre l’appareil photo de son téléphone et vise le code : la page de suivi s’ouvre, sans rien installer.') +
    '<div class="hstack" style="justify-content:center;margin-top:12px"><button class="btn" type="button" data-act="tk-copylink">Copier le lien</button><button class="btn" type="button" data-act="modal-close">Fermer</button></div>');
};
H['tk-share'] = async () => {
  const text = msgs(CUR).confirm.replace(/\*/g, '');
  if (navigator.share) { try { await navigator.share({ title: 'Ticket ' + ticketNo(CUR.number), text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Ticket copié : colle-le dans le message', 'ok'); } catch (e) { prompt('Ticket à envoyer :', text); }
};
H['tk-copylink'] = async () => {
  const url = trackUrl(CUR);
  try { await navigator.clipboard.writeText(url); toast('Lien copié', 'ok'); } catch (e) { prompt('Lien de suivi :', url); }
};
function openPay(thenPickup) {
  if (!needWrite()) return;
  const rest = CUR.total - CUR.paid;
  openModal('Encaisser · ' + ticketNo(CUR.number),
    '<form class="stack" data-form="pay" data-pickup="' + (thenPickup ? 1 : 0) + '" novalidate>' +
    '<div class="field"><label for="pay-amt">Montant (FCFA)</label><input class="inp" id="pay-amt" name="amt" inputmode="numeric" data-in="amt-fmt" value="' + fmt(rest) + '"></div>' +
    '<div class="chips" role="group" aria-label="Mode de paiement">' + ['especes', 'wave', 'om'].map((k, i) => '<button type="button" class="chip" data-act="pay-m" data-m="' + k + '" aria-pressed="' + (i === 0) + '">' + METHODS[k] + '</button>').join('') + '</div>' +
    '<input type="hidden" name="method" value="especes">' +
    '<p class="hint">Reste dû : ' + money(rest) + '</p>' +
    '<button class="btn ok block" type="submit">' + I.check + ' Encaisser' + (thenPickup ? ' et remettre' : '') + '</button></form>');
}
H['tk-pay'] = () => openPay(false);
H['pay-m'] = t => { const f = t.closest('form'); f.method.value = t.dataset.m; f.querySelectorAll('[data-act="pay-m"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); };
HI['amt-fmt'] = t => { const n = parseAmt(t.value); t.value = n ? fmt(n) : ''; };
HF.pay = (f) => busy(f.querySelector('[type=submit]'), async () => {
  const amt = parseAmt(f.amt.value);
  if (amt <= 0) return toast('Montant invalide', 'bad');
  await q(sb.from('payments').insert({ order_id: CUR.id, pressing_id: pid(), amount: amt, method: f.method.value, created_by: S.user.id }));
  if (f.dataset.pickup === '1') await setStatus('retire');
  closeModal(); toast(fmt(amt) + ' FCFA encaissés', 'ok'); S.orders = null;
  const o = await q(sb.from('orders').select('*, customers(*), order_items(*), payments(*)').eq('id', CUR.id).single());
  o.payments.sort((a, b) => a.created_at.localeCompare(b.created_at)); CUR = o; renderTicket(false);
});

/* ---------- impression ---------- */
function qrImg(text) {
  try { const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createImgTag(4, 0, 'QR code de suivi'); } catch (e) { return ''; }
}
H['tk-print'] = () => {
  const o = CUR, p = S.pressing, c = o.customers || {}, st = settings(), rest = o.total - o.paid;
  const extra = o.total - o.subtotal - o.delivery_fee + o.discount;
  $('#print').innerHTML = '<div class="rcpt">' +
    '<h3>' + esc(p.name) + '</h3><div class="c">' + esc([p.address, fmtPhone(p.phone)].filter(Boolean).join(' · ')) + '</div>' + (st.hours ? '<div class="c">Ouvert ' + esc(st.hours) + '</div>' : '') + '<hr>' +
    '<div class="c" style="font-size:20px;font-weight:800">TICKET ' + ticketNo(o.number) + '</div>' +
    '<div class="l"><span>Déposé</span><span>' + esc(dateTime(o.created_at)) + '</span></div>' +
    (o.due_at ? '<div class="l"><span>Prêt le</span><b>' + esc(dayLabel(o.due_at)) + '</b></div>' : '') +
    '<div class="l"><span>Client</span><span>' + esc(c.name || '') + '</span></div>' + (c.phone ? '<div class="l"><span>Tél.</span><span>' + esc(fmtPhone(c.phone)) + '</span></div>' : '') + '<hr>' +
    o.order_items.map(i => '<div class="l"><span>' + i.qty + ' × ' + esc(i.name) + '</span><span>' + fmt(i.qty * i.unit_price) + '</span></div>' +
      ((i.color || i.defects) ? '<div style="font-size:10px">' + esc([i.color, i.defects].filter(Boolean).join(' · ')) + '</div>' : '')).join('') + '<hr>' +
    (extra > 0 ? '<div class="l"><span>Express</span><span>+' + fmt(extra) + '</span></div>' : '') +
    (o.delivery_fee ? '<div class="l"><span>Livraison</span><span>+' + fmt(o.delivery_fee) + '</span></div>' : '') +
    (o.discount ? '<div class="l"><span>Remise fidélité</span><span>−' + fmt(o.discount) + '</span></div>' : '') +
    '<div class="l" style="font-size:15px;font-weight:800"><span>TOTAL</span><span>' + money(o.total) + '</span></div>' +
    '<div class="l"><span>Payé</span><span>' + fmt(o.paid) + '</span></div><div class="l" style="font-weight:800"><span>Reste</span><span>' + fmt(rest) + '</span></div><hr>' +
    '<div class="c">Suivez votre linge :</div><div class="qr">' + qrImg(trackUrl(o)) + '</div><div class="c" style="font-size:11px">' + esc(trackUrl(o).replace(/^https?:\/\//, '')) + '</div>' +
    '<div class="c" style="margin-top:6px">Présentez ce ticket au retrait. Merci !</div></div>';
  setTimeout(() => window.print(), 50);
};
H['tk-labels'] = () => {
  const o = CUR, c = o.customers || {};
  const total = o.order_items.reduce((s, i) => s + i.qty, 0);
  let n = 0, html = '';
  o.order_items.forEach(i => { for (let k = 0; k < i.qty; k++) { n++; html += '<div class="lbl-p"><b>' + ticketNo(o.number) + '</b> <span>' + n + '/' + total + '</span><div>' + esc(i.name) + (i.color ? ' · ' + esc(i.color) : '') + '</div><div>' + esc(c.name || '') + (o.due_at ? ' · ' + esc(dayLabel(o.due_at)) : '') + '</div></div>'; } });
  $('#print').innerHTML = html;
  setTimeout(() => window.print(), 50);
};

/* =========================================================
   Clients
   ========================================================= */
let CLIENTS = [];
async function viewClients(seq) {
  const rows = await q(sb.from('customers').select('id,name,phone,created_at,orders(total,paid,status,created_at)').eq('pressing_id', pid()).order('created_at', { ascending: false }).limit(2000));
  if (!alive(seq)) return;
  CLIENTS = rows.map(c => {
    const os = c.orders.filter(o => o.status !== 'annule');
    return { id: c.id, name: c.name, phone: c.phone, n: os.length, spent: os.reduce((s, o) => s + o.paid, 0), due: os.reduce((s, o) => s + Math.max(0, o.total - o.paid), 0),
      last: os.reduce((m, o) => o.created_at > m ? o.created_at : m, c.created_at) };
  }).sort((a, b) => b.last.localeCompare(a.last));
  main().innerHTML =
    '<div class="page-h"><div class="grow"><h1>Clients</h1><div class="muted" style="font-size:13px">' + CLIENTS.length + ' client' + (CLIENTS.length > 1 ? 's' : '') + '</div></div>' +
      '<button class="btn primary sm" type="button" data-act="cl-add">' + I.plus + ' Client</button></div>' +
    '<div class="stack"><div><label for="cl-q" class="sr">Rechercher un client</label><input class="inp" id="cl-q" type="search" data-in="cl-q" value="' + esc(S.clientSearch) + '" placeholder="Nom ou téléphone"></div>' +
    '<section class="card" style="padding:4px 14px"><div class="list" id="cl-list"></div></section></div>';
  renderClientList();
}
function renderClientList() {
  const box = $('#cl-list'); if (!box) return;
  const t = S.clientSearch.trim().toLowerCase(), dt = digits(t);
  const list = CLIENTS.filter(c => !t || c.name.toLowerCase().includes(t) || (dt && c.phone.includes(dt)));
  box.innerHTML = list.length ? list.slice(0, 300).map(c =>
    '<a class="li" href="#/c/' + c.id + '"><span class="avatar">' + esc(initials(c.name)) + '</span><span class="mid"><span class="t">' + esc(c.name) + '</span>' +
    '<span class="s" style="display:block">' + esc([fmtPhone(c.phone), c.n + ' dépôt' + (c.n > 1 ? 's' : '')].filter(Boolean).join(' · ')) + '</span></span>' +
    '<span class="r">' + (c.due > 0 ? '<span class="due" style="font-size:13px">Doit ' + fmt(c.due) + '</span>' : '<span class="muted" style="font-size:13px">' + fmt(c.spent) + ' F</span>') + '</span></a>').join('')
    : '<div class="empty"><b>' + (CLIENTS.length ? 'Aucun résultat' : 'Pas encore de client') + '</b>' + (CLIENTS.length ? '' : 'Ils sont créés automatiquement à chaque dépôt.') + '</div>';
}
HI['cl-q'] = t => { S.clientSearch = t.value; renderClientList(); };
function clientForm(c) {
  return '<form class="stack" data-form="client" data-id="' + (c ? c.id : '') + '" novalidate>' +
    '<div class="field"><label for="cf-name">Nom</label><input class="inp" id="cf-name" name="cname" value="' + esc(c ? c.name : '') + '" required maxlength="80"></div>' +
    '<div class="field"><label for="cf-phone">Téléphone</label><input class="inp" id="cf-phone" name="phone" type="tel" value="' + esc(c ? fmtPhone(c.phone) : '') + '"></div>' +
    '<div class="field"><label for="cf-notes">Remarques</label><textarea class="inp" id="cf-notes" name="notes" maxlength="500" placeholder="Ex. préfère le pliage, allergique à l’assouplissant…">' + esc(c ? c.notes : '') + '</textarea></div>' +
    '<button class="btn primary block" type="submit">Enregistrer</button></form>';
}
H['cl-add'] = () => { if (needWrite()) openModal('Nouveau client', clientForm(null)); };
HF.client = (f) => busy(f.querySelector('[type=submit]'), async () => {
  const row = { name: f.cname.value.trim(), phone: digits(f.phone.value), notes: f.notes.value.trim() };
  if (!row.name) return toast('Indique le nom', 'bad');
  if (f.dataset.id) {
    await q(sb.from('customers').update(row).eq('id', f.dataset.id));
    closeModal(); toast('Client mis à jour', 'ok'); route();
  } else {
    const c = await q(sb.from('customers').insert(Object.assign({ pressing_id: pid() }, row)).select('id').single());
    closeModal(); toast('Client ajouté', 'ok'); location.hash = '#/c/' + c.id;
  }
});
let CCUR = null;
async function viewClient(seq, id) {
  const c = await q(sb.from('customers').select('*, orders(id,number,status,total,paid,created_at)').eq('id', id).maybeSingle());
  if (!alive(seq)) return;
  if (!c) { main().innerHTML = '<div class="card empty"><b>Client introuvable</b><a href="#/clients">Retour</a></div>'; return; }
  CCUR = c;
  const os = c.orders.filter(o => o.status !== 'annule').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const all = c.orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const st = settings(), due = os.reduce((s, o) => s + Math.max(0, o.total - o.paid), 0), spent = os.reduce((s, o) => s + o.paid, 0);
  const lp = st.loyalty_every > 0 ? os.length % st.loyalty_every : 0;
  main().innerHTML =
    '<div class="page-h"><a class="iconbtn" href="#/clients" aria-label="Retour aux clients">' + I.back + '</a><div class="grow"><h1>' + esc(c.name) + '</h1><div class="muted" style="font-size:13px">Client depuis le ' + esc(dateShort(c.created_at)) + '</div></div>' +
      '<button class="btn sm" type="button" data-act="cl-edit">Modifier</button></div>' +
    '<div class="two-col"><div class="stack">' +
    '<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><div class="k">Dépôts</div><div class="v">' + os.length + '</div></div>' +
      '<div class="kpi"><div class="k">Payé au total</div><div class="v">' + fmt(spent) + '</div></div>' +
      '<div class="kpi"><div class="k">Doit</div><div class="v" style="color:' + (due ? 'var(--bad)' : 'var(--ok)') + '">' + fmt(due) + '</div></div></div>' +
    '<section class="card" style="padding:4px 14px"><div class="list">' + (all.length ? all.map(o => '<a class="li" href="#/t/' + o.id + '"><span class="tno">' + ticketNo(o.number) + '</span><span class="mid"><span class="t">' + money(o.total) + '</span><span class="s" style="display:block">' + esc(dateShort(o.created_at)) + '</span></span>' +
      '<span class="r"><span class="badge ' + STATUS[o.status].c + '">' + STATUS[o.status].l + '</span>' + (o.status !== 'annule' && o.total > o.paid ? '<span class="due" style="font-size:12px">Reste ' + fmt(o.total - o.paid) + '</span>' : '') + '</span></a>').join('') : '<div class="empty"><b>Aucun dépôt</b></div>') + '</div></section>' +
    '</div><div class="stack">' +
    '<section class="card stack"><div class="hstack"><span class="avatar">' + esc(initials(c.name)) + '</span><div><div style="font-weight:800">' + esc(fmtPhone(c.phone) || 'Pas de numéro') + '</div>' + (c.notes ? '<div class="muted" style="font-size:13px">' + esc(c.notes) + '</div>' : '') + '</div></div>' +
      '<div class="hstack"><a class="btn primary" href="#/new?c=' + c.id + '">' + I.plus + ' Nouveau dépôt</a>' +
      (c.phone ? '<a class="btn wa" href="' + esc(waLink(c.phone, 'Bonjour ' + firstName(c.name) + ', ')) + '" target="_blank" rel="noopener">' + I.wa + ' WhatsApp</a><a class="iconbtn" href="tel:' + esc(c.phone) + '" aria-label="Appeler">' + I.phone + '</a>' : '') + '</div></section>' +
    (st.loyalty_every > 0 ? '<section class="card stack"><div class="hstack">' + I.star + '<h2 style="font-size:17px">Carte fidélité</h2></div>' +
      '<div class="meter" role="img" aria-label="' + lp + ' sur ' + st.loyalty_every + '"><i style="width:' + (lp / st.loyalty_every * 100) + '%"></i></div>' +
      '<p class="hint">' + lp + ' / ' + st.loyalty_every + ' dépôts. ' + (lp + 1 === st.loyalty_every ? '<b>Le prochain dépôt a −' + st.loyalty_pct + ' %.</b>' : 'Au ' + st.loyalty_every + 'e dépôt : −' + st.loyalty_pct + ' % automatique.') + '</p></section>' : '') +
    '</div></div>';
}
H['cl-edit'] = () => { if (needWrite()) openModal('Modifier le client', clientForm(CCUR)); };

/* =========================================================
   Caisse
   ========================================================= */
async function viewCaisse(seq) {
  const per = S.cashPeriod;
  const from = per === 'jour' ? startOfDay() : per === '7j' ? startOfDay(-6) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const chartDays = per === 'mois' ? new Date().getDate() : 7;
  const chartFrom = startOfDay(-(chartDays - 1));
  const qFrom = new Date(Math.min(from.getTime(), chartFrom.getTime())).toISOString();
  const [pays, orders, open] = await Promise.all([
    q(sb.from('payments').select('amount,method,created_at,orders(id,number,customers(name))').eq('pressing_id', pid()).gte('created_at', qFrom).order('created_at', { ascending: false }).limit(3000)),
    q(sb.from('orders').select('total,status,created_at,order_items(name,qty)').eq('pressing_id', pid()).neq('status', 'annule').gte('created_at', from.toISOString()).limit(3000)),
    q(sb.from('orders').select('total,paid').eq('pressing_id', pid()).neq('status', 'annule').limit(5000))
  ]);
  if (!alive(seq)) return;
  const inP = pays.filter(p => new Date(p.created_at) >= from);
  const cash = inP.reduce((s, p) => s + p.amount, 0);
  const byM = { especes: 0, wave: 0, om: 0, autre: 0 }; inP.forEach(p => { byM[p.method] += p.amount; });
  const billed = orders.reduce((s, o) => s + o.total, 0);
  const pieces = {}; let nPieces = 0;
  orders.forEach(o => o.order_items.forEach(i => { pieces[i.name] = (pieces[i.name] || 0) + i.qty; nPieces += i.qty; }));
  const top = Object.entries(pieces).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = top.length ? top[0][1] : 1;
  const dueAll = open.reduce((s, o) => s + Math.max(0, o.total - o.paid), 0);
  const days = [];
  for (let i = chartDays - 1; i >= 0; i--) { const d = startOfDay(-i); days.push({ d, v: 0 }); }
  pays.forEach(p => { const t = new Date(p.created_at); const day = days.find(x => t >= x.d && t < new Date(x.d.getTime() + 864e5)); if (day) day.v += p.amount; });
  const vmax = Math.max(1, ...days.map(x => x.v));
  const lbl = { jour: 'aujourd’hui', '7j': 'sur 7 jours', mois: 'ce mois-ci' }[per];
  main().innerHTML =
    '<div class="page-h"><div class="grow"><h1>Caisse</h1></div></div>' +
    '<div class="stack"><div class="chips" role="group" aria-label="Période">' + [['jour', 'Aujourd’hui'], ['7j', '7 jours'], ['mois', 'Ce mois']].map(([k, l]) => '<button type="button" class="chip" data-act="ca-per" data-p="' + k + '" aria-pressed="' + (per === k) + '">' + l + '</button>').join('') + '</div>' +
    '<section class="hero"><div class="k">Encaissé ' + lbl + '</div><div class="v">' + fmt(cash) + ' <small>FCFA</small></div>' +
      '<div class="tiles"><div class="tile"><div class="k">Espèces</div><div class="v">' + fmt(byM.especes) + '</div></div><div class="tile"><div class="k">Wave</div><div class="v">' + fmt(byM.wave) + '</div></div><div class="tile"><div class="k">Orange Money</div><div class="v">' + fmt(byM.om) + '</div></div></div></section>' +
    '<div class="kpis"><div class="kpi"><div class="k">Dépôts</div><div class="v">' + orders.length + '</div></div><div class="kpi"><div class="k">Pièces traitées</div><div class="v">' + nPieces + '</div></div>' +
      '<div class="kpi"><div class="k">Facturé</div><div class="v">' + fmt(billed) + '</div></div><div class="kpi"><div class="k">Reste à encaisser (tout)</div><div class="v" style="color:var(--bad)">' + fmt(dueAll) + '</div></div></div>' +
    '<div class="two-col"><section class="card"><div class="card-h"><h2>Encaissements par jour</h2><span class="muted" style="font-size:13px">' + chartDays + ' derniers jours</span></div>' +
      '<div class="bars" role="img" aria-label="Encaissements par jour">' + days.map((x, i) => '<div class="' + (i === days.length - 1 ? 'today' : '') + '" title="' + esc(x.d.toLocaleDateString('fr-FR')) + ' : ' + fmt(x.v) + ' F"><i style="height:' + (x.v / vmax * 100) + '%"></i></div>').join('') + '</div>' +
      '<div class="bars-x">' + days.map((x, i) => '<span>' + ((chartDays <= 7 || i % 5 === 0 || i === days.length - 1) ? x.d.toLocaleDateString('fr-FR', chartDays <= 7 ? { weekday: 'short' } : { day: 'numeric' }) : '') + '</span>').join('') + '</div></section>' +
    '<section class="card"><div class="card-h"><h2>Habits les plus déposés</h2></div>' + (top.length ? top.map(([n, v]) => '<div style="margin:8px 0"><div class="kv" style="padding:0 0 4px"><span>' + esc(n) + '</span><b>' + v + '</b></div><div class="meter"><i style="width:' + (v / topMax * 100) + '%"></i></div></div>').join('') : '<p class="hint">Aucun dépôt sur la période.</p>') + '</section></div>' +
    '<section class="card"><div class="card-h"><h2>Derniers paiements</h2></div><div class="list">' + (inP.length ? inP.slice(0, 40).map(p => '<a class="li" href="#/t/' + (p.orders ? p.orders.id : '') + '"><span class="mid"><span class="t">' + (p.orders ? ticketNo(p.orders.number) : '') + ' · ' + esc(p.orders && p.orders.customers ? p.orders.customers.name : '') + '</span><span class="s" style="display:block">' + esc(dateTime(p.created_at)) + ' · ' + METHODS[p.method] + '</span></span><span class="r"><b class="num">' + fmt(p.amount) + ' F</b></span></a>').join('') : '<div class="empty"><b>Aucun paiement</b>sur cette période.</div>') + '</div></section>' +
    '</div>';
}
H['ca-per'] = t => { S.cashPeriod = t.dataset.p; route(); };

/* =========================================================
   Réglages
   ========================================================= */
async function viewSettings(seq) {
  const members = await q(sb.from('members').select('user_id,role,display_name,created_at').eq('pressing_id', pid()).order('created_at'));
  if (!alive(seq)) return;
  const p = S.pressing, st = settings(), ss = subState(p), own = isOwner(), dis = own ? '' : ' disabled';
  const byCat = {};
  S.types.forEach(t => { (byCat[t.category] = byCat[t.category] || []).push(t); });
  const pay = supportLink('Bonjour, je veux payer l’abonnement Pressing Pro pour « ' + p.name + ' ».');
  main().innerHTML =
    '<div class="page-h"><div class="grow"><h1>Réglages</h1></div></div>' +
    '<div class="two-col"><div class="stack">' +
    '<form class="card stack" data-form="set-pressing" novalidate><h2 style="font-size:17px">Mon pressing</h2>' +
      (own ? '' : '<p class="hint">Seul le gérant peut modifier ces informations.</p>') +
      '<div class="field"><label for="sp-name">Nom</label><input class="inp" id="sp-name" name="pname" value="' + esc(p.name) + '"' + dis + '></div>' +
      '<div class="row2"><div class="field"><label for="sp-phone">Téléphone</label><input class="inp" id="sp-phone" name="phone" value="' + esc(p.phone) + '"' + dis + '></div>' +
      '<div class="field"><label for="sp-hours">Horaires</label><input class="inp" id="sp-hours" name="hours" value="' + esc(st.hours) + '" placeholder="8 h – 20 h"' + dis + '></div></div>' +
      '<div class="field"><label for="sp-addr">Adresse</label><input class="inp" id="sp-addr" name="address" value="' + esc(p.address) + '"' + dis + '></div>' +
      '<div class="sec-t" style="margin-top:6px">Tarifs et fidélité</div>' +
      '<div class="row2"><div class="field"><label for="sp-exp">Express (+ %)</label><input class="inp" id="sp-exp" name="express_pct" type="number" min="0" max="300" value="' + st.express_pct + '"' + dis + '></div>' +
      '<div class="field"><label for="sp-del">Livraison (FCFA)</label><input class="inp" id="sp-del" name="delivery_fee" type="number" min="0" value="' + st.delivery_fee + '"' + dis + '></div></div>' +
      '<div class="row2"><div class="field"><label for="sp-le">Remise fidélité tous les … dépôts</label><input class="inp" id="sp-le" name="loyalty_every" type="number" min="0" max="100" value="' + st.loyalty_every + '"' + dis + '></div>' +
      '<div class="field"><label for="sp-lp">Remise (%)</label><input class="inp" id="sp-lp" name="loyalty_pct" type="number" min="0" max="100" value="' + st.loyalty_pct + '"' + dis + '></div></div>' +
      '<p class="hint">Mets 0 pour désactiver la fidélité.</p>' +
      (own ? '<button class="btn primary" type="submit">Enregistrer</button>' : '') + '</form>' +
    '<section class="card stack"><div class="card-h" style="margin:0"><h2>Catalogue des habits</h2><span class="muted" style="font-size:13px">' + S.types.length + ' habits</span></div>' +
      '<form class="stack" data-form="add-type" novalidate style="background:var(--surface-2);padding:12px;border-radius:12px"><div class="sec-t">Ajouter un habit</div>' +
        '<div class="field"><label for="at-name">Nom de l’habit</label><input class="inp" id="at-name" name="tname" maxlength="60" placeholder="Ex. Bazin riche, Thiaya, Blouse…" required></div>' +
        '<div class="row2"><div class="field"><label for="at-cat">Catégorie</label><select class="inp" id="at-cat" name="cat">' + CATEGORIES.map(c => '<option>' + c + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="at-price">Prix (FCFA)</label><input class="inp" id="at-price" name="price" inputmode="numeric" data-in="amt-fmt" placeholder="0"></div></div>' +
        '<button class="btn primary" type="submit">' + I.plus + ' Ajouter au catalogue</button></form>' +
      CATEGORIES.filter(c => byCat[c]).map(c => '<div><div class="sec-t" style="margin:8px 0 4px">' + c + '</div>' + byCat[c].map(t =>
        '<div class="li" style="cursor:default;min-height:52px;gap:8px"><span class="mid"><span class="t" style="font-weight:700' + (t.active ? '' : ';color:var(--muted);text-decoration:line-through') + '">' + esc(t.name) + '</span></span>' +
        '<label class="sr" for="tp-' + t.id + '">Prix de ' + esc(t.name) + '</label><input class="price-inp" id="tp-' + t.id + '" inputmode="numeric" data-in="amt-fmt" data-ch="type-price" data-id="' + t.id + '" value="' + fmt(t.price) + '">' +
        '<button type="button" class="btn sm ghost" data-act="type-toggle" data-id="' + t.id + '" title="' + (t.active ? 'Masquer' : 'Afficher') + '">' + (t.active ? 'Masquer' : 'Afficher') + '</button>' +
        '<button type="button" class="iconbtn" style="width:38px;height:38px" data-act="type-del" data-id="' + t.id + '" aria-label="Supprimer ' + esc(t.name) + '">' + I.trash + '</button></div>').join('') + '</div>').join('') +
    '</section></div><div class="stack">' +
    '<section class="card stack"><h2 style="font-size:17px">Abonnement</h2>' +
      '<div class="hstack"><span class="badge ' + ({ trial: 'b-info', active: 'b-ok', expired: 'b-bad', suspended: 'b-bad' })[ss.k] + '">' + ss.l + '</span><span class="muted">' + (ss.days >= 0 ? 'jusqu’au ' + esc(dateShort(p.paid_until)) : 'depuis le ' + esc(dateShort(p.paid_until))) + '</span></div>' +
      '<p class="hint">' + fmt(PRICE_MONTH) + ' FCFA par mois, payable par Wave ou Orange Money. L’accès est prolongé dès réception.</p>' +
      (pay ? '<a class="btn wa" href="' + esc(pay) + '" target="_blank" rel="noopener">' + I.wa + ' Payer / nous contacter</a>' : '') + '</section>' +
    '<section class="card stack"><h2 style="font-size:17px">Équipe</h2>' +
      (own ? '<div><div class="lbl">Code pour tes employés</div><div style="font-size:30px;font-weight:800;letter-spacing:.2em">' + esc(p.join_code) + '</div>' +
        '<p class="hint">L’employé crée un compte sur Pressing Pro puis choisit « Rejoindre l’équipe » avec ce code.</p></div>' +
        '<a class="btn" href="' + esc('https://wa.me/?text=' + encodeURIComponent('Rejoins ' + p.name + ' sur Pressing Pro : ' + new URL('app.html#signup', location.href.split('#')[0]).href + '\nCode équipe : ' + p.join_code)) + '" target="_blank" rel="noopener">' + I.wa + ' Partager le code</a><button class="btn" type="button" data-act="team-qr">' + I.qr + ' QR code pour l’employé</button>' : '') +
      '<div class="list">' + members.map(m => '<div class="li" style="cursor:default"><span class="avatar">' + esc(initials(m.display_name || '?')) + '</span><span class="mid"><span class="t">' + esc(m.display_name || 'Sans nom') + (m.user_id === S.user.id ? ' (toi)' : '') + '</span><span class="s" style="display:block">' + (m.role === 'owner' ? 'Gérant' : 'Employé') + '</span></span>' +
        (own && m.role === 'staff' ? '<button type="button" class="btn sm ghost danger" data-act="member-del" data-id="' + m.user_id + '">Retirer</button>' : '') + '</div>').join('') + '</div></section>' +
    '<section class="card stack"><h2 style="font-size:17px">Mon compte</h2><p class="muted" style="margin:0">' + esc(S.user.email) + '</p>' +
      '<button class="btn" type="button" data-act="logout">' + I.logout + ' Se déconnecter</button></section>' +
    '</div></div>';
}
H['team-qr'] = () => {
  const p = S.pressing, url = new URL('app.html#signup', location.href.split('#')[0]).href;
  openModal('Inviter un employé',
    qrBlock(url, 'L’employé scanne, crée son compte, puis choisit « Rejoindre l’équipe » avec ce code :') +
    '<div style="text-align:center;font-size:30px;font-weight:800;letter-spacing:.2em;margin-top:4px">' + esc(p.join_code) + '</div>');
};
HF['set-pressing'] = (f) => busy(f.querySelector('[type=submit]'), async () => {
  const num = (n, min, max) => Math.max(min, Math.min(max, parseInt(f[n].value, 10) || 0));
  const s = Object.assign({}, settings(), {
    hours: f.hours.value.trim().slice(0, 60), express_pct: num('express_pct', 0, 300), delivery_fee: num('delivery_fee', 0, 1000000),
    loyalty_every: num('loyalty_every', 0, 100), loyalty_pct: num('loyalty_pct', 0, 100)
  });
  const patch = { name: f.pname.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), settings: s };
  if (patch.name.length < 2) return toast('Nom trop court', 'bad');
  const rows = await q(sb.from('pressings').update(patch).eq('id', pid()).select('id'));
  if (!rows.length) throw new Error('Action refusée');
  Object.assign(S.pressing, patch); toast('Réglages enregistrés', 'ok'); route();
});
HF['add-type'] = (f) => busy(f.querySelector('[type=submit]'), async () => {
  if (!needWrite()) return;
  const name = f.tname.value.trim().replace(/\s+/g, ' ');
  if (!name) return toast('Indique le nom de l’habit', 'bad');
  await q(sb.from('garment_types').insert({ pressing_id: pid(), name: name.charAt(0).toUpperCase() + name.slice(1), category: f.cat.value, price: parseAmt(f.price.value) }));
  await loadTypes(); toast(name + ' ajouté', 'ok'); route();
});
HC['type-price'] = t => {
  if (!needWrite()) return;
  busy(null, async () => {
    const price = parseAmt(t.value);
    await q(sb.from('garment_types').update({ price }).eq('id', t.dataset.id));
    const ty = S.types.find(x => x.id === t.dataset.id); if (ty) ty.price = price;
    toast('Prix mis à jour', 'ok');
  });
};
H['type-toggle'] = t => {
  if (!needWrite()) return;
  const ty = S.types.find(x => x.id === t.dataset.id); if (!ty) return;
  busy(t, async () => { await q(sb.from('garment_types').update({ active: !ty.active }).eq('id', ty.id)); ty.active = !ty.active; route(); });
};
H['type-del'] = t => {
  if (!needWrite()) return;
  const ty = S.types.find(x => x.id === t.dataset.id); if (!ty || !confirm('Supprimer « ' + ty.name + ' » du catalogue ? (Les anciens tickets ne changent pas.)')) return;
  busy(t, async () => { await q(sb.from('garment_types').delete().eq('id', ty.id)); await loadTypes(); route(); });
};
H['member-del'] = t => {
  if (!confirm('Retirer cet employé de l’équipe ?')) return;
  busy(t, async () => { await q(sb.from('members').delete().eq('pressing_id', pid()).eq('user_id', t.dataset.id)); toast('Employé retiré', 'ok'); route(); });
};
