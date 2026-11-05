/* KHOREI — kreator stopek mailowych · edytor
   Trzy kolumny: nawigacja · formularz · podgląd. Dane zostają w przeglądarce. */

import { h, render } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';
import { db, uid, newProject, migrate, clone } from './store.js?v=2026.11.05.1148';
import { signature, darkRules, fullHtml, appleMailCode, imagePath, fontPath, assetFiles, FALLBACKS, esc, slug, normUrl } from './signature.js?v=2026.11.05.1148';
import { imageFromFile, tintImage, hasAlpha, fontFromFile, registerFonts, exportPackage, importPackage, download } from './files.js?v=2026.11.05.1148';
import { convertFont, kb } from './fontconv.js?v=2026.11.05.1148';

const html = htm.bind(h);
export const VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

/* ============================================================
   POMOCNICZE
   ============================================================ */
const BLOCK_TYPES = {
  person:  { label: 'Osoba',     hint: 'imię, nazwisko, stanowisko' },
  image:   { label: 'Obraz',     hint: 'logo, sygnet, grafika' },
  contact: { label: 'Kontakt',   hint: 'telefon, e-mail, www' },
  text:    { label: 'Tekst',     hint: 'klauzula, adres, dowolny tekst' },
  links:   { label: 'Linki',     hint: 'rezerwacja, social media, portfolio' },
  divider: { label: 'Linia',     hint: 'separator' },
  spacer:  { label: 'Odstęp',    hint: 'pusta przestrzeń' },
};

function defaultBlock(type, project) {
  const f = project.fonts[0]?.id || '';
  const base = { id: uid('b'), type, space: 16 };
  return {
    person:  { ...base, font: f, size: 13, lh: 17, color: 'text', weight: 400, showRole: true },
    image:   { ...base, image: project.images[0]?.id || '', width: project.images[0]?.w || 160, link: 'web' },
    contact: { ...base, font: f, size: 12, lh: 16, color: 'text', items: { phone: true, email: true, web: true } },
    text:    { ...base, font: f, size: 9, lh: 12, color: 'muted', content: 'Nowy tekst' },
    links:   { ...base, font: f, size: 12, lh: 16, color: 'text', items: [{ label: 'Umów wizytę', url: '' }], inline: false, arrow: true, underline: false },
    divider: { ...base, full: false, width: 40, thick: 1, color: 'muted', space: 12 },
    spacer:  { ...base, height: 16, space: 0 },
  }[type];
}

function blockSummary(b, project) {
  if (b.type === 'image') return project.images.find(i => i.id === b.image)?.name || 'wybierz obraz';
  if (b.type === 'text') return (b.content || '').slice(0, 28) + ((b.content || '').length > 28 ? '…' : '');
  if (b.type === 'spacer') return `${b.height} px`;
  if (b.type === 'links') return (b.items || []).map(x => x.label).filter(Boolean).join(' · ') || 'dodaj link';
  if (b.type === 'divider') return b.full ? 'na całą szerokość' : `${b.width} px`;
  if (b.type === 'contact') return ['phone', 'email', 'web'].filter(k => b.items?.[k] !== false).map(k => ({ phone: 'tel.', email: 'e-mail', web: 'www' }[k])).join(' · ');
  return project.fonts.find(f => f.id === b.font)?.family || '';
}

/* Telefon: +48 XXX XXX XXX, inne kraje: +CC i grupy po 3 cyfry */
export function formatPhone(raw) {
  let d = String(raw).replace(/[^\d+]/g, '');
  if (!d) return { value: '', warn: '' };
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) d = (d.length === 11 && d.startsWith('48')) ? '+' + d : (d.length === 9 ? '+48' + d : d);
  if (d.startsWith('+48')) {
    const n = d.slice(3);
    if (n.length === 9) return { value: `+48 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`, warn: '' };
    return { value: '+48 ' + n.replace(/(\d{3})(?=\d)/g, '$1 '), warn: `Polski numer ma 9 cyfr po +48 — tu jest ${n.length}.` };
  }
  if (!d.startsWith('+')) return { value: String(raw).trim(), warn: 'Dodaj kierunkowy kraju, np. +48.' };
  const g = d.slice(3).match(/\d{1,3}/g) || [];
  if (g.length > 1 && g[g.length - 1].length === 1) g.splice(-2, 2, g[g.length - 2] + g[g.length - 1]);
  return { value: `+${d.slice(1, 3)} ${g.join(' ')}`.trim(), warn: d.length < 9 ? 'Numer wygląda na za krótki.' : '' };
}
export function checkEmail(raw, domain) {
  const v = String(raw).trim().toLowerCase();
  if (!v) return { value: '', warn: '' };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return { value: v, warn: 'To nie wygląda na adres e-mail.', bad: true };
  if (domain && !v.endsWith('@' + domain.replace(/^@/, ''))) return { value: v, warn: `Inna domena niż ${domain} — na pewno?` };
  return { value: v, warn: '' };
}

const Icon = ({ d, size = 16 }) => html`<svg class="ico" width=${size} height=${size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" aria-hidden="true">${d.split('|').map(p => html`<path d=${p}/>`)}</svg>`;
const I = {
  up: 'M4 9.5L8 5.5L12 9.5', down: 'M4 6.5L8 10.5L12 6.5', dup: 'M5.5 5.5h7v7h-7z|M3.5 10.5v-7h7',
  del: 'M3.5 4.5h9|M6 4.5v-1.5h4v1.5|M5 4.5l.5 8.5h5l.5-8.5', eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z|M8 6.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z',
  eyeOff: 'M2.5 2.5l11 11|M6.5 4c.5-.2 1-.3 1.5-.3c4 0 6.5 4.3 6.5 4.3s-.6 1.1-1.8 2.3|M4.2 5.6C2.6 6.8 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7',
  undo: 'M5.5 3.5L2.5 6.5L5.5 9.5|M2.5 6.5h7a4 4 0 0 1 0 8h-2', redo: 'M10.5 3.5L13.5 6.5L10.5 9.5|M13.5 6.5h-7a4 4 0 0 0 0 8h2',
  grip: 'M6 4h0|M10 4h0|M6 8h0|M10 8h0|M6 12h0|M10 12h0', plus: 'M8 3v10|M3 8h10', x: 'M4 4l8 8|M12 4l-8 8',
};

/* ============================================================
   POLA FORMULARZA
   ============================================================ */
const Field = ({ label, hint, warn, children }) => html`
  <label class="f"><span class="f__label">${label}</span>${children}
    ${warn && html`<span class="f__warn">${warn}</span>`}${hint && html`<span class="f__hint">${hint}</span>`}</label>`;

const Text = ({ label, value, onInput, onChange, placeholder, hint, warn, type = 'text' }) => html`
  <${Field} label=${label} hint=${hint} warn=${warn}>
    <input type=${type} value=${value ?? ''} placeholder=${placeholder} class=${warn ? 'is--warn' : ''}
      onInput=${e => onInput?.(e.target.value)} onChange=${e => onChange?.(e.target.value)} />
  <//>`;

const Area = ({ label, value, onInput, hint, rows = 4 }) => html`
  <${Field} label=${label} hint=${hint}><textarea rows=${rows} value=${value ?? ''} onInput=${e => onInput(e.target.value)}></textarea><//>`;

const Num = ({ label, value, onInput, min = 0, max = 999, step = 1, unit = 'px' }) => html`
  <${Field} label=${label}><div class="num"><input type="number" value=${value} min=${min} max=${max} step=${step}
    onInput=${e => onInput(e.target.value === '' ? '' : +e.target.value)} /><span>${unit}</span></div><//>`;

const Select = ({ label, value, onChange, options, hint }) => html`
  <${Field} label=${label} hint=${hint}><select value=${value} onChange=${e => onChange(e.target.value)}>
    ${options.map(([v, t]) => html`<option value=${v} selected=${v === value}>${t}</option>`)}</select><//>`;

const Check = ({ label, checked, onChange, hint }) => html`
  <label class="check"><input type="checkbox" checked=${!!checked} onChange=${e => onChange(e.target.checked)} />
    <span>${label}${hint && html`<small>${hint}</small>`}</span></label>`;

const Color = ({ label, value, onInput }) => html`
  <${Field} label=${label}><div class="color"><input type="color" value=${value} onInput=${e => onInput(e.target.value)} />
    <input type="text" value=${value} onChange=${e => /^#[0-9a-f]{6}$/i.test(e.target.value.trim()) && onInput(e.target.value.trim().toLowerCase())} /></div><//>`;

const Seg = ({ value, onChange, options, equal }) => html`
  <div class=${'presets' + (equal ? ' is--equal' : '')}>${options.map(([v, t, title]) => html`
    <button type="button" title=${title} aria-pressed=${String(v === value)} onClick=${() => onChange(v)}>${t}</button>`)}</div>`;

const FileBtn = ({ accept, onFile, children, small }) => {
  const ref = useRef();
  return html`<span class="file__pick"><button type="button" class=${'btn' + (small ? ' is--small' : '')} onClick=${() => ref.current.click()}>${children}</button>
    <input ref=${ref} type="file" accept=${accept} hidden onChange=${e => { const f = e.target.files[0]; e.target.value = ''; f && onFile(f); }} /></span>`;
};

/* Wspólne pola typografii dla bloków tekstowych */
const TypeFields = ({ b, set, project }) => html`
  <${Select} label="Krój" value=${b.font} onChange=${v => set('font', v)} options=${project.fonts.map(f => [f.id, f.family])} />
  <div class="grid3">
    <${Num} label="Stopień" value=${b.size} onInput=${v => set('size', v)} min="6" max="48" />
    <${Num} label="Interlinia" value=${b.lh} onInput=${v => set('lh', v)} min="6" max="80" />
    <${Num} label="Światło" value=${b.ls || 0} onInput=${v => set('ls', v)} min="-2" max="20" step="0.1" />
  </div>
  <div class="grid2">
    <${Select} label="Kolor" value=${b.color} onChange=${v => set('color', v)} options=${[['text', 'Główny'], ['muted', 'Pomocniczy']]} />
    <${Select} label="Grubość" value=${String(b.weight || 400)} onChange=${v => set('weight', +v)} options=${[['400', 'Normalna'], ['700', 'Pogrubiona']]}
      hint=${+b.weight === 700 && project.fonts.find(f => f.id === b.font)?.file ? 'Wgrany krój ma jedną grubość — pogrubienie będzie sztuczne. Wgraj osobny plik Bold jako nowy krój.' : ''} />
  </div>
  <${Check} label="Wersaliki" checked=${b.upper} onChange=${v => set('upper', v)} />`;

/* ============================================================
   FORMULARZE: BLOKI
   ============================================================ */
function BlockForm({ b, project, update, go }) {
  const set = (k, v) => update(p => { p.blocks.find(x => x.id === b.id)[k] = v; }, `b.${b.id}.${k}`);
  const space = html`<${Num} label="Odstęp pod blokiem" value=${b.space} onInput=${v => set('space', v)} max="120" />`;
  switch (b.type) {
    case 'person': return html`
      <p class="note">Imię, nazwisko i stanowisko pochodzą z zakładki <a class="link" onClick=${() => go({ kind: 'people' })}>Osoby</a>.</p>
      <${TypeFields} b=${b} set=${set} project=${project} />
      <${Check} label="Pokazuj stanowisko" checked=${b.showRole !== false} onChange=${v => set('showRole', v)} />
      ${space}`;
    case 'contact': return html`
      <p class="note">Telefon i e-mail pochodzą z <a class="link" onClick=${() => go({ kind: 'people' })}>Osób</a>, adres www z <a class="link" onClick=${() => go({ kind: 'brand', tab: 'general' })}>Marki</a>.
        Telefon jest zwykłym tekstem: iPhone dzwoni tylko z numeru, który sam rozpozna.</p>
      <div class="checks">
        <${Check} label="Telefon" checked=${b.items?.phone !== false} onChange=${v => set('items', { ...b.items, phone: v })} />
        <${Check} label="E-mail" checked=${b.items?.email !== false} onChange=${v => set('items', { ...b.items, email: v })} />
        <${Check} label="Strona www" checked=${b.items?.web !== false} onChange=${v => set('items', { ...b.items, web: v })} />
        <${Check} label="W jednej linii" checked=${b.inline} onChange=${v => set('inline', v)} />
      </div>
      ${b.inline && html`<${Text} label="Separator" value=${b.sepChar || '·'} onInput=${v => set('sepChar', v)} />`}
      <${TypeFields} b=${b} set=${set} project=${project} />
      ${space}`;
    case 'text': return html`
      <${Area} label="Treść" value=${b.content} onInput=${v => set('content', v)} rows="6" hint="Nowa linia = Enter. Twarde spacje (zawieszki) dodają się same, jeśli są włączone w Układzie." />
      <${TypeFields} b=${b} set=${set} project=${project} />
      <${Check} label="Zawijaj do szerokości reszty stopki" checked=${b.wrap} onChange=${v => set('wrap', v)}
        hint=${project.layout.mode === 'content' ? 'Tekst nie rozpycha stopki — układa się na szerokość najszerszego innego elementu (np. logo).' : 'Działa w układzie „Szerokość treści” (Marka → Układ).'} />
      ${space}`;
    case 'links': {
      const items = b.items || [];
      const setItem = (i, k, v) => update(p => { p.blocks.find(x => x.id === b.id).items[i][k] = v; }, `b.${b.id}.it${i}.${k}`);
      return html`
        <p class="note">Linki otwierają się w przeglądarce odbiorcy. Adres możesz wkleić bez <code>https://</code> — dodamy go sami.</p>
        ${items.map((it, i) => html`<${Card} sub id=${'link-' + b.id + '-' + i} title=${it.label || 'Nowy link'}
            tools=${html`<button type="button" title="Wyżej" disabled=${i === 0} onClick=${() => update(p => { const a = p.blocks.find(x => x.id === b.id).items; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}><${Icon} d=${I.up} /></button>
              <button type="button" title="Usuń" onClick=${() => update(p => { p.blocks.find(x => x.id === b.id).items.splice(i, 1); })}><${Icon} d=${I.del} /></button>`}>
          <${Text} label="Tekst linku" value=${it.label} onInput=${v => setItem(i, 'label', v)} placeholder="Umów wizytę" />
          <${Text} label="Adres" value=${it.url} onInput=${v => setItem(i, 'url', v.trim())} placeholder="booksy.com/twoj-salon"
            warn=${it.url && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(it.url) && !/^mailto:/i.test(it.url) ? 'To nie wygląda na adres strony.' : ''}
            hint=${it.url ? html`Prowadzi do: <a class="link" href=${normUrl(it.url)} target="_blank">${normUrl(it.url)}</a>` : ''} />
        <//>`)}
        <button type="button" class="btn is--add" onClick=${() => update(p => { p.blocks.find(x => x.id === b.id).items.push({ label: '', url: '' }); })}>+ Dodaj link</button>
        <div class="checks">
          <${Check} label="W jednej linii" checked=${b.inline} onChange=${v => set('inline', v)} />
          <${Check} label="Strzałka →" checked=${b.arrow} onChange=${v => set('arrow', v)} />
          <${Check} label="Podkreślenie" checked=${b.underline} onChange=${v => set('underline', v)} />
        </div>
        ${b.inline && html`<${Text} label="Separator" value=${b.sepChar || '·'} onInput=${v => set('sepChar', v)} />`}
        <${TypeFields} b=${b} set=${set} project=${project} />
        ${space}`;
    }
    case 'image': {
      const img = project.images.find(i => i.id === b.image);
      return html`
        <${Select} label="Obraz" value=${b.image} onChange=${v => { const i = project.images.find(x => x.id === v); update(p => { const x = p.blocks.find(y => y.id === b.id); x.image = v; if (i) x.width = i.w; }); }}
          options=${[['', '— wybierz —'], ...project.images.map(i => [i.id, i.name])]} />
        <p class="note">${project.images.length ? '' : 'Najpierw dodaj obraz. '}<a class="link" onClick=${() => go({ kind: 'brand', tab: 'images' })}>Zarządzaj obrazami →</a></p>
        ${img && html`<${Num} label="Szerokość w stopce" value=${b.width} onInput=${v => set('width', v)} min="8" max="600" />`}
        <${Select} label="Link po kliknięciu" value=${b.link || 'none'} onChange=${v => set('link', v)} options=${[['none', 'Bez linku'], ['web', 'Strona www marki'], ['custom', 'Własny adres']]} />
        ${b.link === 'custom' && html`<${Text} label="Adres" value=${b.href} onInput=${v => set('href', v)} placeholder="https://" />`}
        <${Text} label="Tekst alternatywny" value=${b.alt} onInput=${v => set('alt', v)} placeholder=${img?.name || ''} hint="Pokazuje się, gdy program blokuje obrazki." />
        ${space}`;
    }
    case 'divider': return html`
      <${Check} label="Na całą szerokość" checked=${b.full} onChange=${v => set('full', v)} />
      ${!b.full && html`<${Num} label="Długość" value=${b.width} onInput=${v => set('width', v)} min="4" max="600" />`}
      <div class="grid2">
        <${Num} label="Grubość" value=${b.thick} onInput=${v => set('thick', v)} min="1" max="8" />
        <${Select} label="Kolor" value=${b.color} onChange=${v => set('color', v)} options=${[['text', 'Główny'], ['muted', 'Pomocniczy']]} />
      </div>
      ${space}`;
    case 'spacer': return html`<${Num} label="Wysokość" value=${b.height} onInput=${v => set('height', v)} min="2" max="120" />`;
  }
}

/* ============================================================
   FORMULARZE: MARKA
   ============================================================ */
function BrandGeneral({ project, update }) {
  const set = (k, v) => update(p => { p.brand[k] = v; }, 'brand.' + k);
  return html`
    <${Text} label="Nazwa projektu" value=${project.name} onInput=${v => update(p => { p.name = v; }, 'name')} />
    <${Text} label="Strona www" value=${project.brand.web} onInput=${v => set('web', v.replace(/^https?:\/\//, ''))} placeholder="twojafirma.pl" hint="Pokazuje się w bloku Kontakt i służy jako link logo." />
    <${Text} label="Domena e-mail" value=${project.brand.domain} onInput=${v => set('domain', v.replace(/^@/, ''))} placeholder="twojafirma.pl" hint="Kreator ostrzeże, gdy ktoś wpisze adres z inną domeną." />`;
}

function BrandColors({ project, update }) {
  const set = (k, v, dark) => update(p => { (dark ? p.brand.dark : p.brand)[k] = v; }, `color.${dark ? 'd' : 'l'}.${k}`);
  return html`
    <div class="sub"><div class="sub__title">Tryb jasny</div>
      <div class="grid2"><${Color} label="Główny" value=${project.brand.colorText} onInput=${v => set('colorText', v)} />
      <${Color} label="Pomocniczy" value=${project.brand.colorMuted} onInput=${v => set('colorMuted', v)} /></div></div>
    <div class="sub"><div class="sub__title">Tryb ciemny</div>
      <div class="grid2"><${Color} label="Główny" value=${project.brand.dark.colorText} onInput=${v => set('colorText', v, true)} />
      <${Color} label="Pomocniczy" value=${project.brand.dark.colorMuted} onInput=${v => set('colorMuted', v, true)} /></div>
      <p class="note">Kolory ciemne włączają się same w Apple Mail, Thunderbirdzie i Outlook.com. Gmail przyciemnia stopkę po swojemu.</p></div>`;
}

/* Zwijany panel. Stan zwinięcia pamiętany po id, więc przetrwa przełączanie zakładek. */
const openState = new Map();
function Card({ id, title, tools, children, sub, titleStyle }) {
  const [open, setOpen] = useState(openState.has(id) ? openState.get(id) : true);
  const toggle = () => { openState.set(id, !open); setOpen(!open); };
  return html`<div class=${(sub ? 'sub' : 'card') + (open ? ' is--open' : ' is--closed')}>
    <div class=${sub ? 'sub__head' : 'card__head'}>
      <button type="button" class="card__title" aria-expanded=${String(open)} onClick=${toggle}>
        <span class="card__chev">${open ? '−' : '+'}</span><span class="card__name" style=${titleStyle}>${title}</span></button>
      ${tools && html`<span class="card__tools">${tools}</span>`}
    </div>
    ${open && html`<div class=${sub ? 'sub__body' : 'card__body'}>${children}</div>`}
  </div>`;
}
/* Numer kroku jako indeks górny na końcu etykiety: „Link na serwerze [3]” */
const Lbl = (text, n) => html`${text}<sup class="idx">[${n}]</sup>`;

/* Link na serwerze + automatyczne sprawdzenie, czy plik się wczytuje */
function useLinkCheck(url, kind) {
  const [st, setSt] = useState('');
  useEffect(() => {
    if (!url) { setSt(''); return; }
    if (!/^https:\/\//i.test(url)) { setSt(/^http:\/\//i.test(url) ? 'http' : 'bad'); return; }
    let live = true; setSt('wait');
    if (kind === 'image') {
      const i = new Image();
      i.onload = () => live && setSt('ok'); i.onerror = () => live && setSt('fail');
      i.src = url;
    } else {
      new FontFace('khorei-check-' + Math.random().toString(36).slice(2), `url(${url})`).load()
        .then(() => live && setSt('ok')).catch(() => live && setSt('fail'));
    }
    return () => { live = false; };
  }, [url]);
  return st;
}
const LINK_STATUS = {
  ok: ['ok', 'Działa — plik wczytuje się z serwera.'],
  wait: ['', 'Sprawdzam…'],
  http: ['bad', 'Link musi zaczynać się od https:// — część programów blokuje obrazy z http://.'],
  bad: ['bad', 'To nie wygląda na link. Powinien zaczynać się od https://'],
  failimage: ['bad', 'Nie udało się wczytać obrazu. Sprawdź, czy link prowadzi prosto do pliku .png/.jpg (a nie do strony z podglądem, jak w Google Drive czy Dropbox).'],
  failfont: ['bad', 'Font nie wczytał się w przeglądarce. Sprawdź link; jeśli jest dobry, serwer może blokować fonty dla innych stron (ustawienie CORS) — w Apple Mail zwykle i tak zadziała.'],
};
function LinkField({ label, value, onInput, kind, placeholder }) {
  const st = useLinkCheck(value, kind);
  const [cls, msg] = LINK_STATUS[st === 'fail' ? 'fail' + kind : st] || ['', ''];
  return html`<${Field} label=${label}>
    <input type="text" value=${value ?? ''} placeholder=${placeholder} class=${cls === 'bad' ? 'is--warn' : ''} onInput=${e => onInput(e.target.value.trim())} />
    ${msg && html`<span class=${'linkst is--' + (cls || 'wait')}>${msg}</span>`}<//>`;
}

/* Wyjaśnienie dla osób nietechnicznych */
const NetlifySteps = ({ project }) => html`
  <details class="why"><summary>Nie masz serwera? Netlify Drop</summary><ol>
    <li><button type="button" class="btn is--small" onClick=${() => serverFolder(project)}>Pobierz folder na serwer (.zip)</button> — wszystkie obrazy i fonty w jednym folderze. Rozpakuj go.</li>
    <li>Wejdź na <a class="link" href="https://app.netlify.com/drop" target="_blank">app.netlify.com/drop</a> i załóż darmowe konto (e-mail albo konto Google).</li>
    <li>Przeciągnij folder na stronę. Dostaniesz adres w stylu <code>https://cos-tam-123.netlify.app</code>.</li>
    <li>Link do pliku to adres + nazwa pliku, np. <code>https://cos-tam-123.netlify.app/logo-jasny.png</code>. Wklej go przy obrazie albo foncie.</li>
  </ol><p>W folderze jest też plik <code>_headers</code> — pozwala programom pocztowym pobierać z Netlify także fonty. Nie usuwaj później tej strony: wysłane maile pobierają z niej logo.</p></details>`;

/* Folder na serwer: płaska lista plików + _headers (CORS dla fontów na Netlify) */
async function serverFolder(project) {
  const zip = new window.JSZip();
  for (const f of assetFiles(project)) zip.file(f.path.split('/').pop(), await fetch(f.data).then(r => r.blob()));
  zip.file('_headers', HEADERS);
  download(await zip.generateAsync({ type: 'blob' }), `${slug(project.name)}-pliki-na-serwer.zip`);
}
const HEADERS = '/*\n  Access-Control-Allow-Origin: *\n';

const WhyOnline = ({ open }) => html`
  <details class="why" open=${open}>
    <summary>Dlaczego logo musi być w internecie?</summary>
    <p><b>Stopka w mailu to nie naklejka, tylko przepis.</b> Mail nie wiezie ze sobą logo, a jedynie adres, pod którym program odbiorcy ma je pobrać w chwili otwarcia wiadomości. Jeśli logo jest tylko na Twoim komputerze, odbiorca zobaczy pusty kwadrat. Dlatego logo musi mieć link w internecie, tak jak zdjęcie na stronie www.</p>
    <p><b>Czemu nie da się go po prostu wkleić?</b> Da się, ale Gmail i Outlook wklejone obrazki usuwają albo zamieniają na załącznik ze spinaczem. Każdy mail wyglądałby wtedy, jakby miał załącznik, a filtry antyspamowe chętniej by go odrzucały.</p>
    <p><b>Co zrobić — od najprostszego:</b></p>
    <ol>
      <li><b>Masz stronę firmy?</b> Pobierz plik przyciskiem „Pobierz PNG” i poproś osobę od strony o wrzucenie go. Poda Ci link — wklej go obok.</li>
      <li><b>Nie masz strony?</b> Użyj darmowego Netlify Drop (instrukcja niżej).</li>
      <li><b>Logo jest już w internecie jako PNG lub JPG?</b> Kliknij je prawym przyciskiem na swojej stronie → „Kopiuj adres obrazka” i wklej jako link. (SVG nie zadziała w mailu.)</li>
      <li><b>Plan B w Gmailu:</b> po wklejeniu stopki kliknij logo w edytorze podpisu → ikona obrazka → „Prześlij”. Gmail przechowa plik u siebie (działa tylko w Gmailu).</li>
    </ol>
  </details>`;

const downloadData = (data, name) => fetch(data).then(r => r.blob()).then(b => download(b, name));

function BrandFonts({ project, update, toast }) {
  const set = (id, k, v) => update(p => { p.fonts.find(f => f.id === id)[k] = v; }, `font.${id}.${k}`);
  const [busy, setBusy] = useState(null);
  const onFile = async (id, file) => {
    if (!/\.(woff2?|ttf|otf)$/i.test(file.name)) return toast('Wgraj plik .otf, .ttf, .woff2 lub .woff.');
    const ff = await fontFromFile(file);
    let conv = null;
    if (/\.(otf|ttf)$/i.test(file.name)) {
      setBusy(id);
      try { conv = await convertFont(file); } catch (e) { toast(e.message); }
      setBusy(null);
    }
    update(p => {
      const f = p.fonts.find(x => x.id === id);
      if (/^(Krój|Nowy krój)/.test(f.family)) f.family = ff.family;
      const base = slug(f.family);
      if (conv) {
        f.file = { data: conv.woff2.data, name: base + '.woff2', type: 'font/woff2', size: conv.woff2.size, from: file.name, fromSize: conv.original };
        f.woff = { data: conv.woff.data, name: base + '.woff', size: conv.woff.size };
      } else { f.file = { data: ff.data, name: file.name, type: ff.type }; f.woff = null; }
    });
    if (conv) toast(`Gotowe: WOFF2 ${kb(conv.woff2.size)} i WOFF ${kb(conv.woff.size)} (z ${kb(conv.original)}).`);
  };
  const fontFolder = async f => {
    const zip = new window.JSZip(), b = slug(f.family);
    zip.file(b + '.' + (f.file.name.split('.').pop()), await fetch(f.file.data).then(r => r.blob()));
    if (f.woff) zip.file(b + '.woff', await fetch(f.woff.data).then(r => r.blob()));
    zip.file('_headers', HEADERS);
    download(await zip.generateAsync({ type: 'blob' }), `${b}-font-na-serwer.zip`);
  };
  return html`
    <p class="note">Wgraj OTF lub TTF<sup class="idx">[1]</sup>, pobierz gotowe pliki na serwer<sup class="idx">[2]</sup>, wklej link<sup class="idx">[3]</sup>. Bez linku stopka użyje zamiennika — nic się nie psuje. Font w mailach wymaga <b>licencji webowej</b>.</p>
    <${NetlifySteps} project=${project} />
    ${project.fonts.map(f => html`
      <${Card} id=${'font-' + f.id} title=${f.family} titleStyle=${`font-family:'${f.family}',${FALLBACKS[f.fallback] || 'sans-serif'}`}
        tools=${project.fonts.length > 1 && html`<button type="button" title="Usuń" onClick=${() => update(p => { p.fonts = p.fonts.filter(x => x.id !== f.id); p.blocks.forEach(b => { if (b.font === f.id) b.font = p.fonts[0].id; }); })}><${Icon} d=${I.del} /></button>`}>
        <${Text} label="Nazwa kroju" value=${f.family} onInput=${v => set(f.id, 'family', v)} />
        <${Field} label=${Lbl('Plik kroju', 1)} hint=${!f.file ? 'Najlepiej .otf albo .ttf — kreator zrobi z niego WOFF2 i WOFF, czyli formaty do maili.' : ''}>
          <div class="file"><span class="file__name">${busy === f.id ? 'Konwertuję…' : f.file ? (f.file.from ? `${f.file.from} → .woff2 + .woff` : f.file.name) : '.otf, .ttf, .woff2 lub .woff'}</span>
            <${FileBtn} accept=".otf,.ttf,.woff2,.woff" onFile=${file => onFile(f.id, file)} small>${f.file ? 'Zmień' : 'Wgraj font'}<//>
            ${f.file && html`<button type="button" class="btn is--small is--ghost" onClick=${() => update(p => { const x = p.fonts.find(y => y.id === f.id); x.file = null; x.woff = null; })}>Usuń</button>`}</div><//>
        ${f.file && html`<${Field} label=${Lbl('Pliki na serwer', 2)}>
          <span class="dl"><button type="button" class="btn is--small" onClick=${() => fontFolder(f)}>Pobierz (.zip)</button>
          <code class="dl__name">${f.file.name}${f.file.size ? ` ${kb(f.file.size)}` : ''}${f.woff ? ` · ${f.woff.name} ${kb(f.woff.size)}` : ''}</code></span><//>`}
        <${LinkField} label=${Lbl('Link do pliku na serwerze', f.file ? 3 : 2)} kind="font" value=${f.url} onInput=${v => set(f.id, 'url', v)} placeholder=${`https://twojafirma.pl/email/${f.file ? f.file.name : 'font.woff2'}`} />
        ${f.woff && html`<p class="f__hint">Wklej link do pliku <code>.woff2</code>. Plik <code>.woff</code> połóż obok, w tym samym folderze — stopka sama go znajdzie.</p>`}
        <${Select} label="Zamiennik" value=${f.fallback} onChange=${v => set(f.id, 'fallback', v)} hint="Dla Gmaila, Outlooka i iPhone’a — nie obsługują własnych fontów."
          options=${[['serif', 'Szeryfowy — Georgia'], ['sans', 'Bezszeryfowy — Helvetica / Arial'], ['mono', 'Monospace — Menlo / Consolas'], ['custom', 'Własny stos…']]} />
        ${f.fallback === 'custom' && html`<${Text} label="Własny stos" value=${f.fallbackCustom} onInput=${v => set(f.id, 'fallbackCustom', v)} placeholder="Verdana, Arial, sans-serif" />`}
      <//>`)}
    <button type="button" class="btn is--add" onClick=${() => update(p => { p.fonts.push({ id: uid('f'), family: 'Nowy krój', file: null, url: '', fallback: 'sans', fallbackCustom: '' }); })}>+ Dodaj krój</button>
    <p class="f__hint">Każdy blok tekstowy (Osoba, Kontakt, Tekst) wybiera swój krój w polu „Krój”. Dodaj drugi krój, jeśli np. klauzula ma być w innym.</p>`;
}

function BrandImages({ project, update, toast }) {
  const set = (id, fn, key) => update(p => fn(p.images.find(i => i.id === id)), key);
  const add = async file => {
    if (!/image\/(png|jpe?g|svg\+xml|gif|webp)/.test(file.type)) return toast('Wgraj PNG, JPG lub SVG.');
    const r = await imageFromFile(file, 160);
    const alpha = await hasAlpha(r.data);
    const dark = alpha ? { mode: 'auto', color: '#ffffff', data: await tintImage(r.data, '#ffffff'), url: '' } : { mode: 'none', data: '', url: '' };
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    update(p => { p.images.push({ id: uid('i'), name, w: r.w, h: r.h, light: { data: r.data, url: '', fileName: r.fileName }, dark }); });
    toast(/svg/.test(file.type) ? 'SVG zamieniony na ostre PNG (3×). Pobierz go i wrzuć na serwer.' : 'Dodano obraz.');
  };
  const replace = async (id, file, which) => {
    const r = await imageFromFile(file, project.images.find(i => i.id === id).w);
    set(id, i => {
      if (which === 'dark') { i.dark = { ...i.dark, mode: 'file', data: r.data }; }
      else { i.light = { ...i.light, data: r.data, fileName: r.fileName }; i.h = Math.round(i.w * r.h / r.w); }
    });
    if (which !== 'dark') { const i = project.images.find(x => x.id === id); if (i.dark?.mode === 'auto') { const d = await tintImage(r.data, i.dark.color || '#fff'); set(id, x => { x.dark.data = d; }); } }
  };
  const setDarkMode = async (img, mode) => {
    if (mode === 'auto') { const d = await tintImage(img.light.data, img.dark?.color || '#ffffff'); set(img.id, i => { i.dark = { ...i.dark, mode, data: d }; }); }
    else set(img.id, i => { i.dark = { ...i.dark, mode, data: mode === 'none' ? '' : i.dark?.data }; });
  };
  const retint = async (img, color) => { const d = await tintImage(img.light.data, color); set(img.id, i => { i.dark = { ...i.dark, color, data: d }; }, 'tint.' + img.id); };
  const fname = (img, v) => imagePath(img, v).replace('obrazki/', '');
  const hasDark = img => img.dark?.mode && img.dark.mode !== 'none';

  return html`
    <p class="note">Wgraj grafikę<sup class="idx">[1]</sup>, pobierz PNG na serwer<sup class="idx">[2]</sup>, wklej link<sup class="idx">[3]</sup>. SVG zamienimy na PNG — w mailach nie działa.</p>
    <${WhyOnline} />
    <${NetlifySteps} project=${project} />
    ${project.images.map(img => html`
      <${Card} id=${'img-' + img.id} title=${img.name}
        tools=${html`<button type="button" title="Usuń" onClick=${() => update(p => { p.images = p.images.filter(x => x.id !== img.id); p.blocks.forEach(b => { if (b.image === img.id) b.image = ''; }); })}><${Icon} d=${I.del} /></button>`}>
        <${Text} label="Nazwa" value=${img.name} onInput=${v => set(img.id, i => { i.name = v; }, 'img.name.' + img.id)} />
        <div class="grid2">
          <${Num} label="Domyślna szerokość" value=${img.w} onInput=${v => set(img.id, i => { const r = i.h / i.w; i.w = v; i.h = Math.round(v * r); }, 'img.w.' + img.id)} min="8" max="600" />
          <${Select} label="Tryb ciemny" value=${img.dark?.mode || 'none'} onChange=${v => setDarkMode(img, v)}
            options=${[['none', 'Brak'], ['auto', 'Automatyczna'], ['file', 'Własny plik']]} />
        </div>
        ${img.dark?.mode === 'auto' && html`<${Color} label="Kolor wersji ciemnej (każdy nieprzezroczysty piksel)" value=${img.dark.color || '#ffffff'} onInput=${v => retint(img, v)} />`}

        ${[['light', 'Wersja jasna'], ...(hasDark(img) ? [['dark', 'Wersja ciemna']] : [])].map(([v, label]) => {
          const d = v === 'dark' ? img.dark : img.light;
          const fn = fname(img, v);
          return html`<${Card} sub id=${'img-' + img.id + '-' + v} title=${label}>
            <div class="asset">
              <div class=${'thumb is--' + v}>${d?.data || d?.url ? html`<img src=${d.data || d.url} />` : html`<span>brak</span>`}</div>
              <div class="asset__b">
                <${Field} label=${Lbl('Grafika', 1)}><span><${FileBtn} accept="image/*" onFile=${f => replace(img.id, f, v)} small>${d?.data ? 'Zmień grafikę' : 'Wgraj grafikę'}<//></span><//>
                <${Field} label=${Lbl('Plik na serwer', 2)}>
                  <span class="dl"><button type="button" class="btn is--small" disabled=${!d?.data} onClick=${() => downloadData(d.data, fn)}>Pobierz PNG</button>
                  <code class="dl__name" title=${fn}>${fn}</code></span><//>
              </div>
            </div>
            <${LinkField} label=${Lbl('Link na serwerze', 3)} kind="image" value=${d?.url} onInput=${val => set(img.id, i => { (v === 'dark' ? i.dark : i.light).url = val; }, `img.u${v}.${img.id}`)} placeholder=${`https://twojafirma.pl/email/${fn}`} />
          <//>`;
        })}
      <//>`)}
    <${FileBtn} accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" onFile=${add}>+ Dodaj obraz<//>`;
}

function BrandLayout({ project, update }) {
  const set = (k, v) => update(p => { p.layout[k] = v; }, 'layout.' + k);
  const L = project.layout;
  return html`
    <${Field} label="Szerokość stopki"><${Seg} value=${L.mode} onChange=${v => set('mode', v)} options=${[['fluid', 'Płynna'], ['content', 'Szerokość treści']]} /><//>
    <p class="note">${L.mode === 'fluid'
      ? html`<b>Płynna:</b> rozciąga się do maksymalnej szerokości i zwęża na telefonie. Gmail wycina maksymalną szerokość, dlatego dla Gmaila kreator robi osobną wersję ze stałą kolumną.`
      : html`<b>Szerokość treści:</b> stopka ma szerokość najszerszego elementu (zwykle logo), a teksty z opcją „Zawijaj do szerokości reszty stopki” układają się pod nim. Jedna wersja działa wszędzie, także w Gmailu, bez stałych szerokości.`}</p>
    <div class="grid2">
      <${Num} label=${L.mode === 'fluid' ? 'Maksymalna szerokość' : 'Szerokość dla Outlooka (Windows)'} value=${L.maxWidth} onInput=${v => set('maxWidth', v)} min="200" max="800" />
      ${L.mode === 'fluid' && html`<${Num} label="Kolumna dla Gmaila" value=${L.gmailWidth} onInput=${v => set('gmailWidth', v)} min="200" max="600" />`}
    </div>
    ${L.mode === 'fluid' && html`<p class="f__hint">288 px mieści się na każdym telefonie (iPhone SE: 320 px minus marginesy aplikacji), więc telefon nie pomniejsza maila.</p>`}
    <${Check} label="Polska typografia" checked=${L.typo} onChange=${v => set('typo', v)} hint="Twarde spacje po „i”, „w”, „z”… i przed myślnikiem — bez zawieszek na końcu wiersza." />`;
}

/* ============================================================
   OSOBY
   ============================================================ */
function PeopleForm({ project, update, activeId, setActive }) {
  const person = project.people.find(p => p.id === activeId) || project.people[0];
  const [warn, setWarn] = useState({});
  if (!person) return html`<p class="note">Brak osób.</p>`;
  const set = (k, v) => update(p => { p.people.find(x => x.id === person.id)[k] = v; }, `person.${person.id}.${k}`);
  return html`
    <div class="presets">${project.people.map(p => html`<button type="button" aria-pressed=${String(p.id === person.id)} onClick=${() => setActive(p.id)}>${p.name || 'Bez nazwy'}</button>`)}
      <button type="button" onClick=${() => { const id = uid('o'); update(p => { p.people.push({ id, name: '', role: '', phone: '', email: '' }); }); setActive(id); }}>+ Osoba</button></div>
    <${Card} id="person-data" title="Dane" tools=${html`
      <button type="button" title="Duplikuj" onClick=${() => { const id = uid('o'); update(p => { p.people.push({ ...clone(person), id, name: person.name + ' (kopia)' }); }); setActive(id); }}><${Icon} d=${I.dup} /></button>
      ${project.people.length > 1 && html`<button type="button" title="Usuń" onClick=${() => { update(p => { p.people = p.people.filter(x => x.id !== person.id); }); setActive(project.people.find(x => x.id !== person.id).id); }}><${Icon} d=${I.del} /></button>`}`}>
      <${Text} label="Imię i nazwisko" value=${person.name} onInput=${v => set('name', v)} />
      <${Text} label="Stanowisko" value=${person.role} onInput=${v => set('role', v)} />
      <div class="grid2">
        <${Text} label="Telefon" value=${person.phone} warn=${warn.phone} onInput=${v => set('phone', v)}
          onChange=${v => { const r = formatPhone(v); set('phone', r.value); setWarn(w => ({ ...w, phone: r.warn })); }} />
        <${Text} label="E-mail" value=${person.email} warn=${warn.email} onInput=${v => set('email', v)}
          onChange=${v => { const r = checkEmail(v, project.brand.domain); set('email', r.value); setWarn(w => ({ ...w, email: r.warn })); }} />
      </div>
      <p class="f__hint">Telefon sam ułoży się w format +48 XXX XXX XXX po wyjściu z pola.</p>
    <//>`;
}

/* ============================================================
   EKSPORT
   ============================================================ */
const GUIDES = {
  gmail: ['Otwórz <a class="link" href="https://mail.google.com/mail/u/0/#settings/general" target="_blank">ustawienia Gmaila</a> → sekcja <b>Podpis</b>.',
    '<b>Utwórz nowy</b> albo w istniejącym usuń starą treść (<kbd>Cmd</kbd>+<kbd>A</kbd>, <kbd>Delete</kbd>) i wklej (<kbd>Cmd</kbd>+<kbd>V</kbd>).',
    'Zaznacz „Wstaw ten podpis przed cytowanym tekstem… i usuń poprzedzający go wiersz „--””.',
    'Ustaw podpis jako domyślny, przewiń na dół i kliknij <b>Zapisz zmiany</b>.'],
  outlook: ['<b>Outlook</b> (nowy, w przeglądarce, na Macu): Ustawienia → Konta → Podpisy → Nowy → wklej → Zapisz.',
    '<b>Outlook klasyczny:</b> Plik → Opcje → Poczta → Podpisy → Nowy → wklej.',
    '<b>iPhone:</b> Ustawienia → Aplikacje → Mail → Podpis → wklej. Jeśli zniknie formatowanie — potrząśnij telefonem → „Cofnij zmianę atrybutów”.'],
  apple: ['Mail → Ustawienia → Podpisy → <kbd>+</kbd>, wpisz cokolwiek, odznacz „Zawsze dopasowuj do domyślnej czcionki”, zamknij Mail (<kbd>Cmd</kbd>+<kbd>Q</kbd>).',
    'W Finderze <kbd>Shift</kbd>+<kbd>Cmd</kbd>+<kbd>G</kbd> → <code>~/Library/Mobile Documents/com~apple~mail/Data/V10/MailData/Signatures/</code> (albo <code>~/Library/Mail/V10/MailData/Signatures/</code>).',
    'Otwórz najnowszy plik <code>.mailsignature</code> w TextEdit, zostaw nagłówek, resztę zastąp skopiowanym kodem.',
    'Zapisz, zablokuj plik (<kbd>Cmd</kbd>+<kbd>I</kbd> → Zablokowany) i uruchom Mail.'],
  html: ['<b>Thunderbird:</b> Ustawienia kont → „Dołącz podpis z pliku” → wskaż pobrany plik.',
    '<b>Outlook klasyczny:</b> zmień końcówkę na <code>.htm</code> i wrzuć do <code>%APPDATA%\\Microsoft\\Signatures</code>.'],
};

function ExportPanel({ project, person, setActive, toast, go }) {
  const [guide, setGuide] = useState(null);
  const warns = [];
  const w = m => { if (!warns.includes(m)) warns.push(m); };
  signature(project, person, { target: 'email', warn: w });
  project.fonts.forEach(f => { if (f.file && !f.url && !project.hosting.base) w(`Font „${f.family}” nie ma linku na serwerze — u odbiorców pokaże się zamiennik (to nic nie psuje).`); });
  if (project.blocks.some(b => b.type === 'image' && !b.image)) w('Blok Obraz nie ma wybranego obrazu.');

  const copyRich = async (variant, g) => {
    const htmlStr = signature(project, person, { variant, target: 'email' });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlStr], { type: 'text/html' }), 'text/plain': new Blob([[person.name, person.role, person.phone, person.email, project.brand.web].filter(Boolean).join('\n')], { type: 'text/plain' }) })]);
    } catch (e) {
      const el = document.getElementById('clip'); el.innerHTML = htmlStr;
      const r = document.createRange(), s = getSelection(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r);
      document.execCommand('copy'); s.removeAllRanges();
    }
    toast('Skopiowano.'); setGuide(g);
  };
  const copyText = async (t, g) => { try { await navigator.clipboard.writeText(t); toast('Skopiowano.'); } catch (e) { prompt('Skopiuj (Cmd+C):', t); } setGuide(g); };
  const gmailVariant = project.layout.mode === 'content' ? 'fluid' : 'gmail';

  return html`
    <${Select} label="Osoba" value=${person.id} onChange=${setActive} options=${project.people.map(p => [p.id, p.name || 'Bez nazwy'])} />
    ${warns.length > 0 && html`<div class="warnbox">${warns.map(m => html`<p>${m}</p>`)}
      <p><a class="link" onClick=${() => go({ kind: 'brand', tab: 'images' })}>Dodaj linki w Obrazach →</a></p><${WhyOnline} /></div>`}
    <div class="actions">
      <button type="button" class="btn is--primary is--wide" onClick=${() => copyRich(gmailVariant, 'gmail')}>Kopiuj dla Gmaila <small>${project.layout.mode === 'content' ? 'szerokość treści' : 'stała kolumna'}</small></button>
      <button type="button" class="btn is--wide" onClick=${() => copyRich('fluid', 'outlook')}>Kopiuj dla Outlooka i iPhone’a <small>płynna</small></button>
      <button type="button" class="btn is--wide" onClick=${() => copyText(appleMailCode(project, person), 'apple')}>Kopiuj kod <small>Apple Mail</small></button>
      <button type="button" class="btn is--wide" onClick=${() => { download(new Blob([fullHtml(project, person)], { type: 'text/html' }), `stopka-${slug(person.name)}.html`); setGuide('html'); }}>Pobierz plik HTML <small>Thunderbird · Outlook Windows</small></button>
    </div>
    ${guide && html`<div class="card guide"><div class="card__head">Co dalej<span class="card__tools"><button type="button" onClick=${() => setGuide(null)}><${Icon} d=${I.x} /></button></span></div>
      <div class="card__body"><ol>${GUIDES[guide].map(s => html`<li dangerouslySetInnerHTML=${{ __html: s }} />`)}</ol></div></div>`}
    <${Card} id="export-fonts" title="Gdzie widać fonty marki"><p class="note">
      Tylko gdy stopka jest wysyłana z <b>Apple Mail</b> lub <b>Thunderbirda</b>, a odbiorca czyta pocztę w Apple Mail, Outlooku na Macu, Thunderbirdzie lub Samsung Email. W Gmailu, Outlooku na Windowsie i z iPhone’a pojawi się zamiennik. Układ, kolory i logo są wszędzie te same.</p><//>`;
}

/* ============================================================
   PODGLĄD
   ============================================================ */
const DEVICES = { 320: 'iPhone SE', 375: 'iPhone mini', 390: 'iPhone', 430: 'iPhone Pro Max', 600: 'tablet / wąskie okno poczty', 760: 'okno poczty na komputerze' };

function Preview({ project, person, setActive }) {
  const [mode, setMode] = useState('light');
  const [variant, setVariant] = useState('fluid');
  const [width, setWidth] = useState(760);
  const [drag, setDrag] = useState(false);
  const stage = useRef();
  useEffect(() => { registerFonts(project); }, [project.fonts]);

  const sig = useMemo(() => signature(project, person, { variant: project.layout.mode === 'content' ? 'fluid' : variant, target: 'preview' }), [project, person, variant]);
  const startDrag = e => {
    e.preventDefault(); const h = e.currentTarget; h.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width, maxW = Math.min(1000, stage.current.clientWidth - 64);
    setDrag(true);
    const move = ev => setWidth(Math.round(Math.max(300, Math.min(maxW, w0 + 2 * (ev.clientX - x0)))));
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); setDrag(false); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  };
  const dev = DEVICES[width] || (width <= 480 ? 'telefon' : width <= 700 ? 'tablet / wąskie okno poczty' : 'okno poczty na komputerze');
  return html`
    <section class="preview">
      <div class="preview__bar">
        <${Seg} equal value=${mode} onChange=${setMode} options=${[['light', 'Jasny'], ['dark', 'Ciemny']]} />
        ${project.layout.mode === 'fluid' && html`<span class="sep"></span><${Seg} equal value=${variant} onChange=${setVariant}
          options=${[['fluid', 'Płynna', 'Apple Mail, Thunderbird, Outlook, iPhone'], ['gmail', 'Gmail', 'Stała kolumna — Gmail wycina maksymalną szerokość']]} />`}
        <span class="sep"></span>
        <${Seg} value=${width} onChange=${setWidth} options=${[[320, '320', 'iPhone SE'], [375, '375', 'iPhone mini'], [390, '390', 'iPhone'], [430, '430', 'iPhone Pro Max'], [600, '600', 'Tablet'], [760, 'Komputer', 'Okno poczty na komputerze']]} />
        ${project.people.length > 1 && html`<span class="sep"></span><select class="mini" value=${person.id} onChange=${e => setActive(e.target.value)}>${project.people.map(p => html`<option value=${p.id} selected=${p.id === person.id}>${p.name || 'Bez nazwy'}</option>`)}</select>`}
        <span class="preview__info">${width} px · ${dev}</span>
      </div>
      <div class="preview__stage" ref=${stage}>
        <div class=${'frame' + (width <= 480 ? ' is--phone' : '') + (drag ? ' is--drag' : '')} style=${`width:${width}px`}>
          <div class="ruler"><span class="r0">0</span><span class="rw">${width} px</span></div>
          <div class="handle" title="Przeciągnij, aby zmienić szerokość" onPointerDown=${startDrag}></div>
          <div class=${'mail' + (mode === 'dark' ? ' sim-dark' : '')}>
            <div class="mail__meta">Do: klient@example.com<br />Temat: Materiały</div>
            <div class="mail__body">Dzień dobry,<br />przesyłam materiały w załączniku.<br /><br />Pozdrawiam</div>
            <div dangerouslySetInnerHTML=${{ __html: sig }} />
          </div>
          <p class="note note--balance" style="margin:16px 0 0"><span><b>Tryb ciemny</b> przełącza się sam w Apple Mail (Mac, iPhone) i Thunderbirdzie.</span><span>Gmail i Outlook pokazują wersję jasną i przyciemniają ją po swojemu.</span></p>
        </div>
      </div>
      <style>${darkRules(project, '.sim-dark ')}</style>
    </section>`;
}

/* ============================================================
   NAWIGACJA Z BLOKAMI (przeciąganie)
   ============================================================ */
function Nav({ project, sel, go, update }) {
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState(false);
  const dragId = useRef(null);
  const move = (from, to) => update(p => { const [b] = p.blocks.splice(from, 1); p.blocks.splice(to, 0, b); });
  const brandTabs = [['general', 'Ogólne'], ['colors', 'Kolory'], ['fonts', 'Fonty'], ['images', 'Obrazy'], ['layout', 'Układ']];
  return html`
    <nav class="nav">
      <span class="nav__label">Marka</span>
      ${brandTabs.map(([t, l]) => html`<button type="button" class=${sel.kind === 'brand' && sel.tab === t ? 'is--on' : ''} onClick=${() => go({ kind: 'brand', tab: t })}>${l}
        ${t === 'fonts' && html`<em>${project.fonts.length}</em>`}${t === 'images' && html`<em>${project.images.length}</em>`}</button>`)}
      <span class="nav__label">Bloki stopki</span>
      <ol>${project.blocks.map((b, i) => html`
        <li class=${(sel.kind === 'block' && sel.id === b.id ? 'is--on ' : '') + (over === i ? 'is--over ' : '') + (b.hidden ? 'is--hidden' : '')} draggable="true"
          onDragStart=${e => { dragId.current = i; e.dataTransfer.effectAllowed = 'move'; }} onDragOver=${e => { e.preventDefault(); setOver(i); }}
          onDragLeave=${() => setOver(null)} onDrop=${e => { e.preventDefault(); setOver(null); if (dragId.current !== null && dragId.current !== i) move(dragId.current, i); dragId.current = null; }}>
          <span class="nav__grip" title="Przeciągnij"><${Icon} d=${I.grip} /></span>
          <button type="button" onClick=${() => go({ kind: 'block', id: b.id })}><span>${BLOCK_TYPES[b.type].label}</span><em>${blockSummary(b, project)}</em></button>
          <span class="nav__tools">
            <button type="button" title="Wyżej" disabled=${i === 0} onClick=${() => move(i, i - 1)}><${Icon} d=${I.up} /></button>
            <button type="button" title="Niżej" disabled=${i === project.blocks.length - 1} onClick=${() => move(i, i + 1)}><${Icon} d=${I.down} /></button>
          </span>
        </li>`)}</ol>
      <div class="nav__add">
        <button type="button" class="btn is--add" onClick=${() => setAdding(!adding)}>+ Dodaj blok</button>
        ${adding && html`<div class="menu">${Object.entries(BLOCK_TYPES).map(([t, d]) => html`
          <button type="button" onClick=${() => { const nb = defaultBlock(t, project); update(p => { p.blocks.push(nb); }); setAdding(false); go({ kind: 'block', id: nb.id }); }}>${d.label}<small>${d.hint}</small></button>`)}</div>`}
      </div>
      <span class="nav__label">Ludzie</span>
      <button type="button" class=${sel.kind === 'people' ? 'is--on' : ''} onClick=${() => go({ kind: 'people' })}>Osoby<em>${project.people.length}</em></button>
      <span class="nav__label">Gotowe</span>
      <button type="button" class=${'nav__export ' + (sel.kind === 'export' ? 'is--on' : '')} onClick=${() => go({ kind: 'export' })}>Eksport stopki</button>
    </nav>`;
}

/* ============================================================
   APLIKACJA
   ============================================================ */
function App() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [sel, setSel] = useState({ kind: 'brand', tab: 'general' });
  const [activePerson, setActivePerson] = useState(null);
  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [newVersion, setNewVersion] = useState(null);
  const hist = useRef({ past: [], future: [], lastKey: '', lastT: 0 });
  const saveT = useRef();
  const loadRef = useRef();

  const toast = useCallback(m => { setToastMsg(m); clearTimeout(toast._t); toast._t = setTimeout(() => setToastMsg(''), 3000); }, []);

  // Nowa wersja kreatora na serwerze → pasek z prośbą o odświeżenie (jak w edytorze brandmanuala)
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        const { version } = await r.json();
        if (VERSION !== 'dev' && version && version !== VERSION) setNewVersion(version);
      } catch (e) {}
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    addEventListener('focus', check);
    return () => { clearInterval(t); removeEventListener('focus', check); };
  }, []);

  useEffect(() => { (async () => {
    let all = (await db.all()).map(migrate).sort((a, b) => b.updated - a.updated);
    if (!all.length) { const p = newProject('Moja stopka'); await db.put(p); all = [p]; }
    setProjects(all); open(all[0]);
  })(); }, []);

  const open = p => { setProject(p); setActivePerson(p.people[0]?.id); hist.current = { past: [], future: [], lastKey: '', lastT: 0 }; setSel({ kind: 'brand', tab: 'general' }); };

  const persist = p => {
    setSaved('Zapisywanie…'); clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      try { await db.put(p); setSaved('Zapisano w przeglądarce'); setProjects(ps => [p, ...ps.filter(x => x.id !== p.id)]); }
      catch (e) { setSaved('Nie udało się zapisać — pobierz pakiet'); }
    }, 400);
  };

  /* update(fn, key): zmiana projektu z historią. Kolejne wpisy w tym samym polu (key) łączą się w jeden krok cofania. */
  const update = useCallback((fn, key = '') => {
    setProject(cur => {
      const next = clone(cur); fn(next); next.updated = Date.now();
      const H = hist.current, now = Date.now();
      if (!(key && key === H.lastKey && now - H.lastT < 1200)) { H.past.push(cur); if (H.past.length > 60) H.past.shift(); }
      H.future = []; H.lastKey = key; H.lastT = now;
      persist(next);
      return next;
    });
  }, []);
  const undo = () => { const H = hist.current; if (!H.past.length) return; setProject(cur => { H.future.push(cur); const p = H.past.pop(); H.lastKey = ''; persist(p); return p; }); };
  const redo = () => { const H = hist.current; if (!H.future.length) return; setProject(cur => { H.past.push(cur); const p = H.future.pop(); H.lastKey = ''; persist(p); return p; }); };

  useEffect(() => {
    const k = e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      e.preventDefault(); e.shiftKey ? redo() : undo();
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  if (!project) return html`<div class="loading">Ładuję kreator…</div>`;
  const person = project.people.find(p => p.id === activePerson) || project.people[0] || { name: '', role: '', phone: '', email: '' };

  const createProject = async (p = newProject()) => { await db.put(p); setProjects(ps => [p, ...ps]); open(p); setMenu(false); };
  const removeProject = async () => {
    if (!confirm(`Usunąć projekt „${project.name}” z tej przeglądarki? Pakiet .zip, jeśli go pobrałeś, zostaje.`)) return;
    await db.del(project.id); const rest = projects.filter(x => x.id !== project.id);
    setProjects(rest); rest.length ? open(rest[0]) : createProject(); setMenu(false);
  };
  const loadPackage = async file => {
    try {
      const p = migrate(await importPackage(file));
      if (projects.some(x => x.id === p.id)) {
        // ten sam projekt już jest: zastąp (OK) albo wczytaj jako kopię (Anuluj)
        if (!confirm(`Projekt „${p.name}” jest już w tej przeglądarce. Zastąpić go wersją z pakietu?\n\nAnuluj = wczytaj jako kopię.`)) { p.id = uid('p'); p.name += ' (wczytany)'; }
        else { await db.put(p); setProjects(ps => [p, ...ps.filter(x => x.id !== p.id)]); open(p); toast(`Zastąpiono „${p.name}”.`); return; }
      }
      await createProject(p); toast(`Wczytano „${p.name}”.`);
    }
    catch (e) { toast(e.message); }
  };

  const panelTitle = sel.kind === 'brand' ? { general: 'Ogólne', colors: 'Kolory', fonts: 'Fonty', images: 'Obrazy', layout: 'Układ' }[sel.tab]
    : sel.kind === 'block' ? BLOCK_TYPES[project.blocks.find(b => b.id === sel.id)?.type]?.label : sel.kind === 'people' ? 'Osoby' : 'Eksport stopki';
  const block = sel.kind === 'block' && project.blocks.find(b => b.id === sel.id);
  const P = { project, update, toast, go: setSel };

  return html`
    <div class=${'app' + (newVersion ? ' has--banner' : '')}>
      ${newVersion && html`<div class="banner">Jest nowa wersja kreatora. Odśwież stronę — wszystkie projekty zostaną, bo zapisują się w przeglądarce.
        <button type="button" class="btn" onClick=${() => { location.href = location.pathname + '?r=' + Date.now(); }}>Odśwież</button></div>`}
      <header class="top">
        <div class="top__brand">KHOREI<span>stopki mailowe</span> <small>v${VERSION}</small></div>
        <div class="top__project">
          <button type="button" class="btn" onClick=${() => setMenu(!menu)}>${project.name} ▾</button>
          ${menu && html`<div class="menu">
            <span class="menu__label">Projekty w tej przeglądarce</span>
            ${projects.map(p => html`<button type="button" class=${p.id === project.id ? 'is--on' : ''} onClick=${() => { open(p); setMenu(false); }}>${p.name}<small>${new Date(p.updated).toLocaleDateString('pl-PL')}</small></button>`)}
            <hr /><button type="button" onClick=${() => createProject()}>Nowy projekt</button>
            <button type="button" onClick=${() => createProject({ ...clone(project), id: uid('p'), name: project.name + ' (kopia)', updated: Date.now() })}>Duplikuj projekt</button>
            <button type="button" class="is--danger" onClick=${removeProject}>Usuń projekt</button>
          </div>`}
        </div>
        <div class="top__history">
          <button type="button" class="btn" title="Cofnij (Cmd+Z)" disabled=${!hist.current.past.length} onClick=${undo}><${Icon} d=${I.undo} /></button>
          <button type="button" class="btn" title="Ponów (Shift+Cmd+Z)" disabled=${!hist.current.future.length} onClick=${redo}><${Icon} d=${I.redo} /></button>
        </div>
        <span class="top__status">${saved}</span>
        <div class="top__actions">
          <button type="button" class="btn" onClick=${() => loadRef.current.click()}>Wczytaj pakiet</button>
          <input ref=${loadRef} type="file" accept=".zip" hidden onChange=${e => { const f = e.target.files[0]; e.target.value = ''; f && loadPackage(f); }} />
          <button type="button" class="btn" onClick=${() => exportPackage(project).then(() => toast('Pakiet pobrany.'))} title="Cały projekt z fontami i obrazkami — do dalszej edycji, z gotowymi plikami na serwer">Zapisz pakiet</button>
          <button type="button" class="btn is--primary" onClick=${() => setSel({ kind: 'export' })}>Eksport</button>
        </div>
      </header>

      <${Nav} project=${project} sel=${sel} go=${setSel} update=${update} />

      <section class="panel"><div class="panel__inner">
        <div class="panel__head"><h1 class="h">${panelTitle}</h1>
          ${block && html`<span class="card__tools">
            <button type="button" title=${block.hidden ? 'Pokaż' : 'Ukryj'} onClick=${() => update(p => { const b = p.blocks.find(x => x.id === block.id); b.hidden = !b.hidden; })}><${Icon} d=${block.hidden ? I.eyeOff : I.eye} /></button>
            <button type="button" title="Duplikuj" onClick=${() => { const nb = { ...clone(block), id: uid('b') }; update(p => { p.blocks.splice(p.blocks.findIndex(x => x.id === block.id) + 1, 0, nb); }); setSel({ kind: 'block', id: nb.id }); }}><${Icon} d=${I.dup} /></button>
            <button type="button" title="Usuń" onClick=${() => { update(p => { p.blocks = p.blocks.filter(x => x.id !== block.id); }); setSel({ kind: 'brand', tab: 'general' }); }}><${Icon} d=${I.del} /></button>
          </span>`}</div>
        ${sel.kind === 'brand' && sel.tab === 'general' && html`<${BrandGeneral} ...${P} />`}
        ${sel.kind === 'brand' && sel.tab === 'colors' && html`<${BrandColors} ...${P} />`}
        ${sel.kind === 'brand' && sel.tab === 'fonts' && html`<${BrandFonts} ...${P} />`}
        ${sel.kind === 'brand' && sel.tab === 'images' && html`<${BrandImages} ...${P} />`}
        ${sel.kind === 'brand' && sel.tab === 'layout' && html`<${BrandLayout} ...${P} />`}
        ${block && html`<${BlockForm} b=${block} ...${P} />`}
        ${sel.kind === 'people' && html`<${PeopleForm} ...${P} activeId=${person.id} setActive=${setActivePerson} />`}
        ${sel.kind === 'export' && html`<${ExportPanel} ...${P} person=${person} setActive=${setActivePerson} />`}
        <p class="note foot">© 2026 KHOREI · <a class="link" href="instrukcja.html" target="_blank">Instrukcja</a> · <a class="link" href="https://github.com/piolun-00/mail-footer-creator/blob/main/LICENSE" target="_blank">Licencja</a></p>
      </div></section>

      <${Preview} project=${project} person=${person} setActive=${setActivePerson} />
      <div id="clip" contenteditable="true"></div>
      <div class=${'toast' + (toastMsg ? ' show' : '')}>${toastMsg}</div>
    </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
