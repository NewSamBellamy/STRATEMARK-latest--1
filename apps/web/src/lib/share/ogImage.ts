/**
 * Draws the link-preview picture (1200 x 630) for a share: the card itself. A card share is one card face drawn large and
 * centred, so it survives any crop a chat app makes; a deck is a small fan of its first company cards with the first in front.
 *
 * The face is drawn from the card's own face model (see `ogFace`), with the same frame, picture panel, name, line, four figures
 * and footer as the card in the app, so what a person sees in the chat is the card they will open. Everything is plain canvas
 * drawing. The only pictures drawn are this app's own card art and, when the hosted Worker is configured, the company's logo
 * fetched through it as a file (never as a cross-origin image), so the canvas is never tainted and the PNG can always be read
 * back. A logo that cannot be had safely is replaced by the company's initial.
 */
import logoMark from '@/assets/logo-mark.svg';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';
import type { OgLayout } from './bundle';
import type { OgFace } from './ogFace';

const W = 1200;
const H = 630;
const INK = '#171a19';
const MUTED = '#68716f';
const LINE = '#dce8e5';
const BRAND = '#0f766e';
const FONT = 'system-ui, "Segoe UI", sans-serif';

/** The face is laid out on a 702 x 982 sheet and scaled to the size it is drawn at. */
const SHEET_W = 702;
const SHEET_H = 982;
const LOGO_TIMEOUT_MS = 5000;
/** The Worker refuses a preview picture over 500,000 characters of base64; stay well under it (bytes, before base64). */
export const OG_MAX_BYTES = 340_000;
/** The picture is drawn at this fraction of full size when the full-size one is too large to send. */
const FALLBACK_SCALE = 0.75;
const LOGO_MAX_BYTES = 2_000_000;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[.,;:\s]+$/, '')}…`;
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The company's logo as an image that cannot taint the canvas: a data address, or a picture fetched through the hosted Worker
 * and turned into a file in memory. Anything else (no Worker, a failed or slow fetch, not an image, too large) is no logo.
 */
export async function loadLogo(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  if (/^data:image\//i.test(url)) return loadImage(url);
  if (!/^https?:\/\//i.test(url) || !hasHostedApi()) return null;
  let file: string | null = null;
  try {
    const response = await fetch(hostedUrl(`image?url=${encodeURIComponent(url)}`), { credentials: 'omit', signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type) || blob.size > LOGO_MAX_BYTES) return null;
    file = URL.createObjectURL(blob);
    return await loadImage(file);
  } catch {
    return null;
  } finally {
    if (file) {
      const done = file;
      setTimeout(() => URL.revokeObjectURL(done), 0);
    }
  }
}

function spaced(ctx: CanvasRenderingContext2D, px: number): void {
  // Letter-spaced capitals, as the face's small labels are. Older engines without letterSpacing simply draw them tight.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

function mix(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = m ? parseInt(m[1]!, 16) : 0x888888;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

interface FaceAssets {
  logo: HTMLImageElement | null;
  art: HTMLImageElement | null;
}

/** One card face, its top-left corner at (x, y) and `width` wide, as the card in the app is laid out. */
function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, face: OgFace, assets: FaceAssets, tilt = 0): void {
  const s = width / SHEET_W;
  ctx.save();
  ctx.translate(x + width / 2, y + (SHEET_H * s) / 2);
  if (tilt) ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-width / 2, -(SHEET_H * s) / 2);
  ctx.scale(s, s);

  // Frame: a metal edge tinted by the card's own colours, on a shadow of a few flat layers (a blur would double the file).
  for (let layer = 5; layer >= 1; layer -= 1) {
    ctx.fillStyle = 'rgba(23, 26, 25, 0.045)';
    ctx.beginPath();
    ctx.roundRect(-layer * 5, layer * 6 - layer * 2, SHEET_W + layer * 10, SHEET_H + layer * 4, 44 + layer * 5);
    ctx.fill();
  }
  const frame = ctx.createLinearGradient(0, 0, SHEET_W, SHEET_H);
  frame.addColorStop(0, mix(face.accent, '#9aa0a6', 0.55));
  frame.addColorStop(0.5, '#d4cfbf');
  frame.addColorStop(1, mix(face.highlight, '#b59d70', 0.5));
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.roundRect(0, 0, SHEET_W, SHEET_H, 44);
  ctx.fill();
  ctx.fillStyle = '#f4f1e7';
  ctx.beginPath();
  ctx.roundRect(16, 16, SHEET_W - 32, SHEET_H - 32, 30);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(16, 16, SHEET_W - 32, SHEET_H - 32, 30);
  ctx.clip();

  ctx.fillStyle = '#56635e';
  ctx.font = `700 16px ${FONT}`;
  spaced(ctx, 4);
  ctx.fillText('STRATEMARK', 46, 54);

  // The picture panel.
  const px = 35;
  const py = 80;
  const pw = 632;
  const ph = 440;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 14);
  ctx.clip();
  if (face.kind === 'signal') {
    ctx.fillStyle = '#12352c';
    ctx.fillRect(px, py, pw, ph);
    if (assets.art) {
      const scale = Math.max(pw / assets.art.naturalWidth, ph / assets.art.naturalHeight);
      const dw = assets.art.naturalWidth * scale;
      const dh = assets.art.naturalHeight * scale;
      ctx.drawImage(assets.art, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    }
  } else {
    const glow = ctx.createRadialGradient(px + pw / 2, py + ph / 2, 20, px + pw / 2, py + ph / 2, pw * 0.7);
    glow.addColorStop(0, '#f6f5ee');
    glow.addColorStop(1, '#dcdcd7');
    ctx.fillStyle = glow;
    ctx.fillRect(px, py, pw, ph);
    const sx = 202;
    const sy = 174;
    const sw = 298;
    const sh = 298;
    const tile = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, 10, sx + sw / 2, sy + sh / 2, sw * 0.75);
    tile.addColorStop(0, '#fcf8ea');
    tile.addColorStop(1, '#efe7d4');
    ctx.fillStyle = tile;
    ctx.fillRect(sx, sy, sw, sh);
    if (assets.logo && assets.logo.naturalWidth > 0) {
      const box = 236;
      const scale = Math.min(box / assets.logo.naturalWidth, box / assets.logo.naturalHeight);
      const dw = assets.logo.naturalWidth * scale;
      const dh = assets.logo.naturalHeight * scale;
      ctx.drawImage(assets.logo, sx + (sw - dw) / 2, sy + (sh - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#cfd9d3';
      ctx.font = `700 170px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(face.name.trim().charAt(0).toUpperCase(), sx + sw / 2, sy + sh / 2 + 60);
      ctx.textAlign = 'left';
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#b9bdb8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 14);
  ctx.stroke();
  if (face.kind === 'company') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d3d6d1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(62, 103, 124, 42, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#34413c';
    ctx.font = `700 16px ${FONT}`;
    spaced(ctx, 2.5);
    ctx.fillText(face.typeLabel.toUpperCase(), 76, 130);
  }

  // Identity.
  ctx.fillStyle = '#56635e';
  ctx.font = `700 15px ${FONT}`;
  spaced(ctx, 2.6);
  ctx.fillText(face.eyebrow.toUpperCase(), 51, 560, 600);
  spaced(ctx, 0);
  ctx.fillStyle = '#1d2a26';
  let size = face.kind === 'signal' ? 42 : 46;
  ctx.font = `700 ${size}px ${FONT}`;
  let nameLines = wrap(ctx, face.name, 600, 1);
  if (face.kind === 'signal') {
    ctx.font = `700 ${size}px ${FONT}`;
    nameLines = wrap(ctx, face.name, 600, 2);
  } else {
    while (size > 30 && ctx.measureText(face.name).width > 600) {
      size -= 1;
      ctx.font = `700 ${size}px ${FONT}`;
    }
  }
  let cursor = 610;
  for (const line of nameLines) {
    ctx.fillText(line, 51, cursor, 604);
    cursor += size + 4;
  }
  cursor += face.kind === 'signal' ? -12 : -18;
  if (face.blurb) {
    ctx.fillStyle = '#5a6460';
    ctx.font = `400 21px ${FONT}`;
    for (const line of wrap(ctx, face.blurb, 600, 2)) {
      ctx.fillText(line, 51, cursor + 14, 604);
      cursor += 28;
    }
  }

  if (face.kind === 'signal') {
    const rule = Math.max(704, cursor + 22);
    if (face.finding) {
      ctx.fillStyle = '#c7cfc9';
      ctx.fillRect(51, rule, 600, 2);
      ctx.fillStyle = '#56635e';
      ctx.font = `700 15px ${FONT}`;
      spaced(ctx, 2.6);
      ctx.fillText((face.findingLabel ?? 'Research finding').toUpperCase(), 51, rule + 36, 600);
      spaced(ctx, 0);
      ctx.fillStyle = '#222b27';
      ctx.font = `400 24px ${FONT}`;
      wrap(ctx, face.finding, 600, 3).forEach((line, i) => ctx.fillText(line, 51, rule + 72 + i * 32, 604));
    }
  } else if (face.slots.length > 0) {
    ctx.fillStyle = '#b3bab4';
    ctx.fillRect(51, 700, 600, 2);
    ctx.fillRect(363, 706, 2, 134);
    ctx.fillRect(51, 773, 290, 2);
    ctx.fillRect(385, 773, 266, 2);
    face.slots.slice(0, 4).forEach((slot, i) => {
      const colX = i % 2 === 0 ? 51 : 385;
      const rowY = i < 2 ? 742 : 810;
      ctx.fillStyle = slot.known ? '#1d2a26' : '#98a39e';
      ctx.font = `700 ${slot.known ? 31 : 24}px ${FONT}`;
      ctx.fillText(slot.value, colX, rowY, 262);
      ctx.fillStyle = '#5a6460';
      ctx.font = `400 16px ${FONT}`;
      ctx.fillText(slot.label, colX, rowY + 23, 262);
    });
  }

  // Footer band.
  ctx.fillStyle = '#dcdfd8';
  ctx.fillRect(16, 902, SHEET_W - 32, 64);
  ctx.fillStyle = '#3f4b46';
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(face.position, 46, 941, 330);
  ctx.textAlign = 'right';
  ctx.fillText(face.provenance, SHEET_W - 46, 941, 300);
  ctx.textAlign = 'left';
  ctx.restore();
  ctx.restore();
}

async function assetsFor(face: OgFace): Promise<FaceAssets> {
  const [art, logo] = await Promise.all([face.artSrc ? loadImage(face.artSrc) : Promise.resolve(null), face.kind === 'company' ? loadLogo(face.logoUrl) : Promise.resolve(null)]);
  return { art, logo };
}

/** The picture as PNG bytes: full size, or smaller when the full-size one would be too large to send. */
export async function renderOgImage(layout: OgLayout): Promise<Uint8Array | null> {
  const full = await renderAt(layout, 1);
  if (!full || full.byteLength <= OG_MAX_BYTES) return full;
  return renderAt(layout, FALLBACK_SCALE);
}

async function renderAt(layout: OgLayout, scale: number): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#eef3f1';
  ctx.fillRect(0, 0, W, H);

  const faces = layout.faces.slice(0, 3);
  const assets = await Promise.all(faces.map(assetsFor));
  const FRONT = 420;
  if (faces.length === 1) {
    drawFace(ctx, (W - FRONT) / 2, 20, FRONT, faces[0]!, assets[0]!);
  } else if (faces.length > 1) {
    // A deck: the first company card in front, the next ones fanned out behind it, clear of the corner brand.
    const side = 340;
    if (faces[2]) drawFace(ctx, W / 2 + 215 - side / 2, 66, side, faces[2], assets[2]!, 7);
    drawFace(ctx, W / 2 - 215 - side / 2, 66, side, faces[1]!, assets[1]!, -7);
    drawFace(ctx, (W - FRONT) / 2, 20, FRONT, faces[0]!, assets[0]!);
  } else {
    // Nothing to draw as a card: the words alone.
    ctx.fillStyle = BRAND;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(layout.eyebrow.split('').join(' '), 72, 236);
    ctx.fillStyle = INK;
    ctx.font = `700 60px ${FONT}`;
    wrap(ctx, layout.title, 1000, 3).forEach((line, i) => ctx.fillText(line, 72, 306 + i * 70));
    ctx.fillStyle = MUTED;
    ctx.font = `400 26px ${FONT}`;
    wrap(ctx, layout.subtitle, 1000, 3).forEach((line, i) => ctx.fillText(line, 72, 520 + i * 36));
  }

  // The brand, small, in the corner: the card is the picture.
  const mark = await loadImage(logoMark);
  if (mark) ctx.drawImage(mark, 44, 38, 40, 40);
  ctx.fillStyle = INK;
  ctx.font = `700 24px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Stratemark', 96, 58);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = `400 19px ${FONT}`;
  ctx.fillText('Every figure with its source', 44, H - 40);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
