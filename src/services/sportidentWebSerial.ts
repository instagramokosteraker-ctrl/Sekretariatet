import {
  SI_ACK,
  buildGetSi5Frame,
  buildGetSi6BlockFrame,
  buildGetSi9BlockFrame,
  buildGetSystemConfigFrame,
  buildSetMasterModeFrame,
  buildStationBeepFrame,
  decodeSingleFrame,
  parseSi5SheetToReadout,
  parseSi6BlocksToReadout,
  parseSi9BlocksToReadout,
  parseSportidentStream,
} from './sportidentProtocol';
import type {
  FrameHardwareSource,
  FullCardReadoutPayload,
  RawSIFrameLog,
  SICardSeries,
} from '../types/sportident';

interface WebSerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface WebSerialPort {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): WebSerialPortInfo;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface WebUsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}

interface WebUsbInterface {
  interfaceNumber: number;
  alternate: {
    endpoints: WebUsbEndpoint[];
  };
}

interface WebUsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  configuration: {
    interfaces: WebUsbInterface[];
  } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(
    setup: {
      requestType: 'standard' | 'class' | 'vendor';
      recipient: 'device' | 'interface' | 'endpoint' | 'other';
      request: number;
      value: number;
      index: number;
    },
    data?: BufferSource
  ): Promise<{ status: string; bytesWritten: number }>;
  transferIn(
    endpointNumber: number,
    length: number
  ): Promise<{ status: string; data?: DataView }>;
  transferOut(
    endpointNumber: number,
    data: BufferSource
  ): Promise<{ status: string; bytesWritten: number }>;
}

export type UsbStationMode = 'READOUT' | 'REGISTRATION' | 'START_CORRAL';
export type HardwareTransportType = 'WEB_SERIAL' | 'WEB_USB' | null;

export interface SerialConnectionStatus {
  supported: boolean;
  webUsbSupported: boolean;
  activeTransport: HardwareTransportType;
  connected: boolean;
  connecting: boolean;
  baudRate: 38400 | 4800;
  vendorProductLabel: string | null;
  usbMode: UsbStationMode;
  error: string | null;
}

type FrameCallback = (frame: RawSIFrameLog) => void;
type StatusCallback = (status: SerialConnectionStatus) => void;
type ReadoutCallback = (readout: FullCardReadoutPayload) => void;
type RegistrationCardCallback = (siNumber: number, cardSeries: SICardSeries) => void;

// Silicon Labs CP210x AN571 Vendor Control Requests (used in SPORTident BSM7-USB, BSM8-USB, SRR-USB)
const CP210X_IFC_ENABLE = 0x00;
const CP210X_SET_LINE_CTL = 0x03;
const CP210X_SET_MHS = 0x07;
const CP210X_SET_BAUDRATE = 0x1e;

class SportidentWebSerialManager {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  private usbDevice: WebUsbDevice | null = null;
  private usbInterfaceNumber = 0;
  private usbInEndpoint = 1;
  private usbOutEndpoint = 1;

  private keepReading = false;
  private status: SerialConnectionStatus = {
    supported: typeof navigator !== 'undefined' && 'serial' in navigator,
    webUsbSupported: typeof navigator !== 'undefined' && 'usb' in navigator,
    activeTransport: null,
    connected: false,
    connecting: false,
    baudRate: 38400,
    vendorProductLabel: null,
    usbMode: 'READOUT',
    error: null,
  };

  // Unified readout state machine for SI5 (0xB1), SI6 (0xE1), and SI8/9/10/11/SIAC (0xEF)
  private activeReadout: {
    family: 'SI5' | 'SI6' | 'SI9';
    stationCode: number;
    blocks: Map<number, number[]>;
    pendingBlocks: number[];
    firstRawHex: string;
  } | null = null;

  private frameListeners = new Set<FrameCallback>();
  private statusListeners = new Set<StatusCallback>();
  private readoutListeners = new Set<ReadoutCallback>();
  private registrationCardListeners = new Set<RegistrationCardCallback>();

  public getStatus(): SerialConnectionStatus {
    return { ...this.status };
  }

  public onFrame(cb: FrameCallback): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  public onStatusChange(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    cb(this.getStatus());
    return () => this.statusListeners.delete(cb);
  }

  public onFullCardReadout(cb: ReadoutCallback): () => void {
    this.readoutListeners.add(cb);
    return () => this.readoutListeners.delete(cb);
  }

  public onRegistrationCard(cb: RegistrationCardCallback): () => void {
    this.registrationCardListeners.add(cb);
    return () => this.registrationCardListeners.delete(cb);
  }

  private updateStatus(patch: Partial<SerialConnectionStatus>) {
    this.status = { ...this.status, ...patch };
    const snapshot = this.getStatus();
    this.statusListeners.forEach((cb) => cb(snapshot));
  }

  private emitFrame(frame: RawSIFrameLog) {
    this.frameListeners.forEach((cb) => cb(frame));
  }

  public setUsbMode(usbMode: UsbStationMode) {
    if (usbMode !== 'READOUT') {
      this.activeReadout = null;
    }
    this.updateStatus({ usbMode });
  }

  public clearError() {
    if (this.status.error !== null) {
      this.updateStatus({ error: null });
    }
  }

  public setBaudRate(baudRate: 38400 | 4800) {
    this.updateStatus({ baudRate });
  }

  private getCurrentFrameSource(): FrameHardwareSource {
    return this.status.activeTransport === 'WEB_USB' ? 'USB_WEBUSB' : 'USB_WEBSERIAL';
  }

  /**
   * Silent auto-reconnect to a previously granted SPORTident USB station (zero browser popup!).
   * Uses navigator.serial.getPorts() on PC/Mac or navigator.usb.getDevices() on Android OTG.
   */
  public async tryAutoReconnect(baudRate?: 38400 | 4800): Promise<boolean> {
    if (this.status.connected || this.status.connecting) return this.status.connected;
    const targetBaud = baudRate ?? this.status.baudRate;

    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      try {
        const serialApi = (navigator as unknown as {
          serial: { getPorts?: () => Promise<WebSerialPort[]> };
        }).serial;
        if (serialApi.getPorts) {
          const grantedPorts = await serialApi.getPorts();
          // Prefer Silicon Labs / SPORTident VID 0x10C4 if multiple ports granted
          const siPort =
            grantedPorts.find((p) => p.getInfo?.().usbVendorId === 0x10c4) ??
            grantedPorts[0];
          if (siPort) {
            return await this.openSerialPortInstance(siPort, targetBaud, true);
          }
        }
      } catch {
        // Silent fallback if port is unplugged
      }
    }

    if (typeof navigator !== 'undefined' && 'usb' in navigator) {
      try {
        const usbApi = (navigator as unknown as {
          usb: { getDevices?: () => Promise<WebUsbDevice[]> };
        }).usb;
        if (usbApi.getDevices) {
          const grantedDevices = await usbApi.getDevices();
          const siDev = grantedDevices.find((d) => d.vendorId === 0x10c4);
          if (siDev) {
            return await this.openWebUsbDeviceInstance(siDev, targetBaud, true);
          }
        }
      } catch {
        // Silent fallback if USB device is unplugged
      }
    }

    return false;
  }

  private async openSerialPortInstance(
    port: WebSerialPort,
    targetBaud: 38400 | 4800,
    silentOnFail = false
  ): Promise<boolean> {
    await this.disconnect();
    this.updateStatus({ connecting: true, baudRate: targetBaud, error: null });
    try {
      await port.open({
        baudRate: targetBaud,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      });

      this.port = port;
      const info = port.getInfo ? port.getInfo() : {};
      let label = 'Web Serial USB-port';
      if (info.usbVendorId === 0x10c4 && info.usbProductId === 0x800a) {
        label = 'SPORTident USB Master (CP210x 10C4:800A · Web Serial)';
      } else if (info.usbVendorId === 0x10c4) {
        label = `Silicon Labs USB (10C4:${(info.usbProductId ?? 0)
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')} · Web Serial)`;
      }

      this.keepReading = true;
      this.updateStatus({
        activeTransport: 'WEB_SERIAL',
        connected: true,
        connecting: false,
        vendorProductLabel: label,
        error: null,
      });

      void this.readLoopSerial();
      await this.sendFrame(buildSetMasterModeFrame(true, true));
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus({
        activeTransport: null,
        connected: false,
        connecting: false,
        error: silentOnFail ? null : `Kunde inte öppna serieport: ${msg}`,
      });
      return false;
    }
  }

  /**
   * Smart connect: first attempts silent auto-reconnect to any previously granted station
   * (zero browser dialog!), then falls back to one-time Web Serial / WebUSB permission chooser.
   */
  public async connect(baudRate?: 38400 | 4800): Promise<boolean> {
    const autoOk = await this.tryAutoReconnect(baudRate);
    if (autoOk) return true;

    if (typeof navigator !== 'undefined' && !('serial' in navigator) && 'usb' in navigator) {
      return this.connectWebUsb(baudRate);
    }

    const targetBaud = baudRate ?? this.status.baudRate;
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      this.updateStatus({
        supported: false,
        error:
          'Varken Web Serial (Dator) eller WebUSB (Android) stöds i denna webbläsare. Använd Chrome/Edge på dator eller Chrome på Android med USB-OTG.',
      });
      return false;
    }

    this.updateStatus({ connecting: true, baudRate: targetBaud, error: null });

    try {
      const serialApi = (navigator as unknown as {
        serial: { requestPort: (opts?: object) => Promise<WebSerialPort> };
      }).serial;

      const port = await serialApi.requestPort();
      return await this.openSerialPortInstance(port, targetBaud, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCancelled =
        msg.includes('No port selected') || msg.includes('The user cancelled');
      const isIframePolicy =
        msg.includes('Permissions policy') || msg.includes('disallowed by permissions policy');

      this.updateStatus({
        activeTransport: null,
        connected: false,
        connecting: false,
        error: isCancelled
          ? null
          : isIframePolicy
          ? 'Direkt USB-åtkomst blockeras i inbäddad förhandsgranskning. Öppna appen i en egen flik i Chrome/Edge för fysisk BSM7/BSM8-avläsning, eller testa via MeOS-testbänken.'
          : `Kunde inte öppna serieport: ${msg}`,
      });
      return false;
    }
  }

  private async openWebUsbDeviceInstance(
    device: WebUsbDevice,
    targetBaud: 38400 | 4800,
    silentOnFail = false
  ): Promise<boolean> {
    await this.disconnect();
    this.updateStatus({ connecting: true, baudRate: targetBaud, error: null });
    try {
      await device.open();
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }

      const iface = device.configuration?.interfaces[0];
      const ifaceNum = iface?.interfaceNumber ?? 0;
      await device.claimInterface(ifaceNum);

      let inEp = 1;
      let outEp = 1;
      for (const ep of iface?.alternate.endpoints ?? []) {
        if (ep.type === 'bulk' && ep.direction === 'in') inEp = ep.endpointNumber;
        if (ep.type === 'bulk' && ep.direction === 'out') outEp = ep.endpointNumber;
      }

      await device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'interface',
        request: CP210X_IFC_ENABLE,
        value: 0x0001,
        index: ifaceNum,
      });

      await device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'interface',
        request: CP210X_SET_LINE_CTL,
        value: 0x0800,
        index: ifaceNum,
      });

      await device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'interface',
        request: CP210X_SET_MHS,
        value: 0x0303,
        index: ifaceNum,
      });

      const baudBuf = new ArrayBuffer(4);
      new DataView(baudBuf).setUint32(0, targetBaud, true);
      await device.controlTransferOut(
        {
          requestType: 'vendor',
          recipient: 'interface',
          request: CP210X_SET_BAUDRATE,
          value: 0,
          index: ifaceNum,
        },
        baudBuf
      );

      this.usbDevice = device;
      this.usbInterfaceNumber = ifaceNum;
      this.usbInEndpoint = inEp;
      this.usbOutEndpoint = outEp;
      this.keepReading = true;

      const prodLabel =
        device.productId === 0x800a
          ? 'SPORTident BSM7/BSM8/SRR (CP210x · Android/WebUSB)'
          : `${device.productName || 'Silicon Labs CP210x'} (WebUSB)`;

      this.updateStatus({
        activeTransport: 'WEB_USB',
        connected: true,
        connecting: false,
        vendorProductLabel: prodLabel,
        error: null,
      });

      void this.readLoopWebUsb();
      await this.sendFrame(buildSetMasterModeFrame(true, true));
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus({
        activeTransport: null,
        connected: false,
        connecting: false,
        error: silentOnFail ? null : `Kunde inte ansluta via WebUSB (CP210x): ${msg}`,
      });
      return false;
    }
  }

  /**
   * Direct Silicon Labs CP210x WebUSB driver for Android tablets & phones via USB-C OTG!
   * First attempts silent auto-reconnect to any already granted CP210x device.
   */
  public async connectWebUsb(baudRate?: 38400 | 4800): Promise<boolean> {
    const targetBaud = baudRate ?? this.status.baudRate;
    if (typeof navigator === 'undefined' || !('usb' in navigator)) {
      this.updateStatus({
        webUsbSupported: false,
        error:
          'WebUSB API stöds ej i denna webbläsare. Använd Chrome på Android (med USB-C OTG-adapter) eller Chrome/Edge på dator.',
      });
      return false;
    }

    const autoOk = await this.tryAutoReconnect(targetBaud);
    if (autoOk) return true;

    this.updateStatus({ connecting: true, baudRate: targetBaud, error: null });

    try {
      const usbApi = (navigator as unknown as {
        usb: { requestDevice: (opts: { filters: object[] }) => Promise<WebUsbDevice> };
      }).usb;

      const device = await usbApi.requestDevice({
        filters: [{ vendorId: 0x10c4 }],
      });
      return await this.openWebUsbDeviceInstance(device, targetBaud, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCancelled =
        msg.includes('No device selected') || msg.includes('cancelled');
      const isIframePolicy =
        msg.includes('Permissions policy') || msg.includes('disallowed by permissions policy');

      this.updateStatus({
        activeTransport: null,
        connected: false,
        connecting: false,
        error: isCancelled
          ? null
          : isIframePolicy
          ? 'WebUSB blockeras i inbäddad ram. Öppna appen i en egen flik i Chrome (på Android eller dator) för direkt CP210x WebUSB-anslutning.'
          : `Kunde inte ansluta via WebUSB (CP210x): ${msg}`,
      });
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.keepReading = false;
    this.activeReadout = null;
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
      if (this.usbDevice) {
        try {
          await this.usbDevice.controlTransferOut({
            requestType: 'vendor',
            recipient: 'interface',
            request: CP210X_IFC_ENABLE,
            value: 0x0000,
            index: this.usbInterfaceNumber,
          });
          await this.usbDevice.releaseInterface(this.usbInterfaceNumber);
        } catch {
          // ignore
        }
        await this.usbDevice.close();
        this.usbDevice = null;
      }
    } catch {
      // Ignore cleanup errors
    } finally {
      this.updateStatus({
        activeTransport: null,
        connected: false,
        connecting: false,
        vendorProductLabel: null,
      });
    }
  }

  private async writeRawBytes(bytes: Uint8Array): Promise<boolean> {
    if (this.status.activeTransport === 'WEB_USB' && this.usbDevice) {
      await this.usbDevice.transferOut(this.usbOutEndpoint, new Uint8Array(bytes));
      return true;
    }
    if (this.port && this.port.writable) {
      const writer = this.port.writable.getWriter();
      await writer.write(bytes);
      writer.releaseLock();
      return true;
    }
    return false;
  }

  public async sendFrame(bytes: Uint8Array): Promise<boolean> {
    try {
      const ok = await this.writeRawBytes(bytes);
      if (!ok) return false;

      const txLog = decodeSingleFrame(bytes, 'TX', this.getCurrentFrameSource());
      if (txLog) this.emitFrame(txLog);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus({ error: `Sändningsfel på USB-port: ${msg}` });
      return false;
    }
  }

  private async sendAckByte(): Promise<void> {
    try {
      await this.writeRawBytes(new Uint8Array([SI_ACK]));
    } catch {
      // ignore
    }
  }

  public async requestDirectMode(): Promise<boolean> {
    return this.sendFrame(buildSetMasterModeFrame(true, true));
  }

  public async requestSystemConfig(): Promise<boolean> {
    return this.sendFrame(buildGetSystemConfigFrame(0x00, 0x80));
  }

  public async triggerStationBeep(beeps = 1): Promise<boolean> {
    return this.sendFrame(buildStationBeepFrame(beeps));
  }

  private async handleIncomingProtocolFrame(frame: RawSIFrameLog): Promise<void> {
    this.emitFrame(frame);
    if (!frame.crcValid) return;

    const src = this.getCurrentFrameSource();

    // 1. Direct Registration / Start Corral Mode: capture SI number immediately & beep!
    if (
      (this.status.usbMode === 'REGISTRATION' ||
        this.status.usbMode === 'START_CORRAL') &&
      (frame.commandHex === '0xE5' ||
        frame.commandHex === '0xE6' ||
        frame.commandHex === '0xE8' ||
        frame.commandHex === '0xD3') &&
      frame.siNumber
    ) {
      await this.sendAckByte();
      this.registrationCardListeners.forEach((cb) =>
        cb(frame.siNumber!, frame.cardSeries ?? 'SIAC Air+')
      );
      return;
    }

    // 2. Classic SI-Card 5 Readout (0xE5 -> 0xB1 128-byte sheet -> ACK)
    if (frame.commandHex === '0xE5') {
      this.activeReadout = {
        family: 'SI5',
        stationCode: frame.stationCode ?? 1,
        blocks: new Map<number, number[]>(),
        pendingBlocks: [],
        firstRawHex: frame.rawHex,
      };
      await this.sendFrame(buildGetSi5Frame());
      return;
    }

    if (
      frame.commandHex === '0xB1' &&
      frame.blockData &&
      this.activeReadout?.family === 'SI5'
    ) {
      await this.sendAckByte();
      const completed = parseSi5SheetToReadout(
        this.activeReadout.stationCode,
        frame.blockData,
        frame.rawHex,
        src
      );
      this.activeReadout = null;
      if (completed) {
        this.readoutListeners.forEach((cb) => cb(completed));
      }
      return;
    }

    // 3. Classic SI-Card 6 Readout (0xE6 -> 0xE1 Block 0 -> Block 6..7 -> ACK)
    if (frame.commandHex === '0xE6') {
      this.activeReadout = {
        family: 'SI6',
        stationCode: frame.stationCode ?? 1,
        blocks: new Map<number, number[]>(),
        pendingBlocks: [],
        firstRawHex: frame.rawHex,
      };
      await this.sendFrame(buildGetSi6BlockFrame(0));
      return;
    }

    if (
      frame.commandHex === '0xE1' &&
      frame.blockNumber !== undefined &&
      frame.blockData &&
      this.activeReadout?.family === 'SI6'
    ) {
      this.activeReadout.blocks.set(frame.blockNumber, frame.blockData);

      if (frame.blockNumber === 0) {
        const punchCount = frame.blockData[18] & 0xff;
        const needed: number[] = [];
        if (punchCount > 0) needed.push(6);
        if (punchCount > 32) needed.push(7);
        this.activeReadout.pendingBlocks = needed;
      }

      const nextBlk = this.activeReadout.pendingBlocks.shift();
      if (nextBlk !== undefined) {
        await this.sendFrame(buildGetSi6BlockFrame(nextBlk));
      } else {
        await this.sendAckByte();
        const completed = parseSi6BlocksToReadout(
          this.activeReadout.stationCode,
          this.activeReadout.blocks,
          frame.rawHex,
          src
        );
        this.activeReadout = null;
        if (completed) {
          this.readoutListeners.forEach((cb) => cb(completed));
        }
      }
      return;
    }

    // 4. Modern SI-Card 8/9/10/11/SIAC Readout (0xE8 -> 0xEF Block 0 -> Block 1 / 4..7 -> ACK)
    if (frame.commandHex === '0xE8') {
      this.activeReadout = {
        family: 'SI9',
        stationCode: frame.stationCode ?? 1,
        blocks: new Map<number, number[]>(),
        pendingBlocks: [],
        firstRawHex: frame.rawHex,
      };
      await this.sendFrame(buildGetSi9BlockFrame(0));
      return;
    }

    if (
      frame.commandHex === '0xEF' &&
      frame.blockNumber !== undefined &&
      frame.blockData &&
      this.activeReadout?.family === 'SI9'
    ) {
      this.activeReadout.blocks.set(frame.blockNumber, frame.blockData);

      if (frame.blockNumber === 0) {
        const seriesByte = frame.blockData[24];
        const punchCount = frame.blockData[22] & 0xff;
        const needed: number[] = [];

        if (seriesByte === 0x0f) {
          const blockCount = Math.ceil(punchCount / 32);
          for (let i = 0; i < blockCount && i < 4; i++) {
            needed.push(4 + i);
          }
        } else if (punchCount > 0) {
          needed.push(1);
        }

        this.activeReadout.pendingBlocks = needed;
      }

      const nextBlock = this.activeReadout.pendingBlocks.shift();
      if (nextBlock !== undefined) {
        await this.sendFrame(buildGetSi9BlockFrame(nextBlock));
      } else {
        await this.sendAckByte();
        const completed = parseSi9BlocksToReadout(
          this.activeReadout.stationCode,
          this.activeReadout.blocks,
          frame.rawHex,
          src
        );
        this.activeReadout = null;
        if (completed) {
          this.readoutListeners.forEach((cb) => cb(completed));
        }
      }
    }
  }

  private async readLoopSerial(): Promise<void> {
    if (!this.port || !this.port.readable) return;
    let buffer: Uint8Array = new Uint8Array(0);

    try {
      this.reader = this.port.readable.getReader();
      while (this.keepReading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer, 0);
        combined.set(value, buffer.length);

        const parsed = parseSportidentStream(combined, 'USB_WEBSERIAL');
        buffer = parsed.remaining;

        for (const frame of parsed.frames) {
          await this.handleIncomingProtocolFrame(frame);
        }
      }
    } catch (err: unknown) {
      if (this.keepReading) {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateStatus({
          activeTransport: null,
          connected: false,
          vendorProductLabel: null,
          error: `USB-anslutningen bröts: ${msg}`,
        });
      }
    } finally {
      if (this.reader) {
        try {
          this.reader.releaseLock();
        } catch {
          // ignore
        }
        this.reader = null;
      }
    }
  }

  private async readLoopWebUsb(): Promise<void> {
    if (!this.usbDevice) return;
    let buffer: Uint8Array = new Uint8Array(0);

    try {
      while (this.keepReading && this.usbDevice) {
        const res = await this.usbDevice.transferIn(this.usbInEndpoint, 64);
        if (res.status === 'ok' && res.data && res.data.byteLength > 0) {
          const chunk = new Uint8Array(
            res.data.buffer,
            res.data.byteOffset,
            res.data.byteLength
          );
          const combined = new Uint8Array(buffer.length + chunk.length);
          combined.set(buffer, 0);
          combined.set(chunk, buffer.length);

          const parsed = parseSportidentStream(combined, 'USB_WEBUSB');
          buffer = parsed.remaining;

          for (const frame of parsed.frames) {
            await this.handleIncomingProtocolFrame(frame);
          }
        }
      }
    } catch (err: unknown) {
      if (this.keepReading) {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateStatus({
          activeTransport: null,
          connected: false,
          vendorProductLabel: null,
          error: `WebUSB-anslutningen bröts: ${msg}`,
        });
      }
    }
  }
}

export const sportidentSerial = new SportidentWebSerialManager();

let sharedAudioCtx: AudioContext | null = null;

export function playMeosFeedbackTone(
  kind: 'ok' | 'radio' | 'mp' | 'registration' | 'start_tick' | 'start_go'
): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();

    const now = sharedAudioCtx.currentTime;

    if (kind === 'start_tick') {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (kind === 'start_go') {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2000, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
    } else if (kind === 'ok' || kind === 'registration') {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(kind === 'ok' ? 2780 : 2350, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (kind === 'radio') {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1850, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } else {
      [0, 0.16].forEach((offset) => {
        if (!sharedAudioCtx) return;
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now + offset);
        gain.gain.setValueAtTime(0.07, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.13);
      });
    }
  } catch {
    // Optional audio
  }
}
