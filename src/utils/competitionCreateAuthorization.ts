export function assertCanCreateCompetitionInFirestore(params: {
  uid: string;
  ownerUid: string;
  emailVerified: boolean;
  adminRole: 'RACE_ADMIN' | 'SUPER_ADMIN' | null;
}): void {
  if (!params.emailVerified) {
    throw new Error('Firebase-token saknar verifierad e-post. Logga ut och in igen.');
  }
  if (params.ownerUid !== params.uid) {
    throw new Error('Firebase UID kan inte användas som tävlingsägare.');
  }
  if (!params.adminRole) {
    throw new Error('Google-kontot saknar en Firestore-administratörsroll.');
  }
}
