/**
 * Spark 2.x packed / extended splat layout, written without importing Spark
 * so the decode worker does not start the WASM PLY parser.
 * The bit layout matches `setPackedSplat` / `encodeSh*` / `encodeExtSplat`.
 */

export interface SplatEncodingLimits {
  rgbMin: number;
  rgbMax: number;
  lnScaleMin: number;
  lnScaleMax: number;
  sh1Max: number;
  sh2Max: number;
  sh3Max: number;
}

export const LN_SCALE_MIN = -12;
export const LN_SCALE_MAX = 9;
const SCALE_ZERO = Math.exp(-30);

/** Wide enough that typical 3DGS harmonics survive 6–8 bit quantization. */
export const DEFAULT_LIMITS: SplatEncodingLimits = {
  rgbMin: 0,
  rgbMax: 1,
  lnScaleMin: LN_SCALE_MIN,
  lnScaleMax: LN_SCALE_MAX,
  sh1Max: 4,
  sh2Max: 4,
  sh3Max: 4,
};

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const supportsF16 = typeof Float16Array !== 'undefined';
const f16 = supportsF16 ? new Float16Array(1) : null;
const u16 = new Uint16Array(f16 ? f16.buffer : new ArrayBuffer(2));

export function floatBitsToUint(value: number): number {
  f32[0] = value;
  return u32[0]!;
}

export function toHalf(value: number): number {
  if (f16) {
    f16[0] = value;
    return u16[0]!;
  }
  f32[0] = value;
  const bits = u32[0]!;
  const sign = (bits >>> 31) & 1;
  const exp = (bits >>> 23) & 255;
  const frac = bits & 8388607;
  const halfSign = sign << 15;
  if (exp === 255) return frac !== 0 ? halfSign | 32767 : halfSign | 31744;
  const newExp = exp - 127 + 15;
  if (newExp >= 31) return halfSign | 31744;
  if (newExp <= 0) {
    if (newExp < -10) return halfSign;
    return halfSign | ((frac | 8388608) >>> (1 - newExp + 13));
  }
  return halfSign | (newExp << 10) | (frac >>> 13);
}

function floatToUint8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function quantizeScale(scale: number, limits: SplatEncodingLimits): number {
  if (!(scale >= SCALE_ZERO)) return 0;
  const span = 254 / (limits.lnScaleMax - limits.lnScaleMin);
  return Math.min(255, Math.max(1, Math.round((Math.log(scale) - limits.lnScaleMin) * span) + 1));
}

/** Octahedral quaternion, 8+8+8, matching Spark's encodeQuatOctXy88R8. */
export function encodeQuatOctXy88R8(qx: number, qy: number, qz: number, qw: number): number {
  let x = qx;
  let y = qy;
  let z = qz;
  let w = qw;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const theta = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
  const xyz = Math.hypot(x, y, z);
  let ax = 1;
  let ay = 0;
  let az = 0;
  if (xyz >= 1e-6) {
    ax = x / xyz;
    ay = y / xyz;
    az = z / xyz;
  }
  const sum = Math.abs(ax) + Math.abs(ay) + Math.abs(az) || 1;
  let px = ax / sum;
  let py = ay / sum;
  if (az < 0) {
    const tmp = px;
    px = (1 - Math.abs(py)) * (px >= 0 ? 1 : -1);
    py = (1 - Math.abs(tmp)) * (py >= 0 ? 1 : -1);
  }
  const quantU = Math.round((px * 0.5 + 0.5) * 255);
  const quantV = Math.round((py * 0.5 + 0.5) * 255);
  const angleInt = Math.round(theta * (255 / Math.PI));
  return ((angleInt & 255) << 16) | ((quantV & 255) << 8) | (quantU & 255);
}

/** 10+10+12 octahedral quaternion used by extended splats. */
export function encodeQuatOctXy1010R12(qx: number, qy: number, qz: number, qw: number): number {
  let x = qx;
  let y = qy;
  let z = qz;
  let w = qw;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const theta = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
  const xyz = Math.hypot(x, y, z);
  let ax = 1;
  let ay = 0;
  let az = 0;
  if (xyz >= 1e-6) {
    ax = x / xyz;
    ay = y / xyz;
    az = z / xyz;
  }
  const sum = Math.abs(ax) + Math.abs(ay) + Math.abs(az) || 1;
  let px = ax / sum;
  let py = ay / sum;
  if (az < 0) {
    const tmp = px;
    px = (1 - Math.abs(py)) * (px >= 0 ? 1 : -1);
    py = (1 - Math.abs(tmp)) * (py >= 0 ? 1 : -1);
  }
  const quantU = Math.round((px * 0.5 + 0.5) * 1023);
  const quantV = Math.round((py * 0.5 + 0.5) * 1023);
  const angleInt = Math.round(theta * (4095 / Math.PI));
  return ((angleInt & 4095) << 20) | ((quantV & 1023) << 10) | (quantU & 1023);
}

export function writePackedSplat(
  packed: Uint32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  opacity: number,
  r: number,
  g: number,
  b: number,
  limits: SplatEncodingLimits = DEFAULT_LIMITS,
): void {
  const rgbRange = limits.rgbMax - limits.rgbMin || 1;
  const uR = floatToUint8((r - limits.rgbMin) / rgbRange);
  const uG = floatToUint8((g - limits.rgbMin) / rgbRange);
  const uB = floatToUint8((b - limits.rgbMin) / rgbRange);
  const uA = floatToUint8(opacity);
  const uQuat = encodeQuatOctXy88R8(qx, qy, qz, qw);
  const i4 = index * 4;
  packed[i4] = uR | (uG << 8) | (uB << 16) | (uA << 24);
  packed[i4 + 1] = toHalf(x) | (toHalf(y) << 16);
  packed[i4 + 2] = toHalf(z) | ((uQuat & 255) << 16) | (((uQuat >>> 8) & 255) << 24);
  packed[i4 + 3] =
    quantizeScale(scaleX, limits) |
    (quantizeScale(scaleY, limits) << 8) |
    (quantizeScale(scaleZ, limits) << 16) |
    (((uQuat >>> 16) & 255) << 24);
}

function packSint7(target: Uint32Array, base: number, values: ArrayLike<number>, scale: number): void {
  for (let i = 0; i < values.length; i += 1) {
    const sample = (values[i] ?? 0) * scale;
    const value = Math.round(Math.max(-63, Math.min(63, sample))) & 127;
    const bitStart = i * 7;
    const wordStart = Math.floor(bitStart / 32);
    const bitOffset = bitStart - wordStart * 32;
    target[base + wordStart] = (target[base + wordStart]! | ((value << bitOffset) >>> 0)) >>> 0;
    if (bitStart + 7 > wordStart * 32 + 32) {
      target[base + wordStart + 1] =
        (target[base + wordStart + 1]! | ((value >>> (32 - bitOffset)) >>> 0)) >>> 0;
    }
  }
}

function packSint6(target: Uint32Array, base: number, values: ArrayLike<number>, scale: number): void {
  for (let i = 0; i < values.length; i += 1) {
    const sample = (values[i] ?? 0) * scale;
    const value = Math.round(Math.max(-31, Math.min(31, sample))) & 63;
    const bitStart = i * 6;
    const wordStart = Math.floor(bitStart / 32);
    const bitOffset = bitStart - wordStart * 32;
    target[base + wordStart] = (target[base + wordStart]! | ((value << bitOffset) >>> 0)) >>> 0;
    if (bitStart + 6 > wordStart * 32 + 32) {
      target[base + wordStart + 1] =
        (target[base + wordStart + 1]! | ((value >>> (32 - bitOffset)) >>> 0)) >>> 0;
    }
  }
}

function packSint8Bytes(b0: number, b1: number, b2: number, b3: number): number {
  const c0 = Math.round(Math.max(-127, Math.min(127, b0 * 127))) & 255;
  const c1 = Math.round(Math.max(-127, Math.min(127, b1 * 127))) & 255;
  const c2 = Math.round(Math.max(-127, Math.min(127, b2 * 127))) & 255;
  const c3 = Math.round(Math.max(-127, Math.min(127, b3 * 127))) & 255;
  return c0 | (c1 << 8) | (c2 << 16) | (c3 << 24);
}

export function writePackedSh1(sh1: Uint32Array, index: number, rgb: ArrayLike<number>, sh1Max: number): void {
  packSint7(sh1, index * 2, rgb, 63 / (sh1Max || 1));
}

export function writePackedSh2(sh2: Uint32Array, index: number, rgb: ArrayLike<number>, sh2Max: number): void {
  const scale = 1 / (sh2Max || 1);
  const base = index * 4;
  sh2[base] = packSint8Bytes((rgb[0] ?? 0) * scale, (rgb[1] ?? 0) * scale, (rgb[2] ?? 0) * scale, (rgb[3] ?? 0) * scale);
  sh2[base + 1] = packSint8Bytes((rgb[4] ?? 0) * scale, (rgb[5] ?? 0) * scale, (rgb[6] ?? 0) * scale, (rgb[7] ?? 0) * scale);
  sh2[base + 2] = packSint8Bytes((rgb[8] ?? 0) * scale, (rgb[9] ?? 0) * scale, (rgb[10] ?? 0) * scale, (rgb[11] ?? 0) * scale);
  sh2[base + 3] = packSint8Bytes((rgb[12] ?? 0) * scale, (rgb[13] ?? 0) * scale, (rgb[14] ?? 0) * scale, 0);
}

export function writePackedSh3(sh3: Uint32Array, index: number, rgb: ArrayLike<number>, sh3Max: number): void {
  packSint6(sh3, index * 4, rgb, 31 / (sh3Max || 1));
}

function encodeExtRgb(r: number, g: number, b: number): number {
  const maxAbs = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  const base = maxAbs > 0 ? Math.floor(Math.log2(maxAbs)) : 0;
  const biased = Math.max(0, Math.min(31, base + 15));
  const divisor = 2 ** (biased - 15) / 255 || 1;
  const uR = Math.round(Math.max(0, Math.min(255, Math.abs(r) / divisor)));
  const uG = Math.round(Math.max(0, Math.min(255, Math.abs(g) / divisor)));
  const uB = Math.round(Math.max(0, Math.min(255, Math.abs(b) / divisor)));
  const expSigns = (biased << 3) | (r < 0 ? 1 : 0) | (g < 0 ? 2 : 0) | (b < 0 ? 4 : 0);
  return uR | (uG << 8) | (uB << 16) | (expSigns << 24);
}

export function writeExtSplat(
  extA: Uint32Array,
  extB: Uint32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  opacity: number,
  r: number,
  g: number,
  b: number,
): void {
  const i4 = index * 4;
  extA[i4] = floatBitsToUint(x);
  extA[i4 + 1] = floatBitsToUint(y);
  extA[i4 + 2] = floatBitsToUint(z);
  extA[i4 + 3] = toHalf(opacity);
  const lx = Math.log(scaleX > 0 ? scaleX : SCALE_ZERO);
  const ly = Math.log(scaleY > 0 ? scaleY : SCALE_ZERO);
  const lz = Math.log(scaleZ > 0 ? scaleZ : SCALE_ZERO);
  extB[i4] = toHalf(r) | (toHalf(g) << 16);
  extB[i4 + 1] = toHalf(b) | (toHalf(lx) << 16);
  extB[i4 + 2] = toHalf(ly) | (toHalf(lz) << 16);
  extB[i4 + 3] = encodeQuatOctXy1010R12(qx, qy, qz, qw);
}

export function writeExtSh1(sh1: Uint32Array, index: number, rgb: ArrayLike<number>): void {
  const i4 = index * 4;
  for (let k = 0; k < 3; k += 1) {
    const k3 = k * 3;
    sh1[i4 + k] = encodeExtRgb(rgb[k3] ?? 0, rgb[k3 + 1] ?? 0, rgb[k3 + 2] ?? 0);
  }
}

export function writeExtSh2(sh1: Uint32Array, sh2: Uint32Array, index: number, sh1Rgb: ArrayLike<number>, sh2Rgb: ArrayLike<number>): void {
  const i4 = index * 4;
  for (let k = 0; k < 3; k += 1) {
    const k3 = k * 3;
    sh1[i4 + k] = encodeExtRgb(sh1Rgb[k3] ?? 0, sh1Rgb[k3 + 1] ?? 0, sh1Rgb[k3 + 2] ?? 0);
  }
  sh1[i4 + 3] = encodeExtRgb(sh2Rgb[0] ?? 0, sh2Rgb[1] ?? 0, sh2Rgb[2] ?? 0);
  for (let k = 1; k < 5; k += 1) {
    const k3 = k * 3;
    sh2[i4 + (k - 1)] = encodeExtRgb(sh2Rgb[k3] ?? 0, sh2Rgb[k3 + 1] ?? 0, sh2Rgb[k3 + 2] ?? 0);
  }
}

export function writeExtSh3(sh3a: Uint32Array, sh3b: Uint32Array, index: number, rgb: ArrayLike<number>): void {
  const i4 = index * 4;
  for (let k = 0; k < 4; k += 1) {
    const k3 = k * 3;
    sh3a[i4 + k] = encodeExtRgb(rgb[k3] ?? 0, rgb[k3 + 1] ?? 0, rgb[k3 + 2] ?? 0);
  }
  for (let k = 4; k < 7; k += 1) {
    const k3 = k * 3;
    sh3b[i4 + (k - 4)] = encodeExtRgb(rgb[k3] ?? 0, rgb[k3 + 1] ?? 0, rgb[k3 + 2] ?? 0);
  }
}
