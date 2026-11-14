import { describe, expect, it } from 'vitest';
import { assertCanCreateCompetitionInFirestore } from './competitionCreateAuthorization';

describe('Firestore competition-create authorization', () => {
  it('accepts a verified admin whose owner ID matches the Firebase UID', () => {
    expect(() =>
      assertCanCreateCompetitionInFirestore({
        uid: 'firebase_uid',
        ownerUid: 'firebase_uid',
        emailVerified: true,
        adminRole: 'RACE_ADMIN',
      })
    ).not.toThrow();
  });

  it('rejects a stale unverified token before the Firestore create', () => {
    expect(() =>
      assertCanCreateCompetitionInFirestore({
        uid: 'firebase_uid',
        ownerUid: 'firebase_uid',
        emailVerified: false,
        adminRole: 'SUPER_ADMIN',
      })
    ).toThrow('Firebase-token saknar verifierad e-post.');
  });

  it('rejects a missing Firestore admin role before the create', () => {
    expect(() =>
      assertCanCreateCompetitionInFirestore({
        uid: 'firebase_uid',
        ownerUid: 'firebase_uid',
        emailVerified: true,
        adminRole: null,
      })
    ).toThrow('Google-kontot saknar en Firestore-administratörsroll.');
  });

  it('rejects an owner ID that differs from the Firebase UID', () => {
    expect(() =>
      assertCanCreateCompetitionInFirestore({
        uid: 'firebase_uid',
        ownerUid: 'sanitized_uid',
        emailVerified: true,
        adminRole: 'RACE_ADMIN',
      })
    ).toThrow('Firebase UID kan inte användas som tävlingsägare.');
  });
});
