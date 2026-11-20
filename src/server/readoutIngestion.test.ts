import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestReadout, type ReadoutIngestionInput } from './readoutIngestion';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('ingestReadout', () => {
  const projectId = 'demo-passersi-readout-ingestion-tests';
  const app = initializeApp({ projectId }, `readout-ingestion-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required for this test.');
    const [hostname, port] = host.split(':');
    firestore.settings({ host: `${hostname}:${port}`, ssl: false });
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function seedReadout(options?: { competitorStatus?: string }) {
    const suffix = randomUUID().replace(/-/g, '');
    const competitionId = `evt_${suffix}`;
    const competitorId = `cmp_${suffix}`;
    const receiptId = `ro_${suffix}`;
    const actorUid = `usr_${suffix}`;
    const siNumber = 85000000 + Math.floor(Math.random() * 1000000);
    const competitionRef = firestore.collection('competitions').doc(competitionId);
    const competitorRef = competitionRef.collection('competitors').doc(competitorId);
    const receiptCollection = competitionRef.collection('readoutReceipts');
    const receiptRef = receiptCollection.doc(receiptId);
    const publicResultRef = competitionRef.collection('publicResults').doc(competitorId);
    const baseInput: ReadoutIngestionInput = {
      competitorId,
      siNumber,
      cardSeries: 'SI-Card 10',
      stationCode: 1,
      checkTimeSec: -1,
      startTimeSec: 36000,
      finishTimeSec: 40000,
      punchCodes: [31, 32],
      punchTimes: [37000, 38000],
      rawHex: '012345',
      result: {
        status: 'OK',
        checkTimeSec: -1,
        startTimeSec: 36000,
        finishTimeSec: 40000,
        runningTimeSec: 4000,
        readoutAtIso: new Date().toISOString(),
      },
    };
    const competitorData = {
      competitorId,
      competitionId,
      ownerUid: actorUid,
      bib: 1,
      fullName: 'Readout Runner',
      club: 'Readout Club',
      classId: 'cls_open',
      siNumber,
      cardSeries: 'SI-Card 10',
      isRentalCard: false,
      rentalReturned: false,
      status: options?.competitorStatus ?? 'REGISTERED',
      allocatedStartSec: -1,
      checkTimeSec: -1,
      startTimeSec: -1,
      finishTimeSec: -1,
      manualFinishTimeSec: -1,
      runningTimeSec: -1,
      readoutAtIso: '',
      punchCodes: [],
      punchTimes: [],
    };

    await Promise.all([
      firestore.collection('roleAssignments').doc(actorUid).set({
        uid: actorUid,
        role: 'READOUT',
      }),
      competitionRef.set({
        competitionId,
        ownerUid: `usr_owner_${suffix}`,
        status: 'LIVE',
        competitorCount: 1,
        finishedCount: 0,
      }),
      competitorRef.set(competitorData),
    ]);

    return {
      competitionId,
      competitorId,
      receiptId,
      actorUid,
      siNumber,
      input: baseInput,
      competitionRef,
      competitorRef,
      receiptCollection,
      receiptRef,
      publicResultRef,
      async addProcessedReceipt(id: string) {
        await receiptCollection.doc(id).set({
          receiptId: id,
          competitionId,
          ownerUid: actorUid,
          clientReadoutId: id,
          siNumber,
          cardSeries: baseInput.cardSeries,
          stationCode: baseInput.stationCode,
          checkTimeSec: baseInput.checkTimeSec,
          startTimeSec: baseInput.startTimeSec,
          finishTimeSec: baseInput.finishTimeSec,
          punchCodes: baseInput.punchCodes,
          punchTimes: baseInput.punchTimes,
          rawHex: baseInput.rawHex,
          status: 'PROCESSED',
          competitorId,
          createdAt: new Date(),
        });
      },
      async cleanup() {
        await firestore.recursiveDelete(competitionRef);
        await firestore.collection('roleAssignments').doc(actorUid).delete();
      },
    };
  }

  it('does not create a receipt or mutate results for an exact logical duplicate', async () => {
    const fixture = await seedReadout();
    const originalReceiptId = `ro_original_${randomUUID().replace(/-/g, '')}`;
    try {
      await fixture.addProcessedReceipt(originalReceiptId);
      const competitorBefore = (await fixture.competitorRef.get()).data();
      const competitionBefore = (await fixture.competitionRef.get()).data();
      const result = await ingestReadout(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.input
      );

      expect(result).toMatchObject({
        status: 'DUPLICATE',
        competitorId: fixture.competitorId,
        duplicateReceiptId: originalReceiptId,
        replayed: false,
      });
      expect((await fixture.receiptRef.get()).exists).toBe(false);
      expect((await fixture.competitorRef.get()).data()).toEqual(competitorBefore);
      expect((await fixture.competitionRef.get()).data()).toEqual(competitionBefore);
      expect((await fixture.publicResultRef.get()).exists).toBe(false);
      expect((await fixture.receiptCollection.get()).size).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('processes a readout with different punch data', async () => {
    const fixture = await seedReadout();
    const originalReceiptId = `ro_original_${randomUUID().replace(/-/g, '')}`;
    try {
      await fixture.addProcessedReceipt(originalReceiptId);
      const result = await ingestReadout(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        {
          ...fixture.input,
          punchCodes: [31, 33],
          punchTimes: [37000, 39000],
        }
      );

      expect(result).toMatchObject({
        status: 'PROCESSED',
        competitorId: fixture.competitorId,
        replayed: false,
      });
      expect((await fixture.receiptRef.get()).data()).toMatchObject({
        status: 'PROCESSED',
        punchCodes: [31, 33],
        punchTimes: [37000, 39000],
      });
      expect((await fixture.receiptCollection.get()).size).toBe(2);
      expect((await fixture.competitorRef.get()).data()).toMatchObject({
        status: 'OK',
        punchCodes: [31, 33],
        punchTimes: [37000, 39000],
      });
      expect((await fixture.publicResultRef.get()).data()?.status).toBe('OK');
      expect((await fixture.competitionRef.get()).data()?.finishedCount).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('serializes concurrent exact captures so only one receipt is processed', async () => {
    const fixture = await seedReadout();
    const secondReceiptId = `ro_${randomUUID().replace(/-/g, '')}`;
    try {
      const results = await Promise.all([
        ingestReadout(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.receiptId,
          fixture.input
        ),
        ingestReadout(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          secondReceiptId,
          fixture.input
        ),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        'DUPLICATE',
        'PROCESSED',
      ]);
      expect((await fixture.receiptCollection.get()).size).toBe(1);
      expect((await fixture.competitionRef.get()).data()?.finishedCount).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('preserves same-receipt-ID replay behavior without reapplying the result', async () => {
    const fixture = await seedReadout();
    try {
      await fixture.addProcessedReceipt(fixture.receiptId);
      const result = await ingestReadout(
        firestore,
        { uid: fixture.actorUid },
        fixture.competitionId,
        fixture.receiptId,
        fixture.input
      );

      expect(result).toMatchObject({
        status: 'PROCESSED',
        competitorId: fixture.competitorId,
        replayed: true,
      });
      expect((await fixture.competitorRef.get()).data()?.status).toBe('REGISTERED');
      expect((await fixture.competitionRef.get()).data()?.finishedCount).toBe(0);
      expect((await fixture.receiptCollection.get()).size).toBe(1);
      await expect(
        ingestReadout(
          firestore,
          { uid: fixture.actorUid },
          fixture.competitionId,
          fixture.receiptId,
          { ...fixture.input, rawHex: 'different-payload' }
        )
      ).rejects.toThrow('already used for another readout');
    } finally {
      await fixture.cleanup();
    }
  });
});
