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
import { serverTimestamp } from 'firebase/firestore';
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
        allowSelfRegistration: true,
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
        allowSelfRegistration: true,
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

    // 11. Mismatched Punch Arrays -> DENIED
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
        isSelfRegistered: false,
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
  } finally {
    await testEnv.cleanup();
  }
}
