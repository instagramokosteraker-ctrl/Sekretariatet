import type {
  CardPunch,
  FrameByteSegment,
  FrameHardwareSource,
  FullCardReadoutPayload,
  RawSIFrameLog,
  SICardSeries,
} from '../types/sportident';

export const SI_STX = 0x02;
export const SI_ETX = 0x03;
export const SI_ACK = 0x06;
export const SI_NAK = 0x15;
export const SI_DLE = 0x10;
export const SI_WAKEUP = 0xff;

export const SI_CMD = {
  BC_TRANS_REC: 0x53,
  GET_SYS_VAL: 0x83,
  SET_SYS_VAL: 0x82,
  GET_SI5: 0xb1,
  TRANS_REC: 0xd3,
  GET_SI6: 0xe1,
  SI5_DET: 0xe5,
  SI6_DET: 0xe6,
  SI_REM: 0xe7,
  SI9_DET: 0xe8,
  GET_SI9: 0xef,
  SET_MS: 0xf0,
  BEEP: 0xf9,
} as const;

const CRC_POLYNOM = 0x8005;
const CRC_BITF = 0x8000;

/**
 * Official SPORTident GmbH word-based 16-bit CRC calculation (crc529).
 * Verified: [0xF0, 0x01, 0x4D] -> 0x6D0A.
 */
export function computeSportidentCrc(buffer: Uint8Array): number {
  const count = buffer.length;
  if (count < 2) return 0x0000;

  let ptr = 0;
  let tmp = ((buffer[ptr++] << 8) | buffer[ptr++]) & 0xffff;

  if (count > 2) {
    for (let i = count >> 1; i > 0; i--) {
      let val = 0;
      if (i > 1) {
        val = ((buffer[ptr++] << 8) | buffer[ptr++]) & 0xffff;
      } else if ((count & 1) === 1) {
        val = (buffer[ptr] << 8) & 0xffff;
      }

      for (let j = 0; j < 16; j++) {
        if ((tmp & CRC_BITF) !== 0) {
          tmp = (tmp << 1) & 0xffff;
          if ((val & CRC_BITF) !== 0) tmp = (tmp + 1) & 0xffff;
          tmp = (tmp ^ CRC_POLYNOM) & 0xffff;
        } else {
          tmp = (tmp << 1) & 0xffff;
          if ((val & CRC_BITF) !== 0) tmp = (tmp + 1) & 0xffff;
        }
        val = (val << 1) & 0xffff;
      }
    }
  }

  return tmp & 0xffff;
}

export function inferCardSeries(siNumber: number): SICardSeries {
  if (siNumber >= 8_000_000 && siNumber <= 8_999_999) return 'SIAC Air+';
  if (siNumber >= 9_000_000 && siNumber <= 9_999_999) return 'SI-Card 11';
  if (siNumber >= 7_000_000 && siNumber <= 7_999_999) return 'SI-Card 10';
  if (siNumber >= 2_000_000 && siNumber <= 2_999_999) return 'SI-Card 8';
  if (siNumber >= 1_000_000 && siNumber <= 1_999_999) return 'SI-Card 9';
  if (siNumber >= 500_000 && siNumber <= 999_999) return 'SI-Card 6';
  return 'SI-Card 5';
}

export function formatSiNumber(siNumber: number): string {
  return siNumber.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatSecondsAsClock(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const normalized = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const hh = Math.floor(normalized / 3600);
  const mm = Math.floor((normalized % 3600) / 60);
  const ss = normalized % 60;
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss
    .toString()
    .padStart(2, '0')}`;
}

export function formatDurationMmSs(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.floor(sec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  }
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

export function parseClockToSeconds(clockStr: string): number | null {
  const parts = clockStr.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 3600 + parts[1] * 60;
  }
  return null;
}

export function getNowSecondsOfDay(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

export function hexToBytes(hexString: string): Uint8Array | null {
  const cleaned = hexString.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function decodeFourByteSiNumber(
  si3: number,
  si2: number,
  si1: number,
  si0: number
): { siNumber: number; cardSeries: SICardSeries } {
  const low24 = ((si2 << 16) | (si1 << 8) | si0) >>> 0;
  if (si3 === 0x00 && si2 <= 0x04 && low24 < 500_000) {
    const base16 = (si1 << 8) | si0;
    const cns = si2 <= 1 ? base16 : si2 * 100_000 + base16;
    return { siNumber: cns, cardSeries: 'SI-Card 5' };
  }
  return { siNumber: low24, cardSeries: inferCardSeries(low24) };
}

export function encodeFourByteSiNumber(siNumber: number): [number, number, number, number] {
  if (siNumber > 0 && siNumber < 500_000) {
    const series = Math.floor(siNumber / 100_000);
    const rem = siNumber % 100_000;
    if (series <= 1 && siNumber <= 65535) {
      return [0x00, 0x01, (siNumber >> 8) & 0xff, siNumber & 0xff];
    }
    if (rem <= 65535) {
      return [0x00, series & 0xff, (rem >> 8) & 0xff, rem & 0xff];
    }
  }
  return [
    0x0f,
    (siNumber >> 16) & 0xff,
    (siNumber >> 8) & 0xff,
    siNumber & 0xff,
  ];
}

export function buildExtendedFrame(
  cmd: number,
  payload: number[],
  includeWakeup = false
): Uint8Array {
  const core = new Uint8Array(2 + payload.length);
  core[0] = cmd & 0xff;
  core[1] = payload.length & 0xff;
  for (let i = 0; i < payload.length; i++) {
    core[2 + i] = payload[i] & 0xff;
  }
  const crc = computeSportidentCrc(core);
  const prefix = includeWakeup ? [SI_WAKEUP, SI_STX] : [SI_STX];
  return new Uint8Array([...prefix, ...core, (crc >> 8) & 0xff, crc & 0xff, SI_ETX]);
}

export function buildSetMasterModeFrame(directMode = true, includeWakeup = true): Uint8Array {
  return buildExtendedFrame(SI_CMD.SET_MS, [directMode ? 0x4d : 0x53], includeWakeup);
}

export function buildGetSystemConfigFrame(offset = 0x00, length = 0x80): Uint8Array {
  return buildExtendedFrame(SI_CMD.GET_SYS_VAL, [offset & 0xff, length & 0xff], true);
}

export function buildStationBeepFrame(count = 1): Uint8Array {
  return buildExtendedFrame(SI_CMD.BEEP, [Math.max(1, Math.min(5, count))], true);
}

/**
 * Request the 128-byte memory sheet from an inserted SI-Card 5 (0xB1 C_GET_SI5).
 */
export function buildGetSi5Frame(): Uint8Array {
  return buildExtendedFrame(SI_CMD.GET_SI5, [], false);
}

/**
 * Request a 128-byte memory block (0, 6, 7) from an inserted SI-Card 6 (0xE1 C_GET_SI6).
 */
export function buildGetSi6BlockFrame(blockNumber: number): Uint8Array {
  return buildExtendedFrame(SI_CMD.GET_SI6, [blockNumber & 0xff], false);
}

/**
 * Request a 128-byte memory block (0..7) from an inserted SI-Card 8/9/10/11/SIAC (0xEF C_GET_SI9).
 */
export function buildGetSi9BlockFrame(blockNumber: number): Uint8Array {
  return buildExtendedFrame(SI_CMD.GET_SI9, [blockNumber & 0xff], false);
}

/**
 * Encodes a 4-byte SPORTident card punch record [PTD, CN, PTH, PTL] from seconds since midnight.
 */
function encodeFourBytePunch(code: number, timeSec: number | null): [number, number, number, number] {
  if (timeSec === null || timeSec === undefined || !Number.isFinite(timeSec)) {
    return [0xee, 0xee, 0xee, 0xee];
  }
  const norm = ((Math.floor(timeSec) % 86400) + 86400) % 86400;
  const isPm = norm >= 43200 ? 1 : 0;
  const halfSec = norm % 43200;
  const cnHiBit = (code & 0x0100) !== 0 ? 0x80 : 0x00;
  const ptd = (cnHiBit | 0x08 | isPm) & 0xff;
  return [ptd, code & 0xff, (halfSec >> 8) & 0xff, halfSec & 0xff];
}

function decodeFourBytePunch(
  b0: number,
  b1: number,
  b2: number,
  b3: number,
  extractCode = true
): { code: number; timeSec: number } | null {
  if (b0 === 0xee && b1 === 0xee && b2 === 0xee && b3 === 0xee) {
    return null;
  }
  const isPm = (b0 & 0x01) === 1;
  const halfSec = ((b2 << 8) | b3) & 0xffff;
  if (halfSec >= 43200 && halfSec === 0xeeee) return null;
  const timeSec = (isPm ? 43200 : 0) + (halfSec % 43200);
  const code = extractCode ? (((b0 & 0x80) << 1) | b1) & 0x01ff : b1;
  return { code, timeSec };
}

function encodeTwoByte12hTime(timeSec: number | null): [number, number] {
  if (timeSec === null || timeSec === undefined || !Number.isFinite(timeSec)) {
    return [0xee, 0xee];
  }
  const halfSec = ((Math.floor(timeSec) % 43200) + 43200) % 43200;
  return [(halfSec >> 8) & 0xff, halfSec & 0xff];
}

function decodeTwoByte12hRaw(hi: number, lo: number): number | null {
  if (hi === 0xee && lo === 0xee) return null;
  const val = ((hi << 8) | lo) & 0xffff;
  if (val >= 43200) return null;
  return val;
}

/**
 * Resolves 12-hour SI-Card 5 timestamps into monotonic 24-hour seconds.
 * If punches occur in the afternoon (or cross 12:00:00 noon), +43200s is applied automatically.
 */
function resolveSi5TwelveHourSequence(
  check12: number | null,
  start12: number | null,
  punchList12: { code: number; t12: number | null }[],
  finish12: number | null
): {
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
} {
  // Determine whether base half-day is AM (0) or PM (43200)
  // If no explicit hint and first timestamp < 21600 (06:00) while current local clock is afternoon, treat as PM.
  const firstKnown =
    check12 ?? start12 ?? punchList12.find((p) => p.t12 !== null)?.t12 ?? finish12 ?? null;
  let offset = 0;
  if (firstKnown !== null && firstKnown < 6 * 3600 && getNowSecondsOfDay() >= 43200) {
    offset = 43200;
  }

  let prevSec = -1;
  const lift = (raw12: number | null): number | null => {
    if (raw12 === null) return null;
    let candidate = raw12 + offset;
    while (prevSec >= 0 && candidate < prevSec - 600) {
      offset += 43200;
      candidate = raw12 + offset;
    }
    prevSec = candidate;
    return candidate % 86400;
  };

  const checkTimeSec = lift(check12);
  const startTimeSec = lift(start12);
  const punches: CardPunch[] = [];
  for (const item of punchList12) {
    const resolved = lift(item.t12);
    if (resolved !== null) {
      punches.push({ code: item.code, timeSec: resolved });
    }
  }
  const finishTimeSec = lift(finish12);

  return { checkTimeSec, startTimeSec, finishTimeSec, punches };
}

/**
 * Builds an authentic 0xB1 (C_GET_SI5) 130-byte payload frame (2-byte CN + 128-byte SI5 EEPROM sheet)
 * matching physical SI-Card 5 layout!
 */
export function buildSi5ReadoutFrame(params: {
  stationCode: number;
  siNumber: number;
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
}): Uint8Array {
  const cnHi = (params.stationCode >> 8) & 0xff;
  const cnLo = params.stationCode & 0xff;
  const sheet = new Array<number>(128).fill(0x00);

  // Encode SI-Card 5 number into bytes 4, 5 (16-bit base) and byte 6 (CNS series 1..4)
  const rawSi = Math.max(1, Math.min(499_999, Math.floor(params.siNumber)));
  let cns = 1;
  let base16 = rawSi;
  if (rawSi > 65535) {
    cns = Math.max(2, Math.floor(rawSi / 100_000));
    base16 = rawSi % 100_000;
  }
  sheet[4] = (base16 >> 8) & 0xff;
  sheet[5] = base16 & 0xff;
  sheet[6] = cns & 0xff;

  const [stHi, stLo] = encodeTwoByte12hTime(params.startTimeSec);
  const [fiHi, fiLo] = encodeTwoByte12hTime(params.finishTimeSec);
  const [chHi, chLo] = encodeTwoByte12hTime(params.checkTimeSec);

  sheet[19] = stHi;
  sheet[20] = stLo;
  sheet[21] = fiHi;
  sheet[22] = fiLo;
  const cappedPunches = params.punches.slice(0, 30);
  sheet[23] = (cappedPunches.length + 1) & 0xff; // RC = punchCount + 1 on SI-Card 5!
  sheet[25] = chHi;
  sheet[26] = chLo;

  // Fill punch records 32..127 with 0xEE empty markers first
  for (let i = 32; i < 128; i++) sheet[i] = 0xee;

  // Write up to 30 timed punches in 6 blocks × 16 bytes (5 × 3-byte timed slots at +1..+15 per 16-byte row)
  cappedPunches.forEach((p, idx) => {
    const rowBase = 32 + Math.floor(idx / 5) * 16;
    const slotInRow = idx % 5;
    const offset = rowBase + 1 + slotInRow * 3;
    const [pHi, pLo] = encodeTwoByte12hTime(p.timeSec);
    sheet[offset] = p.code & 0xff;
    sheet[offset + 1] = pHi;
    sheet[offset + 2] = pLo;
  });

  return buildExtendedFrame(SI_CMD.GET_SI5, [cnHi, cnLo, ...sheet], false);
}

/**
 * Decodes a 128-byte SI-Card 5 EEPROM sheet from 0xB1 (C_GET_SI5).
 */
export function parseSi5SheetToReadout(
  stationCode: number,
  sheet: number[],
  rawHexSummary: string,
  source: FrameHardwareSource
): FullCardReadoutPayload | null {
  if (!sheet || sheet.length < 128) return null;

  const base16 = ((sheet[4] << 8) | sheet[5]) & 0xffff;
  const cns = sheet[6] & 0xff;
  const siNumber = cns <= 1 ? base16 : cns * 100_000 + base16;

  const start12 = decodeTwoByte12hRaw(sheet[19], sheet[20]);
  const finish12 = decodeTwoByte12hRaw(sheet[21], sheet[22]);
  const check12 = decodeTwoByte12hRaw(sheet[25], sheet[26]);
  const rawRc = sheet[23] & 0xff;
  const punchCount = Math.max(0, Math.min(36, rawRc > 0 ? rawRc - 1 : 0));

  const rawPunches: { code: number; t12: number | null }[] = [];
  const timedCount = Math.min(30, punchCount);
  for (let i = 0; i < timedCount; i++) {
    const rowBase = 32 + Math.floor(i / 5) * 16;
    const slot = i % 5;
    const off = rowBase + 1 + slot * 3;
    const code = sheet[off] & 0xff;
    const t12 = decodeTwoByte12hRaw(sheet[off + 1], sheet[off + 2]);
    if (code !== 0x00 && code !== 0xee) {
      rawPunches.push({ code, t12 });
    }
  }

  const resolved = resolveSi5TwelveHourSequence(check12, start12, rawPunches, finish12);

  return {
    siNumber,
    cardSeries: 'SI-Card 5',
    stationCode,
    checkTimeSec: resolved.checkTimeSec,
    startTimeSec: resolved.startTimeSec,
    finishTimeSec: resolved.finishTimeSec,
    punches: resolved.punches,
    rawHex: rawHexSummary,
    source,
  };
}

/**
 * Builds authentic 0xE1 (C_GET_SI6) 128-byte response frames (Block 0 + Block 6..7)
 * matching physical SI-Card 6 EEPROM layout!
 */
export function buildSi6ReadoutBlockFrames(params: {
  stationCode: number;
  siNumber: number;
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
}): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const cnHi = (params.stationCode >> 8) & 0xff;
  const cnLo = params.stationCode & 0xff;

  const block0 = new Array<number>(128).fill(0x00);
  // SI6 Block 0 offsets:
  // 10..13: 4-byte SI6 ID
  // 18: RC (punch count)
  // 20..23: Finish, 24..27: Start, 28..31: Check
  block0[10] = 0x00;
  block0[11] = (params.siNumber >> 16) & 0xff;
  block0[12] = (params.siNumber >> 8) & 0xff;
  block0[13] = params.siNumber & 0xff;
  block0[18] = Math.min(64, params.punches.length) & 0xff;

  block0.splice(20, 4, ...encodeFourBytePunch(90, params.finishTimeSec));
  block0.splice(24, 4, ...encodeFourBytePunch(20, params.startTimeSec));
  block0.splice(28, 4, ...encodeFourBytePunch(10, params.checkTimeSec));

  frames.push(buildExtendedFrame(SI_CMD.GET_SI6, [cnHi, cnLo, 0x00, ...block0], false));

  // Blocks 6 & 7 hold up to 32 × 4-byte punches per block on SI-Card 6
  const totalBlocks = Math.max(1, Math.min(2, Math.ceil(params.punches.length / 32)));
  for (let b = 0; b < totalBlocks; b++) {
    const blockNum = 6 + b;
    const blockBytes = new Array<number>(128).fill(0xee);
    const slice = params.punches.slice(b * 32, (b + 1) * 32);
    slice.forEach((p, idx) => {
      blockBytes.splice(idx * 4, 4, ...encodeFourBytePunch(p.code, p.timeSec));
    });
    frames.push(buildExtendedFrame(SI_CMD.GET_SI6, [cnHi, cnLo, blockNum, ...blockBytes], false));
  }

  return frames;
}

/**
 * Decodes collected 128-byte blocks from an SI-Card 6 readout (0xE1).
 */
export function parseSi6BlocksToReadout(
  stationCode: number,
  blocks: Map<number, number[]>,
  rawHexSummary: string,
  source: FrameHardwareSource
): FullCardReadoutPayload | null {
  const b0 = blocks.get(0);
  if (!b0 || b0.length < 128) return null;

  const siNumber = ((b0[11] << 16) | (b0[12] << 8) | b0[13]) >>> 0;
  const punchCount = b0[18] & 0xff;

  const finishRec = decodeFourBytePunch(b0[20], b0[21], b0[22], b0[23], false);
  const startRec = decodeFourBytePunch(b0[24], b0[25], b0[26], b0[27], false);
  const checkRec = decodeFourBytePunch(b0[28], b0[29], b0[30], b0[31], false);

  const punches: CardPunch[] = [];
  let remaining = punchCount;
  for (const blkIdx of [6, 7, 2, 3, 4, 5]) {
    if (remaining <= 0) break;
    const blk = blocks.get(blkIdx);
    if (!blk || blk.length < 128) continue;
    for (let slot = 0; slot < 32 && remaining > 0; slot++) {
      const off = slot * 4;
      const decoded = decodeFourBytePunch(blk[off], blk[off + 1], blk[off + 2], blk[off + 3], true);
      if (decoded) punches.push(decoded);
      remaining--;
    }
  }

  return {
    siNumber,
    cardSeries: 'SI-Card 6',
    stationCode,
    checkTimeSec: checkRec?.timeSec ?? null,
    startTimeSec: startRec?.timeSec ?? null,
    finishTimeSec: finishRec?.timeSec ?? null,
    punches,
    rawHex: rawHexSummary,
    source,
  };
}

/**
 * Builds authentic 0xEF (C_GET_SI9) 128-byte response frames (Block 0 + Block 4..7)
 * matching physical SI-Card 10 / 11 / SIAC EEPROM layout!
 */
export function buildSi10ReadoutBlockFrames(params: {
  stationCode: number;
  siNumber: number;
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
}): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const cnHi = (params.stationCode >> 8) & 0xff;
  const cnLo = params.stationCode & 0xff;

  const block0 = new Array<number>(128).fill(0x00);
  const checkBytes = encodeFourBytePunch(10, params.checkTimeSec);
  const startBytes = encodeFourBytePunch(20, params.startTimeSec);
  const finBytes = encodeFourBytePunch(90, params.finishTimeSec);

  block0.splice(8, 4, ...checkBytes);
  block0.splice(12, 4, ...startBytes);
  block0.splice(16, 4, ...finBytes);
  block0[22] = Math.min(128, params.punches.length) & 0xff;
  block0[24] = 0x0f;
  block0[25] = (params.siNumber >> 16) & 0xff;
  block0[26] = (params.siNumber >> 8) & 0xff;
  block0[27] = params.siNumber & 0xff;

  frames.push(buildExtendedFrame(SI_CMD.GET_SI9, [cnHi, cnLo, 0x00, ...block0], false));

  const totalBlocks = Math.max(1, Math.ceil(params.punches.length / 32));
  for (let b = 0; b < totalBlocks; b++) {
    const blockNum = 4 + b;
    const blockBytes = new Array<number>(128).fill(0xee);
    const slice = params.punches.slice(b * 32, (b + 1) * 32);
    slice.forEach((p, idx) => {
      const encoded = encodeFourBytePunch(p.code, p.timeSec);
      blockBytes.splice(idx * 4, 4, ...encoded);
    });
    frames.push(buildExtendedFrame(SI_CMD.GET_SI9, [cnHi, cnLo, blockNum, ...blockBytes], false));
  }

  return frames;
}

/**
 * Decodes collected 128-byte blocks from a modern SI-Card 8/9/10/11/SIAC readout (0xEF).
 */
export function parseSi9BlocksToReadout(
  stationCode: number,
  blocks: Map<number, number[]>,
  rawHexSummary: string,
  source: FrameHardwareSource
): FullCardReadoutPayload | null {
  const b0 = blocks.get(0);
  if (!b0 || b0.length < 128) return null;

  const seriesByte = b0[24];
  const siNumber = ((b0[25] << 16) | (b0[26] << 8) | b0[27]) >>> 0;
  const cardSeries = inferCardSeries(siNumber);

  const checkRec = decodeFourBytePunch(b0[8], b0[9], b0[10], b0[11], false);
  const startRec = decodeFourBytePunch(b0[12], b0[13], b0[14], b0[15], false);
  const finishRec = decodeFourBytePunch(b0[16], b0[17], b0[18], b0[19], false);
  const punchCount = b0[22] & 0xff;

  const punches: CardPunch[] = [];

  if (seriesByte === 0x0f) {
    let remaining = punchCount;
    for (let blkIdx = 4; blkIdx <= 7 && remaining > 0; blkIdx++) {
      const blk = blocks.get(blkIdx);
      if (!blk || blk.length < 128) break;
      for (let slot = 0; slot < 32 && remaining > 0; slot++) {
        const off = slot * 4;
        const decoded = decodeFourBytePunch(blk[off], blk[off + 1], blk[off + 2], blk[off + 3], true);
        if (decoded) {
          punches.push(decoded);
        }
        remaining--;
      }
    }
  } else {
    const combined = [...b0, ...(blocks.get(1) ?? [])];
    const startOffset = seriesByte === 0x02 ? 136 : 56;
    for (let i = 0; i < punchCount; i++) {
      const off = startOffset + i * 4;
      if (off + 3 >= combined.length) break;
      const decoded = decodeFourBytePunch(
        combined[off],
        combined[off + 1],
        combined[off + 2],
        combined[off + 3],
        true
      );
      if (decoded) punches.push(decoded);
    }
  }

  return {
    siNumber,
    cardSeries,
    stationCode,
    checkTimeSec: checkRec?.timeSec ?? null,
    startTimeSec: startRec?.timeSec ?? null,
    finishTimeSec: finishRec?.timeSec ?? null,
    punches,
    rawHex: rawHexSummary,
    source,
  };
}

export function buildTransRecFrame(params: {
  stationCode: number;
  siNumber: number;
  timeSec?: number;
  siacBatteryLow?: boolean;
  recordIndex?: number;
}): Uint8Array {
  const sec = params.timeSec ?? getNowSecondsOfDay();
  const norm = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const cn1 = (params.stationCode >> 8) & 0xff;
  const cn0 = params.stationCode & 0xff;
  const [si3, si2, si1, si0] = encodeFourByteSiNumber(params.siNumber);

  const isPm = norm >= 43200 ? 1 : 0;
  const dayOfWeek = new Date().getDay() & 0x07;
  const td = ((params.siacBatteryLow ? 0x80 : 0x00) | (dayOfWeek << 1) | isPm) & 0xff;

  const halfDaySeconds = norm % 43200;
  const th = (halfDaySeconds >> 8) & 0xff;
  const tl = halfDaySeconds & 0xff;
  const tss = 0x00;

  const memIdx = params.recordIndex ?? 1;
  return buildExtendedFrame(
    SI_CMD.TRANS_REC,
    [
      cn1,
      cn0,
      si3,
      si2,
      si1,
      si0,
      td,
      th,
      tl,
      tss,
      (memIdx >> 16) & 0xff,
      (memIdx >> 8) & 0xff,
      memIdx & 0xff,
    ],
    false
  );
}

export function getCommandName(cmd: number): string {
  switch (cmd) {
    case SI_CMD.TRANS_REC:
      return 'C_TRANS_REC (Online/Radiokontroll 0xD3)';
    case SI_CMD.GET_SI9:
      return 'C_GET_SI9 (Minnesblock SI8/9/10/11/SIAC 0xEF)';
    case SI_CMD.GET_SI5:
      return 'C_GET_SI5 (Minnesark SI-Card 5 0xB1)';
    case SI_CMD.GET_SI6:
      return 'C_GET_SI6 (Minnesblock SI-Card 6 0xE1)';
    case SI_CMD.SET_MS:
      return 'C_SET_MS (Master/Direktläge 0xF0)';
    case SI_CMD.GET_SYS_VAL:
      return 'C_GET_SYS_VAL (Systemdata 0x83)';
    case SI_CMD.SI5_DET:
      return 'C_SI5_DET (SI-Card 5 insatt)';
    case SI_CMD.SI6_DET:
      return 'C_SI6_DET (SI-Card 6 insatt)';
    case SI_CMD.SI9_DET:
      return 'C_SI9_DET (SI-Card 8–11/SIAC insatt)';
    case SI_CMD.SI_REM:
      return 'C_SI_REM (SI-bricka uttagen)';
    case SI_CMD.BEEP:
      return 'C_BEEP (Akustisk kvittens)';
    default:
      return `SI_CMD_0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}

export function decodeSingleFrame(
  rawFrame: Uint8Array,
  direction: 'RX' | 'TX',
  source: FrameHardwareSource
): RawSIFrameLog | null {
  let offset = 0;
  while (offset < rawFrame.length && rawFrame[offset] === SI_WAKEUP) offset++;
  const frame = rawFrame.slice(offset);
  if (frame.length < 6 || frame[0] !== SI_STX || frame[frame.length - 1] !== SI_ETX) {
    return null;
  }

  const cmd = frame[1];
  if (cmd < 0x80) return null;

  const len = frame[2];
  if (frame.length < 3 + len + 3) return null;

  const payload = frame.slice(3, 3 + len);
  const core = frame.slice(1, 3 + len);
  const rxCrc = (frame[3 + len] << 8) | frame[3 + len + 1];
  const computedCrc = computeSportidentCrc(core);
  const crcValid = rxCrc === computedCrc;

  const segments: FrameByteSegment[] = [];
  if (offset > 0) {
    segments.push({
      label: 'WAKEUP',
      hex: bytesToHex(rawFrame.slice(0, offset)),
      meaning: 'Väckningspuls till station',
    });
  }

  segments.push(
    { label: 'STX', hex: '02', meaning: 'Start av ram' },
    {
      label: 'CMD',
      hex: cmd.toString(16).toUpperCase().padStart(2, '0'),
      meaning: getCommandName(cmd),
    },
    {
      label: 'LEN',
      hex: len.toString(16).toUpperCase().padStart(2, '0'),
      meaning: `${len} databyte`,
    }
  );

  let stationCode: number | undefined;
  let siNumber: number | undefined;
  let cardSeries: SICardSeries | undefined;
  let punchTime24h: string | undefined;
  let punchTimeSec: number | undefined;
  let blockNumber: number | undefined;
  let blockData: number[] | undefined;
  let siacBatteryLow: boolean | undefined;

  if (cmd === SI_CMD.TRANS_REC && payload.length >= 10) {
    stationCode = ((payload[0] << 8) | payload[1]) & 0x01ff;
    const decodedCard = decodeFourByteSiNumber(payload[2], payload[3], payload[4], payload[5]);
    siNumber = decodedCard.siNumber;
    cardSeries = decodedCard.cardSeries;

    const td = payload[6];
    const isPm = (td & 0x01) === 1;
    siacBatteryLow = (td & 0x80) !== 0;
    const halfSec = (payload[7] << 8) | payload[8];
    punchTimeSec = (isPm ? 43200 : 0) + (halfSec % 43200);
    punchTime24h = formatSecondsAsClock(punchTimeSec);

    segments.push(
      { label: 'CN', hex: bytesToHex(payload.slice(0, 2)), meaning: `Kontroll/Station ${stationCode}` },
      {
        label: 'SI-ID',
        hex: bytesToHex(payload.slice(2, 6)),
        meaning: `Bricka ${siNumber} (${cardSeries})`,
      },
      {
        label: 'TD',
        hex: payload[6].toString(16).toUpperCase().padStart(2, '0'),
        meaning: `${isPm ? 'EM (+12h)' : 'FM (00–11)'}${siacBatteryLow ? ' · Lågt SIAC-batteri' : ''}`,
      },
      {
        label: 'TH:TL',
        hex: bytesToHex(payload.slice(7, 9)),
        meaning: `Stämpeltid ${punchTime24h}`,
      }
    );
  } else if (cmd === SI_CMD.GET_SI5) {
    if (payload.length === 0) {
      segments.push({
        label: 'REQ',
        hex: '—',
        meaning: 'Begär 128-byte minnesark från SI-Card 5',
      });
    } else if (payload.length >= 130) {
      stationCode = ((payload[0] << 8) | payload[1]) & 0x01ff;
      blockNumber = 0;
      blockData = Array.from(payload.slice(2, 130));
      const base16 = ((blockData[4] << 8) | blockData[5]) & 0xffff;
      const cns = blockData[6] & 0xff;
      siNumber = cns <= 1 ? base16 : cns * 100_000 + base16;
      cardSeries = 'SI-Card 5';
      const rcCount = Math.max(0, (blockData[23] & 0xff) - 1);
      segments.push(
        { label: 'CN', hex: bytesToHex(payload.slice(0, 2)), meaning: `Avläsningsstation ${stationCode}` },
        {
          label: 'SI5-ID',
          hex: bytesToHex(payload.slice(6, 9)),
          meaning: `SI-Card 5 nr ${siNumber} (CNS ${cns})`,
        },
        {
          label: 'SHEET',
          hex: `${bytesToHex(payload.slice(21, 29))} ...`,
          meaning: `128-byte SI5-ark (${rcCount} stämplingar, 12h-format)`,
        }
      );
    }
  } else if (cmd === SI_CMD.GET_SI6) {
    if (payload.length === 1) {
      blockNumber = payload[0];
      segments.push({
        label: 'BN',
        hex: blockNumber.toString(16).toUpperCase().padStart(2, '0'),
        meaning: `Begär SI-Card 6 minnesblock ${blockNumber} (128 byte)`,
      });
    } else if (payload.length >= 131) {
      stationCode = ((payload[0] << 8) | payload[1]) & 0x01ff;
      blockNumber = payload[2];
      blockData = Array.from(payload.slice(3, 131));
      cardSeries = 'SI-Card 6';
      if (blockNumber === 0) {
        siNumber = ((blockData[11] << 16) | (blockData[12] << 8) | blockData[13]) >>> 0;
      }
      segments.push(
        { label: 'CN', hex: bytesToHex(payload.slice(0, 2)), meaning: `Avläsningsstation ${stationCode}` },
        {
          label: 'BN',
          hex: blockNumber.toString(16).toUpperCase().padStart(2, '0'),
          meaning: `SI-Card 6 minnesblock ${blockNumber}`,
        },
        {
          label: 'EEPROM',
          hex: `${bytesToHex(payload.slice(3, 15))} ...`,
          meaning:
            blockNumber === 0
              ? `SI6 Huvudblock: Bricka ${siNumber ?? ''} · RC (${blockData[18]} stämplingar)`
              : `SI6 Stämpelblock ${blockNumber} (upp till 32 kontroller × 4 byte)`,
        }
      );
    }
  } else if (cmd === SI_CMD.GET_SI9) {
    if (payload.length === 1) {
      blockNumber = payload[0];
      segments.push({
        label: 'BN',
        hex: blockNumber.toString(16).toUpperCase().padStart(2, '0'),
        meaning: `Begär minnesblock ${blockNumber} (128 byte)`,
      });
    } else if (payload.length >= 131) {
      stationCode = ((payload[0] << 8) | payload[1]) & 0x01ff;
      blockNumber = payload[2];
      blockData = Array.from(payload.slice(3, 131));
      segments.push(
        { label: 'CN', hex: bytesToHex(payload.slice(0, 2)), meaning: `Avläsningsstation ${stationCode}` },
        {
          label: 'BN',
          hex: blockNumber.toString(16).toUpperCase().padStart(2, '0'),
          meaning: `Minnesblock ${blockNumber}`,
        },
        {
          label: 'EEPROM',
          hex: `${bytesToHex(payload.slice(3, 15))} ...`,
          meaning:
            blockNumber === 0
              ? `Huvudblock: Check/Start/Mål + RC (${blockData[22]} stämplingar)`
              : `Stämpelblock ${blockNumber} (upp till 32 kontroller × 4 byte)`,
        }
      );
    }
  } else if (
    (cmd === SI_CMD.SI5_DET || cmd === SI_CMD.SI6_DET || cmd === SI_CMD.SI9_DET) &&
    payload.length >= 6
  ) {
    stationCode = ((payload[0] << 8) | payload[1]) & 0x01ff;
    const decodedCard = decodeFourByteSiNumber(payload[2], payload[3], payload[4], payload[5]);
    siNumber = decodedCard.siNumber;
    cardSeries =
      cmd === SI_CMD.SI5_DET
        ? 'SI-Card 5'
        : cmd === SI_CMD.SI6_DET
        ? 'SI-Card 6'
        : decodedCard.cardSeries;
    segments.push(
      { label: 'CN', hex: bytesToHex(payload.slice(0, 2)), meaning: `Station ${stationCode}` },
      {
        label: 'SI-ID',
        hex: bytesToHex(payload.slice(2, 6)),
        meaning: `Insatt bricka ${siNumber} (${cardSeries})`,
      }
    );
  } else if (payload.length > 0) {
    segments.push({
      label: 'DATA',
      hex: bytesToHex(payload.slice(0, 16)),
      meaning: `Payload (${payload.length} byte)`,
    });
  }

  const rxCrcHex = rxCrc.toString(16).toUpperCase().padStart(4, '0');
  const compCrcHex = computedCrc.toString(16).toUpperCase().padStart(4, '0');
  segments.push(
    {
      label: 'CRC16',
      hex: `${rxCrcHex.slice(0, 2)} ${rxCrcHex.slice(2, 4)}`,
      meaning: crcValid
        ? `Giltig SPORTident CRC16 (0x${compCrcHex})`
        : `CRC-fel (väntade 0x${compCrcHex})`,
    },
    { label: 'ETX', hex: '03', meaning: 'Slut på ram' }
  );

  return {
    id: `frm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    direction,
    commandHex: `0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`,
    commandName: getCommandName(cmd),
    rawHex: bytesToHex(rawFrame),
    crcValid,
    computedCrcHex: `0x${compCrcHex}`,
    receivedCrcHex: `0x${rxCrcHex}`,
    stationCode,
    siNumber,
    cardSeries,
    punchTime24h,
    punchTimeSec,
    blockNumber,
    blockData,
    siacBatteryLow,
    segments,
    source,
  };
}

export function parseSportidentStream(
  buffer: Uint8Array,
  source: FrameHardwareSource = 'USB_WEBSERIAL'
): {
  frames: RawSIFrameLog[];
  remaining: Uint8Array;
} {
  const frames: RawSIFrameLog[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    while (cursor < buffer.length && buffer[cursor] !== SI_STX) {
      cursor++;
    }
    if (cursor >= buffer.length) {
      return { frames, remaining: new Uint8Array(0) };
    }
    if (buffer.length - cursor < 6) {
      return { frames, remaining: buffer.slice(cursor) };
    }

    const cmd = buffer[cursor + 1];
    if (cmd >= 0x80) {
      const len = buffer[cursor + 2];
      const totalFrameLen = 3 + len + 3;
      if (len > 140) {
        cursor++;
        continue;
      }
      if (buffer.length - cursor < totalFrameLen) {
        return { frames, remaining: buffer.slice(cursor) };
      }
      if (buffer[cursor + totalFrameLen - 1] !== SI_ETX) {
        cursor++;
        continue;
      }

      const rawSlice = buffer.slice(cursor, cursor + totalFrameLen);
      const decoded = decodeSingleFrame(rawSlice, 'RX', source);
      if (decoded) frames.push(decoded);
      cursor += totalFrameLen;
    } else {
      let endIdx = -1;
      for (let i = cursor + 2; i < buffer.length; i++) {
        if (buffer[i] === SI_DLE) {
          i++;
          continue;
        }
        if (buffer[i] === SI_ETX) {
          endIdx = i;
          break;
        }
      }
      if (endIdx === -1) return { frames, remaining: buffer.slice(cursor) };
      cursor = endIdx + 1;
    }
  }

  return { frames, remaining: new Uint8Array(0) };
}
