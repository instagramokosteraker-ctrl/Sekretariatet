hej!

## Eventor-integration

Eventor API-nyckel, organisations-ID och Base URL hanteras under **Klubbadmin & Behörighet → Eventor-integration**. Inställningarna lagras i `clubSettings/default/private/eventor` i Firestore. Firestore-reglerna begränsar dokumentet till `SUPER_ADMIN` och `RACE_ADMIN`; API-nyckeln returneras aldrig i vanliga app- eller statuspayloads.

Administratörer kan testa anslutningen från samma vy. Om en äldre servermiljö fortfarande har `EVENTOR_API_KEY` kan den migreras därifrån efter att organisations-ID:t är sparat. Efter lyckad migrering ska `EVENTOR_API_KEY` och eventuell `EVENTOR_BASE_URL` tas bort från server-/AI Studio Secrets och konfigurationen verifieras igen i PasserSI. De används därefter endast av den uttryckliga migreringsfunktionen, inte av Eventor-anropen.

## Google-inloggning och roller

Alla nya sekretariatsinloggningar använder Google via Firebase Auth. Klubbroller (`SUPER_ADMIN`, `RACE_ADMIN`) ligger i `admins/{uid}`. Funktionärsroller (`START`, `READOUT`, `FOREST`, `SPEAKER`) delas ut med e-postinbjudan i **Klubbadmin & Behörighet** och aktiveras av användaren vid inloggning med samma Google-konto. Tilldelningar lagras i `roleAssignments/{uid}`; inbjudningar ligger i `roleInvites/{inviteId}`. Publicera Firestore-reglerna innan rollinbjudningar används.

PIN- och offlinekodskoden finns kvar tillfälligt men är avstängd som standard. För en kontrollerad kompatibilitetsperiod måste både `VITE_ENABLE_LEGACY_PIN_AUTH=true` vid frontend-bygget och `LEGACY_PIN_AUTH_ENABLED=true` på Express-servern vara aktiverade. Håll dem avstängda efter migrering; inloggningar med PIN/offline-kod och deras API-anrop avvisas annars. Publik auth-metadata lämnar inte längre ut standard-PIN:er eller reservkoder.
