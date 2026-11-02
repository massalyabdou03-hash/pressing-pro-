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
- **Lots** : le gérant regroupe les tickets lavés ensemble dans un lot numéroté (Lot 001…). « En lavage » / « Prêt » sur le lot change l'état de tous ses tickets d'un coup (marche aussi hors connexion). Un ticket est dans un seul lot à la fois.
- **Paiements** : chaque paiement reçoit un numéro (P-00001…) donné par la base. Une erreur ne s'efface pas : le gérant annule le paiement, qui reste visible, barré, avec la raison. Annuler un ticket annule aussi ses paiements.
- **Rôles** : seul le gérant crée les lots, annule tickets et paiements, et modifie le catalogue. Le code d'équipe (8 caractères, 5 essais par heure) change tout seul quand un employé est retiré.

## Base de données

Les changements de structure sont dans `db/`, à appliquer dans l'ordre sur le projet Supabase **avant** de publier le code qui en dépend.

## À régler

- `assets/config.js` : mets ton numéro dans `SUPPORT_PHONE` pour que les pressings puissent te payer et te contacter.
- Supabase › Authentication › URL Configuration : mets l'adresse du site dans « Site URL » pour que les liens des emails (confirmation, mot de passe oublié) ramènent sur l'app.
