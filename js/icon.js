// Home-screen icon and name. The icon is drawn on a canvas and handed to the
// browser as a PNG data URL (apple-touch-icon for iPhone, a generated manifest for
// Android). Phones only read these when the app is added to the home screen.

export const APP_NAME = 'Re-Sell Assistant';

export const ICON_STYLES = {
  tag: 'Price tag',
  text: 'Letters',
  emoji: 'Emoji',
  photo: 'Photo',
};

export const ICON_COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#ea580c', '#ca8a04', '#15803d', '#111827', '#ffffff'];
export const SYMBOL_COLORS = ['#ffffff', '#111827', '#facc15', '#0f766e'];

export const DEFAULT_ICON = {
  style: 'tag',
  bg: '#0f766e',
  fg: '#ffffff',
  text: 'RS',
  emoji: '💰',
  photo: '', // JPEG data URL, square
  name: APP_NAME,
};

const HEX = /^#[0-9a-f]{6}$/i;

// Up to 3 characters (counting emoji and accented letters as one).
export function iconLetters(s) {
  return [...String(s || '').trim()].slice(0, 3).join('');
}

export function normalizeIcon(c = {}) {
  const d = DEFAULT_ICON;
  const style = ICON_STYLES[c.style] ? c.style : d.style;
  const photo = typeof c.photo === 'string' && c.photo.startsWith('data:image/') ? c.photo : '';
  return {
    style: style === 'photo' && !photo ? d.style : style,
    bg: HEX.test(c.bg) ? c.bg.toLowerCase() : d.bg,
    fg: HEX.test(c.fg) ? c.fg.toLowerCase() : d.fg,
    text: iconLetters(c.text) || d.text,
    emoji: iconLetters(c.emoji).slice(0, 8) || d.emoji,
    photo,
    name: String(c.name ?? '').trim().slice(0, 40) || d.name,
  };
}

// True when the built-in icon files can be used as they are.
export function isDefaultIcon(c) {
  const n = normalizeIcon(c);
  return n.style === 'tag' && n.bg === DEFAULT_ICON.bg && n.fg === DEFAULT_ICON.fg;
}

// Web app manifest with the custom name and icons. `base` is the app's URL
// (a generated manifest has no URL of its own to resolve relative paths against).
export function buildManifest(base, { name, icons }) {
  const abs = (p) => new URL(p, base).href;
  return {
    name,
    short_name: name,
    description: "Photograph, price, list and track the things you're selling.",
    id: abs('./'),
    start_url: abs('./'),
    scope: abs('./'),
    display: 'standalone',
    background_color: '#f4f5f7',
    theme_color: '#0f766e',
    icons: icons.map((i) => ({ ...i, src: i.src.startsWith('data:') ? i.src : abs(i.src) })),
  };
}

// Same shape as icons/icon.svg (drawn on a 512 grid).
const TAG_PATH = 'M120 236 L236 120 H372 a20 20 0 0 1 20 20 V276 L276 392 a28 28 0 0 1 -40 0 L120 276 a28 28 0 0 1 0 -40 Z';

// Draws the icon full-bleed (the phone rounds the corners itself).
export function drawIcon(ctx, size, icon, photoImg) {
  const c = normalizeIcon(icon);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, size, size);
  const k = size / 512;
  ctx.scale(k, k);
  if (c.style === 'photo' && photoImg) {
    const w = photoImg.naturalWidth || photoImg.width;
    const h = photoImg.naturalHeight || photoImg.height;
    const s = Math.min(w, h);
    ctx.drawImage(photoImg, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 512, 512);
  } else if (c.style === 'tag') {
    ctx.fillStyle = c.fg;
    ctx.fill(new Path2D(TAG_PATH));
    ctx.fillStyle = c.bg;
    ctx.beginPath();
    ctx.arc(330, 182, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(248, 290);
    ctx.rotate(-Math.PI / 4);
    ctx.font = 'bold 120px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('$', 0, 28);
  } else {
    const text = c.style === 'emoji' ? c.emoji : c.text;
    const n = [...text].length;
    const px = c.style === 'emoji' ? 300 : n === 1 ? 300 : n === 2 ? 230 : 165;
    ctx.fillStyle = c.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${px}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif, "Apple Color Emoji", "Noto Color Emoji"`;
    ctx.fillText(text, 256, c.style === 'emoji' ? 276 : 270);
  }
  ctx.restore();
}
