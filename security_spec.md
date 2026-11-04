# PasserSI — Zero-Trust Firestore Security Specification

## 1. Data Invariants & Relational Ownership

1. **Default-Deny Catch-All**: All Firestore paths are closed by default (`match /{document=**} { allow read, write: if false; }`). Zero unauthenticated reads or writes are permitted.
2. **Verified Google Identity**: Every read and write operation requires `request.auth != null && request.auth.token.email_verified == true`.
3. **RBAC & Bootstrapped Primary Admin**:
   - `instagram.okosteraker@gmail.com` (and legacy `marcus.o.ahlen@gmail.com`, verified) is the bootstrapped `SUPER_ADMIN`.
   - Additional administrators cannot self-assign `/admins/{userId}` unless an active `/adminInvites/{inviteId}` exists matching their verified `request.auth.token.email` and exact `role`.
   - Non-Super-Admins cannot escalate their `role` to `SUPER_ADMIN` or create `SUPER_ADMIN` invites.
4. **PII Split-Collection Isolation**:
   - `/admins/{userId}` stores only non-PII fields (`uid`, `displayName`, `role`, `inviteId`, `createdAt`, `updatedAt`).
   - `/adminInvites/{inviteId}` isolates `email` and restricts `get` strictly to the invited recipient (`resource.data.email == request.auth.token.email`) or verified club admins (`isAdmin()`). `list` is strictly restricted to `resource.data.createdByUid == request.auth.uid`.
5. **Club Settings Singleton (`/clubSettings/{settingId}`)**:
   - Only `settingId == 'default'` is permitted. `list` is forbidden (`false`). Only verified admins can read/write, with strict numeric bounds on Swish and rental card fees, strict `#RRGGBB` hex validation on optional theme colors (`customBgColor`, `customTextColor`, `customAccentColor`), `<= 80` char limit on `portalTitle`, and strict `<= 200000` char / `data:image/(png|jpeg);base64,` validation on `logoDataUrl` (preventing oversized documents and SVG XSS).
6. **Master Gate & Subcollection Sync (`courses`, `classes`, `competitors`, `stations`, `readoutReceipts`, `stationPunches` under `/competitions/{competitionId}`)**:
   - Every write to a competition subcollection verifies parent competition existence and ownership. `courses`, `classes`, `competitors`, and `stations` also enforce parent Terminal State Locking (`status != 'COMPLETED'`) unless `isSuperAdmin()`.
   - Readout receipts and online station punches are write-once, admin-scoped, and idempotent. Neither collection permits updates or deletes.
   - Owner admins may update competition counters and emergency control settings only while a competition is not completed; completed competitions remain locked except to super admins.
   - `allow list` on `/competitions` and its subcollections enforces the applicable owner/admin condition with zero `get()`/`exists()` lookups inside `list`.
7. **Total Array Guarding & Native Primitives**:
   - Zero `JSON.stringify` payloads. Course `controls` (`<= 128`), class `forkCourseIds` (`<= 32`), competition `brokenControls` (`<= 64`), and competitor/readout receipt `punchCodes`/`punchTimes` (`<= 192`, equal length) are bounded native lists with element-0 type verification.
8. **Temporal & Immutable Field Integrity**:
   - `createdAt == request.time` on `create`; `createdAt == existing().createdAt` and `updatedAt == request.time` on `update`. Primary IDs and `ownerUid`/`createdByUid` are immutable.
9. **Runner Database (`/runnerDb/{siNumber}`)**:
   - Only verified admins can read, write, or delete runner records. The document ID is the SI number, the validated payload is allow-listed, and the original owner/creation timestamp cannot be changed.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Self-Assigned Admin Escalation**: Uninvited verified user writes `/admins/{uid}` with `{ role: "SUPER_ADMIN", inviteId: "bootstrap_super_admin" }`.
2. **Unverified Email Spoof**: Attacker with `email: "instagram.okosteraker@gmail.com"` and `email_verified: false` attempts to read or create `/admins/{uid}` or `/clubSettings/default`.
3. **Shadow Ghost Field Injection**: Admin sends valid `/competitions/evt_1` update plus extra `{ isOfficial: true }` shadow property.
4. **Privilege Escalation via Self-Update**: `RACE_ADMIN` updates their own `/admins/{uid}` document changing `role` from `"RACE_ADMIN"` to `"SUPER_ADMIN"`.
5. **PII Invite Scraping**: Signed-in non-admin attempts `get` on `/adminInvites/inv_other` or `list` without `createdByUid == request.auth.uid`.
6. **ID Poisoning Attack**: Admin attempts `create` on `/competitions/bad$id!with spaces` or >128-char ID.
7. **Identity Spoofing (`ownerUid`)**: Admin creates `/competitions/evt_spoof` setting `ownerUid: "victim_uid"`.
8. **Terminal State Bypass**: `RACE_ADMIN` attempts `update` on a competition (or child `competitors` doc) whose status is already `'COMPLETED'`.
9. **Timestamp Forgery**: Admin creates `/clubSettings/default` with a client-forged past `createdAt` timestamp instead of `serverTimestamp()` (`request.time`).
10. **Orphaned Subcollection Write (Master Gate Bypass)**: Admin attempts to create `/competitions/non_existent_evt/competitors/cmp_1` when `/competitions/non_existent_evt` does not exist.
11. **Mismatched / Oversized Punch Arrays**: Admin writes `/competitions/evt_1/competitors/cmp_1` where `punchCodes.size() != punchTimes.size()` or `punchCodes.size() > 192`.
12. **Blanket List Query Scraping**: Authenticated user queries `collection(db, 'competitions')` without filtering `where('ownerUid', '==', uid)`.
