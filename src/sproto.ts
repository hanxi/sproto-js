/**
 * sproto.ts
 *
 * Rewritten and corrected full implementation for the repo.
 *
 * Notes:
 * - This file is the consolidated, corrected version of sproto TypeScript.
 * - It uses consistent function names (toWord/toDword, queryType/getProtocol, etc.)
 * - Includes encodeObject + corrected sprotoEncode and sprotoDecode semantics.
 *
 * Replace your current src/sproto.ts with this file, then run:
 *   bunx tsc -p tsconfig.json
 *   bun run test.ts
 *
 * If anything else breaks, paste the new error output and I'll iterate.
 */

import netutils, { ByteArray } from "./netutils";

/* ---------- Types & Interfaces ---------- */

interface SprotoField {
  tag: number;
  type: number;
  name: string | null;
  st: number | null;
  key: number;
  extra: number;
}

interface SprotoType {
  name: string | null;
  n: number;
  base: number;
  maxn: number;
  f: SprotoField[] | null;
}

interface SprotoProtocol {
  name: string | null;
  tag: number;
  p: Array<SprotoType | null>;
  confirm: number;
}

interface Host {
  proto: SprotoInstance;
  package: SprotoType | string;
  session: { [key: string]: any };
  attachsp?: SprotoInstance;
  attach(attachedSp: SprotoInstance): (name: string | number, args?: any, session?: any) => ByteArray;
  dispatch(buffer: ByteArray): any;
}

interface SprotoInstance {
  queryproto(protocolName: string | number): any;
  dump(): void;
  objlen(type: string | number | SprotoType, inbuf: ByteArray): number | null;
  encode(type: string | number | SprotoType, indata: any): ByteArray | null;
  decode(type: string | number | SprotoType, inbuf: ByteArray): any | null;
  pack(inbuf: ByteArray): ByteArray;
  unpack(inbuf: ByteArray): ByteArray;
  pencode(type: any, inbuf: any): ByteArray | null;
  pdecode(type: any, inbuf: any): any | null;
  host(packagename?: string): Host;
}

/* ---------- Constants ---------- */

const enum FieldType {
  INTEGER = 0,
  BOOLEAN = 1,
  STRING = 2,
  DOUBLE = 3,
  STRUCT = 4,
}

const SPROTO_TARRAY = 0x80;

const SIZEOF_LENGTH = 4;
const SIZEOF_HEADER = 2;
const SIZEOF_FIELD = 2;
const ENCODE_DEEPLEVEL = 64;

/* ---------- Helper functions ---------- */

function toWord(stream: ByteArray): number {
  return (stream[0] & 0xff) | ((stream[1] & 0xff) << 8);
}

function toDword(stream: ByteArray): number {
  return (
    ((stream[0] & 0xff) |
      ((stream[1] & 0xff) << 8) |
      ((stream[2] & 0xff) << 16) |
      ((stream[3] & 0xff) << 24)) >>> 0
  );
}

/* ---------- Import helpers (type/protocol parsing) ---------- */

function structField(stream: ByteArray, sz: number): number {
  if (sz < SIZEOF_LENGTH) return -1;
  const fn = toWord(stream);
  const header = SIZEOF_HEADER + SIZEOF_FIELD * fn;
  if (sz < header) return -1;

  let field = stream.slice(SIZEOF_HEADER);
  sz -= header;
  stream = stream.slice(header);

  for (let i = 0; i < fn; i++) {
    const value = toWord(field.slice(i * SIZEOF_FIELD + SIZEOF_HEADER));
    if (value !== 0) continue;

    if (sz < SIZEOF_LENGTH) return -1;
    const dsz = toDword(stream);
    if (sz < SIZEOF_LENGTH + dsz) return -1;
    stream = stream.slice(SIZEOF_LENGTH + dsz);
    sz -= SIZEOF_LENGTH + dsz;
  }
  return fn;
}

function importString(_: unknown, stream: ByteArray): string {
  const sz = toDword(stream);
  const arr = stream.slice(SIZEOF_LENGTH, SIZEOF_LENGTH + sz);
  let result = "";
  for (let i = 0; i < arr.length; i++) result += String.fromCharCode(arr[i]);
  return result;
}

function calcPow(base: number, n: number): number {
  if (n === 0) return 1;
  const r = calcPow(base * base, Math.floor(n / 2));
  return (n & 1) !== 0 ? r * base : r;
}

function countArray(stream: ByteArray): number {
  let length = toDword(stream);
  let n = 0;
  stream = stream.slice(SIZEOF_LENGTH);
  while (length > 0) {
    if (length < SIZEOF_LENGTH) return -1;
    const nsz = toDword(stream);
    const tot = nsz + SIZEOF_LENGTH;
    if (tot > length) return -1;
    ++n;
    stream = stream.slice(tot);
    length -= tot;
  }
  return n;
}

function importField(s: any, f: SprotoField, streamIn: ByteArray): ByteArray | null {
  let stream = streamIn.slice(0);
  let sz = toDword(stream);
  stream = stream.slice(SIZEOF_LENGTH);
  const result = stream.slice(sz);
  const fn = structField(stream, sz);
  if (fn < 0) return null;

  stream = stream.slice(SIZEOF_HEADER);

  f.tag = -1;
  f.type = -1;
  f.name = null;
  f.st = null;
  f.key = -1;
  f.extra = 0;

  let tag = -1;
  let arrayFlag = 0;

  for (let i = 0; i < fn; i++) {
    ++tag;
    let value = toWord(stream.slice(SIZEOF_FIELD * i));
    if ((value & 1) !== 0) {
      tag += Math.floor(value / 2);
      continue;
    }

    if (tag === 0) {
      if (value !== 0) return null;
      f.name = importString(s, stream.slice(fn * SIZEOF_FIELD));
      continue;
    }

    if (value === 0) return null;
    value = Math.floor(value / 2) - 1;

    switch (tag) {
      case 1:
        if (value >= FieldType.STRUCT) return null;
        f.type = value;
        break;
      case 2:
        if (f.type === FieldType.INTEGER) {
          f.extra = calcPow(10, value);
        } else if (f.type === FieldType.STRING) {
          f.extra = value;
        } else {
          if (value >= s.type_n) return null;
          if (f.type >= 0) return null;
          f.type = FieldType.STRUCT;
          f.st = value;
        }
        break;
      case 3:
        f.tag = value;
        break;
      case 4:
        if (value !== 0) arrayFlag = SPROTO_TARRAY;
        break;
      case 5:
        f.key = value;
        break;
      default:
        return null;
    }
  }

  if (f.tag < 0 || f.type < 0 || f.name == null) return null;
  f.type |= arrayFlag;
  return result;
}

function importType(s: any, t: SprotoType, streamIn: ByteArray): ByteArray | null {
  let stream = streamIn.slice(0);
  const sz = toDword(stream);
  stream = stream.slice(SIZEOF_LENGTH);
  const result = stream.slice(sz);
  const fn = structField(stream, sz);
  if (fn <= 0 || fn > 2) return null;

  for (let i = 0; i < fn * SIZEOF_FIELD; i += SIZEOF_FIELD) {
    const v = toWord(stream.slice(SIZEOF_HEADER + i));
    if (v !== 0) return null;
  }

  t.name = null;
  t.n = 0;
  t.base = 0;
  t.maxn = 0;
  t.f = null;

  stream = stream.slice(SIZEOF_HEADER + fn * SIZEOF_FIELD);
  t.name = importString(s, stream);
  if (fn === 1) return result;

  stream = stream.slice(toDword(stream) + SIZEOF_LENGTH);
  let n = countArray(stream);
  if (n < 0) return null;

  stream = stream.slice(SIZEOF_LENGTH);
  let maxn = n;
  let last = -1;
  t.n = n;
  t.f = [];

  for (let i = 0; i < n; i++) {
    const fieldObj: SprotoField = {
      tag: -1,
      type: -1,
      name: null,
      st: null,
      key: -1,
      extra: 0,
    };
    stream = importField(s, fieldObj, stream) as ByteArray;
    if (stream == null) return null;
    const tag = fieldObj.tag;
    if (tag <= last) return null;
    if (tag > last + 1) ++maxn;
    last = tag;
    t.f.push(fieldObj);
  }

  t.maxn = maxn;
  t.base = t.f[0].tag;
  n = t.f[t.f.length - 1].tag - t.base + 1;
  if (n !== t.n) t.base = -1;
  return result;
}

function importProtocol(s: any, p: SprotoProtocol, streamIn: ByteArray): ByteArray | null {
  let stream = streamIn.slice(0);
  const sz = toDword(stream);
  stream = stream.slice(SIZEOF_LENGTH);
  const result = stream.slice(sz);

  const fn = structField(stream, sz);
  stream = stream.slice(SIZEOF_HEADER);

  p.name = null;
  p.tag = -1;
  p.p = [null, null];
  p.confirm = 0;

  let tag = 0;
  for (let i = 0; i < fn; i++, tag++) {
    let value = toWord(stream.slice(SIZEOF_FIELD * i));
    if ((value & 1) !== 0) {
      tag += Math.floor((value - 1) / 2);
      continue;
    }
    value = Math.floor(value / 2) - 1;
    switch (i) {
      case 0:
        if (value !== -1) return null;
        p.name = importString(s, stream.slice(SIZEOF_FIELD * fn));
        break;
      case 1:
        if (value < 0) return null;
        p.tag = value;
        break;
      case 2:
        if (value < 0 || value >= s.type_n) return null;
        p.p[0] = s.type[value];
        break;
      case 3:
        if (value < 0 || value > s.type_n) return null;
        p.p[1] = s.type[value];
        break;
      case 4:
        p.confirm = value;
        break;
      default:
        return null;
    }
  }

  if (p.name == null || p.tag < 0) return null;
  return result;
}

/* ---------- Bundle loader ---------- */

function createFromBundle(s: any, stream: ByteArray, sz: number): any | null {
  const fn = structField(stream, sz);
  if (fn < 0 || fn > 2) return null;

  stream = stream.slice(SIZEOF_HEADER);
  let content = stream.slice(fn * SIZEOF_FIELD);

  let typedata: ByteArray | null = null;
  let protocoldata: ByteArray | null = null;

  for (let i = 0; i < fn; i++) {
    const value = toWord(stream.slice(i * SIZEOF_FIELD));
    if (value !== 0) return null;

    const n = countArray(content);
    if (n < 0) return null;

    if (i === 0) {
      typedata = content.slice(SIZEOF_LENGTH);
      s.type_n = n;
      s.type = new Array(n);
    } else {
      protocoldata = content.slice(SIZEOF_LENGTH);
      s.protocol_n = n;
      s.proto = new Array(n);
    }
    content = content.slice(toDword(content) + SIZEOF_LENGTH);
  }

  if (!typedata || !protocoldata) return null;

  for (let i = 0; i < s.type_n; i++) {
    s.type[i] = {} as SprotoType;
    const next = importType(s, s.type[i], typedata);
    if (next == null) return null;
    typedata = next;
  }

  for (let i = 0; i < s.protocol_n; i++) {
    s.proto[i] = {} as SprotoProtocol;
    const next = importProtocol(s, s.proto[i], protocoldata);
    if (next == null) return null;
    protocoldata = next;
  }

  return s;
}

/* ---------- Packing / Unpacking utilities ---------- */

function fillSize(data: ByteArray, offset: number, size: number): number {
  data[offset] = size & 0xff;
  data[offset + 1] = (size >> 8) & 0xff;
  data[offset + 2] = (size >> 16) & 0xff;
  data[offset + 3] = (size >> 24) & 0xff;
  return size + SIZEOF_LENGTH;
}

function encodeInteger(v: number, data: ByteArray, offset: number): number {
  data[offset + 4] = v & 0xff;
  data[offset + 5] = (v >> 8) & 0xff;
  data[offset + 6] = (v >> 16) & 0xff;
  data[offset + 7] = (v >> 24) & 0xff;
  return fillSize(data, offset, 4);
}

function encodeUint64(v: number, data: ByteArray, offset: number): number {
  data[offset + 4] = v & 0xff;
  data[offset + 5] = Math.floor(v / Math.pow(2, 8)) & 0xff;
  data[offset + 6] = Math.floor(v / Math.pow(2, 16)) & 0xff;
  data[offset + 7] = Math.floor(v / Math.pow(2, 24)) & 0xff;
  data[offset + 8] = Math.floor(v / Math.pow(2, 32)) & 0xff;
  data[offset + 9] = Math.floor(v / Math.pow(2, 40)) & 0xff;
  data[offset + 10] = Math.floor(v / Math.pow(2, 48)) & 0xff;
  data[offset + 11] = Math.floor(v / Math.pow(2, 56)) & 0xff;
  return fillSize(data, offset, 8);
}

function doubleToBinary(value: number, data: ByteArray, offset: number): number {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 8; i++) data[offset + 4 + i] = bytes[i];
  return fillSize(data, offset, 8);
}

function binaryToDouble(bytes: ByteArray): number {
  const u8 = new Uint8Array(8);
  for (let i = 0; i < 8; i++) u8[i] = bytes[i];
  return new DataView(u8.buffer).getFloat64(0, true);
}

/* Pack helpers (same algorithm) */

function packSegment(src: ByteArray, srcIdx: number, dest: ByteArray, destIdx: number, destRemaining: number, ffCount: number): number {
  let header = 0;
  let notZeroCount = 0;
  const headerPos = destIdx;
  destIdx++;
  destRemaining--;
  if (destRemaining < 0) return 0;

  for (let i = 0; i < 8; i++) {
    if (src[srcIdx + i] !== 0) {
      notZeroCount++;
      header |= 1 << i;
      if (destRemaining > 0) {
        dest[destIdx] = src[srcIdx + i];
        destIdx++;
        destRemaining--;
      }
    }
  }

  if ((notZeroCount === 7 || notZeroCount === 6) && ffCount > 0) {
    notZeroCount = 8;
  }

  if (notZeroCount === 8) {
    return ffCount > 0 ? 8 : 10;
  }

  dest[headerPos] = header;
  return notZeroCount + 1;
}

function writeFF(src: ByteArray, srcIdx: number, dest: ByteArray, destIdx: number, n: number): void {
  const align8N = (n + 7) & ~7;
  dest[destIdx] = 0xff;
  dest[destIdx + 1] = Math.floor(align8N / 8) - 1;
  for (let i = 0; i < n; i++) dest[destIdx + i + 2] = src[srcIdx + i];
  for (let i = 0; i < align8N - n; i++) dest[destIdx + n + 2 + i] = 0;
}

function sprotoPack(src: ByteArray, srcIdx: number, dest: ByteArray, destIdx: number): number {
  const tmp: ByteArray = new Array(8);
  let ffSrcStart: ByteArray | null = null;
  let ffDesStart: ByteArray | null = null;
  let ffCount = 0;
  let size = 0;
  let srcArr = src;
  const srcLen = src.length;
  let bufRemaining = 1 << 30;

  for (let i = 0; i < srcLen; i += 8) {
    const padding = i + 8 - srcLen;
    if (padding > 0) {
      for (let j = 0; j < 8 - padding; j++) tmp[j] = srcArr[srcIdx + j];
      for (let j = 0; j < padding; j++) tmp[7 - j] = 0;
      srcArr = tmp;
      srcIdx = 0;
    }

    const n = packSegment(srcArr, srcIdx, dest, destIdx, bufRemaining, ffCount);
    bufRemaining -= n;
    if (n === 10) {
      ffSrcStart = srcArr;
      ffDesStart = dest;
      ffCount = 1;
    } else if (n === 8 && ffCount > 0) {
      ++ffCount;
      if (ffCount === 256) {
        if (bufRemaining >= 0 && ffSrcStart && ffDesStart) {
          writeFF(ffSrcStart, 0, ffDesStart, 0, 256 * 8);
        }
        ffCount = 0;
      }
    } else {
      if (ffCount > 0 && ffSrcStart && ffDesStart) {
        if (bufRemaining >= 0) writeFF(ffSrcStart, 0, ffDesStart, 0, ffCount * 8);
        ffCount = 0;
      }
    }

    srcIdx += 8;
    destIdx += n;
    size += n;
  }

  if (bufRemaining >= 0) {
    if (ffCount === 1 && ffSrcStart && ffDesStart) {
      writeFF(ffSrcStart, 0, ffDesStart, 0, 8);
    } else if (ffCount > 1 && ffSrcStart && ffDesStart) {
      writeFF(ffSrcStart, 0, ffDesStart, 0, src.length - 0);
    }
    if (dest.length > size) {
      for (let i = size; i < dest.length; i++) dest[i] = 0;
    }
  }

  return size;
}

function sprotoUnpack(src: ByteArray, srcIdx: number, dest: ByteArray, destIdx: number): number {
  const srcArr = src;
  const destArr = dest;
  let size = 0;
  let srcLen = src.length;
  let bufRemaining = 1 << 30;

  while (srcLen > 0) {
    const header = srcArr[srcIdx];
    --srcLen;
    ++srcIdx;
    if (header === 0xff) {
      if (srcLen < 0) return -1;
      const n = (srcArr[srcIdx] + 1) * 8;
      if (srcLen < n + 1) return -1;
      srcLen -= n + 1;
      ++srcIdx;
      if (bufRemaining >= n) {
        for (let i = 0; i < n; i++) {
          destArr[destIdx + i] = srcArr[srcIdx + i];
        }
      }
      bufRemaining -= n;
      destIdx += n;
      srcIdx += n;
      size += n;
    } else {
      for (let i = 0; i < 8; i++) {
        const nz = (header >>> i) & 1;
        if (nz !== 0) {
          if (srcLen < 0) return -1;
          if (bufRemaining > 0) {
            destArr[destIdx] = srcArr[srcIdx];
            --bufRemaining;
            ++destIdx;
          }
          ++srcIdx;
          --srcLen;
        } else {
          if (bufRemaining > 0) {
            destArr[destIdx] = 0;
            --bufRemaining;
            ++destIdx;
          }
        }
        ++size;
      }
    }
  }
  return size;
}

/* ---------- Public API creation (createNew) ---------- */

const sproto = (() => {
  const exportsObj: any = {};
  const hostPrototype: any = {};
  let headerTmp: any = {};

  // helper to query protocol by tag (binary search)
  function queryProtoByTag(sp: any, tag: number) {
    let begin = 0;
    let end = sp.protocol_n;
    while (begin < end) {
      const mid = Math.floor((begin + end) / 2);
      const t = sp.proto[mid].tag;
      if (t === tag) return sp.proto[mid];
      if (tag > t) begin = mid + 1;
      else end = mid;
    }
    return null;
  }

  function getTypeByName(sp: any, typeName: string) {
    for (let i = 0; i < sp.type_n; i++) {
      if (typeName === sp.type[i].name) return sp.type[i];
    }
    return null;
  }

  function findFieldByTag(st: SprotoType, tag: number) {
    if (st.base >= 0) {
      tag -= st.base;
      if (tag < 0 || tag > st.n) return null;
      return st.f![tag];
    }
    let begin = 0;
    let end = st.n;
    while (begin < end) {
      const mid = Math.floor((begin + end) / 2);
      const f = st.f![mid];
      const t = f.tag;
      if (t === tag) return f;
      if (tag > t) begin = mid + 1;
      else end = mid;
    }
    return null;
  }

  exportsObj.pack = function (inbuf: ByteArray): ByteArray {
    const dest: ByteArray = new Array();
    sprotoPack(inbuf, 0, dest, 0);
    return dest;
  };

  exportsObj.unpack = function (inbuf: ByteArray): ByteArray {
    const dest: ByteArray = new Array();
    sprotoUnpack(inbuf, 0, dest, 0);
    return dest;
  };

  exportsObj.createNew = function (bundle: ByteArray): SprotoInstance | null {
    const s: {
      type_n: number;
      protocol_n: number;
      type: SprotoType[] | null;
      proto: SprotoProtocol[] | null;
      tcache: Map<string | number, any>;
      pcache: Map<string | number, any>;
    } = {
      type_n: 0,
      protocol_n: 0,
      type: null,
      proto: null,
      tcache: new Map<string | number, any>(),
      pcache: new Map<string | number, any>()
    };

    const sp = createFromBundle(s, bundle, bundle.length);
    if (sp == null) return null;

    /* ---------- Encoding engine ---------- */

    function encodeObject(cb: any, args: any, data: ByteArray, dataIdx: number): number {
      args.buffer = data;
      args.buffer_idx = dataIdx + SIZEOF_LENGTH;
      const sz = cb(args);
      if (sz < 0) {
        if (sz === -2) return 0;
        return -1;
      }
      return fillSize(data, dataIdx, sz);
    }

    function sprotoEncode(st: SprotoType, buffer: ByteArray, bufferIdx: number, cb: any, ud: any): number {
      const headerIdx = bufferIdx;
      let dataIdx = bufferIdx;
      const headerSize = SIZEOF_HEADER + st.maxn * SIZEOF_FIELD;
      let index = 0;
      let lastTag = -1;

      dataIdx = headerIdx + headerSize;

      for (let i = 0; i < st.n; i++) {
        const field = st.f![i];
        const type = field.type;
        let value = 0;
        let sz = -1;

        const args: any = {
          ud,
          tagname: field.name,
          tagid: field.tag,
          subtype: field.st != null ? sp.type[field.st] : null,
          mainindex: field.key,
          extra: field.extra,
        };

        if ((type & SPROTO_TARRAY) !== 0) {
          args.type = type & ~SPROTO_TARRAY;
          sz = encodeArray(cb, args, buffer, dataIdx);
        } else {
          const basicType = type & ~SPROTO_TARRAY;
          switch (basicType) {
            case FieldType.INTEGER:
            case FieldType.DOUBLE:
            case FieldType.BOOLEAN: {
              args.type = basicType;
              args.index = 0;
              args.value = 0;
              args.length = 8;
              args.buffer = buffer;
              args.buffer_idx = bufferIdx;

              const ret = cb(args);
              if (ret < 0) {
                if (ret === -2) continue;
                if (ret === -3) return 0;
                return -1;
              }

              if (ret === 4) {
                if (args.value < 0x7fff) {
                  value = (args.value + 1) * 2;
                  sz = 2;
                } else {
                  sz = encodeInteger(args.value, buffer, dataIdx);
                }
              } else if (ret === 8) {
                if (basicType === FieldType.DOUBLE) {
                  sz = doubleToBinary(args.value, buffer, dataIdx);
                } else {
                  sz = encodeUint64(args.value, buffer, dataIdx);
                }
              } else {
                return -1;
              }
              break;
            }
            case FieldType.STRING:
            case FieldType.STRUCT: {
              args.type = basicType;
              sz = encodeObject(cb, args, buffer, dataIdx);
              if (sz < 0) return -1;
              break;
            }
            default:
              return -1;
          }
        }

        if (sz < 0) return -1;
        if (sz > 0) {
          let recordIdx = headerIdx + SIZEOF_HEADER + SIZEOF_FIELD * index;
          let tagGap = field.tag - lastTag - 1;
          if (tagGap > 0) {
            tagGap = (tagGap - 1) * 2 + 1;
            if (tagGap > 0xffff) return -1;
            buffer[recordIdx] = tagGap & 0xff;
            buffer[recordIdx + 1] = (tagGap >> 8) & 0xff;
            ++index;
            recordIdx += SIZEOF_FIELD;
          }
          ++index;
          buffer[recordIdx] = value & 0xff;
          buffer[recordIdx + 1] = (value >> 8) & 0xff;
          lastTag = field.tag;
          if (value === 0) dataIdx += sz;
        }
      }

      buffer[headerIdx] = index & 0xff;
      buffer[headerIdx + 1] = (index >> 8) & 0xff;

      const dataSize = dataIdx - (headerIdx + headerSize);
      if (index !== st.maxn) {
        const v = buffer.slice(headerIdx + headerSize, headerIdx + headerSize + dataSize);
        for (let sIdx = 0; sIdx < v.length; sIdx++) {
          buffer[headerIdx + SIZEOF_HEADER + index * SIZEOF_FIELD + sIdx] = v[sIdx];
        }
        buffer.splice(headerIdx + SIZEOF_HEADER + index * SIZEOF_FIELD + v.length, buffer.length);
      }

      return SIZEOF_HEADER + index * SIZEOF_FIELD + dataSize;
    }

    function encodeArray(cb: any, args: any, data: ByteArray, dataIdx: number): number {
      const buffer = data;
      let bufferIdx = dataIdx + SIZEOF_LENGTH;

      switch (args.type) {
        case FieldType.INTEGER: {
          const noArray = { value: 0 };
          const idxAfter = encodeIntegerArray(cb, args, buffer, bufferIdx, noArray);
          if (idxAfter == null) return -1;
          if (noArray.value !== 0) return 0;
          bufferIdx = idxAfter;
          break;
        }
        case FieldType.BOOLEAN: {
          args.index = 1;
          for (; ;) {
            args.value = 0;
            args.length = 4;
            const sz = cb(args);
            if (sz < 0) {
              if (sz === -2) break;
              if (sz === -3) return 0;
              return -1;
            }
            if (sz < 1) return -1;
            buffer[bufferIdx] = args.value === 1 ? 1 : 0;
            bufferIdx++;
            ++args.index;
          }
          break;
        }
        default: {
          args.index = 1;
          for (; ;) {
            args.buffer = buffer;
            args.buffer_idx = bufferIdx + SIZEOF_LENGTH;
            const sz = cb(args);
            if (sz < 0) {
              if (sz === -2) break;
              if (sz === -3) return 0;
              return -1;
            }
            fillSize(buffer, bufferIdx, sz);
            bufferIdx += SIZEOF_LENGTH + sz;
            ++args.index;
          }
          break;
        }
      }

      const totalSz = bufferIdx - (dataIdx + SIZEOF_LENGTH);
      return fillSize(buffer, dataIdx, totalSz);
    }

    function encodeIntegerArray(cb: any, args: any, buffer: ByteArray, bufferIdx: number, noarray: { value: number }): number | null {
      let intLen = 4;
      let index = 1;
      const headerIdx = bufferIdx;
      bufferIdx++;
      noarray.value = 0;

      for (; ;) {
        args.value = null;
        args.length = 8;
        args.index = index;
        const sz = cb(args);
        if (sz <= 0) {
          if (sz === -2) break;
          if (sz === -3) {
            noarray.value = 1;
            break;
          }
          return null;
        }

        if (sz === 4) {
          const v = args.value;
          buffer[bufferIdx] = v & 0xff;
          buffer[bufferIdx + 1] = (v >> 8) & 0xff;
          buffer[bufferIdx + 2] = (v >> 16) & 0xff;
          buffer[bufferIdx + 3] = (v >> 24) & 0xff;
          if (intLen === 8) {
            const negative = (v & 0x80000000) !== 0;
            uint32ToUint64(negative, buffer, bufferIdx);
          }
        } else {
          if (sz !== 8) return null;
          if (intLen === 4) {
            bufferIdx += (index - 1) * 4;
            for (let i = index - 2; i >= 0; i--) {
              for (let j = 1 + i * 8; j < 1 + i * 8 + 4; j++) {
                buffer[headerIdx + j] = buffer[headerIdx + j - i * 4];
              }
              const negative = buffer[headerIdx + 1 + i * 8 + 3] & 0x80;
              uint32ToUint64(!!negative, buffer, bufferIdx + 1 + i * 8);
            }
            intLen = 8;
          }

          const v = args.value;
          buffer[bufferIdx] = v & 0xff;
          buffer[bufferIdx + 1] = Math.floor(v / Math.pow(2, 8)) & 0xff;
          buffer[bufferIdx + 2] = Math.floor(v / Math.pow(2, 16)) & 0xff;
          buffer[bufferIdx + 3] = Math.floor(v / Math.pow(2, 24)) & 0xff;
          buffer[bufferIdx + 4] = Math.floor(v / Math.pow(2, 32)) & 0xff;
          buffer[bufferIdx + 5] = Math.floor(v / Math.pow(2, 40)) & 0xff;
          buffer[bufferIdx + 6] = Math.floor(v / Math.pow(2, 48)) & 0xff;
          buffer[bufferIdx + 7] = Math.floor(v / Math.pow(2, 56)) & 0xff;
        }

        bufferIdx += intLen;
        index++;
      }

      if (bufferIdx === headerIdx + 1) return headerIdx;
      buffer[headerIdx] = intLen & 0xff;
      return bufferIdx;
    }

    function uint32ToUint64(negative: boolean, buffer: ByteArray, bufferIdx: number): void {
      if (negative) {
        buffer[bufferIdx + 4] = 0xff;
        buffer[bufferIdx + 5] = 0xff;
        buffer[bufferIdx + 6] = 0xff;
        buffer[bufferIdx + 7] = 0xff;
      } else {
        buffer[bufferIdx + 4] = 0;
        buffer[bufferIdx + 5] = 0;
        buffer[bufferIdx + 6] = 0;
        buffer[bufferIdx + 7] = 0;
      }
    }

    function decodeArray(cb: any, args: any, stream: ByteArray): number {
      const sz = toDword(stream);
      if (sz === 0) {
        args.index = -1;
        args.value = null;
        args.length = 0;
        cb(args);
        return 0;
      }

      let cursor = stream.slice(SIZEOF_LENGTH);
      const type = args.type;

      if (type === FieldType.INTEGER) {
        const len = cursor[0];
        cursor = cursor.slice(1);
        if (len === 4) {
          if (cursor.length % 4 !== 0) return -1;
          for (let i = 0; i < Math.floor(cursor.length / 4); i++) {
            const v = expand64(toDword(cursor.slice(i * 4)));
            args.index = i + 1;
            args.value = v;
            args.length = 8;
            cb(args);
          }
        } else if (len === 8) {
          if (cursor.length % 8 !== 0) return -1;
          for (let i = 0; i < Math.floor(cursor.length / 8); i++) {
            const low = toDword(cursor.slice(i * 8));
            const hi = toDword(cursor.slice(i * 8 + 4));
            const v = hiLowUint64(low, hi);
            args.index = i + 1;
            args.value = v;
            args.length = 8;
            cb(args);
          }
        } else return -1;
        return 0;
      }

      if (type === FieldType.BOOLEAN) {
        for (let i = 0; i < cursor.length; i++) {
          args.index = i + 1;
          args.value = cursor[i];
          args.length = 8;
          cb(args);
        }
        return 0;
      }

      if (type === FieldType.STRING || type === FieldType.STRUCT) {
        return decodeArrayObject(cb, args, cursor, cursor.length);
      }

      return -1;
    }

    function decodeArrayObject(cb: any, args: any, stream: ByteArray, size: number): number {
      let index = 1;
      let cursor = stream.slice(0);
      let remaining = size;
      while (remaining > 0) {
        if (remaining < SIZEOF_LENGTH) return -1;
        const hsz = toDword(cursor);
        cursor = cursor.slice(SIZEOF_LENGTH);
        remaining -= SIZEOF_LENGTH;
        if (hsz > remaining) return -1;
        args.index = index;
        args.value = cursor;
        args.length = hsz;
        if (cb(args) !== 0) return -1;
        cursor = cursor.slice(hsz);
        remaining -= hsz;
        ++index;
      }
      return 0;
    }

    function expand64(v: number): number {
      let value = v;
      if ((value & 0x80000000) !== 0) {
        value = 0x0000000000000 + (value & 0xffffffff);
      }
      return value;
    }

    function hiLowUint64(low: number, hi: number): number {
      return (hi & 0xffffffff) * 0x100000000 + low;
    }

    /* ---------- High-level encode/decode wrapper callbacks ---------- */

    interface EncodeCallbackArgs {
      ud: any;
      tagname: string | null;
      tagid: number;
      type: number;
      subtype: SprotoType | null;
      index: number;
      mainindex: number;
      extra: number;
      value?: any;
      length?: number;
      buffer?: ByteArray;
      buffer_idx?: number;
    }

    interface DecodeCallbackArgs {
      ud: any;
      tagname: string | null;
      tagid: number;
      type: number;
      subtype: SprotoType | null;
      index: number;
      mainindex: number;
      extra: number;
      value: any;
      length: number;
    }

    function encodeCallback(args: EncodeCallbackArgs): number {
      const self = args.ud;
      if (self.deep >= ENCODE_DEEPLEVEL) {
        throw new Error("table is too deep");
      }

      if (self.indata[args.tagname] == null) return -2;

      let target: any = null;
      if (args.index > 0) {
        if (args.tagname !== self.arrayTag) {
          self.arrayTag = args.tagname;
          if (typeof self.indata[args.tagname] !== "object") {
            self.arrayIndex = 0;
            return -2;
          }
          if (self.indata[args.tagname] == null || self.indata[args.tagname] === undefined) {
            self.arrayIndex = 0;
            return -3;
          }
        }
        target = self.indata[args.tagname][args.index - 1];
        if (target == null) return -2;
      } else {
        target = self.indata[args.tagname];
      }

      switch (args.type) {
        case FieldType.INTEGER: {
          let v: number;
          if (args.extra > 0) {
            const vn = target;
            v = Math.floor(vn * args.extra + 0.5);
          } else {
            v = target;
          }
          const vh = Math.floor(v / Math.pow(2, 31));
          if (vh === 0 || vh === -1) {
            args.value = v >>> 0;
            return 4;
          } else {
            args.value = v;
            return 8;
          }
        }
        case FieldType.DOUBLE:
          args.value = target;
          return 8;
        case FieldType.BOOLEAN:
          args.value = target === true ? 1 : target === false ? 0 : undefined;
          return 4;
        case FieldType.STRING: {
          const arr: ByteArray = args.extra ? target : netutils.utf8Encode(String(target));
          const sz = arr.length;
          if (sz > (args.length || 0)) args.length = sz;
          if (args.buffer && args.buffer_idx !== undefined) {
            for (let i = 0; i < arr.length; i++) args.buffer[args.buffer_idx + i] = arr[i];
          }
          return sz;
        }
        case FieldType.STRUCT: {
          const sub = {
            st: args.subtype,
            deep: self.deep + 1,
            indata: target,
          };
          if (args.buffer && args.buffer_idx !== undefined && args.subtype) {
            const r = sprotoEncode(args.subtype, args.buffer, args.buffer_idx, encodeCallback, sub);
            if (r < 0) return -1;
            return r;
          }
          return -1;
        }
        default:
          throw new Error(`Invalid field type ${args.type}`);
      }
    }

    function decodeCallback(args: DecodeCallbackArgs): number {
      const self = args.ud;
      if (self && self.deep >= ENCODE_DEEPLEVEL) throw new Error("table is too deep");

      let value: any;
      switch (args.type) {
        case FieldType.INTEGER:
          value = args.extra ? args.value / args.extra : args.value;
          break;
        case FieldType.DOUBLE:
          value = args.value;
          break;
        case FieldType.BOOLEAN:
          value = args.value === 1 ? true : args.value === 0 ? false : null;
          break;
        case FieldType.STRING: {
          const arr: ByteArray = [];
          for (let i = 0; i < args.length; i++) arr.push(args.value[i]);
          value = args.extra ? arr : netutils.utf8Decode(arr);
          break;
        }
        case FieldType.STRUCT: {
          const sub: any = { deep: self.deep + 1, array_index: 0, array_tag: null, result: {} };
          if (args.mainindex >= 0) {
            sub.mainindex_tag = args.mainindex;
            if (args.subtype) {
              const r = sprotoDecode(args.subtype, args.value, args.length, decodeCallback, sub);
              if (r < 0 || r !== args.length) return r;
              value = sub.result;
            }
          } else {
            sub.mainindex_tag = -1;
            sub.key_index = 0;
            if (args.subtype) {
              const r = sprotoDecode(args.subtype, args.value, args.length, decodeCallback, sub);
              if (r < 0) return -1;
              if (r !== args.length) return r;
              value = sub.result;
            }
          }
          break;
        }
        default:
          throw new Error("Invalid type in decodeCallback");
      }

      if (args.index > 0) {
        if (!self.result[args.tagname]) self.result[args.tagname] = [];
        self.result[args.tagname][args.index - 1] = value;
      } else {
        self.result[args.tagname] = value;
      }
      return 0;
    }

    function sprotoDecode(st: any, data: ByteArray, size: number, cb: any, ud: any): number {
      if (size < SIZEOF_HEADER) return -1;
      let stream = data.slice(0);
      const fn = toWord(stream);
      stream = stream.slice(SIZEOF_HEADER);
      let remaining = size - SIZEOF_HEADER;
      if (remaining < fn * SIZEOF_FIELD) return -1;

      let dataStream = stream.slice(fn * SIZEOF_FIELD);
      remaining -= fn * SIZEOF_FIELD;

      let tag = -1;
      for (let i = 0; i < fn; i++) {
        const valueWord = toWord(stream.slice(i * SIZEOF_FIELD));
        ++tag;
        if ((valueWord & 1) !== 0) {
          tag += Math.floor(valueWord / 2);
          continue;
        }
        const value = Math.floor(valueWord / 2) - 1;
        const currentData = dataStream.slice(0);

        if (value < 0) {
          if (remaining < SIZEOF_LENGTH) return -1;
          const fieldSize = toDword(dataStream);
          if (remaining < fieldSize + SIZEOF_LENGTH) return -1;
          dataStream = dataStream.slice(fieldSize + SIZEOF_LENGTH);
          remaining -= fieldSize + SIZEOF_LENGTH;
        }

        const f = findFieldByTag(st, tag);
        if (!f) continue;

        const args: any = {
          ud,
          tagname: f.name,
          tagid: f.tag,
          type: f.type & ~SPROTO_TARRAY,
          subtype: f.st != null ? sp.type[f.st] : null,
          index: 0,
          mainindex: f.key,
          extra: f.extra,
        };

        if (value < 0) {
          if ((f.type & SPROTO_TARRAY) !== 0) {
            if (decodeArray(cb, args, currentData) !== 0) return -1;
          } else {
            switch (f.type) {
              case FieldType.DOUBLE: {
                const sz2 = toDword(currentData);
                if (sz2 !== 8) return -1;
                const dbytes = currentData.slice(SIZEOF_LENGTH, SIZEOF_LENGTH + 8);
                args.value = binaryToDouble(dbytes);
                args.length = 8;
                cb(args);
                break;
              }
              case FieldType.INTEGER: {
                const sz2 = toDword(currentData);
                if (sz2 === 4) {
                  const v = expand64(toDword(currentData.slice(SIZEOF_LENGTH)));
                  args.value = v;
                  args.length = 8;
                  cb(args);
                } else if (sz2 === 8) {
                  const low = toDword(currentData.slice(SIZEOF_LENGTH));
                  const hi = toDword(currentData.slice(SIZEOF_LENGTH + 4));
                  args.value = hiLowUint64(low, hi);
                  args.length = 8;
                  cb(args);
                } else return -1;
                break;
              }
              case FieldType.STRING:
              case FieldType.STRUCT: {
                const sz2 = toDword(currentData);
                args.value = currentData.slice(SIZEOF_LENGTH);
                args.length = sz2;
                if (cb(args) !== 0) return -1;
                break;
              }
              default:
                return -1;
            }
          }
        } else if (f.type !== FieldType.INTEGER && f.type !== FieldType.BOOLEAN) {
          return -1;
        } else {
          args.value = value;
          args.length = 8;
          cb(args);
        }
      }

      return size - remaining;
    }

    /* ---------- Utility caches and query helpers ---------- */

    function queryType(spRef: any, typename: string | number): SprotoType | null {
      const key = String(typename);
      if (spRef.tcache.has(key)) return spRef.tcache.get(key);
      const tinfo = getTypeByName(spRef, typename as string);
      if (tinfo) {
        spRef.tcache.set(key, tinfo);
        return tinfo;
      }
      return null;
    }

    interface ProtocolInfo {
      tag: number | null;
      name: string | null;
      request: SprotoType | null;
      response: SprotoType | null;
    }

    function getProtocol(spRef: any, pname: string | number): ProtocolInfo | null {
      if (spRef.pcache.has(String(pname))) return spRef.pcache.get(String(pname));

      let tag: number | null = null;
      let name: string | null = null;

      if (typeof pname === "number") {
        tag = pname;
        name = spRef.proto.find((p: SprotoProtocol) => p.tag === pname)?.name ?? null;
        if (!name) return null;
      } else {
        tag = spRef.proto.find((p: SprotoProtocol) => p.name === pname)?.tag ?? -1;
        name = String(pname);
        if (tag === -1) return null;
      }

      const request = queryProtoByTag(spRef, tag!)?.p[0] ?? null;
      const response = queryProtoByTag(spRef, tag!)?.p[1] ?? null;
      const protoInfo: ProtocolInfo = { tag, name, request, response };
      spRef.pcache.set(String(name), protoInfo);
      spRef.pcache.set(String(tag), protoInfo);
      return protoInfo;
    }

    /* ---------- Exposed instance methods ---------- */

    sp.queryproto = function (protocolName: string | number) {
      return getProtocol(sp, protocolName);
    };

    sp.dump = function () {
      console.log(this);
    };

    sp.objlen = function (type: string | number | SprotoType, inbuf: ByteArray): number | null {
      const st = typeof type === "string" || typeof type === "number" ? queryType(sp, type) : (type as SprotoType);
      if (st == null) return null;
      const ud = { arrayTag: null, deep: 0, result: {} };
      return sprotoDecode(st, inbuf, inbuf.length, decodeCallback, ud);
    };

    // 定义编码上下文的类型
    interface EncodeContext {
      st: SprotoType;
      tblIndex: number;
      indata: any;
      arrayTag: string | null;
      arrayIndex: number;
      deep: number;
      iterIndex: number;
    }

    // 定义解码上下文的类型
    interface DecodeContext {
      arrayTag: string | null;
      deep: number;
      result: any;
    }

    sp.encode = function <T>(type: string | number | SprotoType, indata: T): ByteArray | null {
      const st = typeof type === "string" || typeof type === "number" ? queryType(sp, type) : (type as SprotoType);
      if (st == null) return null;
      const enbuffer: ByteArray = [];
      const ctx: EncodeContext = {
        st,
        tblIndex: 2,
        indata,
        arrayTag: null,
        arrayIndex: 0,
        deep: 0,
        iterIndex: 3,
      };
      const r = sprotoEncode(st, enbuffer, 0, encodeCallback, ctx);
      if (r < 0) {
        console.error(`[sproto encode] failed to encode type "${st.name}" (retval=${r}). input keys: ${indata && typeof indata === 'object' ? Object.keys(indata).join(', ') : 'unknown'}`);
        return null;
      }
      return enbuffer;
    };

    sp.decode = function (type: string | number | SprotoType, inbuf: ByteArray) {
      const st = typeof type === "string" || typeof type === "number" ? queryType(sp, type) : (type as SprotoType);
      if (st == null) return null;
      const ud = { arrayTag: null, deep: 0, result: {} };
      const r = sprotoDecode(st, inbuf, inbuf.length, decodeCallback, ud);
      if (r < 0) return null;
      return ud.result;
    };

    sp.pack = function (inbuf: ByteArray) {
      return exportsObj.pack(inbuf);
    };

    sp.unpack = function (inbuf: ByteArray) {
      return exportsObj.unpack(inbuf);
    };

    sp.pencode = function (type: any, inbuf: any) {
      const obuf = sp.encode(type, inbuf);
      if (obuf == null) return null;
      return sp.pack(obuf);
    };

    sp.pdecode = function (type: any, inbuf: any) {
      const obuf = sp.unpack(inbuf);
      if (obuf == null) return null;
      return sp.decode(type, obuf);
    };

    sp.host = function (packageName?: string): Host {
      const pkg = packageName ?? "package";
      
      class HostClass implements Host {
        proto: SprotoInstance;
        package: SprotoType | string;
        session: { [key: string]: any };
        attachsp?: SprotoInstance;

        constructor(name: string | undefined, spInstance: SprotoInstance) {
          this.proto = spInstance;
          this.package = queryType(spInstance as any, name ?? pkg) ?? "package";
          this.session = {};
        }

        attach(attachedSp: SprotoInstance) {
          this.attachsp = attachedSp;
          return (name: string | number, args?: any, session?: any): ByteArray => {
            const proto = getProtocol(sp, name);
            headerTmp.type = proto.tag;
            headerTmp.session = session;

            const headerBuffer = sp.encode(this.package, headerTmp);
            if (session) {
              this.session[session] = proto.response ? proto.response : true;
            }

            if (args) {
              const dataBuffer = sp.encode(proto.request, args);
              if (dataBuffer == null) {
                throw new Error(`[sproto host.attach] failed to encode request payload for proto "${proto.name}". Check input keys and types.`);
              }
              return sp.pack(netutils.concatArrays(headerBuffer, dataBuffer));
            } else {
              return sp.pack(headerBuffer);
            }
          };
        }

        dispatch(buffer: ByteArray) {
          const spLocal = this.proto;
          const bin = spLocal.unpack(buffer);
          headerTmp = spLocal.decode(this.package, bin) ?? {};
          const usedSz = spLocal.objlen(this.package, bin);
          const leftBuffer = bin.slice((usedSz as number) || 0, bin.length);

          if (headerTmp.type !== undefined) {
            const proto = getProtocol(spLocal, headerTmp.type);
            let result;
            if (proto && proto.request) {
              result = spLocal.decode(proto.request, leftBuffer);
            }

            if (headerTmp.session !== undefined) {
              return {
                type: "REQUEST",
                pname: proto?.name,
                result,
                responseFunc: genResponse(this, proto?.response || null, headerTmp.session),
                session: headerTmp.session,
              };
            } else {
              return {
                type: "REQUEST",
                pname: proto?.name,
                result,
              };
            }
          } else {
            const attached = this.attachsp;
            const sessionId = headerTmp.session;
            const response = this.session[sessionId];
            delete this.session[sessionId];

            if (response === true) {
              return {
                type: "RESPONSE",
                session: sessionId,
              };
            } else if (attached) {
              const result = attached.decode(response, leftBuffer);
              return {
                type: "RESPONSE",
                session: sessionId,
                result,
              };
            }
          }
        }
      }

      return new HostClass(packageName, sp as SprotoInstance);
    };

    /* ---------- Host prototype functions ---------- */

    hostPrototype.attach = function (attachedSp: any) {
      this.attachsp = attachedSp;
      const self = this;
      return (name: string | number, args?: any, session?: any) => {
        const proto = getProtocol(sp, name);
        headerTmp.type = proto.tag;
        headerTmp.session = session;

        const headerBuffer = sp.encode(self.package, headerTmp);
        if (session) {
          this.session[session] = proto.response ? proto.response : true;
        }

        if (args) {
          const dataBuffer = sp.encode(proto.request, args);
          if (dataBuffer == null) {
            throw new Error(`[sproto host.attach] failed to encode request payload for proto "${proto.name}". Check input keys and types.`);
          }
          return sp.pack(netutils.concatArrays(headerBuffer, dataBuffer));
        } else {
          return sp.pack(headerBuffer);
        }
      };
    };

    function genResponse(selfObj: Host, responseType: SprotoType | null, sessionId: any) {
      return function (args: any) {
        headerTmp.type = null;
        headerTmp.session = sessionId;
        const headerBuffer = selfObj.proto.encode(selfObj.package, headerTmp);
        if (responseType) {
          const dataBuffer = selfObj.proto.encode(responseType, args);
          return selfObj.proto.pack(netutils.concatArrays(headerBuffer, dataBuffer));
        } else {
          return selfObj.proto.pack(headerBuffer);
        }
      };
    }

    hostPrototype.dispatch = function (buffer: ByteArray) {
      const spLocal = this.proto;
      const bin = spLocal.unpack(buffer);
      headerTmp = spLocal.decode(this.package, bin) ?? {};
      const usedSz = spLocal.objlen(this.package, bin);
      const leftBuffer = bin.slice((usedSz as number) || 0, bin.length);

      if (headerTmp.type) {
        const proto = getProtocol(spLocal, headerTmp.type);
        let result;
        if (proto && proto.request) {
          result = spLocal.decode(proto.request, leftBuffer);
        }

        if (headerTmp.session) {
          return {
            type: "REQUEST",
            pname: proto?.name,
            result,
            responseFunc: genResponse(this, proto?.response || null, headerTmp.session),
            session: headerTmp.session,
          };
        } else {
          return {
            type: "REQUEST",
            pname: proto?.name,
            result,
          };
        }
      } else {
        const attached = this.attachsp;
        const sessionId = headerTmp.session;
        const response = this.session[sessionId];
        delete this.session[sessionId];

        if (response === true) {
          return {
            type: "RESPONSE",
            session: sessionId,
          };
        } else {
          const result = attached?.decode(response, leftBuffer);
          return {
            type: "RESPONSE",
            session: sessionId,
            result,
          };
        }
      }
    };

    return sp as SprotoInstance;
  };

  return exportsObj;
})();

export default sproto;
