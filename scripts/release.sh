#!/bin/bash
# Numer wersji kreatora: index.html, importy w app/*.js i version.json.
# Wymusza świeże pliki w przeglądarkach i włącza pasek „Jest nowa wersja” u osób z otwartym kreatorem.
# Uruchamiaj przed każdym wypchnięciem na main. Opcjonalny argument: własny numer wersji.
set -e
cd "$(dirname "$0")/.."
V="${1:-$(TZ=Europe/Warsaw date +%Y.%m.%d.%H%M)}"
# index.html: arkusz stylów i główny moduł
sed -i.bak -E "s#(app/(main\.js|styles\.css))(\?v=[^\"]*)?\"#\1?v=$V\"#g" index.html && rm -f index.html.bak
# importy między modułami aplikacji (./store.js → ./store.js?v=…)
for f in app/*.js; do
  sed -i.bak -E "s#(from '\./[a-z0-9-]+\.js)(\?v=[^']*)?'#\1?v=$V'#g" "$f" && rm -f "$f.bak"
done
printf '{ "version": "%s" }\n' "$V" > version.json
echo "Wersja $V"
