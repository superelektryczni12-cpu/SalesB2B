# Sales B2B

Desktopowa aplikacja Electron do zarzadzania sprzedaza B2B, spotkaniami i generowaniem firm.

## Konta uzytkownikow i pracownicy

Aplikacja korzysta z Supabase Auth oraz PostgreSQL. Hasla nie sa zapisywane w aplikacji ani w `localStorage`.

1. Utworz projekt w Supabase.
2. Otworz `SQL Editor`, wklej caly plik `supabase-setup.sql` i kliknij `Run`. Dla istniejacego projektu uruchom dodatkowo migracje `supabase-user-data.sql`, `supabase-chat.sql` oraz `supabase-team-management.sql`.
3. W `Project Settings -> API` skopiuj `Project URL` oraz klucz `anon`/`publishable`.
4. Wstaw te dwie wartosci do `supabase-config.json`.
5. Wdroż funkcje `supabase/functions/bright-processor` jako Edge Function o nazwie `bright-processor`.
6. Zbuduj nowy instalator poleceniem `npm.cmd run build`. Build kopiuje instalator do `installer` i aktualizuje `updates/latest.json` dla automatycznych aktualizacji.

Pierwsza osoba rejestrujaca sie tworzy organizacje i otrzymuje role administratora. Administrator tworzy pracownikowi kompletne konto, podajac jego e-mail, haslo, role i uprawnienia. Pracownik od razu loguje sie otrzymanymi danymi i nie przechodzi rejestracji ani potwierdzania e-maila.

Wszystkie dane robocze aplikacji sa zapisywane w `user_app_data` z identyfikatorem zalogowanego uzytkownika. Dane sa odtwarzane po zalogowaniu na dowolnym komputerze, a lokalna pamiec pelni tylko role cache.

Panel zespolow zapisuje przelozonego pracownika w `organization_members.manager_member_id`, a cele miesieczne w `organization_members.monthly_goals`. Admin widzi cala organizacje, manager widzi i edytuje tylko osoby przypisane bezposrednio do siebie.

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

### Transkrypcja nagran rozmow

W panelu "Po rozmowie" mozna zamiast (albo obok) recznej notatki wgrac nagranie rozmowy (do 25 MB, plik audio) — aplikacja sama zrobi transkrypcje i wstawi ja do pola notatki, gotowa do analizy tym samym przyciskiem "Analizuj rozmowe" co dzis.

1. W Supabase wklej i uruchom `supabase-call-recordings.sql` (tworzy prywatny bucket `sales-b2b-call-recordings`, limit 25 MB, polityki RLS analogiczne do `sales-b2b-chat-files`).
2. Wdroz `supabase/functions/transcribe-call/index.ts` jako funkcje `transcribe-call` z **wlaczona weryfikacja JWT**.
3. Funkcja korzysta z tego samego sekretu `OPENAI_API_KEY` co `sales-ai` (Whisper) — nie trzeba dodawac nic nowego, jesli `sales-ai` juz dziala.

Dluzsze nagrania (powyzej ok. 60-90 minut w m4a/mp3, zaleznie od jakosci) przekrocza limit 25 MB i transkrypcja zwroci czytelny blad zamiast sie wywalic w nieskonczonosc — to twardy limit pojedynczego pliku w OpenAI Whisper API.

Ta funkcja nie wymaga dodatkowego SQL. Dostep otrzymuja tylko zalogowane, aktywne konta z `organization_members`.

### BriefAI

Osobna zakladka (obok "Firmy") na dowolne "rozmowy": handlowiec zaklada nazwana sesje, wybiera etap sprzedazy (Cold call ... Realizacja, albo dowolny miesiac wspolpracy), opcjonalnie podpina istniejaca firme z bazy, wkleja notatki tekstowe oraz zalacza pliki i zrzuty ekranu (obrazy mozna wklejac bezposrednio przez Ctrl+V). AI generuje z tego wszystkiego brief w tym samym formacie co brief przy karcie firmy, dopasowany do wybranego etapu.

1. W Supabase wklej i uruchom `supabase-brief-attachments.sql` (tworzy prywatny bucket `sales-b2b-brief-attachments`, limit 10 MB/plik, polityki RLS analogiczne do `sales-b2b-chat-files`).
2. Wdroz `supabase/functions/briefai-generate/index.ts` jako funkcje `briefai-generate` z **wlaczona weryfikacja JWT**.
3. Funkcja korzysta z tego samego sekretu `OPENAI_API_KEY` co `sales-ai` — nie trzeba dodawac nic nowego.

Obsluguje zalaczniki obrazkowe (wysylane do modelu jako wejscie wizualne — model "czyta" tresc zrzutu ekranu) oraz male pliki tekstowe (.txt/.csv, do 50 KB tresci). Inne typy plikow (PDF, DOCX itd.) sa odrzucane z czytelnym komunikatem — nie sa wspierane w tej wersji. Limit to 5 zalacznikow na rozmowe.

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

## Cold Mailing (Operio)

Zakladka `Cold Mailing` to pipeline cold outreachu dla wlasnej dzialalnosci Operio: wyszukiwanie ICP przez Apollo, wzbogacenie kontaktu, AI-owa sekwencja 3 maili (Dzien 0 / +3 / +10) wedlug wewnetrznego skryptu Operio, i wysylka przez Instantly.ai (skrzynka `oliwer@operio-consulting.pl`, ktora odpowiada juz za rozgrzewke i deliverability). Aplikacja nie wysyla maili sama — generuje tresc i przekazuje leada do gotowej kampanii Instantly, ktora odpala caly harmonogram.

### Jednorazowa konfiguracja

1. W Instantly stworz **jedna kampanie** (np. "Operio Cold Outreach") z dokladnie 3 krokami wysylanymi Dzien 0 / +3 / +10, skrzynka `oliwer@operio-consulting.pl`. Tresc kazdego kroku ustaw jako **czyste merge-tagi**, bo pelny, unikalny tekst per-lead generuje i wysyla aplikacja jako `custom_variables`:
   - Krok 1: temat `{{subject1}}`, tresc `{{body1}}`
   - Krok 2: temat `{{subject2}}`, tresc `{{body2}}`
   - Krok 3: temat `{{subject3}}`, tresc `{{body3}}`
2. Skopiuj `campaign_id` tej kampanii (widoczny w URL/ustawieniach kampanii w Instantly) i wklej go w zakladce `Cold Mailing -> Instantly - ID kampanii`.
3. W Instantly utworz API key (`Settings -> Integrations -> API Keys`) i dodaj go w Supabase jako sekret `INSTANTLY_API_KEY`.
4. Wdroz `supabase/functions/cold-email-generate` jako funkcje `cold-email-generate` z **wlaczona weryfikacja JWT** (korzysta z sekretu `OPENAI_API_KEY`, tak samo jak `sales-ai`).
5. Wdroz `supabase/functions/instantly-push` jako funkcje `instantly-push` z **wlaczona weryfikacja JWT** (obie funkcje wywoluje wylacznie zalogowana aplikacja).

### Jak to dziala

Przycisk "Szukaj klientow Operio" wysyla do Apollo filtry ICP wpisane na sztywno w aplikacji (polskie MSP 10-80 pracownikow, branze handel/uslugi B2B/produkcja/IT/finanse/spedycja, decydenci CEO/Wlasciciel/Dyrektor Sprzedazy/COO) i dopisuje znalezione firmy do tej samej listy `companies`, co zwykly generator Apollo. Przycisk "Decydenci" przy firmie to ten sam modal co w zakladce Firmy — po pobraniu e-maila kontaktu pojawia sie przycisk "Generuj cold email", ktory otwiera edytowalne 3 szkice (mozna poprawic temat/tresc przed wyslaniem). "Wyslij do Instantly" tworzy leada w skonfigurowanej kampanii z tresciami jako `custom_variables` — od tego momentu Instantly sam pilnuje harmonogramu wysylki, bez dalszych klikniec w aplikacji. Status "W sekwencji Instantly" jest zapisywany w rekordzie firmy, zeby nie wyslac tego samego kontaktu dwa razy.

## Maile (Gmail)

Zakladka `Maile` pozwala kazdemu pracownikowi podlaczyc wlasna skrzynke Google Workspace (np. `imie.nazwisko@operio-consulting.pl`) i czytac oraz wysylac maile bez wychodzenia z aplikacji. Kazdy pracownik loguje sie do swojego wlasnego konta Google osobno (OAuth2) — nie ma trybu "polacz wszystkich naraz". Tokeny dostepu kazdego pracownika sa widoczne wylacznie dla niego samego, rowniez dla administratora organizacji (celowo, patrz komentarz w `supabase-gmail.sql`).

### Jednorazowa konfiguracja (Google Cloud)

1. Zaloz projekt w [Google Cloud Console](https://console.cloud.google.com/) (albo uzyj istniejacego).
2. Wlacz **Gmail API** (`APIs & Services -> Library -> Gmail API -> Enable`).
3. `APIs & Services -> OAuth consent screen`: ustaw **User Type = Internal** (dostepne, bo organizacja korzysta z prawdziwego Google Workspace na domenie `operio-consulting.pl`) — dzieki temu Google nie wymaga weryfikacji aplikacji ani listy testerow, a tokeny nie wygasaja po 7 dniach.
4. `APIs & Services -> Credentials -> Create Credentials -> OAuth client ID`, typ **Desktop app**. Po utworzeniu skopiuj **Client ID** i **Client Secret**.
5. Uzupelnij `google-oauth-config.json` w repo: wklej `clientId`. **Client Secret nigdy nie trafia do tego pliku ani do aplikacji desktopowej** — idzie wylacznie jako sekret Edge Function w kroku 8.

### Jednorazowa konfiguracja (Supabase)

6. W `SQL Editor` wklej i uruchom `supabase-gmail.sql` (tworzy tabele `gmail_accounts` z RLS ograniczonym wylacznie do wlasciciela konta — bez wyjatku dla admina/managera, w odroznieniu od `user_app_data`).
7. W `Edge Functions -> Secrets` dodaj sekrety `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET` (te same wartosci co w kroku 4).
8. Wdroz `supabase/functions/gmail-oauth-exchange` jako funkcje `gmail-oauth-exchange` z **wlaczona weryfikacja JWT**.
9. Wdroz `supabase/functions/gmail-api` jako funkcje `gmail-api` z **wlaczona weryfikacja JWT**.

### Nadanie dostepu pracownikom

10. W zakladce `Zespol -> Edytuj pracownika` zaznacz uprawnienie **Maile** w sekcji "Dostep do sekcji". Dopiero wtedy pracownik zobaczy zakladke.

### Jak to dziala

Przycisk "Polacz Gmail" otwiera systemowa przegladarke z ekranem logowania Google (aplikacja desktopowa uruchamia tymczasowy lokalny serwer na wolnym porcie, zeby odebrac kod autoryzacji — nie wymaga to zadnej dodatkowej konfiguracji sieciowej). Po zalogowaniu aplikacja pokazuje liste watkow z Odebranych, pozwala odpowiadac w watku (z zachowaniem `In-Reply-To`/`References`, wiec odpowiedz trafia do tego samego watku w Gmailu) oraz pisac nowe wiadomosci, z zalacznikami do 10 MB/plik (max 5 na wiadomosc). Aplikacja nie przechowuje tresci maili — kazde otwarcie watku pobiera aktualne dane bezposrednio z Gmail API.

## Strona Operio (operio-site)

Folder `operio-site` to publiczna strona wizytowkowa "Operio" (zewnetrzny dzial rozwoju sprzedazy dla MSP). To osobny projekt statyczny, niezalezny od apki desktopowej, mysli o wlasnej domenie. Kazdy przycisk "Umow rozmowe" otwiera modal z formularzem i kalendarzem terminow.

Formularz zapisuje rezerwacje przez Edge Function `operio-booking` (Supabase), a nie przez lokalny serwer apki. Apka desktopowa Sales B2B odbiera te rezerwacje automatycznie:

1. W Supabase wklej i uruchom `supabase-operio-bookings.sql` (tworzy tabele `operio_bookings` z wlaczonym RLS bez publicznych polityk, plus kolumne `imported_at` do sledzenia importu).
2. Wdroz `supabase/functions/operio-booking/index.ts` jako funkcje `operio-booking` z **wylaczona weryfikacja JWT** (formularz wypelniaja anonimowi odwiedzajacy, ktorzy nie sa zalogowani do apki). Ta funkcja tylko zapisuje rezerwacje do tabeli.
3. Wdroz `supabase/functions/operio-bookings-pending/index.ts` jako funkcje `operio-bookings-pending` z **wlaczona weryfikacja JWT** (wywoluje ja wylacznie zalogowana apka Sales B2B). Ta funkcja zwraca niezaimportowane rezerwacje i oznacza je jako zaimportowane.
4. Obie funkcje korzystaja z sekretu `SUPABASE_SERVICE_ROLE_KEY`, ktory Supabase ustawia automatycznie dla kazdej Edge Function.

Zalogowana apka odpytuje `operio-bookings-pending` co 60 sekund (`main.js`) i kazda nowa rezerwacje dodaje do lokalnej listy bookingow zalogowanego uzytkownika — dokladnie tak, jak wczesniej robil to lokalny serwer na porcie `3721`, tylko teraz dziala to z dowolnego miejsca w internecie, nie tylko z tego samego komputera.

### Wdrozenie na Vercel i podpiecie domeny

1. Zaimportuj repozytorium w Vercel, a w ustawieniach projektu ustaw **Root Directory** na `operio-site`. Framework Preset: `Other` (strona jest statycznym `index.html`).
2. Po pierwszym deployu wejdz w `Project Settings -> Domains`, dodaj docelowa domene (np. `operio.pl`) i postepuj wedlug instrukcji Vercel — zwykle rekord `A` na `76.76.21.21` dla domeny glownej lub `CNAME` na `cname.vercel-dns.com` dla subdomeny, ustawiony u rejestratora domeny.
3. Zaktualizuj w `operio-site/index.html` oraz `operio-site/robots.txt` adres `https://operio.pl/` na docelowa domene, jesli bedzie inna.
4. Certyfikat SSL Vercel wystawia automatycznie po propagacji DNS.

Lokalny serwer w `main.js` (port `3721`) zostal zachowany tylko jako narzedzie deweloperskie do lokalnych testow — publiczna strona go nie uzywa.

## Uruchomienie

Najprosciej: pobierz gotowy instalator z folderu `installer`:

```text
installer/Sales-B2B-Setup-1.5.6.exe
```

Po pobraniu uruchom plik `.exe` i przejdz instalacje.

## Automatyczne aktualizacje

Od wersji `1.5.5` aplikacja po starcie sprawdza publiczny plik `updates/latest.json` na GitHubie. Jesli pojawi sie nowsza wersja, uzytkownik zobaczy powiadomienie w aplikacji i moze pobrac oraz uruchomic instalator bez szukania pliku recznie.

Przy kazdej kolejnej wersji:

1. Podbij wersje w `package.json`, np. `npm.cmd version 1.5.6 --no-git-tag-version`.
2. Uruchom `npm.cmd run build`.
3. Commituj i pushuj zmienione `package.json`, `package-lock.json`, `installer/Sales-B2B-Setup-x.x.x.exe` oraz `updates/latest.json`.

Uzytkownicy starsi niz `1.5.5` musza raz zainstalowac `1.5.5` recznie. Potem kolejne wersje beda juz wykrywane z poziomu aplikacji.

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
