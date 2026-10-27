// Librairie Supabase hébergée sur le site (assets/vendor/supabase.js) : disponible même hors connexion
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_KEY, SUPPORT_PHONE, PRICE_MONTH, TRACK_BASE } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ---------- DOM ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- nombres, dates, téléphones ---------- */
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmt = n => nf.format(Math.round(n || 0)).replace(/[  ]/g, ' ');
export const money = n => fmt(n) + ' FCFA';
export const digits = s => String(s || '').replace(/\D/g, '');
export const fmtPhone = p => {
  const d = digits(p);
  return d.length === 9 ? d.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4') : d;
};
export const waNumber = p => {
  let d = digits(p);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = '221' + d;
  return d;
};
export const waLink = (p, text) => 'https://wa.me/' + waNumber(p) + '?text=' + encodeURIComponent(text);
const pad = n => String(n).padStart(2, '0');
export const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayIso = () => isoDay(new Date());
export const addDaysIso = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
export const dayLabel = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
export const dateTime = ts => ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const dateShort = ts => ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const ticketNo = n => '#' + String(n).padStart(4, '0');
export const startOfDay = (offsetDays = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };

/* ---------- métier ---------- */
export const STATUS = {
  recu: { l: 'Reçu', c: 's-recu' },
  lavage: { l: 'En lavage', c: 's-lavage' },
  pret: { l: 'Prêt', c: 's-pret' },
  retire: { l: 'Retiré', c: 's-retire' },
  annule: { l: 'Annulé', c: 's-annule' }
};
export const STEPS = ['recu', 'lavage', 'pret', 'retire'];
export const METHODS = { especes: 'Espèces', wave: 'Wave', om: 'Orange Money', autre: 'Autre' };
export const DEFECTS = ['Tache', 'Trou', 'Bouton manquant', 'Décoloré', 'Délicat', 'Fermeture abîmée'];
export const CATEGORIES = ['Homme', 'Femme', 'Traditionnel', 'Enfant', 'Maison', 'Autre'];

export function subState(p) {
  const days = Math.ceil((new Date(p.paid_until) - Date.now()) / 864e5);
  if (p.status === 'suspended') return { k: 'suspended', days, l: 'Suspendu' };
  if (days < 0) return { k: 'expired', days, l: 'Expiré' };
  if (p.status === 'trial') return { k: 'trial', days, l: 'Essai' };
  return { k: 'active', days, l: 'Actif' };
}
export const supportLink = text => SUPPORT_PHONE ? waLink(SUPPORT_PHONE, text) : '';
export { PRICE_MONTH, SUPPORT_PHONE, TRACK_BASE };

/* ---------- erreurs ---------- */
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  const map = [
    [/Invalid login credentials/i, 'Email ou mot de passe incorrect.'],
    [/Email not confirmed/i, 'Confirme d’abord ton email : ouvre le lien reçu par mail.'],
    [/User already registered/i, 'Un compte existe déjà avec cet email. Connecte-toi.'],
    [/Password should be at least/i, 'Le mot de passe doit faire au moins 6 caractères.'],
    [/rate limit/i, 'Trop de tentatives. Réessaie dans quelques minutes.'],
    [/Failed to fetch|NetworkError/i, 'Pas de connexion internet. Réessaie.'],
    [/row-level security|permission denied/i, 'Action refusée. Ton abonnement est peut-être expiré.'],
    [/duplicate key.*garment_types/i, 'Cet article existe déjà dans le catalogue.'],
    [/duplicate key.*customers/i, 'Un client a déjà ce numéro.']
  ];
  for (const [re, t] of map) if (re.test(m)) return t;
  return m;
}

/* ---------- QR code ---------- */
export function qrDataUrl(text, cell = 8) {
  try { const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createDataURL(cell, 2); }
  catch (e) { return ''; }
}
export function qrBlock(url, caption) {
  const src = qrDataUrl(url);
  if (!src) return '<p class="hint">QR code indisponible (connexion ?).</p>';
  return '<div class="qrbox"><img src="' + src + '" alt="QR code vers ' + esc(url) + '" width="240" height="240">' +
    '<div class="qrurl">' + esc(url.replace(/^https?:\/\//, '')) + '</div>' + (caption ? '<p class="hint" style="text-align:center">' + caption + '</p>' : '') + '</div>';
}

/* ---------- toast ---------- */
let toastT = null;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast ' + kind;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3800);
}

/* ---------- icônes (trait, 24px) ---------- */
const sv = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
export const I = {
  logo: '<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 27.5c0-3.6 5.2-4.2 5.2-8.3a5.2 5.2 0 1 0-10.4 0"/><path d="M32 27.5 13.4 41.2c-2 1.5-.9 4.6 1.6 4.6h34c2.5 0 3.6-3.1 1.6-4.6L32 27.5z"/><path d="M47.5 9.5l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4z" fill="#F3C55A" stroke="none"/></svg>',
  ticket: sv('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  users: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>'),
  cash: sv('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  search: sv('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  wa: sv('<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z"/>'),
  phone: sv('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  print: sv('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  tag: sv('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  bolt: sv('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  truck: sv('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  x: sv('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: sv('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  star: sv('<path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>'),
  logout: sv('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>'),
  shield: sv('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  chev: sv('<path d="M9 5l7 7-7 7"/>'),
  clock: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  qr: sv('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>'),
  wifiOff: sv('<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.2-1.6M1.5 9a15 15 0 0 1 4.3-2.8M22.5 9A15 15 0 0 0 10.7 5"/><circle cx="12" cy="20" r=".8" fill="currentColor"/>'),
  sync: sv('<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9M4 13a8 8 0 0 0 14.7 4.3L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>'),
  link: sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')
};
