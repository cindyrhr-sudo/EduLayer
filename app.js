/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 4)                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * KORREKTUREN v4:
 *  - Laserpointer: Leuchtender Punkt + kurzer Schweif auf EIGENEM Canvas
 *    (kein Löschen fremder Annotationen mehr, kein schwarzer Startpunkt)
 *  - Textmarker: Nutzt die aktuelle Farbwahl halbtransparent (kein
 *    schwarzer Punkt mehr, kein festes Gelb)
 *  - Hell-/Dunkel-Modus: Toggle im Einstellungsmenü, data-thema am <html>
 *  - Einstellungsmenü: Drawer-Panel mit Speichern, Thema, Sidebar-Seite,
 *    Laser-Dauer-Slider, Radierer-Größe-Slider
 *  - Distinkte SVG-Icons für alle Werkzeuge (bereits in index.html)
 *  - Scroll-Modus bleibt erhalten
 *
 * STRUKTUR:
 *  1.  KONFIGURATION
 *  2.  ZUSTAND
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN
 *  5.  THEMA (Hell/Dunkel)
 *  6.  EINSTELLUNGSMENÜ
 *  7.  SIDEBAR-LOGIK
 *  8.  SCROLL-MODUS
 *  9.  ZEICHEN-ENGINE
 * 10.  LASERPOINTER (eigener Canvas, Punkt + Schweif)
 * 11.  UNDO / REDO
 * 12.  LEHRER-LAYER
 * 13.  SPOTLIGHT
 * 14.  ZOOM
 * 15.  PDF-RENDERING
 * 16.  PDF-EXPORT
 * 17.  SERVICE WORKER
 * 18.  APP-START
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION  ← HIER ANPASSEN
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {
  STIFT_DUENN_PX:     2,
  STIFT_DICK_PX:      6,
  TEXTMARKER_PX:      18,    // Breite des Textmarkers in Pixeln
  TEXTMARKER_ALPHA:   0.38,  // Deckkraft des Textmarkers (0 = transparent, 1 = voll)
  RADIERER_PX:        28,    // Wird per Slider im Menü überschrieben
  LASER_PX:           6,     // Durchmesser des Laser-Punkts

  // Laser-Schweif:
  // Wie viele Punkte werden im Schweif gespeichert?
  LASER_SCHWEIF_MAX:  28,
  // Wie lange (ms) bleibt der Schweif nach dem letzten Touch sichtbar?
  LASER_FADE_MS:      600,   // Wird per Slider im Menü überschrieben

  LASER_FARBE:        '#ff2222',   // Farbe des Laser-Punkts
  STANDARD_FARBE:     '#1a3a6b',

  SPOTLIGHT_MIN_B:    60,
  SPOTLIGHT_MIN_H:    40,
  SPOTLIGHT_START_B:  320,
  SPOTLIGHT_START_H:  200,

  PDF_SCALE:          1.5,
  ZOOM_MIN:           0.3,
  ZOOM_MAX:           4.0,
  ZOOM_SCHRITT:       0.2,

  PDFJS_WORKER:
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};


/* ═══════════════════════════════════════════════════════════════════
   2. ZUSTAND
════════════════════════════════════════════════════════════════════ */
const Z = {
  werkzeug:        'stift-duenn',
  strichfarbe:     KONFIGURATION.STANDARD_FARBE,
  strichbreite:    KONFIGURATION.STIFT_DUENN_PX,
  zeichnet:        false,
  letzterPunkt:    null,
  aktuellerStrich: null,
  modus:           'zeichnen',     // 'zeichnen' | 'scrollen'
  thema:           'dunkel',       // 'dunkel' | 'hell'

  // PDF
  pdfDokument:     null,
  seitenAnzahl:    0,
  aktiveSeite:     1,
  pdfBytes:        null,
  viewports:       {},

  // Annotationen
  annotationen:    {},
  undoVerlauf:     {},
  redoVerlauf:     {},

  // Lehrer-Layer
  lehrerAnnotationen: {},
  lehrerAktiv:     false,

  // Spotlight
  spotlightAktiv:  false,
  spotlightForm:   'rechteck',
  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  spotGriff:       null,
  spotDragStart:   null,

  // Zoom
  zoom:            1.0,
  pinch:           null,

  // Sidebar
  sidebarSeite:    'right',

  // Laser (Punkt + Schweif auf eigenem Canvas)
  laserSchweif:      [],       // [{x, y, t}] – Ringpuffer der letzten Punkte
  laserAnimFrame:    null,     // requestAnimationFrame-Handle
  laserFadeTimer:    null,     // setTimeout-Handle für Ausblend-Phase
  laserAktiv:        false,    // Wird gerade gezeichnet?

  // Einstellungsmenü
  einstellungenOffen: false,
};


/* ═══════════════════════════════════════════════════════════════════
   3. DOM-REFERENZEN
════════════════════════════════════════════════════════════════════ */
const D = {
  html:              document.documentElement,
  body:              document.body,
  hauptbereich:      document.getElementById('hauptbereich'),
  zoomWrapper:       document.getElementById('zoom-wrapper'),
  pdfContainer:      document.getElementById('pdf-container'),
  startAnzeige:      document.getElementById('start-anzeige'),

  btnDateiLaden:     document.getElementById('btn-datei-laden'),
  btnStartLaden:     document.getElementById('btn-start-laden'),
  dateiInput:        document.getElementById('datei-input'),

  btnStiftDuenn:     document.getElementById('btn-stift-duenn'),
  btnStiftDick:      document.getElementById('btn-stift-dick'),
  btnTextmarker:     document.getElementById('btn-textmarker'),
  btnRadierer:       document.getElementById('btn-radierer'),
  btnLaser:          document.getElementById('btn-laser'),
  farbDots:          document.querySelectorAll('.farb-dot'),

  btnUndo:           document.getElementById('btn-undo'),
  btnRedo:           document.getElementById('btn-redo'),
  btnSeiteLeeren:    document.getElementById('btn-seite-leeren'),

  btnModusWechsel:   document.getElementById('btn-modus-wechsel'),
  btnSpotlight:      document.getElementById('btn-spotlight'),
  btnLehrerLayer:    document.getElementById('btn-lehrer-layer'),
  iconAugeAuf:       document.getElementById('icon-auge-auf'),
  iconAugeZu:        document.getElementById('icon-auge-zu'),

  btnEinstellungen:  document.getElementById('btn-einstellungen'),

  // Einstellungsmenü
  einstellungenOverlay:    document.getElementById('einstellungen-overlay'),
  einstellungenBackdrop:   document.getElementById('einstellungen-backdrop'),
  btnEinstellungenSch:     document.getElementById('btn-einstellungen-schliessen'),
  btnSpeichern:            document.getElementById('btn-speichern'),
  btnThemaWechsel:         document.getElementById('btn-thema-wechsel'),
  btnSidebarLinks:         document.getElementById('btn-sidebar-links'),
  btnSidebarRechts:        document.getElementById('btn-sidebar-rechts'),
  sliderLaserDauer:        document.getElementById('slider-laser-dauer'),
  laserDauerAnzeige:       document.getElementById('laser-dauer-anzeige'),
  sliderRadierer:          document.getElementById('slider-radierer'),
  radiererAnzeige:         document.getElementById('radierer-anzeige'),

  // Spotlight
  spotlightOverlay:  document.getElementById('spotlight-overlay'),
  spotlightFenster:  document.getElementById('spotlight-fenster'),
  spotlightMaske:    document.getElementById('spotlight-maske'),
  btnSpotRechteck:   document.getElementById('btn-spotlight-rechteck'),
  btnSpotOval:       document.getElementById('btn-spotlight-oval'),
  btnSpotSchliessen: document.getElementById('btn-spotlight-schliessen'),
  spotGriffe:        null,   // per querySelectorAll nach DOM-Init

  // Zoom
  zoomSteuerung:     document.getElementById('zoom-steuerung'),
  btnZoomPlus:       document.getElementById('btn-zoom-plus'),
  btnZoomMinus:      document.getElementById('btn-zoom-minus'),
  btnZoomReset:      document.getElementById('btn-zoom-reset'),
  zoomAnzeige:       document.getElementById('zoom-anzeige'),

  // Laser-Canvas (eigener Layer über allem)
  laserCanvas:       document.getElementById('laser-canvas'),

  toast:             document.getElementById('toast'),
  ladeOverlay:       document.getElementById('lade-overlay'),
  ladeText:          document.getElementById('lade-text'),
};


/* ═══════════════════════════════════════════════════════════════════
   4. HILFSFUNKTIONEN
════════════════════════════════════════════════════════════════════ */

function toast(text, typ = 'info', ms = 2400) {
  const el = D.toast;
  el.className = 'toast';
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('sichtbar', typ));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('sichtbar'), ms);
}

function ladeAnzeige(an, text = 'Laden…') {
  D.ladeOverlay.style.display = an ? 'flex' : 'none';
  D.ladeOverlay.setAttribute('aria-hidden', an ? 'false' : 'true');
  D.ladeText.textContent = text;
}

/**
 * Canvas-Koordinaten aus Touch- oder Maus-Ereignis.
 * Berücksichtigt den CSS-Zoom-Transform über getBoundingClientRect.
 */
function koordinaten(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  let cx, cy;
  if (e.touches?.length > 0)              { cx = e.touches[0].clientX;        cy = e.touches[0].clientY; }
  else if (e.changedTouches?.length > 0)  { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
  else                                    { cx = e.clientX;                    cy = e.clientY; }
  return {
    x: (cx - rect.left) * (canvas.width  / rect.width),
    y: (cy - rect.top)  * (canvas.height / rect.height),
  };
}

/** Zeichen-Canvas einer Seite. */
function zeichenCanvas(seite) {
  return document.querySelector(`.seite-container[data-seite="${seite}"] .zeichen-canvas`);
}

/** Lehrer-Canvas einer Seite. */
function lehrerCanvas(seite) {
  return document.querySelector(`.seite-container[data-seite="${seite}"] .lehrer-canvas`);
}

function download(daten, dateiname, mimeTyp = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([daten], { type: mimeTyp }));
  Object.assign(document.createElement('a'), { href: url, download: dateiname }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pinchAbstand(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX,
                    touches[0].clientY - touches[1].clientY);
}

function zeitstempel() {
  const d = new Date(), z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}`;
}

function base64ZuBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Hex-Farbe (#rrggbb) in r,g,b-Werte (0–255) umrechnen.
 * Wird für den halbtransparenten Textmarker benötigt.
 */
function hexZuRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}


/* ═══════════════════════════════════════════════════════════════════
   5. THEMA (Hell / Dunkel)
════════════════════════════════════════════════════════════════════ */

/** Thema wechseln und im localStorage speichern. */
function themaWechseln(thema) {
  Z.thema = thema;
  D.html.dataset.thema = thema;

  const istHell = thema === 'hell';
  D.btnThemaWechsel.setAttribute('aria-checked', istHell ? 'true' : 'false');

  // meta theme-color für iOS Status-Bar anpassen
  document.querySelector('meta[name="theme-color"]')
          ?.setAttribute('content', istHell ? '#e8eaf0' : '#1a1f2e');

  try { localStorage.setItem('edulayer-thema', thema); } catch(_) {}
}

/** Gespeichertes Thema laden. */
function themaLaden() {
  let gespeichert = 'dunkel';
  try { gespeichert = localStorage.getItem('edulayer-thema') || 'dunkel'; } catch(_) {}
  themaWechseln(gespeichert);
}


/* ═══════════════════════════════════════════════════════════════════
   6. EINSTELLUNGSMENÜ
════════════════════════════════════════════════════════════════════ */

/** Einstellungsmenü öffnen. */
function einstellungenOeffnen() {
  Z.einstellungenOffen = true;
  D.einstellungenOverlay.style.display = 'block';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'false');
  D.btnEinstellungen.classList.add('aktiv');
  // Fokus auf Schließen-Button setzen (Barrierefreiheit)
  requestAnimationFrame(() => D.btnEinstellungenSch.focus());
}

/** Einstellungsmenü schließen. */
function einstellungenSchliessen() {
  Z.einstellungenOffen = false;
  D.einstellungenOverlay.style.display = 'none';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'true');
  D.btnEinstellungen.classList.remove('aktiv');
}

/** Sidebar-Position im Einstellungsmenü umschalten. */
function sidebarPositionSetzen(seite) {
  Z.sidebarSeite = seite;
  D.body.dataset.sidebar = seite;

  const rechts = seite === 'right';
  D.btnSidebarRechts.classList.toggle('aktiv', rechts);
  D.btnSidebarLinks.classList.toggle('aktiv', !rechts);
  D.btnSidebarRechts.setAttribute('aria-pressed', rechts ? 'true' : 'false');
  D.btnSidebarLinks.setAttribute('aria-pressed', rechts ? 'false' : 'true');
}

/** Alle Einstellungsmenü-Listener registrieren. */
function einstellungenInit() {
  D.btnEinstellungen.addEventListener('click', einstellungenOeffnen);
  D.einstellungenBackdrop.addEventListener('click', einstellungenSchliessen);
  D.btnEinstellungenSch.addEventListener('click', einstellungenSchliessen);

  // Speichern
  D.btnSpeichern.addEventListener('click', () => {
    einstellungenSchliessen();
    pdfSpeichern();
  });

  // Thema-Toggle
  D.btnThemaWechsel.addEventListener('click', () => {
    themaWechseln(Z.thema === 'dunkel' ? 'hell' : 'dunkel');
  });

  // Sidebar-Position
  D.btnSidebarLinks.addEventListener('click',   () => sidebarPositionSetzen('left'));
  D.btnSidebarRechts.addEventListener('click',  () => sidebarPositionSetzen('right'));

  // Laser-Dauer-Slider
  D.sliderLaserDauer.addEventListener('input', () => {
    const wert = +D.sliderLaserDauer.value;
    KONFIGURATION.LASER_FADE_MS = wert;
    D.laserDauerAnzeige.textContent = `${wert} ms`;
  });

  // Radierer-Größe-Slider
  D.sliderRadierer.addEventListener('input', () => {
    const wert = +D.sliderRadierer.value;
    KONFIGURATION.RADIERER_PX = wert;
    D.radiererAnzeige.textContent = `${wert} px`;
    // Strichbreite sofort aktualisieren wenn Radierer aktiv
    if (Z.werkzeug === 'radierer') Z.strichbreite = wert;
  });

  // Escape-Taste schließt Menü
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (Z.einstellungenOffen) einstellungenSchliessen();
      else if (Z.spotlightAktiv) spotlightAus();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   7. SIDEBAR-LOGIK
════════════════════════════════════════════════════════════════════ */

const WERKZEUG_BTNS = document.querySelectorAll('[data-werkzeug]');

function werkzeugWaehlen(name) {
  Z.werkzeug = name;
  Z.strichbreite = ({
    'stift-duenn': KONFIGURATION.STIFT_DUENN_PX,
    'stift-dick':  KONFIGURATION.STIFT_DICK_PX,
    'textmarker':  KONFIGURATION.TEXTMARKER_PX,
    'radierer':    KONFIGURATION.RADIERER_PX,
    'laser':       KONFIGURATION.LASER_PX,
  })[name] ?? KONFIGURATION.STIFT_DUENN_PX;

  WERKZEUG_BTNS.forEach(b => {
    const a = b.dataset.werkzeug === name;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
  document.querySelectorAll('.zeichen-canvas').forEach(c => c.dataset.werkzeug = name);
}

function farbeWaehlen(farbe) {
  Z.strichfarbe = farbe;
  D.farbDots.forEach(d => {
    const a = d.dataset.farbe === farbe;
    d.classList.toggle('aktiv', a);
    d.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function sidebarInit() {
  D.btnDateiLaden.addEventListener('click', () => D.dateiInput.click());
  D.btnStartLaden.addEventListener('click', () => D.dateiInput.click());
  D.dateiInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f?.type === 'application/pdf') pdfLaden(f);
    D.dateiInput.value = '';
  });

  D.btnStiftDuenn.addEventListener('click',  () => werkzeugWaehlen('stift-duenn'));
  D.btnStiftDick.addEventListener('click',   () => werkzeugWaehlen('stift-dick'));
  D.btnTextmarker.addEventListener('click',  () => werkzeugWaehlen('textmarker'));
  D.btnRadierer.addEventListener('click',    () => werkzeugWaehlen('radierer'));
  D.btnLaser.addEventListener('click',       () => werkzeugWaehlen('laser'));

  D.farbDots.forEach(dot => {
    dot.addEventListener('click', () => { if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe); });
  });

  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);
  D.btnModusWechsel.addEventListener('click', scrollModusUmschalten);
  D.btnSpotlight.addEventListener('click',    spotlightUmschalten);
  D.btnLehrerLayer.addEventListener('click',  lehrerLayerUmschalten);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   8. SCROLL-MODUS
════════════════════════════════════════════════════════════════════ */

function scrollModusUmschalten() {
  const scrollWar = Z.modus === 'scrollen';
  Z.modus = scrollWar ? 'zeichnen' : 'scrollen';
  D.body.classList.toggle('scroll-modus', !scrollWar);
  D.body.dataset.modus = Z.modus;
  D.btnModusWechsel.setAttribute('aria-pressed', scrollWar ? 'false' : 'true');
  toast(scrollWar ? 'Zeichnen aktiv' : 'Scroll-Modus – Finger scrollt das PDF', 'info', 1800);
}


/* ═══════════════════════════════════════════════════════════════════
   9. ZEICHEN-ENGINE
════════════════════════════════════════════════════════════════════ */

/**
 * Canvas-Context für das aktuelle Werkzeug konfigurieren.
 *
 * TEXTMARKER:
 *   Nutzt die aktuelle Strichfarbe in halbtransparenter Form.
 *   Kein festes Gelb mehr – die Farbwahl gilt auch für den Marker.
 *   globalCompositeOperation = 'multiply' ergibt echten Marker-Effekt
 *   auf hellem Grund. Auf dunklem Grund ist 'source-over' besser.
 *
 * LASER:
 *   Wird NICHT mehr auf dem Zeichen-Canvas gezeichnet!
 *   Der Laser hat einen eigenen Canvas (s. Abschnitt 10).
 *   Diese Funktion wird für Laser nie aufgerufen.
 */
function ctxKonfigurieren(ctx) {
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';
  ctx.lineWidth = Z.strichbreite;
  ctx.shadowBlur = 0;

  if (Z.werkzeug === 'textmarker') {
    // Farbe mit konfigurierter Deckkraft, kein schwarzer Startpunkt:
    // Wir stellen globalAlpha VOR dem ersten Zeichenbefehl ein.
    // Der Trick: Auf einem frischen Path gibt es keinen Punkt-Artefakt
    // wenn wir arc() weglassen (s. strichStarten).
    const [r, g, b] = hexZuRgb(Z.strichfarbe);
    ctx.strokeStyle = `rgba(${r},${g},${b},${KONFIGURATION.TEXTMARKER_ALPHA})`;
    ctx.globalAlpha = 1;   // Alpha ist schon in strokeStyle eingebaut
    // multiply auf hellem Thema, source-over auf dunklem
    ctx.globalCompositeOperation =
      Z.thema === 'hell' ? 'multiply' : 'source-over';

  } else if (Z.werkzeug === 'radierer') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.globalAlpha = 1;

  } else {
    // stift-duenn, stift-dick
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = Z.strichfarbe;
    ctx.globalAlpha = 1;
  }
}

function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

/** Strich-Start. Laser wird separat behandelt (s. Abschnitt 10). */
function strichStarten(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (e.touches?.length > 1) return;
  if (Z.spotlightAktiv) return;

  // Laser: separater Canvas, kein Zeichen auf dem Annotations-Canvas
  if (Z.werkzeug === 'laser') {
    laserStarten(e);
    return;
  }

  e.preventDefault();
  Z.zeichnet = true;
  const p = koordinaten(e, canvas);
  Z.letzterPunkt = p;

  const seite = +canvas.closest('.seite-container').dataset.seite;
  undoSnapshot(seite);

  if (Z.werkzeug !== 'radierer') {
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.aktuellerStrich = {
      punkte:   [{ ...p }],
      farbe:    Z.strichfarbe,
      breite:   Z.strichbreite,
      werkzeug: Z.werkzeug,
      alpha:    Z.werkzeug === 'textmarker' ? KONFIGURATION.TEXTMARKER_ALPHA : 1,
    };
  } else {
    Z.aktuellerStrich = null;
  }

  // Für den Textmarker KEINEN Startpunkt zeichnen – nur den Pfad beginnen.
  // Auf dem Zeichen-Canvas: Punkt erst bei touchmove sichtbar.
  // Für normale Stifte: kleiner Punkt für kurze Tipp-Gesten.
  if (Z.werkzeug !== 'textmarker') {
    const ctx = canvas.getContext('2d');
    ctxKonfigurieren(ctx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Z.strichbreite / 2, 0, Math.PI * 2);
    ctx.fill();
    ctxReset(ctx);
  }
}

function strichBewegen(e, canvas) {
  if (Z.modus === 'scrollen') return;

  if (Z.werkzeug === 'laser') { laserBewegen(e); return; }

  if (e.touches?.length === 2) {
    if (Z.zeichnet) { Z.zeichnet = false; Z.aktuellerStrich = null; }
    pinchBewegen(e);
    return;
  }
  if (!Z.zeichnet) return;
  e.preventDefault();

  const p   = koordinaten(e, canvas);
  const ctx = canvas.getContext('2d');
  ctxKonfigurieren(ctx);
  ctx.beginPath();
  ctx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctxReset(ctx);

  if (Z.aktuellerStrich) Z.aktuellerStrich.punkte.push({ ...p });
  Z.letzterPunkt = p;
}

function strichBeenden(e, canvas) {
  if (Z.werkzeug === 'laser') { laserBeenden(); return; }
  if (!Z.zeichnet) return;
  e.preventDefault();
  Z.zeichnet = false;

  if (Z.aktuellerStrich) {
    const seite = +canvas.closest('.seite-container').dataset.seite;
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.annotationen[seite].push(Z.aktuellerStrich);
    Z.aktuellerStrich = null;
  }
  Z.letzterPunkt = null;
}

function zeichenListeners(canvas) {
  canvas.addEventListener('touchstart',  e => strichStarten(e, canvas), { passive: false });
  canvas.addEventListener('touchmove',   e => strichBewegen(e, canvas), { passive: false });
  canvas.addEventListener('touchend',    e => strichBeenden(e, canvas), { passive: false });
  canvas.addEventListener('touchcancel', e => strichBeenden(e, canvas), { passive: false });
  canvas.addEventListener('mousedown',   e => strichStarten(e, canvas));
  canvas.addEventListener('mousemove',   e => strichBewegen(e, canvas));
  canvas.addEventListener('mouseup',     e => strichBeenden(e, canvas));
  canvas.addEventListener('mouseleave',  e => { if (Z.zeichnet) strichBeenden(e, canvas); });
}

/** Annotationen auf Canvas zeichnen (für Undo / Lehrer-Layer). */
function stricheZeichnen(ctx, striche) {
  if (!striche?.length) return;
  striche.forEach(s => {
    if (!s.punkte?.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.breite;

    if (s.werkzeug === 'textmarker') {
      const [r,g,b] = hexZuRgb(s.farbe);
      ctx.strokeStyle = `rgba(${r},${g},${b},${s.alpha ?? KONFIGURATION.TEXTMARKER_ALPHA})`;
      ctx.globalCompositeOperation = Z.thema === 'hell' ? 'multiply' : 'source-over';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.farbe;
    }
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(s.punkte[0].x, s.punkte[0].y);
    for (let i = 1; i < s.punkte.length - 1; i++) {
      const mx = (s.punkte[i].x + s.punkte[i+1].x) / 2;
      const my = (s.punkte[i].y + s.punkte[i+1].y) / 2;
      ctx.quadraticCurveTo(s.punkte[i].x, s.punkte[i].y, mx, my);
    }
    const lp = s.punkte[s.punkte.length - 1];
    ctx.lineTo(lp.x, lp.y);
    ctx.stroke();
    ctxReset(ctx);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   10. LASERPOINTER  – Eigener Canvas, Punkt + Schweif
   ──────────────────────────────────────────────────────────────────
   Der Laser-Canvas (#laser-canvas) liegt FEST über dem ganzen
   Viewport (position:fixed). Er wird NIEMALS auf dem Zeichen-Canvas
   gezeichnet → bestehende Annotationen bleiben unberührt.

   Technik des Schweifs:
   - Z.laserSchweif ist ein Array der letzten N Touch-Positionen
     (in Client-Koordinaten, weil der Canvas fixed ist).
   - Jeder Punkt hat einen Zeitstempel.
   - In jedem rAF-Frame wird der Canvas geleert und der Schweif
     mit sinkender Deckkraft neu gezeichnet (ältere Punkte = transparenter).
   - Der leuchtende Hauptpunkt sitzt am aktuellen Finger-Ort.
   - Nach touchend startet ein Fade-Timer der den Schweif ausblendet.
════════════════════════════════════════════════════════════════════ */

/** Laser-Canvas auf Viewport-Größe anpassen. */
function laserCanvasAnpassen() {
  const lc = D.laserCanvas;
  lc.width  = window.innerWidth;
  lc.height = window.innerHeight;
}

/** Laser-Render-Loop: zeichnet Punkt + Schweif auf den Laser-Canvas. */
function laserZeichnen() {
  const lc  = D.laserCanvas;
  const ctx = lc.getContext('2d');
  ctx.clearRect(0, 0, lc.width, lc.height);

  const schweif = Z.laserSchweif;
  if (!schweif.length) return;

  const jetzt    = Date.now();
  const fadeDauer = KONFIGURATION.LASER_FADE_MS;
  const r        = KONFIGURATION.LASER_PX;

  // ── Schweif zeichnen (älteste Punkte zuerst, am transparentesten) ──
  for (let i = 0; i < schweif.length - 1; i++) {
    const p    = schweif[i];
    const alter = jetzt - p.t;
    // Deckkraft: von 0 (alt) bis 0.6 (neu)
    const alpha = Math.max(0, 0.6 * (1 - alter / (fadeDauer * 1.5)));
    if (alpha <= 0) continue;

    // Schweif-Breite nimmt zur Spitze hin ab
    const breite = r * 0.35 * ((i + 1) / schweif.length);

    ctx.beginPath();
    ctx.moveTo(schweif[i].x, schweif[i].y);
    ctx.lineTo(schweif[i + 1].x, schweif[i + 1].y);
    ctx.strokeStyle = KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = breite;
    ctx.lineCap     = 'round';
    ctx.shadowBlur  = 8;
    ctx.shadowColor = KONFIGURATION.LASER_FARBE;
    ctx.stroke();
  }

  // ── Hauptpunkt (letzter Punkt im Schweif) ─────────────────────
  if (schweif.length > 0) {
    const letzter = schweif[schweif.length - 1];
    ctx.beginPath();
    ctx.arc(letzter.x, letzter.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha = Z.laserAktiv ? 1 : Math.max(0, 1 - (jetzt - letzter.t) / fadeDauer);
    ctx.shadowBlur  = 20;
    ctx.shadowColor = KONFIGURATION.LASER_FARBE;
    ctx.fill();
  }

  // Reset
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;

  // Nächster Frame wenn Laser aktiv oder Schweif noch sichtbar
  const aeltester = schweif[0];
  const nochSichtbar = Z.laserAktiv || (aeltester && jetzt - aeltester.t < fadeDauer * 2);
  if (nochSichtbar) {
    Z.laserAnimFrame = requestAnimationFrame(laserZeichnen);
  } else {
    // Fertig: Canvas leeren und Frame stoppen
    ctx.clearRect(0, 0, lc.width, lc.height);
    Z.laserAnimFrame = null;
    Z.laserSchweif   = [];
  }
}

/** Laser-Punkt hinzufügen (in Client-Koordinaten für den fixed Canvas). */
function laserPunktHinzufuegen(clientX, clientY) {
  Z.laserSchweif.push({ x: clientX, y: clientY, t: Date.now() });
  // Ringpuffer: nur die letzten N Punkte behalten
  if (Z.laserSchweif.length > KONFIGURATION.LASER_SCHWEIF_MAX) {
    Z.laserSchweif.shift();
  }
}

function laserStarten(e) {
  e.preventDefault();
  Z.laserAktiv = true;
  Z.laserSchweif = [];
  clearTimeout(Z.laserFadeTimer);

  const t = e.touches?.[0] ?? e;
  laserPunktHinzufuegen(t.clientX, t.clientY);

  // Render-Loop starten (falls nicht schon läuft)
  if (!Z.laserAnimFrame) {
    Z.laserAnimFrame = requestAnimationFrame(laserZeichnen);
  }
}

function laserBewegen(e) {
  if (!Z.laserAktiv) return;
  e.preventDefault();
  const t = e.touches?.[0] ?? e;
  laserPunktHinzufuegen(t.clientX, t.clientY);
}

function laserBeenden() {
  Z.laserAktiv = false;
  clearTimeout(Z.laserFadeTimer);
  // Nach Fade-Dauer: Render-Loop übernimmt das Ausblenden
  // (laserZeichnen prüft selbst wann fertig)
}


/* ═══════════════════════════════════════════════════════════════════
   11. UNDO / REDO
════════════════════════════════════════════════════════════════════ */

function undoSnapshot(seite) {
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  const v = Z.undoVerlauf[seite];
  v.push(canvas.toDataURL());
  if (v.length > 30) v.shift();
  Z.redoVerlauf[seite] = [];
}

function undoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.undoVerlauf[seite]?.length) { toast('Kein weiterer Rückgängig-Schritt.', 'info', 1500); return; }
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  Z.redoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.undoVerlauf[seite].pop());
  if (Z.annotationen[seite]?.length) Z.annotationen[seite].pop();
}

function redoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.redoVerlauf[seite]?.length) { toast('Kein weiterer Wiederholen-Schritt.', 'info', 1500); return; }
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  Z.undoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.redoVerlauf[seite].pop());
}

function snapshotLaden(canvas, dataUrl) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0); };
  img.src = dataUrl;
}

function seiteLeeren() {
  const seite = Z.aktiveSeite;
  if (!window.confirm(`Alle Annotationen auf Seite ${seite} löschen?`)) return;
  undoSnapshot(seite);
  const canvas = zeichenCanvas(seite);
  if (canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  Z.annotationen[seite] = [];
  toast(`Seite ${seite} geleert.`, 'info');
}


/* ═══════════════════════════════════════════════════════════════════
   12. LEHRER-LAYER
════════════════════════════════════════════════════════════════════ */

function lehrerLayerUmschalten() {
  Z.lehrerAktiv = !Z.lehrerAktiv;
  D.btnLehrerLayer.classList.toggle('aktiv', Z.lehrerAktiv);
  D.btnLehrerLayer.setAttribute('aria-pressed', Z.lehrerAktiv ? 'true' : 'false');
  D.iconAugeAuf.style.display = Z.lehrerAktiv ? 'block' : 'none';
  D.iconAugeZu.style.display  = Z.lehrerAktiv ? 'none'  : 'block';

  for (let s = 1; s <= Z.seitenAnzahl; s++) {
    const lc = lehrerCanvas(s);
    if (!lc) continue;
    const ctx = lc.getContext('2d');
    ctx.clearRect(0,0,lc.width,lc.height);
    if (Z.lehrerAktiv && Z.lehrerAnnotationen[s]?.length) {
      ctx.globalAlpha = 0.72;
      stricheZeichnen(ctx, Z.lehrerAnnotationen[s]);
      ctx.globalAlpha = 1;
    }
  }
  toast(Z.lehrerAktiv ? 'Lehrer-Layer sichtbar' : 'Lehrer-Layer ausgeblendet', 'info', 1400);
}


/* ═══════════════════════════════════════════════════════════════════
   13. SPOTLIGHT
════════════════════════════════════════════════════════════════════ */

function spotlightAn() {
  Z.spotlightAktiv = true;
  Z.spotFenster = {
    x: (window.innerWidth  - KONFIGURATION.SPOTLIGHT_START_B) / 2,
    y: (window.innerHeight - KONFIGURATION.SPOTLIGHT_START_H) / 2,
    b: KONFIGURATION.SPOTLIGHT_START_B,
    h: KONFIGURATION.SPOTLIGHT_START_H,
  };
  D.spotlightOverlay.style.display = 'block';
  D.spotlightOverlay.setAttribute('aria-hidden', 'false');
  D.btnSpotlight.classList.add('aktiv');
  D.btnSpotlight.setAttribute('aria-pressed', 'true');
  spotlightAktualisieren();
  toast('Spotlight – Mitte ziehen: bewegen · Griffe: Größe ändern', 'info', 3000);
}

function spotlightAus() {
  Z.spotlightAktiv = false;
  D.spotlightOverlay.style.display = 'none';
  D.spotlightOverlay.setAttribute('aria-hidden', 'true');
  D.btnSpotlight.classList.remove('aktiv');
  D.btnSpotlight.setAttribute('aria-pressed', 'false');
}

function spotlightUmschalten() { Z.spotlightAktiv ? spotlightAus() : spotlightAn(); }

function spotlightAktualisieren() {
  const f = Z.spotFenster, el = D.spotlightFenster;
  el.style.left = `${f.x}px`; el.style.top  = `${f.y}px`;
  el.style.width= `${f.b}px`; el.style.height=`${f.h}px`;
  el.classList.toggle('oval', Z.spotlightForm === 'oval');

  const maske = D.spotlightMaske;
  const W = window.innerWidth, H = window.innerHeight;

  if (Z.spotlightForm === 'oval') {
    const mask = `radial-gradient(ellipse ${f.b/2}px ${f.h/2}px at ${f.x+f.b/2}px ${f.y+f.h/2}px, transparent 99%, black 100%)`;
    maske.style.webkitMaskImage = mask;
    maske.style.maskImage = mask;
    maske.style.clipPath  = '';
  } else {
    maske.style.webkitMaskImage = '';
    maske.style.maskImage = '';
    maske.style.clipPath = `polygon(0 0,${W}px 0,${W}px ${H}px,0 ${H}px,0 0,${f.x}px ${f.y}px,${f.x}px ${f.y+f.h}px,${f.x+f.b}px ${f.y+f.h}px,${f.x+f.b}px ${f.y}px,${f.x}px ${f.y}px)`;
  }
}

function spotFensterInnen(x, y) {
  const f = Z.spotFenster, rand = 22;
  return x > f.x+rand && x < f.x+f.b-rand && y > f.y+rand && y < f.y+f.h-rand ? 'mitte' : null;
}

function spotGriffZiehen(cx, cy) {
  if (!Z.spotGriff || !Z.spotDragStart) return;
  const s = Z.spotDragStart, f = Z.spotFenster;
  const dx = cx - s.startX, dy = cy - s.startY;
  const MB = KONFIGURATION.SPOTLIGHT_MIN_B, MH = KONFIGURATION.SPOTLIGHT_MIN_H;

  switch (Z.spotGriff) {
    case 'mitte': f.x = Math.max(0,Math.min(s.fx+dx, window.innerWidth -f.b)); f.y = Math.max(0,Math.min(s.fy+dy, window.innerHeight-f.h)); break;
    case 'se':    f.b = Math.max(MB,s.fb+dx); f.h = Math.max(MH,s.fh+dy); break;
    case 'sw':    f.b = Math.max(MB,s.fb-dx); f.x = s.fx+s.fb-f.b; f.h = Math.max(MH,s.fh+dy); break;
    case 'ne':    f.b = Math.max(MB,s.fb+dx); f.h = Math.max(MH,s.fh-dy); f.y = s.fy+s.fh-f.h; break;
    case 'nw':    f.b = Math.max(MB,s.fb-dx); f.h = Math.max(MH,s.fh-dy); f.x = s.fx+s.fb-f.b; f.y = s.fy+s.fh-f.h; break;
    case 'e':     f.b = Math.max(MB,s.fb+dx); break;
    case 'w':     f.b = Math.max(MB,s.fb-dx); f.x = s.fx+s.fb-f.b; break;
    case 'n':     f.h = Math.max(MH,s.fh-dy); f.y = s.fy+s.fh-f.h; break;
    case 's':     f.h = Math.max(MH,s.fh+dy); break;
  }
  spotlightAktualisieren();
}

function spotDragStartSetzen(griff, cx, cy) {
  Z.spotGriff = griff;
  Z.spotDragStart = { startX:cx, startY:cy, fx:Z.spotFenster.x, fy:Z.spotFenster.y, fb:Z.spotFenster.b, fh:Z.spotFenster.h };
}

function spotlightInit() {
  D.spotGriffe = document.querySelectorAll('.spot-griff');

  D.spotGriffe.forEach(g => {
    g.addEventListener('touchstart', e => {
      if (!Z.spotlightAktiv) return;
      e.preventDefault(); e.stopPropagation();
      spotDragStartSetzen(g.dataset.griff, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    g.addEventListener('mousedown', e => {
      if (!Z.spotlightAktiv) return;
      e.preventDefault(); e.stopPropagation();
      spotDragStartSetzen(g.dataset.griff, e.clientX, e.clientY);
    });
  });

  const fen = D.spotlightFenster;
  fen.addEventListener('touchstart', e => {
    if (!Z.spotlightAktiv || e.target.classList.contains('spot-griff')) return;
    e.preventDefault();
    const t = e.touches[0];
    if (spotFensterInnen(t.clientX, t.clientY)) spotDragStartSetzen('mitte', t.clientX, t.clientY);
  }, { passive: false });
  fen.addEventListener('mousedown', e => {
    if (!Z.spotlightAktiv || e.target.classList.contains('spot-griff')) return;
    if (spotFensterInnen(e.clientX, e.clientY)) spotDragStartSetzen('mitte', e.clientX, e.clientY);
  });

  document.addEventListener('touchmove', e => {
    if (!Z.spotlightAktiv || !Z.spotGriff) return;
    e.preventDefault();
    spotGriffZiehen(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  document.addEventListener('touchend', () => { Z.spotGriff = null; Z.spotDragStart = null; }, { passive: false });
  document.addEventListener('mousemove', e => { if (Z.spotlightAktiv && Z.spotGriff) spotGriffZiehen(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => { Z.spotGriff = null; Z.spotDragStart = null; });

  D.btnSpotRechteck.addEventListener('click', () => {
    Z.spotlightForm = 'rechteck';
    D.btnSpotRechteck.classList.add('aktiv');    D.btnSpotRechteck.setAttribute('aria-pressed','true');
    D.btnSpotOval.classList.remove('aktiv');     D.btnSpotOval.setAttribute('aria-pressed','false');
    spotlightAktualisieren();
  });
  D.btnSpotOval.addEventListener('click', () => {
    Z.spotlightForm = 'oval';
    D.btnSpotOval.classList.add('aktiv');        D.btnSpotOval.setAttribute('aria-pressed','true');
    D.btnSpotRechteck.classList.remove('aktiv'); D.btnSpotRechteck.setAttribute('aria-pressed','false');
    spotlightAktualisieren();
  });
  D.btnSpotSchliessen.addEventListener('click', spotlightAus);
}


/* ═══════════════════════════════════════════════════════════════════
   14. ZOOM
════════════════════════════════════════════════════════════════════ */

function zoomSetzen(n) {
  Z.zoom = Math.min(KONFIGURATION.ZOOM_MAX, Math.max(KONFIGURATION.ZOOM_MIN, n));
  D.pdfContainer.style.transform = `scale(${Z.zoom})`;
  D.pdfContainer.style.transformOrigin = 'top center';
  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;
}

function pinchBewegen(e) {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const ab = pinchAbstand(e.touches);
  if (!Z.pinch) { Z.pinch = { abstand: ab, zoomStart: Z.zoom }; return; }
  zoomSetzen(Z.pinch.zoomStart * (ab / Z.pinch.abstand));
}

function zoomInit() {
  D.btnZoomPlus.addEventListener('click',  () => zoomSetzen(Z.zoom + KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomMinus.addEventListener('click', () => zoomSetzen(Z.zoom - KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));

  D.zoomWrapper.addEventListener('touchstart', e => { if (e.touches.length === 2) Z.pinch = null; }, { passive: false });
  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && Z.modus === 'zeichnen') { e.preventDefault(); pinchBewegen(e); }
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchend', () => { if (Z.pinch) Z.pinch = null; }, { passive: true });
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomSetzen(Z.zoom + (e.deltaY > 0 ? -KONFIGURATION.ZOOM_SCHRITT : KONFIGURATION.ZOOM_SCHRITT)); }
  }, { passive: false });
}


/* ═══════════════════════════════════════════════════════════════════
   15. PDF-RENDERING
════════════════════════════════════════════════════════════════════ */

async function pdfLaden(datei) {
  ladeAnzeige(true, 'PDF wird geöffnet…');
  try {
    const ab = await datei.arrayBuffer();
    Z.pdfBytes = new Uint8Array(ab);
    pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER;
    Z.pdfDokument  = await pdfjsLib.getDocument({ data: Z.pdfBytes.slice() }).promise;
    Z.seitenAnzahl = Z.pdfDokument.numPages;
    Object.assign(Z, { annotationen:{}, lehrerAnnotationen:{}, undoVerlauf:{}, redoVerlauf:{}, aktiveSeite:1, viewports:{} });
    zoomSetzen(1.0);
    D.startAnzeige.style.display = 'none';
    D.pdfContainer.innerHTML     = '';
    D.pdfContainer.style.display = 'flex';

    for (let i = 1; i <= Z.seitenAnzahl; i++) {
      ladeAnzeige(true, `Seite ${i} / ${Z.seitenAnzahl} wird gerendert…`);
      await pdfSeiteRendern(i);
    }
    D.zoomSteuerung.style.display = 'flex';
    toast(`„${datei.name}" geladen (${Z.seitenAnzahl} Seiten)`, 'erfolg');
  } catch (err) {
    console.error('[EduLayer] PDF-Ladefehler:', err);
    toast('Fehler beim Laden der PDF.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}

async function pdfSeiteRendern(nr) {
  const seite    = await Z.pdfDokument.getPage(nr);
  const viewport = seite.getViewport({ scale: KONFIGURATION.PDF_SCALE });
  const W = Math.floor(viewport.width), H = Math.floor(viewport.height);
  Z.viewports[nr] = { breite: W, hoehe: H };

  const cont = document.createElement('div');
  cont.className = 'seite-container'; cont.dataset.seite = nr;
  cont.style.width = `${W}px`; cont.style.height = `${H}px`;

  const pdfC = document.createElement('canvas');
  pdfC.className = 'pdf-canvas'; pdfC.width = W; pdfC.height = H;
  pdfC.style.width = `${W}px`; pdfC.style.height = `${H}px`;
  cont.appendChild(pdfC);

  const zC = document.createElement('canvas');
  zC.className = 'zeichen-canvas'; zC.width = W; zC.height = H;
  zC.dataset.werkzeug = Z.werkzeug;
  cont.appendChild(zC);

  const lC = document.createElement('canvas');
  lC.className = 'lehrer-canvas'; lC.width = W; lC.height = H;
  lC.setAttribute('aria-hidden', 'true');
  cont.appendChild(lC);

  D.pdfContainer.appendChild(cont);
  await seite.render({ canvasContext: pdfC.getContext('2d'), viewport }).promise;
  zeichenListeners(zC);

  new IntersectionObserver(eintraege => {
    eintraege.forEach(e => { if (e.isIntersecting && e.intersectionRatio >= 0.4) Z.aktiveSeite = nr; });
  }, { root: D.zoomWrapper, threshold: 0.4 }).observe(cont);
}


/* ═══════════════════════════════════════════════════════════════════
   16. PDF-EXPORT
════════════════════════════════════════════════════════════════════ */

async function pdfSpeichern() {
  if (!Z.pdfBytes) { toast('Keine PDF geladen.', 'fehler'); return; }
  ladeAnzeige(true, 'PDF wird gespeichert…');
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(Z.pdfBytes);
    const seiten = pdfDoc.getPages();

    for (let s = 1; s <= Z.seitenAnzahl; s++) {
      const pdfSeite = seiten[s-1];
      const vp = Z.viewports[s]; if (!vp) continue;
      const { width: pdfB, height: pdfH } = pdfSeite.getSize();

      const zC = zeichenCanvas(s);
      if (zC && Z.annotationen[s]?.length) {
        const bild = await pdfDoc.embedPng(base64ZuBytes(zC.toDataURL('image/png').split(',')[1]));
        pdfSeite.drawImage(bild, { x:0, y:0, width:pdfB, height:pdfH, opacity:1 });
      }
      if (Z.lehrerAktiv && Z.lehrerAnnotationen[s]?.length) {
        const lC = lehrerCanvas(s);
        if (lC) {
          const bild = await pdfDoc.embedPng(base64ZuBytes(lC.toDataURL('image/png').split(',')[1]));
          pdfSeite.drawImage(bild, { x:0, y:0, width:pdfB, height:pdfH, opacity:0.72 });
        }
      }
    }
    pdfDoc.setCreator('EduLayer PWA');
    pdfDoc.setModificationDate(new Date());
    const name = `EduLayer_${zeitstempel()}.pdf`;
    download(await pdfDoc.save(), name);
    toast(`Gespeichert: ${name}`, 'erfolg', 3500);
  } catch (err) {
    console.error('[EduLayer] Speicherfehler:', err);
    toast('Fehler beim Speichern.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}


/* ═══════════════════════════════════════════════════════════════════
   17. SERVICE WORKER
════════════════════════════════════════════════════════════════════ */

function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller)
            toast('Update verfügbar – Seite neu laden.', 'info', 6000);
        });
      });
    } catch(e) { console.warn('[EduLayer] SW:', e); }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   18. APP-START
════════════════════════════════════════════════════════════════════ */

function appStart() {
  console.log('[EduLayer] v4 startet…');

  // Laser-Canvas auf Viewport-Größe setzen
  laserCanvasAnpassen();
  window.addEventListener('resize', laserCanvasAnpassen);
  window.addEventListener('orientationchange', () => {
    setTimeout(laserCanvasAnpassen, 350);
    setTimeout(() => { if (Z.spotlightAktiv) spotlightAktualisieren(); }, 350);
  });

  // Gespeichertes Thema laden
  themaLaden();

  // Listener
  sidebarInit();
  einstellungenInit();
  spotlightInit();
  zoomInit();

  // Standardwerkzeug + Farbe
  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);

  swRegistrieren();

  // Drag & Drop
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f?.type === 'application/pdf') pdfLaden(f);
  });

  // iOS Bounce verhindern
  document.addEventListener('touchmove', e => {
    const ziel = e.target;
    const erlaubt =
      ziel.closest('.zoom-wrapper') ||
      ziel.closest('.sidebar') ||
      ziel.closest('.spotlight-overlay') ||
      ziel.closest('.zoom-steuerung') ||
      ziel.closest('.spotlight-toolbar') ||
      ziel.closest('.einstellungen-panel');
    if (!erlaubt) e.preventDefault();
  }, { passive: false });

  console.log('[EduLayer] Bereit.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else {
  appStart();
}
