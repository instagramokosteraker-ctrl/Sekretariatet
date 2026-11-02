import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Play, ShieldAlert, Trash2, Wrench } from 'lucide-react';
import type { RawSIFrameLog } from '../types/sportident';
import {
  SI_ETX,
  SI_STX,
  buildSetMasterModeFrame,
  buildSi5ReadoutFrame,
  buildSi6ReadoutBlockFrames,
  buildSi10ReadoutBlockFrames,
  buildTransRecFrame,
  bytesToHex,
  computeSportidentCrc,
  decodeSingleFrame,
  hexToBytes,
} from '../services/sportidentProtocol';

interface ProtocolInspectorViewProps {
  frameLogs: RawSIFrameLog[];
  initialHexToInspect?: string | null;
  onInjectOnlineHexFrame: (rawHex: string) => Promise<void>;
  onClearFrameLogs: () => void;
}

export function ProtocolInspectorView({
  frameLogs,
  initialHexToInspect,
  onInjectOnlineHexFrame,
  onClearFrameLogs,
}: ProtocolInspectorViewProps) {
  const [hexEditor, setHexEditor] = useState<string>(() =>
    bytesToHex(buildTransRecFrame({ stationCode: 100, siNumber: 8339104, timeSec: 38075 }))
  );
  const [injecting, setInjecting] = useState(false);

  useEffect(() => {
    if (initialHexToInspect) {
      setHexEditor(initialHexToInspect);
    }
  }, [initialHexToInspect]);

  const liveDecodedPreview = useMemo(() => {
    const bytes = hexToBytes(hexEditor);
    if (!bytes) return { error: 'Ange ett jämnt antal giltiga hexadecimala tecken (0–9, A–F).' };
    const decoded = decodeSingleFrame(bytes, 'RX', 'PROTOCOL_TESTBENCH');
    if (!decoded) {
      return {
        error:
          'Ramen måste börja med STX (02), ha ett utökat kommando (>= 0x80), korrekt längdbyte och avslutas med ETX (03).',
      };
    }
    return { decoded };
  }, [hexEditor]);

  const handleRecalculateCrc = () => {
    const bytes = hexToBytes(hexEditor);
    if (!bytes || bytes.length < 6) return;
    let offset = 0;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const frame = bytes.slice(offset);
    if (frame[0] !== SI_STX) return;
    const len = frame[2];
    if (frame.length < 3 + len + 3) return;

    const core = frame.slice(1, 3 + len);
    const crc = computeSportidentCrc(core);
    const fixed = new Uint8Array([
      ...bytes.slice(0, offset),
      SI_STX,
      ...core,
      (crc >> 8) & 0xff,
      crc & 0xff,
      SI_ETX,
    ]);
    setHexEditor(bytesToHex(fixed));
  };

  const handleInject = async () => {
    if (!('decoded' in liveDecodedPreview) || !liveDecodedPreview.decoded) return;
    setInjecting(true);
    try {
      await onInjectOnlineHexFrame(liveDecodedPreview.decoded.rawHex);
    } finally {
      setInjecting(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100">
            SPORTident Protokollinspektör (0xEF EEPROM & 0xD3 Radio)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Granska råa 128-bytes minnesblock (<span className="font-mono">0xEF</span>) och
            online-radiopaket (<span className="font-mono">0xD3</span>) med 16-bitars{' '}
            <span className="font-mono">crc529</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={onClearFrameLogs}
          disabled={frameLogs.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg self-start sm:self-auto whitespace-nowrap shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Rensa ramlogg</span>
        </button>
      </div>

      {/* Hex Frame Decoder */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Hex-dekoder & CRC16-verifierare
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setHexEditor(
                  bytesToHex(
                    buildTransRecFrame({ stationCode: 100, siNumber: 8339104, timeSec: 38075 })
                  )
                )
              }
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Mall: 0xD3 Förvarning K100
            </button>

            <button
              type="button"
              onClick={() => {
                const blocks = buildSi10ReadoutBlockFrames({
                  stationCode: 1,
                  siNumber: 8190442,
                  checkTimeSec: 36110,
                  startTimeSec: 36300,
                  finishTimeSec: 37898,
                  punches: [
                    { code: 31, timeSec: 36478 },
                    { code: 42, timeSec: 36979 },
                    { code: 100, timeSec: 37859 },
                  ],
                });
                setHexEditor(bytesToHex(blocks[0]));
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Mall: 0xEF SIAC Block 0
            </button>

            <button
              type="button"
              onClick={() => {
                const blocks = buildSi6ReadoutBlockFrames({
                  stationCode: 1,
                  siNumber: 612480,
                  checkTimeSec: 36610,
                  startTimeSec: 36660,
                  finishTimeSec: 38120,
                  punches: [
                    { code: 31, timeSec: 36900 },
                    { code: 42, timeSec: 37280 },
                  ],
                });
                setHexEditor(bytesToHex(blocks[0]));
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Mall: 0xE1 SI-Card 6 Block 0
            </button>

            <button
              type="button"
              onClick={() => {
                const sheet = buildSi5ReadoutFrame({
                  stationCode: 1,
                  siNumber: 342819,
                  checkTimeSec: 36950,
                  startTimeSec: 37020,
                  finishTimeSec: 38540,
                  punches: [
                    { code: 31, timeSec: 37260 },
                    { code: 42, timeSec: 37610 },
                    { code: 100, timeSec: 38490 },
                  ],
                });
                setHexEditor(bytesToHex(sheet));
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Mall: 0xB1 SI-Card 5 (128 byte)
            </button>

            <button
              type="button"
              onClick={() => setHexEditor(bytesToHex(buildSetMasterModeFrame(true, false)))}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Mall: 0xF0 Direktläge (6D 0A)
            </button>
          </div>
        </div>

        <textarea
          rows={2}
          value={hexEditor}
          onChange={(e) => setHexEditor(e.target.value)}
          spellCheck={false}
          className="w-full p-2.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 break-all"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleRecalculateCrc}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg whitespace-nowrap"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Beräkna CRC16 (0x8005)</span>
          </button>

          {'decoded' in liveDecodedPreview &&
            liveDecodedPreview.decoded &&
            liveDecodedPreview.decoded.commandHex === '0xD3' && (
              <button
                type="button"
                disabled={injecting || !liveDecodedPreview.decoded.crcValid}
                onClick={() => void handleInject()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Skicka 0xD3 till tävlingsmotorn</span>
              </button>
            )}
        </div>

        {'error' in liveDecodedPreview ? (
          <div className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg">
            {liveDecodedPreview.error}
          </div>
        ) : (
          liveDecodedPreview.decoded && (
            <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {liveDecodedPreview.decoded.commandName}
                </span>
                {liveDecodedPreview.decoded.crcValid ? (
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>CRC16 OK ({liveDecodedPreview.decoded.computedCrcHex})</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-red-700 dark:text-red-400 font-medium">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>
                      CRC-fel ({liveDecodedPreview.decoded.receivedCrcHex} vs{' '}
                      {liveDecodedPreview.decoded.computedCrcHex})
                    </span>
                  </span>
                )}
              </div>

              <div>
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                      <th className="py-1.5 pr-2">Fält</th>
                      <th className="py-1.5 px-2">Hex</th>
                      <th className="py-1.5 pl-2">Betydelse</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                    {liveDecodedPreview.decoded.segments.map((seg, idx) => (
                      <tr key={`${seg.label}-${idx}`}>
                        <td className="py-1.5 pr-2 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                          {seg.label}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-red-700 dark:text-red-400 break-all align-top">
                          {seg.hex}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-600 dark:text-slate-400 align-top">
                          {seg.meaning}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </section>

      {/* Frame Stream */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Fångade SPORTident-ramar ({frameLogs.length})
          </h2>
        </div>

        {frameLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Inga binära SPORTident-ramar fångade ännu i denna session. Testa en 0xEF-utläsning på
            översiktssidan!
          </div>
        ) : (
          <div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2 pl-3.5 pr-2">Tid</th>
                  <th className="hidden sm:table-cell py-2 px-2">Riktning</th>
                  <th className="py-2 px-2">Kommando</th>
                  <th className="py-2 px-2">Rå Hex</th>
                  <th className="py-2 pl-2 pr-3.5 text-right">CRC16</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {frameLogs.map((frm) => (
                  <tr
                    key={frm.id}
                    onClick={() => setHexEditor(frm.rawHex)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-1.5 pl-3.5 pr-2 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(frm.timestamp).toLocaleTimeString('sv-SE')}
                    </td>
                    <td className="hidden sm:table-cell py-1.5 px-2 font-mono font-semibold whitespace-nowrap">
                      {frm.direction} ·{' '}
                      {frm.source === 'USB_WEBUSB'
                        ? 'WebUSB'
                        : frm.source === 'USB_WEBSERIAL'
                        ? 'WebSerial'
                        : 'Test'}
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      <span className="font-mono font-medium">{frm.commandHex}</span>
                      <span className="hidden md:inline text-slate-500">
                        {' '}
                        · {frm.commandName}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[11px] max-w-[90px] sm:max-w-[180px] lg:max-w-xs truncate">
                      {frm.rawHex}
                    </td>
                    <td className="py-1.5 pl-2 pr-3.5 text-right font-mono whitespace-nowrap">
                      {frm.crcValid ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {frm.computedCrcHex} OK
                        </span>
                      ) : (
                        <span className="text-red-600">FEL</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
