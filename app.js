/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Haupt-Anwendungslogik                               ║
 * ║  Datei: app.js                                                  ║
 * ║  Zweck: UI-Initialisierung, Event-Listener, Zeichen-Engine,     ║
 * ║         State-Verwaltung, Spotlight-Mechanik, Service-Worker    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * STRUKTUR:
 *  1. KONFIGURATION         ← Hier können Werte leicht angepasst werden
 *  2. ZUSTAND (State)       ← Zentrale Datenhaltung
 *  3. DOM-REFERENZEN        ← Verweise auf HTML-Elemente
 *  4. HILFSFUNKTIONEN       ← Toast, Koordinaten etc.
 *  5. SIDEBAR-LOGIK         ← Werkzeugwahl, Farbe, Seitenposition
 *  6. ZEICHEN-ENGINE        ← Touch/Maus-Events, Canvas-Zeichnen
 *  7. LEHRER-LAYER          ← Zweiter Annotations-Layer
 *  8. SPOTLIGHT-MECHANIK    ← Overlay mit Fokus-Fenster
 *  9. PDF-RENDERING         ← pdf.js Integration (Stub für nächsten Schritt)
 * 10. PDF-EXPORT            ← pdf-lib Integration (Stub für nächsten Schritt)
 * 11. SERVICE WORKER        ← PWA-Offline-Registrierung
 * 12. APP-START             ← Initialisierung
 */

'use strict';


/* ═══════════════════════════════════════════════════════════════════
   1. KONFIGURATION
   ← DIESE WERTE KÖNNEN LEICHT ANGEPASST WERDEN ←
════════════════════════════════════════════════════════════════════ */
const KONFIGURATION = {

  // ── Stift-Einstellungen ──────────────────────────────────────────
  STIFT_DUENN_PX:        2,       // Breite des dünnen Stifts in Pixel
  STIFT_DICK_PX:         6,       // Breite des dicken Stifts in Pixel
  TEXTMARKER_PX:         18,      // Breite des Textmarkers in Pixel
  RADIERER_PX:           24,      // Größe des Radiergummis in Pixel
  LASER_PX:              4,       // Breite des Laserpointers in Pixel

  // ── Farben ──────────────────────────────────────────────────────
  LASER_FARBE:           '#ff3030',  // Leuchtendes Rot für Laserpointer
  TEXTMARKER_FARBE:      'rgba(255, 210, 0, 0.45)', // Gelb, halbtransparent
  STANDARD_FARBE:        '#1a3a6b',  // Startfarbe beim Öffnen der App

  // ── Laserpointer ────────────────────────────────────────────────
  LASER_TIMEOUT_MS:      2000,    // Millisekunden bis Laser-Striche verschwinden

  // ── Spotlight ───────────────────────────────────────────────────
  SPOTLIGHT_MIN_BREITE:  80,      // Minimale Breite des Fokus-Fensters (px)
  SPOTLIGHT_MIN_HOEHE:   60,      // Minimale Höhe des Fokus-Fensters (px)
  SPOTLIGHT_START_B:     320,     // Startbreite des Fokus-Fensters (px)
  SPOTLIGHT_START_H:     200,     // Starthöhe des Fokus-Fensters (px)

  // ── PDF-Rendering ───────────────────────────────────────────────
  PDF_RENDER_SCALE:      1.5,     // Auflösungsfaktor (höher = schärfer, langsamer)
  PDF_SEITEN_ABSTAND:    24,      // Abstand zwischen Seiten in Pixel

  // ── PDF.js Worker ───────────────────────────────────────────────
  // WICHTIG: Version muss zur CDN-Version in index.html passen!
  PDFJS_WORKER_URL:      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};


/* ═══════════════════════════════════════════════════════════════════
   2. ZUSTAND (ZENTRALES STATE-MANAGEMENT)
   Alle Anwendungsdaten an einem Ort.
════════════════════════════════════════════════════════════════════ */
const zustand = {

  // ── Aktuelles Werkzeug ─────────────────────────────────────────
  werkzeug:          'stift-duenn',  // Mögliche Werte: siehe WERKZEUGE-Konstante
  strichfarbe:       KONFIGURATION.STANDARD_FARBE,
  strichbreite:      KONFIGURATION.STIFT_DUENN_PX,

  // ── Zeichnen ──────────────────────────────────────────────────
  zeichnet:          false,          // Wird gerade gezeichnet?
  letzterPunkt:      null,           // { x, y } – letzter Touch-/Maus-Punkt

  // ── PDF-Daten ─────────────────────────────────────────────────
  pdfDokument:       null,           // pdf.js PDFDocumentProxy
  seitenAnzahl:      0,
  aktiveSeite:       1,              // Sichtbare Seite (1-basiert)
  originalDateiBytes: null,          // ArrayBuffer der originalen PDF-Datei

  // ── Annotations-Speicher ─────────────────────────────────────
  /**
   * annotationen[seitenNummer] = Array von Strichen
   * Jeder Strich = {
   *   punkte:     [{x, y}, ...],  // Alle Punkte des Strichs
   *   farbe:      '#...',
   *   breite:     number,
   *   werkzeug:   'stift-duenn' | 'stift-dick' | 'textmarker' | 'laser'
   * }
   */
  annotationen:      {},             // { 1: [...striche], 2: [...striche] }
  undoVerlauf:       {},             // { 1: [...snapshots] } für Rückgängig
  redoVerlauf:       {},             // { 1: [...snapshots] } für Wiederholen

  // ── Lehrer-Layer ──────────────────────────────────────────────
  lehrerAnnotationen: {},            // Wie annotationen, aber getrennt
  lehrerLayerAktiv:   false,         // Ist der Layer sichtbar?

  // ── Spotlight ─────────────────────────────────────────────────
  spotlightAktiv:    false,
  spotlightForm:     'rechteck',     // 'rechteck' oder 'oval'
  spotlightFenster:  {               // Position und Größe des Fokus-Fensters
    x:    0, y:   0,
    b:    KONFIGURATION.SPOTLIGHT_START_B,
    h:    KONFIGURATION.SPOTLIGHT_START_H,
  },
  spotlightAktion:   null,           // 'bewegen' | 'groesse' | null
  spotlightStartTouchOffset: null,   // Offset beim Drag-Start

  // ── Aktueller Strich (während des Zeichnens) ──────────────────
  aktuellerStrich:   null,           // Wird gefüllt während touchmove

  // ── Laser-Timeouts ────────────────────────────────────────────
  laserTimeouts:     [],             // Array von setTimeout-IDs

  // ── Sidebar-Position ─────────────────────────────────────────
  sidebarPosition:   'left',         // 'left' oder 'right'
};


/* ═══════════════════════════════════════════════════════════════════
   3. DOM-REFERENZEN
   Alle HTML-Elemente einmalig hier cachen für bessere Performance.
════════════════════════════════════════════════════════════════════ */
const dom = {
  // Layout
  body:                document.body,
  hauptbereich:        document.getElementById('hauptbereich'),
  pdfContainer:        document.getElementById('pdf-container'),
  startAnzeige:        document.getElementById('start-anzeige'),

  // Datei-Operationen
  btnDateiLaden:       document.getElementById('btn-datei-laden'),
  btnStartLaden:       document.getElementById('btn-start-laden'),
  dateiInput:          document.getElementById('datei-input'),
  btnSpeichern:        document.getElementById('btn-speichern'),

  // Stift-Buttons
  btnStiftDuenn:       document.getElementById('btn-stift-duenn'),
  btnStiftDick:        document.getElementById('btn-stift-dick'),
  btnTextmarker:       document.getElementById('btn-textmarker'),
  btnRadierer:         document.getElementById('btn-radierer'),

  // Farb-Dots
  farbDots:            document.querySelectorAll('.farb-dot'),

  // Verlauf-Buttons
  btnUndo:             document.getElementById('btn-undo'),
  btnRedo:             document.getElementById('btn-redo'),
  btnSeiteLeeren:      document.getElementById('btn-seite-leeren'),

  // Modi-Buttons
  btnLaser:            document.getElementById('btn-laser'),
  btnSpotlight:        document.getElementById('btn-spotlight'),
  btnLehrerLayer:      document.getElementById('btn-lehrer-layer'),

  // Lehrer-Layer Icons
  iconAugeAuf:         document.getElementById('icon-auge-auf'),
  iconAugeZu:          document.getElementById('icon-auge-zu'),

  // Spotlight
  spotlightOverlay:    document.getElementById('spotlight-overlay'),
  spotlightFenster:    document.getElementById('spotlight-fenster'),
  spotlightMaske:      document.getElementById('spotlight-maske'),
  btnSpotlightRechteck: document.getElementById('btn-spotlight-rechteck'),
  btnSpotlightOval:    document.getElementById('btn-spotlight-oval'),
  btnSpotlightSchliessen: document.getElementById('btn-spotlight-schliessen'),

  // Sidebar
  btnSidebarWechsel:   document.getElementById('btn-sidebar-wechsel'),

  // Toast & Lade-Overlay
  toast:               document.getElementById('toast'),
  ladeOverlay:         document.getElementById('lade-overlay'),
  ladeText:            document.getElementById('lade-text'),
};


/* ═══════════════════════════════════════════════════════════════════
   4. HILFSFUNKTIONEN
════════════════════════════════════════════════════════════════════ */

/**
 * Zeigt eine kurze Toast-Meldung am unteren Bildschirmrand.
 *
 * @param {string} nachricht - Anzuzeigender Text
 * @param {'info'|'erfolg'|'fehler'} typ - Visueller Stil
 * @param {number} dauerMs - Anzeigedauer in Millisekunden (Standard: 2500)
 */
function toastZeigen(nachricht, typ = 'info', dauerMs = 2500) {
  const el = dom.toast;
  // Bestehende Klassen entfernen
  el.className = 'toast';
  el.textContent = nachricht;

  // Sichtbar machen
  requestAnimationFrame(() => {
    el.classList.add('sichtbar', typ);
  });

  // Nach Ablauf der Dauer ausblenden
  clearTimeout(toastZeigen._timeout);
  toastZeigen._timeout = setTimeout(() => {
    el.classList.remove('sichtbar');
  }, dauerMs);
}

/**
 * Zeigt oder versteckt den Lade-Indikator.
 *
 * @param {boolean} sichtbar - true = anzeigen, false = verstecken
 * @param {string} text - Beschreibungstext neben dem Spinner
 */
function ladeAnzeige(sichtbar, text = 'Laden…') {
  dom.ladeOverlay.style.display = sichtbar ? 'flex' : 'none';
  dom.ladeOverlay.setAttribute('aria-hidden', sichtbar ? 'false' : 'true');
  dom.ladeText.textContent = text;
}

/**
 * Gibt die Touch- oder Maus-Koordinaten relativ zu einem Canvas-Element zurück.
 * Berücksichtigt den Skalierungsfaktor (devicePixelRatio + PDF-Zoom).
 *
 * @param {TouchEvent|MouseEvent} ereignis - Das Browser-Ereignis
 * @param {HTMLCanvasElement} canvas - Das Ziel-Canvas
 * @returns {{ x: number, y: number }} Koordinaten in Canvas-Pixeln
 */
function koordinatenErmitteln(ereignis, canvas) {
  const rect = canvas.getBoundingClientRect();
  let clientX, clientY;

  // Touch-Ereignis (iPad, Apple Pencil)
  if (ereignis.touches && ereignis.touches.length > 0) {
    clientX = ereignis.touches[0].clientX;
    clientY = ereignis.touches[0].clientY;
  } else if (ereignis.changedTouches && ereignis.changedTouches.length > 0) {
    // touchend liefert changedTouches
    clientX = ereignis.changedTouches[0].clientX;
    clientY = ereignis.changedTouches[0].clientY;
  } else {
    // Maus-Ereignis (Desktop-Vorschau)
    clientX = ereignis.clientX;
    clientY = ereignis.clientY;
  }

  // Skalierung: CSS-Größe kann vom Canvas-Pixel-Raum abweichen
  const skalierungX = canvas.width  / rect.width;
  const skalierungY = canvas.height / rect.height;

  return {
    x: (clientX - rect.left) * skalierungX,
    y: (clientY - rect.top)  * skalierungY,
  };
}

/**
 * Gibt den 2D-Context des Zeichen-Canvas für eine bestimmte Seite zurück.
 *
 * @param {number} seite - Seitennummer (1-basiert)
 * @returns {CanvasRenderingContext2D|null}
 */
function zeichenContextFuerSeite(seite) {
  const canvas = document.querySelector(
    `.seite-container[data-seite="${seite}"] .zeichen-canvas`
  );
  return canvas ? canvas.getContext('2d') : null;
}

/**
 * Gibt das Zeichen-Canvas für eine bestimmte Seite zurück.
 *
 * @param {number} seite - Seitennummer (1-basiert)
 * @returns {HTMLCanvasElement|null}
 */
function zeichenCanvasFuerSeite(seite) {
  return document.querySelector(
    `.seite-container[data-seite="${seite}"] .zeichen-canvas`
  );
}

/**
 * Speichert einen Snapshot des aktuellen Zeichen-Canvas in den Undo-Verlauf.
 * Wird vor jedem neuen Strich aufgerufen.
 *
 * @param {number} seite - Seitennummer
 */
function undoSnapshotSpeichern(seite) {
  const canvas = zeichenCanvasFuerSeite(seite);
  if (!canvas) return;

  if (!zustand.undoVerlauf[seite]) zustand.undoVerlauf[seite] = [];
  if (!zustand.redoVerlauf[seite]) zustand.redoVerlauf[seite] = [];

  // Canvas-Daten als DataURL speichern (verlustfreies PNG)
  zustand.undoVerlauf[seite].push(canvas.toDataURL());

  // Redo-Stack bei neuem Strich leeren
  zustand.redoVerlauf[seite] = [];

  // Maximal 30 Undo-Schritte pro Seite speichern (Speicher-Limit)
  if (zustand.undoVerlauf[seite].length > 30) {
    zustand.undoVerlauf[seite].shift();
  }
}

/**
 * Stellt den letzten Canvas-Zustand wieder her (Undo).
 */
function undoAusfuehren() {
  const seite = zustand.aktiveSeite;
  const verlauf = zustand.undoVerlauf[seite];
  if (!verlauf || verlauf.length === 0) {
    toastZeigen('Kein weiterer Schritt rückgängig zu machen.', 'info', 1500);
    return;
  }

  const canvas = zeichenCanvasFuerSeite(seite);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Aktuellen Zustand in Redo-Stack verschieben
  if (!zustand.redoVerlauf[seite]) zustand.redoVerlauf[seite] = [];
  zustand.redoVerlauf[seite].push(canvas.toDataURL());

  // Letzten Undo-Snapshot wiederherstellen
  const snapshot = verlauf.pop();
  const bild = new Image();
  bild.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bild, 0, 0);
  };
  bild.src = snapshot;
}

/**
 * Wiederholt den zuletzt rückgängig gemachten Schritt (Redo).
 */
function redoAusfuehren() {
  const seite = zustand.aktiveSeite;
  const redoStack = zustand.redoVerlauf[seite];
  if (!redoStack || redoStack.length === 0) {
    toastZeigen('Kein weiterer Schritt wiederherzustellen.', 'info', 1500);
    return;
  }

  const canvas = zeichenCanvasFuerSeite(seite);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Aktuellen Zustand in Undo-Stack verschieben
  if (!zustand.undoVerlauf[seite]) zustand.undoVerlauf[seite] = [];
  zustand.undoVerlauf[seite].push(canvas.toDataURL());

  const snapshot = redoStack.pop();
  const bild = new Image();
  bild.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bild, 0, 0);
  };
  bild.src = snapshot;
}

/**
 * Löscht alle Annotationen der aktuellen Seite (mit Bestätigung).
 */
function seiteLeeren() {
  const seite = zustand.aktiveSeite;
  // Einfache Bestätigung – auf iPad zeigt dies ein natives Modal
  if (!window.confirm(`Alle Annotationen auf Seite ${seite} unwiderruflich löschen?`)) {
    return;
  }

  undoSnapshotSpeichern(seite); // Snapshot vor dem Löschen
  const canvas = zeichenCanvasFuerSeite(seite);
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  zustand.annotationen[seite] = [];
  toastZeigen(`Seite ${seite} geleert.`, 'info');
}


/* ═══════════════════════════════════════════════════════════════════
   5. SIDEBAR-LOGIK
════════════════════════════════════════════════════════════════════ */

/** Alle Werkzeug-Buttons als NodeList für einfaches De-Aktivieren */
const WERKZEUG_BUTTONS = document.querySelectorAll('[data-werkzeug]');

/**
 * Wählt ein Werkzeug aus und aktualisiert den Zustand + UI.
 *
 * @param {string} werkzeugName - Name des Werkzeugs (data-werkzeug Wert)
 */
function werkzeugWaehlen(werkzeugName) {
  zustand.werkzeug = werkzeugName;

  // Alle Werkzeug-Buttons de-aktivieren
  WERKZEUG_BUTTONS.forEach(btn => {
    btn.classList.remove('aktiv');
    btn.setAttribute('aria-pressed', 'false');
  });

  // Ausgewählten Button aktivieren
  const aktivBtn = document.querySelector(`[data-werkzeug="${werkzeugName}"]`);
  if (aktivBtn) {
    aktivBtn.classList.add('aktiv');
    aktivBtn.setAttribute('aria-pressed', 'true');
  }

  // Strichbreite je nach Werkzeug setzen
  switch (werkzeugName) {
    case 'stift-duenn':
      zustand.strichbreite = KONFIGURATION.STIFT_DUENN_PX;
      break;
    case 'stift-dick':
      zustand.strichbreite = KONFIGURATION.STIFT_DICK_PX;
      break;
    case 'textmarker':
      zustand.strichbreite = KONFIGURATION.TEXTMARKER_PX;
      break;
    case 'radierer':
      zustand.strichbreite = KONFIGURATION.RADIERER_PX;
      break;
    case 'laser':
      zustand.strichbreite = KONFIGURATION.LASER_PX;
      break;
  }

  // Cursor aller Zeichen-Canvas aktualisieren
  document.querySelectorAll('.zeichen-canvas').forEach(canvas => {
    canvas.dataset.werkzeug = werkzeugName;
  });
}

/**
 * Wählt eine Zeichenfarbe aus und aktualisiert die Farb-Dots.
 *
 * @param {string} farbe - CSS-Farbwert (z.B. '#e02020')
 */
function farbeWaehlen(farbe) {
  zustand.strichfarbe = farbe;

  // Alle Farb-Dots de-aktivieren
  dom.farbDots.forEach(dot => {
    dot.classList.remove('aktiv');
    dot.setAttribute('aria-pressed', 'false');
  });

  // Passendes Dot aktivieren
  const aktivDot = document.querySelector(`[data-farbe="${farbe}"]`);
  if (aktivDot) {
    aktivDot.classList.add('aktiv');
    aktivDot.setAttribute('aria-pressed', 'true');
  }
}

/**
 * Wechselt die Sidebar zwischen links und rechts.
 */
function sidebarPositionWechseln() {
  const neuePosition = zustand.sidebarPosition === 'left' ? 'right' : 'left';
  zustand.sidebarPosition = neuePosition;
  dom.body.dataset.sidebar = neuePosition;
  toastZeigen(
    neuePosition === 'right' ? 'Sidebar rechts' : 'Sidebar links',
    'info', 1200
  );
}

/**
 * Initialisiert alle Sidebar-Event-Listener.
 */
function sidebarListenersInitialisieren() {

  // Datei-Laden-Buttons → öffnen den nativen Dateiauswähler
  dom.btnDateiLaden.addEventListener('click', () => dom.dateiInput.click());
  dom.btnStartLaden.addEventListener('click', () => dom.dateiInput.click());

  // Datei ausgewählt → PDF laden
  dom.dateiInput.addEventListener('change', (e) => {
    const datei = e.target.files[0];
    if (datei && datei.type === 'application/pdf') {
      pdfLaden(datei);
    }
    // Input zurücksetzen damit die gleiche Datei erneut geladen werden kann
    dom.dateiInput.value = '';
  });

  // Werkzeug-Buttons
  dom.btnStiftDuenn.addEventListener('click', () => werkzeugWaehlen('stift-duenn'));
  dom.btnStiftDick.addEventListener('click',  () => werkzeugWaehlen('stift-dick'));
  dom.btnTextmarker.addEventListener('click', () => werkzeugWaehlen('textmarker'));
  dom.btnRadierer.addEventListener('click',   () => werkzeugWaehlen('radierer'));
  dom.btnLaser.addEventListener('click',      () => werkzeugWaehlen('laser'));

  // Farb-Dots
  dom.farbDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const farbe = dot.dataset.farbe;
      if (farbe) farbeWaehlen(farbe);
    });
  });

  // Verlauf-Buttons
  dom.btnUndo.addEventListener('click',         undoAusfuehren);
  dom.btnRedo.addEventListener('click',         redoAusfuehren);
  dom.btnSeiteLeeren.addEventListener('click',  seiteLeeren);

  // Tastatur-Shortcuts (Strg+Z / Strg+Y)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
  });

  // Spotlight
  dom.btnSpotlight.addEventListener('click', spotlightUmschalten);

  // Lehrer-Layer
  dom.btnLehrerLayer.addEventListener('click', lehrerLayerUmschalten);

  // Speichern
  dom.btnSpeichern.addEventListener('click', pdfSpeichern);

  // Sidebar-Position wechseln
  dom.btnSidebarWechsel.addEventListener('click', sidebarPositionWechseln);
}


/* ═══════════════════════════════════════════════════════════════════
   6. ZEICHEN-ENGINE
   Touch/Maus-Ereignisse → Canvas-Zeichenbefehle
════════════════════════════════════════════════════════════════════ */

/**
 * Konfiguriert den Canvas-Context für das aktuelle Werkzeug.
 * Wird bei jedem Strich-Start aufgerufen.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
function contextKonfigurieren(ctx) {
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.lineWidth  = zustand.strichbreite;

  switch (zustand.werkzeug) {

    case 'textmarker':
      // Echte Marker-Optik: globalCompositeOperation multiply
      // lässt den Text darunter durchscheinen
      ctx.strokeStyle       = KONFIGURATION.TEXTMARKER_FARBE;
      ctx.globalAlpha       = 1;
      ctx.globalCompositeOperation = 'multiply';
      break;

    case 'radierer':
      // Radierer nutzt destination-out um Pixel zu löschen
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle       = 'rgba(0,0,0,1)'; // Farbe egal bei destination-out
      ctx.globalAlpha       = 1;
      break;

    case 'laser':
      ctx.strokeStyle       = KONFIGURATION.LASER_FARBE;
      ctx.globalAlpha       = 0.85;
      ctx.globalCompositeOperation = 'source-over';
      // Leuchteffekt: Äußerer Glow durch shadowBlur
      ctx.shadowBlur        = 12;
      ctx.shadowColor       = KONFIGURATION.LASER_FARBE;
      break;

    default:
      // Standard-Stift (duenn, dick)
      ctx.strokeStyle       = zustand.strichfarbe;
      ctx.globalAlpha       = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur        = 0;
      break;
  }
}

/**
 * Setzt alle Canvas-Eigenschaften auf Standardwerte zurück.
 * Wichtig nach Textmarker und Laser, um keine Artefakte zu erzeugen.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
function contextZuruecksetzen(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha              = 1;
  ctx.shadowBlur               = 0;
}

/**
 * Zeichnet ein Liniensegment vom letzten Punkt zum neuen Punkt.
 * Kernfunktion der Zeichen-Engine.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }} von - Startpunkt
 * @param {{ x: number, y: number }} zu  - Endpunkt
 */
function linieSzeichnen(ctx, von, zu) {
  ctx.beginPath();
  ctx.moveTo(von.x, von.y);
  ctx.lineTo(zu.x, zu.y);
  ctx.stroke();
}

/**
 * Behandelt das Strich-Start-Ereignis (touchstart / mousedown).
 *
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichStarten(e, canvas) {
  e.preventDefault(); // Verhindert Scrollen während des Zeichnens

  // Spotlight verhindert Zeichnen (Spotlight-Interaktion hat Vorrang)
  if (zustand.spotlightAktiv) return;

  zustand.zeichnet    = true;
  const punkt         = koordinatenErmitteln(e, canvas);
  zustand.letzterPunkt = punkt;

  // Snapshot für Undo vor dem ersten Pinselstrich
  const seite = parseInt(canvas.closest('.seite-container').dataset.seite);
  undoSnapshotSpeichern(seite);

  // Neuen Strich im Annotations-Array beginnen
  // (Laser-Striche werden nicht in den Speicher aufgenommen)
  if (zustand.werkzeug !== 'laser' && zustand.werkzeug !== 'radierer') {
    if (!zustand.annotationen[seite]) zustand.annotationen[seite] = [];
    zustand.aktuellerStrich = {
      punkte:  [{ ...punkt }],
      farbe:   zustand.strichfarbe,
      breite:  zustand.strichbreite,
      werkzeug: zustand.werkzeug,
    };
  }

  // Kleinen Punkt zeichnen (auch bei kurzem Tippen)
  const ctx = canvas.getContext('2d');
  contextKonfigurieren(ctx);
  ctx.beginPath();
  ctx.arc(punkt.x, punkt.y, zustand.strichbreite / 2, 0, Math.PI * 2);
  ctx.fill();
  contextZuruecksetzen(ctx);
}

/**
 * Behandelt das Strich-Bewegen-Ereignis (touchmove / mousemove).
 *
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichBewegen(e, canvas) {
  if (!zustand.zeichnet) return;
  e.preventDefault();

  const punkt  = koordinatenErmitteln(e, canvas);
  const ctx    = canvas.getContext('2d');

  contextKonfigurieren(ctx);
  linieSzeichnen(ctx, zustand.letzterPunkt, punkt);
  contextZuruecksetzen(ctx);

  // Punkt im aktuellen Strich speichern (nicht für Laser/Radierer)
  if (zustand.aktuellerStrich) {
    zustand.aktuellerStrich.punkte.push({ ...punkt });
  }

  zustand.letzterPunkt = punkt;
}

/**
 * Behandelt das Strich-Ende-Ereignis (touchend / mouseup).
 *
 * @param {TouchEvent|MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function strichBeenden(e, canvas) {
  if (!zustand.zeichnet) return;
  e.preventDefault();

  zustand.zeichnet = false;

  // Fertigen Strich in den Annotations-Speicher übernehmen
  if (zustand.aktuellerStrich) {
    const seite = parseInt(canvas.closest('.seite-container').dataset.seite);
    if (!zustand.annotationen[seite]) zustand.annotationen[seite] = [];
    zustand.annotationen[seite].push(zustand.aktuellerStrich);
    zustand.aktuellerStrich = null;
  }

  // Laser: Strich nach Timeout ausblenden
  if (zustand.werkzeug === 'laser') {
    laserStrichAusblenden(canvas);
  }

  zustand.letzterPunkt = null;
}

/**
 * Blendet den letzten Laser-Strich nach dem konfigurierten Timeout aus.
 * Technik: Canvas wird in ein Bild konvertiert, gelöscht, und das Bild
 * mit Animation wieder zurückgezeichnet.
 *
 * @param {HTMLCanvasElement} canvas
 */
function laserStrichAusblenden(canvas) {
  // Snapshot des aktuellen Canvas-Inhalts
  const snapshot = canvas.toDataURL();
  const ctx = canvas.getContext('2d');

  const timeout = setTimeout(() => {
    // Bild laden und mit sinkender Opazität wieder zeichnen
    const bild = new Image();
    bild.onload = () => {
      // Canvas leeren
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Bild mit reduzierter Opazität neu zeichnen
      ctx.globalAlpha = 0.6;
      ctx.drawImage(bild, 0, 0);
      ctx.globalAlpha = 1;

      // Nach kurzer Zeit komplett löschen
      setTimeout(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }, 400);
    };
    bild.src = snapshot;
  }, KONFIGURATION.LASER_TIMEOUT_MS);

  // Timeout-ID für mögliche spätere Löschung speichern
  zustand.laserTimeouts.push(timeout);
}

/**
 * Registriert alle Touch- und Maus-Listener für ein Zeichen-Canvas.
 * Wird aufgerufen sobald eine neue Seite ins DOM eingefügt wird.
 *
 * @param {HTMLCanvasElement} canvas
 */
function zeichenListenersRegistrieren(canvas) {
  // Touch-Ereignisse (iPad, Apple Pencil)
  canvas.addEventListener('touchstart',  e => strichStarten(e, canvas),  { passive: false });
  canvas.addEventListener('touchmove',   e => strichBewegen(e, canvas),  { passive: false });
  canvas.addEventListener('touchend',    e => strichBeenden(e, canvas),  { passive: false });
  canvas.addEventListener('touchcancel', e => strichBeenden(e, canvas),  { passive: false });

  // Maus-Ereignisse (Desktop-Vorschau)
  canvas.addEventListener('mousedown',   e => strichStarten(e, canvas));
  canvas.addEventListener('mousemove',   e => strichBewegen(e, canvas));
  canvas.addEventListener('mouseup',     e => strichBeenden(e, canvas));
  canvas.addEventListener('mouseleave',  e => {
    if (zustand.zeichnet) strichBeenden(e, canvas);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   7. LEHRER-LAYER
   Zweiter, unabhängiger Annotations-Layer der ein- und ausgeblendet
   werden kann, ohne die Schüler-Annotationen zu beeinflussen.
════════════════════════════════════════════════════════════════════ */

/**
 * Schaltet den Lehrer-Layer ein oder aus.
 * Bei Aktivierung: Lehrer-Annotationen werden gezeichnet.
 * Bei Deaktivierung: Canvas wird geleert, aber Daten bleiben erhalten.
 */
function lehrerLayerUmschalten() {
  zustand.lehrerLayerAktiv = !zustand.lehrerLayerAktiv;
  const aktiv = zustand.lehrerLayerAktiv;

  // Button-Zustand aktualisieren
  dom.btnLehrerLayer.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
  dom.btnLehrerLayer.classList.toggle('aktiv', aktiv);

  // Augen-Icon tauschen
  dom.iconAugeAuf.style.display = aktiv ? 'block' : 'none';
  dom.iconAugeZu.style.display  = aktiv ? 'none'  : 'block';

  // Alle Lehrer-Canvas-Elemente aktualisieren
  document.querySelectorAll('.lehrer-canvas').forEach((canvas, index) => {
    const seite = index + 1;
    const ctx   = canvas.getContext('2d');

    if (aktiv) {
      // Lehrer-Annotationen zeichnen
      lehrerAnnotationenZeichnen(seite, ctx, canvas);
    } else {
      // Canvas leeren (Daten bleiben in zustand.lehrerAnnotationen erhalten!)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  toastZeigen(
    aktiv ? 'Lehrer-Layer aktiv' : 'Lehrer-Layer ausgeblendet',
    'info', 1500
  );
}

/**
 * Zeichnet alle gespeicherten Lehrer-Annotationen einer Seite auf den Canvas.
 *
 * @param {number} seite
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
function lehrerAnnotationenZeichnen(seite, ctx, canvas) {
  const striche = zustand.lehrerAnnotationen[seite];
  if (!striche || striche.length === 0) return;

  striche.forEach(strich => {
    if (!strich.punkte || strich.punkte.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle  = strich.farbe;
    ctx.lineWidth    = strich.breite;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';
    ctx.globalAlpha  = 0.7; // Lehrer-Layer leicht transparent damit Unterschied sichtbar

    ctx.moveTo(strich.punkte[0].x, strich.punkte[0].y);
    strich.punkte.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  });

  ctx.globalAlpha = 1;
}

/**
 * Erstellt einen Lehrer-Canvas für eine Seite und fügt ihn ein.
 * Wird von pdfSeiteRendern() nach dem Zeichen-Canvas aufgerufen.
 *
 * @param {HTMLElement} seitenContainer
 * @param {number} breite - Canvas-Breite in Pixel
 * @param {number} hoehe  - Canvas-Höhe in Pixel
 */
function lehrerCanvasErstellen(seitenContainer, breite, hoehe) {
  const canvas       = document.createElement('canvas');
  canvas.className   = 'lehrer-canvas';
  canvas.width       = breite;
  canvas.height      = hoehe;
  canvas.setAttribute('aria-hidden', 'true');
  seitenContainer.appendChild(canvas);
  return canvas;
}


/* ═══════════════════════════════════════════════════════════════════
   8. SPOTLIGHT-MECHANIK
   Dunkle Abdunkelung mit transparentem Fokus-Fenster.
   Das Fenster kann per Touch gezogen und in der Größe verändert werden.
════════════════════════════════════════════════════════════════════ */

/**
 * Schaltet das Spotlight ein oder aus.
 */
function spotlightUmschalten() {
  zustand.spotlightAktiv = !zustand.spotlightAktiv;
  const aktiv = zustand.spotlightAktiv;

  dom.spotlightOverlay.style.display = aktiv ? 'block' : 'none';
  dom.spotlightOverlay.setAttribute('aria-hidden', aktiv ? 'false' : 'true');
  dom.btnSpotlight.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
  dom.btnSpotlight.classList.toggle('aktiv', aktiv);

  if (aktiv) {
    // Startposition: zentriert im sichtbaren Bereich
    const vp = {
      b: window.innerWidth,
      h: window.innerHeight,
    };
    zustand.spotlightFenster = {
      x: (vp.b - KONFIGURATION.SPOTLIGHT_START_B) / 2,
      y: (vp.h - KONFIGURATION.SPOTLIGHT_START_H) / 2,
      b: KONFIGURATION.SPOTLIGHT_START_B,
      h: KONFIGURATION.SPOTLIGHT_START_H,
    };
    spotlightPositionAktualisieren();
    toastZeigen('Spotlight aktiv – ziehen zum Bewegen', 'info', 2000);
  }
}

/**
 * Aktualisiert die CSS-Position und -Größe des Spotlight-Fensters.
 * Nutzt clip-path auf der Maske um das "Loch" zu erzeugen.
 */
function spotlightPositionAktualisieren() {
  const f  = zustand.spotlightFenster;
  const el = dom.spotlightFenster;

  el.style.left   = `${f.x}px`;
  el.style.top    = `${f.y}px`;
  el.style.width  = `${f.b}px`;
  el.style.height = `${f.h}px`;

  // Oval oder Rechteck
  el.classList.toggle('oval', zustand.spotlightForm === 'oval');

  // Maske: dunkler Bereich mit Loch durch CSS clip-path (polygon / ellipse)
  // Technik: clip-path "invertiert" durch zwei überlagerte clip-paths
  // Einfachere Technik: box-shadow auf dem Fenster-Element
  const maske = dom.spotlightMaske;

  if (zustand.spotlightForm === 'oval') {
    // Ellipse aus dem dunklen Bereich herausschneiden
    const rx = f.b / 2;
    const ry = f.h / 2;
    const cx = f.x + rx;
    const cy = f.y + ry;
    maske.style.clipPath = `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${cx - rx}px ${cy}px
    )`;
    // Für Oval nutzen wir SVG-Mask-Technik via backdrop
    maske.style.webkitMaskImage = `
      radial-gradient(
        ellipse ${rx}px ${ry}px at ${cx}px ${cy}px,
        transparent 99%,
        black 100%
      )
    `;
    maske.style.maskImage = maske.style.webkitMaskImage;
  } else {
    // Rechteck: einfache polygon-Maske
    maske.style.webkitMaskImage = `
      linear-gradient(black, black),
      linear-gradient(black, black)
    `;
    maske.style.webkitMaskImage = 'none';
    maske.style.maskImage       = 'none';

    // Für Rechteck nutzen wir 4-Eck-Polygon mit Loch via SVG clip
    const x1 = f.x, y1 = f.y;
    const x2 = f.x + f.b, y2 = f.y + f.h;
    const W  = window.innerWidth, H = window.innerHeight;

    // Clip-Path: Äußeres Rechteck minus inneres Rechteck
    maske.style.clipPath = `polygon(
      0px 0px,
      ${W}px 0px,
      ${W}px ${H}px,
      0px ${H}px,
      0px 0px,
      ${x1}px ${y1}px,
      ${x1}px ${y2}px,
      ${x2}px ${y2}px,
      ${x2}px ${y1}px,
      ${x1}px ${y1}px
    )`;
  }
}

/**
 * Ermittelt ob ein Touch-Punkt im Spotlight-Fenster liegt (zum Bewegen)
 * oder am Rand (zum Größenändern).
 *
 * @param {number} touchX - Touch-X-Koordinate (window-relativ)
 * @param {number} touchY - Touch-Y-Koordinate (window-relativ)
 * @returns {'bewegen'|'groesse'|null}
 */
function spotlightAktionErmitteln(touchX, touchY) {
  const f      = zustand.spotlightFenster;
  const randPx = 30; // Pixel-Breite des Größenänderungs-Rands

  const inFenster = touchX >= f.x && touchX <= f.x + f.b &&
                    touchY >= f.y && touchY <= f.y + f.h;

  if (!inFenster) return null;

  // Rand-Zone → Größe ändern
  const amRand = touchX <= f.x + randPx   ||
                 touchX >= f.x + f.b - randPx ||
                 touchY <= f.y + randPx   ||
                 touchY >= f.y + f.h - randPx;

  return amRand ? 'groesse' : 'bewegen';
}

/**
 * Initialisiert alle Touch-Listener für das Spotlight-Overlay.
 */
function spotlightListenersInitialisieren() {
  const overlay = dom.spotlightOverlay;

  // ── Touch-Start ────────────────────────────────────────────────
  overlay.addEventListener('touchstart', e => {
    if (!zustand.spotlightAktiv) return;
    e.preventDefault();

    const t = e.touches[0];
    const aktion = spotlightAktionErmitteln(t.clientX, t.clientY);
    zustand.spotlightAktion = aktion;

    if (aktion === 'bewegen') {
      // Offset des Touch-Punkts relativ zur Fenster-Ecke merken
      zustand.spotlightStartTouchOffset = {
        dx: t.clientX - zustand.spotlightFenster.x,
        dy: t.clientY - zustand.spotlightFenster.y,
      };
    } else if (aktion === 'groesse') {
      zustand.spotlightStartTouchOffset = {
        startX:  t.clientX,
        startY:  t.clientY,
        startB:  zustand.spotlightFenster.b,
        startH:  zustand.spotlightFenster.h,
        startFX: zustand.spotlightFenster.x,
        startFY: zustand.spotlightFenster.y,
      };
    }
  }, { passive: false });

  // ── Touch-Move ─────────────────────────────────────────────────
  overlay.addEventListener('touchmove', e => {
    if (!zustand.spotlightAktiv) return;
    e.preventDefault();

    const t = e.touches[0];

    if (zustand.spotlightAktion === 'bewegen' && zustand.spotlightStartTouchOffset) {
      // Fenster verschieben
      zustand.spotlightFenster.x = t.clientX - zustand.spotlightStartTouchOffset.dx;
      zustand.spotlightFenster.y = t.clientY - zustand.spotlightStartTouchOffset.dy;

      // Fenster nicht außerhalb des Bildschirms lassen
      const f = zustand.spotlightFenster;
      f.x = Math.max(0, Math.min(f.x, window.innerWidth  - f.b));
      f.y = Math.max(0, Math.min(f.y, window.innerHeight - f.h));

    } else if (zustand.spotlightAktion === 'groesse' && zustand.spotlightStartTouchOffset) {
      // Größe des Fensters ändern
      const s = zustand.spotlightStartTouchOffset;
      const deltaX = t.clientX - s.startX;
      const deltaY = t.clientY - s.startY;

      zustand.spotlightFenster.b = Math.max(
        KONFIGURATION.SPOTLIGHT_MIN_BREITE,
        s.startB + deltaX
      );
      zustand.spotlightFenster.h = Math.max(
        KONFIGURATION.SPOTLIGHT_MIN_HOEHE,
        s.startH + deltaY
      );
    }

    spotlightPositionAktualisieren();
  }, { passive: false });

  // ── Touch-End ──────────────────────────────────────────────────
  overlay.addEventListener('touchend', e => {
    e.preventDefault();
    zustand.spotlightAktion = null;
    zustand.spotlightStartTouchOffset = null;
  }, { passive: false });

  // ── Maus-Unterstützung (Desktop-Vorschau) ─────────────────────
  let mausTaste = false;
  overlay.addEventListener('mousedown', e => {
    if (!zustand.spotlightAktiv) return;
    mausTaste = true;
    const aktion = spotlightAktionErmitteln(e.clientX, e.clientY);
    zustand.spotlightAktion = aktion;

    if (aktion === 'bewegen') {
      zustand.spotlightStartTouchOffset = {
        dx: e.clientX - zustand.spotlightFenster.x,
        dy: e.clientY - zustand.spotlightFenster.y,
      };
    } else if (aktion === 'groesse') {
      zustand.spotlightStartTouchOffset = {
        startX:  e.clientX, startY: e.clientY,
        startB:  zustand.spotlightFenster.b,
        startH:  zustand.spotlightFenster.h,
        startFX: zustand.spotlightFenster.x,
        startFY: zustand.spotlightFenster.y,
      };
    }
  });

  document.addEventListener('mousemove', e => {
    if (!mausTaste || !zustand.spotlightAktiv) return;
    if (zustand.spotlightAktion === 'bewegen' && zustand.spotlightStartTouchOffset) {
      zustand.spotlightFenster.x = e.clientX - zustand.spotlightStartTouchOffset.dx;
      zustand.spotlightFenster.y = e.clientY - zustand.spotlightStartTouchOffset.dy;
      const f = zustand.spotlightFenster;
      f.x = Math.max(0, Math.min(f.x, window.innerWidth  - f.b));
      f.y = Math.max(0, Math.min(f.y, window.innerHeight - f.h));
    } else if (zustand.spotlightAktion === 'groesse' && zustand.spotlightStartTouchOffset) {
      const s = zustand.spotlightStartTouchOffset;
      zustand.spotlightFenster.b = Math.max(KONFIGURATION.SPOTLIGHT_MIN_BREITE, s.startB + (e.clientX - s.startX));
      zustand.spotlightFenster.h = Math.max(KONFIGURATION.SPOTLIGHT_MIN_HOEHE,  s.startH + (e.clientY - s.startY));
    }
    spotlightPositionAktualisieren();
  });

  document.addEventListener('mouseup', () => {
    mausTaste = false;
    zustand.spotlightAktion = null;
    zustand.spotlightStartTouchOffset = null;
  });

  // ── Spotlight-Toolbar-Buttons ──────────────────────────────────
  dom.btnSpotlightRechteck.addEventListener('click', () => {
    zustand.spotlightForm = 'rechteck';
    dom.btnSpotlightRechteck.classList.add('aktiv');
    dom.btnSpotlightRechteck.setAttribute('aria-pressed', 'true');
    dom.btnSpotlightOval.classList.remove('aktiv');
    dom.btnSpotlightOval.setAttribute('aria-pressed', 'false');
    spotlightPositionAktualisieren();
  });

  dom.btnSpotlightOval.addEventListener('click', () => {
    zustand.spotlightForm = 'oval';
    dom.btnSpotlightOval.classList.add('aktiv');
    dom.btnSpotlightOval.setAttribute('aria-pressed', 'true');
    dom.btnSpotlightRechteck.classList.remove('aktiv');
    dom.btnSpotlightRechteck.setAttribute('aria-pressed', 'false');
    spotlightPositionAktualisieren();
  });

  dom.btnSpotlightSchliessen.addEventListener('click', () => {
    spotlightUmschalten(); // Spotlight ausschalten
  });
}


/* ═══════════════════════════════════════════════════════════════════
   9. PDF-RENDERING (STUB)
   Diese Funktionen werden im nächsten Schritt vollständig implementiert.
   Hier: Grundstruktur und DOM-Aufbau.
════════════════════════════════════════════════════════════════════ */

/**
 * Lädt eine PDF-Datei und startet den Render-Prozess.
 *
 * @param {File} datei - Die ausgewählte PDF-Datei
 */
async function pdfLaden(datei) {
  ladeAnzeige(true, 'PDF wird geladen…');

  try {
    // Datei als ArrayBuffer einlesen (für pdf.js und späteres pdf-lib Speichern)
    const arrayBuffer = await datei.arrayBuffer();
    zustand.originalDateiBytes = arrayBuffer.slice(0); // Kopie für Speichern

    // pdf.js Worker konfigurieren
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER_URL;

      // PDF-Dokument laden
      const ladeTask = pdfjsLib.getDocument({ data: arrayBuffer });
      zustand.pdfDokument   = await ladeTask.promise;
      zustand.seitenAnzahl  = zustand.pdfDokument.numPages;

      // Benutzeroberfläche vorbereiten
      dom.startAnzeige.style.display  = 'none';
      dom.pdfContainer.style.display  = 'flex';
      dom.pdfContainer.innerHTML      = ''; // Vorherige Seiten leeren
      zustand.annotationen            = {}; // Annotationen zurücksetzen
      zustand.undoVerlauf             = {};
      zustand.redoVerlauf             = {};
      zustand.lehrerAnnotationen      = {};

      // Alle Seiten sequenziell rendern
      for (let i = 1; i <= zustand.seitenAnzahl; i++) {
        ladeAnzeige(true, `Seite ${i} von ${zustand.seitenAnzahl} wird gerendert…`);
        await pdfSeiteRendern(i);
      }

      toastZeigen(
        `"${datei.name}" geladen (${zustand.seitenAnzahl} Seiten)`,
        'erfolg'
      );
    } else {
      // pdf.js noch nicht geladen (offline / CDN-Fehler)
      pdfVorschauErstellen(datei.name, datei.size);
      toastZeigen('PDF-Bibliothek geladen – Vorschau-Modus', 'info');
    }

  } catch (fehler) {
    console.error('[EduLayer] PDF-Ladefehler:', fehler);
    toastZeigen('Fehler beim Laden der PDF.', 'fehler');
  } finally {
    ladeAnzeige(false);
  }
}

/**
 * Rendert eine einzelne PDF-Seite auf ein Canvas-Paar (PDF + Zeichen).
 * Verknüpft die Koordinatensysteme so dass Annotationen nie driften.
 *
 * @param {number} seitenNummer - 1-basierte Seitennummer
 */
async function pdfSeiteRendern(seitenNummer) {
  const seite      = await zustand.pdfDokument.getPage(seitenNummer);
  const viewport   = seite.getViewport({ scale: KONFIGURATION.PDF_RENDER_SCALE });

  // ── Container für diese Seite erstellen ─────────────────────
  const container          = document.createElement('div');
  container.className      = 'seite-container';
  container.dataset.seite  = seitenNummer;
  container.style.width    = `${viewport.width}px`;
  container.style.height   = `${viewport.height}px`;

  // ── PDF-Render-Canvas (Hintergrund) ─────────────────────────
  const pdfCanvas       = document.createElement('canvas');
  pdfCanvas.className   = 'pdf-canvas';
  pdfCanvas.width       = viewport.width;
  pdfCanvas.height      = viewport.height;
  // CSS-Größe = Canvas-Pixel-Größe (1:1, kein Stretching!)
  pdfCanvas.style.width  = `${viewport.width}px`;
  pdfCanvas.style.height = `${viewport.height}px`;
  container.appendChild(pdfCanvas);

  // ── Zeichen-Canvas (transparent, liegt oben) ─────────────────
  const zeichenCanvas       = document.createElement('canvas');
  zeichenCanvas.className   = 'zeichen-canvas';
  zeichenCanvas.width       = viewport.width;
  zeichenCanvas.height      = viewport.height;
  zeichenCanvas.dataset.werkzeug = zustand.werkzeug;
  container.appendChild(zeichenCanvas);

  // ── Lehrer-Canvas (dritten Layer, pointer-events:none) ────────
  lehrerCanvasErstellen(container, viewport.width, viewport.height);

  // Container in den PDF-Container einfügen
  dom.pdfContainer.appendChild(container);

  // ── Seite rendern ────────────────────────────────────────────
  const renderContext = {
    canvasContext: pdfCanvas.getContext('2d'),
    viewport:      viewport,
  };
  await seite.render(renderContext).promise;

  // ── Touch-Listener für diesen Canvas registrieren ────────────
  zeichenListenersRegistrieren(zeichenCanvas);

  // ── Intersection Observer: Aktive Seite verfolgen ────────────
  //    Wird für Undo/Redo-Seiten-Tracking genutzt
  const beobachter = new IntersectionObserver(eintraege => {
    eintraege.forEach(eintrag => {
      if (eintrag.isIntersecting && eintrag.intersectionRatio > 0.5) {
        zustand.aktiveSeite = seitenNummer;
      }
    });
  }, { threshold: 0.5 });
  beobachter.observe(container);
}

/**
 * Erstellt eine einfache Vorschau wenn pdf.js nicht verfügbar ist
 * (z.B. beim ersten Offline-Start bevor der Service Worker aktiv ist).
 *
 * @param {string} dateiName
 * @param {number} dateiGroesse
 */
function pdfVorschauErstellen(dateiName, dateiGroesse) {
  dom.startAnzeige.style.display = 'none';
  dom.pdfContainer.style.display = 'flex';
  dom.pdfContainer.innerHTML     = `
    <div style="
      background: white;
      width: 600px;
      min-height: 800px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 16px;
      color: #333;
      border-radius: 2px;
    ">
      <div style="font-size:48px">📄</div>
      <h2 style="font-size:20px; font-weight:600">${dateiName}</h2>
      <p style="font-size:14px; color:#666">
        ${(dateiGroesse / 1024).toFixed(1)} KB
      </p>
      <p style="font-size:13px; color:#999; text-align:center; max-width:280px">
        PDF-Rendering wird beim nächsten Start verfügbar sein,<br>
        wenn der Service Worker aktiv ist.
      </p>
    </div>
  `;

  // Trotzdem einen Zeichen-Canvas erstellen für Demo-Zwecke
  const demoContainer = dom.pdfContainer.querySelector('div');
  if (demoContainer) {
    demoContainer.style.position = 'relative';
    const demoCanvas = document.createElement('canvas');
    demoCanvas.className = 'zeichen-canvas';
    demoCanvas.width     = 600;
    demoCanvas.height    = 800;
    demoCanvas.dataset.seite = '1';
    demoCanvas.dataset.werkzeug = zustand.werkzeug;
    demoContainer.appendChild(demoCanvas);
    zeichenListenersRegistrieren(demoCanvas);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   10. PDF-EXPORT (STUB)
   Vollständige Implementierung mit pdf-lib im nächsten Schritt.
════════════════════════════════════════════════════════════════════ */

/**
 * Speichert das aktuelle PDF mit allen Annotationen.
 * Annotationen werden als native PDF-Vektordaten eingebettet.
 */
async function pdfSpeichern() {
  if (!zustand.originalDateiBytes) {
    toastZeigen('Keine PDF geladen.', 'fehler');
    return;
  }

  ladeAnzeige(true, 'PDF wird gespeichert…');

  try {
    // ── VOLLSTÄNDIGE IMPLEMENTIERUNG IM NÄCHSTEN SCHRITT ────────
    // Hier wird pdf-lib verwendet um:
    // 1. Das Original-PDF zu laden (zustand.originalDateiBytes)
    // 2. Für jede Seite die Canvas-Zeichnungen als SVG-Pfade zu konvertieren
    // 3. Die Pfade als native PDF-Annotationen einzubetten
    // 4. Das fertige PDF als Byte-Array zu exportieren
    // 5. Als Download-Link anzubieten

    // ── AKTUELL: Canvas-Screenshot-Fallback ─────────────────────
    // Lädt den ersten Zeichen-Canvas als PNG herunter (Demo-Version)
    const ersterZeichenCanvas = document.querySelector('.zeichen-canvas');
    if (ersterZeichenCanvas) {
      const link       = document.createElement('a');
      link.download    = 'EduLayer-Annotation.png';
      link.href        = ersterZeichenCanvas.toDataURL('image/png');
      link.click();
      toastZeigen('Vorschau gespeichert (PNG). PDF-Export folgt.', 'info');
    } else {
      toastZeigen('Keine Annotationen vorhanden.', 'info');
    }

  } catch (fehler) {
    console.error('[EduLayer] Speicherfehler:', fehler);
    toastZeigen('Fehler beim Speichern.', 'fehler');
  } finally {
    ladeAnzeige(false);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   11. SERVICE WORKER (PWA-OFFLINE-FÄHIGKEIT)
════════════════════════════════════════════════════════════════════ */

/**
 * Registriert den Service Worker für Offline-Nutzung.
 * Nach der ersten erfolgreichen Registrierung funktioniert die App
 * vollständig ohne Internetverbindung.
 */
function serviceWorkerRegistrieren() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js');
        console.log('[EduLayer] Service Worker registriert:', registration.scope);

        // Auf Updates prüfen (wenn App schon installiert ist)
        registration.addEventListener('updatefound', () => {
          const neuerWorker = registration.installing;
          neuerWorker.addEventListener('statechange', () => {
            if (neuerWorker.state === 'installed' && navigator.serviceWorker.controller) {
              toastZeigen('Update verfügbar – Seite neu laden um zu aktualisieren.', 'info', 5000);
            }
          });
        });

      } catch (fehler) {
        // Service Worker konnte nicht registriert werden (passiert bei
        // file://-Protokoll oder manchen Browser-Einstellungen)
        console.warn('[EduLayer] Service Worker Registrierung fehlgeschlagen:', fehler);
      }
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════
   12. APP-START
   Initialisierung der gesamten Anwendung.
════════════════════════════════════════════════════════════════════ */

/**
 * Hauptinitialisierungsfunktion.
 * Wird beim Laden der Seite automatisch aufgerufen.
 */
function appInitialisieren() {
  console.log('[EduLayer] App wird initialisiert…');

  // ── Event-Listener registrieren ────────────────────────────────
  sidebarListenersInitialisieren();
  spotlightListenersInitialisieren();

  // ── Standard-Werkzeug aktivieren ───────────────────────────────
  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);

  // ── Service Worker für Offline-Nutzung registrieren ────────────
  serviceWorkerRegistrieren();

  // ── iOS: Verhindert "Gummiband"-Scrollen der ganzen Seite ──────
  document.addEventListener('touchmove', e => {
    // Nur im Hauptbereich (nicht in der Sidebar) scrollen erlauben
    if (!e.target.closest('.hauptbereich') && !e.target.closest('.spotlight-overlay')) {
      e.preventDefault();
    }
  }, { passive: false });

  // ── Orientierungswechsel: Canvas-Größen anpassen ──────────────
  window.addEventListener('orientationchange', () => {
    // Kurze Verzögerung damit iOS die neue Viewport-Größe meldet
    setTimeout(() => {
      if (zustand.spotlightAktiv) {
        spotlightPositionAktualisieren();
      }
      // Canvas-Skalierung wird beim nächsten pdfLaden() aktualisiert
    }, 300);
  });

  // ── Drag-and-Drop: PDF direkt in die App ziehen ───────────────
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const datei = e.dataTransfer.files[0];
    if (datei && datei.type === 'application/pdf') {
      pdfLaden(datei);
    }
  });

  console.log('[EduLayer] Bereit.');
}

// ── App starten wenn DOM vollständig geladen ist ─────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appInitialisieren);
} else {
  appInitialisieren();
}
