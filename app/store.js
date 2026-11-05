/* KHOREI — kreator stopek mailowych
   Dane: projekty w IndexedDB przeglądarki (mieszczą fonty i obrazki — localStorage ma za mały limit),
   domyślny projekt, migracje. */

const DB = 'khorei-stopki', STORE = 'projects', VERSION = 1;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export const db = {
  all: () => tx('readonly', s => s.getAll()),
  put: p => tx('readwrite', s => s.put(p)),
  del: id => tx('readwrite', s => s.delete(id)),
};

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

/* Nowy projekt: neutralny szablon, który od razu pokazuje możliwości */
export function newProject(name = 'Nowa stopka') {
  const fSans = uid('f'), fMono = uid('f');
  return {
    v: 1, id: uid('p'), name, updated: Date.now(),
    brand: {
      colorText: '#1b1b1b', colorMuted: '#77776f',
      dark: { colorText: '#ffffff', colorMuted: '#b9b9b2' },
      web: 'twojafirma.pl', domain: 'twojafirma.pl',
    },
    fonts: [
      { id: fSans, family: 'Krój główny', file: null, url: '', fallback: 'sans', fallbackCustom: '' },
      { id: fMono, family: 'Krój klauzuli', file: null, url: '', fallback: 'mono', fallbackCustom: '' },
    ],
    images: [],
    hosting: { base: '' },
    layout: { mode: 'fluid', maxWidth: 600, gmailWidth: 288, typo: true },
    blocks: [
      { id: uid('b'), type: 'person', font: fSans, size: 13, lh: 17, color: 'text', weight: 700, showRole: true, space: 20 },
      { id: uid('b'), type: 'image', image: '', width: 160, link: 'web', space: 20 },
      { id: uid('b'), type: 'contact', font: fSans, size: 12, lh: 16, color: 'text', items: { phone: true, email: true, web: true }, inline: false, space: 16 },
      { id: uid('b'), type: 'divider', full: false, width: 40, thick: 1, color: 'muted', space: 12 },
      { id: uid('b'), type: 'text', font: fMono, size: 8, lh: 11, color: 'muted', upper: true, ls: 0, wrap: false, space: 0,
        content: 'Treść tej wiadomości wraz z załącznikami jest poufna i przeznaczona wyłącznie dla adresata. Jeśli wiadomość trafiła do Ciebie przez pomyłkę, poinformuj nadawcę i usuń ją.' },
    ],
    people: [
      { id: uid('o'), name: 'Imię Nazwisko', role: 'Stanowisko', phone: '+48 600 000 000', email: 'imie@twojafirma.pl' },
    ],
  };
}

export function migrate(p) {
  // miejsce na przyszłe zmiany formatu (p.v)
  p.layout = { mode: 'fluid', maxWidth: 600, gmailWidth: 288, typo: true, ...(p.layout || {}) };
  p.hosting = { base: '', ...(p.hosting || {}) };
  p.brand.dark = { colorText: '#ffffff', colorMuted: '#b9b9b2', ...(p.brand.dark || {}) };
  p.images ||= []; p.fonts ||= []; p.people ||= []; p.blocks ||= [];
  return p;
}

export const clone = o => structuredClone(o);
