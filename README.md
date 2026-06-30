# Sales B2B

Desktopowa aplikacja Electron do zarzadzania sprzedaza B2B, spotkaniami i generowaniem firm.

## Konta uzytkownikow i pracownicy

Aplikacja korzysta z Supabase Auth oraz PostgreSQL. Hasla nie sa zapisywane w aplikacji ani w `localStorage`.

1. Utworz projekt w Supabase.
2. Otworz `SQL Editor`, wklej caly plik `supabase-setup.sql` i kliknij `Run`. Dla istniejacego projektu wystarczy nowa migracja `supabase-user-data.sql`, a dla czatu pracownikow dodatkowo `supabase-chat.sql`.
3. W `Project Settings -> API` skopiuj `Project URL` oraz klucz `anon`/`publishable`.
4. Wstaw te dwie wartosci do `supabase-config.json`.
5. Wdroż funkcje `supabase/functions/bright-processor` jako Edge Function o nazwie `bright-processor`.
6. Zbuduj nowy instalator poleceniem `npm.cmd run build`.

Pierwsza osoba rejestrujaca sie tworzy organizacje i otrzymuje role administratora. Administrator tworzy pracownikowi kompletne konto, podajac jego e-mail, haslo, role i uprawnienia. Pracownik od razu loguje sie otrzymanymi danymi i nie przechodzi rejestracji ani potwierdzania e-maila.

Wszystkie dane robocze aplikacji sa zapisywane w `user_app_data` z identyfikatorem zalogowanego uzytkownika. Dane sa odtwarzane po zalogowaniu na dowolnym komputerze, a lokalna pamiec pelni tylko role cache.

Generator firm zapisuje fakty zwracane przez Google Places, publiczne informacje ze strony firmy oraz - gdy strona ujawnia numer KRS - oficjalne dane z API Krajowego Rejestru Sadowego. Priorytet leada, skala i potencjal budzetowy sa wyraznie oznaczone jako szacunki; aplikacja pokazuje ich podstawy i ograniczenia.

## Chat pracownikow

Po zalogowaniu aplikacja pokazuje w prawym dolnym rogu przycisk chatu. Pracownicy tej samej organizacji moga pisac na kanale zespolowym oraz w rozmowach prywatnych. Wiadomosci sa zapisywane w tabeli `chat_messages`, a zalaczniki trafiaja do prywatnego bucketu Supabase Storage `sales-b2b-chat-files`.

Dla istniejacego projektu Supabase uruchom raz `supabase-chat.sql`. Ten skrypt tworzy tabele, polityki RLS i prywatny bucket plikow. Niczego nie trzeba usuwac.

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

## Droga Sprzedazy

Zakladka prowadzi klienta przez etapy `Cold call -> Maly audyt -> Spotkanie ofertowe -> Duzy audyt -> Sprzedaz`, a nastepnie przez 12 miesiecy wspolpracy. Handlowiec widzi i edytuje wylacznie klientow zapisanych na swoim koncie. Przy utracie zapisuje etap, powod oraz opcjonalne wyjasnienie.

Administrator i manager nie otrzymuja nazw firm ani danych kontaktowych. Widok zarzadzajacy pokazuje jedynie anonimowe liczby, konwersje, utraty, najczestsze powody oraz sredni czas na etapie.

1. W Supabase utworz Edge Function o nazwie `sales-journey-stats`.
2. Wklej kod z `supabase/functions/sales-journey-stats/index.ts`.
3. Pozostaw wlaczona weryfikacje JWT i wdroz funkcje.

Nie jest potrzebny dodatkowy SQL. Dane lejka korzystaja z istniejacej tabeli `user_app_data` i klucza `sales_journey`.

## Panel administratora i synchronizacja zakladek

Administrator oraz manager moga przelaczac sie na panel dowolnego aktywnego uzytkownika w organizacji. Wszystkie zakladki czytaja wtedy i zapisuja dane wybranego konta. Handlowiec pozostaje przy swoim prywatnym panelu.

Przeplyw jest laczony identyfikatorami:

- firma dodana do Drogi Sprzedazy tworzy lead,
- zmiana statusu firmy na `Zadzwoniono`, `Zainteresowane`, `Follow-up` albo `Odrzucone` tworzy lub aktualizuje lead w Drodze Sprzedazy,
- przypisanie leada tworzy spotkanie,
- data spotkania tworzy wydarzenie w Terminarzu,
- wejscie na etap Sprzedaz tworzy Klienta,
- edycje danych kontaktowych synchronizuja powiazane rekordy.

Dla istniejacego projektu Supabase uruchom raz `supabase-admin-team-access.sql`. To nie tworzy nowych tabel; dodaje tylko funkcje i polityki RLS pozwalajace adminowi zarzadzac danymi kont z tej samej organizacji.

## Apollo - osoby decyzyjne

Integracja Apollo jest glownym generatorem firm i osob decyzyjnych. Generator pobiera firmy z People Search wedlug branzy, lokalizacji, wielkosci firmy i typu decydenta, a dane Google sa tylko dodatkowym uzupelnieniem wizytowki, opinii i strony. Lista osob nie zuzywa kredytow Apollo; wzbogacenie wybranej osoby o e-mail i telefon jest wykonywane dopiero po potwierdzeniu uzytkownika i moze zuzyc kredyty planu Apollo.

1. W Apollo utworz master API key o nazwie `Sales B2B`.
2. W `Edge Functions -> Secrets` dodaj sekret `APOLLO_API_KEY`.
3. Wdroz `supabase/functions/apollo-contacts` jako funkcje `apollo-contacts` z wlaczona weryfikacja JWT.
4. Wdroz `supabase/functions/apollo-phone-webhook` jako funkcje `apollo-phone-webhook` i w jej ustawieniach wylacz weryfikacje JWT, poniewaz wywoluje ja serwer Apollo.
5. Po zmianach generatora wdroz tez aktualna wersje `supabase/functions/sales-ai`, zeby briefy AI widzialy pola Apollo.

Kontakty Apollo, wielkosc firmy, branze, opis organizacji i wybrany decydent sa zapisywane wewnatrz rekordu firmy w `user_app_data`. Nie jest potrzebna dodatkowa tabela SQL. Telefon jest dostarczany asynchronicznie; aplikacja zapisuje identyfikator zadania i pozwala sprawdzic wynik bez ujawniania klucza Apollo.

Wybrana osoba z Apollo moze zostac dodana bezposrednio jako lead w Drodze Sprzedazy. Jesli pozniej Apollo dopelni e-mail lub telefon, powiazany lead zostanie uzupelniony automatycznie. Brief AI dostaje pelny kontekst firmy z Apollo oraz fakty uzupelnione z Google/KRS, wiec hipotezy sprzedazowe opieraja sie na zapisanych danych firmy.

## Uruchomienie

Najprosciej: pobierz gotowy instalator z folderu `installer`:

```text
installer/Sales-B2B-Setup-1.5.3.exe
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
