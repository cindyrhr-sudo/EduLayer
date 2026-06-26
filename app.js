/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 3)                  ║
 * ║  Datei: app.js                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ÄNDERUNGEN v3:
 *  - Scroll-Modus: Umschalten zwischen Zeichnen und PDF-Scrollen
 *  - Spotlight: 8 Zugpunkte (Ecken + Kanten) mit Apple-Pencil-Support
 *    Jeder Griff skaliert das Fenster in die korrekte Richtung
 *  - 2 neue Farben: Orange (#e86a10) und Türkis (#0097a7)
 *
 * STRUKTUR:
 *  1.  KONFIGURATION
 *  2.  ZUSTAND
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN
 *  5.  SIDEBAR-LOGIK
 *  6.  SCROLL-MODUS
 *  7.  ZEICHEN-ENGINE
 *  8.  UNDO / REDO
 *  9.  LEHRER-LAYER
 * 10.  SPOTLIGHT (mit 8-Griff-System)
 * 11.  ZOOM
 * 12.  PDF-RENDERING
 * 13.  PDF-EXPORT
 * 14.  SERVICE WORKER
 * 15.  APP-START
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION  ← HIER ANPASSEN
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {

  // ── Stiftstärken ─────────────────────────────────────────────
  STIFT_DUENN_PX:    2,
  STIFT_DICK_PX:     6,
  TEXTMARKER_PX:     18,
  RADIERER_PX:       28,
  LASER_PX:          4,

  // ── Farben ───────────────────────────────────────────────────
  LASER_FARBE:       '#ff3030',
  TEXTMARKER_FARBE:  'rgba(255, 210, 0, 0.45)',
  STANDARD_FARBE:    '#1a3a6b',

  // ── Laserpointer: Sichtbarkeitsdauer in Millisekunden ────────
  LASER_TIMEOUT_MS:  2000,

  // ── Spotlight ────────────────────────────────────────────────
  SPOTLIGHT_MIN_B:   60,    // Minimale Fensterbreite (px)
  SPOTLIGHT_MIN_H:   40,    // Minimale Fensterhöhe (px)
  SPOTLIGHT_START_B: 320,
  SPOTLIGHT_START_H: 200,

  // ── PDF-Rendering ─────────────────────────────────────────────
  // 1.5 = gute Schärfe auf iPad Retina; 2.0 = schärfer aber langsamer
  PDF_SCALE:         1.5,

  // ── Zoom ─────────────────────────────────────────────────────
  ZOOM_MIN:          0.3,
  ZOOM_MAX:          4.0,
  ZOOM_SCHRITT:      0.2,

  // ── pdf.js Worker (Version muss zur CDN-URL in index.html passen) ──
  PDFJS_WORKER:
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};


/* ═══════════════════════════════════════════════════════════════════
   2. ZUSTAND – Single Source of Truth
════════════════════════════════════════════════════════════════════ */
const Z = {

  // ── Werkzeug & Farbe ─────────────────────────────────────────
  werkzeug:        'stift-duenn',
  strichfarbe:     KONFIGURATION.STANDARD_FARBE,
  strichbreite:    KONFIGURATION.STIFT_DUENN_PX,

  // ── Zeichenstatus ────────────────────────────────────────────
  zeichnet:        false,
  letzterPunkt:    null,
  aktuellerStrich: null,

  // ── App-Modus ─────────────────────────────────────────────────
  // 'zeichnen' | 'scrollen'
  modus:           'zeichnen',

  // ── PDF ──────────────────────────────────────────────────────
  pdfDokument:     null,
  seitenAnzahl:    0,
  aktiveSeite:     1,
  pdfBytes:        null,
  viewports:       {},

  // ── Annotationen ─────────────────────────────────────────────
  annotationen:    {},
  undoVerlauf:     {},
  redoVerlauf:     {},

  // ── Lehrer-Layer ─────────────────────────────────────────────
  lehrerAnnotationen: {},
  lehrerAktiv:     false,

  // ── Spotlight ────────────────────────────────────────────────
  spotlightAktiv:  false,
  spotlightForm:   'rechteck',
  // Fenster-Rechteck: x/y = linke obere Ecke, b = Breite, h = Höhe
  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  // Aktiver Griff beim Ziehen: 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'mitte'|null
  spotGriff:       null,
  // Startdaten beim Zieh-Beginn (Fenster-Snapshot + Touch-Startpunkt)
  spotDragStart:   null,

  // ── Zoom ─────────────────────────────────────────────────────
  zoom:            1.0,
  pinch:           null,

  // ── Sidebar ──────────────────────────────────────────────────
  sidebarSeite:    'right',

  // ── Laser ────────────────────────────────────────────────────
  laserTimeouts:   [],
};


/* ═══════════════════════════════════════════════════════════════════
   3. DOM-REFERENZEN
════════════════════════════════════════════════════════════════════ */
const D = {
  body:              document.body,
  hauptbereich:      document.getElementById('hauptbereich'),
  zoomWrapper:       document.getElementById('zoom-wrapper'),
  pdfContainer:      document.getElementById('pdf-container'),
  startAnzeige:      document.getElementById('start-anzeige'),

  // Datei
  btnDateiLaden:     document.getElementById('btn-datei-laden'),
  btnStartLaden:     document.getElementById('btn-start-laden'),
  dateiInput:        document.getElementById('datei-input'),
  btnSpeichern:      document.getElementById('btn-speichern'),

  // Werkzeuge
  btnStiftDuenn:     document.getElementById('btn-stift-duenn'),
  btnStiftDick:      document.getElementById('btn-stift-dick'),
  btnTextmarker:     document.getElementById('btn-textmarker'),
  btnRadierer:       document.getElementById('btn-radierer'),
  btnLaser:          document.getElementById('btn-laser'),
  farbDots:          document.querySelectorAll('.farb-dot'),

  // Verlauf
  btnUndo:           document.getElementById('btn-undo'),
  btnRedo:           document.getElementById('btn-redo'),
  btnSeiteLeeren:    document.getElementById('btn-seite-leeren'),

  // Modi
  btnModusWechsel:   document.getElementById('btn-modus-wechsel'),
  iconStiftModus:    document.getElementById('icon-stift-modus'),
  iconScrollModus:   document.getElementById('icon-scroll-modus'),
  btnSpotlight:      document.getElementById('btn-spotlight'),
  btnLehrerLayer:    document.getElementById('btn-lehrer-layer'),
  iconAugeAuf:       document.getElementById('icon-auge-auf'),
  iconAugeZu:        document.getElementById('icon-auge-zu'),

  // Spotlight
  spotlightOverlay:  document.getElementById('spotlight-overlay'),
  spotlightFenster:  document.getElementById('spotlight-fenster'),
  spotlightMaske:    document.getElementById('spotlight-maske'),
  btnSpotRechteck:   document.getElementById('btn-spotlight-rechteck'),
  btnSpotOval:       document.getElementById('btn-spotlight-oval'),
  btnSpotSchliessen: document.getElementById('btn-spotlight-schliessen'),
  // Alle 8 Zugpunkte (werden beim Init per querySelectorAll gesammelt)
  spotGriffe:        null,

  // Zoom
  zoomSteuerung:     document.getElementById('zoom-steuerung'),
  btnZoomPlus:       document.getElementById('btn-zoom-plus'),
  btnZoomMinus:      document.getElementById('btn-zoom-minus'),
  btnZoomReset:      document.getElementById('btn-zoom-reset'),
  zoomAnzeige:       document.getElementById('zoom-anzeige'),

  // Sidebar
  btnSidebarWechsel: document.getElementById('btn-sidebar-wechsel'),

  // Feedback
  toast:             document.getElementById('toast'),
  ladeOverlay:       document.getElementById('lade-overlay'),
  ladeText:          document.getElementById('lade-text'),
};


/* ═══════════════════════════════════════════════════════════════════
   4. HILFSFUNKTIONEN
════════════════════════════════════════════════════════════════════ */

/** Toast-Meldung anzeigen. */
function toast(text, typ = 'info', ms = 2400) {
  const el = D.toast;
  el.className   = 'toast';
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('sichtbar', typ));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('sichtbar'), ms);
}

/** Lade-Overlay ein-/ausblenden. */
function ladeAnzeige(an, text = 'Laden…') {
  D.ladeOverlay.style.display = an ? 'flex' : 'none';
  D.ladeOverlay.setAttribute('aria-hidden', an ? 'false' : 'true');
  D.ladeText.textContent = text;
}

/**
 * Canvas-Koordinaten aus Touch- oder Maus-Ereignis ermitteln.
 * Berücksichtigt CSS-Zoom-Transform (getBoundingClientRect ist korrekt
 * weil er die gerenderte Größe liefert, nicht die logische).
 */
function koordinaten(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  let cx, cy;
  if (e.touches?.length > 0) {
    cx = e.touches[0].clientX; cy = e.touches[0].clientY;
  } else if (e.changedTouches?.length > 0) {
    cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY;
  } else {
    cx = e.clientX; cy = e.clientY;
  }
  return {
    x: (cx - rect.left) * (canvas.width  / rect.width),
    y: (cy - rect.top)  * (canvas.height / rect.height),
  };
}

/** Zeichen-Canvas einer Seite zurückgeben. */
function zeichenCanvas(seite) {
  return document.querySelector(
    `.seite-container[data-seite="${seite}"] .zeichen-canvas`
  );
}

/** Lehrer-Canvas einer Seite zurückgeben. */
function lehrerCanvas(seite) {
  return document.querySelector(
    `.seite-container[data-seite="${seite}"] .lehrer-canvas`
  );
}

/** Datei-Download auslösen. */
function download(daten, dateiname, mimeTyp = 'application/pdf') {
  const blob = new Blob([daten], { type: mimeTyp });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Abstand zwischen zwei Touch-Punkten (für Pinch). */
function pinchAbstand(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

/** Zeitstempel für Dateinamen (Format: JJJJ-MM-TT_HH-MM). */
function zeitstempel() {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}` +
         `_${z(d.getHours())}-${z(d.getMinutes())}`;
}

/** Base64-String → Uint8Array (für pdf-lib). */
function base64ZuBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


/* ═══════════════════════════════════════════════════════════════════
   5. SIDEBAR-LOGIK
════════════════════════════════════════════════════════════════════ */

const WERKZEUG_BTNS = document.querySelectorAll('[data-werkzeug]');

/** Werkzeug wählen: Zustand + Button-UI + Canvas-Cursor. */
function werkzeugWaehlen(name) {
  Z.werkzeug    = name;
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
  document.querySelectorAll('.zeichen-canvas').forEach(c => {
    c.dataset.werkzeug = name;
  });
}

/** Strichfarbe wählen. */
function farbeWaehlen(farbe) {
  Z.strichfarbe = farbe;
  D.farbDots.forEach(d => {
    const a = d.dataset.farbe === farbe;
    d.classList.toggle('aktiv', a);
    d.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

/** Sidebar links ↔ rechts. */
function sidebarWechseln() {
  Z.sidebarSeite = Z.sidebarSeite === 'right' ? 'left' : 'right';
  D.body.dataset.sidebar = Z.sidebarSeite;
  toast(Z.sidebarSeite === 'right' ? 'Sidebar rechts' : 'Sidebar links', 'info', 1200);
}

/** Alle Sidebar-Listener registrieren. */
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
    dot.addEventListener('click', () => {
      if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe);
    });
  });

  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);

  D.btnModusWechsel.addEventListener('click', scrollModusUmschalten);
  D.btnSpotlight.addEventListener('click',    spotlightUmschalten);
  D.btnLehrerLayer.addEventListener('click',  lehrerLayerUmschalten);
  D.btnSpeichern.addEventListener('click',    pdfSpeichern);
  D.btnSidebarWechsel.addEventListener('click', sidebarWechseln);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
    if (e.key === 'Escape' && Z.spotlightAktiv) spotlightAus();
  });
}


/* ═══════════════════════════════════════════════════════════════════
   6. SCROLL-MODUS
   Schaltet zwischen Zeichnen und nativen Browser-Scroll um.

   Technik:
   Im Zeichen-Modus hat .zoom-wrapper touch-action:none → alle
   Touch-Events landen in den Canvas-Listenern.
   Im Scroll-Modus hat .zoom-wrapper touch-action:pan-x pan-y →
   der Browser scrollt nativ, Canvas-Listener erhalten keine Events.
   Das CSS übernimmt die Umschaltung per body.scroll-modus Klasse.
════════════════════════════════════════════════════════════════════ */

/** Scroll-Modus ein-/ausschalten. */
function scrollModusUmschalten() {
  const scrollAktiv = Z.modus === 'scrollen';
  Z.modus = scrollAktiv ? 'zeichnen' : 'scrollen';

  D.body.classList.toggle('scroll-modus', !scrollAktiv);
  D.body.dataset.modus = Z.modus;

  // Icons tauschen
  D.iconStiftModus.style.display  = scrollAktiv ? 'block' : 'none';
  D.iconScrollModus.style.display = scrollAktiv ? 'none'  : 'block';

  D.btnModusWechsel.setAttribute('aria-pressed', scrollAktiv ? 'false' : 'true');

  toast(
    scrollAktiv ? 'Zeichnen aktiv' : 'Scroll-Modus aktiv – Finger scrollt das PDF',
    'info', 2000
  );
}


/* ═══════════════════════════════════════════════════════════════════
   7. ZEICHEN-ENGINE
════════════════════════════════════════════════════════════════════ */

/** Canvas-Context für das aktuelle Werkzeug konfigurieren. */
function ctxKonfigurieren(ctx) {
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Z.strichbreite;

  switch (Z.werkzeug) {
    case 'textmarker':
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = KONFIGURATION.TEXTMARKER_FARBE;
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;
    case 'radierer':
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;
    case 'laser':
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = KONFIGURATION.LASER_FARBE;
      ctx.globalAlpha = 0.9;
      ctx.shadowBlur  = 14;
      ctx.shadowColor = KONFIGURATION.LASER_FARBE;
      break;
    default:
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = Z.strichfarbe;
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;
  }
}

/** Canvas-Context auf sichere Standardwerte zurücksetzen. */
function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

/** Strich-Start: touchstart / mousedown / pointerdown */
function strichStarten(e, canvas) {
  // Im Scroll-Modus nicht zeichnen
  if (Z.modus === 'scrollen') return;
  // Pinch (2 Finger) hat Vorrang
  if (e.touches && e.touches.length > 1) return;
  // Spotlight hat Vorrang
  if (Z.spotlightAktiv) return;

  e.preventDefault();
  Z.zeichnet = true;
  const p = koordinaten(e, canvas);
  Z.letzterPunkt = p;

  const seite = +canvas.closest('.seite-container').dataset.seite;
  undoSnapshot(seite);

  if (Z.werkzeug !== 'laser' && Z.werkzeug !== 'radierer') {
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.aktuellerStrich = {
      punkte:   [{ ...p }],
      farbe:    Z.strichfarbe,
      breite:   Z.strichbreite,
      werkzeug: Z.werkzeug,
    };
  } else {
    Z.aktuellerStrich = null;
  }

  // Punkt für kurze Tipp-Gesten zeichnen
  const ctx = canvas.getContext('2d');
  ctxKonfigurieren(ctx);
  ctx.beginPath();
  ctx.arc(p.x, p.y, Z.strichbreite / 2, 0, Math.PI * 2);
  ctx.fill();
  ctxReset(ctx);
}

/** Strich-Bewegen: touchmove / mousemove */
function strichBewegen(e, canvas) {
  if (Z.modus === 'scrollen') return;

  // Pinch erkennen
  if (e.touches && e.touches.length === 2) {
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

/** Strich-Ende: touchend / mouseup */
function strichBeenden(e, canvas) {
  if (!Z.zeichnet) return;
  e.preventDefault();
  Z.zeichnet = false;

  if (Z.aktuellerStrich) {
    const seite = +canvas.closest('.seite-container').dataset.seite;
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.annotationen[seite].push(Z.aktuellerStrich);
    Z.aktuellerStrich = null;
  }
  if (Z.werkzeug === 'laser') laserAusblenden(canvas);
  Z.letzterPunkt = null;
}

/**
 * Laser-Strich nach Timeout ausblenden.
 * Snapshot des Canvas → warten → löschen → kurz gedimmt anzeigen → löschen.
 */
function laserAusblenden(canvas) {
  const snap = canvas.toDataURL();
  const ctx  = canvas.getContext('2d');
  const tid  = setTimeout(() => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;
      setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 350);
    };
    img.src = snap;
  }, KONFIGURATION.LASER_TIMEOUT_MS);
  Z.laserTimeouts.push(tid);
}

/** Touch- und Maus-Listener für einen Zeichen-Canvas registrieren. */
function zeichenListeners(canvas) {
  canvas.addEventListener('touchstart',
    e => strichStarten(e, canvas), { passive: false });
  canvas.addEventListener('touchmove',
    e => strichBewegen(e, canvas), { passive: false });
  canvas.addEventListener('touchend',
    e => strichBeenden(e, canvas), { passive: false });
  canvas.addEventListener('touchcancel',
    e => strichBeenden(e, canvas), { passive: false });

  canvas.addEventListener('mousedown',  e => strichStarten(e, canvas));
  canvas.addEventListener('mousemove',  e => strichBewegen(e, canvas));
  canvas.addEventListener('mouseup',    e => strichBeenden(e, canvas));
  canvas.addEventListener('mouseleave', e => { if (Z.zeichnet) strichBeenden(e, canvas); });
}

/** Annotationen (Strich-Array) auf einen Canvas zeichnen. Für Undo/Layer. */
function stricheZeichnen(ctx, striche) {
  if (!striche?.length) return;
  striche.forEach(strich => {
    if (!strich.punkte?.length) return;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strich.breite;

    if (strich.werkzeug === 'textmarker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = KONFIGURATION.TEXTMARKER_FARBE;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strich.farbe;
    }
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(strich.punkte[0].x, strich.punkte[0].y);
    for (let i = 1; i < strich.punkte.length - 1; i++) {
      const mx = (strich.punkte[i].x + strich.punkte[i+1].x) / 2;
      const my = (strich.punkte[i].y + strich.punkte[i+1].y) / 2;
      ctx.quadraticCurveTo(strich.punkte[i].x, strich.punkte[i].y, mx, my);
    }
    const lp = strich.punkte[strich.punkte.length - 1];
    ctx.lineTo(lp.x, lp.y);
    ctx.stroke();
    ctxReset(ctx);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   8. UNDO / REDO
════════════════════════════════════════════════════════════════════ */

/** Canvas-Snapshot in Undo-Verlauf speichern (vor jedem Strich). */
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

/** Undo: letzten Zustand wiederherstellen. */
function undoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.undoVerlauf[seite]?.length) {
    toast('Kein weiterer Rückgängig-Schritt.', 'info', 1500); return;
  }
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  Z.redoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.undoVerlauf[seite].pop());
  if (Z.annotationen[seite]?.length) Z.annotationen[seite].pop();
}

/** Redo: rückgängig gemachten Schritt wiederholen. */
function redoAusfuehren() {
  const seite = Z.aktiveSeite;
  if (!Z.redoVerlauf[seite]?.length) {
    toast('Kein weiterer Wiederholen-Schritt.', 'info', 1500); return;
  }
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;
  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  Z.undoVerlauf[seite].push(canvas.toDataURL());
  snapshotLaden(canvas, Z.redoVerlauf[seite].pop());
}

/** DataURL-Snapshot auf Canvas zurückladen. */
function snapshotLaden(canvas, dataUrl) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
  img.src = dataUrl;
}

/** Alle Annotationen der aktuellen Seite löschen. */
function seiteLeeren() {
  const seite = Z.aktiveSeite;
  if (!window.confirm(`Alle Annotationen auf Seite ${seite} löschen?`)) return;
  undoSnapshot(seite);
  const canvas = zeichenCanvas(seite);
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  Z.annotationen[seite] = [];
  toast(`Seite ${seite} geleert.`, 'info');
}


/* ═══════════════════════════════════════════════════════════════════
   9. LEHRER-LAYER
════════════════════════════════════════════════════════════════════ */

/** Lehrer-Layer ein-/ausblenden. */
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
    ctx.clearRect(0, 0, lc.width, lc.height);
    if (Z.lehrerAktiv && Z.lehrerAnnotationen[s]?.length) {
      ctx.globalAlpha = 0.72;
      stricheZeichnen(ctx, Z.lehrerAnnotationen[s]);
      ctx.globalAlpha = 1;
    }
  }
  toast(Z.lehrerAktiv ? 'Lehrer-Layer sichtbar' : 'Lehrer-Layer ausgeblendet', 'info', 1400);
}


/* ═══════════════════════════════════════════════════════════════════
   10. SPOTLIGHT mit 8-Griff-System
   Jeder der 8 Griffe (nw, n, ne, e, se, s, sw, w) zieht eine andere
   Kombination von Kanten. Das Fenster-Rechteck wird dadurch korrekt
   verkleinert oder vergrößert ohne zu springen.

   Griff-Logik:
     nw → x, y, b, h ändern (linke + obere Kante)
     n  → y, h ändern (nur obere Kante)
     ne → y, b, h ändern (rechte + obere Kante)
     e  → b ändern (nur rechte Kante)
     se → b, h ändern (rechte + untere Kante)
     s  → h ändern (nur untere Kante)
     sw → x, b, h ändern (linke + untere Kante)
     w  → x, b ändern (nur linke Kante)
     mitte → x, y (verschieben)
════════════════════════════════════════════════════════════════════ */

/** Spotlight einschalten. */
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
  toast('Spotlight aktiv – Mitte ziehen zum Bewegen, Griffe zum Skalieren', 'info', 3000);
}

/** Spotlight ausschalten. */
function spotlightAus() {
  Z.spotlightAktiv = false;
  D.spotlightOverlay.style.display = 'none';
  D.spotlightOverlay.setAttribute('aria-hidden', 'true');
  D.btnSpotlight.classList.remove('aktiv');
  D.btnSpotlight.setAttribute('aria-pressed', 'false');
}

/** Spotlight umschalten. */
function spotlightUmschalten() {
  Z.spotlightAktiv ? spotlightAus() : spotlightAn();
}

/**
 * Spotlight-Position, -Größe und Masken-Clip aktualisieren.
 * Wird bei jedem Touch-Move aufgerufen.
 */
function spotlightAktualisieren() {
  const f  = Z.spotFenster;
  const el = D.spotlightFenster;

  el.style.left   = `${f.x}px`;
  el.style.top    = `${f.y}px`;
  el.style.width  = `${f.b}px`;
  el.style.height = `${f.h}px`;
  el.classList.toggle('oval', Z.spotlightForm === 'oval');

  const maske = D.spotlightMaske;
  const W = window.innerWidth;
  const H = window.innerHeight;

  if (Z.spotlightForm === 'oval') {
    // Oval: Ellipsen-Maske via radial-gradient
    const cx = f.x + f.b / 2;
    const cy = f.y + f.h / 2;
    const mask = `radial-gradient(ellipse ${f.b/2}px ${f.h/2}px at ${cx}px ${cy}px,
      transparent 99%, black 100%)`;
    maske.style.webkitMaskImage = mask;
    maske.style.maskImage       = mask;
    maske.style.clipPath        = '';
  } else {
    // Rechteck: Polygon mit Loch (äußeres Rechteck minus inneres Rechteck)
    maske.style.webkitMaskImage = '';
    maske.style.maskImage       = '';
    maske.style.clipPath = `polygon(
      0px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px, 0px 0px,
      ${f.x}px ${f.y}px,
      ${f.x}px ${f.y + f.h}px,
      ${f.x + f.b}px ${f.y + f.h}px,
      ${f.x + f.b}px ${f.y}px,
      ${f.x}px ${f.y}px
    )`;
  }
}

/**
 * Ermittelt ob ein Touch-Punkt im Fenster-Inneren liegt (→ 'mitte').
 * Griffe melden sich selbst über ihr data-griff-Attribut.
 *
 * @param {number} x  – clientX
 * @param {number} y  – clientY
 * @returns {'mitte'|null}
 */
function spotFensterBereichErmitteln(x, y) {
  const f = Z.spotFenster;
  // Kleine Rand-Zone (20px) ist für Griffe reserviert → nur echte Mitte
  const rand = 20;
  const innen =
    x > f.x + rand && x < f.x + f.b - rand &&
    y > f.y + rand && y < f.y + f.h - rand;
  return innen ? 'mitte' : null;
}

/**
 * Spotlight-Fenster entsprechend dem aktiven Griff bewegen / skalieren.
 * Wird bei jedem touchmove / mousemove aufgerufen.
 *
 * @param {number} cx  – aktuelle clientX
 * @param {number} cy  – aktuelle clientY
 */
function spotGriffZiehen(cx, cy) {
  if (!Z.spotGriff || !Z.spotDragStart) return;

  const s = Z.spotDragStart;   // Snapshot beim Drag-Start
  const dx = cx - s.startX;
  const dy = cy - s.startY;
  const f  = Z.spotFenster;
  const MIN_B = KONFIGURATION.SPOTLIGHT_MIN_B;
  const MIN_H = KONFIGURATION.SPOTLIGHT_MIN_H;

  // Jeder Griff modifiziert bestimmte Eigenschaften des Rechtecks.
  // Ecken verändern immer 2 Kanten gleichzeitig.
  switch (Z.spotGriff) {

    case 'mitte':
      // Nur verschieben, keine Größenänderung
      f.x = Math.max(0, Math.min(s.fx + dx, window.innerWidth  - f.b));
      f.y = Math.max(0, Math.min(s.fy + dy, window.innerHeight - f.h));
      break;

    case 'se':
      // Rechte + Untere Kante → Breite und Höhe wachsen nach rechts-unten
      f.b = Math.max(MIN_B, s.fb + dx);
      f.h = Math.max(MIN_H, s.fh + dy);
      break;

    case 'sw':
      // Linke + Untere Kante → x verschiebt sich, Breite schrumpft, Höhe wächst
      f.b = Math.max(MIN_B, s.fb - dx);
      f.x = s.fx + s.fb - f.b;   // Rechte Kante fixiert
      f.h = Math.max(MIN_H, s.fh + dy);
      break;

    case 'ne':
      // Rechte + Obere Kante → Breite wächst, y verschiebt sich
      f.b = Math.max(MIN_B, s.fb + dx);
      f.h = Math.max(MIN_H, s.fh - dy);
      f.y = s.fy + s.fh - f.h;   // Untere Kante fixiert
      break;

    case 'nw':
      // Linke + Obere Kante → x+y verschieben sich, b+h schrumpfen
      f.b = Math.max(MIN_B, s.fb - dx);
      f.h = Math.max(MIN_H, s.fh - dy);
      f.x = s.fx + s.fb - f.b;
      f.y = s.fy + s.fh - f.h;
      break;

    case 'e':
      // Nur rechte Kante → Breite wächst nach rechts
      f.b = Math.max(MIN_B, s.fb + dx);
      break;

    case 'w':
      // Nur linke Kante → x verschiebt sich, Breite schrumpft
      f.b = Math.max(MIN_B, s.fb - dx);
      f.x = s.fx + s.fb - f.b;
      break;

    case 'n':
      // Nur obere Kante → y verschiebt sich, Höhe schrumpft
      f.h = Math.max(MIN_H, s.fh - dy);
      f.y = s.fy + s.fh - f.h;
      break;

    case 's':
      // Nur untere Kante → Höhe wächst nach unten
      f.h = Math.max(MIN_H, s.fh + dy);
      break;
  }

  spotlightAktualisieren();
}

/** Initialisiert alle Spotlight-Listener (Griffe + Overlay + Toolbar). */
function spotlightInit() {
  // Griffe per querySelectorAll sammeln (nach DOM-Aufbau)
  D.spotGriffe = document.querySelectorAll('.spot-griff');

  const ov  = D.spotlightOverlay;
  const fen = D.spotlightFenster;

  // ── Griff-Listener (Touch) ─────────────────────────────────────
  // Jeder Griff registriert seinen eigenen touchstart-Listener.
  // touchmove und touchend laufen über document (um schnelle Bewegungen
  // nicht zu verlieren wenn der Finger kurz vom Griff rutscht).
  D.spotGriffe.forEach(griff => {

    griff.addEventListener('touchstart', e => {
      if (!Z.spotlightAktiv) return;
      e.preventDefault();
      e.stopPropagation();   // Nicht ans Overlay weitergeben
      const t = e.touches[0];
      Z.spotGriff    = griff.dataset.griff;
      Z.spotDragStart = {
        startX: t.clientX, startY: t.clientY,
        fx: Z.spotFenster.x, fy: Z.spotFenster.y,
        fb: Z.spotFenster.b, fh: Z.spotFenster.h,
      };
    }, { passive: false });

    // Maus (Desktop)
    griff.addEventListener('mousedown', e => {
      if (!Z.spotlightAktiv) return;
      e.preventDefault();
      e.stopPropagation();
      Z.spotGriff    = griff.dataset.griff;
      Z.spotDragStart = {
        startX: e.clientX, startY: e.clientY,
        fx: Z.spotFenster.x, fy: Z.spotFenster.y,
        fb: Z.spotFenster.b, fh: Z.spotFenster.h,
      };
    });
  });

  // ── Fenster-Mitte: verschieben ─────────────────────────────────
  fen.addEventListener('touchstart', e => {
    if (!Z.spotlightAktiv) return;
    // Griff-Elemente senden zuerst ihr eigenes Event → prüfen ob Griff
    if (e.target.classList.contains('spot-griff')) return;
    e.preventDefault();
    const t = e.touches[0];
    const bereich = spotFensterBereichErmitteln(t.clientX, t.clientY);
    if (bereich === 'mitte') {
      Z.spotGriff    = 'mitte';
      Z.spotDragStart = {
        startX: t.clientX, startY: t.clientY,
        fx: Z.spotFenster.x, fy: Z.spotFenster.y,
        fb: Z.spotFenster.b, fh: Z.spotFenster.h,
      };
    }
  }, { passive: false });

  fen.addEventListener('mousedown', e => {
    if (!Z.spotlightAktiv) return;
    if (e.target.classList.contains('spot-griff')) return;
    const bereich = spotFensterBereichErmitteln(e.clientX, e.clientY);
    if (bereich === 'mitte') {
      Z.spotGriff    = 'mitte';
      Z.spotDragStart = {
        startX: e.clientX, startY: e.clientY,
        fx: Z.spotFenster.x, fy: Z.spotFenster.y,
        fb: Z.spotFenster.b, fh: Z.spotFenster.h,
      };
    }
  });

  // ── Globale Move/End-Listener (Touch + Maus) ──────────────────
  document.addEventListener('touchmove', e => {
    if (!Z.spotlightAktiv || !Z.spotGriff) return;
    e.preventDefault();
    spotGriffZiehen(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (Z.spotGriff) { Z.spotGriff = null; Z.spotDragStart = null; }
  }, { passive: false });

  document.addEventListener('mousemove', e => {
    if (!Z.spotlightAktiv || !Z.spotGriff) return;
    spotGriffZiehen(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    Z.spotGriff = null; Z.spotDragStart = null;
  });

  // ── Toolbar-Buttons ────────────────────────────────────────────
  D.btnSpotRechteck.addEventListener('click', () => {
    Z.spotlightForm = 'rechteck';
    D.btnSpotRechteck.classList.add('aktiv');
    D.btnSpotRechteck.setAttribute('aria-pressed', 'true');
    D.btnSpotOval.classList.remove('aktiv');
    D.btnSpotOval.setAttribute('aria-pressed', 'false');
    spotlightAktualisieren();
  });
  D.btnSpotOval.addEventListener('click', () => {
    Z.spotlightForm = 'oval';
    D.btnSpotOval.classList.add('aktiv');
    D.btnSpotOval.setAttribute('aria-pressed', 'true');
    D.btnSpotRechteck.classList.remove('aktiv');
    D.btnSpotRechteck.setAttribute('aria-pressed', 'false');
    spotlightAktualisieren();
  });
  D.btnSpotSchliessen.addEventListener('click', spotlightAus);
}


/* ═══════════════════════════════════════════════════════════════════
   11. ZOOM (Pinch-to-Zoom + Buttons)
════════════════════════════════════════════════════════════════════ */

/** Zoom-Faktor setzen und CSS + Anzeige aktualisieren. */
function zoomSetzen(neuerZoom) {
  Z.zoom = Math.min(KONFIGURATION.ZOOM_MAX,
            Math.max(KONFIGURATION.ZOOM_MIN, neuerZoom));
  D.pdfContainer.style.transform       = `scale(${Z.zoom})`;
  D.pdfContainer.style.transformOrigin = 'top center';
  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;
}

/** Pinch-Geste verarbeiten (2-Finger-Touch auf dem Zoom-Wrapper). */
function pinchBewegen(e) {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const abstand = pinchAbstand(e.touches);
  if (!Z.pinch) { Z.pinch = { abstand, zoomStart: Z.zoom }; return; }
  zoomSetzen(Z.pinch.zoomStart * (abstand / Z.pinch.abstand));
}

/** Zoom-Buttons und Pinch-Listener initialisieren. */
function zoomInit() {
  D.btnZoomPlus.addEventListener('click',  () => zoomSetzen(Z.zoom + KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomMinus.addEventListener('click', () => zoomSetzen(Z.zoom - KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));

  // Pinch auf dem Zoom-Wrapper (nur im Zeichen-Modus, weil im Scroll-Modus
  // der Browser native touch-action:pan bekommt und Pinch separat behandelt)
  D.zoomWrapper.addEventListener('touchstart', e => {
    if (e.touches.length === 2) Z.pinch = null;
  }, { passive: false });

  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && Z.modus === 'zeichnen') {
      e.preventDefault();
      pinchBewegen(e);
    }
  }, { passive: false });

  D.zoomWrapper.addEventListener('touchend', () => {
    if (Z.pinch) Z.pinch = null;
  }, { passive: true });

  // Mausrad + Strg (Desktop-Vorschau)
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomSetzen(Z.zoom + (e.deltaY > 0 ? -KONFIGURATION.ZOOM_SCHRITT : KONFIGURATION.ZOOM_SCHRITT));
    }
  }, { passive: false });
}


/* ═══════════════════════════════════════════════════════════════════
   12. PDF-RENDERING (pdf.js)
════════════════════════════════════════════════════════════════════ */

/** PDF-Datei laden und alle Seiten rendern. */
async function pdfLaden(datei) {
  ladeAnzeige(true, 'PDF wird geöffnet…');
  try {
    const ab = await datei.arrayBuffer();
    Z.pdfBytes = new Uint8Array(ab);

    pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER;
    Z.pdfDokument  = await pdfjsLib.getDocument({ data: Z.pdfBytes.slice() }).promise;
    Z.seitenAnzahl = Z.pdfDokument.numPages;

    // Zustand zurücksetzen
    Object.assign(Z, {
      annotationen: {}, lehrerAnnotationen: {}, undoVerlauf: {},
      redoVerlauf: {}, aktiveSeite: 1, viewports: {},
    });
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
  } finally {
    ladeAnzeige(false);
  }
}

/**
 * Eine PDF-Seite rendern.
 *
 * Koordinaten-Kopplung (kein Drift):
 * PDF-Canvas und Zeichen-Canvas haben exakt dieselben Pixelmaße.
 * CSS-Größe = Pixel-Größe (kein Strecken durch CSS).
 * Zoom verändert nur den äußeren Container, nie die Canvas-Pixel.
 */
async function pdfSeiteRendern(nr) {
  const seite    = await Z.pdfDokument.getPage(nr);
  const viewport = seite.getViewport({ scale: KONFIGURATION.PDF_SCALE });
  const W = Math.floor(viewport.width);
  const H = Math.floor(viewport.height);

  Z.viewports[nr] = { breite: W, hoehe: H, scale: KONFIGURATION.PDF_SCALE };

  // Container
  const cont         = document.createElement('div');
  cont.className     = 'seite-container';
  cont.dataset.seite = nr;
  cont.style.width   = `${W}px`;
  cont.style.height  = `${H}px`;

  // PDF-Canvas
  const pdfC         = document.createElement('canvas');
  pdfC.className     = 'pdf-canvas';
  pdfC.width         = W;
  pdfC.height        = H;
  pdfC.style.width   = `${W}px`;
  pdfC.style.height  = `${H}px`;
  cont.appendChild(pdfC);

  // Zeichen-Canvas
  const zC           = document.createElement('canvas');
  zC.className       = 'zeichen-canvas';
  zC.width           = W;
  zC.height          = H;
  zC.dataset.werkzeug = Z.werkzeug;
  cont.appendChild(zC);

  // Lehrer-Canvas
  const lC           = document.createElement('canvas');
  lC.className       = 'lehrer-canvas';
  lC.width           = W;
  lC.height          = H;
  lC.setAttribute('aria-hidden', 'true');
  cont.appendChild(lC);

  D.pdfContainer.appendChild(cont);

  // PDF rendern
  await seite.render({ canvasContext: pdfC.getContext('2d'), viewport }).promise;

  // Zeichen-Listener
  zeichenListeners(zC);

  // Aktive Seite per IntersectionObserver verfolgen
  const obs = new IntersectionObserver(eintraege => {
    eintraege.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio >= 0.4) Z.aktiveSeite = nr;
    });
  }, { root: D.zoomWrapper, threshold: 0.4 });
  obs.observe(cont);
}


/* ═══════════════════════════════════════════════════════════════════
   13. PDF-EXPORT (pdf-lib)
════════════════════════════════════════════════════════════════════ */

/** PDF mit eingebetteten Annotationen speichern. */
async function pdfSpeichern() {
  if (!Z.pdfBytes) { toast('Keine PDF geladen.', 'fehler'); return; }
  ladeAnzeige(true, 'PDF wird gespeichert…');
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(Z.pdfBytes);
    const seiten = pdfDoc.getPages();

    for (let s = 1; s <= Z.seitenAnzahl; s++) {
      const pdfSeite = seiten[s - 1];
      const vp = Z.viewports[s];
      if (!vp) continue;
      const { width: pdfB, height: pdfH } = pdfSeite.getSize();

      // Zeichen-Canvas einbetten
      const zC = zeichenCanvas(s);
      if (zC && Z.annotationen[s]?.length) {
        const bytes = base64ZuBytes(zC.toDataURL('image/png').split(',')[1]);
        const bild  = await pdfDoc.embedPng(bytes);
        pdfSeite.drawImage(bild, { x: 0, y: 0, width: pdfB, height: pdfH, opacity: 1 });
      }

      // Lehrer-Layer einbetten (wenn aktiv)
      if (Z.lehrerAktiv && Z.lehrerAnnotationen[s]?.length) {
        const lC = lehrerCanvas(s);
        if (lC) {
          const bytes = base64ZuBytes(lC.toDataURL('image/png').split(',')[1]);
          const bild  = await pdfDoc.embedPng(bytes);
          pdfSeite.drawImage(bild, { x: 0, y: 0, width: pdfB, height: pdfH, opacity: 0.72 });
        }
      }
    }

    pdfDoc.setCreator('EduLayer PWA');
    pdfDoc.setProducer('EduLayer – Datenschutz-konforme Unterrichts-App');
    pdfDoc.setModificationDate(new Date());

    const bytes = await pdfDoc.save();
    const name  = `EduLayer_${zeitstempel()}.pdf`;
    download(bytes, name);
    toast(`Gespeichert: ${name}`, 'erfolg', 3500);

  } catch (err) {
    console.error('[EduLayer] Speicherfehler:', err);
    toast('Fehler beim Speichern.', 'fehler', 4000);
  } finally {
    ladeAnzeige(false);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   14. SERVICE WORKER
════════════════════════════════════════════════════════════════════ */
function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[EduLayer] SW registriert:', reg.scope);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller)
            toast('Update verfügbar – Seite neu laden.', 'info', 6000);
        });
      });
    } catch (e) {
      console.warn('[EduLayer] SW fehlgeschlagen:', e);
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   15. APP-START
════════════════════════════════════════════════════════════════════ */
function appStart() {
  console.log('[EduLayer] v3 startet…');

  sidebarInit();
  spotlightInit();
  zoomInit();

  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);

  swRegistrieren();

  // Drag-and-Drop: PDF direkt in den Browser ziehen
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const datei = e.dataTransfer?.files[0];
    if (datei?.type === 'application/pdf') pdfLaden(datei);
  });

  // iOS: Bounce der gesamten Seite verhindern
  // Erlaubt: zoom-wrapper (scrollt selbst), sidebar (scrollt selbst),
  //          spotlight-overlay (verarbeitet eigene Events),
  //          alle Buttons (touch-action:manipulation in CSS)
  document.addEventListener('touchmove', e => {
    const ziel = e.target;
    const erlaubt =
      ziel.closest('.zoom-wrapper')      ||
      ziel.closest('.sidebar')           ||
      ziel.closest('.spotlight-overlay') ||
      ziel.closest('.zoom-steuerung')    ||
      ziel.closest('.spotlight-toolbar');
    if (!erlaubt) e.preventDefault();
  }, { passive: false });

  // Orientierungswechsel: Spotlight-Clip neu berechnen
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { if (Z.spotlightAktiv) spotlightAktualisieren(); }, 350);
  });

  console.log('[EduLayer] Bereit.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else {
  appStart();
}
