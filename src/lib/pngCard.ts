import { crc32 } from "@/lib/crc32";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const readUint32BE = (buf: Uint8Array, offset: number) =>
  (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];

const writeUint32BE = (value: number) => {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
};

const concatBytes = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

const encodeAscii = (s: string) => new TextEncoder().encode(s);

const bytesToBinaryString = (bytes: Uint8Array): string => {
  const chunkSize = 0x2000;
  let out = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return out;
};

const base64EncodeUtf8 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  return btoa(bytesToBinaryString(bytes));
};

const base64DecodeUtf8 = (b64: string): string => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export type ExtractedPngCard = {
  keyword: "chara" | "ccv3";
  jsonText: string;
};

const parseTextChunkKeyword = (chunkData: Uint8Array): { keyword: string; textBytes: Uint8Array } | null => {
  const nullIndex = chunkData.indexOf(0);
  if (nullIndex <= 0) return null;
  const keyword = new TextDecoder("utf-8").decode(chunkData.slice(0, nullIndex));
  return { keyword, textBytes: chunkData.slice(nullIndex + 1) };
};

export const extractCardFromPng = (pngBytes: Uint8Array): ExtractedPngCard | null => {
  if (pngBytes.length < 8) return null;
  for (let i = 0; i < 8; i++) if (pngBytes[i] !== PNG_SIGNATURE[i]) return null;

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset) >>> 0;
    const type = new TextDecoder("ascii").decode(pngBytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    const next = dataEnd + 4;
    if (next > pngBytes.length) break;

    if (type === "tEXt") {
      const parsed = parseTextChunkKeyword(pngBytes.slice(dataStart, dataEnd));
      if (parsed) {
        const keyword = parsed.keyword;
        if (keyword === "chara" || keyword === "ccv3") {
          const b64 = new TextDecoder("ascii").decode(parsed.textBytes);
          const jsonText = base64DecodeUtf8(b64);
          return { keyword, jsonText };
        }
      }
    }

    if (type === "IEND") break;
    offset = next;
  }
  return null;
};

const buildTextChunk = (keyword: "chara" | "ccv3", base64Payload: string): Uint8Array => {
  const typeBytes = encodeAscii("tEXt");
  const data = concatBytes(encodeAscii(keyword), new Uint8Array([0]), encodeAscii(base64Payload));
  const lengthBytes = writeUint32BE(data.length);
  const crcBytes = writeUint32BE(crc32(concatBytes(typeBytes, data)));
  return concatBytes(lengthBytes, typeBytes, data, crcBytes);
};

export const embedCardIntoPng = (
  pngBytes: Uint8Array,
  cardJsonText: string,
  opts?: { writeCcv3?: boolean; writeChara?: boolean },
): Uint8Array => {
  const writeCcv3 = opts?.writeCcv3 ?? true;
  const writeChara = opts?.writeChara ?? true;

  for (let i = 0; i < 8; i++) if (pngBytes[i] !== PNG_SIGNATURE[i]) throw new Error("不是有效 PNG 文件");

  const b64 = base64EncodeUtf8(cardJsonText);
  const toInsert: Uint8Array[] = [];
  if (writeChara) toInsert.push(buildTextChunk("chara", b64));
  if (writeCcv3) toInsert.push(buildTextChunk("ccv3", b64));

  const outParts: Uint8Array[] = [PNG_SIGNATURE];

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset) >>> 0;
    const typeBytes = pngBytes.slice(offset + 4, offset + 8);
    const type = new TextDecoder("ascii").decode(typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > pngBytes.length) throw new Error("PNG chunk 损坏");

    const chunkData = pngBytes.slice(dataStart, dataEnd);

    let skip = false;
    if (type === "tEXt") {
      const parsed = parseTextChunkKeyword(chunkData);
      if (parsed && (parsed.keyword === "chara" || parsed.keyword === "ccv3")) skip = true;
    }

    if (type === "IEND") {
      for (const c of toInsert) outParts.push(c);
    }

    if (!skip) {
      const lengthBytes = writeUint32BE(chunkData.length);
      const crcBytes = writeUint32BE(crc32(concatBytes(typeBytes, chunkData)));
      outParts.push(concatBytes(lengthBytes, typeBytes, chunkData, crcBytes));
    }

    if (type === "IEND") break;
    offset = chunkEnd;
  }

  return concatBytes(...outParts);
};
