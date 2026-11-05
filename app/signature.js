/* KHOREI — kreator stopek mailowych
   Silnik: projekt (marka + bloki) + osoba → HTML stopki odporny na programy pocztowe.

   Zasady wyniesione z testów w prawdziwych programach:
   - układ na tabelach, style inline (Outlook = silnik Worda, Gmail wycina <style>),
   - Gmail wycina max-width → wersja „Gmail” ma stałą szerokość albo szerokość treści,
   - telefon jako zwykły tekst: iOS Mail dzwoni tylko z numeru, który sam wykryje,
   - tryb ciemny: reguły w <style> (Apple Mail, Thunderbird) + [data-ogsc] (Outlook.com),
   - obrazy tylko PNG/JPG z publicznego adresu; SVG zamieniamy na PNG przy wgrywaniu. */

export const FALLBACKS = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "Helvetica, Arial, sans-serif",
  mono:  "Menlo, Consolas, 'Courier New', monospace",
};
const MSO_FALLBACK = { serif: 'Georgia, serif', sans: 'Arial, sans-serif', mono: "'Courier New', monospace" };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plik';

/* Typografia polska: twarde spacje po jednoliterowych słowach i przed myślnikiem.
   Zapisane jako znak (U+00A0), więc przetrwają w każdym programie pocztowym. */
export function typo(text) {
  return String(text)
    .replace(/(^|[\s(„"])([aiouwzAIOUWZ])\s+/g, '$1$2 ')
    .replace(/(^|[\s(„"])([aiouwzAIOUWZ])\s+/g, '$1$2 ')
    .replace(/\s+([—–])\s/g, ' $1 ');
}

/* ---------- zasoby: skąd program pocztowy ma pobrać plik ---------- */
const extOf = (name, fallback) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || fallback).toLowerCase();

export function imagePath(img, variant /* light|dark */) {
  return `obrazki/${slug(img.name)}-${variant === 'dark' ? 'ciemny' : 'jasny'}.png`;
}
export function fontPath(font) {
  return `fonty/${slug(font.family)}.${extOf(font.file?.name, 'woff2')}`;
}
const joinUrl = (base, path) => base ? base.replace(/\/?$/, '/') + path : '';

/* target: 'preview' → dane z przeglądarki; 'email' → publiczny adres (albo osadzenie z ostrzeżeniem) */
export function imageSrc(project, img, variant, target, warn) {
  const v = variant === 'dark' ? img.dark : img.light;
  if (!v) return '';
  if (target === 'preview') return v.data || v.url || '';
  const url = v.url || joinUrl(project.hosting?.base, imagePath(img, variant));
  if (url) return url;
  if (v.data) { warn?.(`„${img.name}” nie ma adresu w internecie — obrazek jest osadzony i pokaże się głównie w Apple Mail.`); return v.data; }
  return '';
}

export function fontSrc(project, font, target) {
  if (target === 'preview') return font.file?.data || font.url || '';
  return font.url || (font.file ? joinUrl(project.hosting?.base, fontPath(font)) : '');
}

const fontFormat = src => {
  const e = (src.match(/\.([a-z0-9]+)(\?|#|$)/i)?.[1] || '').toLowerCase();
  return { woff2:'woff2', woff:'woff', ttf:'truetype', otf:'opentype' }[e] || (src.startsWith('data:font/woff2') ? 'woff2' : '');
};

/* ---------- style tekstu ---------- */
export function fontStack(project, fontId) {
  const f = project.fonts.find(x => x.id === fontId);
  if (!f) return FALLBACKS.sans;
  const fb = f.fallback === 'custom' ? (f.fallbackCustom || FALLBACKS.sans) : FALLBACKS[f.fallback] || FALLBACKS.sans;
  return `'${f.family.replace(/'/g, '')}', ${fb}`;
}

function colorOf(project, key, dark = false) {
  const c = dark ? project.brand.dark : project.brand;
  return key === 'muted' ? c.colorMuted : c.colorText;
}

function textStyle(project, b) {
  const parts = [
    `font-family:${fontStack(project, b.font)}`,
    `font-size:${+b.size || 12}px`,
    `line-height:${+b.lh || Math.round((+b.size || 12) * 1.25)}px`,
    `color:${colorOf(project, b.color)}`,
    'mso-line-height-rule:exactly',
  ];
  if (+b.weight === 700) parts.push('font-weight:bold');
  if (+b.ls) parts.push(`letter-spacing:${+b.ls}px`);
  if (b.upper) parts.push('text-transform:uppercase');
  if ((+b.size || 12) < 11) parts.push('-webkit-text-size-adjust:none', 'text-size-adjust:none');
  return parts.join(';') + ';';
}
const txtClass = b => `hs-txt hs-c-${b.color === 'muted' ? 'muted' : 'text'} hs-f-${b.font || 'x'}`;
const linkStyle = (project, b) => `color:${colorOf(project, b.color)};text-decoration:none;`;

/* ---------- obraz z wersją ciemną ---------- */
function imgTag(src, w, h, alt, cls, hidden) {
  const st = `display:block;width:${w}px;height:${h}px;border:0;outline:none;`;
  const img = `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="${st}">`;
  if (!hidden) return img;
  // ciemny wariant: ukryty domyślnie, Outlook (Word) nie widzi go wcale
  return `<!--[if !mso]><!--><div class="hs-dark" style="display:none;max-height:0;overflow:hidden;">${img}</div><!--<![endif]-->`;
}

function imageBlock(project, b, target, warn) {
  const img = project.images.find(x => x.id === b.image);
  if (!img || !img.light?.data && !img.light?.url) return '';
  const w = Math.round(+b.width || img.w || 120);
  const h = Math.round(w * (img.h && img.w ? img.h / img.w : 1));
  const light = imageSrc(project, img, 'light', target, warn);
  const hasDark = img.dark && img.dark.mode !== 'none' && (img.dark.data || img.dark.url);
  let html = imgTag(light, w, h, b.alt || img.name, hasDark ? 'hs-light' : '', false);
  if (hasDark) html += imgTag(imageSrc(project, img, 'dark', target, warn), w, h, b.alt || img.name, '', true);
  const href = b.link === 'web' ? (project.brand.web ? `https://${project.brand.web.replace(/^https?:\/\//, '')}` : '')
             : b.link === 'custom' ? b.href : '';
  return href ? `<a href="${esc(href)}" style="text-decoration:none;">${html}</a>` : html;
}

/* ---------- bloki ---------- */
function blockCell(project, b, person, ctx) {
  const pad = `padding:0 0 ${+b.space || 0}px 0;`;
  const T = s => project.layout.typo ? typo(s) : s;
  switch (b.type) {
    case 'person': {
      const lines = [person.name, b.showRole !== false ? person.role : ''].filter(Boolean).map(x => esc(T(x)));
      if (!lines.length) return '';
      return `<td class="${txtClass(b)}" style="${textStyle(project, b)}${pad}">${lines.join('<br>')}</td>`;
    }
    case 'contact': {
      const a = linkStyle(project, b), items = [];
      if (b.items?.phone !== false && person.phone) items.push(esc(person.phone));   // tekst, nie link — patrz nagłówek
      if (b.items?.email !== false && person.email) items.push(`<a href="mailto:${esc(person.email)}" style="${a}">${esc(person.email)}</a>`);
      if (b.items?.web !== false && project.brand.web) {
        const host = project.brand.web.replace(/^https?:\/\//, '').replace(/\/$/, '');
        items.push(`<a href="https://${esc(host)}" style="${a}">${esc(host)}</a>`);
      }
      if (!items.length) return '';
      const sep = b.inline ? `&nbsp;&nbsp;${esc(b.sepChar || '·')}&nbsp;&nbsp;` : '<br>';
      return `<td class="${txtClass(b)}" style="${textStyle(project, b)}${pad}">${items.join(sep)}</td>`;
    }
    case 'text': {
      if (!b.content?.trim()) return '';
      const body = esc(T(b.content)).replace(/\n/g, '<br>');
      // „zawijaj do szerokości reszty stopki”: width="1" — komórka nie rozpycha tabeli
      const narrow = b.wrap && ctx.contentWidth ? ' width="1"' : '';
      return `<td class="${txtClass(b)}"${narrow} style="${textStyle(project, b)}${pad}">${body}</td>`;
    }
    case 'image': {
      const html = imageBlock(project, b, ctx.target, ctx.warn);
      return html ? `<td style="${pad}">${html}</td>` : '';
    }
    case 'divider': {
      const w = b.full ? '100%' : `${+b.width || 40}`;
      const color = colorOf(project, b.color === 'text' ? 'text' : 'muted');
      return `<td style="${pad}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="border-collapse:collapse;${b.full ? 'width:100%;' : `width:${w}px;`}"><tr><td class="hs-line" style="height:${+b.thick || 1}px;line-height:${+b.thick || 1}px;font-size:1px;background:${color};">&nbsp;</td></tr></table></td>`;
    }
    case 'spacer':
      return `<td style="height:${+b.height || 16}px;line-height:${+b.height || 16}px;font-size:1px;">&nbsp;</td>`;
  }
  return '';
}

/* variant: 'fluid' (płynna do maxWidth) | 'gmail' (stała albo szerokość treści)
   target:  'preview' | 'email' */
export function signature(project, person, { variant = 'fluid', target = 'email', warn } = {}) {
  const L = project.layout;
  const contentWidth = L.mode === 'content';
  const ctx = { target, warn, contentWidth };
  const rows = project.blocks.filter(b => !b.hidden).map(b => blockCell(project, b, person, ctx)).filter(Boolean)
    .map(td => `  <tr>${td}</tr>`).join('\n');

  let size, W;
  if (contentWidth) { size = 'style="'; W = L.maxWidth; }                                   // szerokość z treści (np. logo)
  else if (variant === 'gmail') { W = +L.gmailWidth || 288; size = `width="${W}" style="width:${W}px;`; }
  else { W = +L.maxWidth || 600; size = `width="100%" style="width:100%;max-width:${W}px;`; }

  return `<!--[if mso]><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="hs-sig" cellpadding="0" cellspacing="0" border="0" ${size}border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">
${rows}
</table>
<!--[if mso]></td></tr></table><![endif]-->`;
}

/* Reguły trybu ciemnego. prefix '' → produkcja (w @media), '.sim-dark ' → podgląd */
export function darkRules(project, prefix = '') {
  const d = project.brand.dark, p = prefix;
  return `
${p}.hs-c-text, ${p}.hs-c-text a { color:${d.colorText} !important; }
${p}.hs-c-muted, ${p}.hs-c-muted a { color:${d.colorMuted} !important; }
${p}.hs-line { background:${d.colorMuted} !important; }
${p}.hs-light { display:none !important; }
${p}.hs-dark { display:block !important; max-height:none !important; overflow:visible !important; }`;
}

export function fontFaces(project, target) {
  return project.fonts.map(f => {
    const src = fontSrc(project, f, target);
    if (!src) return '';
    const fmt = fontFormat(f.file?.name || src);
    return `  @font-face { font-family:'${f.family.replace(/'/g, '')}'; font-weight:400; font-style:normal; src:url('${src}')${fmt ? ` format('${fmt}')` : ''}; }`;
  }).filter(Boolean).join('\n');
}

export function styleBlock(project) {
  const faces = fontFaces(project, 'email');
  const dark = darkRules(project);
  const msoFonts = project.fonts.map(f => `.hs-f-${f.id}{font-family:${f.fallback === 'custom' ? (f.fallbackCustom || 'Arial') : MSO_FALLBACK[f.fallback] || 'Arial'} !important;}`).join('');
  return `<style>
${faces ? `@media screen {\n${faces}\n}` : ''}
.hs-txt a { text-decoration:none !important; }
a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
@media (prefers-color-scheme: dark) {${dark}
}
${darkRules(project, '[data-ogsc] ')}
</style>
${msoFonts ? `<!--[if mso]><style>${msoFonts}</style><![endif]-->` : ''}`;
}

export function fullHtml(project, person, opts = {}) {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Stopka – ${esc(person.name || project.name)}</title>
${styleBlock(project)}
</head><body style="margin:0;padding:0;">
${signature(project, person, { variant: 'fluid', target: 'email', ...opts })}
</body></html>
`;
}

export const appleMailCode = (project, person, opts = {}) =>
  styleBlock(project) + '\n' + signature(project, person, { variant: 'fluid', target: 'email', ...opts }) + '\n';

/* Lista zasobów do pakietu i hostingu */
export function assetFiles(project) {
  const files = [];
  for (const img of project.images) {
    if (img.light?.data) files.push({ path: imagePath(img, 'light'), data: img.light.data });
    if (img.dark && img.dark.mode !== 'none' && img.dark.data) files.push({ path: imagePath(img, 'dark'), data: img.dark.data });
  }
  for (const f of project.fonts) if (f.file?.data) files.push({ path: fontPath(f), data: f.file.data });
  return files;
}
