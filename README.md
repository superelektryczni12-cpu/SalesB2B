# Sales B2B

Desktopowa aplikacja Electron do zarzadzania sprzedaza B2B, spotkaniami i generowaniem firm.

## Konta uzytkownikow i pracownicy

Aplikacja korzysta z Supabase Auth oraz PostgreSQL. Hasla nie sa zapisywane w aplikacji ani w `localStorage`.

1. Utworz projekt w Supabase.
2. Otworz `SQL Editor`, wklej caly plik `supabase-setup.sql` i kliknij `Run`.
3. W `Project Settings -> API` skopiuj `Project URL` oraz klucz `anon`/`publishable`.
4. Wstaw te dwie wartosci do `supabase-config.json`.
5. Zbuduj nowy instalator poleceniem `npm.cmd run build`.

Pierwsza osoba rejestrujaca sie bez zaproszenia tworzy organizacje i otrzymuje role administratora. Administrator dodaje pracownika przez jego e-mail, role i uprawnienia. Pracownik rejestruje sie tym samym adresem e-mail i ustawia wlasne haslo.

## Uruchomienie

Najprosciej: pobierz gotowy instalator z folderu `installer`:

```text
installer/Sales-B2B-Setup-1.1.0.exe
```

Po pobraniu uruchom plik `.exe` i przejdz instalacje.

## Uruchomienie z kodu

1. Zainstaluj Node.js.
2. Pobierz repozytorium.
3. W folderze projektu uruchom:

```powershell
npm install
npm start
```

## Build Windows

```powershell
npm run build
```

Gotowa paczka aplikacji pojawi sie w folderze `dist`.
