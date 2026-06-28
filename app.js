/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 5)                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * NEUE FEATURES v5:
 *  - Geodreieck: SVG-Overlay mit Echtmaß-Kalibrierung, Drehen, Verschieben
 *    Stift snap-t an die nächste Kante für gerade Linien
 *  - Textmarker: konstantes Alpha via Offscreen-Canvas (kein Durchscheinen
 *    von Überlappungen, keine schwarzen Startpunkte)
 *  - Lehrer-Notizen: pro Seite gespeicherte Textnotizen mit Vorlagen
 *
 * STRUKTUR:
 *  1.  KONFIGURATION
 *  2.  ZUSTAND
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN
 *  5.  THEMA
 *  6.  EINSTELLUNGSMENÜ
 *  7.  NOTIZEN-PANEL
 *  8.  SIDEBAR-LOGIK
 *  9.  SCROLL-MODUS
 * 10.  ZEICHEN-ENGINE (inkl. Textmarker-Offscreen-Technik)
 * 11.  LASERPOINTER
 * 12.  UNDO / REDO
 * 13.  LEHRER-LAYER
 * 14.  GEODREIECK
 * 15.  SPOTLIGHT
 * 16.  ZOOM
 * 17.  PDF-RENDERING
 * 18.  PDF-EXPORT
 * 19.  SERVICE WORKER
 * 20.  APP-START
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION  ← HIER ANPASSEN
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {
  STIFT_DUENN_PX:    2,
  STIFT_DICK_PX:     6,
  TEXTMARKER_PX:     18,
  // Textmarker-Alpha: 0.0 = unsichtbar, 1.0 = deckend.
  // 0.32 ist so gewählt dass Text darunter noch gut lesbar ist.
  TEXTMARKER_ALPHA:  0.32,
  RADIERER_PX:       28,
  LASER_PX:          6,
  LASER_SCHWEIF_MAX: 28,
  LASER_FADE_MS:     600,
  LASER_FARBE:       '#ff2222',
  STANDARD_FARBE:    '#1a3a6b',

  // Geodreieck
  // Echte Länge der Grundlinie in cm (klassisches Schuldreieck = 16cm)
  GEO_CM_LAENGE:     16,
  // Snap-Distanz: Wie nah muss der Stift an eine Kante kommen? (in px)
  GEO_SNAP_PX:       22,
  // Farbe des Geodreiecks (überschreibbar per Einstellungen)
  GEO_FARBE:         '#64c8ff',

  SPOTLIGHT_MIN_B:   60,
  SPOTLIGHT_MIN_H:   40,
  SPOTLIGHT_START_B: 320,
  SPOTLIGHT_START_H: 200,

  PDF_SCALE:         1.5,
  ZOOM_MIN:          0.3,
  ZOOM_MAX:          4.0,
  ZOOM_SCHRITT:      0.2,

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
  modus:           'zeichnen',
  thema:           'dunkel',

  // PDF
  pdfDokument:     null,
  seitenAnzahl:    0,
  aktiveSeite:     1,
  pdfBytes:        null,
  viewports:       {},
  // px pro cm auf dem gerenderten PDF-Canvas (für Geodreieck-Kalibrierung)
  pxProCm:         {},   // { seite: number }

  // Annotationen
  annotationen:    {},
  undoVerlauf:     {},
  redoVerlauf:     {},

  // Lehrer-Layer (Canvas-Annotationen)
  lehrerAnnotationen: {},
  lehrerAktiv:     false,

  // Lehrer-Notizen (Text, pro Seite)
  notizenProSeite: {},   // { 1: "Text…", 2: "…" }
  notizenOffen:    false,
  notizenSeite:    1,    // welche Seite gerade im Notizen-Panel angezeigt wird

  // Textmarker: Offscreen-Canvas pro Zeichen-Canvas
  // { canvasId: OffscreenCanvasContext }  – wird beim Strich-Ende auf Haupt-Canvas geflacht
  markerOffscreen: new WeakMap(),

  // Spotlight
  spotlightAktiv:  false,
  spotlightForm:   'rechteck',
  spotFenster:     { x:0, y:0, b:320, h:200 },
  spotGriff:       null,
  spotDragStart:   null,

  // Geodreieck
  geodreieckAktiv: false,
  // Position der unteren linken Ecke (rechter Winkel) im Hauptbereich
  geoPos:          { x: 80, y: 200 },
  // Rotationswinkel in Grad (0 = Basis horizontal)
  geoWinkel:       0,
  // Skalierung: wird von pxProCm abgeleitet
  geoSkalierung:   1,
  // Drag-Zustand
  geoDrag:         null,  // { art: 'move'|'rotate', startX, startY, startPos, startWinkel }
  // Snap-Zustand: { aktiv, kantenPunkt, kantenRichtung }
  geoSnap:         null,

  // Zoom
  zoom:            1.0,
  pinch:           null,

  // Sidebar
  sidebarSeite:    'right',

  // Laser
  laserSchweif:    [],
  laserAnimFrame:  null,
  laserAktiv:      false,

  // Einstellungen
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
  btnGeodrei:        document.getElementById('btn-geodreieck'),
  btnLehrerLayer:    document.getElementById('btn-lehrer-layer'),
  iconAugeAuf:       document.getElementById('icon-auge-auf'),
  iconAugeZu:        document.getElementById('icon-auge-zu'),
  btnNotizen:        document.getElementById('btn-notizen'),
  btnEinstellungen:  document.getElementById('btn-einstellungen'),

  // Geodreieck
  geoWrapper:        document.getElementById('geodreieck-wrapper'),
  geoSvg:            document.getElementById('geodreieck-svg'),
  geoGrundlinie:     document.getElementById('geo-grundlinie'),
  geoHypotenuse:     document.getElementById('geo-hypotenuse'),
  geoWinkelG:        document.getElementById('geo-winkel'),
  geoHoehenG:        document.getElementById('geo-hoehen'),
  geoFuehrung:       document.getElementById('geo-fuehrungslinie'),
  geoDrehGriff:      document.getElementById('geo-dreh-griff'),
  geoMoveGriff:      document.getElementById('geo-move-griff'),

  // Notizen
  notizenOverlay:    document.getElementById('notizen-overlay'),
  notizenBackdrop:   document.getElementById('notizen-backdrop'),
  btnNotizenSch:     document.getElementById('btn-notizen-schliessen'),
  notizenSeiteInfo:  document.getElementById('notizen-seite-info'),
  notizenNavInfo:    document.getElementById('notizen-nav-info'),
  btnNotizenVor:     document.getElementById('btn-notizen-seite-vor'),
  btnNotizenNach:    document.getElementById('btn-notizen-seite-nach'),
  notizenTextarea:   document.getElementById('notizen-textarea'),
  vorlagenBtns:      document.querySelectorAll('.notiz-vorlage-btn'),
  btnNotizenLoeschen:    document.getElementById('btn-notizen-loeschen'),
  btnNotizenExportieren: document.getElementById('btn-notizen-exportieren'),

  // Einstellungen
  einstellungenOverlay:  document.getElementById('einstellungen-overlay'),
  einstellungenBackdrop: document.getElementById('einstellungen-backdrop'),
  btnEinstellungenSch:   document.getElementById('btn-einstellungen-schliessen'),
  btnSpeichern:          document.getElementById('btn-speichern'),
  btnThemaWechsel:       document.getElementById('btn-thema-wechsel'),
  btnSidebarLinks:       document.getElementById('btn-sidebar-links'),
  btnSidebarRechts:      document.getElementById('btn-sidebar-rechts'),
  sliderLaserDauer:      document.getElementById('slider-laser-dauer'),
  laserDauerAnzeige:     document.getElementById('laser-dauer-anzeige'),
  sliderRadierer:        document.getElementById('slider-radierer'),
  radiererAnzeige:       document.getElementById('radierer-anzeige'),
  pickerGeodrei:         document.getElementById('picker-geodreieck'),

  // Spotlight
  spotlightOverlay:  document.getElementById('spotlight-overlay'),
  spotlightFenster:  document.getElementById('spotlight-fenster'),
  spotlightMaske:    document.getElementById('spotlight-maske'),
  btnSpotRechteck:   document.getElementById('btn-spotlight-rechteck'),
  btnSpotOval:       document.getElementById('btn-spotlight-oval'),
  btnSpotSchliessen: document.getElementById('btn-spotlight-schliessen'),
  spotGriffe:        null,

  // Zoom
  zoomSteuerung:     document.getElementById('zoom-steuerung'),
  btnZoomPlus:       document.getElementById('btn-zoom-plus'),
  btnZoomMinus:      document.getElementById('btn-zoom-minus'),
  btnZoomReset:      document.getElementById('btn-zoom-reset'),
  zoomAnzeige:       document.getElementById('zoom-anzeige'),

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
  el.className = 'toast'; el.textContent = text;
  requestAnimationFrame(() => el.classList.add('sichtbar', typ));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('sichtbar'), ms);
}

function ladeAnzeige(an, text = 'Laden…') {
  D.ladeOverlay.style.display = an ? 'flex' : 'none';
  D.ladeOverlay.setAttribute('aria-hidden', an ? 'false' : 'true');
  D.ladeText.textContent = text;
}

/** Canvas-Koordinaten aus Touch- oder Maus-Ereignis. */
function koordinaten(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  let cx, cy;
  if (e.touches?.length > 0)             { cx = e.touches[0].clientX;        cy = e.touches[0].clientY; }
  else if (e.changedTouches?.length > 0) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
  else                                   { cx = e.clientX;                    cy = e.clientY; }
  return {
    x: (cx - rect.left) * (canvas.width  / rect.width),
    y: (cy - rect.top)  * (canvas.height / rect.height),
  };
}

/** Client-Koordinaten (für Geodreieck, Laser etc.). */
function clientKoordinaten(e) {
  if (e.touches?.length > 0)             return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
  if (e.changedTouches?.length > 0)      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function zeichenCanvas(seite) {
  return document.querySelector(`.seite-container[data-seite="${seite}"] .zeichen-canvas`);
}
function lehrerCanvas(seite) {
  return document.querySelector(`.seite-container[data-seite="${seite}"] .lehrer-canvas`);
}

function download(daten, dateiname, mimeTyp = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([daten], { type: mimeTyp }));
  Object.assign(document.createElement('a'), { href: url, download: dateiname }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function pinchAbstand(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
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
function hexZuRgb(hex) {
  return [
    parseInt(hex.slice(1,3),16),
    parseInt(hex.slice(3,5),16),
    parseInt(hex.slice(5,7),16),
  ];
}

/** Winkel in Grad zwischen zwei Punkten (für Geodreieck-Drehung). */
function winkelZwischen(cx, cy, px, py) {
  return Math.atan2(py - cy, px - cx) * 180 / Math.PI;
}


/* ═══════════════════════════════════════════════════════════════════
   5. THEMA
════════════════════════════════════════════════════════════════════ */
function themaWechseln(thema) {
  Z.thema = thema;
  D.html.dataset.thema = thema;
  const hell = thema === 'hell';
  D.btnThemaWechsel.setAttribute('aria-checked', hell ? 'true' : 'false');
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', hell ? '#e8eaf0' : '#1a1f2e');
  try { localStorage.setItem('edulayer-thema', thema); } catch(_) {}
}
function themaLaden() {
  let t = 'dunkel';
  try { t = localStorage.getItem('edulayer-thema') || 'dunkel'; } catch(_) {}
  themaWechseln(t);
}


/* ═══════════════════════════════════════════════════════════════════
   6. EINSTELLUNGSMENÜ
════════════════════════════════════════════════════════════════════ */
function einstellungenOeffnen() {
  Z.einstellungenOffen = true;
  D.einstellungenOverlay.style.display = 'block';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'false');
  D.btnEinstellungen.classList.add('aktiv');
  requestAnimationFrame(() => D.btnEinstellungenSch.focus());
}
function einstellungenSchliessen() {
  Z.einstellungenOffen = false;
  D.einstellungenOverlay.style.display = 'none';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'true');
  D.btnEinstellungen.classList.remove('aktiv');
}
function sidebarPositionSetzen(seite) {
  Z.sidebarSeite = seite;
  D.body.dataset.sidebar = seite;
  const r = seite === 'right';
  D.btnSidebarRechts.classList.toggle('aktiv', r);
  D.btnSidebarLinks.classList.toggle('aktiv', !r);
  D.btnSidebarRechts.setAttribute('aria-pressed', r ? 'true' : 'false');
  D.btnSidebarLinks.setAttribute('aria-pressed', r ? 'false' : 'true');
}
function einstellungenInit() {
  D.btnEinstellungen.addEventListener('click', einstellungenOeffnen);
  D.einstellungenBackdrop.addEventListener('click', einstellungenSchliessen);
  D.btnEinstellungenSch.addEventListener('click', einstellungenSchliessen);
  D.btnSpeichern.addEventListener('click', () => { einstellungenSchliessen(); pdfSpeichern(); });
  D.btnThemaWechsel.addEventListener('click', () => themaWechseln(Z.thema === 'dunkel' ? 'hell' : 'dunkel'));
  D.btnSidebarLinks.addEventListener('click',  () => sidebarPositionSetzen('left'));
  D.btnSidebarRechts.addEventListener('click', () => sidebarPositionSetzen('right'));
  D.sliderLaserDauer.addEventListener('input', () => {
    const v = +D.sliderLaserDauer.value;
    KONFIGURATION.LASER_FADE_MS = v;
    D.laserDauerAnzeige.textContent = `${v} ms`;
  });
  D.sliderRadierer.addEventListener('input', () => {
    const v = +D.sliderRadierer.value;
    KONFIGURATION.RADIERER_PX = v;
    D.radiererAnzeige.textContent = `${v} px`;
    if (Z.werkzeug === 'radierer') Z.strichbreite = v;
  });
  D.pickerGeodrei.addEventListener('input', () => {
    KONFIGURATION.GEO_FARBE = D.pickerGeodrei.value;
    geodreieckZeichnen();
  });
}


/* ═══════════════════════════════════════════════════════════════════
   7. NOTIZEN-PANEL
════════════════════════════════════════════════════════════════════ */

/** Vorlagen-Texte für schnelles Einfügen. */
const VORLAGEN = {
  lernziele: `Lernziele dieser Stunde:
• 
• 
• `,
  aufgaben: `Aufgaben:
1. 
2. 
3. `,
  material: `Benötigtes Material:
• Schulbuch S. 
• Arbeitsblatt: 
• `,
  differenzierung: `Differenzierung:
▲ Erweiterung: 
● Standard: 
▼ Unterstützung: `,
};

/** Notizen-Panel öffnen. */
function notizenOeffnen() {
  Z.notizenOffen = true;
  Z.notizenSeite = Z.aktiveSeite;
  D.notizenOverlay.style.display = 'block';
  D.notizenOverlay.setAttribute('aria-hidden', 'false');
  D.btnNotizen.classList.add('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'true');
  notizenAnzeigenAktualisieren();
  requestAnimationFrame(() => D.notizenTextarea.focus());
}

/** Notizen-Panel schließen. */
function notizenSchliessen() {
  // Aktuellen Textarea-Inhalt speichern vor dem Schließen
  notizenSpeichern();
  Z.notizenOffen = false;
  D.notizenOverlay.style.display = 'none';
  D.notizenOverlay.setAttribute('aria-hidden', 'true');
  D.btnNotizen.classList.remove('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'false');
}

/** Notiz der aktuellen Seite im Zustand speichern. */
function notizenSpeichern() {
  Z.notizenProSeite[Z.notizenSeite] = D.notizenTextarea.value;
}

/** Notizen-Anzeige für die aktuelle Seite aktualisieren. */
function notizenAnzeigenAktualisieren() {
  const seite    = Z.notizenSeite;
  const gesamt   = Z.seitenAnzahl || 1;
  D.notizenTextarea.value  = Z.notizenProSeite[seite] || '';
  D.notizenSeiteInfo.textContent  = `Seite ${seite}`;
  D.notizenNavInfo.textContent    = `Seite ${seite} / ${gesamt}`;
}

/** Notizen-Initialisierung. */
function notizenInit() {
  D.btnNotizen.addEventListener('click', () =>
    Z.notizenOffen ? notizenSchliessen() : notizenOeffnen()
  );
  D.notizenBackdrop.addEventListener('click', notizenSchliessen);
  D.btnNotizenSch.addEventListener('click',   notizenSchliessen);

  // Seiten-Navigation
  D.btnNotizenVor.addEventListener('click', () => {
    notizenSpeichern();
    Z.notizenSeite = Math.max(1, Z.notizenSeite - 1);
    notizenAnzeigenAktualisieren();
  });
  D.btnNotizenNach.addEventListener('click', () => {
    notizenSpeichern();
    Z.notizenSeite = Math.min(Z.seitenAnzahl || 1, Z.notizenSeite + 1);
    notizenAnzeigenAktualisieren();
  });

  // Textarea: Auto-Speichern bei jeder Eingabe
  D.notizenTextarea.addEventListener('input', () => {
    Z.notizenProSeite[Z.notizenSeite] = D.notizenTextarea.value;
  });

  // Vorlagen einfügen
  D.vorlagenBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const schluessel = btn.dataset.vorlage;
      const text = VORLAGEN[schluessel] || '';
      const ta   = D.notizenTextarea;
      const pos  = ta.selectionStart;
      const vorher = ta.value.slice(0, pos);
      const nachher = ta.value.slice(ta.selectionEnd);
      const trennzeichen = vorher.length > 0 && !vorher.endsWith('\n') ? '\n\n' : '';
      ta.value = vorher + trennzeichen + text + '\n' + nachher;
      ta.selectionStart = ta.selectionEnd = pos + trennzeichen.length + text.length + 1;
      ta.focus();
      notizenSpeichern();
    });
  });

  // Notiz der aktuellen Seite löschen
  D.btnNotizenLoeschen.addEventListener('click', () => {
    if (!window.confirm(`Notiz für Seite ${Z.notizenSeite} löschen?`)) return;
    Z.notizenProSeite[Z.notizenSeite] = '';
    D.notizenTextarea.value = '';
    toast('Notiz gelöscht.', 'info');
  });

  // Alle Notizen als Textdatei exportieren
  D.btnNotizenExportieren.addEventListener('click', () => {
    let inhalt = `EduLayer – Lehrer-Notizen\nExportiert: ${new Date().toLocaleString('de-DE')}\n`;
    inhalt += '═'.repeat(40) + '\n\n';
    for (let s = 1; s <= (Z.seitenAnzahl || 1); s++) {
      const notiz = Z.notizenProSeite[s];
      if (notiz?.trim()) {
        inhalt += `── Seite ${s} ──\n${notiz}\n\n`;
      }
    }
    if (inhalt.trim().split('\n').length <= 4) {
      toast('Keine Notizen vorhanden.', 'info'); return;
    }
    download(
      new TextEncoder().encode(inhalt),
      `EduLayer_Notizen_${zeitstempel()}.txt`,
      'text/plain;charset=utf-8'
    );
    toast('Notizen exportiert.', 'erfolg');
  });
}


/* ═══════════════════════════════════════════════════════════════════
   8. SIDEBAR-LOGIK
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
  D.btnGeodrei.addEventListener('click',      geodreieckUmschalten);
  D.btnLehrerLayer.addEventListener('click',  lehrerLayerUmschalten);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
    if (e.key === 'Escape') {
      if (Z.einstellungenOffen) einstellungenSchliessen();
      else if (Z.notizenOffen)  notizenSchliessen();
      else if (Z.spotlightAktiv) spotlightAus();
      else if (Z.geodreieckAktiv) geodreieckAus();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   9. SCROLL-MODUS
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
   10. ZEICHEN-ENGINE
   Textmarker-Technik (konstantes Alpha ohne Überlappungs-Artefakte):
   ──────────────────────────────────────────────────────────────────
   Problem: Wenn man globalAlpha auf einem Canvas setzt und über eine
   bereits gezeichnete Linie fährt, addieren sich die Alphas → dunklere
   Überlappungen sichtbar.
   
   Lösung: Offscreen-Canvas.
   1. Beim Marker-Start: leeren Offscreen-Canvas erstellen (selbe Größe).
   2. Während touchmove: Marker-Strich auf Offscreen-Canvas mit vollem
      Alpha zeichnen (globalAlpha = 1, strokeStyle = Farbe ohne Alpha).
   3. Beim Marker-Ende: Offscreen-Canvas wird mit dem konfigurierten
      Alpha auf den Haupt-Canvas gezeichnet (globalAlpha = TEXTMARKER_ALPHA).
   → Überlappungen innerhalb eines Strichs werden NICHT doppelt transparent.
════════════════════════════════════════════════════════════════════ */

function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}

/** Strich-Start */
function strichStarten(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (e.touches?.length > 1) return;
  if (Z.spotlightAktiv) return;

  if (Z.werkzeug === 'laser') { laserStarten(e); return; }

  e.preventDefault();
  Z.zeichnet = true;

  // Geodreieck-Snap: Startpunkt ggf. auf Kante einrasten
  let p = koordinaten(e, canvas);
  if (Z.geodreieckAktiv) {
    const snap = geodreieckSnapPunkt(e, canvas);
    if (snap) p = snap;
  }
  Z.letzterPunkt = p;

  const seite = +canvas.closest('.seite-container').dataset.seite;
  undoSnapshot(seite);

  if (Z.werkzeug === 'textmarker') {
    // Offscreen-Canvas für diesen Marker-Strich erstellen
    const off = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    const offCtx = off.getContext('2d');
    offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
    offCtx.lineWidth = Z.strichbreite;
    offCtx.strokeStyle = Z.strichfarbe;
    offCtx.globalAlpha = 1;
    // Strich-Objekt mit Referenz auf Offscreen
    Z.aktuellerStrich = {
      punkte: [{ ...p }],
      farbe: Z.strichfarbe, breite: Z.strichbreite,
      werkzeug: 'textmarker',
      alpha: KONFIGURATION.TEXTMARKER_ALPHA,
      offCanvas: off, offCtx,
    };
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
  } else if (Z.werkzeug !== 'radierer') {
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.aktuellerStrich = {
      punkte: [{ ...p }], farbe: Z.strichfarbe,
      breite: Z.strichbreite, werkzeug: Z.werkzeug,
    };
    // Startpunkt für normale Stifte zeichnen
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = Z.strichfarbe;
    ctx.fillStyle   = Z.strichfarbe;
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Z.strichbreite / 2, 0, Math.PI * 2);
    ctx.fill();
    ctxReset(ctx);
  } else {
    Z.aktuellerStrich = null;
  }
}

/** Strich-Bewegen */
function strichBewegen(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (Z.werkzeug === 'laser') { laserBewegen(e); return; }
  if (e.touches?.length === 2) {
    if (Z.zeichnet) { Z.zeichnet = false; Z.aktuellerStrich = null; }
    pinchBewegen(e); return;
  }
  if (!Z.zeichnet) return;
  e.preventDefault();

  let p = koordinaten(e, canvas);
  // Geodreieck-Snap
  if (Z.geodreieckAktiv) {
    const snap = geodreieckSnapPunkt(e, canvas);
    if (snap) p = snap;
  }

  if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCtx) {
    // Auf Offscreen-Canvas zeichnen
    const offCtx = Z.aktuellerStrich.offCtx;
    offCtx.beginPath();
    offCtx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
    offCtx.lineTo(p.x, p.y);
    offCtx.stroke();

    // Haupt-Canvas: Offscreen mit Alpha drauf rendern
    // Zuerst Haupt-Canvas komplett neu zusammensetzen:
    // 1. Bisherige dauerhafte Annotationen neu zeichnen
    // 2. Offscreen-Canvas mit Alpha drauf
    // (Vereinfachung: nur Offscreen neu rendern – setzt vorherige Stifte voraus)
    const ctx = canvas.getContext('2d');
    // Vorherigen Marker-Preview löschen (nur den Bereich des aktuellen Strichs)
    // Wir nutzen einen Trick: speichere Snapshot vor dem Marker-Start (bereits in undoSnapshot)
    // und zeichne ihn + Offscreen neu
    const seite = +canvas.closest('.seite-container').dataset.seite;
    const verlauf = Z.undoVerlauf[seite];
    if (verlauf?.length) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        ctx.globalAlpha = KONFIGURATION.TEXTMARKER_ALPHA;
        ctx.drawImage(Z.aktuellerStrich.offCanvas, 0, 0);
        ctx.globalAlpha = 1;
      };
      img.src = verlauf[verlauf.length - 1];
    }

    Z.aktuellerStrich.punkte.push({ ...p });
  } else if (Z.werkzeug === 'radierer') {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = Z.strichbreite;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctxReset(ctx);
  } else {
    // Normale Stifte
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = Z.strichfarbe;
    ctx.lineWidth   = Z.strichbreite;
    ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctxReset(ctx);
    if (Z.aktuellerStrich) Z.aktuellerStrich.punkte.push({ ...p });
  }

  Z.letzterPunkt = p;
}

/** Strich-Ende */
function strichBeenden(e, canvas) {
  if (Z.werkzeug === 'laser') { laserBeenden(); return; }
  if (!Z.zeichnet) return;
  e.preventDefault();
  Z.zeichnet = false;

  if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCanvas) {
    // Finaler Marker-Strich: Offscreen mit Alpha dauerhaft auf Haupt-Canvas
    const ctx = canvas.getContext('2d');
    const seite = +canvas.closest('.seite-container').dataset.seite;
    const verlauf = Z.undoVerlauf[seite];
    if (verlauf?.length) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        ctx.globalAlpha = KONFIGURATION.TEXTMARKER_ALPHA;
        ctx.drawImage(Z.aktuellerStrich.offCanvas, 0, 0);
        ctx.globalAlpha = 1;
        // Offscreen nicht mehr brauchen → im Annotations-Array ohne offCanvas speichern
        const strichOhneOff = {
          punkte: Z.aktuellerStrich.punkte,
          farbe: Z.aktuellerStrich.farbe,
          breite: Z.aktuellerStrich.breite,
          werkzeug: 'textmarker',
          alpha: Z.aktuellerStrich.alpha,
        };
        if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
        Z.annotationen[seite].push(strichOhneOff);
      };
      img.src = verlauf[verlauf.length - 1];
    }
  } else if (Z.aktuellerStrich) {
    const seite = +canvas.closest('.seite-container').dataset.seite;
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.annotationen[seite].push(Z.aktuellerStrich);
  }

  Z.aktuellerStrich = null;
  Z.letzterPunkt    = null;
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

/** Annotationen auf Canvas zeichnen (für Undo/Layer). */
function stricheZeichnen(ctx, striche) {
  if (!striche?.length) return;
  striche.forEach(s => {
    if (!s.punkte?.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.breite;
    if (s.werkzeug === 'textmarker') {
      // Für den Textmarker beim Neu-Zeichnen auch Offscreen-Technik nutzen
      const off = document.createElement('canvas');
      off.width = ctx.canvas.width; off.height = ctx.canvas.height;
      const offCtx = off.getContext('2d');
      offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
      offCtx.lineWidth = s.breite; offCtx.strokeStyle = s.farbe;
      offCtx.beginPath(); offCtx.moveTo(s.punkte[0].x, s.punkte[0].y);
      for (let i = 1; i < s.punkte.length; i++) offCtx.lineTo(s.punkte[i].x, s.punkte[i].y);
      offCtx.stroke();
      ctx.globalAlpha = s.alpha ?? KONFIGURATION.TEXTMARKER_ALPHA;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.farbe; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(s.punkte[0].x, s.punkte[0].y);
      for (let i = 1; i < s.punkte.length - 1; i++) {
        const mx = (s.punkte[i].x + s.punkte[i+1].x) / 2;
        const my = (s.punkte[i].y + s.punkte[i+1].y) / 2;
        ctx.quadraticCurveTo(s.punkte[i].x, s.punkte[i].y, mx, my);
      }
      const lp = s.punkte[s.punkte.length - 1];
      ctx.lineTo(lp.x, lp.y); ctx.stroke();
      ctxReset(ctx);
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   11. LASERPOINTER
════════════════════════════════════════════════════════════════════ */
function laserCanvasAnpassen() {
  D.laserCanvas.width  = window.innerWidth;
  D.laserCanvas.height = window.innerHeight;
}

function laserZeichnen() {
  const lc = D.laserCanvas, ctx = lc.getContext('2d');
  ctx.clearRect(0, 0, lc.width, lc.height);
  const schweif = Z.laserSchweif;
  if (!schweif.length) return;
  const jetzt = Date.now(), fade = KONFIGURATION.LASER_FADE_MS;
  const r = KONFIGURATION.LASER_PX;
  for (let i = 0; i < schweif.length - 1; i++) {
    const alter = jetzt - schweif[i].t;
    const alpha = Math.max(0, 0.65 * (1 - alter / (fade * 1.5)));
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(schweif[i].x, schweif[i].y);
    ctx.lineTo(schweif[i+1].x, schweif[i+1].y);
    ctx.strokeStyle = KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = r * 0.4 * ((i+1) / schweif.length);
    ctx.lineCap     = 'round';
    ctx.shadowBlur  = 8; ctx.shadowColor = KONFIGURATION.LASER_FARBE;
    ctx.stroke();
  }
  if (schweif.length > 0) {
    const lp = schweif[schweif.length - 1];
    const alter = jetzt - lp.t;
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha = Z.laserAktiv ? 1 : Math.max(0, 1 - alter / fade);
    ctx.shadowBlur  = 22; ctx.shadowColor = KONFIGURATION.LASER_FARBE;
    ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  const aeltester = schweif[0];
  const nochSichtbar = Z.laserAktiv || (aeltester && jetzt - aeltester.t < fade * 2);
  if (nochSichtbar) {
    Z.laserAnimFrame = requestAnimationFrame(laserZeichnen);
  } else {
    ctx.clearRect(0, 0, lc.width, lc.height);
    Z.laserAnimFrame = null; Z.laserSchweif = [];
  }
}
function laserPunkt(cx, cy) {
  Z.laserSchweif.push({ x: cx, y: cy, t: Date.now() });
  if (Z.laserSchweif.length > KONFIGURATION.LASER_SCHWEIF_MAX) Z.laserSchweif.shift();
}
function laserStarten(e) {
  e.preventDefault(); Z.laserAktiv = true; Z.laserSchweif = [];
  const t = e.touches?.[0] ?? e;
  laserPunkt(t.clientX, t.clientY);
  if (!Z.laserAnimFrame) Z.laserAnimFrame = requestAnimationFrame(laserZeichnen);
}
function laserBewegen(e) {
  if (!Z.laserAktiv) return; e.preventDefault();
  const t = e.touches?.[0] ?? e;
  laserPunkt(t.clientX, t.clientY);
}
function laserBeenden() { Z.laserAktiv = false; }


/* ═══════════════════════════════════════════════════════════════════
   12. UNDO / REDO
════════════════════════════════════════════════════════════════════ */
function undoSnapshot(seite) {
  const canvas = zeichenCanvas(seite); if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  const v = Z.undoVerlauf[seite];
  v.push(canvas.toDataURL());
  if (v.length > 30) v.shift();
  Z.redoVerlauf[seite] = [];
}
function undoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.undoVerlauf[seite]?.length) { toast('Kein Rückgängig-Schritt.', 'info', 1500); return; }
  const canvas = zeichenCanvas(seite); if (!canvas) return;
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  Z.redoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.undoVerlauf[seite].pop());
  if (Z.annotationen[seite]?.length) Z.annotationen[seite].pop();
}
function redoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.redoVerlauf[seite]?.length) { toast('Kein Wiederholen-Schritt.', 'info', 1500); return; }
  const canvas = zeichenCanvas(seite); if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  Z.undoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.redoVerlauf[seite].pop());
}
function snapshotLaden(canvas, url) {
  const ctx = canvas.getContext('2d'), img = new Image();
  img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0); };
  img.src = url;
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
   13. LEHRER-LAYER
════════════════════════════════════════════════════════════════════ */
function lehrerLayerUmschalten() {
  Z.lehrerAktiv = !Z.lehrerAktiv;
  D.btnLehrerLayer.classList.toggle('aktiv', Z.lehrerAktiv);
  D.btnLehrerLayer.setAttribute('aria-pressed', Z.lehrerAktiv ? 'true' : 'false');
  D.iconAugeAuf.style.display = Z.lehrerAktiv ? 'block' : 'none';
  D.iconAugeZu.style.display  = Z.lehrerAktiv ? 'none'  : 'block';
  for (let s = 1; s <= Z.seitenAnzahl; s++) {
    const lc = lehrerCanvas(s); if (!lc) continue;
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
   14. GEODREIECK
   ──────────────────────────────────────────────────────────────────
   Das Geodreieck ist ein SVG-Overlay im hauptbereich.
   Es hat drei Kanten:
     A: Grundlinie (Basis, horizontal bei 0°) – mit cm-Teilung
     B: Senkreche (linke Kante, vertikal bei 0°) – mit cm-Teilung
     C: Hypotenuse (diagonal) – mit Winkelskala
   
   Echtmaß-Kalibrierung:
   Beim Laden einer PDF wird die Pixeldichte berechnet:
     pxProCm = (canvas.width / pdf_breite_pt) * (72/2.54) * PDF_SCALE
   Die SVG-Breite wird dann gesetzt auf: GEO_CM_LAENGE * pxProCm.
   
   Stift-Snap:
   Wenn das Geodreieck aktiv ist, wird bei jedem touchmove geprüft,
   ob der Touch-Punkt näher als GEO_SNAP_PX an einer Kante liegt.
   Falls ja: Punkt wird auf die Kante projiziert (eingerastet).
════════════════════════════════════════════════════════════════════ */

/** Geodreieck einschalten. */
function geodreieckAn() {
  Z.geodreieckAktiv = true;
  D.geoWrapper.style.display = 'block';
  D.geoWrapper.setAttribute('aria-hidden', 'false');
  D.btnGeodrei.classList.add('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'true');
  geodreieckSkalierenNachZoom();
  geodreieckZeichnen();
  geodreieckPositionAnwenden();
  toast('Geodreieck aktiv – Stift rastet an Kanten ein', 'info', 2500);
}

/** Geodreieck ausschalten. */
function geodreieckAus() {
  Z.geodreieckAktiv = false;
  D.geoWrapper.style.display = 'none';
  D.geoWrapper.setAttribute('aria-hidden', 'true');
  D.btnGeodrei.classList.remove('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'false');
  // Führungslinie ausblenden
  D.geoFuehrung.setAttribute('display', 'none');
}

function geodreieckUmschalten() { Z.geodreieckAktiv ? geodreieckAus() : geodreieckAn(); }

/**
 * Skalierung des Geodreiecks basierend auf PDF-Pixeldichte und aktuellem Zoom.
 * Wird nach PDF-Laden und bei Zoom-Änderungen aufgerufen.
 */
function geodreieckSkalierenNachZoom() {
  const seite    = Z.aktiveSeite;
  const pxProCm  = Z.pxProCm[seite] || 37.8; // Fallback: 96dpi / 2.54
  // Geodreieck-Breite in Pixel = Länge in cm × px/cm × aktueller Zoom
  const breite   = KONFIGURATION.GEO_CM_LAENGE * pxProCm * Z.zoom;
  const hoehe    = breite / 2;  // viewBox-Verhältnis 300:150 = 2:1
  Z.geoSkalierung = breite / 300; // px pro viewBox-Einheit
  D.geoSvg.style.width  = `${breite}px`;
  D.geoSvg.style.height = `${hoehe}px`;
}

/** SVG-Inhalt des Geodreiecks zeichnen (Skalen, Beschriftungen). */
function geodreieckZeichnen() {
  const farbe     = KONFIGURATION.GEO_FARBE;
  const hellFarbe = farbe + 'aa'; // halbtransparent
  const strich    = farbe + 'cc';

  // ── Grundlinie (A): von (0,150) nach (300,150) ─────────────────
  // 15 cm Länge, Teilstriche alle mm
  let glHtml = '';
  for (let mm = 0; mm <= 150; mm++) {  // 150 mm = 15 cm
    const x   = mm * 2;    // 2 SVG-Einheiten pro mm
    const y   = 150;
    const len = mm % 10 === 0 ? 8   // cm-Strich
              : mm % 5  === 0 ? 5   // halber cm
              : 2.5;                 // mm-Strich
    const schwere = mm % 10 === 0 ? '1.0' : '0.5';
    glHtml += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - len}"
      stroke="${strich}" stroke-width="${schwere}"/>`;
    // Zentimeter-Beschriftung
    if (mm % 10 === 0 && mm > 0 && mm < 150) {
      glHtml += `<text x="${x}" y="${y - 11}" text-anchor="middle"
        class="geo-label" fill="${farbe}">${mm/10}</text>`;
    }
  }
  // "0" ganz links
  glHtml += `<text x="2" y="141" class="geo-label" fill="${farbe}">0</text>`;
  D.geoGrundlinie.innerHTML = glHtml;

  // ── Senkrechte (B): von (0,150) nach (0,0) ─────────────────────
  // 7.5 cm Länge (halbe Breite)
  let hHtml = '';
  for (let mm = 0; mm <= 75; mm++) {
    const y   = 150 - mm * 2;
    const len = mm % 10 === 0 ? 8 : mm % 5 === 0 ? 5 : 2.5;
    const schwere = mm % 10 === 0 ? '1.0' : '0.5';
    hHtml += `<line x1="0" y1="${y}" x2="${len}" y2="${y}"
      stroke="${strich}" stroke-width="${schwere}"/>`;
    if (mm % 10 === 0 && mm > 0) {
      hHtml += `<text x="${len + 2}" y="${y + 2}" class="geo-label"
        fill="${farbe}">${mm/10}</text>`;
    }
  }
  D.geoHoehenG.innerHTML = hHtml;

  // ── Winkelskala am rechten Winkel (Hypotenuse) ─────────────────
  // Winkel 0°–90° entlang der Hypotenuse, Bogen-Radius 20 SVG-Einheiten
  let wHtml = '';
  const bogR = 22;
  // Kleiner Winkelbogen am rechten Winkel (unten links)
  wHtml += `<path d="M ${bogR} 150 A ${bogR} ${bogR} 0 0 0 0 ${150 - bogR}"
    fill="none" stroke="${strich}" stroke-width="0.8"/>`;
  // Rechter-Winkel-Symbol
  wHtml += `<polyline points="8,150 8,142 0,142"
    fill="none" stroke="${strich}" stroke-width="0.9"/>`;
  // Winkelmarkierungen entlang der Hypotenuse
  // Hypotenuse von (0,0) nach (300,150): Richtungsvektor (300,150), normiert
  const hypLen = Math.hypot(300, 150);
  const hnx = 300 / hypLen, hny = 150 / hypLen;  // Einheitsvektor entlang Hyp.
  const hnpx = -hny, hnpy = hnx;                  // Senkrecht zur Hyp.
  for (let grad = 5; grad < 90; grad += 5) {
    // Punkt auf der Hypotenuse bei diesem Winkel
    const t    = (grad / 90) * hypLen;
    const hx   = hnx * t, hy = hny * t;
    const lang = grad % 10 === 0 ? 6 : 3.5;
    wHtml += `<line
      x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}"
      x2="${(hx + hnpx * lang).toFixed(1)}" y2="${(hy + hnpy * lang).toFixed(1)}"
      stroke="${strich}" stroke-width="0.7"/>`;
    if (grad % 10 === 0) {
      const tx = hx + hnpx * (lang + 3);
      const ty = hy + hnpy * (lang + 3);
      wHtml += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"
        text-anchor="middle" dominant-baseline="middle"
        class="geo-label" fill="${farbe}"
        transform="rotate(${-Math.atan2(hny, hnx) * 180/Math.PI},
          ${tx.toFixed(1)},${ty.toFixed(1)})">${grad}°</text>`;
    }
  }
  // Außen-Winkelskala: 0°–90° oben am Bogen
  wHtml += `<text x="26" y="148" class="geo-label" fill="${farbe}">0°</text>`;
  wHtml += `<text x="4"  y="128" class="geo-label" fill="${farbe}">90°</text>`;
  D.geoWinkelG.innerHTML = wHtml;

  // Hypotenuse: Kante von (300,150) nach (0,0)
  let hyHtml = `<line x1="300" y1="150" x2="0" y2="0"
    stroke="${strich}" stroke-width="1.2"/>`;
  D.geoHypotenuse.innerHTML = hyHtml;
}

/** Geodreieck-Position und Rotation per CSS-Transform anwenden. */
function geodreieckPositionAnwenden() {
  const { x, y } = Z.geoPos;
  const w = Z.geoWinkel;
  D.geoWrapper.style.transform = `translate(${x}px, ${y}px) rotate(${w}deg)`;
}

/**
 * Berechnet die drei Kanten des Geodreiecks in Client-Koordinaten.
 * Rückgabe: [ { p1:{x,y}, p2:{x,y} }, … ] – drei Kanten
 */
function geodreieckKantenBerechnen() {
  const rect   = D.geoWrapper.getBoundingClientRect();
  const svgRect = D.geoSvg.getBoundingClientRect();
  const sk     = Z.geoSkalierung;
  const winRad = Z.geoWinkel * Math.PI / 180;
  const cos    = Math.cos(winRad), sin = Math.sin(winRad);

  // Eckpunkte in SVG-Koordinaten
  const ecken = [
    { x: 0,   y: 0   },   // Spitze (oben links)
    { x: 300, y: 150 },   // rechts unten (rechter Winkel)
    { x: 0,   y: 150 },   // links unten
  ];

  // Umrechnung in Client-Koordinaten (Rotation um Ursprung des Wrappers)
  const wrapper = D.geoWrapper.getBoundingClientRect();
  const originX = wrapper.left;
  const originY = wrapper.top;

  const punkte = ecken.map(e => {
    const px = e.x * sk * cos - e.y * sk * sin + originX;
    const py = e.x * sk * sin + e.y * sk * cos + originY;
    return { x: px, y: py };
  });

  return [
    { p1: punkte[0], p2: punkte[1], name: 'hypotenuse' },  // Hypotenuse: Spitze → rechts unten
    { p1: punkte[1], p2: punkte[2], name: 'grundlinie' },   // Grundlinie: rechts → links unten
    { p1: punkte[2], p2: punkte[0], name: 'senkrechte' },   // Senkrechte: links unten → Spitze
  ];
}

/**
 * Projiziert einen Punkt auf eine Linie (Strecke p1–p2).
 * Rückgabe: { x, y } – nächster Punkt auf der Linie.
 */
function punktAufLinieProjectieren(p, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return { ...p1 };
  const t = Math.max(0, Math.min(1, ((p.x-p1.x)*dx + (p.y-p1.y)*dy) / lenSq));
  return { x: p1.x + t*dx, y: p1.y + t*dy };
}

/**
 * Snap-Prüfung: Gibt projizierten Punkt auf dem Zeichen-Canvas zurück,
 * falls der Touch nahe genug an einer Geodreieck-Kante ist.
 * Koordinaten werden in Canvas-Raum umgerechnet.
 *
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 * @returns {{ x, y }|null}
 */
function geodreieckSnapPunkt(e, canvas) {
  if (!Z.geodreieckAktiv) return null;

  const client = clientKoordinaten(e);
  const kanten = geodreieckKantenBerechnen();
  const snapDist = KONFIGURATION.GEO_SNAP_PX;

  let naechsteKante = null, minDist = Infinity;

  for (const kante of kanten) {
    const proj = punktAufLinieProjectieren(client, kante.p1, kante.p2);
    const dist = Math.hypot(client.x - proj.x, client.y - proj.y);
    if (dist < snapDist && dist < minDist) {
      minDist = dist;
      naechsteKante = { proj, kante };
    }
  }

  if (!naechsteKante) {
    // Keine Kante in der Nähe – Führungslinie ausblenden
    D.geoFuehrung.setAttribute('display', 'none');
    return null;
  }

  // Führungslinie im SVG aktualisieren (zeigt aktive Kante)
  // Kante in SVG-Koordinaten umrechnen für die Linie
  D.geoFuehrung.setAttribute('display', 'inline');

  // Projizierten Punkt von Client-Koordinaten → Canvas-Koordinaten umrechnen
  const canvasRect = canvas.getBoundingClientRect();
  const skalX = canvas.width  / canvasRect.width;
  const skalY = canvas.height / canvasRect.height;
  return {
    x: (naechsteKante.proj.x - canvasRect.left) * skalX,
    y: (naechsteKante.proj.y - canvasRect.top)  * skalY,
  };
}

/** Geodreieck-Drag und Rotation initialisieren. */
function geodreieckInit() {
  // ── Move-Griff ─────────────────────────────────────────────────
  D.geoMoveGriff.addEventListener('touchstart', e => {
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    Z.geoDrag = { art: 'move', startX: t.clientX, startY: t.clientY,
                  startPos: { ...Z.geoPos } };
  }, { passive: false });
  D.geoMoveGriff.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    Z.geoDrag = { art: 'move', startX: e.clientX, startY: e.clientY,
                  startPos: { ...Z.geoPos } };
  });

  // ── Dreh-Griff ─────────────────────────────────────────────────
  D.geoDrehGriff.addEventListener('touchstart', e => {
    e.preventDefault(); e.stopPropagation();
    const t    = e.touches[0];
    const rect = D.geoWrapper.getBoundingClientRect();
    // Drehpunkt = untere linke Ecke des Wrappers (rechter Winkel des Geodreiecks)
    const pivotX = rect.left;
    const pivotY = rect.top + D.geoSvg.getBoundingClientRect().height;
    Z.geoDrag = { art: 'rotate', pivotX, pivotY,
                  startWinkel: winkelZwischen(pivotX, pivotY, t.clientX, t.clientY) - Z.geoWinkel };
  }, { passive: false });
  D.geoDrehGriff.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const rect   = D.geoWrapper.getBoundingClientRect();
    const pivotX = rect.left;
    const pivotY = rect.top + D.geoSvg.getBoundingClientRect().height;
    Z.geoDrag = { art: 'rotate', pivotX, pivotY,
                  startWinkel: winkelZwischen(pivotX, pivotY, e.clientX, e.clientY) - Z.geoWinkel };
  });

  // ── Globale Move-Events ─────────────────────────────────────────
  document.addEventListener('touchmove', e => {
    if (!Z.geoDrag) return;
    e.preventDefault();
    const t = e.touches[0];
    _geoDragBewegen(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('mousemove', e => {
    if (!Z.geoDrag) return;
    _geoDragBewegen(e.clientX, e.clientY);
  });
  document.addEventListener('touchend',  () => { Z.geoDrag = null; });
  document.addEventListener('mouseup',   () => { Z.geoDrag = null; });
}

function _geoDragBewegen(cx, cy) {
  if (!Z.geoDrag) return;
  if (Z.geoDrag.art === 'move') {
    const dx = cx - Z.geoDrag.startX, dy = cy - Z.geoDrag.startY;
    Z.geoPos = { x: Z.geoDrag.startPos.x + dx, y: Z.geoDrag.startPos.y + dy };
    geodreieckPositionAnwenden();
  } else if (Z.geoDrag.art === 'rotate') {
    const neuerWinkel = winkelZwischen(Z.geoDrag.pivotX, Z.geoDrag.pivotY, cx, cy)
                        - Z.geoDrag.startWinkel;
    // Auf 1°-Schritte einrasten (optional, für genaues Arbeiten)
    Z.geoWinkel = Math.round(neuerWinkel);
    geodreieckPositionAnwenden();
  }
}


/* ═══════════════════════════════════════════════════════════════════
   15. SPOTLIGHT
════════════════════════════════════════════════════════════════════ */
function spotlightAn() {
  Z.spotlightAktiv = true;
  Z.spotFenster = {
    x: (window.innerWidth  - KONFIGURATION.SPOTLIGHT_START_B) / 2,
    y: (window.innerHeight - KONFIGURATION.SPOTLIGHT_START_H) / 2,
    b: KONFIGURATION.SPOTLIGHT_START_B, h: KONFIGURATION.SPOTLIGHT_START_H,
  };
  D.spotlightOverlay.style.display = 'block';
  D.spotlightOverlay.setAttribute('aria-hidden', 'false');
  D.btnSpotlight.classList.add('aktiv');
  D.btnSpotlight.setAttribute('aria-pressed', 'true');
  spotlightAktualisieren();
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
  const f = Z.spotFenster;
  D.spotlightFenster.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.b}px;height:${f.h}px;`;
  D.spotlightFenster.classList.toggle('oval', Z.spotlightForm === 'oval');
  const maske = D.spotlightMaske, W = window.innerWidth, H = window.innerHeight;
  if (Z.spotlightForm === 'oval') {
    const m = `radial-gradient(ellipse ${f.b/2}px ${f.h/2}px at ${f.x+f.b/2}px ${f.y+f.h/2}px, transparent 99%, black 100%)`;
    maske.style.webkitMaskImage = m; maske.style.maskImage = m; maske.style.clipPath = '';
  } else {
    maske.style.webkitMaskImage = ''; maske.style.maskImage = '';
    maske.style.clipPath = `polygon(0 0,${W}px 0,${W}px ${H}px,0 ${H}px,0 0,${f.x}px ${f.y}px,${f.x}px ${f.y+f.h}px,${f.x+f.b}px ${f.y+f.h}px,${f.x+f.b}px ${f.y}px,${f.x}px ${f.y}px)`;
  }
}
function spotDragStartSetzen(griff, cx, cy) {
  Z.spotGriff = griff;
  Z.spotDragStart = { startX:cx, startY:cy, fx:Z.spotFenster.x, fy:Z.spotFenster.y, fb:Z.spotFenster.b, fh:Z.spotFenster.h };
}
function spotGriffZiehen(cx, cy) {
  if (!Z.spotGriff || !Z.spotDragStart) return;
  const s = Z.spotDragStart, f = Z.spotFenster;
  const dx = cx-s.startX, dy = cy-s.startY;
  const MB = KONFIGURATION.SPOTLIGHT_MIN_B, MH = KONFIGURATION.SPOTLIGHT_MIN_H;
  switch (Z.spotGriff) {
    case 'mitte': f.x=Math.max(0,Math.min(s.fx+dx,window.innerWidth-f.b)); f.y=Math.max(0,Math.min(s.fy+dy,window.innerHeight-f.h)); break;
    case 'se':    f.b=Math.max(MB,s.fb+dx); f.h=Math.max(MH,s.fh+dy); break;
    case 'sw':    f.b=Math.max(MB,s.fb-dx); f.x=s.fx+s.fb-f.b; f.h=Math.max(MH,s.fh+dy); break;
    case 'ne':    f.b=Math.max(MB,s.fb+dx); f.h=Math.max(MH,s.fh-dy); f.y=s.fy+s.fh-f.h; break;
    case 'nw':    f.b=Math.max(MB,s.fb-dx); f.h=Math.max(MH,s.fh-dy); f.x=s.fx+s.fb-f.b; f.y=s.fy+s.fh-f.h; break;
    case 'e':     f.b=Math.max(MB,s.fb+dx); break;
    case 'w':     f.b=Math.max(MB,s.fb-dx); f.x=s.fx+s.fb-f.b; break;
    case 'n':     f.h=Math.max(MH,s.fh-dy); f.y=s.fy+s.fh-f.h; break;
    case 's':     f.h=Math.max(MH,s.fh+dy); break;
  }
  spotlightAktualisieren();
}
function spotlightInit() {
  D.spotGriffe = document.querySelectorAll('.spot-griff');
  D.spotGriffe.forEach(g => {
    g.addEventListener('touchstart', e => { if (!Z.spotlightAktiv) return; e.preventDefault(); e.stopPropagation(); spotDragStartSetzen(g.dataset.griff, e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    g.addEventListener('mousedown',  e => { if (!Z.spotlightAktiv) return; e.preventDefault(); e.stopPropagation(); spotDragStartSetzen(g.dataset.griff, e.clientX, e.clientY); });
  });
  const fen = D.spotlightFenster;
  const fenInnen = (x,y) => { const f=Z.spotFenster,r=22; return x>f.x+r&&x<f.x+f.b-r&&y>f.y+r&&y<f.y+f.h-r?'mitte':null; };
  fen.addEventListener('touchstart', e => { if (!Z.spotlightAktiv||e.target.classList.contains('spot-griff')) return; e.preventDefault(); const t=e.touches[0]; if(fenInnen(t.clientX,t.clientY)) spotDragStartSetzen('mitte',t.clientX,t.clientY); }, { passive: false });
  fen.addEventListener('mousedown', e => { if (!Z.spotlightAktiv||e.target.classList.contains('spot-griff')) return; if(fenInnen(e.clientX,e.clientY)) spotDragStartSetzen('mitte',e.clientX,e.clientY); });
  document.addEventListener('touchmove', e => { if (!Z.spotlightAktiv||!Z.spotGriff) return; e.preventDefault(); spotGriffZiehen(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  document.addEventListener('touchend', () => { Z.spotGriff=null; Z.spotDragStart=null; }, { passive: false });
  document.addEventListener('mousemove', e => { if (Z.spotlightAktiv&&Z.spotGriff) spotGriffZiehen(e.clientX,e.clientY); });
  document.addEventListener('mouseup', () => { Z.spotGriff=null; Z.spotDragStart=null; });
  D.btnSpotRechteck.addEventListener('click', () => { Z.spotlightForm='rechteck'; D.btnSpotRechteck.classList.add('aktiv'); D.btnSpotRechteck.setAttribute('aria-pressed','true'); D.btnSpotOval.classList.remove('aktiv'); D.btnSpotOval.setAttribute('aria-pressed','false'); spotlightAktualisieren(); });
  D.btnSpotOval.addEventListener('click', () => { Z.spotlightForm='oval'; D.btnSpotOval.classList.add('aktiv'); D.btnSpotOval.setAttribute('aria-pressed','true'); D.btnSpotRechteck.classList.remove('aktiv'); D.btnSpotRechteck.setAttribute('aria-pressed','false'); spotlightAktualisieren(); });
  D.btnSpotSchliessen.addEventListener('click', spotlightAus);
}


/* ═══════════════════════════════════════════════════════════════════
   16. ZOOM
════════════════════════════════════════════════════════════════════ */
function zoomSetzen(n) {
  Z.zoom = Math.min(KONFIGURATION.ZOOM_MAX, Math.max(KONFIGURATION.ZOOM_MIN, n));
  D.pdfContainer.style.transform = `scale(${Z.zoom})`;
  D.pdfContainer.style.transformOrigin = 'top center';
  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;
  // Geodreieck neu skalieren
  if (Z.geodreieckAktiv) geodreieckSkalierenNachZoom();
}
function pinchBewegen(e) {
  if (e.touches.length !== 2) return; e.preventDefault();
  const ab = pinchAbstand(e.touches);
  if (!Z.pinch) { Z.pinch = { abstand: ab, zoomStart: Z.zoom }; return; }
  zoomSetzen(Z.pinch.zoomStart * (ab / Z.pinch.abstand));
}
function zoomInit() {
  D.btnZoomPlus.addEventListener('click',  () => zoomSetzen(Z.zoom + KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomMinus.addEventListener('click', () => zoomSetzen(Z.zoom - KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));
  D.zoomWrapper.addEventListener('touchstart', e => { if (e.touches.length===2) Z.pinch=null; }, { passive: false });
  D.zoomWrapper.addEventListener('touchmove', e => { if (e.touches.length===2&&Z.modus==='zeichnen') { e.preventDefault(); pinchBewegen(e); } }, { passive: false });
  D.zoomWrapper.addEventListener('touchend', () => { if (Z.pinch) Z.pinch=null; }, { passive: true });
  D.zoomWrapper.addEventListener('wheel', e => { if (e.ctrlKey||e.metaKey) { e.preventDefault(); zoomSetzen(Z.zoom+(e.deltaY>0?-KONFIGURATION.ZOOM_SCHRITT:KONFIGURATION.ZOOM_SCHRITT)); } }, { passive: false });
}


/* ═══════════════════════════════════════════════════════════════════
   17. PDF-RENDERING
════════════════════════════════════════════════════════════════════ */
async function pdfLaden(datei) {
  ladeAnzeige(true, 'PDF wird geöffnet…');
  try {
    const ab = await datei.arrayBuffer();
    Z.pdfBytes = new Uint8Array(ab);
    pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER;
    Z.pdfDokument  = await pdfjsLib.getDocument({ data: Z.pdfBytes.slice() }).promise;
    Z.seitenAnzahl = Z.pdfDokument.numPages;
    Object.assign(Z, { annotationen:{}, lehrerAnnotationen:{}, undoVerlauf:{}, redoVerlauf:{}, aktiveSeite:1, viewports:{}, pxProCm:{} });
    zoomSetzen(1.0);
    D.startAnzeige.style.display = 'none';
    D.pdfContainer.innerHTML = ''; D.pdfContainer.style.display = 'flex';
    for (let i = 1; i <= Z.seitenAnzahl; i++) {
      ladeAnzeige(true, `Seite ${i} / ${Z.seitenAnzahl} wird gerendert…`);
      await pdfSeiteRendern(i);
    }
    D.zoomSteuerung.style.display = 'flex';
    // Geodreieck nach PDF-Laden neu kalibrieren
    if (Z.geodreieckAktiv) { geodreieckSkalierenNachZoom(); geodreieckZeichnen(); }
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

  // Pixel pro cm berechnen:
  // PDF-Seite: 1 Punkt = 1/72 Zoll = 2.54/72 cm
  // Pixel pro cm = PDF_SCALE × 72 / 2.54
  Z.pxProCm[nr] = KONFIGURATION.PDF_SCALE * 72 / 2.54;

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

  new IntersectionObserver(ee => {
    ee.forEach(e => { if (e.isIntersecting && e.intersectionRatio >= 0.4) Z.aktiveSeite = nr; });
  }, { root: D.zoomWrapper, threshold: 0.4 }).observe(cont);
}


/* ═══════════════════════════════════════════════════════════════════
   18. PDF-EXPORT
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
    pdfDoc.setCreator('EduLayer PWA'); pdfDoc.setModificationDate(new Date());
    const name = `EduLayer_${zeitstempel()}.pdf`;
    download(await pdfDoc.save(), name);
    toast(`Gespeichert: ${name}`, 'erfolg', 3500);
  } catch (err) {
    console.error('[EduLayer] Speicherfehler:', err);
    toast('Fehler beim Speichern.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}


/* ═══════════════════════════════════════════════════════════════════
   19. SERVICE WORKER
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
   20. APP-START
════════════════════════════════════════════════════════════════════ */
function appStart() {
  console.log('[EduLayer] v5 startet…');
  laserCanvasAnpassen();
  window.addEventListener('resize', () => {
    laserCanvasAnpassen();
    if (Z.geodreieckAktiv) geodreieckSkalierenNachZoom();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      laserCanvasAnpassen();
      if (Z.spotlightAktiv)   spotlightAktualisieren();
      if (Z.geodreieckAktiv)  geodreieckSkalierenNachZoom();
    }, 350);
  });

  themaLaden();
  sidebarInit();
  einstellungenInit();
  notizenInit();
  spotlightInit();
  geodreieckInit();
  zoomInit();

  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);
  swRegistrieren();

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
      ziel.closest('.zoom-wrapper')     ||
      ziel.closest('.sidebar')          ||
      ziel.closest('.spotlight-overlay')||
      ziel.closest('.zoom-steuerung')   ||
      ziel.closest('.spotlight-toolbar')||
      ziel.closest('.einstellungen-panel') ||
      ziel.closest('.notizen-panel')    ||
      ziel.closest('.geodreieck-wrapper');
    if (!erlaubt) e.preventDefault();
  }, { passive: false });

  console.log('[EduLayer] v5 bereit.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else {
  appStart();
}
