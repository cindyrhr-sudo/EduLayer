/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik  (Version 2)                  ║
 * ║  Datei: app.js                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * STRUKTUR:
 *  1.  KONFIGURATION        ← Werte hier anpassen
 *  2.  ZUSTAND              ← Zentrale Datenhaltung
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN      ← Toast, Koordinaten, Download
 *  5.  SIDEBAR-LOGIK        ← Werkzeug- & Farbwahl, Seite wechseln
 *  6.  ZEICHEN-ENGINE       ← Touch/Maus → Canvas
 *  7.  UNDO / REDO          ← Snapshot-basierter Verlauf
 *  8.  LEHRER-LAYER         ← Zweiter Annotations-Layer
 *  9.  SPOTLIGHT            ← Fokus-Overlay mit Drag & Resize
 * 10.  ZOOM                 ← Pinch-to-Zoom + Buttons
 * 11.  PDF-RENDERING        ← pdf.js: Seiten auf Canvas
 * 12.  PDF-EXPORT           ← pdf-lib: Annotationen einbetten
 * 13.  SERVICE WORKER       ← PWA Offline-Registrierung
 * 14.  APP-START
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION  ← HIER ANPASSEN
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {

  // ── Stiftstärken (in Canvas-Pixeln) ──────────────────────────
  STIFT_DUENN_PX:      2,
  STIFT_DICK_PX:       6,
  TEXTMARKER_PX:       18,
  RADIERER_PX:         28,
  LASER_PX:            4,

  // ── Farben ────────────────────────────────────────────────────
  LASER_FARBE:         '#ff3030',
  TEXTMARKER_FARBE:    'rgba(255, 210, 0, 0.45)',
  STANDARD_FARBE:      '#1a3a6b',

  // ── Laserpointer: Anzeigedauer in Millisekunden ───────────────
  LASER_TIMEOUT_MS:    2000,

  // ── Spotlight ─────────────────────────────────────────────────
  SPOTLIGHT_MIN_B:     80,
  SPOTLIGHT_MIN_H:     60,
  SPOTLIGHT_START_B:   320,
  SPOTLIGHT_START_H:   200,

  // ── PDF-Rendering ──────────────────────────────────────────────
  // Höherer Wert = schärfer, aber langsamer (1.5 ist gut für iPad)
  PDF_SCALE:           1.5,

  // ── Zoom ──────────────────────────────────────────────────────
  ZOOM_MIN:            0.4,
  ZOOM_MAX:            4.0,
  ZOOM_SCHRITT:        0.2,   // Schritt pro Button-Klick

  // ── pdf.js Worker-URL (muss zur CDN-Version passen!) ──────────
  PDFJS_WORKER:
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};


/* ═══════════════════════════════════════════════════════════════════
   2. ZUSTAND  – Single Source of Truth
════════════════════════════════════════════════════════════════════ */
const Z = {

  // ── Werkzeug & Farbe ──────────────────────────────────────────
  werkzeug:        'stift-duenn',
  strichfarbe:     KONFIGURATION.STANDARD_FARBE,
  strichbreite:    KONFIGURATION.STIFT_DUENN_PX,

  // ── Zeichenstatus ─────────────────────────────────────────────
  zeichnet:        false,
  letzterPunkt:    null,       // { x, y }
  aktuellerStrich: null,       // Strich-Objekt während des Zeichnens

  // ── PDF ───────────────────────────────────────────────────────
  pdfDokument:     null,       // pdfjsLib.PDFDocumentProxy
  seitenAnzahl:    0,
  aktiveSeite:     1,          // aktuell sichtbarste Seite
  pdfBytes:        null,       // Uint8Array der Original-PDF

  /**
   * annotationen[seite] = [
   *   { punkte:[{x,y}…], farbe, breite, werkzeug }
   * ]
   * Laser-Striche werden NICHT gespeichert (flüchtig).
   * Radierer-Aktionen werden als Snapshot im undo-Verlauf abgebildet.
   */
  annotationen:    {},
  undoVerlauf:     {},         // { seite: [dataURL, …] }
  redoVerlauf:     {},

  // ── Lehrer-Layer ──────────────────────────────────────────────
  lehrerAnnotationen: {},
  lehrerAktiv:     false,

  // ── Spotlight ─────────────────────────────────────────────────
  spotlightAktiv:  false,
  spotlightForm:   'rechteck',
  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  spotAktion:      null,       // 'bewegen' | 'groesse'
  spotOffset:      null,

  // ── Zoom ──────────────────────────────────────────────────────
  zoom:            1.0,

  // ── Pinch-Geste ───────────────────────────────────────────────
  pinch:           null,       // { abstand, zoomStart }

  // ── Sidebar ───────────────────────────────────────────────────
  sidebarSeite:    'right',

  // ── Laser-Timeouts (IDs zum Abbrechen) ───────────────────────
  laserTimeouts:   [],

  // ── Seiten-Viewports (für Koordinaten-Mapping beim Export) ────
  // { seite: { breite, hoehe, scale } }
  viewports:       {},
};


/* ═══════════════════════════════════════════════════════════════════
   3. DOM-REFERENZEN
════════════════════════════════════════════════════════════════════ */
const D = {
  body:                   document.body,
  hauptbereich:           document.getElementById('hauptbereich'),
  zoomWrapper:            document.getElementById('zoom-wrapper'),
  pdfContainer:           document.getElementById('pdf-container'),
  startAnzeige:           document.getElementById('start-anzeige'),

  // Datei
  btnDateiLaden:          document.getElementById('btn-datei-laden'),
  btnStartLaden:          document.getElementById('btn-start-laden'),
  dateiInput:             document.getElementById('datei-input'),
  btnSpeichern:           document.getElementById('btn-speichern'),

  // Werkzeuge
  btnStiftDuenn:          document.getElementById('btn-stift-duenn'),
  btnStiftDick:           document.getElementById('btn-stift-dick'),
  btnTextmarker:          document.getElementById('btn-textmarker'),
  btnRadierer:            document.getElementById('btn-radierer'),
  btnLaser:               document.getElementById('btn-laser'),
  farbDots:               document.querySelectorAll('.farb-dot'),

  // Verlauf
  btnUndo:                document.getElementById('btn-undo'),
  btnRedo:                document.getElementById('btn-redo'),
  btnSeiteLeeren:         document.getElementById('btn-seite-leeren'),

  // Modi
  btnSpotlight:           document.getElementById('btn-spotlight'),
  btnLehrerLayer:         document.getElementById('btn-lehrer-layer'),
  iconAugeAuf:            document.getElementById('icon-auge-auf'),
  iconAugeZu:             document.getElementById('icon-auge-zu'),

  // Spotlight
  spotlightOverlay:       document.getElementById('spotlight-overlay'),
  spotlightFenster:       document.getElementById('spotlight-fenster'),
  spotlightMaske:         document.getElementById('spotlight-maske'),
  btnSpotRechteck:        document.getElementById('btn-spotlight-rechteck'),
  btnSpotOval:            document.getElementById('btn-spotlight-oval'),
  btnSpotSchliessen:      document.getElementById('btn-spotlight-schliessen'),

  // Zoom
  zoomSteuerung:          document.getElementById('zoom-steuerung'),
  btnZoomPlus:            document.getElementById('btn-zoom-plus'),
  btnZoomMinus:           document.getElementById('btn-zoom-minus'),
  btnZoomReset:           document.getElementById('btn-zoom-reset'),
  zoomAnzeige:            document.getElementById('zoom-anzeige'),

  // Sidebar
  btnSidebarWechsel:      document.getElementById('btn-sidebar-wechsel'),

  // Feedback
  toast:                  document.getElementById('toast'),
  ladeOverlay:            document.getElementById('lade-overlay'),
  ladeText:               document.getElementById('lade-text'),
};


/* ═══════════════════════════════════════════════════════════════════
   4. HILFSFUNKTIONEN
════════════════════════════════════════════════════════════════════ */

/**
 * Zeigt eine kurze Toast-Nachricht.
 * @param {string} text
 * @param {'info'|'erfolg'|'fehler'} typ
 * @param {number} ms  – Anzeigedauer
 */
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
 * Ermittelt Canvas-Koordinaten aus einem Touch- oder Maus-Ereignis.
 * Berücksichtigt CSS-Skalierung (zoom) und devicePixelRatio.
 *
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 * @returns {{ x: number, y: number }}
 */
function koordinaten(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  let cx, cy;

  if (e.touches && e.touches.length > 0) {
    cx = e.touches[0].clientX;
    cy = e.touches[0].clientY;
  } else if (e.changedTouches && e.changedTouches.length > 0) {
    cx = e.changedTouches[0].clientX;
    cy = e.changedTouches[0].clientY;
  } else {
    cx = e.clientX;
    cy = e.clientY;
  }

  // rect spiegelt die CSS-Größe wider (inkl. Zoom-Transform).
  // Canvas.width/height sind die tatsächlichen Pixel-Maße.
  return {
    x: (cx - rect.left) * (canvas.width  / rect.width),
    y: (cy - rect.top)  * (canvas.height / rect.height),
  };
}

/**
 * Gibt den Zeichen-Canvas einer Seite zurück.
 * @param {number} seite
 * @returns {HTMLCanvasElement|null}
 */
function zeichenCanvas(seite) {
  return document.querySelector(
    `.seite-container[data-seite="${seite}"] .zeichen-canvas`
  );
}

/**
 * Gibt den Lehrer-Canvas einer Seite zurück.
 * @param {number} seite
 * @returns {HTMLCanvasElement|null}
 */
function lehrerCanvas(seite) {
  return document.querySelector(
    `.seite-container[data-seite="${seite}"] .lehrer-canvas`
  );
}

/**
 * Löst einen Datei-Download im Browser aus.
 * @param {Uint8Array|string} daten  – Rohdaten oder DataURL
 * @param {string} dateiname
 * @param {string} mimeTyp
 */
function download(daten, dateiname, mimeTyp = 'application/pdf') {
  let url;
  if (typeof daten === 'string') {
    url = daten; // DataURL direkt verwenden
  } else {
    const blob = new Blob([daten], { type: mimeTyp });
    url = URL.createObjectURL(blob);
  }
  const a = document.createElement('a');
  a.href     = url;
  a.download = dateiname;
  a.click();
  // Blob-URL nach kurzem Delay freigeben
  if (typeof daten !== 'string') {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * Berechnet den Abstand zwischen zwei Touch-Punkten (Pinch).
 * @param {TouchList} touches
 * @returns {number}
 */
function pinchAbstand(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}


/* ═══════════════════════════════════════════════════════════════════
   5. SIDEBAR-LOGIK
════════════════════════════════════════════════════════════════════ */

/** Alle Buttons mit data-werkzeug-Attribut */
const WERKZEUG_BTNS = document.querySelectorAll('[data-werkzeug]');

/**
 * Wählt ein Werkzeug aus: aktualisiert Zustand, Buttons und Canvas-Cursor.
 * @param {string} name
 */
function werkzeugWaehlen(name) {
  Z.werkzeug    = name;
  Z.strichbreite = {
    'stift-duenn': KONFIGURATION.STIFT_DUENN_PX,
    'stift-dick':  KONFIGURATION.STIFT_DICK_PX,
    'textmarker':  KONFIGURATION.TEXTMARKER_PX,
    'radierer':    KONFIGURATION.RADIERER_PX,
    'laser':       KONFIGURATION.LASER_PX,
  }[name] ?? KONFIGURATION.STIFT_DUENN_PX;

  // Button-UI aktualisieren
  WERKZEUG_BTNS.forEach(b => {
    const aktiv = b.dataset.werkzeug === name;
    b.classList.toggle('aktiv', aktiv);
    b.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
  });

  // Canvas-Cursor aktualisieren
  document.querySelectorAll('.zeichen-canvas').forEach(c => {
    c.dataset.werkzeug = name;
  });
}

/**
 * Wählt eine Strichfarbe aus.
 * @param {string} farbe  – CSS-Farbwert
 */
function farbeWaehlen(farbe) {
  Z.strichfarbe = farbe;
  D.farbDots.forEach(d => {
    const aktiv = d.dataset.farbe === farbe;
    d.classList.toggle('aktiv', aktiv);
    d.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
  });
}

/** Wechselt Sidebar zwischen links und rechts. */
function sidebarWechseln() {
  Z.sidebarSeite = Z.sidebarSeite === 'right' ? 'left' : 'right';
  D.body.dataset.sidebar = Z.sidebarSeite;
  toast(Z.sidebarSeite === 'right' ? 'Sidebar rechts' : 'Sidebar links', 'info', 1200);
}

/** Initialisiert alle Sidebar-Event-Listener. */
function sidebarInit() {
  // Datei-Laden
  D.btnDateiLaden.addEventListener('click', () => D.dateiInput.click());
  D.btnStartLaden.addEventListener('click', () => D.dateiInput.click());
  D.dateiInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f?.type === 'application/pdf') pdfLaden(f);
    D.dateiInput.value = '';
  });

  // Werkzeuge
  D.btnStiftDuenn.addEventListener('click',  () => werkzeugWaehlen('stift-duenn'));
  D.btnStiftDick.addEventListener('click',   () => werkzeugWaehlen('stift-dick'));
  D.btnTextmarker.addEventListener('click',  () => werkzeugWaehlen('textmarker'));
  D.btnRadierer.addEventListener('click',    () => werkzeugWaehlen('radierer'));
  D.btnLaser.addEventListener('click',       () => werkzeugWaehlen('laser'));

  // Farb-Dots
  D.farbDots.forEach(dot => {
    dot.addEventListener('click', () => {
      if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe);
    });
  });

  // Verlauf
  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);

  // Tastatur-Shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
    if (e.key === 'Escape' && Z.spotlightAktiv) spotlightAus();
  });

  // Modi
  D.btnSpotlight.addEventListener('click',   spotlightUmschalten);
  D.btnLehrerLayer.addEventListener('click', lehrerLayerUmschalten);

  // Speichern
  D.btnSpeichern.addEventListener('click',   pdfSpeichern);

  // Sidebar-Seite
  D.btnSidebarWechsel.addEventListener('click', sidebarWechseln);
}


/* ═══════════════════════════════════════════════════════════════════
   6. ZEICHEN-ENGINE
════════════════════════════════════════════════════════════════════ */

/**
 * Konfiguriert den Canvas-2D-Context für das aktuelle Werkzeug.
 * Muss vor jedem Zeichenbefehl aufgerufen werden.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
function ctxKonfigurieren(ctx) {
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Z.strichbreite;

  switch (Z.werkzeug) {

    case 'textmarker':
      // multiply: Text darunter bleibt sichtbar, Farben überlagern sich
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = KONFIGURATION.TEXTMARKER_FARBE;
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;

    case 'radierer':
      // destination-out: löscht Pixel auf dem Zeichen-Canvas
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;

    case 'laser':
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = KONFIGURATION.LASER_FARBE;
      ctx.globalAlpha = 0.9;
      // Leucht-Effekt durch shadowBlur
      ctx.shadowBlur  = 14;
      ctx.shadowColor = KONFIGURATION.LASER_FARBE;
      break;

    default:
      // stift-duenn, stift-dick
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = Z.strichfarbe;
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      break;
  }
}

/**
 * Setzt alle Canvas-Eigenschaften auf sichere Standardwerte zurück.
 * Wichtig: nach Textmarker und Laser um Artefakte zu verhindern.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

/**
 * Strich-Start: touchstart / mousedown
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichStarten(e, canvas) {
  // Pinch-Geste hat Vorrang → kein Zeichnen
  if (e.touches && e.touches.length > 1) return;
  if (Z.spotlightAktiv) return;
  e.preventDefault();

  Z.zeichnet = true;
  const p = koordinaten(e, canvas);
  Z.letzterPunkt = p;

  const seite = +canvas.closest('.seite-container').dataset.seite;
  undoSnapshot(seite);

  // Neuen Strich vorbereiten (Laser + Radierer werden nicht dauerhaft gespeichert)
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

  // Einzelnen Punkt zeichnen (für kurze Tipp-Gesten)
  const ctx = canvas.getContext('2d');
  ctxKonfigurieren(ctx);
  ctx.beginPath();
  ctx.arc(p.x, p.y, Z.strichbreite / 2, 0, Math.PI * 2);
  ctx.fill();
  ctxReset(ctx);
}

/**
 * Strich-Bewegen: touchmove / mousemove
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichBewegen(e, canvas) {
  // Pinch-Geste erkennen
  if (e.touches && e.touches.length === 2) {
    if (Z.zeichnet) {
      // Zeichnen abbrechen sobald zweiter Finger kommt
      Z.zeichnet = false;
      Z.aktuellerStrich = null;
    }
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

  if (Z.aktuellerStrich) {
    Z.aktuellerStrich.punkte.push({ ...p });
  }

  Z.letzterPunkt = p;
}

/**
 * Strich-Ende: touchend / mouseup
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichBeenden(e, canvas) {
  if (!Z.zeichnet) return;
  e.preventDefault();

  Z.zeichnet = false;

  // Fertigen Strich in Annotations-Speicher übernehmen
  if (Z.aktuellerStrich) {
    const seite = +canvas.closest('.seite-container').dataset.seite;
    if (!Z.annotationen[seite]) Z.annotationen[seite] = [];
    Z.annotationen[seite].push(Z.aktuellerStrich);
    Z.aktuellerStrich = null;
  }

  // Laser-Striche nach Timeout ausblenden
  if (Z.werkzeug === 'laser') {
    laserAusblenden(canvas);
  }

  Z.letzterPunkt = null;
}

/**
 * Blendet den aktuellen Laser-Inhalt des Canvas nach dem Timeout aus.
 * Technik: Snapshot → warten → Canvas leeren → Bild mit sinkender
 * Deckkraft kurz zurückzeichnen → komplett löschen.
 *
 * @param {HTMLCanvasElement} canvas
 */
function laserAusblenden(canvas) {
  const snapshot = canvas.toDataURL();
  const ctx = canvas.getContext('2d');

  const tid = setTimeout(() => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;

      setTimeout(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }, 350);
    };
    img.src = snapshot;
  }, KONFIGURATION.LASER_TIMEOUT_MS);

  Z.laserTimeouts.push(tid);
}

/**
 * Registriert alle Zeichen-Listener für einen Canvas.
 * Wird nach dem Erstellen jedes Seiten-Canvas aufgerufen.
 *
 * @param {HTMLCanvasElement} canvas
 */
function zeichenListeners(canvas) {
  canvas.addEventListener('touchstart',
    e => strichStarten(e, canvas), { passive: false });
  canvas.addEventListener('touchmove',
    e => strichBewegen(e, canvas), { passive: false });
  canvas.addEventListener('touchend',
    e => strichBeenden(e, canvas), { passive: false });
  canvas.addEventListener('touchcancel',
    e => strichBeenden(e, canvas), { passive: false });

  // Maus (Desktop-Vorschau / Apple Pencil in manchen Browsern)
  canvas.addEventListener('mousedown',  e => strichStarten(e, canvas));
  canvas.addEventListener('mousemove',  e => strichBewegen(e, canvas));
  canvas.addEventListener('mouseup',    e => strichBeenden(e, canvas));
  canvas.addEventListener('mouseleave', e => { if (Z.zeichnet) strichBeenden(e, canvas); });
}

/**
 * Zeichnet alle gespeicherten Annotationen einer Seite neu auf den Canvas.
 * Wird nach Undo/Redo-Operationen oder beim Lehrer-Layer-Wechsel verwendet.
 *
 * @param {number} seite
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object[]} striche  – Array von Strich-Objekten
 */
function stricheZeichnen(ctx, striche) {
  if (!striche || striche.length === 0) return;

  striche.forEach(strich => {
    if (!strich.punkte || strich.punkte.length === 0) return;

    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.lineWidth = strich.breite;

    if (strich.werkzeug === 'textmarker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = KONFIGURATION.TEXTMARKER_FARBE;
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strich.farbe;
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.moveTo(strich.punkte[0].x, strich.punkte[0].y);

    // Kurve durch alle Punkte (glatter als Liniensegmente)
    for (let i = 1; i < strich.punkte.length - 1; i++) {
      const mx = (strich.punkte[i].x + strich.punkte[i + 1].x) / 2;
      const my = (strich.punkte[i].y + strich.punkte[i + 1].y) / 2;
      ctx.quadraticCurveTo(strich.punkte[i].x, strich.punkte[i].y, mx, my);
    }

    // Letzter Punkt
    const letzter = strich.punkte[strich.punkte.length - 1];
    ctx.lineTo(letzter.x, letzter.y);
    ctx.stroke();

    ctxReset(ctx);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   7. UNDO / REDO
════════════════════════════════════════════════════════════════════ */

/**
 * Speichert einen Canvas-Snapshot in den Undo-Verlauf einer Seite.
 * Wird VOR jedem neuen Strich aufgerufen.
 *
 * @param {number} seite
 */
function undoSnapshot(seite) {
  const canvas = zeichenCanvas(seite);
  if (!canvas) return;

  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];

  // Maximale Undo-Tiefe: 30 Schritte pro Seite
  const verlauf = Z.undoVerlauf[seite];
  verlauf.push(canvas.toDataURL());
  if (verlauf.length > 30) verlauf.shift();

  // Redo-Stack leeren bei neuem Strich
  Z.redoVerlauf[seite] = [];
}

/** Undo: letzten Canvas-Zustand wiederherstellen. */
function undoAusfuehren() {
  const seite   = Z.aktiveSeite;
  const verlauf = Z.undoVerlauf[seite];
  if (!verlauf?.length) {
    toast('Kein weiterer Rückgängig-Schritt.', 'info', 1500);
    return;
  }

  const canvas = zeichenCanvas(seite);
  if (!canvas) return;

  if (!Z.redoVerlauf[seite]) Z.redoVerlauf[seite] = [];
  Z.redoVerlauf[seite].push(canvas.toDataURL());

  const snapshot = verlauf.pop();
  snapshotWiederherstellen(canvas, snapshot);

  // Annotations-Array ebenfalls zurücksetzen
  // (vereinfacht: letzten Strich entfernen)
  if (Z.annotationen[seite]?.length) {
    Z.annotationen[seite].pop();
  }
}

/** Redo: rückgängig gemachten Schritt wiederholen. */
function redoAusfuehren() {
  const seite = Z.aktiveSeite;
  const stack = Z.redoVerlauf[seite];
  if (!stack?.length) {
    toast('Kein weiterer Wiederholen-Schritt.', 'info', 1500);
    return;
  }

  const canvas = zeichenCanvas(seite);
  if (!canvas) return;

  if (!Z.undoVerlauf[seite]) Z.undoVerlauf[seite] = [];
  Z.undoVerlauf[seite].push(canvas.toDataURL());

  const snapshot = stack.pop();
  snapshotWiederherstellen(canvas, snapshot);
}

/**
 * Lädt einen DataURL-Snapshot zurück auf einen Canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} dataUrl
 */
function snapshotWiederherstellen(canvas, dataUrl) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

/** Löscht alle Annotationen der aktuellen Seite nach Bestätigung. */
function seiteLeeren() {
  const seite = Z.aktiveSeite;
  if (!window.confirm(`Alle Annotationen auf Seite ${seite} löschen?`)) return;

  undoSnapshot(seite);
  const canvas = zeichenCanvas(seite);
  if (canvas) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
  Z.annotationen[seite] = [];
  toast(`Seite ${seite} geleert.`, 'info');
}


/* ═══════════════════════════════════════════════════════════════════
   8. LEHRER-LAYER
════════════════════════════════════════════════════════════════════ */

/** Schaltet den Lehrer-Layer ein oder aus. */
function lehrerLayerUmschalten() {
  Z.lehrerAktiv = !Z.lehrerAktiv;
  const an = Z.lehrerAktiv;

  D.btnLehrerLayer.classList.toggle('aktiv', an);
  D.btnLehrerLayer.setAttribute('aria-pressed', an ? 'true' : 'false');
  D.iconAugeAuf.style.display = an ? 'block' : 'none';
  D.iconAugeZu.style.display  = an ? 'none'  : 'block';

  // Alle Lehrer-Canvas-Elemente aktualisieren
  for (let s = 1; s <= Z.seitenAnzahl; s++) {
    const canvas = lehrerCanvas(s);
    if (!canvas) continue;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (an && Z.lehrerAnnotationen[s]?.length) {
      ctx.globalAlpha = 0.72; // Lehrer-Layer leicht transparent
      stricheZeichnen(ctx, Z.lehrerAnnotationen[s]);
      ctx.globalAlpha = 1;
    }
  }

  toast(an ? 'Lehrer-Layer sichtbar' : 'Lehrer-Layer ausgeblendet', 'info', 1400);
}


/* ═══════════════════════════════════════════════════════════════════
   9. SPOTLIGHT
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
  toast('Spotlight aktiv – ziehen zum Verschieben, Rand zum Skalieren', 'info', 2800);
}

/** Spotlight ausschalten. */
function spotlightAus() {
  Z.spotlightAktiv = false;
  D.spotlightOverlay.style.display = 'none';
  D.spotlightOverlay.setAttribute('aria-hidden', 'true');
  D.btnSpotlight.classList.remove('aktiv');
  D.btnSpotlight.setAttribute('aria-pressed', 'false');
}

/** Spotlight ein-/ausschalten. */
function spotlightUmschalten() {
  Z.spotlightAktiv ? spotlightAus() : spotlightAn();
}

/**
 * Aktualisiert Position, Größe und Masken-Clip des Spotlight-Fensters.
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
    // Ellipsen-Maske via radial-gradient
    const cx = f.x + f.b / 2;
    const cy = f.y + f.h / 2;
    const rx = f.b / 2;
    const ry = f.h / 2;
    maske.style.webkitMaskImage =
      `radial-gradient(ellipse ${rx}px ${ry}px at ${cx}px ${cy}px,
         transparent 99%, black 100%)`;
    maske.style.maskImage = maske.style.webkitMaskImage;
    maske.style.clipPath  = '';
  } else {
    // Rechteck-Maske via clip-path polygon mit Loch
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
 * Ermittelt die Spotlight-Aktion basierend auf der Touch-Position.
 * Rand (30px) → Größe ändern. Mitte → verschieben.
 *
 * @param {number} x
 * @param {number} y
 * @returns {'bewegen'|'groesse'|null}
 */
function spotAktionErmitteln(x, y) {
  const f   = Z.spotFenster;
  const rand = 32;
  const imFenster = x >= f.x && x <= f.x + f.b && y >= f.y && y <= f.y + f.h;
  if (!imFenster) return null;
  const amRand = x <= f.x + rand || x >= f.x + f.b - rand ||
                 y <= f.y + rand || y >= f.y + f.h - rand;
  return amRand ? 'groesse' : 'bewegen';
}

/** Initialisiert alle Spotlight-Listener. */
function spotlightInit() {
  const ov = D.spotlightOverlay;

  // ── Touch ──────────────────────────────────────────────────────
  ov.addEventListener('touchstart', e => {
    if (!Z.spotlightAktiv) return;
    e.preventDefault();
    const t = e.touches[0];
    Z.spotAktion = spotAktionErmitteln(t.clientX, t.clientY);
    if (Z.spotAktion === 'bewegen') {
      Z.spotOffset = {
        dx: t.clientX - Z.spotFenster.x,
        dy: t.clientY - Z.spotFenster.y,
      };
    } else if (Z.spotAktion === 'groesse') {
      Z.spotOffset = {
        sx: t.clientX, sy: t.clientY,
        sb: Z.spotFenster.b, sh: Z.spotFenster.h,
      };
    }
  }, { passive: false });

  ov.addEventListener('touchmove', e => {
    if (!Z.spotlightAktiv || !Z.spotAktion) return;
    e.preventDefault();
    const t = e.touches[0];
    _spotBewegen(t.clientX, t.clientY);
  }, { passive: false });

  ov.addEventListener('touchend', e => {
    e.preventDefault();
    Z.spotAktion = null;
    Z.spotOffset = null;
  }, { passive: false });

  // ── Maus (Desktop) ─────────────────────────────────────────────
  let mausTaste = false;
  ov.addEventListener('mousedown', e => {
    if (!Z.spotlightAktiv) return;
    mausTaste = true;
    Z.spotAktion = spotAktionErmitteln(e.clientX, e.clientY);
    if (Z.spotAktion === 'bewegen') {
      Z.spotOffset = { dx: e.clientX - Z.spotFenster.x, dy: e.clientY - Z.spotFenster.y };
    } else if (Z.spotAktion === 'groesse') {
      Z.spotOffset = { sx: e.clientX, sy: e.clientY, sb: Z.spotFenster.b, sh: Z.spotFenster.h };
    }
  });
  document.addEventListener('mousemove', e => {
    if (!mausTaste || !Z.spotlightAktiv || !Z.spotAktion) return;
    _spotBewegen(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', () => {
    mausTaste = false;
    Z.spotAktion = null;
    Z.spotOffset = null;
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

/**
 * Interne Hilfsfunktion: Fenster bewegen oder skalieren.
 * @param {number} cx  – aktuelle Cursor-X
 * @param {number} cy  – aktuelle Cursor-Y
 */
function _spotBewegen(cx, cy) {
  const f = Z.spotFenster;
  const o = Z.spotOffset;

  if (Z.spotAktion === 'bewegen') {
    f.x = Math.max(0, Math.min(cx - o.dx, window.innerWidth  - f.b));
    f.y = Math.max(0, Math.min(cy - o.dy, window.innerHeight - f.h));
  } else if (Z.spotAktion === 'groesse') {
    f.b = Math.max(KONFIGURATION.SPOTLIGHT_MIN_B, o.sb + (cx - o.sx));
    f.h = Math.max(KONFIGURATION.SPOTLIGHT_MIN_H, o.sh + (cy - o.sy));
  }
  spotlightAktualisieren();
}


/* ═══════════════════════════════════════════════════════════════════
   10. ZOOM (Pinch-to-Zoom + Buttons)
════════════════════════════════════════════════════════════════════ */

/**
 * Setzt den Zoom-Faktor und aktualisiert die CSS-Transformation
 * des PDF-Containers sowie die Zoom-Anzeige.
 *
 * @param {number} neuerZoom
 */
function zoomSetzen(neuerZoom) {
  Z.zoom = Math.min(
    KONFIGURATION.ZOOM_MAX,
    Math.max(KONFIGURATION.ZOOM_MIN, neuerZoom)
  );
  // Transformation auf den PDF-Container anwenden (nicht den Wrapper!).
  // So kann der Wrapper weiterhin scrollen.
  D.pdfContainer.style.transform       = `scale(${Z.zoom})`;
  D.pdfContainer.style.transformOrigin = 'top center';
  D.zoomAnzeige.textContent = `${Math.round(Z.zoom * 100)}%`;
}

/** Verarbeitet die Pinch-Geste (touchmove mit 2 Fingern). */
function pinchBewegen(e) {
  if (e.touches.length !== 2) return;
  e.preventDefault();

  const abstand = pinchAbstand(e.touches);

  if (Z.pinch === null) {
    // Pinch-Start: Startabstand und Startzoom merken
    Z.pinch = { abstand, zoomStart: Z.zoom };
    return;
  }

  const faktor = abstand / Z.pinch.abstand;
  zoomSetzen(Z.pinch.zoomStart * faktor);
}

/** Initialisiert Zoom-Buttons und globale Pinch-Listener. */
function zoomInit() {
  D.btnZoomPlus.addEventListener('click', () =>
    zoomSetzen(Z.zoom + KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomMinus.addEventListener('click', () =>
    zoomSetzen(Z.zoom - KONFIGURATION.ZOOM_SCHRITT));
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));

  // Pinch auf dem Zoom-Wrapper (nicht auf einzelnen Canvas)
  D.zoomWrapper.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      Z.pinch = null; // Wird in pinchBewegen() gesetzt
    }
  }, { passive: false });

  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchBewegen(e);
    }
  }, { passive: false });

  D.zoomWrapper.addEventListener('touchend', () => {
    if (Z.pinch !== null) Z.pinch = null;
  }, { passive: true });

  // Mausrad auf Desktop
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -KONFIGURATION.ZOOM_SCHRITT : KONFIGURATION.ZOOM_SCHRITT;
      zoomSetzen(Z.zoom + delta);
    }
  }, { passive: false });
}


/* ═══════════════════════════════════════════════════════════════════
   11. PDF-RENDERING (pdf.js)
════════════════════════════════════════════════════════════════════ */

/**
 * Lädt eine PDF-Datei, rendert alle Seiten und baut die Canvas-Struktur auf.
 *
 * @param {File} datei
 */
async function pdfLaden(datei) {
  ladeAnzeige(true, 'PDF wird geöffnet…');

  try {
    // Rohdaten lesen – originale Bytes für den späteren pdf-lib-Export aufbewahren
    const arrayBuffer = await datei.arrayBuffer();
    Z.pdfBytes = new Uint8Array(arrayBuffer);

    // pdf.js Worker konfigurieren
    pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER;

    // PDF-Dokument laden (Kopie damit das Original unberührt bleibt)
    Z.pdfDokument  = await pdfjsLib.getDocument({ data: Z.pdfBytes.slice() }).promise;
    Z.seitenAnzahl = Z.pdfDokument.numPages;

    // Zustand zurücksetzen
    Z.annotationen      = {};
    Z.lehrerAnnotationen = {};
    Z.undoVerlauf       = {};
    Z.redoVerlauf       = {};
    Z.aktiveSeite       = 1;
    Z.viewports         = {};
    zoomSetzen(1.0);

    // UI vorbereiten
    D.startAnzeige.style.display  = 'none';
    D.pdfContainer.innerHTML      = '';
    D.pdfContainer.style.display  = 'flex';

    // Zoom-Wrapper befüllen (falls noch nicht geschehen)
    if (!D.zoomWrapper.contains(D.pdfContainer)) {
      D.zoomWrapper.appendChild(D.pdfContainer);
    }

    // Alle Seiten sequenziell rendern
    for (let i = 1; i <= Z.seitenAnzahl; i++) {
      ladeAnzeige(true, `Seite ${i} / ${Z.seitenAnzahl} wird gerendert…`);
      await pdfSeiteRendern(i);
    }

    // Zoom-Steuerung einblenden
    D.zoomSteuerung.style.display = 'flex';

    toast(`„${datei.name}" geladen (${Z.seitenAnzahl} Seiten)`, 'erfolg');

  } catch (fehler) {
    console.error('[EduLayer] PDF-Ladefehler:', fehler);
    toast('Fehler beim Laden der PDF. Ist die Datei gültig?', 'fehler', 4000);
  } finally {
    ladeAnzeige(false);
  }
}

/**
 * Rendert eine einzelne PDF-Seite.
 *
 * Koordinaten-Kopplung (kein Drift!):
 *   - pdf.js liefert einen Viewport mit exakter Pixel-Größe.
 *   - PDF-Canvas und Zeichen-Canvas haben exakt dieselben Pixelmaße.
 *   - CSS-Größe = Canvas-Größe (kein Strecken durch CSS).
 *   - Zoom verändert nur den übergeordneten Container, nie die Canvas-Pixel.
 *   → Annotationskoordinaten sind immer im PDF-Koordinatenraum gespeichert.
 *
 * @param {number} seitenNummer
 */
async function pdfSeiteRendern(seitenNummer) {
  const seite    = await Z.pdfDokument.getPage(seitenNummer);

  // Viewport mit konfiguriertem Skalierungsfaktor
  const viewport = seite.getViewport({ scale: KONFIGURATION.PDF_SCALE });
  const W = Math.floor(viewport.width);
  const H = Math.floor(viewport.height);

  // Viewport-Daten für den Export merken
  Z.viewports[seitenNummer] = { breite: W, hoehe: H, scale: KONFIGURATION.PDF_SCALE };

  // ── Container ─────────────────────────────────────────────────
  const container         = document.createElement('div');
  container.className     = 'seite-container';
  container.dataset.seite = seitenNummer;
  container.style.width   = `${W}px`;
  container.style.height  = `${H}px`;

  // ── PDF-Canvas (Hintergrund, von pdf.js gefüllt) ──────────────
  const pdfCanvas         = document.createElement('canvas');
  pdfCanvas.className     = 'pdf-canvas';
  pdfCanvas.width         = W;
  pdfCanvas.height        = H;
  // CSS-Größe == Canvas-Pixel-Größe (kein DevicePixelRatio-Trick nötig
  // weil PDF_SCALE den Schärfe-Faktor bereits enthält)
  pdfCanvas.style.width   = `${W}px`;
  pdfCanvas.style.height  = `${H}px`;
  container.appendChild(pdfCanvas);

  // ── Zeichen-Canvas (transparent, Touch-Events aktiv) ──────────
  const zCanvas           = document.createElement('canvas');
  zCanvas.className       = 'zeichen-canvas';
  zCanvas.width           = W;
  zCanvas.height          = H;
  zCanvas.dataset.werkzeug = Z.werkzeug;
  container.appendChild(zCanvas);

  // ── Lehrer-Canvas (oberster Layer, keine Touch-Events) ────────
  const lCanvas           = document.createElement('canvas');
  lCanvas.className       = 'lehrer-canvas';
  lCanvas.width           = W;
  lCanvas.height          = H;
  lCanvas.setAttribute('aria-hidden', 'true');
  container.appendChild(lCanvas);

  D.pdfContainer.appendChild(container);

  // ── PDF rendern ────────────────────────────────────────────────
  await seite.render({
    canvasContext: pdfCanvas.getContext('2d'),
    viewport,
  }).promise;

  // ── Zeichen-Listener registrieren ─────────────────────────────
  zeichenListeners(zCanvas);

  // ── Intersection Observer: aktive Seite verfolgen ─────────────
  // Wird für Undo/Redo verwendet (immer auf aktuell sichtbare Seite)
  const observer = new IntersectionObserver(eintraege => {
    eintraege.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio >= 0.4) {
        Z.aktiveSeite = seitenNummer;
      }
    });
  }, { root: D.zoomWrapper, threshold: 0.4 });
  observer.observe(container);
}


/* ═══════════════════════════════════════════════════════════════════
   12. PDF-EXPORT (pdf-lib)
════════════════════════════════════════════════════════════════════ */

/**
 * Exportiert die PDF mit eingebetteten Annotationen.
 *
 * Strategie:
 *   Für jede Seite wird der Zeichen-Canvas als PNG-Bild exportiert
 *   und über pdf-lib als XObject (Rasterbild) in die PDF-Seite
 *   eingebettet. Dabei werden:
 *     - Originalkoordinaten (PDF-Koordinatenraum) korrekt skaliert
 *     - Lehrer-Layer separat als zweites Bild eingebettet,
 *       wenn er aktiv ist
 *     - Laserpointer-Striche werden nie exportiert (flüchtig)
 *
 *   Vollständige Vektor-Einbettung via pdf-lib ist als Erweiterung
 *   vorbereitet (Funktion stricheAlsVektorenEinbetten).
 */
async function pdfSpeichern() {
  if (!Z.pdfBytes) {
    toast('Keine PDF geladen.', 'fehler');
    return;
  }

  ladeAnzeige(true, 'PDF wird gespeichert…');

  try {
    // ── Original-PDF laden ──────────────────────────────────────
    const pdfDoc = await PDFLib.PDFDocument.load(Z.pdfBytes);
    const seiten = pdfDoc.getPages();

    for (let s = 1; s <= Z.seitenAnzahl; s++) {
      const pdfSeite = seiten[s - 1];
      const viewport = Z.viewports[s];
      if (!viewport) continue;

      // Verhältnis Canvas-Pixel → PDF-Punkte
      // PDF-Seiten-Größe in Punkten
      const { width: pdfB, height: pdfH } = pdfSeite.getSize();
      const skalX = pdfB / viewport.breite;
      const skalY = pdfH / viewport.hoehe;

      // ── Zeichen-Canvas als PNG exportieren ───────────────────
      const zC = zeichenCanvas(s);
      if (zC && annotationenVorhanden(s)) {
        const pngDataUrl = zC.toDataURL('image/png');
        const pngBytes   = base64ZuBytes(pngDataUrl.split(',')[1]);
        const pngBild    = await pdfDoc.embedPng(pngBytes);

        // Bild über die gesamte Seite legen (deckt den Canvas-Bereich exakt ab)
        pdfSeite.drawImage(pngBild, {
          x:      0,
          y:      0,
          width:  pdfB,
          height: pdfH,
          opacity: 1,
        });
      }

      // ── Lehrer-Canvas einbetten (nur wenn aktiv) ─────────────
      if (Z.lehrerAktiv && Z.lehrerAnnotationen[s]?.length) {
        const lC = lehrerCanvas(s);
        if (lC) {
          const lDataUrl = lC.toDataURL('image/png');
          const lBytes   = base64ZuBytes(lDataUrl.split(',')[1]);
          const lBild    = await pdfDoc.embedPng(lBytes);

          pdfSeite.drawImage(lBild, {
            x: 0, y: 0,
            width: pdfB, height: pdfH,
            opacity: 0.72,
          });
        }
      }
    }

    // ── Metadaten setzen ────────────────────────────────────────
    pdfDoc.setCreator('EduLayer PWA');
    pdfDoc.setProducer('EduLayer – Datenschutz-konforme Unterrichts-App');
    pdfDoc.setModificationDate(new Date());

    // ── PDF als Bytes serialisieren und herunterladen ────────────
    const gespeicherteBytes = await pdfDoc.save();
    const dateiname = `EduLayer_Annotation_${zeitstempel()}.pdf`;
    download(gespeicherteBytes, dateiname);

    toast(`Gespeichert: ${dateiname}`, 'erfolg', 3500);

  } catch (fehler) {
    console.error('[EduLayer] Speicherfehler:', fehler);
    toast('Fehler beim Speichern. Bitte erneut versuchen.', 'fehler', 4000);
  } finally {
    ladeAnzeige(false);
  }
}

/**
 * Prüft ob für eine Seite Annotationen vorhanden sind.
 * @param {number} seite
 * @returns {boolean}
 */
function annotationenVorhanden(seite) {
  return !!(Z.annotationen[seite]?.length);
}

/**
 * Konvertiert einen Base64-String in ein Uint8Array.
 * Wird für pdf-lib benötigt (erwartet Rohbytes statt DataURL).
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ZuBytes(base64) {
  const binaer = atob(base64);
  const bytes  = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) {
    bytes[i] = binaer.charCodeAt(i);
  }
  return bytes;
}

/**
 * Erzeugt einen Zeitstempel für Dateinamen (Format: JJJJ-MM-TT_HH-MM).
 * @returns {string}
 */
function zeitstempel() {
  const d  = new Date();
  const zw = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zw(d.getMonth()+1)}-${zw(d.getDate())}` +
         `_${zw(d.getHours())}-${zw(d.getMinutes())}`;
}

/**
 * ERWEITERUNG (vorbereitet, noch nicht aktiv):
 * Bettet Annotationen als native PDF-Vektoren ein.
 * Vorteil: skalierbar, kleiner, durchsuchbar.
 * Nachteil: Textmarker-Effekt (multiply) geht verloren.
 *
 * Aktivierung: In pdfSpeichern() statt drawImage() aufrufen.
 *
 * @param {Object} pdfLib  – die PDFLib-Instanz
 * @param {Object} pdfSeite – PDFPage-Objekt
 * @param {number} seite
 * @param {number} pdfB   – Seitenbreite in PDF-Punkten
 * @param {number} pdfH   – Seitenhöhe in PDF-Punkten
 * @param {number} viewport – { breite, hoehe, scale }
 */
// function stricheAlsVektorenEinbetten(pdfLib, pdfSeite, seite, pdfB, pdfH, viewport) {
//   const striche = Z.annotationen[seite] || [];
//   const skalX = pdfB / viewport.breite;
//   const skalY = pdfH / viewport.hoehe;
//
//   striche.forEach(strich => {
//     if (strich.punkte.length < 2) return;
//     // PDF-Koordinatensystem: Y-Achse zeigt nach oben → spiegeln
//     const punkte = strich.punkte.map(p => ({
//       x: p.x * skalX,
//       y: pdfH - p.y * skalY,   // Y-Spiegelung!
//     }));
//     const [r, g, b] = hexZuRgb(strich.farbe);
//     pdfSeite.drawLine({
//       // pdf-lib unterstützt nur Geraden, keine Polylinie → TODO: Bezier
//       start: { x: punkte[0].x, y: punkte[0].y },
//       end:   { x: punkte[punkte.length-1].x, y: punkte[punkte.length-1].y },
//       thickness: strich.breite * skalX,
//       color: pdfLib.rgb(r, g, b),
//       lineCap: pdfLib.LineCapStyle.Round,
//     });
//   });
// }


/* ═══════════════════════════════════════════════════════════════════
   13. SERVICE WORKER
════════════════════════════════════════════════════════════════════ */

/** Registriert den Service Worker für Offline-Betrieb. */
function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[EduLayer] Service Worker registriert:', reg.scope);

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update verfügbar – Seite neu laden.', 'info', 6000);
          }
        });
      });
    } catch (err) {
      console.warn('[EduLayer] SW-Registrierung fehlgeschlagen:', err);
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   14. APP-START
════════════════════════════════════════════════════════════════════ */

/**
 * Initialisiert die gesamte Anwendung.
 * Reihenfolge ist wichtig: DOM-Listener vor Zustand-Defaults.
 */
function appStart() {
  console.log('[EduLayer] Starte…');

  // ── Listener registrieren ──────────────────────────────────────
  sidebarInit();
  spotlightInit();
  zoomInit();

  // ── Standard-Zustand ───────────────────────────────────────────
  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);

  // ── PDF-Container in den Zoom-Wrapper verschieben ─────────────
  // (im HTML ist er direkt im main – wir verschieben ihn per JS)
  D.zoomWrapper.appendChild(D.pdfContainer);

  // ── Service Worker ─────────────────────────────────────────────
  swRegistrieren();

  // ── iOS: Bounce-Effekt der ganzen Seite verhindern ────────────
  // Scrollen nur im zoom-wrapper und spotlight-overlay erlauben
  document.addEventListener('touchmove', e => {
    const erlaubt = e.target.closest('.zoom-wrapper') ||
                    e.target.closest('.spotlight-overlay') ||
                    e.target.closest('.sidebar');
    if (!erlaubt) e.preventDefault();
  }, { passive: false });

  // ── Drag-and-Drop: PDF direkt in den Browser ziehen ───────────
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const datei = e.dataTransfer?.files[0];
    if (datei?.type === 'application/pdf') pdfLaden(datei);
  });

  // ── Orientierungswechsel ───────────────────────────────────────
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (Z.spotlightAktiv) spotlightAktualisieren();
    }, 350);
  });

  console.log('[EduLayer] Bereit.');
}

// Starten sobald DOM fertig ist
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else {
  appStart();
}
