# Pressing Pro

Logiciel en ligne (SaaS) de gestion de pressing pour le Sénégal : tickets, clients, caisse Wave / Orange Money, messages WhatsApp, suivi en ligne pour les clients, page d'administration de la plateforme.

## Pages

| Fichier | Rôle |
|---|---|
| `index.html` | Page vitrine (présentation, prix, inscription) |
| `app.html` | L'application des pressings (gérant et employés) |
| `admin.html` | Ton tableau de bord : tous les pressings, abonnements, relances |
| `suivi.html` | Page publique de suivi d'un ticket (lien WhatsApp et QR code) |

Le code JavaScript est dans `assets/` : `core.js` (outils communs), `app.js` (l'app), `admin.js` (l'admin), `config.js` (réglages publics).

## Fonctionnement

- Pas d'étape de build : ce sont des fichiers statiques, publiés tels quels sur Vercel (projet « pressing-pro-sn », redéployé à chaque push sur main).
- Les données sont dans Supabase (projet « Pressing Pro »). Chaque pressing ne voit que ses données grâce aux règles de sécurité (RLS) de la base.
- Abonnement : 30 jours d'essai, puis l'admin prolonge l'accès (+1 mois, +3 mois) après réception du paiement Wave / OM. Sans abonnement, l'app passe en lecture seule.
- L'accès admin est réservé aux emails listés dans la table `platform_admins`.

## À régler

- `assets/config.js` : mets ton numéro dans `SUPPORT_PHONE` pour que les pressings puissent te payer et te contacter.
- Supabase › Authentication › URL Configuration : mets l'adresse du site dans « Site URL » pour que les liens des emails (confirmation, mot de passe oublié) ramènent sur l'app.
