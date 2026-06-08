// ============================================================
//  GREATLY House — Backend réservation
//  Google Apps Script · Un seul agenda, couleur par salle
// ============================================================

const CONFIG = {
  PASSWORD: 'Reservation2302',
  SECRET:   'GR34TLY_s3cr3t_2026',  // sert à signer les jetons d'annulation
  OWNER_EMAIL: 'arnaudprz@gmail.com',
  CALENDAR_ID: '0d81c7c7d0b29f3a210fca06e3ba949df1227ca297ca5011ae35e70de8e0e221@group.calendar.google.com',

  // Couleurs Google Calendar (index EventColor)
  // https://developers.google.com/apps-script/reference/calendar/event-color
  ROOMS: {
    bulle: { name: 'La Bulle',  color: CalendarApp.EventColor.SAGE,   prefix: '[Bulle]' },
    nid:   { name: 'Le Nid',    color: CalendarApp.EventColor.ORANGE, prefix: '[Nid]' },
    dojo:  { name: 'Le Dojo',   color: CalendarApp.EventColor.CYAN,   prefix: '[Dojo]' },
  },

  SLOTS: [13*60, 14*60+30, 16*60, 17*60+30],  // minutes depuis minuit
  SLOT_DURATION: 90,  // minutes
  CLOSE: 18*60+30,
};

// ---- Helpers ----

function pad(n) { return String(n).padStart(2, '0'); }

function fmtTime(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

function slotEnd(m) { return Math.min(m + CONFIG.SLOT_DURATION, CONFIG.CLOSE); }

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function hmac(message) {
  const signature = Utilities.computeHmacSha256Signature(message, CONFIG.SECRET);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
}

function makeToken(room, eventId) {
  return hmac(room + '|' + eventId);
}

// Récupère ou crée le label Gmail "Greatly" et l'applique au dernier email envoyé
function labelLastSentEmail(subject) {
  var label = GmailApp.getUserLabelByName('Greatly');
  if (!label) {
    label = GmailApp.createLabel('Greatly');
  }
  // Petite pause pour que le mail apparaisse dans les threads
  Utilities.sleep(1000);
  var threads = GmailApp.search('in:sent subject:"' + subject + '"', 0, 1);
  if (threads.length > 0) {
    label.addToThread(threads[0]);
    // Déplacer dans la boîte principale (retirer de l'archive si besoin)
    threads[0].moveToInbox();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCalendar() {
  return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
}

// ---- GET handler ----

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();

  if (action === 'availability') {
    return handleAvailability(e.parameter);
  }
  if (action === 'cancel') {
    return handleCancel(e.parameter);
  }
  if (action === 'checkpassword') {
    const pw = e.parameter.pw || '';
    return jsonResponse({ ok: pw === CONFIG.PASSWORD });
  }

  return jsonResponse({ ok: false, error: 'Action inconnue.' });
}

// ---- POST handler ----

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (_) {
    return jsonResponse({ ok: false, error: 'JSON invalide.' });
  }

  const action = (data.action || '').toLowerCase();

  if (action === 'checkpassword') {
    return jsonResponse({ ok: (data.pw || '') === CONFIG.PASSWORD });
  }
  if (action === 'availability') {
    return handleAvailability({ room: data.room, start: data.start });
  }
  if (action === 'book') {
    return handleBook(data);
  }
  if (action === 'privatisation') {
    return handlePrivatisation(data);
  }

  return jsonResponse({ ok: false, error: 'Action inconnue.' });
}

// ---- Availability ----

function handleAvailability(params) {
  const roomKey = (params.room || '').toLowerCase();
  const startStr = params.start || '';

  if (!CONFIG.ROOMS[roomKey]) {
    return jsonResponse({ ok: false, error: 'Espace inconnu.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) {
    return jsonResponse({ ok: false, error: 'Date invalide (YYYY-MM-DD).' });
  }

  const room = CONFIG.ROOMS[roomKey];
  const cal = getCalendar();
  const monday = parseDate(startStr);
  const days = [];

  for (let i = 0; i < 5; i++) {
    const date = addDays(monday, i);
    const dateStr = ymd(date);

    // Récupérer les événements de la journée pour cette salle
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const events = cal.getEvents(dayStart, dayEnd);
    // Filtrer les événements qui concernent cette salle (par le préfixe dans le titre)
    const roomEvents = events.filter(function(ev) {
      return ev.getTitle().indexOf(room.prefix) === 0;
    });

    const slots = CONFIG.SLOTS.map(function(slotStart) {
      const sStart = new Date(date);
      sStart.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
      const sEnd = new Date(date);
      const endMin = slotEnd(slotStart);
      sEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

      // Vérifier si un événement chevauche ce créneau
      const busy = roomEvents.some(function(ev) {
        return ev.getStartTime() < sEnd && ev.getEndTime() > sStart;
      });

      return { start: slotStart, busy: busy };
    });

    days.push({ date: dateStr, slots: slots });
  }

  return jsonResponse({ ok: true, days: days });
}

// ---- Book ----

function handleBook(data) {
  // Vérification mot de passe
  if (data.password !== CONFIG.PASSWORD) {
    return jsonResponse({ ok: false, error: 'Mot de passe incorrect.' });
  }

  const roomKey = (data.room || '').toLowerCase();
  if (!CONFIG.ROOMS[roomKey]) {
    return jsonResponse({ ok: false, error: 'Espace inconnu.' });
  }

  const room = CONFIG.ROOMS[roomKey];
  const dateStr = data.date || '';
  const slotStart = parseInt(data.start, 10);
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const tel = (data.tel || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return jsonResponse({ ok: false, error: 'Date invalide.' });
  }
  if (CONFIG.SLOTS.indexOf(slotStart) === -1) {
    return jsonResponse({ ok: false, error: 'Créneau invalide.' });
  }
  if (!name) return jsonResponse({ ok: false, error: 'Prénom requis.' });
  if (!email || email.indexOf('@') === -1) return jsonResponse({ ok: false, error: 'Email invalide.' });
  if (tel.replace(/\D/g, '').length < 8) return jsonResponse({ ok: false, error: 'Téléphone invalide.' });

  const date = parseDate(dateStr);
  const sStart = new Date(date);
  sStart.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
  const endMin = slotEnd(slotStart);
  const sEnd = new Date(date);
  sEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

  const cal = getCalendar();

  // Anti-double-réservation : re-vérifier la dispo
  const events = cal.getEvents(sStart, sEnd);
  const conflict = events.some(function(ev) {
    return ev.getTitle().indexOf(room.prefix) === 0;
  });
  if (conflict) {
    return jsonResponse({ ok: false, error: 'Ce créneau vient d\'être réservé par quelqu\'un d\'autre. Merci de choisir un autre créneau.' });
  }

  // Créer l'événement
  const title = room.prefix + ' ' + name;
  const event = cal.createEvent(title, sStart, sEnd, {
    description: 'Réservation GREATLY House\n'
      + 'Espace : ' + room.name + '\n'
      + 'Membre : ' + name + '\n'
      + 'Email : ' + email + '\n'
      + 'Tél : ' + tel,
    guests: email,
    sendInvites: false,
  });
  event.setColor(room.color);

  const eventId = event.getId();

  // Générer le jeton et le lien d'annulation
  const token = makeToken(roomKey, eventId);
  const scriptUrl = ScriptApp.getService().getUrl();
  const cancelUrl = scriptUrl + '?action=cancel&room=' + roomKey + '&id=' + encodeURIComponent(eventId) + '&t=' + token;

  // Formater les infos pour l'email
  const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const FR_MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dateLabel = DAY_NAMES[date.getDay()] + ' ' + date.getDate() + ' ' + FR_MONTH[date.getMonth()];
  const timeLabel = fmtTime(slotStart) + ' – ' + fmtTime(endMin);

  // Couleurs par salle pour l'email
  var accentColor = '#6B7D5C';
  var accentPale = '#CDD8BE';
  var accentDark = '#4f5e42';
  if (roomKey === 'nid') { accentColor = '#C0814E'; accentPale = '#EBD6BC'; accentDark = '#8f6035'; }
  if (roomKey === 'dojo') { accentColor = '#4F7C82'; accentPale = '#C2D8DA'; accentDark = '#3a5d62'; }

  // Lien Google Agenda
  var gcalStart = Utilities.formatDate(sStart, 'Europe/Paris', "yyyyMMdd'T'HHmmss");
  var gcalEnd = Utilities.formatDate(sEnd, 'Europe/Paris', "yyyyMMdd'T'HHmmss");
  var googleCalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(room.name + ' — GREATLY House')
    + '&dates=' + gcalStart + '/' + gcalEnd
    + '&details=' + encodeURIComponent('Votre créneau à la GREATLY House.')
    + '&location=' + encodeURIComponent('GREATLY House, 10 rue de Lambersart, Verlinghem');

  // Générer le fichier .ics
  var icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GREATLY//Reservation//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Paris:' + Utilities.formatDate(sStart, 'Europe/Paris', "yyyyMMdd'T'HHmmss"),
    'DTEND;TZID=Europe/Paris:' + Utilities.formatDate(sEnd, 'Europe/Paris', "yyyyMMdd'T'HHmmss"),
    'SUMMARY:' + room.name + ' — GREATLY House',
    'LOCATION:GREATLY House\\, 10 rue de Lambersart\\, Verlinghem',
    'DESCRIPTION:Votre créneau à la GREATLY House.',
    'STATUS:CONFIRMED',
    'UID:' + eventId,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  var icsBlob = Utilities.newBlob(icsContent, 'text/calendar', 'reservation-greatly.ics');

  // Email de confirmation au membre
  var htmlEmail = buildConfirmationEmail(name, room.name, dateLabel, timeLabel, accentColor, accentPale, accentDark, googleCalUrl, cancelUrl);

  GmailApp.sendEmail(email, 'Créneau réservé — ' + room.name + ' · ' + dateLabel,
    'Bonjour ' + name + ', votre créneau est confirmé : ' + room.name + ', ' + dateLabel + ' ' + timeLabel + '. GREATLY House, 10 rue de Lambersart, Verlinghem.',
    {
      htmlBody: htmlEmail,
      attachments: [icsBlob],
      name: 'GREATLY House',
      replyTo: CONFIG.OWNER_EMAIL,
    }
  );

  // Labelliser l'email de confirmation
  labelLastSentEmail('Créneau réservé — ' + room.name);

  // Copie pour l'équipe
  var sujetEquipe = '[Résa] ' + room.name + ' — ' + name + ' · ' + dateLabel;
  GmailApp.sendEmail(CONFIG.OWNER_EMAIL, sujetEquipe,
    'Nouvelle réservation :\n\n'
    + 'Espace : ' + room.name + '\n'
    + 'Date : ' + dateLabel + ' ' + timeLabel + '\n'
    + 'Membre : ' + name + '\n'
    + 'Email : ' + email + '\n'
    + 'Tél : ' + tel,
    { name: 'GREATLY Réservation' }
  );

  // Labelliser la copie équipe
  labelLastSentEmail(sujetEquipe);

  return jsonResponse({ ok: true, message: 'Créneau réservé !' });
}

// ---- Cancel ----

function handleCancel(params) {
  const roomKey = (params.room || '').toLowerCase();
  const eventId = params.id || '';
  const token = params.t || '';

  if (!CONFIG.ROOMS[roomKey]) {
    return jsonResponse({ ok: false, error: 'Espace inconnu.' });
  }

  // Vérifier le jeton
  const expected = makeToken(roomKey, eventId);
  if (token !== expected) {
    return ContentService.createTextOutput(cancelPage(false, 'Lien d\'annulation invalide ou expiré.'))
      .setMimeType(ContentService.MimeType.HTML);
  }

  const cal = getCalendar();
  try {
    const event = cal.getEventById(eventId);
    if (!event) {
      return ContentService.createTextOutput(cancelPage(false, 'Ce créneau a déjà été annulé ou n\'existe plus.'))
        .setMimeType(ContentService.MimeType.HTML);
    }

    const room = CONFIG.ROOMS[roomKey];
    const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const FR_MONTH = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const d = event.getStartTime();
    const dateLabel = DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + FR_MONTH[d.getMonth()];
    const desc = event.getDescription();

    event.deleteEvent();

    // Prévenir l'équipe
    var sujetAnnul = '[Annulation] ' + room.name + ' · ' + dateLabel;
    GmailApp.sendEmail(CONFIG.OWNER_EMAIL, sujetAnnul,
      'Annulation :\n' + room.name + ' — ' + dateLabel + '\n\n' + desc,
      { name: 'GREATLY Réservation' }
    );
    labelLastSentEmail(sujetAnnul);

    return ContentService.createTextOutput(cancelPage(true, 'Votre créneau ' + room.name + ' du ' + dateLabel + ' a bien été annulé. Il est de nouveau disponible.'))
      .setMimeType(ContentService.MimeType.HTML);

  } catch (err) {
    return ContentService.createTextOutput(cancelPage(false, 'Erreur lors de l\'annulation. Contactez-nous sur WhatsApp.'))
      .setMimeType(ContentService.MimeType.HTML);
  }
}

// ---- Privatisation ----

function handlePrivatisation(data) {
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const tel = (data.tel || '').trim();
  const need = (data.need || '').trim();
  const date = (data.date || '').trim();
  const nb = (data.nb || '').toString().trim();

  if (!name) return jsonResponse({ ok: false, error: 'Prénom requis.' });
  if (!email) return jsonResponse({ ok: false, error: 'Email requis.' });

  var sujetPrivat = 'Demande de privatisation — ' + name;
  GmailApp.sendEmail(CONFIG.OWNER_EMAIL,
    sujetPrivat,
    'Nouvelle demande de privatisation :\n\n'
    + 'Prénom : ' + name + '\n'
    + 'Email : ' + email + '\n'
    + 'Téléphone : ' + tel + '\n'
    + 'Date souhaitée : ' + date + '\n'
    + 'Nombre de personnes : ' + nb + '\n\n'
    + 'Besoin :\n' + need,
    { name: 'GREATLY Réservation', replyTo: email }
  );
  labelLastSentEmail(sujetPrivat);

  return jsonResponse({ ok: true, message: 'Demande envoyée !' });
}

// ---- Email HTML de confirmation ----

function buildConfirmationEmail(prenom, salle, date, horaire, accent, accentPale, accentDark, lienGoogle, lienAnnulation) {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>'
  + '<body style="margin:0;padding:24px 12px;background:#EDE8E0;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
  + '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">C\'est réservé ! ' + salle + ' — ' + date + ', ' + horaire + '. On vous attend à la GREATLY House.</div>'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;"><tr><td>'
  // En-tête
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 18px;">'
  + '<span style="font-size:18px;font-weight:700;letter-spacing:-.3px;color:#6B7D5C;">GREAT<span style="color:#1A1A1A;">LY</span></span>'
  + '<span style="font-size:18px;font-weight:600;color:#6B6460;">&nbsp;House</span>'
  + '</td></tr></table>'
  // Carte
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid #E7E1D7;">'
  + '<tr><td style="height:6px;background:' + accent + ';font-size:0;line-height:0;">&nbsp;</td></tr>'
  + '<tr><td style="padding:32px 30px 8px;text-align:center;">'
  + '<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="width:56px;height:56px;background:' + accentPale + ';border-radius:50%;text-align:center;vertical-align:middle;font-size:28px;color:' + accentDark + ';">&#10003;</td></tr></table>'
  + '<h1 style="margin:18px 0 4px;font-size:23px;color:#1A1A1A;font-weight:700;">C\'est réservé&nbsp;!</h1>'
  + '<p style="margin:0;color:#6B6460;font-size:15px;line-height:1.5;">Bonjour <strong>' + prenom + '</strong>, votre créneau est confirmé.<br>On a hâte de vous accueillir à la maison.</p>'
  + '</td></tr>'
  // Récap
  + '<tr><td style="padding:22px 30px 6px;">'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;border-radius:14px;"><tr><td style="padding:18px 20px;">'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
  + '<tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Espace</td></tr>'
  + '<tr><td style="font-size:18px;font-weight:700;color:#1A1A1A;padding-bottom:14px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + accent + ';margin-right:8px;"></span>' + salle + '</td></tr>'
  + '<tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Date & horaire</td></tr>'
  + '<tr><td style="font-size:15px;color:#1A1A1A;font-weight:600;padding-bottom:14px;">' + date + ' · ' + horaire + '</td></tr>'
  + '<tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Lieu</td></tr>'
  + '<tr><td style="font-size:15px;color:#1A1A1A;font-weight:600;">GREATLY House — 10 rue de Lambersart, Verlinghem</td></tr>'
  + '</table></td></tr></table></td></tr>'
  // Boutons
  + '<tr><td style="padding:20px 30px 6px;text-align:center;">'
  + '<a href="' + lienGoogle + '" style="display:block;background:' + accent + ';color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 20px;border-radius:12px;">Ajouter à Google Agenda</a>'
  + '</td></tr>'
  // Info
  + '<tr><td style="padding:14px 30px 4px;text-align:center;">'
  + '<p style="margin:0;color:#9c958b;font-size:13px;line-height:1.5;">Une invitation est aussi jointe à ce mail : Gmail vous proposera de l\'ajouter directement.</p>'
  + '</td></tr>'
  // Annulation
  + '<tr><td style="padding:18px 30px 0;text-align:center;">'
  + '<p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Un empêchement&nbsp;? <a href="' + lienAnnulation + '" style="color:' + accent + ';font-weight:700;text-decoration:underline;">Annuler ce créneau</a> — il sera aussitôt libéré pour un autre membre.</p>'
  + '</td></tr>'
  // Contact
  + '<tr><td style="padding:12px 30px 28px;text-align:center;">'
  + '<p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Une question&nbsp;? Écrivez-nous sur WhatsApp au <a href="https://wa.me/33651156344" style="color:' + accent + ';font-weight:700;text-decoration:none;white-space:nowrap;">06&nbsp;51&nbsp;15&nbsp;63&nbsp;44</a>.</p>'
  + '</td></tr>'
  + '</table>'
  // Pied
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 16px 8px;">'
  + '<p style="margin:0;color:#9c958b;font-size:12px;line-height:1.6;">GREATLY House · Votre lieu pour vous mettre au vert et souffler.<br>10 rue de Lambersart, Verlinghem · Lun–Ven, 13h–18h30</p>'
  + '</td></tr></table>'
  + '</td></tr></table></body></html>';
}

// ---- Page HTML d'annulation (résultat) ----

function cancelPage(success, message) {
  var color = success ? '#6B7D5C' : '#b4533f';
  var icon = success ? '✓' : '✗';
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Annulation · GREATLY</title></head>'
  + '<body style="margin:0;padding:40px 20px;background:#F7F4EF;font-family:\'Helvetica Neue\',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
  + '<div style="background:#fff;border-radius:20px;padding:40px 32px;max-width:420px;text-align:center;border:1px solid #E7E1D7;">'
  + '<div style="width:56px;height:56px;border-radius:50%;background:' + (success ? '#CDD8BE' : '#f5d5cf') + ';color:' + color + ';display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px;">' + icon + '</div>'
  + '<h1 style="font-size:20px;color:#1A1A1A;margin:0 0 10px;">' + (success ? 'Créneau annulé' : 'Erreur') + '</h1>'
  + '<p style="color:#6B6460;font-size:15px;line-height:1.5;margin:0 0 24px;">' + message + '</p>'
  + '<a href="https://wa.me/33651156344" style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;font-size:15px;">Nous contacter</a>'
  + '</div></body></html>';
}
