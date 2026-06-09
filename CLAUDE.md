# CLAUDE.md — Projet réservation GREATLY House

Document de passation pour finir la **version connectée** de la page de réservation.
La maquette front-end est terminée et validée. Il reste à brancher le backend
(Google Apps Script + 3 agendas Google) et à déployer.

## 1. Contexte

GREATLY House est un lieu pour membres à Verlinghem (programme d'accompagnement
dirigeants : énergie + lucidité). Les membres peuvent réserver des espaces du
**lundi au vendredi, 13h–18h30** (hors vacances scolaires zone B / Lille).

Espaces réservables (1 agenda Google chacun) :
- **La Bulle** — petit salon, appels visio & concentration, 1–3 pers. — couleur `#6B7D5C`
- **Le Nid** — petit salon, réunions & points d'équipe, 1–3 pers. — couleur `#C0814E`
- **Le Dojo** — salle de sport, séances & mobilité, 3 pers. max — couleur `#4F7C82`

## 2. Décisions déjà prises (ne pas refaire le débat)

- **Site séparé** du site principal (greatly.club), sur sa propre URL (cible : `reserver.greatly.club`).
- **Accès par mot de passe** membre unique (pas de comptes individuels).
- **Confidentialité** : on affiche seulement « disponible / réservé », **jamais qui a réservé**.
  → côté backend, l'endpoint `availability` ne renvoie que des booléens busy/free.
- **Créneaux de 1h30**, 13h00 → 18h30.
- **Pas de profil membre**, **pas de limite** de réservation pour l'instant.
- **Annulation** via un lien sécurisé (jeton) dans l'email de confirmation.
- **Privatisation** = simple demande envoyée par mail à arnaudprz@gmail.com.
- Bandeau de privatisation distinct + bulle WhatsApp (06 51 15 63 44 → wa.me/33651156344).
- Charte : police DM Sans, fond crème `#F7F4EF`, encre `#1A1A1A`.

## 3. Fichiers

```
index.html                  Front-end (maquette fonctionnelle, données fictives)
email-confirmation.html     Aperçu du modèle d'email (référence visuelle)
backend/Code.gs             Backend Apps Script (availability / book / cancel / privatisation)
backend/appsscript.json     Manifeste (scopes Calendar + Gmail, web app)
backend/.clasp.json.example Exemple de config clasp
README.md                   Présentation + checklist
```

## 4. Étapes pour finir (dans l'ordre)

### Étape A — Créer les 3 agendas Google
Dans Google Agenda du compte propriétaire, créer 3 agendas :
« GREATLY — La Bulle », « GREATLY — Le Nid », « GREATLY — Le Dojo ».
Pour chacun : Paramètres → « Intégrer l'agenda » → copier l'**ID de l'agenda**
(`...@group.calendar.google.com`). Les renseigner dans `CONFIG.ROOMS` de `Code.gs`.

### Étape B — Déployer le backend Apps Script
1. `script.google.com` → Nouveau projet. Coller `Code.gs`. Remplacer le contenu du
   manifeste par `backend/appsscript.json` (activer « Afficher appsscript.json » dans Paramètres).
   - (Option : utiliser `clasp` avec `.clasp.json` à partir de l'exemple.)
2. Dans `CONFIG`, remplir : `PASSWORD`, `SECRET` (chaîne aléatoire), `OWNER_EMAIL`,
   et les `calendarId` des 3 espaces.
3. Déployer → Nouveau déploiement → **Application Web**
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
4. Autoriser les scopes (Calendar + Gmail) à la première exécution.
5. Copier l'URL `…/exec` → c'est l'`API_URL` du front.
6. Tester l'URL : `…/exec?action=availability&room=bulle&start=2026-06-08` doit
   renvoyer du JSON.

### Étape C — Brancher le front-end (`index.html`)
Voir les marqueurs `// TODO(API)` dans le `<script>`. Il y a 3 points :

1. **Config** — en haut du script, ajouter :
   ```js
   const API_URL = ""; // si vide => mode démo (données fictives actuelles)
   ```
2. **Disponibilités** — remplacer la fonction fictive `isBusy(...)` / la logique de
   `renderSlots` par un appel réel quand `API_URL` est défini :
   ```js
   async function fetchAvailability(roomKey, mondayDate){
     const res = await fetch(`${API_URL}?action=availability&room=${roomKey}&start=${ymd(mondayDate)}`);
     return (await res.json()).days; // [{date, slots:[{start, busy}]}]
   }
   ```
   Garder `closeReason()` (vacances/fériés) côté front : ces jours ne sont même pas
   à interroger. Pour les jours ouvrés, utiliser `busy` renvoyé par l'API.
3. **Confirmation de réservation** — dans `confirmBooking(...)`, après validation des
   champs, POSTer au backend AVANT d'afficher l'écran de succès :
   ```js
   const r = await fetch(API_URL, {
     method: 'POST',
     headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // évite le préflight CORS
     body: JSON.stringify({ action:'book', password: PASSWORD, room: current,
       date: ymd(weekDates()[di]), start: SLOTS[si], name, email: mail, tel })
   });
   const data = await r.json();
   if(!data.ok){ showErr(err, data.error); return; } // ex. créneau déjà pris
   ```
   Idem pour `sendPrivat()` → POST `action:'privatisation'` (au lieu du `mailto:`),
   pour ne plus dépendre du client mail de l'utilisateur.

   ⚠️ Le mot de passe est désormais **vérifié côté serveur** (`CONFIG.PASSWORD`).
   Conserver l'écran d'accès front pour l'UX, mais c'est le backend qui fait foi.

### Étape D — Mise en production
- Retirer le bandeau `.demo-badge` et le `gate-hint` (« tape GREATLY ») de `index.html`.
- Héberger `index.html` sur l'URL dédiée (sous-domaine `reserver.greatly.club` via le
  même hébergeur que le site, ou Netlify/GitHub Pages séparé).
- Vérifier l'envoi des emails (quota Gmail : ~100/jour en compte gratuit, large).

## 5. Comportement attendu du backend (déjà codé dans Code.gs)

- `GET ?action=availability&room=&start=` → `{ok, days:[{date, slots:[{start,busy}]}]}` (sans noms).
- `POST {action:'book', ...}` → revérifie la dispo (anti-doublon), crée l'événement
  dans l'agenda de l'espace, **invite le membre** (ajout auto à son agenda),
  envoie l'email de confirmation (HTML + `.ics` + lien Google Agenda + lien d'annulation),
  et envoie une copie à l'équipe.
- `GET ?action=cancel&room=&id=&t=` → vérifie le jeton, supprime l'événement, prévient l'équipe.
- `POST {action:'privatisation', ...}` → email de demande à l'équipe.

## 6. Données de référence

- Horaires : 13:00–18:30, créneaux 90 min → 13:00, 14:30, 16:00, 17:30 (dernier 17:30–18:30).
- Jours ouvrés : lundi → vendredi.
- Vacances scolaires zone B + jours fériés : listes dans `index.html`
  (`HOLIDAYS`, `JOURS_FERIES`, `FERMETURES`). `FERMETURES` = fermetures ponctuelles à
  compléter par Arnaud. À maintenir chaque année scolaire.

## 7. Idées d'évolution (non demandées pour l'instant)

- Rappel automatique la veille du créneau.
- Limite de réservation par membre si abus.
- Page « Mes réservations » par magic-link.
- Champ « nombre de personnes » sur la réservation des salons.
