import type { ClubSettings } from '../types/sportident';

export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const MAX_LOGO_DATA_URL_LENGTH = 200_000;

export interface ClubColorPreset {
  id: string;
  label: string;
  bgColor: string;
  textColor: string;
  accentColor: string;
}

export const CLUB_COLOR_PRESETS: ClubColorPreset[] = [
  {
    id: 'default',
    label: 'Standard (Skiffer & Röd)',
    bgColor: '',
    textColor: '',
    accentColor: '',
  },
  {
    id: 'forest',
    label: 'Skogsgrön & Natur',
    bgColor: '#f2f7f4',
    textColor: '#0f2419',
    accentColor: '#15803d',
  },
  {
    id: 'navy',
    label: 'Marinblå & Krispig',
    bgColor: '#f3f6fb',
    textColor: '#0f1d35',
    accentColor: '#1d4ed8',
  },
  {
    id: 'crimson',
    label: 'Klubbröd & Varmvit',
    bgColor: '#faf6f5',
    textColor: '#1f1412',
    accentColor: '#b91c1c',
  },
  {
    id: 'amber',
    label: 'Svart & Klubbguld',
    bgColor: '#f8f7f2',
    textColor: '#171612',
    accentColor: '#b45309',
  },
];

export function sanitizeHexColor(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed.toLowerCase() : '';
}

export function isValidLogoDataUrl(raw?: string | null): boolean {
  if (!raw) return true;
  if (raw.length > MAX_LOGO_DATA_URL_LENGTH) return false;
  return (
    raw.startsWith('data:image/png;base64,') ||
    raw.startsWith('data:image/jpeg;base64,')
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_COLOR_REGEX.test(hex)) return null;
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(
    a.r * (1 - w) + b.r * w,
    a.g * (1 - w) + b.g * w,
    a.b * (1 - w) + b.b * w
  );
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/**
 * Applies club background, text, surface, border, and accent CSS custom properties
 * to `document.documentElement` without inline JSX style attributes.
 * Preserves dark-mode readability when `darkMode` is enabled.
 */
export function applyClubThemeToDocument(
  settings: Partial<ClubSettings> | null | undefined,
  darkMode: boolean
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const customBg = sanitizeHexColor(settings?.customBgColor);
  const customText = sanitizeHexColor(settings?.customTextColor);
  const customAccent = sanitizeHexColor(settings?.customAccentColor);

  const effectiveAccent = customAccent || '#dc2626';
  const hasCustomTheme = Boolean(customBg || customText || customAccent);
  const accentLum = relativeLuminance(effectiveAccent);
  const accentHover =
    accentLum > 0.45
      ? mixHex(effectiveAccent, '#000000', 0.14)
      : mixHex(effectiveAccent, '#000000', 0.16);
  const accentFg = accentLum > 0.42 ? '#0f172a' : '#ffffff';

  root.style.setProperty('--club-accent', effectiveAccent);
  root.style.setProperty('--club-accent-hover', accentHover);
  root.style.setProperty('--club-accent-fg', accentFg);
  if (hasCustomTheme) {
    root.setAttribute('data-club-custom', 'true');
  } else {
    root.removeAttribute('data-club-custom');
  }

  if (!darkMode && (customBg || customText)) {
    const bg = customBg || '#f8fafc';
    const bgLum = relativeLuminance(bg);
    const defaultTextForBg = bgLum < 0.28 ? '#f8fafc' : '#0f172a';
    const text = customText || defaultTextForBg;

    // Derive elevated card surface and subtle hairline border from chosen canvas & text
    const surface =
      bgLum < 0.28
        ? mixHex(bg, '#ffffff', 0.07)
        : bgLum > 0.94
        ? '#ffffff'
        : mixHex(bg, '#ffffff', 0.68);
    const surfaceSubtle = mixHex(bg, text, 0.05);
    const border = mixHex(bg, text, 0.14);
    const muted = mixHex(bg, text, 0.66);

    root.style.setProperty('--club-bg', bg);
    root.style.setProperty('--club-surface', surface);
    root.style.setProperty('--club-surface-subtle', surfaceSubtle);
    root.style.setProperty('--club-border', border);
    root.style.setProperty('--club-text', text);
    root.style.setProperty('--club-muted', muted);
  } else {
    root.style.removeProperty('--club-bg');
    root.style.removeProperty('--club-surface');
    root.style.removeProperty('--club-surface-subtle');
    root.style.removeProperty('--club-border');
    root.style.removeProperty('--club-text');
    root.style.removeProperty('--club-muted');
  }
}

/**
 * Validates and proportionally scales an uploaded JPG or PNG club logo so it stays crisp
 * in headers while guaranteed <= MAX_LOGO_DATA_URL_LENGTH for server & Firestore storage.
 */
export async function processClubLogoFile(file: File): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const lowerName = file.name.toLowerCase();
  const isPng = mime === 'image/png' || lowerName.endsWith('.png');
  const isJpg =
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg');

  if (!isPng && !isJpg) {
    throw new Error('Välj en bildfil i formatet JPG eller PNG.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Bildfilen är för stor (max 8 MB).');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Kunde inte läsa bildfilen.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Kunde inte tolka bilden. Kontrollera att filen är en giltig JPG eller PNG.'));
    el.src = rawDataUrl;
  });

  const attempts: { maxW: number; maxH: number; format: 'image/png' | 'image/jpeg'; quality: number }[] = [
    { maxW: 360, maxH: 120, format: isPng ? 'image/png' : 'image/jpeg', quality: 0.88 },
    { maxW: 260, maxH: 90, format: isPng ? 'image/png' : 'image/jpeg', quality: 0.84 },
    { maxW: 220, maxH: 76, format: 'image/jpeg', quality: 0.82 },
  ];

  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.maxW / img.naturalWidth, attempt.maxH / img.naturalHeight);
    const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
    const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Webbläsaren saknar stöd för bildskalning.');
    }

    if (attempt.format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
    } else {
      ctx.clearRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const encoded =
      attempt.format === 'image/png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', attempt.quality);

    if (encoded.length <= MAX_LOGO_DATA_URL_LENGTH && isValidLogoDataUrl(encoded)) {
      return encoded;
    }
  }

  throw new Error('Klubbloggan blev för stor även efter komprimering. Prova en enklare bild.');
}
