# Kreator stopek KHOREI — zasady dla agentów

- Przed każdym `git push` na `main` uruchom `./scripts/release.sh` i zacommituj jego zmiany (numer wersji → pasek „Jest nowa wersja” u użytkowników, świeże pliki w cache).
- Interfejs i komunikaty po polsku, z polską typografią (twarde spacje po jednoliterowych słowach).
- Silnik stopki (`app/signature.js`) trzyma zasady sprawdzone w prawdziwych programach pocztowych: tabele + style inline, telefon jako tekst (iOS), osobna wersja dla Gmaila (wycina max-width), obrazy tylko PNG/JPG z publicznego linku.
- Nic nie wysyłamy na serwer: dane użytkownika zostają w IndexedDB i w pakiecie .zip.
