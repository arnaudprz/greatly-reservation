# GREATLY House — Réservation des espaces

Page de réservation pour les membres de la GREATLY House (Verlinghem).
Permet de réserver les espaces et d'envoyer une demande de privatisation.

## Espaces

- **La Bulle** — petit salon côté nature · appels visio & concentration · 1 à 3 personnes
- **Le Nid** — petit salon côté nature · réunions & points d'équipe · 1 à 3 personnes
- **Le Dojo** — salle de sport · séances, mobilité & étirements · 3 personnes max

## Caractéristiques

- Accès protégé par mot de passe membre
- Ouvert du lundi au vendredi, 13h–18h30
- Créneaux de 1h30
- Vacances scolaires (zone B / Lille) et jours fériés bloqués automatiquement
- Disponibilités affichées sans révéler qui a réservé (confidentialité)
- Couleur dédiée par espace, design mobile-first
- Formulaire de réservation (prénom, email, téléphone) avec validation
- Bandeau de privatisation (demande envoyée par mail)
- Bulle WhatsApp de contact

## Fichiers

- `index.html` — page de réservation (maquette, données fictives)
- `email-confirmation.html` — modèle d'email de confirmation (ajout agenda + annulation)

## État

Maquette validée. Prochaine étape : version connectée
(Google Apps Script + 3 agendas Google + envoi des mails + URL dédiée).

### À faire pour la mise en production

- [ ] Mot de passe vérifié côté serveur
- [ ] 3 agendas Google (un par espace) + lecture des dispos via FreeBusy
- [ ] Création de l'événement à la réservation + email de confirmation (.ics + lien Google Agenda)
- [ ] Anti-double-réservation (re-vérification FreeBusy avant écriture)
- [ ] Lien d'annulation sécurisé (jeton) qui libère le créneau
- [ ] Copie des réservations pour l'équipe
- [ ] Retrait du badge « Maquette »
