# Sales B2B

Desktopowa aplikacja Electron do zarzadzania sprzedaza B2B, spotkaniami i generowaniem firm.

## Konta uzytkownikow i pracownicy

Aplikacja korzysta z Supabase Auth oraz PostgreSQL. Hasla nie sa zapisywane w aplikacji ani w `localStorage`.

1. Utworz projekt w Supabase.
2. Otworz `SQL Editor`, wklej caly plik `supabase-setup.sql` i kliknij `Run`. Dla istniejacego projektu wystarczy nowa migracja `supabase-user-data.sql`.
3. W `Project Settings -> API` skopiuj `Project URL` oraz klucz `anon`/`publishable`.
4. Wstaw te dwie wartosci do `supabase-config.json`.
5. Wdroż funkcje `supabase/functions/bright-processor` jako Edge Function o nazwie `bright-processor`.
6. Zbuduj nowy instalator poleceniem `npm.cmd run build`.

Pierwsza osoba rejestrujaca sie tworzy organizacje i otrzymuje role administratora. Administrator tworzy pracownikowi kompletne konto, podajac jego e-mail, haslo, role i uprawnienia. Pracownik od razu loguje sie otrzymanymi danymi i nie przechodzi rejestracji ani potwierdzania e-maila.

Wszystkie dane robocze aplikacji sa zapisywane w `user_app_data` z identyfikatorem zalogowanego uzytkownika. Dane sa odtwarzane po zalogowaniu na dowolnym komputerze, a lokalna pamiec pelni tylko role cache.

Generator firm zapisuje fakty zwracane przez Google Places, publiczne informacje ze strony firmy oraz - gdy strona ujawnia numer KRS - oficjalne dane z API Krajowego Rejestru Sadowego. Priorytet leada, skala i potencjal budzetowy sa wyraznie oznaczone jako szacunki; aplikacja pokazuje ich podstawy i ograniczenia.

## AI Asystent handlowca

Karta firmy zawiera dwa przeplywy AI:

- brief przed rozmowa z rozdzieleniem faktow i hipotez,
- analize notatki po rozmowie, rekomendowany status, zadania i szkic follow-upu do zatwierdzenia.

Wyniki sa zapisywane wewnatrz rekordu firmy w `user_app_data`, dlatego naleza do zalogowanego uzytkownika. Wiadomosci nie sa wysylane automatycznie.

AI dziala przez Edge Function `sales-ai`, aby klucz dostawcy nie trafil do aplikacji ani publicznego repozytorium:

1. W Supabase utworz Edge Function o nazwie `sales-ai`.
2. Wklej kod z `supabase/functions/sales-ai/index.ts` i wdroz funkcje.
3. W `Edge Functions -> Secrets` dodaj sekret `OPENAI_API_KEY`.
4. Opcjonalnie ustaw `OPENAI_MODEL`; bez tej wartosci funkcja korzysta z `gpt-5.5`.

Ta funkcja nie wymaga dodatkowego SQL. Dostep otrzymuja tylko zalogowane, aktywne konta z `organization_members`.

## Uruchomienie

Najprosciej: pobierz gotowy instalator z folderu `installer`:

```text
installer/Sales-B2B-Setup-1.4.0.exe
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
