/* KHOREI — kreator stopek mailowych
   Konwersja fontów w przeglądarce: OTF/TTF → WOFF2 + WOFF. Nic nie trafia na serwer.

   WOFF2: oficjalny kompresor Google (woff2) skompilowany do WebAssembly (wawoff2, MIT).
          Ładowany dopiero przy pierwszej konwersji — ok. 1 MB.
   WOFF:  ten sam font, każda tabela skompresowana zlib-em (wbudowany CompressionStream).
          Zapasowy format dla starszych programów pocztowych. */

let woff2Ready = null;
function loadWoff2() {
  if (woff2Ready) return woff2Ready;
  woff2Ready = new Promise((res, rej) => {
    window.Module = { onRuntimeInitialized: () => res(window.Module) };
    const s = document.createElement('script');
    s.src = new URL('../vendor/woff2-compress.js', import.meta.url).href;
    s.onerror = () => { woff2Ready = null; rej(new Error('Nie udało się wczytać konwertera WOFF2.')); };
    document.head.appendChild(s);
  });
  return woff2Ready;
}

export async function toWoff2(bytes) {
  const M = await loadWoff2();
  const out = M.compress(bytes);
  if (!out) throw new Error('Konwersja do WOFF2 nie powiodła się — plik może być uszkodzony.');
  return new Uint8Array(out);
}

const zlib = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
const pad4 = n => (n + 3) & ~3;

export async function toWoff(bytes) {
  const src = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = src.getUint32(0), num = src.getUint16(4);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const t = { tag: src.getUint32(o), checksum: src.getUint32(o + 4), offset: src.getUint32(o + 8), length: src.getUint32(o + 12) };
    const raw = bytes.subarray(t.offset, t.offset + t.length);
    const comp = await zlib(raw);
    t.data = comp.length < raw.length ? comp : raw;   // kompresja tylko, gdy coś daje
    tables.push(t);
  }
  tables.sort((a, b) => a.tag - b.tag);
  const header = 44, dir = 20 * num;
  let off = header + dir, total = off;
  for (const t of tables) { t.woffOffset = off; off += pad4(t.data.length); }
  total = off;
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  const sfntSize = 12 + 16 * num + tables.reduce((s, t) => s + pad4(t.length), 0);
  v.setUint32(0, 0x774F4646); v.setUint32(4, flavor); v.setUint32(8, total);
  v.setUint16(12, num); v.setUint16(14, 0); v.setUint32(16, sfntSize);
  v.setUint16(20, 1); v.setUint16(22, 0);                      // wersja 1.0; metadane i dane prywatne: brak
  tables.forEach((t, i) => {
    const o = header + i * 20;
    v.setUint32(o, t.tag); v.setUint32(o + 4, t.woffOffset); v.setUint32(o + 8, t.data.length);
    v.setUint32(o + 12, t.length); v.setUint32(o + 16, t.checksum);
    out.set(t.data, t.woffOffset);
  });
  return out;
}

export const bytesToDataURL = (u8, mime) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([u8], { type: mime })); });
export const kb = n => n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;

/* Plik użytkownika → { woff2, woff } jako data URL + rozmiary */
export async function convertFont(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = new DataView(bytes.buffer).getUint32(0);
  if (sig === 0x774F4632 || sig === 0x774F4646) return null;          // już WOFF2 / WOFF — bez konwersji
  const [w2, w1] = await Promise.all([toWoff2(bytes), toWoff(bytes)]);
  return {
    woff2: { data: await bytesToDataURL(w2, 'font/woff2'), size: w2.length },
    woff:  { data: await bytesToDataURL(w1, 'font/woff'),  size: w1.length },
    original: bytes.length,
  };
}
