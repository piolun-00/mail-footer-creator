# KHOREI — kreator stopek mailowych

**Kreator:** https://piolun-00.github.io/mail-footer-creator/
**Instrukcja instalacji:** https://piolun-00.github.io/mail-footer-creator/instrukcja.html

Stopka mailowa w Twoim brandingu: własne fonty, logo, sygnet i bloki. Wynik działa w Gmailu, Outlooku i Apple Mail, z trybem ciemnym.

- `index.html`, `app/` — kreator (Preact + htm, bez budowania, bez serwera)
  - `app/signature.js` — silnik: projekt → HTML stopki odporny na programy pocztowe
  - `app/main.js` — edytor: Marka · Bloki · Osoby · Eksport, podgląd jasny/ciemny, szerokości ekranu
  - `app/store.js` — zapis projektów w przeglądarce (IndexedDB)
  - `app/files.js` — wgrywanie fontów i obrazów (SVG → PNG 3×, automatyczna wersja ciemna), pakiet .zip
- `vendor/` — Preact, htm, JSZip (licencje w `licenses/`)

Nic nie trafia na serwer: projekty, fonty i obrazki zostają w przeglądarce użytkownika i w pobieranym pakiecie `.zip`.

© 2026 Radosław Prośniak (KHOREI) — warunki w [LICENSE](LICENSE).
