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
import {
  doc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
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

    // Seed legacy competition documents with PIN fields to verify the transition path.
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
      await adminDb.doc('roleAssignments/readout_uid').set({
        uid: 'readout_uid',
        role: 'READOUT',
      });
      await adminDb.doc('runnerDb/8500118').set({
        runnerId: '8500118',
        siNumber: 8500118,
        cardSeries: 'SI-Card 10',
        fullName: 'Readout Runner',
        club: 'OK Linné',
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
        feeTrackingEnabled: false,
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
    const readoutCtx = testEnv.authenticatedContext('readout_uid', {
      email: 'readout@klubb.se',
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

    // New competition documents omit legacy PIN fields and optional self-registration.
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
        feeTrackingEnabled: false,
        competitorCount: 0,
        finishedCount: 0,
        brokenControls: [],
        ownerUid: 'race_admin_1',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(raceAdminCtx.firestore().doc('competitions/evt_live').get());
    await assertSucceeds(raceAdminCtx.firestore().doc('competitions/evt_new').get());

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
        feeTrackingEnabled: false,
        competitorCount: 0,
        finishedCount: 0,
        brokenControls: [],
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

    const siCardAssignment = {
      competitionId: 'evt_live',
      siNumber: 8500111,
      cardSeries: 'SI-Card 10',
      competitorId: 'cmp_valid',
      competitorDocumentId: 'cmp_valid',
      state: 'ACTIVE',
      assignmentVersion: 1,
      source: 'DIRECT_ENTRY',
      ownerUid: 'race_admin_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    };
    const initialCompetitor = {
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
    };
    const initialCompetitorBatch = writeBatch(raceAdminCtx.firestore());
    initialCompetitorBatch.set(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/competitors/cmp_valid'),
      initialCompetitor
    );
    initialCompetitorBatch.set(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/siCardAssignments/8500111'),
      siCardAssignment
    );
    // Competitor creation is now accepted only with its matching assignment.
    await assertSucceeds(initialCompetitorBatch.commit());

    const readoutCreatedCompetitor = {
      ...initialCompetitor,
      competitorId: 'cmp_readout_test',
      bib: 411,
      fullName: 'Readout Runner',
      siNumber: 8500118,
      ownerUid: 'readout_uid',
      readoutReceiptId: 'ro_readout_test',
      status: 'OK',
    };
    const readoutCreatedAssignment = {
      ...siCardAssignment,
      siNumber: 8500118,
      competitorId: 'cmp_readout_test',
      competitorDocumentId: 'cmp_readout_test',
      source: 'READOUT',
      ownerUid: 'readout_uid',
    };
    const readoutAutocreateBatch = writeBatch(readoutCtx.firestore());
    readoutAutocreateBatch.set(
      doc(
        readoutCtx.firestore(),
        'competitions/evt_live/competitors/cmp_readout_test'
      ),
      {
        ...readoutCreatedCompetitor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    readoutAutocreateBatch.set(
      doc(
        readoutCtx.firestore(),
        'competitions/evt_live/siCardAssignments/8500118'
      ),
      {
        ...readoutCreatedAssignment,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    readoutAutocreateBatch.set(
      doc(
        readoutCtx.firestore(),
        'competitions/evt_live/readoutReceipts/ro_readout_test'
      ),
      {
        receiptId: 'ro_readout_test',
        competitionId: 'evt_live',
        ownerUid: 'readout_uid',
        clientReadoutId: 'ro_readout_test',
        siNumber: 8500118,
        cardSeries: 'SI-Card 10',
        stationCode: 1,
        checkTimeSec: -1,
        startTimeSec: -1,
        finishTimeSec: -1,
        punchCodes: [],
        punchTimes: [],
        rawHex: '',
        status: 'PROCESSED',
        competitorId: 'cmp_readout_test',
        createdAt: serverTimestamp(),
      }
    );
    readoutAutocreateBatch.update(
      doc(readoutCtx.firestore(), 'competitions/evt_live'),
      {
        competitorCount: 11,
        finishedCount: 6,
        updatedAt: serverTimestamp(),
      }
    );
    await assertSucceeds(readoutAutocreateBatch.commit());

    const spoofedReadoutAutocreate = writeBatch(readoutCtx.firestore());
    spoofedReadoutAutocreate.set(
      doc(
        readoutCtx.firestore(),
        'competitions/evt_live/competitors/cmp_readout_spoof'
      ),
      {
        ...readoutCreatedCompetitor,
        competitorId: 'cmp_readout_spoof',
        fullName: 'Spoofed Name',
        siNumber: 8500119,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    spoofedReadoutAutocreate.set(
      doc(
        readoutCtx.firestore(),
        'competitions/evt_live/siCardAssignments/8500119'
      ),
      {
        ...readoutCreatedAssignment,
        siNumber: 8500119,
        competitorId: 'cmp_readout_spoof',
        competitorDocumentId: 'cmp_readout_spoof',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    spoofedReadoutAutocreate.update(
      doc(readoutCtx.firestore(), 'competitions/evt_live'),
      {
        competitorCount: 12,
        finishedCount: 7,
        updatedAt: serverTimestamp(),
      }
    );
    await assertFails(spoofedReadoutAutocreate.commit());

    // READOUT officials may update rental return only, not payment status.
    await assertSucceeds(
      readoutCtx
        .firestore()
        .doc('competitions/evt_live/competitors/cmp_valid')
        .update({
          rentalReturned: true,
          billingFieldsUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
    );
    await assertFails(
      readoutCtx
        .firestore()
        .doc('competitions/evt_live/competitors/cmp_valid')
        .update({ feePaid: true, updatedAt: serverTimestamp() })
    );
    await assertFails(
      readoutCtx
        .firestore()
        .doc('competitions/evt_live/competitors/cmp_valid')
        .update({
          rentalReturned: false,
          status: 'OK',
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
    await assertSucceeds(officialCtx.firestore().doc('runnerDb/8500111').get());
    await assertSucceeds(officialCtx.firestore().collection('runnerDb').get());
    await assertFails(
      officialCtx.firestore().doc('runnerDb/8500111').update({
        fullName: 'Unauthorized edit',
        updatedAt: serverTimestamp(),
      })
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

    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500111')
        .get()
    );
    await assertSucceeds(
      readoutCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500111')
        .get()
    );
    await assertSucceeds(
      readoutCtx
        .firestore()
        .collection('competitions/evt_live/siCardAssignments')
        .get()
    );
    await assertFails(
      officialCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500111')
        .get()
    );
    await assertFails(
      attackerCtx
        .firestore()
        .collection('competitions/evt_live/siCardAssignments')
        .get()
    );
    await assertFails(
      attackerCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500112')
        .set({
          ...siCardAssignment,
          siNumber: 8500112,
          competitorId: 'cmp_attacker',
          ownerUid: 'attacker_uid',
        })
    );
    await assertFails(
      readoutCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500111')
        .set({
          ...siCardAssignment,
          ownerUid: 'readout_uid',
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500113')
        .set({
          ...siCardAssignment,
          siNumber: 8500113,
          state: 'DUPLICATE_CONFIRMED',
          conflictReason: 'Imported duplicate',
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500114')
        .set({
          siNumber: 8500114,
          competitionId: 'evt_live',
          cardSeries: 'SI-Card 10',
          competitorId: 'cmp_valid',
          competitorDocumentId: 'cmp_valid',
          assignmentVersion: 1,
          source: 'DIRECT_ENTRY',
          ownerUid: 'race_admin_1',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
          status: 'ACTIVE',
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500115')
        .set({
          ...siCardAssignment,
          siNumber: 8500115,
          createdAt: new Date().toISOString(),
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500116')
        .set({
          ...siCardAssignment,
          siNumber: 8500116,
          schemaVersion: 2,
        })
    );

    // P0 Step 7: verify the paired reassignment succeeds, while independent
    // identity and assignment mutations are fenced by rules.
    const reassignmentBatch = writeBatch(raceAdminCtx.firestore());
    const competitorReassignment: DocumentData = {
      siNumber: 8500112,
      updatedAt: serverTimestamp(),
    };
    const retireOldAssignment: DocumentData = {
      state: 'RETIRED',
      assignmentVersion: 2,
      updatedAt: serverTimestamp(),
      retiredAt: serverTimestamp(),
      retirementReason: 'si_reassigned',
    };
    const newAssignment: DocumentData = {
      ...siCardAssignment,
      siNumber: 8500112,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    reassignmentBatch.update<DocumentData, DocumentData>(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/competitors/cmp_valid'),
      competitorReassignment
    );
    reassignmentBatch.update<DocumentData, DocumentData>(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/siCardAssignments/8500111'),
      retireOldAssignment
    );
    reassignmentBatch.set<DocumentData, DocumentData>(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/siCardAssignments/8500112'),
      newAssignment
    );
    await assertSucceeds(reassignmentBatch.commit());

    // This paired-transaction fence is not a uniqueness check: duplicates are
    // still accepted when the requested SI already has an ACTIVE assignment.
    await assertSucceeds(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/competitors/cmp_duplicate')
        .set({
          ...initialCompetitor,
          competitorId: 'cmp_duplicate',
          bib: 102,
          siNumber: 8500112,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
    );

    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/competitors/cmp_valid')
        .update({ siNumber: 8500113, updatedAt: serverTimestamp() })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500112')
        .update({
          state: 'RETIRED',
          assignmentVersion: 2,
          updatedAt: serverTimestamp(),
          retiredAt: serverTimestamp(),
          retirementReason: 'manual_rule_test',
        })
    );

    // Mismatched assignment identity is schema-valid but cannot be committed
    // without a matching competitor mutation.
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500117')
        .set({
          ...siCardAssignment,
          siNumber: 8500117,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
    );
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500117')
        .delete()
    );

    const retirementBatch = writeBatch(raceAdminCtx.firestore());
    retirementBatch.delete(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/competitors/cmp_valid')
    );
    retirementBatch.delete(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/competitors/cmp_duplicate')
    );
    retirementBatch.update(
      doc(raceAdminCtx.firestore(), 'competitions/evt_live/siCardAssignments/8500112'),
      {
        state: 'RETIRED',
        assignmentVersion: 2,
        updatedAt: serverTimestamp(),
        retiredAt: serverTimestamp(),
        retirementReason: 'competitor_deleted',
      }
    );
    await assertSucceeds(retirementBatch.commit());
    await assertFails(
      raceAdminCtx
        .firestore()
        .doc('competitions/evt_live/siCardAssignments/8500112')
        .delete()
    );
  } finally {
    await testEnv.cleanup();
  }
}
