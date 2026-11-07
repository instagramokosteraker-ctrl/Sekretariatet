hej!

## Eventor-integration

Eventor API-nyckel, organisations-ID och Base URL hanteras under **Klubbadmin & Behörighet → Eventor-integration**. Inställningarna lagras i `clubSettings/default/private/eventor` i Firestore. Firestore-reglerna begränsar dokumentet till `SUPER_ADMIN` och `RACE_ADMIN`; API-nyckeln returneras aldrig i vanliga app- eller statuspayloads.

Administratörer kan testa anslutningen från samma vy. Om en äldre servermiljö fortfarande har `EVENTOR_API_KEY` kan den migreras därifrån efter att organisations-ID:t är sparat. Efter lyckad migrering ska `EVENTOR_API_KEY` och eventuell `EVENTOR_BASE_URL` tas bort från server-/AI Studio Secrets och konfigurationen verifieras igen i PasserSI. De används därefter endast av den uttryckliga migreringsfunktionen, inte av Eventor-anropen.
