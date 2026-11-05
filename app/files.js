/* KHOREI — kreator stopek mailowych
   Pliki: wczytywanie obrazów i fontów w przeglądarce (nic nie trafia na serwer),
   zamiana SVG na PNG, automatyczna wersja ciemna, pakiet ZIP. */

import { assetFiles, fullHtml, appleMailCode, slug } from './signature.js';

export const readAsDataURL = file => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
});

const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/* Obraz → PNG w 3× rozdzielczości docelowej (ostre na ekranach Retina).
   SVG zawsze rasteryzujemy, bo Gmail i Outlook go nie wyświetlają. */
export async function imageFromFile(file, displayWidth = 160) {
  const data = await readAsDataURL(file);
  const img = await loadImage(data);
  const nw = img.naturalWidth || 300, nh = img.naturalHeight || 100;
  const isSvg = /svg/.test(file.type) || /\.svg$/i.test(file.name);
  const w = Math.min(displayWidth, isSvg ? displayWidth : Math.round(nw / 2) || displayWidth);
  const ratio = nh / nw;
  const scale = 3, cw = Math.round(w * scale), ch = Math.round(w * ratio * scale);
  let png = data;
  if (isSvg || nw > cw * 1.5) {             // SVG albo zbyt duży plik → przeliczamy
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(img, 0, 0, cw, ch);
    png = c.toDataURL('image/png');
  }
  return { data: png, w, h: Math.round(w * ratio), fileName: file.name.replace(/\.[^.]+$/, '') + '.png' };
}

/* Wersja do trybu ciemnego: każdy nieprzezroczysty piksel na zadany kolor (domyślnie biały).
   Działa dla logotypów jednokolorowych na przezroczystym tle. */
export async function tintImage(dataUrl, color = '#ffffff') {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* Czy obraz ma przezroczystość? (Wersja automatyczna ma sens tylko dla przezroczystego tła) */
export async function hasAlpha(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas'); c.width = Math.min(200, img.naturalWidth); c.height = Math.min(200, img.naturalHeight);
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

export async function fontFromFile(file) {
  const data = await readAsDataURL(file);
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_](regular|normal|book|roman|400)$/i, '').replace(/[-_]+/g, ' ').trim();
  return { data, name: file.name, type: file.type, family };
}

/* Rejestracja fontów w podglądzie (FontFace API, dane z pamięci przeglądarki) */
const registered = new Map();
export async function registerFonts(project) {
  for (const f of project.fonts) {
    const src = f.file?.data || f.url;
    if (!src) continue;
    const key = f.family + '|' + src.length + '|' + src.slice(-32);
    if (registered.get(f.id) === key) continue;
    try {
      const face = new FontFace(f.family.replace(/'/g, ''), `url(${src})`);
      await face.load(); document.fonts.add(face); registered.set(f.id, key);
    } catch (e) { console.warn('Font nie wczytał się:', f.family, e); }
  }
}

/* ---------- pakiet ZIP ----------
   projekt.json        — wszystko do dalszej edycji (z danymi fontów i obrazków)
   pliki-na-serwer/    — gotowe pliki (PNG, fonty) do wrzucenia na serwer
   stopki/*.html       — gotowe pliki dla każdej osoby
   CZYTAJ.txt          — co z tym zrobić */
const dataToBlob = d => fetch(d).then(r => r.blob());

export async function exportPackage(project) {
  const zip = new window.JSZip();
  zip.file('projekt.json', JSON.stringify({ format: 'khorei-stopki', ...project }, null, 1));
  for (const f of assetFiles(project)) zip.file('pliki-na-serwer/' + f.path.split('/').pop(), await dataToBlob(f.data));
  for (const p of project.people) {
    zip.file(`stopki/${slug(p.name)}.html`, fullHtml(project, p));
    zip.file(`stopki/${slug(p.name)}-apple-mail.txt`, appleMailCode(project, p));
  }
  zip.file('CZYTAJ.txt', [
    `Pakiet stopek: ${project.name}`, '',
    'projekt.json  — wczytaj w kreatorze („Wczytaj pakiet”), żeby edytować dalej.',
    'pliki-na-serwer/ — gotowe PNG i fonty. Wrzuć je na swój serwer (strona, Webflow, FTP, Netlify Drop),',
    '                skopiuj link do każdego pliku i wklej go w kreatorze przy obrazie / foncie',
    '                (pole „Link na serwerze”). Bez linku logo nie pokaże się odbiorcom.',
    'stopki/       — gotowe pliki HTML (Thunderbird, Outlook) i kod dla Apple Mail dla każdej osoby.', '',
    ...project.images.map(i => `${i.name}: ${i.light?.url || 'BRAK LINKU'}`),
  ].join('\n'));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  download(blob, `${slug(project.name)}.stopka.zip`);
}

export async function importPackage(file) {
  const zip = await window.JSZip.loadAsync(file);
  const json = zip.file('projekt.json');
  if (!json) throw new Error('W pliku nie ma projekt.json — to nie jest pakiet kreatora.');
  const p = JSON.parse(await json.async('string'));
  if (p.format !== 'khorei-stopki') throw new Error('Nieznany format pakietu.');
  delete p.format;
  return p;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
