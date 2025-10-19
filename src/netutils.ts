/**
 * netutils.ts
 *
 * Rewritten with TypeScript best-practices:
 * - clear camelCase function and variable names
 * - explicit types and return types
 * - small, well-documented functions
 * - avoid implicit `any`
 *
 * Notes:
 * - Uses ByteArray = number[] to stay compatible with original dynamic buffer usage.
 * - Where appropriate, uses Uint8Array/ArrayBuffer conversions.
 */

export type ByteArray = number[];

/**
 * Convert a numeric byte array (0..255) into an ArrayBuffer.
 * Preserves numeric values modulo 256.
 */
export function arrayToArrayBuffer(bytes: ByteArray): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    view[i] = bytes[i] & 0xff;
  }
  return buffer;
}

/**
 * Convert an ArrayBuffer (or an ArrayBufferView) into a numeric byte array.
 */
export function arrayBufferToArray(buffer: ArrayBuffer | ArrayBufferView): ByteArray {
  const u8 =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const result: ByteArray = new Array(u8.length);
  for (let i = 0; i < u8.length; i++) result[i] = u8[i];
  return result;
}

/**
 * Encode a JS string into a UTF-8 numeric byte array.
 * Mirrors the original behavior but with clearer names and small safeguards.
 */
export function utf8Encode(input: string): ByteArray {
  const out: ByteArray = [];

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(0xc0 | (code >> 6));
      out.push(0x80 | (code & 0x3f));
    } else if ((code >= 0x800 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xffff)) {
      out.push(0xe0 | ((code >> 12) & 0x0f));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    } else {
      // fallback for isolated surrogate values - emit replacement char U+FFFD (UTF-8 bytes)
      out.push(0xef, 0xbf, 0xbd);
    }
  }

  // ensure all bytes are in 0..255
  for (let i = 0; i < out.length; i++) out[i] &= 0xff;

  return out;
}

/**
 * Decode a UTF-8 numeric byte array into a JS string.
 * Returns null if the input is already a string (keeps parity with original).
 */
export function utf8Decode(bytesOrString: ByteArray | string): string | null {
  if (typeof bytesOrString === "string") return null;

  const bytes = bytesOrString;
  let result = "";

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] == null) break;

    const byteStr = bytes[i].toString(2);
    const match = byteStr.match(/^1+?(?=0)/);
    if (match && byteStr.length === 8) {
      const bytesLength = match[0].length;
      let store = bytes[i].toString(2).slice(7 - bytesLength);
      for (let k = 1; k < bytesLength; k++) {
        store += bytes[k + i].toString(2).slice(2);
      }
      result += String.fromCharCode(parseInt(store, 2));
      i += bytesLength - 1;
    } else {
      result += String.fromCharCode(bytes[i]);
    }
  }

  return result;
}

/**
 * Concatenate two numeric byte arrays into a new array.
 *
 * Robustness improvements:
 * - Accepts null/undefined for either input and treats it as an empty array.
 * - Accepts Uint8Array (or other ArrayBufferView) and converts to ByteArray.
 * - Returns a fresh ByteArray.
 */
export function concatArrays(a1?: ByteArray | ArrayBufferView | null, a2?: ByteArray | ArrayBufferView | null): ByteArray {
  // normalize inputs to ByteArray
  const normalize = (v?: ByteArray | ArrayBufferView | null): ByteArray => {
    if (!v) return [];
    if (Array.isArray(v)) return v as ByteArray;
    // ArrayBufferView (Uint8Array, etc.)
    const view = v as ArrayBufferView;
    const u8 = new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? view.buffer.byteLength);
    const out: ByteArray = new Array(u8.length);
    for (let i = 0; i < u8.length; i++) out[i] = u8[i];
    return out;
  };

  const b1 = normalize(a1);
  const b2 = normalize(a2);

  const out: ByteArray = new Array(b1.length + b2.length);
  for (let i = 0; i < b1.length; i++) out[i] = b1[i];
  for (let j = 0; j < b2.length; j++) out[b1.length + j] = b2[j];
  return out;
}

const netutils = {
  arrayToArrayBuffer,
  arrayBufferToArray,
  utf8Encode,
  utf8Decode,
  concatArrays,
};

export default netutils;
