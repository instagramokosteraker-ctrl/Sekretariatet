/**
 * Zero-Trust Firestore Security Rules Test Suite
 * Verifies security_spec adversarial payloads and write-once readout receipts.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const PROJECT_ID = 'demo-passersi-rules-test';

export async function runFirestoreRulesDirtyDozenSuite(): Promise<void> {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const now = new Date();

    // Seed baseline fixtures with rules disabled
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await adminDb.doc('admins/race_admin_1').set({
        uid: 'race_admin_1',
        displayName: 'Anna Tävlingsledare',
        role: 'RACE_ADMIN',
        inviteId: 'inv_anna',
        createdAt: now,
        updatedAt: now,
      });
      await adminDb.doc('admins/race_admin_2').set({
        uid: 'race_admin_2',
        displayName: 'Erik Tävlingsledare',
        role: 'RACE_ADMIN',
        inviteId: 'inv_erik',
        createdAt: now,
        updatedAt: now,
      });
      await adminDb.doc('adminInvites/inv_other').set({
        inviteId: 'inv_other',
        email: 'secret@klubb.se',
        displayName: 'Hemlig Ledare',
        role: 'RACE_ADMIN',
        active: true,
        createdByUid: 'super_1',
        createdAt: now,
        updatedAt: now,
      });
      await adminDb.doc('adminInvites/inv_anna').set({
        inviteId: 'inv_anna',
        email: 'anna@klubb.se',
        displayName: 'Anna Tävlingsledare',
        role: 'RACE_ADMIN',
        active: true,
        createdByUid: 'super_1',
        createdAt: now,
        updatedAt: now,
      });
      await adminDb.doc('competitions/evt_live').set({
        competitionId: 'evt_live',
        shortCode: 'oko26a',
        name: 'Torsdagsträning',
        organizer: 'OK Österåker',
        date: '2026-05-14',
        status: 'LIVE',
        zeroTimeStr: '18:00:00',
        zeroTimeSec: 64800,
        arenaInfo: 'Klubbstugan',
        seriesName: 'Torsdagsserien',
        enableFeesAndSwish: false,
        competitorCount: 10,
        finishedCount: 5,
        brokenControls: [],
        pinStart: '1100',
        pinReadout: '2200',
        pinForest: '3300',
        pinSpeaker: '4400',
        pinsCustomized: false,
        ownerUid: 'race_admin_1',
        createdAt: now,
        updatedAt: now,
      });
      await adminDb.doc('competitions/evt_done').set({
        competitionId: 'evt_done',
        shortCode: 'oko26z',
        name: 'Avslutad KM',
        organizer: 'OK Österåker',
        date: '2026-05-01',
        status: 'COMPLETED',
        zeroTimeStr: '10:00:00',
        zeroTimeSec: 36000,
        arenaInfo: '',
        seriesName: '',
        allowSelfRegistration: false,
        enableFeesAndSwish: false,
        competitorCount: 40,
        finishedCount: 38,
        brokenControls: [],
        pinStart: '1100',
        pinReadout: '2200',
        pinForest: '3300',
        pinSpeaker: '4400',
        pinsCustomized: false,
        ownerUid: 'race_admin_1',
        createdAt: now,
        updatedAt: now,
      });
    });

    const attackerCtx = testEnv.authenticatedContext('attacker_uid', {
      email: 'attacker@example.com',
      email_verified: true,
    });
    const unverifiedBossCtx = testEnv.authenticatedContext('spoof_uid', {
      email: 'instagram.okosteraker@gmail.com',
      email_verified: false,
    });
    const raceAdminCtx = testEnv.authenticatedContext('race_admin_1', {
      email: 'anna@klubb.se',
      email_verified: true,
    });
    const otherRaceAdminCtx = testEnv.authenticatedContext('race_admin_2', {
      email: 'erik@klubb.se',
      email_verified: true,
    });

    // Eventor credentials are held only in the admin-restricted private subcollection.
    await assertFails(
      attackerCtx.firestore().doc('clubSettings/default/private/eventor').get()
    );
    await assertSucceeds(
      raceAdminCtx.firestore().doc('clubSettings/default/private/eventor').set({
        apiKey: 'secret-eventor-key',
        orgId: '1234',
        baseUrl: 'https://eventor.orientering.se/api',
      })
    );
    await assertSucceeds(
      raceAdminCtx.firestore().doc('clubSettings/default/private/eventor').get()
    );
    await assertFails(
      attackerCtx.firestore().doc('clubSettings/default/private/eventor').get()
    );
    await assertFails(
      attackerCtx.firestore().doc('clubSettings/default/private/eventor').set({
        apiKey: 'attacker-key',
      })
    );

    // 1. Self-Assigned Admin Escalation -> DENIED
    await assertFails(
      attackerCtx.firestore().doc('admins/attacker_uid').set({
        uid: 'attacker_uid',
        displayName: 'Attacker',
        role: 'SUPER_ADMIN',
        inviteId: 'bootstrap_super_admin',
        createdAt: now,
        updatedAt: now,
      })
    );

    // Official roles are issued only from an admin-created email invite.
    const roleInvite = raceAdminCtx.firestore().doc('roleInvites/inv_official');
    await assertSucceeds(
      roleInvite.set({
        inviteId: 'inv_official',
        email: 'official@klubb.se',
        displayName: 'Klubbfunktionär',
        role: 'START',
        active: true,
        createdByUid: 'race_admin_1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    const officialCtx = testEnv.authenticatedContext('official_uid', {
      email: 'official@klubb.se',
      email_verified: true,
    });
    await assertSucceeds(officialCtx.firestore().doc('roleInvites/inv_official').get());
    await assertFails(officialCtx.firestore().collection('roleAssignments').get());
    await assertFails(
      attackerCtx.firestore().doc('roleAssignments/attacker_uid').set({
        uid: 'attacker_uid',
        inviteId: 'inv_missing',
        email: 'attacker@example.com',
        displayName: 'Attacker',
        role: 'SUPER_ADMIN',
        createdByUid: 'attacker_uid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    const claimBatch = writeBatch(officialCtx.firestore());
    claimBatch.set(doc(officialCtx.firestore(), 'roleAssignments/official_uid'), {
      uid: 'official_uid',
      inviteId: 'inv_official',
      email: 'official@klubb.se',
      displayName: 'Klubbfunktionär',
      role: 'START',
      createdByUid: 'race_admin_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    claimBatch.update(doc(officialCtx.firestore(), 'roleInvites/inv_official'), {
      active: false,
      claimedUid: 'official_uid',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(claimBatch.commit());
    await assertSucceeds(officialCtx.firestore().doc('roleAssignments/official_uid').get());

    // 2. Unverified Email Spoof -> DENIED
    await assertFails(unverifiedBossCtx.firestore().doc('admins/spoof_uid').get());

    // 3. Shadow Ghost Field Injection -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/evt_live').update({
        name: 'Ny titel',
        isOfficial: true,
      })
    );

    // 4. Privilege Escalation via Self-Update -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('admins/race_admin_1').update({
        role: 'SUPER_ADMIN',
        updatedAt: now,
      })
    );

    // 5. PII Invite Scraping -> DENIED
    await assertFails(attackerCtx.firestore().doc('adminInvites/inv_other').get());

    // An invited admin can consume only their own active invite after claiming admin status.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('adminInvites/inv_anna').update({
        active: false,
        claimedUid: 'race_admin_1',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      attackerCtx.firestore().doc('adminInvites/inv_other').update({
        active: false,
        updatedAt: serverTimestamp(),
      })
    );

    // 6. ID Poisoning -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/bad$id!').set({
        competitionId: 'bad$id!',
      })
    );

    // New competitions no longer include the mobile self-registration setting.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_new').set({
        competitionId: 'evt_new',
        shortCode: 'nw26',
        name: 'Ny tävling',
        organizer: 'OK Österåker',
        date: '2026-06-01',
        status: 'UPCOMING',
        zeroTimeStr: '10:00:00',
        zeroTimeSec: 36000,
        arenaInfo: '',
        seriesName: '',
        enableFeesAndSwish: false,
        competitorCount: 0,
        finishedCount: 0,
        brokenControls: [],
        pinStart: '1100',
        pinReadout: '2200',
        pinForest: '3300',
        pinSpeaker: '4400',
        pinsCustomized: false,
        ownerUid: 'race_admin_1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 7. Identity Spoofing (ownerUid) -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/evt_spoof').set({
        competitionId: 'evt_spoof',
        shortCode: 'sp26',
        name: 'Spoof',
        organizer: 'OK',
        date: '2026-06-01',
        status: 'LIVE',
        zeroTimeStr: '10:00:00',
        zeroTimeSec: 36000,
        arenaInfo: '',
        seriesName: '',
        enableFeesAndSwish: false,
        competitorCount: 0,
        finishedCount: 0,
        brokenControls: [],
        pinStart: '1100',
        pinReadout: '2200',
        pinForest: '3300',
        pinSpeaker: '4400',
        pinsCustomized: false,
        ownerUid: 'someone_else',
        createdAt: now,
        updatedAt: now,
      })
    );

    // Older competition documents without controlTimeOffsets remain writable.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_live').update({
        competitorCount: 11,
        finishedCount: 6,
        updatedAt: serverTimestamp(),
      })
    );

    // Competition counters and control offsets are allowed on active races.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_live').update({
        competitorCount: 12,
        finishedCount: 6,
        controlTimeOffsets: { '42': -3 },
        updatedAt: serverTimestamp(),
      })
    );

    // 8. Terminal State Bypass on COMPLETED competition -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/evt_done').update({
        competitorCount: 99,
        updatedAt: now,
      })
    );

    await assertFails(
      raceAdminCtx.firestore().doc('competitions/evt_done').update({
        status: 'LIVE',
        statusOverride: true,
        competitorCount: 99,
        updatedAt: serverTimestamp(),
      })
    );

    // Reopening a completed competition is allowed only as a status-only change.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_done').update({
        status: 'LIVE',
        statusOverride: true,
        updatedAt: serverTimestamp(),
      })
    );

    // 9. Timestamp Forgery -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('clubSettings/default').set({
        settingId: 'default',
        clubName: 'OK Linné',
        eventorOrgId: '',
        swishNumber: '1234567890',
        swishRecipientName: 'OK Linné',
        defaultDirectEntryFeeSek: 100,
        rentalCardFeeSek: 30,
        missingRentalFeeSek: 650,
        activeEventId: 'evt_live',
        demoCleared: false,
        competitionIds: [],
        ownerUid: 'race_admin_1',
        createdAt: new Date(2020, 1, 1),
        updatedAt: new Date(2020, 1, 1),
      })
    );

    // 10. Orphaned Subcollection Write (Master Gate Bypass) -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/ghost_evt/courses/crs_1').set({
        courseId: 'crs_1',
        competitionId: 'ghost_evt',
        name: 'Bana 1',
        lengthMeters: 3000,
        climbMeters: 50,
        controls: [31, 32, 100],
        ownerUid: 'race_admin_1',
        createdAt: now,
        updatedAt: now,
      })
    );

    // 11. Regular entries do not need the removed mobile self-registration marker.
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_live/competitors/cmp_valid').set({
        competitorId: 'cmp_valid',
        competitionId: 'evt_live',
        bib: 101,
        fullName: 'Test Löpare',
        club: 'OK Linné',
        classId: 'cls_1',
        siNumber: 8500111,
        cardSeries: 'SI-Card 10',
        isRentalCard: false,
        rentalReturned: false,
        feePaid: false,
        status: 'REGISTERED',
        allocatedStartSec: -1,
        checkTimeSec: -1,
        startTimeSec: -1,
        finishTimeSec: -1,
        manualFinishTimeSec: -1,
        runningTimeSec: -1,
        readoutAtIso: '',
        punchCodes: [],
        punchTimes: [],
        ownerUid: 'race_admin_1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 12. Mismatched Punch Arrays -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('competitions/evt_live/competitors/cmp_1').set({
        competitorId: 'cmp_1',
        competitionId: 'evt_live',
        bib: 101,
        fullName: 'Test Löpare',
        club: 'OK Linné',
        classId: 'cls_1',
        siNumber: 8500111,
        cardSeries: 'SI-Card 10',
        isRentalCard: false,
        rentalReturned: false,
        feePaid: true,
        status: 'OK',
        allocatedStartSec: -1,
        checkTimeSec: 36000,
        startTimeSec: 36100,
        finishTimeSec: 37500,
        manualFinishTimeSec: -1,
        runningTimeSec: 1400,
        readoutAtIso: '',
        punchCodes: [31, 32],
        punchTimes: [36500],
        ownerUid: 'race_admin_1',
        createdAt: now,
        updatedAt: now,
      })
    );

    // 12. Blanket List Query Scraping -> DENIED
    await assertFails(attackerCtx.firestore().collection('competitions').get());

    // 13. SVG XSS / Invalid Hex Color Poisoning on clubSettings/default -> DENIED
    await assertFails(
      raceAdminCtx.firestore().doc('clubSettings/default').set({
        settingId: 'default',
        clubName: 'OK Linné',
        eventorOrgId: '',
        swishNumber: '',
        swishRecipientName: 'OK Linné',
        defaultDirectEntryFeeSek: 100,
        rentalCardFeeSek: 30,
        missingRentalFeeSek: 650,
        logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
        customBgColor: 'javascript:alert(1)',
        activeEventId: 'evt_live',
        demoCleared: false,
        competitionIds: [],
        ownerUid: 'race_admin_1',
        createdAt: now,
        updatedAt: now,
      })
    );

    // Per-series scoring settings are accepted by the club settings document
    await assertSucceeds(
      raceAdminCtx.firestore().doc('clubSettings/default').set({
        settingId: 'default',
        clubName: 'OK Linné',
        eventorOrgId: '',
        swishNumber: '',
        swishRecipientName: 'OK Linné',
        defaultDirectEntryFeeSek: 100,
        rentalCardFeeSek: 30,
        missingRentalFeeSek: 650,
        seriesScoringSettings: {
          'Vårserien': {
            model: 'PLACEMENT',
            placementPoints: [10, 8, 6, 5, 4, 3, 2, 1],
            participationPoints: 1,
          },
        },
        activeEventId: 'evt_live',
        demoCleared: false,
        competitionIds: [],
        ownerUid: 'race_admin_1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      otherRaceAdminCtx.firestore().doc('clubSettings/default').update({
        eventorOrgId: '1234',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      otherRaceAdminCtx.firestore().doc('clubSettings/default').update({
        clubName: 'Unauthorized profile change',
        updatedAt: serverTimestamp(),
      })
    );

    // Positive sanity check: Valid owner read succeeds
    await assertSucceeds(raceAdminCtx.firestore().doc('competitions/evt_live').get());

    const runnerDbEntry = {
      runnerId: '8500111',
      siNumber: 8500111,
      cardSeries: 'SI-Card 10',
      fullName: 'Test Löpare',
      club: 'OK Österåker',
      birthYear: 2000,
      defaultClassName: 'D21',
      eventorPersonId: '',
      eventorOrgId: '',
      source: 'EVENTOR_XML',
      updatedAtIso: new Date().toISOString(),
      ownerUid: 'race_admin_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(
      raceAdminCtx.firestore().doc('runnerDb/8500111').set(runnerDbEntry)
    );
    await assertFails(attackerCtx.firestore().collection('runnerDb').get());
    await assertFails(
      raceAdminCtx.firestore().doc('runnerDb/8500111').update({
        source: 'UNTRUSTED',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(attackerCtx.firestore().doc('runnerDb/8500111').delete());
    await assertSucceeds(raceAdminCtx.firestore().doc('runnerDb/8500111').delete());

    // Readout receipts are write-once and restricted to the verified competition admin
    const receipt = {
      receiptId: 'ro_test_1',
      competitionId: 'evt_live',
      ownerUid: 'race_admin_1',
      clientReadoutId: 'ro_test_1',
      siNumber: 8500111,
      cardSeries: 'SI-Card 10',
      stationCode: 1,
      checkTimeSec: -1,
      startTimeSec: 36000,
      finishTimeSec: 37500,
      punchCodes: [31],
      punchTimes: [36500],
      rawHex: '',
      status: 'PROCESSED',
      competitorId: 'cmp_1',
      createdAt: serverTimestamp(),
    };
    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/readoutReceipts/ro_test_1')
        .set(receipt)
    );
    await assertFails(
      attackerCtx
        .firestore()
        .doc('competitions/evt_live/readoutReceipts/ro_attacker')
        .set({
          ...receipt,
          receiptId: 'ro_attacker',
          clientReadoutId: 'ro_attacker',
          ownerUid: 'attacker_uid',
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/readoutReceipts/ro_test_1')
        .update({ status: 'UNKNOWN' })
    );
    await assertSucceeds(
      raceAdminCtx.firestore().collection('competitions/evt_live/readoutReceipts').get()
    );
    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/readoutReceipts/ro_test_1')
        .delete()
    );

    const station = {
      stationId: 'st_42',
      competitionId: 'evt_live',
      ownerUid: 'race_admin_1',
      stationCode: 42,
      name: 'K42',
      hardwareModel: 'SRR-USB (Air+)',
      stationFunction: 'RADIO',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3500,
      firmware: '',
      lastSeenAt: '',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(
      raceAdminCtx.firestore().doc('competitions/evt_live/stations/st_42').set(station)
    );
    await assertSucceeds(
      raceAdminCtx.firestore().collection('competitions/evt_live/stations').get()
    );
    await assertFails(
      attackerCtx.firestore().collection('competitions/evt_live/stations').get()
    );
    await assertFails(
      attackerCtx.firestore().doc('competitions/evt_live/stations/st_43').set({
        ...station,
        stationId: 'st_43',
        ownerUid: 'attacker_uid',
      })
    );

    const stationPunch = {
      punchId: 'op_test_1',
      competitionId: 'evt_live',
      ownerUid: 'race_admin_1',
      clientPunchId: 'op_test_1',
      siNumber: 8500111,
      stationCode: 42,
      punchTimeSec: 36500,
      rawHex: '',
      stationName: 'K42',
      stationFunction: 'RADIO',
      competitorId: 'cmp_1',
      runningTimeSec: 500,
      isPrewarning: false,
      createdAt: serverTimestamp(),
    };
    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_test_1')
        .set(stationPunch)
    );
    await assertSucceeds(
      officialCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_official')
        .set({
          ...stationPunch,
          punchId: 'op_official',
          clientPunchId: 'op_official',
          ownerUid: 'official_uid',
          stationFunction: 'RADIO',
          createdAt: serverTimestamp(),
        })
    );
    await assertFails(
      officialCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_forbidden')
        .set({
          ...stationPunch,
          punchId: 'op_forbidden',
          clientPunchId: 'op_forbidden',
          ownerUid: 'official_uid',
          stationFunction: 'FINISH',
          createdAt: serverTimestamp(),
        })
    );
    await assertSucceeds(
      raceAdminCtx.firestore().collection('competitions/evt_live/stationPunches').get()
    );
    await assertFails(
      attackerCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_attacker')
        .set({
          ...stationPunch,
          punchId: 'op_attacker',
          clientPunchId: 'op_attacker',
          ownerUid: 'attacker_uid',
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_test_1')
        .update({ stationCode: 43 })
    );
    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/stationPunches/op_test_1')
        .delete()
    );
  } finally {
    await testEnv.cleanup();
  }
}
