export function shouldUseFirestoreClassDrawFallback(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (/^HTTP 404:/.test(error.message) ||
        /^HTTP 5\d\d:/.test(error.message) ||
        error.message.includes('API server initialization failed')))
  );
}
