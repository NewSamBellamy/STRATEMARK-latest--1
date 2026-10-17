/**
 * Draws the link-preview picture (1200 x 630) for a share: the Stratemark mark,
 * what is shared, and a small collectible card beside it showing the company's
 * four face slots (a figure a source stands behind, or "Not found yet"). Plain
 * canvas drawing with no outside images, so the canvas is never tainted and the
 * PNG can always be read back. The words and figures come from ogLayout().
 */
import logoMark from '@/assets/logo-mark.svg';
import type { OgLayout } from './bundle';

const W = 1200;
const H = 630;
const INK = '#171a19';
const MUTED = '#68716f';
const LINE = '#dce8e5';
const BRAND = '#0f766e';
const FONT = 'system-ui, "Segoe UI", sans-serif';

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

function loadMark(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = logoMark;
  });
}

/** One small card: a teal frame, a cream face, the type, the name and the figure slots. */
function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, input: { eyebrow: string; name: string; slots: OgLayout['slots']; tilt?: number }): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (input.tilt) ctx.rotate((input.tilt * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = 'rgba(23, 26, 25, 0.18)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  const frame = ctx.createLinearGradient(0, 0, w, h);
  frame.addColorStop(0, '#a6dccb');
  frame.addColorStop(1, '#7cc0cc');
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 26);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#eef3ec';
  ctx.beginPath();
  ctx.roundRect(10, 10, w - 20, h - 20, 18);
  ctx.fill();

  ctx.fillStyle = MUTED;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText('S T R A T E M A R K', 28, 44);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cfdcd6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(24, 62, w - 48, h * 0.34, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BRAND;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(input.eyebrow.split('').join(' '), 36, 86);

  const top = 62 + h * 0.34 + 38;
  // The company's own initial stands in the picture area; the real logo is not drawn so the picture can always be exported.
  ctx.fillStyle = '#d3e2db';
  ctx.font = `700 ${Math.round(h * 0.2)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(input.name.trim().charAt(0).toUpperCase(), w / 2, 62 + h * 0.34 * 0.72);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  let size = 30;
  ctx.font = `700 ${size}px ${FONT}`;
  while (size > 18 && ctx.measureText(input.name).width > w - 56) {
    size -= 1;
    ctx.font = `700 ${size}px ${FONT}`;
  }
  ctx.fillText(input.name, 28, top, w - 56);

  if (input.slots.length > 0) {
    const colW = (w - 56) / 2;
    input.slots.slice(0, 4).forEach((slot, i) => {
      const sx = 28 + (i % 2) * colW;
      const sy = top + 34 + Math.floor(i / 2) * 62;
      ctx.fillStyle = slot.value ? INK : '#9aa4a1';
      ctx.font = `700 ${slot.value ? 22 : 17}px ${FONT}`;
      ctx.fillText(slot.value ?? 'Not found yet', sx, sy, colW - 10);
      ctx.fillStyle = MUTED;
      ctx.font = `400 12px ${FONT}`;
      ctx.fillText(slot.label, sx, sy + 18, colW - 10);
    });
    const sourced = input.slots.filter((s) => s.value).length;
    ctx.fillStyle = '#d8e6df';
    ctx.fillRect(10, h - 54, w - 20, 44);
    ctx.fillStyle = INK;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`${sourced}/${input.slots.length} figures sourced`, 28, h - 26);
  }
  ctx.restore();
}

export async function renderOgImage(layout: OgLayout): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#f4f7f6';
  ctx.fillRect(0, 0, W, H);

  const mark = await loadMark();
  if (mark) ctx.drawImage(mark, 72, 64, 52, 52);
  ctx.fillStyle = INK;
  ctx.font = `700 28px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Stratemark', 140, 91);
  ctx.textBaseline = 'alphabetic';

  const textW = 560;
  ctx.fillStyle = BRAND;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(layout.eyebrow.split('').join(' '), 72, 236);
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${FONT}`;
  const titleLines = wrap(ctx, layout.title, textW, 3);
  titleLines.forEach((line, i) => ctx.fillText(line, 72, 306 + i * 72));
  let y = 306 + (titleLines.length - 1) * 72 + 52;
  ctx.fillStyle = MUTED;
  ctx.font = `400 26px ${FONT}`;
  for (const line of wrap(ctx, layout.subtitle, textW, Math.max(1, Math.min(4, Math.floor((H - 90 - y) / 36))))) {
    ctx.fillText(line, 72, y);
    y += 36;
  }

  if (layout.names.length > 0) {
    // A deck: a small fan of cards, one per company, the front one first.
    const set = [...layout.names].reverse();
    set.forEach((name, i) => {
      const depth = set.length - 1 - i;
      drawCard(ctx, 800 + (set.length - 1 - depth) * -0 - depth * 46 + 60, 86 + depth * 10, 300, 450, { eyebrow: 'COMPANY', name, slots: [], tilt: depth * -3 });
    });
  } else {
    drawCard(ctx, 790, 70, 330, 490, { eyebrow: layout.eyebrow, name: layout.title, slots: layout.slots });
  }

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
