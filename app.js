/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 6.1)                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ÄNDERUNGEN v6.1:
 *  - Flyout: position:fixed + flyoutPositionieren() behebt iOS-
 *    Safari overflow-clip-Bug (overflow-y:auto bricht overflow-x:visible)
 *  - Geodreieck: komplett neu gezeichnet als realistisches deutsches
 *    Schuldreieck (Winkelhalbkreis 0–90°, cm-Skalen auf 3 Seiten,
 *    5mm-Parallellinien, korrekte Winkelangaben)
 *  - transform-origin des Wrappers korrigiert: Drehpunkt = Spitze (0,0)
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
 * 16.  ZOOM
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

  // Geodreieck (PNG-Basis)
  // Bild ist 1280×640px → Seitenverhältnis 2:1 (Breite:Höhe)
  // Darstellungsbreite entspricht 28cm reale Kantenlänge.
  // Nullpunkt der Skala liegt bei x=50% (Bildmitte), y≈90% (etwas über
  // der reinen Bildunterkante, da unten ein kleiner cm-Lineal-Rand ist).
  // Spitze (90°-Winkel) liegt bei x=50%, y=0.
  GEO_SEITENVERHAELTNIS: 0.5,  // Höhe / Breite des PNGs
  GEO_NULLPUNKT_Y_ANTEIL: 0.90, // Y-Position des Nullpunkts relativ zur Bildhöhe
  GEO_CM_LAENGE:     28,   // Basislinie (volle Bildbreite) in cm
  GEO_SNAP_PX:       20,
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
  fokusModus:      'aus',

  pdfDokument:     null,
  seitenAnzahl:    0,
  aktiveSeite:     1,
  pdfBytes:        null,
  viewports:       {},
  pxProCm:         {},

  annotationen:    {},
  undoVerlauf:     {},
  redoVerlauf:     {},

  notizenProSeite: {},
  notizenOffen:    false,
  notizenSeite:    1,

  markerOffscreen: null,

  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  spotGriff:       null,
  spotDragStart:   null,

  geodreieckAktiv: false,
  geoPos:          { x: 80, y: 120 },
  geoWinkel:       0,
  geoSkalierung:   1,
  geoKalibrierung: 1.0,   // Korrekturfaktor (1.0 = 100%), via Einstellungen feinjustierbar
  geoDrag:         null,
  geoSnapAktiv:    false,

  zoom:            1.0,
  pinch:           null,

  sidebarSeite:    'right',

  laserSchweif:    [],
  laserAnimFrame:  null,
  laserAktiv:      false,

  offenesFlyout:   null,

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

  btnDateiLaden:     document.getElementById('btn-datei-laden'),
  btnStartLaden:     document.getElementById('btn-start-laden'),
  dateiInput:        document.getElementById('datei-input'),

  btnStiftAktiv:     document.getElementById('btn-stift-aktiv'),
  iconStiftAktiv:    document.getElementById('icon-stift-aktiv'),
  labelStiftAktiv:   document.getElementById('label-stift-aktiv'),
  flyoutStifte:      document.getElementById('flyout-stifte'),
  flyoutStiftBtns:   document.querySelectorAll('#flyout-stifte .flyout-btn'),

  farbDots:          document.querySelectorAll('.farb-dot'),

  btnRadierer:       document.getElementById('btn-radierer'),

  btnUndo:           document.getElementById('btn-undo'),
  btnRedo:           document.getElementById('btn-redo'),
  btnSeiteLeeren:    document.getElementById('btn-seite-leeren'),

  btnModusWechsel:   document.getElementById('btn-modus-wechsel'),

  btnFokusAktiv:     document.getElementById('btn-fokus-aktiv'),
  iconFokusAktiv:    document.getElementById('icon-fokus-aktiv'),
  labelFokusAktiv:   document.getElementById('label-fokus-aktiv'),
  flyoutFokus:       document.getElementById('flyout-fokus'),
  flyoutFokusBtns:   document.querySelectorAll('#flyout-fokus .flyout-btn'),

  fokusToolbar:      document.getElementById('fokus-toolbar'),
  fokusToolbarLabel: document.getElementById('fokus-toolbar-label'),
  btnFokusSchliessen: document.getElementById('btn-fokus-schliessen'),

  btnGeodrei:        document.getElementById('btn-geodreieck'),
  geoWrapper:        document.getElementById('geodreieck-wrapper'),
  geoBild:           document.getElementById('geodreieck-svg'),
  geoFuehrung:       document.getElementById('geo-fuehrungslinie'),
  geoDrehGriff:      document.getElementById('geo-dreh-griff'),

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
  sliderGeoKalibrierung:  document.getElementById('slider-geo-kalibrierung'),
  geoKalibrierungAnzeige: document.getElementById('geo-kalibrierung-anzeige'),

  spotlightOverlay:  document.getElementById('spotlight-overlay'),
  spotlightFenster:  document.getElementById('spotlight-fenster'),
  spotlightMaske:    document.getElementById('spotlight-maske'),
  spotGriffe:        null,

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

/** Gespeicherten Geodreieck-Kalibrierungsfaktor laden (Default 100%). */
function geoKalibrierungLaden() {
  let prozent = 100;
  try {
    const gespeichert = localStorage.getItem('edulayer-geo-kalibrierung');
    if (gespeichert) prozent = parseFloat(gespeichert);
  } catch(_) {}
  Z.geoKalibrierung = prozent / 100;
  D.sliderGeoKalibrierung.value = prozent;
  D.geoKalibrierungAnzeige.textContent = `${prozent} %`;
}


/* ═══════════════════════════════════════════════════════════════════
   6. FLYOUT-UNTERMENÜS
   ─────────────────────────────────────────────────────────────────
   FIX: Flyouts sind position:fixed. Die Funktion flyoutPositionieren()
   berechnet die korrekte Position relativ zum auslösenden Button per
   getBoundingClientRect() und setzt left/top direkt am Element.

   Hintergrund: Safari/iOS ignoriert overflow-x:visible wenn das
   Elternelement overflow-y:auto hat (CSS-Spec §overflow 3.2).
   Alle position:absolute Kinder werden dann geclippt.
   Mit position:fixed liegt das Flyout außerhalb des Scroll-Stacking-
   Kontexts und ist immer sichtbar.
════════════════════════════════════════════════════════════════════ */

/**
 * Positioniert ein Flyout-Element (position:fixed) neben dem auslösenden Button.
 * @param {HTMLElement} flyout  – das Flyout-Element
 * @param {HTMLElement} button  – der auslösende Button
 */
function flyoutPositionieren(flyout, button) {
  // Flyout kurz sichtbar machen um seine Größe zu messen
  flyout.style.visibility = 'hidden';
  flyout.style.display = 'flex';

  const btnRect     = button.getBoundingClientRect();
  const flyoutB     = flyout.offsetWidth;
  const flyoutH     = flyout.offsetHeight;
  const sidebarSeite = D.body.dataset.sidebar || 'right';
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left, top;

  if (sidebarSeite === 'right') {
    // Sidebar rechts → Flyout öffnet nach LINKS vom Button
    left = btnRect.left - flyoutB - 6;
  } else {
    // Sidebar links → Flyout öffnet nach RECHTS vom Button
    left = btnRect.right + 6;
  }

  // Vertikal: Flyout auf Höhe des Buttons zentrieren
  top = btnRect.top + (btnRect.height / 2) - (flyoutH / 2);

  // Viewport-Grenzen einhalten
  top  = Math.max(8, Math.min(top,  vh - flyoutH - 8));
  left = Math.max(8, Math.min(left, vw - flyoutB - 8));

  flyout.style.left       = `${left}px`;
  flyout.style.top        = `${top}px`;
  flyout.style.visibility = 'visible';
}

function flyoutsSchliessen() {
  D.flyoutStifte.style.display = 'none';
  D.flyoutFokus.style.display  = 'none';
  D.btnStiftAktiv.setAttribute('aria-expanded', 'false');
  D.btnFokusAktiv.setAttribute('aria-expanded', 'false');
  Z.offenesFlyout = null;
}

function stiftFlyoutUmschalten() {
  if (Z.offenesFlyout === 'stifte') {
    flyoutsSchliessen();
  } else {
    flyoutsSchliessen();
    flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
    D.btnStiftAktiv.setAttribute('aria-expanded', 'true');
    Z.offenesFlyout = 'stifte';
  }
}

function fokusFlyoutUmschalten() {
  if (Z.offenesFlyout === 'fokus') {
    flyoutsSchliessen();
  } else {
    flyoutsSchliessen();
    flyoutPositionieren(D.flyoutFokus, D.btnFokusAktiv);
    D.btnFokusAktiv.setAttribute('aria-expanded', 'true');
    Z.offenesFlyout = 'fokus';
  }
}

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

function stiftButtonAktualisieren(werkzeug) {
  const info = WERKZEUG_ICONS[werkzeug];
  if (!info) return;
  D.iconStiftAktiv.innerHTML = info.svg;
  D.labelStiftAktiv.textContent = info.label;
  D.flyoutStiftBtns.forEach(b => {
    const a = b.dataset.werkzeug === werkzeug;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function fokusButtonAktualisieren(modus) {
  const info = FOKUS_ICONS[modus];
  if (info) {
    D.iconFokusAktiv.innerHTML = info.svg;
    D.labelFokusAktiv.textContent = info.label;
  } else {
    D.iconFokusAktiv.innerHTML = `
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12"/>
      <path d="M19.07 4.93l-2.12 2.12M6.05 16.95l-2.12 2.12"/>`;
    D.labelFokusAktiv.textContent = 'Fokus';
  }
  D.btnFokusAktiv.setAttribute('aria-pressed', modus !== 'aus' ? 'true' : 'false');
  D.btnFokusAktiv.classList.toggle('aktiv', modus !== 'aus');
  D.flyoutFokusBtns.forEach(b => {
    const a = b.dataset.fokus === modus;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function fokusModusSetzen(modus) {
  if (Z.fokusModus === 'oval' || Z.fokusModus === 'rechteck') spotlightAus();
  if (Z.fokusModus === 'laser') laserModeAus();

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

function fokusModusAus() { fokusModusSetzen('aus'); }


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
  // Flyout-Position nach Seitenwechsel neu berechnen falls offen
  if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
  if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
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
  D.sliderGeoKalibrierung.addEventListener('input', () => {
    const prozent = +D.sliderGeoKalibrierung.value;
    Z.geoKalibrierung = prozent / 100;
    D.geoKalibrierungAnzeige.textContent = `${prozent} %`;
    try { localStorage.setItem('edulayer-geo-kalibrierung', String(prozent)); } catch(_) {}
    if (Z.geodreieckAktiv) geodreieckSkalieren();
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

  D.btnRadierer.classList.toggle('aktiv', name === 'radierer');
  D.btnRadierer.setAttribute('aria-pressed', name === 'radierer' ? 'true' : 'false');

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
  D.btnDateiLaden.addEventListener('click', () => D.dateiInput.click());
  D.btnStartLaden.addEventListener('click', () => D.dateiInput.click());
  D.dateiInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f?.type === 'application/pdf') pdfLaden(f);
    D.dateiInput.value = '';
  });

  D.btnStiftAktiv.addEventListener('click', stiftFlyoutUmschalten);

  D.flyoutStiftBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      werkzeugWaehlen(btn.dataset.werkzeug);
      flyoutsSchliessen();
    });
  });

  D.farbDots.forEach(dot => {
    dot.addEventListener('click', () => { if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe); });
  });

  D.btnRadierer.addEventListener('click', () => werkzeugWaehlen('radierer'));

  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);

  D.btnModusWechsel.addEventListener('click', scrollModusUmschalten);

  D.btnFokusAktiv.addEventListener('click', fokusFlyoutUmschalten);
  D.flyoutFokusBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const modus = btn.dataset.fokus;
      if (Z.fokusModus === modus) fokusModusSetzen('aus');
      else fokusModusSetzen(modus);
    });
  });

  D.btnFokusSchliessen.addEventListener('click', fokusModusAus);
  D.btnGeodrei.addEventListener('click', geodreieckUmschalten);

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
    if (!ziel.closest('#gruppe-stifte') &&
        !ziel.closest('#gruppe-fokus') &&
        !ziel.closest('.flyout')) {
      flyoutsSchliessen();
    }
  }, { passive: true });
  document.addEventListener('mousedown', e => {
    if (!Z.offenesFlyout) return;
    if (!e.target.closest('#gruppe-stifte') &&
        !e.target.closest('#gruppe-fokus') &&
        !e.target.closest('.flyout')) {
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
   14. GEODREIECK (PNG-Basis)
   ─────────────────────────────────────────────────────────────────
   Statt eines selbstgezeichneten SVGs wird ein realistisches PNG-Bild
   eines deutschen Schuldreiecks verwendet (icons/geodreieck.png).

   Koordinatensystem des Wrappers:
     - transform-origin: 50% 100% (Mitte der Unterkante = Drehpunkt)
     - Bildbreite = 28cm reale Kantenlänge (volle PNG-Breite)
     - Bildhöhe = Breite × GEO_SEITENVERHAELTNIS (0.5 → 2:1-Verhältnis)
     - Spitze (90°-Winkelpunkt) liegt bei x = 50% der Bildbreite, y = 0
     - Nullpunkt der Skala (für Snap-Berechnung) liegt bei
       x = 50%, y = GEO_NULLPUNKT_Y_ANTEIL × Bildhöhe

   Die drei Kanten für den Lineal-Snap werden aus diesen drei Punkten
   berechnet:
     Spitze      S = (B/2, 0)
     Unten-Links UL = (0, H)
     Unten-Rechts UR = (B, H)
   (B = Bildbreite in px, H = Bildhöhe in px, im Client-Koordinatensystem
   nach Skalierung/Rotation)
════════════════════════════════════════════════════════════════════ */

function geodreieckAn() {
  Z.geodreieckAktiv = true;
  D.geoWrapper.style.display = 'block';
  D.geoWrapper.setAttribute('aria-hidden', 'false');
  D.btnGeodrei.classList.add('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'true');
  geodreieckSkalieren();
  geodreieckTransformAnwenden();
  toast('Geodreieck: Fläche = Verschieben · Dreh-Griff = Drehen', 'info', 3000);
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

/**
 * Skalierung: Bildbreite = GEO_CM_LAENGE × pxProCm × zoom
 *
 * MASS-GENAUIGKEIT (1cm Geodreieck = 1cm PDF):
 * ─────────────────────────────────────────────────────────────────
 * Das PDF wird mit canvas.width = canvas.style.width gerendert
 * (1 interner Pixel = 1 CSS-Pixel, kein HiDPI-Downscaling). Damit
 * gilt für jede Seite:
 *   pxProCm[seite] = PDF_SCALE × 72 / 2.54   (CSS-Pixel pro cm bei Zoom=1)
 * Diese Größe ist für ALLE Seiten identisch, solange sie mit dem
 * gleichen PDF_SCALE gerendert werden (so im Code: pdfSeiteRendern()).
 *
 * Die sichtbare Größe des PDFs auf dem Bildschirm bei einem
 * bestimmten Zoom ist: pxProCm × Z.zoom (weil .zoom-scaler mit
 * transform:scale(Z.zoom) skaliert wird). Das Geodreieck wird mit
 * exakt derselben Formel skaliert → beide Maßstäbe sind also
 * rechnerisch identisch, unabhängig vom Zoom-Level.
 *
 * KALIBRIERUNG DES PNG-BILDES:
 * Voraussetzung ist, dass das PNG selbst maßstabsgetreu ist:
 *   - Die volle Bildbreite muss exakt GEO_CM_LAENGE (28cm) entsprechen
 *   - Das Seitenverhältnis (Höhe/Breite) muss GEO_SEITENVERHAELTNIS
 *     entsprechen (aktuell 0.5 → 2:1)
 * Falls ein anderes PNG verwendet wird, das nicht exakt 28cm breit
 * gezeichnet ist (z.B. weil es einen Rand/Schlagschatten enthält),
 * muss GEO_CM_LAENGE und/oder GEO_SEITENVERHAELTNIS in KONFIGURATION
 * entsprechend angepasst werden, damit 1cm im Bild wirklich 1cm auf
 * dem Bildschirm ergibt. Am einfachsten testet man das, indem man
 * das Geodreieck bei aktivem PDF auf eine bekannte 1cm-Markierung
 * im Dokument legt und mit einem echten Lineal vergleicht.
 */
function geodreieckSkalieren() {
  const pxProCm = Z.pxProCm[Z.aktiveSeite] || (KONFIGURATION.PDF_SCALE * 72 / 2.54);
  const breite  = KONFIGURATION.GEO_CM_LAENGE * pxProCm * Z.zoom * Z.geoKalibrierung;
  const hoehe   = breite * KONFIGURATION.GEO_SEITENVERHAELTNIS;
  Z.geoSkalierung = breite;  // aktuelle Breite in px (= px pro 28cm, kalibriert)
  D.geoBild.style.width  = `${breite}px`;
  D.geoBild.style.height = `${hoehe}px`;
}

function geodreieckTransformAnwenden() {
  // Drehpunkt = Mitte der Unterkante (transform-origin: 50% 100% am Wrapper)
  D.geoWrapper.style.transform =
    `translate(${Z.geoPos.x}px, ${Z.geoPos.y}px) rotate(${Z.geoWinkel}deg)`;
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
    D.geoFuehrung.setAttribute('x1', best.x);
    D.geoFuehrung.setAttribute('y1', best.y);
    D.geoFuehrung.setAttribute('x2', best.x);
    D.geoFuehrung.setAttribute('y2', best.y);
    const rect = canvas.getBoundingClientRect();
    const skalX = canvas.width/rect.width, skalY = canvas.height/rect.height;
    return { x: (best.x-rect.left)*skalX, y: (best.y-rect.top)*skalY };
  }
  D.geoFuehrung.setAttribute('display', 'none');
  return null;
}

/**
 * Berechnet die drei Dreieckskanten in Client-(Bildschirm-)Koordinaten.
 * Eckpunkte relativ zum Bild (vor Rotation):
 *   Spitze (90°-Winkel oben):  (B/2, 0)
 *   Unten links:               (0, H)
 *   Unten rechts:               (B, H)
 * Diese werden um den Drehpunkt (Mitte Unterkante = B/2, H) rotiert
 * und an die Wrapper-Position (Z.geoPos) verschoben.
 */
function geodreieckKantenClient() {
  const wrapRect = D.geoWrapper.getBoundingClientRect();
  const B = D.geoBild.offsetWidth;
  const H = D.geoBild.offsetHeight;
  const winRad = Z.geoWinkel * Math.PI / 180;
  const cos = Math.cos(winRad), sin = Math.sin(winRad);

  // Drehpunkt = Mitte der Unterkante, im Bild-Koordinatensystem: (B/2, H)
  const pivotX = B / 2, pivotY = H;

  // Eckpunkte im Bild-Koordinatensystem
  const eckenBild = [
    { x: B / 2, y: 0 },  // Spitze (90°)
    { x: 0,     y: H },  // Unten links
    { x: B,     y: H },  // Unten rechts
  ];

  // Rotation um den Drehpunkt, dann Verschiebung zur Wrapper-Position.
  // wrapRect.left/top entspricht der oberen linken Ecke des UNROTIERTEN
  // Wrappers; da CSS transform den Wrapper bereits rotiert hat, gibt
  // getBoundingClientRect() die tatsächliche (gerenderte) Bounding-Box
  // zurück – das reicht für Verschiebung nicht aus, da wir die Rotation
  // selbst nachvollziehen müssen. Wir berechnen daher direkt aus
  // Z.geoPos (unrotierter Ursprung oben-links) + Rotation um den Pivot.
  const ursprungX = Z.geoPos.x;
  const ursprungY = Z.geoPos.y;

  const punkte = eckenBild.map(p => {
    // Punkt relativ zum Drehpunkt
    const rx = p.x - pivotX;
    const ry = p.y - pivotY;
    // Rotieren
    const gx = rx * cos - ry * sin;
    const gy = rx * sin + ry * cos;
    // Zurück verschieben: Drehpunkt liegt bei (ursprungX+pivotX, ursprungY+pivotY)
    return {
      x: ursprungX + pivotX + gx,
      y: ursprungY + pivotY + gy,
    };
  });

  return [
    { p1: punkte[0], p2: punkte[1], name: 'kathete-links'  },
    { p1: punkte[1], p2: punkte[2], name: 'basis'          },
    { p1: punkte[0], p2: punkte[2], name: 'kathete-rechts' },
  ];
}

/**
 * Hit-Test: Liegt der Punkt (cx,cy) INNERHALB der Dreiecksfläche,
 * mit Sicherheitsabstand zu allen drei Kanten (= Snap-Zone)?
 *
 * Das löst den Konflikt zwischen "Geodreieck verschieben" (auf der
 * Fläche tippen) und "am Lineal entlang zeichnen" (nahe der Kante
 * tippen): Nur Treffer im Inneren (außerhalb der Snap-Zone) lösen
 * eine Verschiebung aus. Treffer nahe einer Kante oder außerhalb des
 * Dreiecks werden NICHT abgefangen, damit das darunterliegende
 * Zeichen-Canvas das Event bekommt und geodreieckSnap() greifen kann.
 *
 * Verfahren: Punkt-in-Dreieck-Test via Vorzeichen der Kreuzprodukte
 * (baryzentrisch/cross-product), kombiniert mit Mindestabstand zu
 * jeder Kante (= KONFIGURATION.GEO_SNAP_PX als Toleranzzone).
 */
function geodreieckTreffer(cx, cy) {
  const kanten = geodreieckKantenClient();
  const snapPx = KONFIGURATION.GEO_SNAP_PX;

  // 1) Liegt der Punkt überhaupt innerhalb des Dreiecks?
  //    Vorzeichen-Test: für jede Kante muss der Punkt auf derselben
  //    Seite liegen wie der jeweils dritte (gegenüberliegende) Eckpunkt.
  const [kLinks, kBasis, kRechts] = kanten;
  const eckpunkte = [kLinks.p1, kLinks.p2, kRechts.p2]; // Spitze, UL, UR (eindeutig)

  function vorzeichen(p1, p2, p3) {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  }
  const pPunkt = { x: cx, y: cy };
  const d1 = vorzeichen(pPunkt, eckpunkte[0], eckpunkte[1]);
  const d2 = vorzeichen(pPunkt, eckpunkte[1], eckpunkte[2]);
  const d3 = vorzeichen(pPunkt, eckpunkte[2], eckpunkte[0]);
  const hatNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hatPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  const imDreieck = !(hatNeg && hatPos);

  if (!imDreieck) return false;

  // 2) Mindestabstand zu ALLEN drei Kanten muss größer als die
  //    Snap-Zone sein, sonst gilt der Klick als "Kante", nicht "Fläche".
  for (const k of kanten) {
    const proj = punktAufLinie(pPunkt, k.p1, k.p2);
    const dist = Math.hypot(pPunkt.x - proj.x, pPunkt.y - proj.y);
    if (dist < snapPx) return false;
  }

  return true;
}

function geodreieckInit() {
  const wrapper = D.geoWrapper;

  // Wrapper: Verschieben NUR wenn Treffer im Inneren der Dreiecksfläche
  // (außerhalb der Snap-Zone an den Kanten). Sonst Event durchreichen,
  // damit das Zeichen-Canvas darunter den Klick für das Snap-Zeichnen
  // empfängt.
  wrapper.addEventListener('touchstart', e => {
    if (!Z.geodreieckAktiv) return;
    if (e.target === D.geoDrehGriff || D.geoDrehGriff.contains(e.target)) return;
    const t = e.touches[0];
    if (!geodreieckTreffer(t.clientX, t.clientY)) return; // Kante/außerhalb → durchreichen
    e.preventDefault(); e.stopPropagation();
    Z.geoDrag = {
      art: 'move', startX: t.clientX, startY: t.clientY,
      startPos: { ...Z.geoPos },
    };
  }, { passive: false });

  wrapper.addEventListener('mousedown', e => {
    if (!Z.geodreieckAktiv) return;
    if (e.target === D.geoDrehGriff || D.geoDrehGriff.contains(e.target)) return;
    if (!geodreieckTreffer(e.clientX, e.clientY)) return; // Kante/außerhalb → durchreichen
    e.preventDefault(); e.stopPropagation();
    Z.geoDrag = {
      art: 'move', startX: e.clientX, startY: e.clientY,
      startPos: { ...Z.geoPos },
    };
  });

  // Dreh-Griff: Rotation um die Mitte der Unterkante
  // (= transform-origin: 50% 100% des Wrappers)
  function geoRotateStart(cx, cy) {
    const wRect = D.geoWrapper.getBoundingClientRect();
    // Pivot in Client-Koordinaten: horizontale Mitte, untere Kante
    const pivotX = wRect.left + wRect.width / 2;
    const pivotY = wRect.bottom;
    Z.geoDrag = {
      art: 'rotate', pivotX, pivotY,
      // Offset: Winkel zwischen Dreh-Griff-Start und aktuellem geoWinkel
      // (Griff sitzt oben an der Spitze, 90°-Versatz zur 0°-Achse ist
      // bereits durch atan2 berücksichtigt, da wir relativ rechnen)
      startWinkel: winkelZwischen(pivotX, pivotY, cx, cy) - Z.geoWinkel,
    };
  }

  D.geoDrehGriff.addEventListener('touchstart', e => {
    if (!Z.geodreieckAktiv) return;
    e.preventDefault(); e.stopPropagation();
    geoRotateStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  D.geoDrehGriff.addEventListener('mousedown', e => {
    if (!Z.geodreieckAktiv) return;
    e.preventDefault(); e.stopPropagation();
    geoRotateStart(e.clientX, e.clientY);
  });

  // Globale Move/End-Events
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
    Z.geoPos = { x: Z.geoDrag.startPos.x + dx, y: Z.geoDrag.startPos.y + dy };
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
  const innen = (x,y) => {
    const f=Z.spotFenster,r=22;
    return x>f.x+r&&x<f.x+f.b-r&&y>f.y+r&&y<f.y+f.h-r;
  };
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
    if ((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) {
      e.preventDefault(); spotZiehen(e.touches[0].clientX,e.touches[0].clientY);
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { Z.spotGriff=null; Z.spotDragStart=null; }, { passive: false });
  document.addEventListener('mousemove', e => {
    if((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) spotZiehen(e.clientX,e.clientY);
  });
  document.addEventListener('mouseup', () => { Z.spotGriff=null; Z.spotDragStart=null; });
}


/* ═══════════════════════════════════════════════════════════════════
   16. ZOOM
════════════════════════════════════════════════════════════════════ */
function zoomSetzen(n) {
  Z.zoom = Math.min(KONFIGURATION.ZOOM_MAX, Math.max(KONFIGURATION.ZOOM_MIN, n));
  D.zoomScaler.style.transform       = `scale(${Z.zoom})`;
  D.zoomScaler.style.transformOrigin = 'top left';

  const vpBreite   = D.zoomWrapper.clientWidth;
  const containerB = D.pdfContainer.scrollWidth || vpBreite;
  const skaliert   = containerB * Z.zoom;
  const marginLeft = Math.max(0, (vpBreite - skaliert) / 2);
  D.zoomScaler.style.marginLeft = `${marginLeft}px`;

  const containerH = D.pdfContainer.scrollHeight || 600;
  D.zoomScaler.style.height = `${containerH * Z.zoom}px`;

  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;

  if (Z.geodreieckAktiv) geodreieckSkalieren();

  // Offene Flyouts neu positionieren (falls sichtbar)
  if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
  if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
}

function zoomZentrierungAktualisieren() {
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

  D.zoomWrapper.addEventListener('touchstart', e => {
    if (e.touches.length===2) Z.pinch=null;
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length===2&&Z.modus==='zeichnen') { e.preventDefault(); pinchBewegen(e); }
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchend', () => { if(Z.pinch) Z.pinch=null; }, { passive:true });
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey||e.metaKey) {
      e.preventDefault();
      zoomSetzen(Z.zoom+(e.deltaY>0?-KONFIGURATION.ZOOM_SCHRITT:KONFIGURATION.ZOOM_SCHRITT));
    }
  }, { passive: false });

  window.addEventListener('resize', () => {
    zoomZentrierungAktualisieren();
    laserCanvasAnpassen();
    if (Z.geodreieckAktiv) geodreieckSkalieren();
    // Flyouts neu positionieren
    if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
    if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
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
    requestAnimationFrame(zoomZentrierungAktualisieren);
    if (Z.geodreieckAktiv) { geodreieckSkalieren(); }
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

  new IntersectionObserver(ee => {
    ee.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio >= 0.4) {
        const seiteAlt = Z.aktiveSeite;
        Z.aktiveSeite = nr;
        // Falls die neue Seite eine andere px-pro-cm-Dichte hat
        // (z.B. unterschiedliche Papierformate im selben PDF),
        // muss das Geodreieck neu skaliert werden, damit 1cm
        // weiterhin 1cm entspricht.
        if (Z.geodreieckAktiv && seiteAlt !== nr) {
          geodreieckSkalieren();
        }
      }
    });
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
  console.log('[EduLayer] v6.1 startet…');

  laserCanvasAnpassen();
  themaLaden();
  geoKalibrierungLaden();

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
      ziel.closest('.zoom-wrapper')      ||
      ziel.closest('.sidebar')           ||
      ziel.closest('.spotlight-overlay') ||
      ziel.closest('.zoom-steuerung')    ||
      ziel.closest('.fokus-toolbar')     ||
      ziel.closest('.einstellungen-panel')||
      ziel.closest('.notizen-panel')     ||
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
      if(Z.offenesFlyout==='stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
      if(Z.offenesFlyout==='fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
    }, 350);
  });

  console.log('[EduLayer] v6.1 bereit.');
}

if (document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else { appStart(); }
