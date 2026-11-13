hej!

## Eventor-integration

Eventor API-nyckel, organisations-ID och Base URL hanteras under **Klubbadmin & Behörighet → Eventor-integration** och lagras i webbläsarens `localStorage` på den aktuella enheten. De skickas till backend endast när administratören testar anslutningen eller synkroniserar klubben; backend använder uppgifterna för Eventor-anrop och sparar dem inte i Firestore.

Inställningarna är separata för varje webbläsare/enhet. Administratörer kan testa anslutningen från samma vy.

## Google-inloggning och roller

Alla nya sekretariatsinloggningar använder Google via Firebase Auth. Klubbroller (`SUPER_ADMIN`, `RACE_ADMIN`) ligger i `admins/{uid}`. Funktionärsroller (`START`, `READOUT`, `FOREST`, `SPEAKER`) delas ut med e-postinbjudan i **Klubbadmin & Behörighet** och aktiveras av användaren vid inloggning med samma Google-konto. Tilldelningar lagras i `roleAssignments/{uid}`; inbjudningar ligger i `roleInvites/{inviteId}`. Publicera Firestore-reglerna innan rollinbjudningar används.

PIN- och offlinekodsinloggning har tagits bort. Sekretariatsåtkomst använder Google via Firebase Auth och Firestore-roller.
