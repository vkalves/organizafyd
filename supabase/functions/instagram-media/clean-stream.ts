import { stripImageMetadata, stripMp4MetadataBoxes } from "../_shared/strip-metadata.ts";

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_MOVIE_HEADER = 8 * 1024 * 1024;
const invalid = () => new Error("media_cleaning_failed");

/** Keep the media payload streaming; only MP4 indexes (moov) need buffering.
 * Codec SEI has already been removed by the mandatory upload cleaner. This
 * delivery pass removes container tags, dates and names again, preserving
 * sample offsets and picture/audio quality, even for a 100 MB video.
 */
export function cleanMp4Stream(source: ReadableStream<Uint8Array>, length: number) {
  if (!Number.isSafeInteger(length) || length < 24 || length > MAX_MEDIA_BYTES) throw invalid();
  const reader = source.getReader();
  let released = false;
  function release() { if (!released) { reader.releaseLock(); released = true; } }
  let chunk: Uint8Array = new Uint8Array(0), cursor = 0;
  async function* take(count: number): AsyncGenerator<Uint8Array> {
    while (count > 0) {
      if (cursor === chunk.length) {
        const next = await reader.read();
        if (next.done) throw invalid();
        chunk = next.value; cursor = 0;
        if (!chunk.length) continue;
      }
      const size = Math.min(count, chunk.length - cursor);
      yield chunk.subarray(cursor, cursor + size);
      cursor += size; count -= size;
    }
  }
  async function exact(count: number) {
    const bytes = new Uint8Array(count);
    let offset = 0;
    for await (const part of take(count)) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  }
  async function* cleaned(): AsyncGenerator<Uint8Array, undefined> {
    let offset = 0;
    const seen = new Set<string>();
    try {
      while (offset < length) {
        if (length - offset < 8) throw invalid();
        let header = await exact(8);
        const type = String.fromCharCode(...header.subarray(4, 8));
        let size = new DataView(header.buffer).getUint32(0);
        if (size === 1) {
          if (length - offset < 16) throw invalid();
          const extended = await exact(8);
          size = Number(new DataView(extended.buffer).getBigUint64(0));
          const full = new Uint8Array(16); full.set(header); full.set(extended, 8); header = full;
        } else if (size === 0) size = length - offset;
        if (!Number.isSafeInteger(size) || size < header.length || size > length - offset) throw invalid();
        // Reject unknown top-level boxes rather than accidentally delivering
        // an unrecognized metadata container from a legacy file.
        if (!["ftyp", "moov", "mdat", "free", "skip", "uuid", "udta", "meta", "wide"].includes(type)) throw invalid();
        seen.add(type);
        const bodySize = size - header.length;
        if (type === "moov") {
          if (size > MAX_MOVIE_HEADER) throw invalid();
          const movie = new Uint8Array(size); movie.set(header);
          let at = header.length;
          for await (const part of take(bodySize)) { movie.set(part, at); at += part.length; }
          yield stripMp4MetadataBoxes(movie, { inPlace: true });
        } else if (["free", "skip", "uuid", "udta", "meta"].includes(type)) {
          header.set([102, 114, 101, 101], 4);
          yield header;
          for await (const part of take(bodySize)) yield new Uint8Array(part.length);
        } else {
          yield header;
          yield* take(bodySize);
        }
        offset += size;
      }
      if (!["ftyp", "moov", "mdat"].every(type => seen.has(type))) throw invalid();
      if (cursor !== chunk.length || !(await reader.read()).done) throw invalid();
    } finally {
      await reader.cancel().catch(() => {});
      release();
    }
  }
  const iterator = cleaned();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch (error) { controller.error(error); }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
      await iterator.return(undefined);
      release();
    },
  });
}

export async function cleanPhoto(source: ReadableStream<Uint8Array>, length: number) {
  if (!Number.isSafeInteger(length) || length < 4 || length > MAX_MEDIA_BYTES) throw invalid();
  const bytes = new Uint8Array(length), reader = source.getReader();
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > length) throw invalid();
      bytes.set(value, offset); offset += value.length;
    }
    if (offset !== length) throw invalid();
    return stripImageMetadata(bytes, "image/jpeg");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function byteRange(header: string | null, length: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error("invalid_range");
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= length) throw new Error("invalid_range");
  return { start, end };
}

/** Apply ranges AFTER cleaning, so no request can bypass metadata removal. */
export function rangeStream(source: ReadableStream<Uint8Array>, range: { start: number; end: number }) {
  const reader = source.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { controller.close(); return; }
          const start = Math.max(0, range.start - offset), end = Math.min(value.length, range.end + 1 - offset);
          offset += value.length;
          if (end > start) controller.enqueue(value.subarray(start, end));
          if (offset > range.end) { await reader.cancel(); controller.close(); return; }
          if (end > start) return;
        }
      } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
    },
    async cancel() { await reader.cancel(); },
  });
}
