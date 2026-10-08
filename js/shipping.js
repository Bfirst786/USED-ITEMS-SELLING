// Rough shipping estimator. Works offline from approximate discounted label prices
// (what eBay, Mercari, Pirate Ship and similar give sellers), so treat results as a
// guide: real prices depend on distance (zone), exact size and the current year's rates.
// Pure functions (no DOM).

export const BOXES = {
  poly: { label: 'Poly mailer (clothing)', l: 13, w: 10, h: 2, pack: 0.1 },
  small: { label: 'Small box 8×6×4', l: 8, w: 6, h: 4, pack: 0.4 },
  shoe: { label: 'Shoe box 14×10×6', l: 14, w: 10, h: 6, pack: 0.8 },
  medium: { label: 'Medium box 12×12×10', l: 12, w: 12, h: 10, pack: 1 },
  large: { label: 'Large box 18×18×16', l: 18, w: 18, h: 16, pack: 1.8 },
  xl: { label: 'Extra-large box 24×18×18', l: 24, w: 18, h: 18, pack: 2.5 },
  custom: { label: 'Custom size', l: 0, w: 0, h: 0, pack: 0 },
};

// [billable lb, low (nearby), high (cross-country)] in USD.
const CARRIERS = {
  usps: {
    name: 'USPS Ground Advantage',
    maxLb: 70,
    maxLengthGirth: 130,
    dimDivisor: 166,
    dimOnlyOver: 1728, // USPS only applies dimensional weight above 1 cubic foot
    table: [
      [0.25, 4.5, 6.5], [0.5, 5, 7.5], [1, 5.5, 9], [2, 7, 13], [3, 7.5, 16], [5, 9, 22],
      [10, 12, 35], [15, 16, 45], [20, 20, 55], [30, 28, 75], [50, 40, 110], [70, 55, 150],
    ],
  },
  ups: {
    name: 'UPS Ground',
    maxLb: 150,
    maxLengthGirth: 165,
    maxLength: 108,
    dimDivisor: 139,
    dimOnlyOver: 0,
    table: [
      [1, 9, 13], [5, 11, 20], [10, 13, 28], [20, 17, 40], [30, 21, 52], [50, 30, 75],
      [70, 40, 100], [100, 55, 135], [150, 80, 190],
    ],
  },
};

export const CALCULATORS = [
  { label: 'USPS price calculator', url: 'https://postcalc.usps.com/' },
  { label: 'Pirate Ship (discounted USPS & UPS)', url: 'https://www.pirateship.com/' },
  { label: 'UPS', url: 'https://www.ups.com/' },
];

function interpolate(table, lb) {
  if (lb <= table[0][0]) return [table[0][1], table[0][2]];
  for (let i = 1; i < table.length; i++) {
    const [w1, lo1, hi1] = table[i - 1];
    const [w2, lo2, hi2] = table[i];
    if (lb <= w2) {
      const t = (lb - w1) / (w2 - w1);
      return [lo1 + (lo2 - lo1) * t, hi1 + (hi2 - hi1) * t];
    }
  }
  const last = table[table.length - 1];
  return [last[1], last[2]];
}

// Carriers bill in whole pounds (quarter pounds under 1 lb for USPS).
function roundBillable(lb) {
  if (lb <= 1) return Math.max(0.25, Math.ceil(lb * 4) / 4);
  return Math.ceil(lb);
}

const money = (n) => Math.round(n * 2) / 2; // nearest 50¢

// s: { lb, oz, l, w, h } — packed weight and box dimensions in inches.
export function estimateShipping(s = {}) {
  const actual = (Number(s.lb) || 0) + (Number(s.oz) || 0) / 16;
  const dims = [Number(s.l) || 0, Number(s.w) || 0, Number(s.h) || 0].map((d) => Math.ceil(d)).sort((a, b) => b - a);
  const warnings = [];
  if (actual <= 0) return { ok: false, reason: 'Enter the packed weight (item + box + padding).' };
  const hasDims = dims.every((d) => d > 0);
  if (!hasDims) warnings.push('Add box dimensions — big, light boxes are charged by size, not weight.');

  const cubic = hasDims ? dims[0] * dims[1] * dims[2] : 0;
  const lengthGirth = hasDims ? dims[0] + 2 * (dims[1] + dims[2]) : 0;

  const options = [];
  for (const [key, c] of Object.entries(CARRIERS)) {
    const dimWeight = hasDims && cubic > c.dimOnlyOver ? cubic / c.dimDivisor : 0;
    const billable = roundBillable(Math.max(actual, dimWeight));
    const opt = { key, name: c.name, billable, byDimensions: dimWeight > actual, notes: [] };
    if (billable > c.maxLb) {
      opt.unavailable = `Over the ${c.maxLb} lb limit`;
    } else if (hasDims && (lengthGirth > c.maxLengthGirth || (c.maxLength && dims[0] > c.maxLength))) {
      opt.unavailable = 'Too large for this service';
    } else {
      const [lo, hi] = interpolate(c.table, billable);
      opt.low = money(lo);
      opt.high = money(hi);
      if (key === 'usps' && hasDims && lengthGirth > 108) opt.notes.push('Oversize surcharge likely (over 108" length + girth)');
      if (key === 'ups' && hasDims && (dims[0] > 48 || dims[1] > 30)) opt.notes.push('Additional-handling surcharge likely for long or wide boxes');
      if (opt.byDimensions) opt.notes.push(`Charged as ${billable} lb because of box size`);
    }
    options.push(opt);
  }

  const available = options.filter((o) => !o.unavailable);
  if (!available.length) {
    return { ok: false, actual, options, warnings, reason: 'Too big or heavy for regular parcel services — sell for local pickup, or get a freight quote.' };
  }
  const best = available.reduce((a, b) => (a.low + a.high <= b.low + b.high ? a : b));
  const typical = money((best.low + best.high) / 2);
  if (actual > 20) warnings.push('Heavy item — compare against local pickup; shipping may eat most of the profit.');
  if (best.byDimensions) warnings.push('A smaller box would lower the price — the size, not the weight, is driving the cost.');
  return { ok: true, actual, cubic, lengthGirth, options, best: best.key, low: best.low, high: best.high, typical, warnings };
}

// How shipping changes what you keep.
export function shippingAdvice(est, price) {
  if (!est || !est.ok) return null;
  const p = Number(price) || 0;
  const share = p ? est.high / p : null;
  return {
    chargeBuyer: est.typical,
    freeShippingPrice: p ? Math.ceil((p + est.typical) / 5) * 5 : null,
    worthShipping: share === null ? null : share < 0.5,
    share,
  };
}

// ---------- Claude estimate of box size and packed weight ----------

export const PACKING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['identified_as', 'item_length_in', 'item_width_in', 'item_height_in', 'item_weight_lb', 'box_length_in', 'box_width_in', 'box_height_in', 'packed_weight_lb', 'fragile', 'ship_recommended', 'confidence', 'packing_tips', 'reasoning'],
  properties: {
    identified_as: { type: 'string' },
    item_length_in: { type: 'number' },
    item_width_in: { type: 'number' },
    item_height_in: { type: 'number' },
    item_weight_lb: { type: 'number' },
    box_length_in: { type: 'number' },
    box_width_in: { type: 'number' },
    box_height_in: { type: 'number' },
    packed_weight_lb: { type: 'number' },
    fragile: { type: 'boolean' },
    ship_recommended: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    packing_tips: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
};

const pos = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);

// Turn Claude's estimate into shipping fields: whole-inch box (longest side first),
// a matching preset when the box is one of ours, and packed weight as lb + oz.
export function shippingFromEstimate(r) {
  const box = [r.box_length_in, r.box_width_in, r.box_height_in].map((d) => Math.ceil(pos(d))).sort((a, b) => b - a);
  const itemDims = [r.item_length_in, r.item_width_in, r.item_height_in].map(pos);
  // The box must be at least as big as the item in every direction.
  const sortedItem = [...itemDims].sort((a, b) => b - a);
  for (let i = 0; i < 3; i++) if (box[i] < Math.ceil(sortedItem[i])) box[i] = Math.ceil(sortedItem[i]);
  let packed = Math.max(pos(r.packed_weight_lb), pos(r.item_weight_lb));
  if (!packed) return null;
  let lb = Math.floor(packed);
  let oz = Math.ceil((packed - lb) * 16);
  if (oz >= 16) {
    lb += 1;
    oz = 0;
  }
  const preset = Object.entries(BOXES).find(([k, b]) => k !== 'custom' && [b.l, b.w, b.h].sort((x, y) => y - x).join('x') === box.join('x'));
  return {
    box: preset ? preset[0] : 'custom',
    l: box[0] || '',
    w: box[1] || '',
    h: box[2] || '',
    lb,
    oz,
    estimated: true,
    ai: {
      at: new Date().toISOString(),
      identifiedAs: String(r.identified_as || ''),
      item: { l: itemDims[0], w: itemDims[1], h: itemDims[2], weight: pos(r.item_weight_lb) },
      fragile: !!r.fragile,
      shipRecommended: r.ship_recommended !== false,
      confidence: ['low', 'medium', 'high'].includes(r.confidence) ? r.confidence : 'low',
      tips: (Array.isArray(r.packing_tips) ? r.packing_tips : []).map(String).slice(0, 5),
      reasoning: String(r.reasoning || ''),
    },
  };
}
