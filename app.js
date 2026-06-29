/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 6)                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ÄNDERUNGEN v6:
 *  - Geodreieck: Gesamte SVG-Fläche greifbar, realistisches SVG
 *  - Sidebar: Flyout-Untermenüs für Stifte und Fokus/Laser
 *  - Scroll-Fix: zoom-scaler mit transform-origin:top left, linker
 *    Rand jetzt erreichbar
 *  - Laser + Spotlight in einem Flyout gebündelt
 *  - Lehrer-Layer-Button entfernt
 *
 * STRUKTUR:
 *  1.  KONFIGURATION
 *  2.  ZUSTAND
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN
 *  5.  THEMA
 *  6.  FLYOUT-UNTERMENÜS
 *  7.  EINSTELLUNGSMENÜ
 *  8.  NOTIZEN-PANEL
 *  9.  SIDEBAR-LOGIK
 * 10.  SCROLL-MODUS
 * 11.  ZEICHEN-ENGINE
 * 12.  LASERPOINTER
 * 13.  UNDO / REDO
 * 14.  GEODREIECK
 * 15.  SPOTLIGHT
 * 16.  ZOOM (inkl. Scroll-Fix)
 * 17.  PDF-RENDERING
 * 18.  PDF-EXPORT
 * 19.  SERVICE WORKER
 * 20.  APP-START
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {
  STIFT_DUENN_PX:    2,
  STIFT_DICK_PX:     6,
  TEXTMARKER_PX:     18,
  TEXTMARKER_ALPHA:  0.32,
  RADIERER_PX:       28,
  LASER_PX:          6,
  LASER_SCHWEIF_MAX: 28,
  LASER_FADE_MS:     600,
  LASER_FARBE:       '#ff2222',
  STANDARD_FARBE:    '#1a3a6b',

  // Geodreieck
  // viewBox ist 560×280 SVG-Einheiten = 28cm × 14cm
  // (1 SVG-Einheit = 0.5mm)
  GEO_VIEWBOX_B:     560,   // viewBox-Breite
  GEO_VIEWBOX_H:     280,   // viewBox-Höhe
  GEO_CM_LAENGE:     28,    // Grundlinie in cm
  GEO_SNAP_PX:       20,    // Snap-Distanz in Bildschirm-Pixeln
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
  // Werkzeuge
  werkzeug:        'stift-duenn',
  strichfarbe:     KONFIGURATION.STANDARD_FARBE,
  strichbreite:    KONFIGURATION.STIFT_DUENN_PX,
  zeichnet:        false,
  letzterPunkt:    null,
  aktuellerStrich: null,

  // App-Modi
  modus:           'zeichnen',  // 'zeichnen' | 'scrollen'
  thema:           'dunkel',

  // Fokus-Modus: 'aus' | 'oval' | 'rechteck' | 'laser'
  fokusModus:      'aus',

  // PDF
  pdfDokument:     null,
  seitenAnzahl:    0,
  aktiveSeite:     1,
  pdfBytes:        null,
  viewports:       {},
  pxProCm:         {},

  // Annotationen
  annotationen:    {},
  undoVerlauf:     {},
  redoVerlauf:     {},

  // Lehrer-Notizen
  notizenProSeite: {},
  notizenOffen:    false,
  notizenSeite:    1,

  // Textmarker Offscreen
  markerOffscreen: null,

  // Spotlight
  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  spotGriff:       null,
  spotDragStart:   null,

  // Geodreieck
  geodreieckAktiv: false,
  geoPos:          { x: 80, y: 120 },   // Position in Hauptbereich-Koordinaten
  geoWinkel:       0,
  geoSkalierung:   1,                   // px pro SVG-Einheit
  geoDrag:         null,                // { art:'move'|'rotate', ... }
  geoSnapAktiv:    false,

  // Zoom
  zoom:            1.0,
  pinch:           null,

  // Sidebar
  sidebarSeite:    'right',

  // Laser
  laserSchweif:    [],
  laserAnimFrame:  null,
  laserAktiv:      false,

  // Flyouts
  offenesFlyout:   null,   // 'stifte' | 'fokus' | null

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
  zoomScaler:        document.getElementById('zoom-scaler'),
  pdfContainer:      document.getElementById('pdf-container'),
  startAnzeige:      document.getElementById('start-anzeige'),

  // Datei
  btnDateiLaden:     document.getElementById('btn-datei-laden'),
  btnStartLaden:     document.getElementById('btn-start-laden'),
  dateiInput:        document.getElementById('datei-input'),

  // Stift-Untermenü
  btnStiftAktiv:     document.getElementById('btn-stift-aktiv'),
  iconStiftAktiv:    document.getElementById('icon-stift-aktiv'),
  labelStiftAktiv:   document.getElementById('label-stift-aktiv'),
  flyoutStifte:      document.getElementById('flyout-stifte'),
  flyoutStiftBtns:   document.querySelectorAll('#flyout-stifte .flyout-btn'),

  // Farbpalette
  farbDots:          document.querySelectorAll('.farb-dot'),

  // Radierer (eigener Button)
  btnRadierer:       document.getElementById('btn-radierer'),

  // Verlauf
  btnUndo:           document.getElementById('btn-undo'),
  btnRedo:           document.getElementById('btn-redo'),
  btnSeiteLeeren:    document.getElementById('btn-seite-leeren'),

  // Scroll-Modus
  btnModusWechsel:   document.getElementById('btn-modus-wechsel'),

  // Fokus + Laser Untermenü
  btnFokusAktiv:     document.getElementById('btn-fokus-aktiv'),
  iconFokusAktiv:    document.getElementById('icon-fokus-aktiv'),
  labelFokusAktiv:   document.getElementById('label-fokus-aktiv'),
  flyoutFokus:       document.getElementById('flyout-fokus'),
  flyoutFokusBtns:   document.querySelectorAll('#flyout-fokus .flyout-btn'),

  // Fokus-Toolbar
  fokusToolbar:      document.getElementById('fokus-toolbar'),
  fokusToolbarLabel: document.getElementById('fokus-toolbar-label'),
  btnFokusSchliessen: document.getElementById('btn-fokus-schliessen'),

  // Geodreieck
  btnGeodrei:        document.getElementById('btn-geodreieck'),
  geoWrapper:        document.getElementById('geodreieck-wrapper'),
  geoSvg:            document.getElementById('geodreieck-svg'),
  geoGrundlinie:     document.getElementById('geo-grundlinie'),
  geoBasis:          document.getElementById('geo-basis'),
  geoSenkrechte:     document.getElementById('geo-senkrechte'),
  geoHilfslinien:    document.getElementById('geo-hilfslinien'),
  geoWinkelkreis:    document.getElementById('geo-winkelkreis'),
  geoFuehrung:       document.getElementById('geo-fuehrungslinie'),
  geoDrehGriff:      document.getElementById('geo-dreh-griff'),

  // Notizen
  btnNotizen:        document.getElementById('btn-notizen'),
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
  btnEinstellungen:      document.getElementById('btn-einstellungen'),
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

function clientKoord(e) {
  if (e.touches?.length > 0)             return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
  if (e.changedTouches?.length > 0)      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function zeichenCanvas(seite) {
  return document.querySelector(`.seite-container[data-seite="${seite}"] .zeichen-canvas`);
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
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function winkelZwischen(cx, cy, px, py) {
  return Math.atan2(py - cy, px - cx) * 180 / Math.PI;
}

function punktAufLinie(p, p1, p2) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y;
  const lenSq = dx*dx+dy*dy;
  if (lenSq === 0) return { ...p1 };
  const t = Math.max(0, Math.min(1, ((p.x-p1.x)*dx+(p.y-p1.y)*dy)/lenSq));
  return { x: p1.x+t*dx, y: p1.y+t*dy };
}

function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}


/* ═══════════════════════════════════════════════════════════════════
   5. THEMA
════════════════════════════════════════════════════════════════════ */
function themaWechseln(thema) {
  Z.thema = thema;
  D.html.dataset.thema = thema;
  D.btnThemaWechsel.setAttribute('aria-checked', thema === 'hell' ? 'true' : 'false');
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', thema === 'hell' ? '#e8eaf0' : '#1a1f2e');
  try { localStorage.setItem('edulayer-thema', thema); } catch(_) {}
}
function themaLaden() {
  let t = 'dunkel';
  try { t = localStorage.getItem('edulayer-thema') || 'dunkel'; } catch(_) {}
  themaWechseln(t);
}


/* ═══════════════════════════════════════════════════════════════════
   6. FLYOUT-UNTERMENÜS
   Ein Tippen öffnet/schließt das Flyout.
   Tippen auf einen Eintrag wählt ihn aus und schließt das Flyout.
   Tippen außerhalb schließt alle Flyouts.
════════════════════════════════════════════════════════════════════ */

/** Alle offenen Flyouts schließen. */
function flyoutsSchliessen() {
  D.flyoutStifte.style.display = 'none';
  D.flyoutFokus.style.display  = 'none';
  D.btnStiftAktiv.setAttribute('aria-expanded', 'false');
  D.btnFokusAktiv.setAttribute('aria-expanded', 'false');
  Z.offenesFlyout = null;
}

/** Stifte-Flyout umschalten. */
function stiftFlyoutUmschalten() {
  if (Z.offenesFlyout === 'stifte') {
    flyoutsSchliessen();
  } else {
    flyoutsSchliessen();
    D.flyoutStifte.style.display = 'flex';
    D.btnStiftAktiv.setAttribute('aria-expanded', 'true');
    Z.offenesFlyout = 'stifte';
  }
}

/** Fokus-Flyout umschalten. */
function fokusFlyoutUmschalten() {
  if (Z.offenesFlyout === 'fokus') {
    flyoutsSchliessen();
  } else {
    flyoutsSchliessen();
    D.flyoutFokus.style.display = 'flex';
    D.btnFokusAktiv.setAttribute('aria-expanded', 'true');
    Z.offenesFlyout = 'fokus';
  }
}

/**
 * SVG-Icons für die Werkzeuge als HTML-Strings.
 * Wird genutzt um den Haupt-Button der Stift-Gruppe zu aktualisieren.
 */
const WERKZEUG_ICONS = {
  'stift-duenn': {
    svg: `<path d="M19 3l2 2-12.5 12.5L5 18l.5-3.5L19 3z" stroke-width="1.3"/>
          <line x1="16.5" y1="5.5" x2="20.5" y2="9.5" stroke-width="1.3"/>
          <line x1="3" y1="21" x2="10" y2="21" stroke-width="1"/>`,
    label: 'Fein',
  },
  'stift-dick': {
    svg: `<path d="M19 3l2 2-12.5 12.5L5 18l.5-3.5L19 3z" stroke-width="2.8" stroke-linejoin="round"/>
          <line x1="16.5" y1="5.5" x2="20.5" y2="9.5" stroke-width="2.8"/>
          <line x1="3" y1="21" x2="10" y2="21" stroke-width="3.5"/>`,
    label: 'Dick',
  },
  'textmarker': {
    svg: `<rect x="9" y="3" width="6" height="14" rx="1"
              transform="rotate(-45 12 10)" stroke-width="1.4" fill="none"/>
          <rect x="3" y="19" width="12" height="3" rx="1"
              fill="currentColor" opacity="0.45" stroke="none"/>`,
    label: 'Marker',
  },
};

const FOKUS_ICONS = {
  'oval': {
    svg: `<ellipse cx="12" cy="12" rx="9" ry="6" stroke-width="1.8" fill="none"/>
          <path d="M3 2h18v20H3z" fill="currentColor" opacity="0.08" stroke="none"/>`,
    label: 'Oval',
  },
  'rechteck': {
    svg: `<rect x="4" y="7" width="16" height="10" rx="1" stroke-width="1.8" fill="none"/>
          <path d="M3 2h18v20H3z" fill="currentColor" opacity="0.08" stroke="none"/>`,
    label: 'Eckig',
  },
  'laser': {
    svg: `<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>
          <line x1="12" y1="2"  x2="12" y2="6.5" stroke-width="1.8"/>
          <line x1="12" y1="17.5" x2="12" y2="22" stroke-width="1.8"/>
          <line x1="2"  y1="12" x2="6.5" y2="12" stroke-width="1.8"/>
          <line x1="17.5" y1="12" x2="22" y2="12" stroke-width="1.8"/>`,
    label: 'Laser',
  },
};

/**
 * Haupt-Button des Stifte-Flyouts aktualisieren (Icon + Label).
 * @param {string} werkzeug
 */
function stiftButtonAktualisieren(werkzeug) {
  const info = WERKZEUG_ICONS[werkzeug];
  if (!info) return;
  D.iconStiftAktiv.innerHTML = info.svg;
  D.labelStiftAktiv.textContent = info.label;
  // Flyout-Buttons: aktiven markieren
  D.flyoutStiftBtns.forEach(b => {
    const a = b.dataset.werkzeug === werkzeug;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

/**
 * Haupt-Button des Fokus-Flyouts aktualisieren.
 * @param {string} modus – 'oval'|'rechteck'|'laser'|'aus'
 */
function fokusButtonAktualisieren(modus) {
  const info = FOKUS_ICONS[modus];
  if (info) {
    D.iconFokusAktiv.innerHTML = info.svg;
    D.labelFokusAktiv.textContent = info.label;
  } else {
    // 'aus': Standard-Icon (Spotlight-Kreis)
    D.iconFokusAktiv.innerHTML = `
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12"/>
      <path d="M19.07 4.93l-2.12 2.12M6.05 16.95l-2.12 2.12"/>`;
    D.labelFokusAktiv.textContent = 'Fokus';
  }
  D.btnFokusAktiv.setAttribute('aria-pressed', modus !== 'aus' ? 'true' : 'false');
  D.btnFokusAktiv.classList.toggle('aktiv', modus !== 'aus');
  // Flyout-Buttons markieren
  D.flyoutFokusBtns.forEach(b => {
    const a = b.dataset.fokus === modus;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

/** Fokus-Modus setzen (oval / rechteck / laser / aus). */
function fokusModusSetzen(modus) {
  // Vorherigen Modus beenden
  if (Z.fokusModus === 'oval' || Z.fokusModus === 'rechteck') {
    spotlightAus();
  }
  if (Z.fokusModus === 'laser') {
    laserModeAus();
  }

  Z.fokusModus = modus;
  fokusButtonAktualisieren(modus);

  if (modus === 'oval' || modus === 'rechteck') {
    spotlightAn(modus);
    D.fokusToolbar.style.display = 'flex';
    D.fokusToolbarLabel.textContent = modus === 'oval' ? 'Spotlight Oval' : 'Spotlight Eckig';
  } else if (modus === 'laser') {
    D.fokusToolbar.style.display = 'flex';
    D.fokusToolbarLabel.textContent = 'Laserpointer';
    werkzeugWaehlen('laser');
  } else {
    D.fokusToolbar.style.display = 'none';
  }

  flyoutsSchliessen();
}

/** Fokus-Modus komplett ausschalten (aus dem Toolbar-Schließen-Button). */
function fokusModusAus() {
  fokusModusSetzen('aus');
}


/* ═══════════════════════════════════════════════════════════════════
   7. EINSTELLUNGSMENÜ
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
  D.btnSidebarRechts.classList.toggle('aktiv', seite === 'right');
  D.btnSidebarLinks.classList.toggle('aktiv',  seite === 'left');
  D.btnSidebarRechts.setAttribute('aria-pressed', seite === 'right' ? 'true' : 'false');
  D.btnSidebarLinks.setAttribute('aria-pressed',  seite === 'left'  ? 'true' : 'false');
}
function einstellungenInit() {
  D.btnEinstellungen.addEventListener('click', () =>
    Z.einstellungenOffen ? einstellungenSchliessen() : einstellungenOeffnen()
  );
  D.einstellungenBackdrop.addEventListener('click', einstellungenSchliessen);
  D.btnEinstellungenSch.addEventListener('click',   einstellungenSchliessen);
  D.btnSpeichern.addEventListener('click', () => { einstellungenSchliessen(); pdfSpeichern(); });
  D.btnThemaWechsel.addEventListener('click', () =>
    themaWechseln(Z.thema === 'dunkel' ? 'hell' : 'dunkel')
  );
  D.btnSidebarLinks.addEventListener('click',  () => sidebarPositionSetzen('left'));
  D.btnSidebarRechts.addEventListener('click', () => sidebarPositionSetzen('right'));
  D.sliderLaserDauer.addEventListener('input', () => {
    KONFIGURATION.LASER_FADE_MS = +D.sliderLaserDauer.value;
    D.laserDauerAnzeige.textContent = `${D.sliderLaserDauer.value} ms`;
  });
  D.sliderRadierer.addEventListener('input', () => {
    KONFIGURATION.RADIERER_PX = +D.sliderRadierer.value;
    D.radiererAnzeige.textContent = `${D.sliderRadierer.value} px`;
    if (Z.werkzeug === 'radierer') Z.strichbreite = KONFIGURATION.RADIERER_PX;
  });
  D.pickerGeodrei.addEventListener('input', () => {
    KONFIGURATION.GEO_FARBE = D.pickerGeodrei.value;
    geodreieckZeichnen();
  });
}


/* ═══════════════════════════════════════════════════════════════════
   8. NOTIZEN-PANEL
════════════════════════════════════════════════════════════════════ */
const VORLAGEN = {
  lernziele:       'Lernziele dieser Stunde:\n• \n• \n• ',
  aufgaben:        'Aufgaben:\n1. \n2. \n3. ',
  material:        'Benötigtes Material:\n• Schulbuch S. \n• Arbeitsblatt: \n• ',
  differenzierung: 'Differenzierung:\n▲ Erweiterung: \n● Standard: \n▼ Unterstützung: ',
};

function notizenOeffnen() {
  Z.notizenOffen = true;
  Z.notizenSeite = Z.aktiveSeite;
  D.notizenOverlay.style.display = 'block';
  D.notizenOverlay.setAttribute('aria-hidden', 'false');
  D.btnNotizen.classList.add('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'true');
  notizenAktualisieren();
  requestAnimationFrame(() => D.notizenTextarea.focus());
}
function notizenSchliessen() {
  notizenSpeichern();
  Z.notizenOffen = false;
  D.notizenOverlay.style.display = 'none';
  D.notizenOverlay.setAttribute('aria-hidden', 'true');
  D.btnNotizen.classList.remove('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'false');
}
function notizenSpeichern() {
  Z.notizenProSeite[Z.notizenSeite] = D.notizenTextarea.value;
}
function notizenAktualisieren() {
  const s = Z.notizenSeite, g = Z.seitenAnzahl || 1;
  D.notizenTextarea.value = Z.notizenProSeite[s] || '';
  D.notizenSeiteInfo.textContent = `Seite ${s}`;
  D.notizenNavInfo.textContent   = `Seite ${s} / ${g}`;
}
function notizenInit() {
  D.btnNotizen.addEventListener('click', () => Z.notizenOffen ? notizenSchliessen() : notizenOeffnen());
  D.notizenBackdrop.addEventListener('click', notizenSchliessen);
  D.btnNotizenSch.addEventListener('click',   notizenSchliessen);
  D.btnNotizenVor.addEventListener('click', () => {
    notizenSpeichern();
    Z.notizenSeite = Math.max(1, Z.notizenSeite - 1);
    notizenAktualisieren();
  });
  D.btnNotizenNach.addEventListener('click', () => {
    notizenSpeichern();
    Z.notizenSeite = Math.min(Z.seitenAnzahl || 1, Z.notizenSeite + 1);
    notizenAktualisieren();
  });
  D.notizenTextarea.addEventListener('input', () => {
    Z.notizenProSeite[Z.notizenSeite] = D.notizenTextarea.value;
  });
  D.vorlagenBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const text = VORLAGEN[btn.dataset.vorlage] || '';
      const ta = D.notizenTextarea, pos = ta.selectionStart;
      const v = ta.value.slice(0, pos), n = ta.value.slice(ta.selectionEnd);
      const tr = v.length > 0 && !v.endsWith('\n') ? '\n\n' : '';
      ta.value = v + tr + text + '\n' + n;
      ta.selectionStart = ta.selectionEnd = pos + tr.length + text.length + 1;
      ta.focus(); notizenSpeichern();
    });
  });
  D.btnNotizenLoeschen.addEventListener('click', () => {
    if (!window.confirm(`Notiz für Seite ${Z.notizenSeite} löschen?`)) return;
    Z.notizenProSeite[Z.notizenSeite] = '';
    D.notizenTextarea.value = '';
    toast('Notiz gelöscht.', 'info');
  });
  D.btnNotizenExportieren.addEventListener('click', () => {
    let inhalt = `EduLayer – Lehrer-Notizen\nExportiert: ${new Date().toLocaleString('de-DE')}\n${'═'.repeat(40)}\n\n`;
    for (let s = 1; s <= (Z.seitenAnzahl||1); s++) {
      const n = Z.notizenProSeite[s];
      if (n?.trim()) inhalt += `── Seite ${s} ──\n${n}\n\n`;
    }
    if (inhalt.split('\n').length <= 5) { toast('Keine Notizen vorhanden.', 'info'); return; }
    download(new TextEncoder().encode(inhalt), `EduLayer_Notizen_${zeitstempel()}.txt`, 'text/plain;charset=utf-8');
    toast('Notizen exportiert.', 'erfolg');
  });
}


/* ═══════════════════════════════════════════════════════════════════
   9. SIDEBAR-LOGIK
════════════════════════════════════════════════════════════════════ */
function werkzeugWaehlen(name) {
  // Wenn Laser-Modus aktiv und anderes Werkzeug gewählt → Laser-Modus beenden
  if (Z.fokusModus === 'laser' && name !== 'laser') {
    Z.fokusModus = 'aus';
    fokusButtonAktualisieren('aus');
    D.fokusToolbar.style.display = 'none';
  }

  Z.werkzeug = name;
  Z.strichbreite = ({
    'stift-duenn': KONFIGURATION.STIFT_DUENN_PX,
    'stift-dick':  KONFIGURATION.STIFT_DICK_PX,
    'textmarker':  KONFIGURATION.TEXTMARKER_PX,
    'radierer':    KONFIGURATION.RADIERER_PX,
    'laser':       KONFIGURATION.LASER_PX,
  })[name] ?? KONFIGURATION.STIFT_DUENN_PX;

  // Radierer-Button separat pflegen
  D.btnRadierer.classList.toggle('aktiv', name === 'radierer');
  D.btnRadierer.setAttribute('aria-pressed', name === 'radierer' ? 'true' : 'false');

  // Stift-Button (Untermenü-Haupt-Button)
  if (['stift-duenn','stift-dick','textmarker'].includes(name)) {
    D.btnStiftAktiv.classList.add('aktiv');
    D.btnStiftAktiv.setAttribute('aria-pressed', 'true');
    stiftButtonAktualisieren(name);
  } else {
    D.btnStiftAktiv.classList.remove('aktiv');
    D.btnStiftAktiv.setAttribute('aria-pressed', 'false');
  }

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
  // Datei
  D.btnDateiLaden.addEventListener('click', () => D.dateiInput.click());
  D.btnStartLaden.addEventListener('click', () => D.dateiInput.click());
  D.dateiInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f?.type === 'application/pdf') pdfLaden(f);
    D.dateiInput.value = '';
  });

  // Stifte-Flyout-Button
  D.btnStiftAktiv.addEventListener('click', stiftFlyoutUmschalten);

  // Flyout-Stift-Optionen
  D.flyoutStiftBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      werkzeugWaehlen(btn.dataset.werkzeug);
      flyoutsSchliessen();
    });
  });

  // Farbpalette
  D.farbDots.forEach(dot => {
    dot.addEventListener('click', () => { if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe); });
  });

  // Radierer (eigener Button)
  D.btnRadierer.addEventListener('click', () => werkzeugWaehlen('radierer'));

  // Verlauf
  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);

  // Scroll-Modus
  D.btnModusWechsel.addEventListener('click', scrollModusUmschalten);

  // Fokus + Laser Flyout
  D.btnFokusAktiv.addEventListener('click', fokusFlyoutUmschalten);
  D.flyoutFokusBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const modus = btn.dataset.fokus;
      // Wenn gleicher Modus → ausschalten
      if (Z.fokusModus === modus) fokusModusSetzen('aus');
      else fokusModusSetzen(modus);
    });
  });

  // Fokus-Toolbar Schließen
  D.btnFokusSchliessen.addEventListener('click', fokusModusAus);

  // Geodreieck
  D.btnGeodrei.addEventListener('click', geodreieckUmschalten);

  // Notizen
  // (wird in notizenInit() registriert)

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
    if (e.key === 'Escape') {
      if (Z.einstellungenOffen) { einstellungenSchliessen(); return; }
      if (Z.notizenOffen)       { notizenSchliessen(); return; }
      if (Z.offenesFlyout)      { flyoutsSchliessen(); return; }
      if (Z.fokusModus !== 'aus') { fokusModusAus(); return; }
      if (Z.geodreieckAktiv)    { geodreieckAus(); return; }
    }
  });

  // Tippen außerhalb schließt Flyouts
  document.addEventListener('touchstart', e => {
    if (!Z.offenesFlyout) return;
    const ziel = e.target;
    if (!ziel.closest('#gruppe-stifte') && !ziel.closest('#gruppe-fokus')) {
      flyoutsSchliessen();
    }
  }, { passive: true });
  document.addEventListener('mousedown', e => {
    if (!Z.offenesFlyout) return;
    if (!e.target.closest('#gruppe-stifte') && !e.target.closest('#gruppe-fokus')) {
      flyoutsSchliessen();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   10. SCROLL-MODUS
════════════════════════════════════════════════════════════════════ */
function scrollModusUmschalten() {
  const war = Z.modus === 'scrollen';
  Z.modus = war ? 'zeichnen' : 'scrollen';
  D.body.classList.toggle('scroll-modus', !war);
  D.body.dataset.modus = Z.modus;
  D.btnModusWechsel.setAttribute('aria-pressed', war ? 'false' : 'true');
  toast(war ? 'Zeichnen aktiv' : 'Scroll-Modus – Finger scrollt das PDF', 'info', 1800);
}


/* ═══════════════════════════════════════════════════════════════════
   11. ZEICHEN-ENGINE
════════════════════════════════════════════════════════════════════ */
function strichStarten(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (e.touches?.length > 1)  return;
  if (Z.fokusModus === 'oval' || Z.fokusModus === 'rechteck') return;
  if (Z.fokusModus === 'laser') { laserStarten(e); return; }

  e.preventDefault();
  Z.zeichnet = true;

  let p = koordinaten(e, canvas);
  if (Z.geodreieckAktiv) {
    const snap = geodreieckSnap(e, canvas);
    if (snap) p = snap;
  }
  Z.letzterPunkt = p;

  const seite = +canvas.closest('.seite-container').dataset.seite;
  undoSnapshot(seite);

  if (Z.werkzeug === 'textmarker') {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const offCtx = off.getContext('2d');
    offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
    offCtx.lineWidth = Z.strichbreite;
    offCtx.strokeStyle = Z.strichfarbe;
    offCtx.globalAlpha = 1;
    Z.aktuellerStrich = {
      punkte: [{ ...p }], farbe: Z.strichfarbe,
      breite: Z.strichbreite, werkzeug: 'textmarker',
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
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = Z.strichfarbe; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, Z.strichbreite/2, 0, Math.PI*2); ctx.fill();
    ctxReset(ctx);
  } else {
    Z.aktuellerStrich = null;
  }
}

function strichBewegen(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (Z.fokusModus === 'laser') { laserBewegen(e); return; }
  if (e.touches?.length === 2) {
    if (Z.zeichnet) { Z.zeichnet = false; Z.aktuellerStrich = null; }
    pinchBewegen(e); return;
  }
  if (!Z.zeichnet) return;
  e.preventDefault();

  let p = koordinaten(e, canvas);
  if (Z.geodreieckAktiv) {
    const snap = geodreieckSnap(e, canvas);
    if (snap) p = snap;
  }

  if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCtx) {
    const offCtx = Z.aktuellerStrich.offCtx;
    offCtx.beginPath();
    offCtx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
    offCtx.lineTo(p.x, p.y);
    offCtx.stroke();
    // Preview auf Haupt-Canvas
    const ctx = canvas.getContext('2d');
    const seite = +canvas.closest('.seite-container').dataset.seite;
    const snap = Z.undoVerlauf[seite];
    if (snap?.length) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0);
        ctx.globalAlpha = KONFIGURATION.TEXTMARKER_ALPHA;
        ctx.drawImage(Z.aktuellerStrich.offCanvas, 0, 0);
        ctx.globalAlpha = 1;
      };
      img.src = snap[snap.length-1];
    }
    Z.aktuellerStrich.punkte.push({ ...p });
  } else if (Z.werkzeug === 'radierer') {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = Z.strichbreite; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath(); ctx.moveTo(Z.letzterPunkt.x,Z.letzterPunkt.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctxReset(ctx);
  } else {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = Z.strichfarbe; ctx.lineWidth = Z.strichbreite;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(Z.letzterPunkt.x,Z.letzterPunkt.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctxReset(ctx);
    if (Z.aktuellerStrich) Z.aktuellerStrich.punkte.push({ ...p });
  }
  Z.letzterPunkt = p;
}

function strichBeenden(e, canvas) {
  if (Z.fokusModus === 'laser') { laserBeenden(); return; }
  if (!Z.zeichnet) return;
  e.preventDefault();
  Z.zeichnet = false;

  if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCanvas) {
    const ctx = canvas.getContext('2d');
    const seite = +canvas.closest('.seite-container').dataset.seite;
    const snap = Z.undoVerlauf[seite];
    if (snap?.length) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        ctx.globalAlpha = KONFIGURATION.TEXTMARKER_ALPHA;
        ctx.drawImage(Z.aktuellerStrich.offCanvas,0,0);
        ctx.globalAlpha = 1;
        if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
        Z.annotationen[seite].push({
          punkte: Z.aktuellerStrich.punkte,
          farbe: Z.aktuellerStrich.farbe,
          breite: Z.aktuellerStrich.breite,
          werkzeug: 'textmarker',
          alpha: Z.aktuellerStrich.alpha,
        });
      };
      img.src = snap[snap.length-1];
    }
  } else if (Z.aktuellerStrich) {
    const seite = +canvas.closest('.seite-container').dataset.seite;
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.annotationen[seite].push(Z.aktuellerStrich);
  }
  Z.aktuellerStrich = null; Z.letzterPunkt = null;
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

function stricheZeichnen(ctx, striche) {
  if (!striche?.length) return;
  striche.forEach(s => {
    if (!s.punkte?.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.breite;
    if (s.werkzeug === 'textmarker') {
      const off = document.createElement('canvas');
      off.width = ctx.canvas.width; off.height = ctx.canvas.height;
      const offCtx = off.getContext('2d');
      offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
      offCtx.lineWidth = s.breite; offCtx.strokeStyle = s.farbe;
      offCtx.beginPath(); offCtx.moveTo(s.punkte[0].x,s.punkte[0].y);
      for (let i=1;i<s.punkte.length;i++) offCtx.lineTo(s.punkte[i].x,s.punkte[i].y);
      offCtx.stroke();
      ctx.globalAlpha = s.alpha ?? KONFIGURATION.TEXTMARKER_ALPHA;
      ctx.drawImage(off,0,0); ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.farbe; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(s.punkte[0].x,s.punkte[0].y);
      for (let i=1;i<s.punkte.length-1;i++) {
        const mx=(s.punkte[i].x+s.punkte[i+1].x)/2, my=(s.punkte[i].y+s.punkte[i+1].y)/2;
        ctx.quadraticCurveTo(s.punkte[i].x,s.punkte[i].y,mx,my);
      }
      const lp=s.punkte[s.punkte.length-1]; ctx.lineTo(lp.x,lp.y); ctx.stroke();
      ctxReset(ctx);
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   12. LASERPOINTER
════════════════════════════════════════════════════════════════════ */
function laserCanvasAnpassen() {
  D.laserCanvas.width = window.innerWidth; D.laserCanvas.height = window.innerHeight;
}
function laserZeichnen() {
  const lc = D.laserCanvas, ctx = lc.getContext('2d');
  ctx.clearRect(0,0,lc.width,lc.height);
  const sw = Z.laserSchweif; if (!sw.length) return;
  const jetzt = Date.now(), fade = KONFIGURATION.LASER_FADE_MS, r = KONFIGURATION.LASER_PX;
  for (let i=0;i<sw.length-1;i++) {
    const alter = jetzt-sw[i].t;
    const alpha = Math.max(0, 0.65*(1-alter/(fade*1.5)));
    if (alpha<=0) continue;
    ctx.beginPath(); ctx.moveTo(sw[i].x,sw[i].y); ctx.lineTo(sw[i+1].x,sw[i+1].y);
    ctx.strokeStyle=KONFIGURATION.LASER_FARBE; ctx.globalAlpha=alpha;
    ctx.lineWidth=r*0.4*((i+1)/sw.length); ctx.lineCap='round';
    ctx.shadowBlur=8; ctx.shadowColor=KONFIGURATION.LASER_FARBE; ctx.stroke();
  }
  if (sw.length>0) {
    const lp=sw[sw.length-1], alter=jetzt-lp.t;
    ctx.beginPath(); ctx.arc(lp.x,lp.y,r,0,Math.PI*2);
    ctx.fillStyle=KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha=Z.laserAktiv?1:Math.max(0,1-alter/fade);
    ctx.shadowBlur=22; ctx.shadowColor=KONFIGURATION.LASER_FARBE; ctx.fill();
  }
  ctx.globalAlpha=1; ctx.shadowBlur=0;
  const nochSichtbar=Z.laserAktiv||(sw[0]&&jetzt-sw[0].t<fade*2);
  if (nochSichtbar) { Z.laserAnimFrame=requestAnimationFrame(laserZeichnen); }
  else { ctx.clearRect(0,0,lc.width,lc.height); Z.laserAnimFrame=null; Z.laserSchweif=[]; }
}
function laserPunkt(cx,cy) {
  Z.laserSchweif.push({x:cx,y:cy,t:Date.now()});
  if (Z.laserSchweif.length>KONFIGURATION.LASER_SCHWEIF_MAX) Z.laserSchweif.shift();
}
function laserStarten(e) {
  e.preventDefault(); Z.laserAktiv=true; Z.laserSchweif=[];
  const t=e.touches?.[0]??e; laserPunkt(t.clientX,t.clientY);
  if (!Z.laserAnimFrame) Z.laserAnimFrame=requestAnimationFrame(laserZeichnen);
}
function laserBewegen(e) {
  if (!Z.laserAktiv) return; e.preventDefault();
  const t=e.touches?.[0]??e; laserPunkt(t.clientX,t.clientY);
}
function laserBeenden() { Z.laserAktiv=false; }
function laserModeAus() {
  laserBeenden();
  if (Z.werkzeug === 'laser') werkzeugWaehlen('stift-duenn');
}


/* ═══════════════════════════════════════════════════════════════════
   13. UNDO / REDO
════════════════════════════════════════════════════════════════════ */
function undoSnapshot(seite) {
  const canvas=zeichenCanvas(seite); if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite]=[];
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite]=[];
  const v=Z.undoVerlauf[seite];
  v.push(canvas.toDataURL()); if (v.length>30) v.shift();
  Z.redoVerlauf[seite]=[];
}
function undoAusfuehren() {
  const seite=Z.aktiveSeite;
  if (!Z.undoVerlauf[seite]?.length) { toast('Kein Rückgängig-Schritt.','info',1500); return; }
  const canvas=zeichenCanvas(seite); if (!canvas) return;
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite]=[];
  Z.redoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas,Z.undoVerlauf[seite].pop());
  if (Z.annotationen[seite]?.length) Z.annotationen[seite].pop();
}
function redoAusfuehren() {
  const seite=Z.aktiveSeite;
  if (!Z.redoVerlauf[seite]?.length) { toast('Kein Wiederholen-Schritt.','info',1500); return; }
  const canvas=zeichenCanvas(seite); if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite]=[];
  Z.undoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas,Z.redoVerlauf[seite].pop());
}
function snapshotLaden(canvas,url) {
  const ctx=canvas.getContext('2d'), img=new Image();
  img.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);};
  img.src=url;
}
function seiteLeeren() {
  const seite=Z.aktiveSeite;
  if (!window.confirm(`Alle Annotationen auf Seite ${seite} löschen?`)) return;
  undoSnapshot(seite);
  const canvas=zeichenCanvas(seite);
  if (canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  Z.annotationen[seite]=[]; toast(`Seite ${seite} geleert.`,'info');
}


/* ═══════════════════════════════════════════════════════════════════
   14. GEODREIECK
   Realistisches deutsches Schuldreieck:
   - 28cm Grundlinie (Hypotenuse oben, Basis unten)
   - Winkelhalbkreis an der Spitze (0°–90° Innenwinkel)
   - cm-Skalen auf allen drei Seiten
   - 5mm-Hilfslinien parallel zur Basis
   - Gesamte Fläche greifbar (kein separater Move-Griff)
   - Dreh-Griff an der Spitze
════════════════════════════════════════════════════════════════════ */

function geodreieckAn() {
  Z.geodreieckAktiv = true;
  D.geoWrapper.style.display = 'block';
  D.geoWrapper.setAttribute('aria-hidden', 'false');
  D.btnGeodrei.classList.add('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'true');
  geodreieckSkalieren();
  geodreieckZeichnen();
  geodreieckTransformAnwenden();
  toast('Geodreieck – überall anfassen zum Verschieben, Dreh-Griff oben', 'info', 3000);
}

function geodreieckAus() {
  Z.geodreieckAktiv = false;
  D.geoWrapper.style.display = 'none';
  D.geoWrapper.setAttribute('aria-hidden', 'true');
  D.btnGeodrei.classList.remove('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'false');
  D.geoFuehrung.setAttribute('display', 'none');
}

function geodreieckUmschalten() { Z.geodreieckAktiv ? geodreieckAus() : geodreieckAn(); }

/** Skalierung: SVG-Breite = GEO_CM_LAENGE × pxProCm × zoom */
function geodreieckSkalieren() {
  const pxProCm = Z.pxProCm[Z.aktiveSeite] || (KONFIGURATION.PDF_SCALE * 72 / 2.54);
  const breite  = KONFIGURATION.GEO_CM_LAENGE * pxProCm * Z.zoom;
  const hoehe   = breite * (KONFIGURATION.GEO_VIEWBOX_H / KONFIGURATION.GEO_VIEWBOX_B);
  Z.geoSkalierung = breite / KONFIGURATION.GEO_VIEWBOX_B;
  D.geoSvg.style.width  = `${breite}px`;
  D.geoSvg.style.height = `${hoehe}px`;
}

function geodreieckTransformAnwenden() {
  D.geoWrapper.style.transform =
    `translate(${Z.geoPos.x}px, ${Z.geoPos.y}px) rotate(${Z.geoWinkel}deg)`;
}

/**
 * Realistisches Geodreieck-SVG zeichnen.
 * viewBox: 0 0 560 280 (28cm × 14cm, 1 Einheit = 0.5mm)
 *
 * Eckpunkte:
 *   A = (0, 0)   – Spitze oben links (90°-Winkel... Nein:)
 * Deutsches Geodreieck-Layout:
 *   - Rechter Winkel unten links: (0, 280)
 *   - Basis: horizontal von (0,280) nach (560,280)
 *   - Senkrechte: vertikal von (0,0) nach (0,280)
 *   - Hypotenuse: von (0,0) nach (560,280)
 */
function geodreieckZeichnen() {
  const farbe   = KONFIGURATION.GEO_FARBE;
  const f70     = farbe + 'b3';  // 70% Deckkraft
  const f50     = farbe + '80';  // 50%
  const f30     = farbe + '4d';  // 30%

  // ── BASIS (unten, 28cm): von (0,280) nach (560,280) ─────────
  // Teilstriche: jeder mm = 2 SVG-Einheiten
  let basisHtml = '';
  for (let mm = 0; mm <= 280; mm++) {
    const x     = mm * 2;
    const isCm  = mm % 10 === 0;
    const isHCm = mm % 5  === 0 && !isCm;
    const len   = isCm ? 10 : isHCm ? 6 : 2.5;
    const sw    = isCm ? '1.0' : isHCm ? '0.7' : '0.5';
    basisHtml  += `<line x1="${x}" y1="280" x2="${x}" y2="${280-len}"
      stroke="${f70}" stroke-width="${sw}"/>`;
    if (isCm && mm > 0 && mm < 280) {
      basisHtml += `<text x="${x}" y="${280-13}" text-anchor="middle"
        class="geo-zahl" fill="${farbe}">${mm/10}</text>`;
    }
  }
  // Nullpunkt
  basisHtml += `<text x="3" y="267" class="geo-zahl" fill="${farbe}">0</text>`;
  D.geoBasis.innerHTML = basisHtml;

  // ── SENKRECHTE (links, 14cm): von (0,0) nach (0,280) ────────
  let senkrechtHtml = '';
  for (let mm = 0; mm <= 140; mm++) {
    const y     = 280 - mm * 2;
    const isCm  = mm % 10 === 0;
    const isHCm = mm % 5  === 0 && !isCm;
    const len   = isCm ? 10 : isHCm ? 6 : 2.5;
    const sw    = isCm ? '1.0' : isHCm ? '0.7' : '0.5';
    senkrechtHtml += `<line x1="0" y1="${y}" x2="${len}" y2="${y}"
      stroke="${f70}" stroke-width="${sw}"/>`;
    if (isCm && mm > 0) {
      senkrechtHtml += `<text x="${len+3}" y="${y+2}" class="geo-zahl"
        fill="${farbe}">${mm/10}</text>`;
    }
  }
  D.geoSenkrechte.innerHTML = senkrechtHtml;

  // ── HYPOTENUSE-SKALA: von (0,0) nach (560,280) ──────────────
  // Länge der Hypotenuse = √(560²+280²) ≈ 626 SVG-Einheiten ≈ 31.3 cm
  const hypLen = Math.hypot(560, 280);   // ≈ 625.7
  const hypCm  = hypLen / 20;            // SVG-Einheiten → cm (1 cm = 20 SVG)
  const hnx    = 560 / hypLen, hny = 280 / hypLen;  // Einheitsvektor
  const hnpx   = -hny, hnpy = hnx;                  // Senkrecht (nach innen)

  let hypHtml = '';
  // Teilstriche entlang der Hypotenuse, alle mm
  const mmGesamt = Math.floor(hypLen / 2); // mm entlang Hyp.
  for (let mm = 0; mm <= mmGesamt; mm++) {
    const t    = mm * 2;
    const hx   = hnx * t, hy = hny * t;
    const isCm  = mm % 10 === 0;
    const isHCm = mm % 5  === 0 && !isCm;
    const len   = isCm ? 8 : isHCm ? 5 : 2;
    const sw    = isCm ? '0.9' : '0.5';
    hypHtml += `<line
      x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}"
      x2="${(hx-hnpx*len).toFixed(1)}" y2="${(hy-hnpy*len).toFixed(1)}"
      stroke="${f50}" stroke-width="${sw}"/>`;
    if (isCm && mm > 0) {
      const tx = hx - hnpx*(len+4);
      const ty = hy - hnpy*(len+4);
      const rot = Math.atan2(hny,hnx)*180/Math.PI;
      hypHtml += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"
        text-anchor="middle" dominant-baseline="middle"
        class="geo-zahl geo-zahl--klein" fill="${f70}"
        transform="rotate(${rot.toFixed(1)},${tx.toFixed(1)},${ty.toFixed(1)})"
        >${mm/10}</text>`;
    }
  }
  D.geoGrundlinie.innerHTML = hypHtml;

  // ── PARALLELE HILFSLINIEN (horizontal, alle 5mm = 10 SVG) ───
  // Linien parallel zur Basis, im Innern des Dreiecks
  let hilfsHtml = '';
  for (let mm = 5; mm < 140; mm += 5) {
    const y   = 280 - mm * 2;
    // x-Begrenzer: Dreiecks-Kante. Hypotenuse bei y: x = y * (560/280) = y*2
    const xMax = y * 2;
    if (xMax < 4) continue;
    const isCm = mm % 10 === 0;
    hilfsHtml += `<line x1="2" y1="${y}" x2="${xMax.toFixed(0)}" y2="${y}"
      stroke="${isCm ? f30 : f30}" stroke-width="${isCm ? '0.7' : '0.4'}"
      stroke-dasharray="${isCm ? 'none' : '3,3'}"/>`;
    if (isCm) {
      // Zentimeter-Beschriftung auf der Hilfslinie (rechts)
      hilfsHtml += `<text x="${xMax-6}" y="${y-2}"
        text-anchor="end" class="geo-zahl geo-zahl--klein" fill="${f50}"
        >${mm/10}</text>`;
    }
  }
  D.geoHilfslinien.innerHTML = hilfsHtml;

  // ── WINKELKREIS an der Spitze (0,0) ─────────────────────────
  // Kleiner Halbkreis (Radius 40 SVG = 2cm) von 0° bis 90°
  // (Winkel zwischen Senkrechter und Hypotenuse am Punkt 0,0)
  const bogR = 40;
  let winkelHtml = '';
  // Bogen
  winkelHtml += `<path d="M ${bogR} 0 A ${bogR} ${bogR} 0 0 1 0 ${bogR}"
    fill="none" stroke="${f50}" stroke-width="0.8"/>`;
  // Winkelmarkierungen alle 5°
  for (let grad = 5; grad < 90; grad += 5) {
    const rad = grad * Math.PI / 180;
    const ix  = bogR * Math.sin(rad);    // Punkt auf Bogen (Winkel von Senkrechter)
    const iy  = bogR * Math.cos(rad);
    const len = grad % 10 === 0 ? 6 : 3;
    const rix = (bogR+len) * Math.sin(rad);
    const riy = (bogR+len) * Math.cos(rad);
    winkelHtml += `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}"
      x2="${rix.toFixed(1)}" y2="${riy.toFixed(1)}"
      stroke="${f70}" stroke-width="${grad%10===0?'0.9':'0.6'}"/>`;
    if (grad % 10 === 0) {
      const tx = (bogR+len+5)*Math.sin(rad);
      const ty = (bogR+len+5)*Math.cos(rad);
      winkelHtml += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"
        text-anchor="middle" dominant-baseline="middle"
        class="geo-zahl geo-zahl--klein" fill="${f70}">${grad}°</text>`;
    }
  }
  // Rechter-Winkel-Symbol unten links
  winkelHtml += `<polyline points="10,280 10,270 0,270"
    fill="none" stroke="${farbe}" stroke-width="1.0"/>`;
  // Winkelangaben an den anderen Winkeln
  // Winkel bei (560,280): arctan(280/560) ≈ 26.57° → zeige "27°"
  winkelHtml += `<text x="540" y="268" text-anchor="end"
    class="geo-zahl geo-zahl--klein" fill="${f70}">27°</text>`;
  // Winkel bei (0,0): 90° − 27° = 63°
  winkelHtml += `<text x="12" y="14" text-anchor="start"
    class="geo-zahl geo-zahl--klein" fill="${f70}">63°</text>`;

  D.geoWinkelkreis.innerHTML = winkelHtml;
}

/**
 * Snap: Gibt Canvas-Koordinaten zurück wenn Stift nahe einer Kante.
 */
function geodreieckSnap(e, canvas) {
  if (!Z.geodreieckAktiv) return null;
  const client = clientKoord(e);
  const kanten = geodreieckKantenClient();
  const snapPx = KONFIGURATION.GEO_SNAP_PX;
  let best = null, minDist = Infinity;

  for (const k of kanten) {
    const proj = punktAufLinie(client, k.p1, k.p2);
    const dist = Math.hypot(client.x-proj.x, client.y-proj.y);
    if (dist < snapPx && dist < minDist) { minDist = dist; best = proj; }
  }

  if (best) {
    D.geoFuehrung.setAttribute('display', 'inline');
    const rect = canvas.getBoundingClientRect();
    const skalX = canvas.width/rect.width, skalY = canvas.height/rect.height;
    return { x: (best.x-rect.left)*skalX, y: (best.y-rect.top)*skalY };
  }
  D.geoFuehrung.setAttribute('display', 'none');
  return null;
}

/** Geodreieck-Kanten in Client-Koordinaten berechnen. */
function geodreieckKantenClient() {
  const rect   = D.geoWrapper.getBoundingClientRect();
  const sk     = Z.geoSkalierung;
  const winRad = Z.geoWinkel * Math.PI / 180;
  const cos    = Math.cos(winRad), sin = Math.sin(winRad);
  // Ecken in SVG-Koordinaten: A=(0,0), B=(560,280), C=(0,280)
  const eckenSvg = [
    { x: 0,   y: 0   },
    { x: 560, y: 280 },
    { x: 0,   y: 280 },
  ];
  // Umrechnung in Client-Koordinaten
  const originX = rect.left, originY = rect.top;
  const punkte = eckenSvg.map(e => ({
    x: e.x*sk*cos - e.y*sk*sin + originX,
    y: e.x*sk*sin + e.y*sk*cos + originY,
  }));
  return [
    { p1: punkte[0], p2: punkte[1], name: 'hypotenuse' },
    { p1: punkte[1], p2: punkte[2], name: 'basis'       },
    { p1: punkte[2], p2: punkte[0], name: 'senkrechte'  },
  ];
}

/** Geodreieck-Interaktion initialisieren.
 *  DIE GESAMTE SVG-FLÄCHE ist greifbar – kein separater Move-Griff.
 */
function geodreieckInit() {
  const svg = D.geoSvg;

  // ── SVG-Fläche: Verschieben ─────────────────────────────────
  svg.addEventListener('touchstart', e => {
    if (!Z.geodreieckAktiv) return;
    // Wenn der Dreh-Griff berührt wird → nicht verschieben
    if (e.target === D.geoDrehGriff || D.geoDrehGriff.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    Z.geoDrag = {
      art: 'move', startX: t.clientX, startY: t.clientY,
      startPos: { ...Z.geoPos },
    };
  }, { passive: false });

  svg.addEventListener('mousedown', e => {
    if (!Z.geodreieckAktiv) return;
    if (e.target === D.geoDrehGriff || D.geoDrehGriff.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    Z.geoDrag = {
      art: 'move', startX: e.clientX, startY: e.clientY,
      startPos: { ...Z.geoPos },
    };
  });

  // ── Dreh-Griff ──────────────────────────────────────────────
  D.geoDrehGriff.addEventListener('touchstart', e => {
    if (!Z.geodreieckAktiv) return;
    e.preventDefault(); e.stopPropagation();
    const t    = e.touches[0];
    const rect = D.geoWrapper.getBoundingClientRect();
    // Drehpunkt = untere linke Ecke des Wrappers (rechter Winkel)
    const svgH   = parseFloat(D.geoSvg.style.height) || 210;
    const pivotX = rect.left;
    const pivotY = rect.top + svgH;
    Z.geoDrag = {
      art: 'rotate', pivotX, pivotY,
      startWinkel: winkelZwischen(pivotX, pivotY, t.clientX, t.clientY) - Z.geoWinkel,
    };
  }, { passive: false });

  D.geoDrehGriff.addEventListener('mousedown', e => {
    if (!Z.geodreieckAktiv) return;
    e.preventDefault(); e.stopPropagation();
    const rect = D.geoWrapper.getBoundingClientRect();
    const svgH = parseFloat(D.geoSvg.style.height) || 210;
    const pivotX = rect.left, pivotY = rect.top + svgH;
    Z.geoDrag = {
      art: 'rotate', pivotX, pivotY,
      startWinkel: winkelZwischen(pivotX, pivotY, e.clientX, e.clientY) - Z.geoWinkel,
    };
  });

  // ── Globale Move/End ────────────────────────────────────────
  document.addEventListener('touchmove', e => {
    if (!Z.geoDrag) return;
    e.preventDefault();
    _geoBewegen(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener('mousemove', e => {
    if (!Z.geoDrag) return;
    _geoBewegen(e.clientX, e.clientY);
  });

  document.addEventListener('touchend',  () => { Z.geoDrag = null; });
  document.addEventListener('mouseup',   () => { Z.geoDrag = null; });
}

function _geoBewegen(cx, cy) {
  if (!Z.geoDrag) return;
  if (Z.geoDrag.art === 'move') {
    const dx = cx - Z.geoDrag.startX, dy = cy - Z.geoDrag.startY;
    Z.geoPos = { x: Z.geoDrag.startPos.x+dx, y: Z.geoDrag.startPos.y+dy };
  } else if (Z.geoDrag.art === 'rotate') {
    Z.geoWinkel = Math.round(
      winkelZwischen(Z.geoDrag.pivotX, Z.geoDrag.pivotY, cx, cy) - Z.geoDrag.startWinkel
    );
  }
  geodreieckTransformAnwenden();
}


/* ═══════════════════════════════════════════════════════════════════
   15. SPOTLIGHT
════════════════════════════════════════════════════════════════════ */
function spotlightAn(form) {
  Z.spotFenster = {
    x: (window.innerWidth  - KONFIGURATION.SPOTLIGHT_START_B) / 2,
    y: (window.innerHeight - KONFIGURATION.SPOTLIGHT_START_H) / 2,
    b: KONFIGURATION.SPOTLIGHT_START_B, h: KONFIGURATION.SPOTLIGHT_START_H,
    form,
  };
  D.spotlightOverlay.style.display = 'block';
  D.spotlightOverlay.setAttribute('aria-hidden', 'false');
  D.spotlightFenster.classList.toggle('oval', form === 'oval');
  spotlightAktualisieren();
}
function spotlightAus() {
  D.spotlightOverlay.style.display = 'none';
  D.spotlightOverlay.setAttribute('aria-hidden', 'true');
}
function spotlightAktualisieren() {
  const f = Z.spotFenster;
  D.spotlightFenster.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.b}px;height:${f.h}px;`;
  D.spotlightFenster.classList.toggle('oval', f.form === 'oval');
  const m = D.spotlightMaske, W = window.innerWidth, H = window.innerHeight;
  if (f.form === 'oval') {
    const mask = `radial-gradient(ellipse ${f.b/2}px ${f.h/2}px at ${f.x+f.b/2}px ${f.y+f.h/2}px, transparent 99%, black 100%)`;
    m.style.webkitMaskImage = mask; m.style.maskImage = mask; m.style.clipPath = '';
  } else {
    m.style.webkitMaskImage = ''; m.style.maskImage = '';
    m.style.clipPath = `polygon(0 0,${W}px 0,${W}px ${H}px,0 ${H}px,0 0,${f.x}px ${f.y}px,${f.x}px ${f.y+f.h}px,${f.x+f.b}px ${f.y+f.h}px,${f.x+f.b}px ${f.y}px,${f.x}px ${f.y}px)`;
  }
}
function spotDragStart(griff, cx, cy) {
  Z.spotGriff = griff;
  Z.spotDragStart = { startX:cx,startY:cy,fx:Z.spotFenster.x,fy:Z.spotFenster.y,fb:Z.spotFenster.b,fh:Z.spotFenster.h };
}
function spotZiehen(cx, cy) {
  if (!Z.spotGriff || !Z.spotDragStart) return;
  const s=Z.spotDragStart, f=Z.spotFenster, dx=cx-s.startX, dy=cy-s.startY;
  const MB=KONFIGURATION.SPOTLIGHT_MIN_B, MH=KONFIGURATION.SPOTLIGHT_MIN_H;
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
    g.addEventListener('touchstart', e => {
      if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
      e.preventDefault(); e.stopPropagation();
      spotDragStart(g.dataset.griff, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    g.addEventListener('mousedown', e => {
      if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
      e.preventDefault(); e.stopPropagation();
      spotDragStart(g.dataset.griff, e.clientX, e.clientY);
    });
  });
  const fen = D.spotlightFenster;
  const innen = (x,y)=>{const f=Z.spotFenster,r=22;return x>f.x+r&&x<f.x+f.b-r&&y>f.y+r&&y<f.y+f.h-r;};
  fen.addEventListener('touchstart', e => {
    if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
    if (e.target.classList.contains('spot-griff')) return;
    e.preventDefault();
    const t=e.touches[0]; if(innen(t.clientX,t.clientY)) spotDragStart('mitte',t.clientX,t.clientY);
  }, { passive: false });
  fen.addEventListener('mousedown', e => {
    if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
    if (e.target.classList.contains('spot-griff')) return;
    if (innen(e.clientX,e.clientY)) spotDragStart('mitte',e.clientX,e.clientY);
  });
  document.addEventListener('touchmove', e => {
    if ((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) { e.preventDefault(); spotZiehen(e.touches[0].clientX,e.touches[0].clientY); }
  }, { passive: false });
  document.addEventListener('touchend', ()=>{ Z.spotGriff=null; Z.spotDragStart=null; }, { passive: false });
  document.addEventListener('mousemove', e=>{ if((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) spotZiehen(e.clientX,e.clientY); });
  document.addEventListener('mouseup', ()=>{ Z.spotGriff=null; Z.spotDragStart=null; });
}


/* ═══════════════════════════════════════════════════════════════════
   16. ZOOM (inkl. Scroll-Fix für linken Rand)

   Problem: Bei transform-origin:top center und overflow:auto
   war der linke Rand nicht erreichbar weil der skalierte Inhalt
   zentriert und nach links "weggeschoben" wurde.

   Lösung: transform-origin:top left + margin-basierte Zentrierung.
   - zoom-scaler bekommt transform-origin: top left
   - Die Zentrierung erfolgt per margin-left: max(0, (viewportBreite - skalierteBreite)/2)
   - Beim Zoomen wird margin-left per JS neu gesetzt
   - zoom-wrapper hat overflow:auto immer aktiv
════════════════════════════════════════════════════════════════════ */
function zoomSetzen(n) {
  Z.zoom = Math.min(KONFIGURATION.ZOOM_MAX, Math.max(KONFIGURATION.ZOOM_MIN, n));

  // transform-origin: top left → Skalierung von der linken oberen Ecke
  D.zoomScaler.style.transform = `scale(${Z.zoom})`;
  D.zoomScaler.style.transformOrigin = 'top left';

  // Zentrierung: wenn skalierter Inhalt schmaler als Viewport → zentrieren
  // Wenn breiter → kein margin, scrollen möglich
  const vpBreite    = D.zoomWrapper.clientWidth;
  const containerB  = D.pdfContainer.scrollWidth || vpBreite;
  const skaliert    = containerB * Z.zoom;
  const marginLeft  = Math.max(0, (vpBreite - skaliert) / 2);
  D.zoomScaler.style.marginLeft = `${marginLeft}px`;

  // Höhe des Scalers explizit setzen damit der Wrapper korrekt scrollt
  const containerH = D.pdfContainer.scrollHeight || 600;
  D.zoomScaler.style.height = `${containerH * Z.zoom}px`;

  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;

  // Geodreieck neu skalieren
  if (Z.geodreieckAktiv) geodreieckSkalieren();
}

function zoomZentrierungAktualisieren() {
  // Wird nach PDF-Ladevorgang aufgerufen wenn Container-Breite bekannt
  if (D.pdfContainer.style.display !== 'none') zoomSetzen(Z.zoom);
}

function pinchBewegen(e) {
  if (e.touches.length!==2) return; e.preventDefault();
  const ab=pinchAbstand(e.touches);
  if (!Z.pinch) { Z.pinch={abstand:ab,zoomStart:Z.zoom}; return; }
  zoomSetzen(Z.pinch.zoomStart*(ab/Z.pinch.abstand));
}

function zoomInit() {
  D.btnZoomPlus.addEventListener('click',  () => zoomSetzen(Z.zoom+KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomMinus.addEventListener('click', () => zoomSetzen(Z.zoom-KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));

  D.zoomWrapper.addEventListener('touchstart', e => { if (e.touches.length===2) Z.pinch=null; }, { passive: false });
  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length===2&&Z.modus==='zeichnen') { e.preventDefault(); pinchBewegen(e); }
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchend', ()=>{ if(Z.pinch) Z.pinch=null; }, { passive:true });
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey||e.metaKey) { e.preventDefault(); zoomSetzen(Z.zoom+(e.deltaY>0?-KONFIGURATION.ZOOM_SCHRITT:KONFIGURATION.ZOOM_SCHRITT)); }
  }, { passive: false });

  // Fensterbreiten-Änderung: Zentrierung neu berechnen
  window.addEventListener('resize', () => {
    zoomZentrierungAktualisieren();
    laserCanvasAnpassen();
    if (Z.geodreieckAktiv) geodreieckSkalieren();
  });
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
    Object.assign(Z, {
      annotationen:{}, undoVerlauf:{}, redoVerlauf:{},
      aktiveSeite:1, viewports:{}, pxProCm:{},
    });
    zoomSetzen(1.0);
    D.startAnzeige.style.display = 'none';
    D.pdfContainer.innerHTML     = '';
    D.pdfContainer.style.display = 'flex';

    for (let i=1; i<=Z.seitenAnzahl; i++) {
      ladeAnzeige(true, `Seite ${i} / ${Z.seitenAnzahl}…`);
      await pdfSeiteRendern(i);
    }

    D.zoomSteuerung.style.display = 'flex';
    // Zentrierung nach Laden
    requestAnimationFrame(zoomZentrierungAktualisieren);
    // Geodreieck kalibrieren
    if (Z.geodreieckAktiv) { geodreieckSkalieren(); geodreieckZeichnen(); }
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
  Z.viewports[nr] = { breite:W, hoehe:H };
  Z.pxProCm[nr]   = KONFIGURATION.PDF_SCALE * 72 / 2.54;

  const cont = document.createElement('div');
  cont.className='seite-container'; cont.dataset.seite=nr;
  cont.style.width=`${W}px`; cont.style.height=`${H}px`;

  const pdfC=document.createElement('canvas');
  pdfC.className='pdf-canvas'; pdfC.width=W; pdfC.height=H;
  pdfC.style.width=`${W}px`; pdfC.style.height=`${H}px`;
  cont.appendChild(pdfC);

  const zC=document.createElement('canvas');
  zC.className='zeichen-canvas'; zC.width=W; zC.height=H;
  zC.dataset.werkzeug=Z.werkzeug;
  cont.appendChild(zC);

  const lC=document.createElement('canvas');
  lC.className='lehrer-canvas'; lC.width=W; lC.height=H;
  lC.setAttribute('aria-hidden','true');
  cont.appendChild(lC);

  D.pdfContainer.appendChild(cont);
  await seite.render({canvasContext:pdfC.getContext('2d'),viewport}).promise;
  zeichenListeners(zC);

  new IntersectionObserver(ee=>{
    ee.forEach(e=>{ if(e.isIntersecting&&e.intersectionRatio>=0.4) Z.aktiveSeite=nr; });
  },{root:D.zoomWrapper,threshold:0.4}).observe(cont);
}


/* ═══════════════════════════════════════════════════════════════════
   18. PDF-EXPORT
════════════════════════════════════════════════════════════════════ */
async function pdfSpeichern() {
  if (!Z.pdfBytes) { toast('Keine PDF geladen.','fehler'); return; }
  ladeAnzeige(true,'PDF wird gespeichert…');
  try {
    const pdfDoc=await PDFLib.PDFDocument.load(Z.pdfBytes);
    const seiten=pdfDoc.getPages();
    for (let s=1;s<=Z.seitenAnzahl;s++) {
      const pdfSeite=seiten[s-1], vp=Z.viewports[s]; if(!vp) continue;
      const {width:pdfB,height:pdfH}=pdfSeite.getSize();
      const zC=zeichenCanvas(s);
      if (zC&&Z.annotationen[s]?.length) {
        const bild=await pdfDoc.embedPng(base64ZuBytes(zC.toDataURL('image/png').split(',')[1]));
        pdfSeite.drawImage(bild,{x:0,y:0,width:pdfB,height:pdfH,opacity:1});
      }
    }
    pdfDoc.setCreator('EduLayer PWA'); pdfDoc.setModificationDate(new Date());
    const name=`EduLayer_${zeitstempel()}.pdf`;
    download(await pdfDoc.save(), name);
    toast(`Gespeichert: ${name}`,'erfolg',3500);
  } catch(err) {
    console.error('[EduLayer] Speicherfehler:',err);
    toast('Fehler beim Speichern.','fehler',4000);
  } finally { ladeAnzeige(false); }
}


/* ═══════════════════════════════════════════════════════════════════
   19. SERVICE WORKER
════════════════════════════════════════════════════════════════════ */
function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg=await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound',()=>{
        const w=reg.installing;
        w.addEventListener('statechange',()=>{
          if(w.state==='installed'&&navigator.serviceWorker.controller)
            toast('Update verfügbar – Seite neu laden.','info',6000);
        });
      });
    } catch(e){console.warn('[EduLayer] SW:',e);}
  });
}


/* ═══════════════════════════════════════════════════════════════════
   20. APP-START
════════════════════════════════════════════════════════════════════ */
function appStart() {
  console.log('[EduLayer] v6 startet…');

  laserCanvasAnpassen();
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

  // Drag & Drop
  document.addEventListener('dragover', e=>e.preventDefault());
  document.addEventListener('drop', e=>{
    e.preventDefault();
    const f=e.dataTransfer?.files[0];
    if(f?.type==='application/pdf') pdfLaden(f);
  });

  // iOS Bounce verhindern
  document.addEventListener('touchmove', e=>{
    const ziel=e.target;
    const erlaubt=
      ziel.closest('.zoom-wrapper')     ||
      ziel.closest('.sidebar')          ||
      ziel.closest('.spotlight-overlay')||
      ziel.closest('.zoom-steuerung')   ||
      ziel.closest('.fokus-toolbar')    ||
      ziel.closest('.einstellungen-panel')||
      ziel.closest('.notizen-panel')    ||
      ziel.closest('.geodreieck-wrapper')||
      ziel.closest('.flyout');
    if(!erlaubt) e.preventDefault();
  }, { passive: false });

  // Orientierungswechsel
  window.addEventListener('orientationchange',()=>{
    setTimeout(()=>{
      laserCanvasAnpassen();
      zoomZentrierungAktualisieren();
      if(Z.geodreieckAktiv) geodreieckSkalieren();
    }, 350);
  });

  console.log('[EduLayer] v6 bereit.');
}

if (document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else { appStart(); }
