/** Only call on freshly re-encoded output, never as a substitute for decoding. */
const invalid = () => new Error("Não foi possível verificar a mídia limpa. Nada foi enviado.");
const tag = (b: Uint8Array, p: number) => String.fromCharCode(...b.subarray(p, p + 4));
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
export function stripImageMetadata(bytes: Uint8Array, type: string): Uint8Array {
  if (type === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((v, i) => bytes[i] === v)) throw invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts = [bytes.subarray(0, 8)];
    let header = false, pixels = false;
    for (let p = 8; p < bytes.length;) {
      if (p + 12 > bytes.length) throw invalid();
      const length = view.getUint32(p), end = p + 12 + length;
      if (end > bytes.length) throw invalid();
      const kind = tag(bytes, p + 4);
      if (!header && (kind !== "IHDR" || length !== 13)) throw invalid();
      if (kind === "IHDR") { if (header) throw invalid(); header = true; }
      if (kind === "IDAT") pixels = true;
      // Keep only pixel/palette/transparency and standard sRGB rendering data.
      // Text, EXIF, ICC profiles, timestamps, physical resolution and unknown chunks go.
      if (["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "sRGB", "gAMA", "cHRM"].includes(kind)) parts.push(bytes.subarray(p, end));
      else if (kind[0] === kind[0].toUpperCase()) throw invalid();
      if (kind === "IEND") {
        if (length !== 0 || !pixels) throw invalid();
        return join(parts); // Drop trailing payload, too.
      }
      p = end;
    }
    throw invalid();
  }
  if (type !== "image/jpeg" || bytes[0] !== 255 || bytes[1] !== 216) throw invalid();
  const parts = [bytes.subarray(0, 2)];
  let p = 2, scan = false;
  while (p < bytes.length) {
    const start = p;
    if (bytes[p++] !== 255) throw invalid();
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 217) {
      if (!scan) throw invalid();
      parts.push(bytes.subarray(start, p));
      return join(parts);
    }
    if (p + 2 > bytes.length) throw invalid();
    const length = bytes[p] * 256 + bytes[p + 1], end = p + length;
    if (length < 2 || end > bytes.length) throw invalid();
    // All APPn (EXIF/XMP/IPTC/ICC/vendor data) and COM segments are discarded.
    if (!(marker >= 224 && marker <= 239) && marker !== 254) parts.push(bytes.subarray(start, end));
    p = end;
    if (marker === 218) {
      scan = true;
      const startScan = p;
      while (p < bytes.length) {
        if (bytes[p] !== 255) { p++; continue; }
        let next = p + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { p = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(startScan, p));
    }
  }
  throw invalid();
}

/** Zero metadata boxes without shifting sample offsets in the MP4. */
export function stripVideoMetadata(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer);
  const seen = new Set<string>();
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 8) throw invalid();
    for (let p = start; p < end;) {
      if (p + 8 > end) throw invalid();
      let size = view.getUint32(p), header = 8;
      if (size === 1) {
        if (p + 16 > end) throw invalid();
        size = Number(view.getBigUint64(p + 8)); header = 16;
      } else if (size === 0) size = end - p;
      if (!Number.isSafeInteger(size) || size < header || p + size > end) throw invalid();
      const kind = tag(bytes, p + 4), body = p + header, limit = p + size;
      if (depth === 0) seen.add(kind);
      if (["udta", "meta", "uuid", "free", "skip"].includes(kind)) {
        bytes.set([102, 114, 101, 101], p + 4); // free: harmless zero padding
        bytes.fill(0, body, limit);
      } else if (["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"].includes(kind)) {
        walk(body, limit, depth + 1);
      } else if (kind === "stsd") {
        if (body + 8 > limit) throw invalid();
        walk(body + 8, limit, depth + 1);
      } else if (kind === "avc1") {
        if (body + 78 > limit) throw invalid();
        bytes.fill(0, body + 42, body + 74); // Compressor display name
        walk(body + 78, limit, depth + 1);
      } else if (["mvhd", "tkhd", "mdhd"].includes(kind)) {
        const version = bytes[body];
        const dates = version === 0 ? 8 : version === 1 ? 16 : 0;
        if (!dates || body + 4 + dates > limit) throw invalid();
        bytes.fill(0, body + 4, body + 4 + dates);
      } else if (kind === "hdlr") {
        if (body + 24 > limit) throw invalid();
        bytes.fill(0, body + 24, limit); // Track display name
      }
      p = limit;
    }
  };
  walk(0, bytes.length, 0);
  if (!["ftyp", "moov", "mdat"].every(k => seen.has(k))) throw invalid();
  return bytes;
}
