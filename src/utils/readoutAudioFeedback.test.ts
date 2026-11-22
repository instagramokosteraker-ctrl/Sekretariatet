import { describe, expect, it } from 'vitest';
import { getReadoutFeedbackTone } from './readoutAudioFeedback';

describe('readout audio feedback', () => {
  it('uses the existing feedback tone for queued, unknown, OK, and non-OK results', () => {
    expect(
      getReadoutFeedbackTone({
        queuedOffline: true,
        duplicateReadout: false,
        unknownCardReadout: false,
        resultStatus: null,
      })
    ).toBe('registration');
    expect(
      getReadoutFeedbackTone({
        queuedOffline: false,
        duplicateReadout: false,
        unknownCardReadout: true,
        resultStatus: null,
      })
    ).toBe('mp');
    expect(
      getReadoutFeedbackTone({
        queuedOffline: false,
        duplicateReadout: false,
        unknownCardReadout: false,
        resultStatus: 'OK',
      })
    ).toBe('ok');
    expect(
      getReadoutFeedbackTone({
        queuedOffline: false,
        duplicateReadout: false,
        unknownCardReadout: false,
        resultStatus: 'MP',
      })
    ).toBe('mp');
  });

  it('keeps duplicates and unclassified responses silent', () => {
    expect(
      getReadoutFeedbackTone({
        queuedOffline: false,
        duplicateReadout: true,
        unknownCardReadout: false,
        resultStatus: 'OK',
      })
    ).toBeNull();
    expect(
      getReadoutFeedbackTone({
        queuedOffline: false,
        duplicateReadout: false,
        unknownCardReadout: false,
        resultStatus: null,
      })
    ).toBeNull();
  });
});
