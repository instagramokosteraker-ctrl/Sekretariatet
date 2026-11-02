import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  PowerOff,
  Settings2,
  Smartphone,
  Usb,
  Volume2,
  X,
} from 'lucide-react';
import type {
  SerialConnectionStatus,
  UsbStationMode,
} from '../services/sportidentWebSerial';

export interface UsbStationControlProps {
  serialStatus: SerialConnectionStatus;
  roleLabel: string;
  expectedMode: UsbStationMode;
  onConnectUsb: () => Promise<void>;
  onConnectWebUsb: () => Promise<void>;
  onDisconnectUsb: () => Promise<void>;
  onSetUsbMode: (mode: UsbStationMode) => void;
  onTriggerBeep: () => Promise<void>;
  onClearError: () => void;
  onOpenHardwareSettings?: () => void;
}

export function UsbStationBar({
  serialStatus,
  roleLabel,
  expectedMode,
  onConnectUsb,
  onConnectWebUsb,
  onDisconnectUsb,
  onSetUsbMode,
  onTriggerBeep,
  onClearError,
  onOpenHardwareSettings,
}: UsbStationControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handlePrimaryConnect = async () => {
    onClearError();
    onSetUsbMode(expectedMode);
    await onConnectUsb();
  };

  if (!serialStatus.connected) {
    return (
      <div ref={containerRef} className="relative inline-flex items-center">
        <button
          type="button"
          disabled={serialStatus.connecting}
          onClick={() => void handlePrimaryConnect()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium club-accent-btn disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Usb className="w-3.5 h-3.5 shrink-0" />
          <span>
            {serialStatus.connecting ? 'Ansluter SI-station...' : 'Anslut SI-station'}
          </span>
        </button>
      </div>
    );
  }

  const modeMatches = serialStatus.usbMode === expectedMode;

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => {
          if (!modeMatches) {
            onSetUsbMode(expectedMode);
          } else {
            setMenuOpen((prev) => !prev);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
          modeMatches
            ? 'text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/50'
            : 'text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 hover:bg-amber-100/70 dark:hover:bg-amber-900/50'
        }`}
      >
        <Usb className="w-3.5 h-3.5 shrink-0" />
        <span>
          {modeMatches ? `SI-station · ${roleLabel}` : `Växla USB till ${roleLabel}`}
        </span>
        {modeMatches && <ChevronDown className="w-3.5 h-3.5 opacity-75 shrink-0" />}
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg p-1.5 text-xs">
          <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {serialStatus.vendorProductLabel || 'SPORTident USB-station'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Aktiv roll: {roleLabel} · {serialStatus.baudRate} Bd
            </div>
          </div>

          <div className="py-1 space-y-0.5">
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                await onTriggerBeep();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Testpip i SI-stationen</span>
            </button>

            {serialStatus.webUsbSupported && serialStatus.activeTransport !== 'WEB_USB' && (
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  await onConnectWebUsb();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Byt till Android OTG (WebUSB)</span>
              </button>
            )}

            {onOpenHardwareSettings && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenHardwareSettings();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Avancerade USB-inställningar</span>
              </button>
            )}
          </div>

          <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                await onDisconnectUsb();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
            >
              <PowerOff className="w-3.5 h-3.5 shrink-0" />
              <span>Koppla från SI-station</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UsbStationErrorBanner({
  serialStatus,
  onConnectWebUsb,
  onClearError,
  onOpenHardwareSettings,
}: Pick<
  UsbStationControlProps,
  'serialStatus' | 'onConnectWebUsb' | 'onClearError' | 'onOpenHardwareSettings'
>) {
  if (!serialStatus.error) return null;

  return (
    <div className="px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="font-medium">{serialStatus.error}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {serialStatus.webUsbSupported && (
          <button
            type="button"
            onClick={() => void onConnectWebUsb()}
            className="px-2 py-0.5 font-medium bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded hover:bg-amber-100/50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Prova WebUSB (OTG)
          </button>
        )}
        {onOpenHardwareSettings && (
          <button
            type="button"
            onClick={onOpenHardwareSettings}
            className="font-medium underline whitespace-nowrap"
          >
            Felsök USB
          </button>
        )}
        <button
          type="button"
          onClick={onClearError}
          className="p-0.5 text-amber-700 dark:text-amber-300 hover:opacity-80"
          aria-label="Stäng meddelande"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
