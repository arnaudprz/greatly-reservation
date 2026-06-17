var PASSWORD = 'Reservation2302';
var SECRET = 'GR34TLY_s3cr3t_2026';
var OWNER_EMAIL = 'arnaudprz@gmail.com';
var CALENDAR_ID = '0d81c7c7d0b29f3a210fca06e3ba949df1227ca297ca5011ae35e70de8e0e221@group.calendar.google.com';
var ROOMS = {
  bulle: {name:'La Bulle', color:'2', prefix:'[Bulle]'},
  nid: {name:'Le Nid', color:'6', prefix:'[Nid]'},
  dojo: {name:'Le Dojo', color:'7', prefix:'[Dojo]'}
};
var PRESENCE_PREFIX = 'Maison:';
var SLOTS = [780, 870, 960, 1050];
var SLOT_DURATION = 90;
var CLOSE_MIN = 1110;

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function slotEndMin(m) { return Math.min(m + SLOT_DURATION, CLOSE_MIN); }

function parseDate(str) {
  var parts = str.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(d, n) {
  var x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function hmac(message) {
  var signature = Utilities.computeHmacSha256Signature(message, SECRET);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
}

function makeToken(room, eventId) {
  return hmac(room + '|' + eventId);
}

function labelLastSentEmail(subject) {
  var label = GmailApp.getUserLabelByName('Greatly');
  if (!label) { label = GmailApp.createLabel('Greatly'); }
  Utilities.sleep(1000);
  var threads = GmailApp.search('in:sent subject:"' + subject + '"', 0, 1);
  if (threads.length > 0) {
    label.addToThread(threads[0]);
    threads[0].moveToInbox();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCal() {
  return CalendarApp.getCalendarById(CALENDAR_ID);
}

function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();
  if (action === 'availability') { return handleAvailability(e.parameter); }
  if (action === 'cancel') { return handleCancel(e.parameter); }
  if (action === 'checkpassword') { return jsonOut({ok: (e.parameter.pw || '') === PASSWORD}); }
  if (action === 'book') { return handleBook(e.parameter); }
  if (action === 'maison') { return handleMaison(e.parameter); }
  if (action === 'privatisation') { return handlePrivatisation(e.parameter); }
  if (action === 'absence') { return handleAbsence(e.parameter); }
  return jsonOut({ok: false, error: 'Action inconnue.'});
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch(err) { return jsonOut({ok:false, error:'JSON invalide.'}); }
  var action = (data.action || '').toLowerCase();
  if (action === 'checkpassword') { return jsonOut({ok: (data.pw || '') === PASSWORD}); }
  if (action === 'availability') { return handleAvailability({room: data.room, start: data.start}); }
  if (action === 'book') { return handleBook(data); }
  if (action === 'maison') { return handleMaison(data); }
  if (action === 'privatisation') { return handlePrivatisation(data); }
  if (action === 'absence') { return handleAbsence(data); }
  return jsonOut({ok: false, error: 'Action inconnue.'});
}

function handleAvailability(params) {
  var roomKey = (params.room || '').toLowerCase();
  var startStr = params.start || '';
  if (!ROOMS[roomKey]) { return jsonOut({ok:false, error:'Espace inconnu.'}); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) { return jsonOut({ok:false, error:'Date invalide.'}); }
  var room = ROOMS[roomKey];
  var cal = getCal();
  var monday = parseDate(startStr);
  var days = [];
  for (var i = 0; i < 5; i++) {
    var date = addDays(monday, i);
    var dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    var dayEnd = new Date(date); dayEnd.setHours(23,59,59,999);
    var events = cal.getEvents(dayStart, dayEnd);
    var roomEvents = [];
    for (var j = 0; j < events.length; j++) {
      if (events[j].getTitle().indexOf(room.prefix) === 0) roomEvents.push(events[j]);
    }
    var slots = [];
    for (var k = 0; k < SLOTS.length; k++) {
      var ss = new Date(date); ss.setHours(Math.floor(SLOTS[k]/60), SLOTS[k]%60, 0, 0);
      var se = new Date(date); var em = slotEndMin(SLOTS[k]); se.setHours(Math.floor(em/60), em%60, 0, 0);
      var busy = false;
      for (var r = 0; r < roomEvents.length; r++) {
        if (roomEvents[r].getStartTime() < se && roomEvents[r].getEndTime() > ss) { busy = true; break; }
      }
      slots.push({start: SLOTS[k], busy: busy});
    }
    var presence = null;
    for (var p = 0; p < events.length; p++) {
      var t = events[p].getTitle();
      if (t.indexOf(PRESENCE_PREFIX) === 0) { presence = t.substring(PRESENCE_PREFIX.length).trim(); break; }
    }
    days.push({date: ymd(date), slots: slots, presence: presence});
  }
  return jsonOut({ok:true, days:days});
}

function handleBook(data) {
  if (data.password !== PASSWORD) { return jsonOut({ok:false, error:'Mot de passe incorrect.'}); }
  var roomKey = (data.room || '').toLowerCase();
  if (!ROOMS[roomKey]) { return jsonOut({ok:false, error:'Espace inconnu.'}); }
  var room = ROOMS[roomKey];
  var dateStr = data.date || '';
  var slotStart = parseInt(data.start, 10);
  var name = (data.name || '').trim();
  var email = (data.email || '').trim();
  var tel = (data.tel || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { return jsonOut({ok:false, error:'Date invalide.'}); }
  var validSlot = false;
  for (var i = 0; i < SLOTS.length; i++) { if (SLOTS[i] === slotStart) validSlot = true; }
  if (!validSlot) { return jsonOut({ok:false, error:'Creneau invalide.'}); }
  if (!name) { return jsonOut({ok:false, error:'Prenom requis.'}); }
  if (!email || email.indexOf('@') === -1) { return jsonOut({ok:false, error:'Email invalide.'}); }
  if (tel.replace(/\D/g,'').length < 8) { return jsonOut({ok:false, error:'Telephone invalide.'}); }
  var date = parseDate(dateStr);
  var sStart = new Date(date); sStart.setHours(Math.floor(slotStart/60), slotStart%60, 0, 0);
  var endMin = slotEndMin(slotStart);
  var sEnd = new Date(date); sEnd.setHours(Math.floor(endMin/60), endMin%60, 0, 0);
  var cal = getCal();
  var events = cal.getEvents(sStart, sEnd);
  for (var j = 0; j < events.length; j++) {
    if (events[j].getTitle().indexOf(room.prefix) === 0) {
      return jsonOut({ok:false, error:'Ce creneau vient d etre reserve. Choisissez un autre creneau.'});
    }
  }
  var title = room.prefix + ' ' + name;
  var event = cal.createEvent(title, sStart, sEnd, {
    description: 'Reservation GREATLY House\nEspace : ' + room.name + '\nMembre : ' + name + '\nEmail : ' + email + '\nTel : ' + tel,
    guests: email,
    sendInvites: false
  });
  event.setColor(room.color);
  var eventId = event.getId();
  var token = makeToken(roomKey, eventId);
  var scriptUrl = ScriptApp.getService().getUrl();
  var cancelUrl = scriptUrl + '?action=cancel&room=' + roomKey + '&id=' + encodeURIComponent(eventId) + '&t=' + token;
  var DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  var FR_MONTH = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  var dateLabel = DAY_NAMES[date.getDay()] + ' ' + date.getDate() + ' ' + FR_MONTH[date.getMonth()];
  var timeLabel = fmtTime(slotStart) + ' - ' + fmtTime(endMin);
  var accentColor = '#6B7D5C'; var accentPale = '#CDD8BE'; var accentDark = '#4f5e42';
  if (roomKey === 'nid') { accentColor = '#C0814E'; accentPale = '#EBD6BC'; accentDark = '#8f6035'; }
  if (roomKey === 'dojo') { accentColor = '#4F7C82'; accentPale = '#C2D8DA'; accentDark = '#3a5d62'; }
  var gcalStart = Utilities.formatDate(sStart, 'Europe/Paris', "yyyyMMdd'T'HHmmss");
  var gcalEnd = Utilities.formatDate(sEnd, 'Europe/Paris', "yyyyMMdd'T'HHmmss");
  var googleCalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(room.name + ' - GREATLY House') + '&dates=' + gcalStart + '/' + gcalEnd + '&details=' + encodeURIComponent('Votre creneau a la GREATLY House.') + '&location=' + encodeURIComponent('GREATLY House, 10 rue de Lambersart, Verlinghem');
  var icsContent = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GREATLY//Reservation//FR\r\nCALSCALE:GREGORIAN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nDTSTART;TZID=Europe/Paris:' + gcalStart + '\r\nDTEND;TZID=Europe/Paris:' + gcalEnd + '\r\nSUMMARY:' + room.name + ' - GREATLY House\r\nLOCATION:GREATLY House\\, 10 rue de Lambersart\\, Verlinghem\r\nDESCRIPTION:Votre creneau a la GREATLY House.\r\nSTATUS:CONFIRMED\r\nUID:' + eventId + '\r\nEND:VEVENT\r\nEND:VCALENDAR';
  var icsBlob = Utilities.newBlob(icsContent, 'text/calendar', 'reservation-greatly.ics');
  var htmlEmail = buildEmail(name, room.name, dateLabel, timeLabel, accentColor, accentPale, accentDark, googleCalUrl, cancelUrl);
  GmailApp.sendEmail(email, 'Creneau reserve - ' + room.name + ' - ' + dateLabel, 'Bonjour ' + name + ', votre creneau est confirme : ' + room.name + ', ' + dateLabel + ' ' + timeLabel + '. GREATLY House, 10 rue de Lambersart, Verlinghem.', {htmlBody: htmlEmail, attachments: [icsBlob], name: 'GREATLY House', replyTo: OWNER_EMAIL});
  labelLastSentEmail('Creneau reserve - ' + room.name);
  var sujetEquipe = '[Resa] ' + room.name + ' - ' + name + ' - ' + dateLabel;
  GmailApp.sendEmail(OWNER_EMAIL, sujetEquipe, 'Nouvelle reservation :\n\nEspace : ' + room.name + '\nDate : ' + dateLabel + ' ' + timeLabel + '\nMembre : ' + name + '\nEmail : ' + email + '\nTel : ' + tel, {name: 'GREATLY Reservation'});
  labelLastSentEmail(sujetEquipe);
  return jsonOut({ok:true, message:'Creneau reserve !'});
}

function handleCancel(params) {
  var roomKey = (params.room || '').toLowerCase();
  var eventId = params.id || '';
  var token = params.t || '';
  if (!ROOMS[roomKey]) { return jsonOut({ok:false, error:'Espace inconnu.'}); }
  var expected = makeToken(roomKey, eventId);
  if (token !== expected) {
    return ContentService.createTextOutput(cancelPage(false, 'Lien d annulation invalide ou expire.')).setMimeType(ContentService.MimeType.HTML);
  }
  var cal = getCal();
  try {
    var event = cal.getEventById(eventId);
    if (!event) {
      return ContentService.createTextOutput(cancelPage(false, 'Ce creneau a deja ete annule.')).setMimeType(ContentService.MimeType.HTML);
    }
    var room = ROOMS[roomKey];
    var DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    var FR_MONTH = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
    var d = event.getStartTime();
    var dateLabel = DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + FR_MONTH[d.getMonth()];
    var desc = event.getDescription();
    event.deleteEvent();
    var sujetAnnul = '[Annulation] ' + room.name + ' - ' + dateLabel;
    GmailApp.sendEmail(OWNER_EMAIL, sujetAnnul, 'Annulation :\n' + room.name + ' - ' + dateLabel + '\n\n' + desc, {name: 'GREATLY Reservation'});
    labelLastSentEmail(sujetAnnul);
    return ContentService.createTextOutput(cancelPage(true, 'Votre creneau ' + room.name + ' du ' + dateLabel + ' a bien ete annule.')).setMimeType(ContentService.MimeType.HTML);
  } catch(err) {
    return ContentService.createTextOutput(cancelPage(false, 'Erreur. Contactez-nous sur WhatsApp.')).setMimeType(ContentService.MimeType.HTML);
  }
}

function handlePrivatisation(data) {
  var name = (data.name || '').trim();
  var email = (data.email || '').trim();
  var tel = (data.tel || '').trim();
  var need = (data.need || '').trim();
  var date = (data.date || '').trim();
  var nb = (data.nb || '').toString().trim();
  if (!name) { return jsonOut({ok:false, error:'Prenom requis.'}); }
  if (!email) { return jsonOut({ok:false, error:'Email requis.'}); }
  var sujet = 'Demande de privatisation - ' + name;
  GmailApp.sendEmail(OWNER_EMAIL, sujet, 'Nouvelle demande de privatisation :\n\nPrenom : ' + name + '\nEmail : ' + email + '\nTelephone : ' + tel + '\nDate souhaitee : ' + date + '\nNombre de personnes : ' + nb + '\n\nBesoin :\n' + need, {name: 'GREATLY Reservation', replyTo: email});
  labelLastSentEmail(sujet);
  return jsonOut({ok:true, message:'Demande envoyee !'});
}

function handleAbsence(data) {
  var name = (data.name || '').trim();
  var email = (data.email || '').trim();
  var tel = (data.tel || '').trim();
  var atelier = (data.atelier || '').trim();
  var sport = (data.sport || '').trim();
  var date = (data.date || '').trim();
  if (!name) { return jsonOut({ok:false, error:'Prenom requis.'}); }
  if (!email) { return jsonOut({ok:false, error:'Email requis.'}); }
  var sujet = 'Absence signalee - ' + name + (atelier ? ' (' + atelier + ')' : '');
  var corps = 'Un membre signale une absence :\n\n'
    + 'Prenom : ' + name + '\n'
    + 'Email : ' + email + '\n'
    + 'Telephone : ' + tel + '\n'
    + 'Atelier : ' + (atelier || 'non precise') + '\n'
    + (sport ? 'Sport : ' + sport + '\n' : '')
    + (date ? 'Date : ' + date + '\n' : '');
  var destinataires = OWNER_EMAIL + ',juhou00@gmail.com,tomalex59@hotmail.fr,claire.laloyaux59@gmail.com';
  GmailApp.sendEmail(destinataires, sujet, corps, {name: 'GREATLY Reservation', replyTo: email});
  labelLastSentEmail(sujet);
  return jsonOut({ok:true, message:'Absence signalee !'});
}

function handleMaison(data) {
  var dateStr = data.date || '';
  var name = (data.name || '').trim();
  var email = (data.email || '').trim();
  var tel = (data.tel || '').trim();
  if (!name) { return jsonOut({ok:false, error:'Prenom requis.'}); }
  if (!email || email.indexOf('@') === -1) { return jsonOut({ok:false, error:'Email invalide.'}); }
  if (tel.replace(/\D/g,'').length < 8) { return jsonOut({ok:false, error:'Telephone invalide.'}); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { return jsonOut({ok:false, error:'Date invalide.'}); }
  var date = parseDate(dateStr);
  var cal = getCal();
  var event = cal.createAllDayEvent('A la maison - ' + name, date, {
    description: 'Passage a la GREATLY House\nPrenom : ' + name + '\nEmail : ' + email + '\nTelephone : ' + tel
  });
  event.setColor('2');
  var DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  var FR_MONTH = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  var dateLabel = DAY_NAMES[date.getDay()] + ' ' + date.getDate() + ' ' + FR_MONTH[date.getMonth()];
  // Email de confirmation au visiteur
  var htmlVisiteur = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:24px 12px;background:#EDE8E0;font-family:Helvetica Neue,Arial,sans-serif;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;"><tr><td>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 18px;">'
    + '<span style="font-size:18px;font-weight:700;letter-spacing:-.3px;color:#6B7D5C;">GREAT<span style="color:#1A1A1A;">LY</span></span>'
    + '<span style="font-size:18px;font-weight:600;color:#6B6460;"> House</span></td></tr></table>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid #E7E1D7;">'
    + '<tr><td style="height:6px;background:#4f5e42;font-size:0;line-height:0;"> </td></tr>'
    + '<tr><td style="padding:32px 30px 8px;text-align:center;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="width:56px;height:56px;background:#CDD8BE;border-radius:50%;text-align:center;vertical-align:middle;font-size:28px;color:#4f5e42;">&#10003;</td></tr></table>'
    + '<h1 style="margin:18px 0 4px;font-size:23px;color:#1A1A1A;font-weight:700;">C\'est note !</h1>'
    + '<p style="margin:0;color:#6B6460;font-size:15px;line-height:1.5;">Bonjour <strong>' + name + '</strong>, votre passage est bien enregistre.<br>On a hate de vous accueillir a la maison.</p>'
    + '</td></tr>'
    + '<tr><td style="padding:22px 30px 6px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;border-radius:14px;"><tr><td style="padding:18px 20px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
    + '<tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Quand</td></tr>'
    + '<tr><td style="font-size:18px;font-weight:700;color:#1A1A1A;padding-bottom:14px;">' + dateLabel + '</td></tr>'
    + '<tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Lieu</td></tr>'
    + '<tr><td style="font-size:15px;color:#1A1A1A;font-weight:600;">GREATLY House - 10 rue de Lambersart, Verlinghem</td></tr>'
    + '</table></td></tr></table></td></tr>'
    + '<tr><td style="padding:18px 30px 0;text-align:center;">'
    + '<p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Pas besoin de reserver une salle, je serai la pour papoter, prendre un cafe ou echanger.</p>'
    + '</td></tr>'
    + '<tr><td style="padding:12px 30px 28px;text-align:center;">'
    + '<p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Une question ? Ecrivez-nous sur WhatsApp au <a href="https://wa.me/33651156344" style="color:#4f5e42;font-weight:700;text-decoration:none;">06 51 15 63 44</a>.</p>'
    + '</td></tr></table>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 16px 8px;">'
    + '<p style="margin:0;color:#9c958b;font-size:12px;line-height:1.6;">GREATLY House - 10 rue de Lambersart, Verlinghem - Lun-Ven, 13h-18h30</p>'
    + '</td></tr></table></td></tr></table></body></html>';
  GmailApp.sendEmail(email, 'A bientot a la maison - ' + dateLabel,
    'Bonjour ' + name + ', votre passage est bien enregistre pour le ' + dateLabel + '. GREATLY House, 10 rue de Lambersart, Verlinghem.',
    {htmlBody: htmlVisiteur, name: 'GREATLY House', replyTo: OWNER_EMAIL});
  labelLastSentEmail('A bientot a la maison');
  // Copie equipe
  GmailApp.sendEmail(OWNER_EMAIL, '[Maison] ' + name + ' passe le ' + dateLabel,
    'Passage prevu :\n\nPrenom : ' + name + '\nEmail : ' + email + '\nTel : ' + tel + '\nDate : ' + dateLabel,
    {name: 'GREATLY Reservation'});
  labelLastSentEmail('[Maison] ' + name);
  return jsonOut({ok:true, message:'C est note !'});
}

function buildEmail(prenom, salle, date, horaire, accent, accentPale, accentDark, lienGoogle, lienAnnulation) {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px 12px;background:#EDE8E0;font-family:Helvetica Neue,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;"><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 18px;"><span style="font-size:18px;font-weight:700;letter-spacing:-.3px;color:#6B7D5C;">GREAT<span style="color:#1A1A1A;">LY</span></span><span style="font-size:18px;font-weight:600;color:#6B6460;"> House</span></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid #E7E1D7;"><tr><td style="height:6px;background:' + accent + ';font-size:0;line-height:0;"> </td></tr><tr><td style="padding:32px 30px 8px;text-align:center;"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="width:56px;height:56px;background:' + accentPale + ';border-radius:50%;text-align:center;vertical-align:middle;font-size:28px;color:' + accentDark + ';">&#10003;</td></tr></table><h1 style="margin:18px 0 4px;font-size:23px;color:#1A1A1A;font-weight:700;">C\'est reserve !</h1><p style="margin:0;color:#6B6460;font-size:15px;line-height:1.5;">Bonjour <strong>' + prenom + '</strong>, votre creneau est confirme.<br>On a hate de vous accueillir a la maison.</p></td></tr><tr><td style="padding:22px 30px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;border-radius:14px;"><tr><td style="padding:18px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Espace</td></tr><tr><td style="font-size:18px;font-weight:700;color:#1A1A1A;padding-bottom:14px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + accent + ';margin-right:8px;"></span>' + salle + '</td></tr><tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Date & horaire</td></tr><tr><td style="font-size:15px;color:#1A1A1A;font-weight:600;padding-bottom:14px;">' + date + ' - ' + horaire + '</td></tr><tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#9c958b;font-weight:700;padding-bottom:2px;">Lieu</td></tr><tr><td style="font-size:15px;color:#1A1A1A;font-weight:600;">GREATLY House - 10 rue de Lambersart, Verlinghem</td></tr></table></td></tr></table></td></tr><tr><td style="padding:20px 30px 6px;text-align:center;"><a href="' + lienGoogle + '" style="display:block;background:' + accent + ';color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 20px;border-radius:12px;">Ajouter a Google Agenda</a></td></tr><tr><td style="padding:14px 30px 4px;text-align:center;"><p style="margin:0;color:#9c958b;font-size:13px;line-height:1.5;">Une invitation est aussi jointe a ce mail.</p></td></tr><tr><td style="padding:18px 30px 0;text-align:center;"><p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Un empechement ? <a href="' + lienAnnulation + '" style="color:' + accent + ';font-weight:700;text-decoration:underline;">Annuler ce creneau</a> - il sera aussitot libere.</p></td></tr><tr><td style="padding:12px 30px 28px;text-align:center;"><p style="margin:0;color:#6B6460;font-size:14px;line-height:1.6;">Une question ? Ecrivez-nous sur WhatsApp au <a href="https://wa.me/33651156344" style="color:' + accent + ';font-weight:700;text-decoration:none;">06 51 15 63 44</a>.</p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 16px 8px;"><p style="margin:0;color:#9c958b;font-size:12px;line-height:1.6;">GREATLY House - 10 rue de Lambersart, Verlinghem - Lun-Ven, 13h-18h30</p></td></tr></table></td></tr></table></body></html>';
}

function cancelPage(success, message) {
  var color = success ? '#6B7D5C' : '#b4533f';
  var icon = success ? '&#10003;' : '&#10007;';
  var bg = success ? '#CDD8BE' : '#f5d5cf';
  var titre = success ? 'Creneau annule' : 'Erreur';
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Annulation - GREATLY</title></head><body style="margin:0;padding:40px 20px;background:#F7F4EF;font-family:Helvetica Neue,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="background:#fff;border-radius:20px;padding:40px 32px;max-width:420px;text-align:center;border:1px solid #E7E1D7;"><div style="width:56px;height:56px;border-radius:50%;background:' + bg + ';color:' + color + ';display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px;">' + icon + '</div><h1 style="font-size:20px;color:#1A1A1A;margin:0 0 10px;">' + titre + '</h1><p style="color:#6B6460;font-size:15px;line-height:1.5;margin:0 0 24px;">' + message + '</p><a href="https://wa.me/33651156344" style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;font-size:15px;">Nous contacter</a></div></body></html>';
}
