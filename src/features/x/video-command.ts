// Decode/re-encode only picture and first audio stream. Do not copy original
// container tags, track tags, chapters, thumbnails, data or subtitle streams.
export const videoCleanCommand = (input: string, output: string) => [
  "-i",
  input,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-map_metadata",
  "-1",
  "-map_metadata:s",
  "-1",
  "-map_chapters",
  "-1",
  "-vf",
  "scale=if(gt(iw\\,ih)\\,min(1920\\,iw)\\,min(1080\\,iw)):if(gt(iw\\,ih)\\,min(1080\\,ih)\\,min(1920\\,ih)):flags=fast_bilinear:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,sidedata=delete",
  "-fps_mode",
  "vfr",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-tune",
  "zerolatency",
  "-crf",
  "23",
  "-pix_fmt",
  "yuv420p",
  "-bsf:v",
  "filter_units=remove_types=6",
  "-af",
  "asidedata=delete",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
  "-metadata",
  "encoder=",
  "-metadata:s:v",
  "encoder=",
  "-metadata:s:a",
  "encoder=",
  "-movflags",
  "+faststart",
  "-y",
  output,
];

// Stream-copy common MP4 H.264 inputs (and AAC audio when already mp4a) while
// stripping all container/track metadata and H.264 SEI NAL units.
export const videoRemuxCommand = (
  input: string,
  output: string,
  copyAudio = false,
) => [
  "-i",
  input,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-map_metadata",
  "-1",
  "-map_metadata:s",
  "-1",
  "-map_chapters",
  "-1",
  "-c:v",
  "copy",
  "-bsf:v",
  "filter_units=remove_types=6",
  ...(copyAudio
    ? ["-c:a", "copy"]
    : ["-af", "asidedata=delete", "-c:a", "aac", "-b:a", "128k", "-flags:a", "+bitexact"]),
  "-fflags",
  "+bitexact",
  "-metadata",
  "encoder=",
  "-metadata:s:v",
  "encoder=",
  "-metadata:s:a",
  "encoder=",
  "-movflags",
  "+faststart",
  "-y",
  output,
];

type Mp4Box = { type: string; body: number; end: number };

function readMp4Box(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  parentEnd: number,
): Mp4Box | null {
  if (start < 0 || start + 8 > parentEnd) return null;
  let size = view.getUint32(start);
  let header = 8;
  if (size === 1) {
    if (start + 16 > parentEnd) return null;
    const largeSize = view.getBigUint64(start + 8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(largeSize);
    header = 16;
  } else if (size === 0) {
    size = parentEnd - start;
  }
  if (size < header || size > parentEnd - start) return null;
  return {
    type: String.fromCharCode(...bytes.subarray(start + 4, start + 8)),
    body: start + header,
    end: start + size,
  };
}

function isTrailingZeroPadding(bytes: Uint8Array, start: number, end: number) {
  if (end - start > 64) return false;
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function readMp4Children(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  allowTrailingZeroes = true,
): Mp4Box[] | null {
  const boxes: Mp4Box[] = [];
  for (let position = start; position < end; ) {
    if (allowTrailingZeroes && isTrailingZeroPadding(bytes, position, end)) {
      break;
    }
    const box = readMp4Box(bytes, view, position, end);
    if (!box) return null;
    boxes.push(box);
    if (boxes.length > 10000) return null;
    position = box.end;
  }
  return boxes;
}

function hasIdentityTrackMatrix(bytes: Uint8Array, view: DataView, tkhd: Mp4Box) {
  const version = bytes[tkhd.body];
  if (version !== 0 && version !== 1) return false;
  const matrix = tkhd.body + (version === 0 ? 40 : 52);
  if (matrix + 36 > tkhd.end) return false;
  const expected = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  return expected.every((value, index) => view.getUint32(matrix + index * 4) === value);
}

function isEightBit420Sps(nal: Uint8Array) {
  if (nal.length < 4 || (nal[0] & 31) !== 7) return false;
  const rbsp: number[] = [];
  let zeroRun = 0;
  for (const value of nal.subarray(1)) {
    if (zeroRun >= 2 && value === 3) {
      zeroRun = 0;
      continue;
    }
    rbsp.push(value);
    zeroRun = value === 0 ? zeroRun + 1 : 0;
  }
  let bit = 0;
  const readBits = (count: number): number | null => {
    if (count < 0 || count > 32 || bit + count > rbsp.length * 8) return null;
    let value = 0;
    for (let i = 0; i < count; i++, bit++)
      value = value * 2 + ((rbsp[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const readUnsignedExpGolomb = () => {
    let leadingZeros = 0;
    let value: number | null;
    while ((value = readBits(1)) === 0) {
      if (++leadingZeros > 31) return null;
    }
    if (value === null) return null;
    if (!leadingZeros) return 0;
    const suffix = readBits(leadingZeros);
    return suffix === null ? null : 2 ** leadingZeros - 1 + suffix;
  };

  const profile = readBits(8);
  if (profile === null || readBits(8) === null || readBits(8) === null)
    return false;
  if (readUnsignedExpGolomb() === null) return false; // seq_parameter_set_id
  if ([66, 77, 88].includes(profile)) return true;
  if (![100, 110, 122, 244, 44].includes(profile)) return false;
  const chromaFormat = readUnsignedExpGolomb();
  if (chromaFormat !== 1) return false;
  const lumaDepth = readUnsignedExpGolomb();
  const chromaDepth = readUnsignedExpGolomb();
  return lumaDepth === 0 && chromaDepth === 0;
}

function hasEightBit420AvcC(
  bytes: Uint8Array,
  view: DataView,
  avcC: Mp4Box,
) {
  if (avcC.body + 6 > avcC.end || bytes[avcC.body] !== 1) return false;
  const sequenceCount = bytes[avcC.body + 5] & 31;
  if (!sequenceCount) return false;
  let position = avcC.body + 6;
  for (let i = 0; i < sequenceCount; i++) {
    if (position + 2 > avcC.end) return false;
    const length = view.getUint16(position);
    position += 2;
    if (!length || position + length > avcC.end) return false;
    if (!isEightBit420Sps(bytes.subarray(position, position + length)))
      return false;
    position += length;
  }
  return true;
}

export type FastRemuxInspection = {
  canRemuxVideo: boolean;
  canCopyAudio: boolean;
};

/** Inspects whether an MP4 can fast-remux H.264 video (0:v:0) and stream-copy AAC audio (0:a:0?). */
export function inspectFastRemuxMp4(input: Uint8Array): FastRemuxInspection {
  try {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const top = readMp4Children(input, view, 0, input.byteLength, true);
    if (
      !top ||
      !top.some((box) => box.type === "ftyp") ||
      !top.some((box) => box.type === "mdat")
    ) {
      return { canRemuxVideo: false, canCopyAudio: false };
    }
    const moovs = top.filter((box) => box.type === "moov");
    if (moovs.length !== 1) {
      return { canRemuxVideo: false, canCopyAudio: false };
    }
    const moovChildren = readMp4Children(
      input,
      view,
      moovs[0].body,
      moovs[0].end,
    );
    if (!moovChildren) return { canRemuxVideo: false, canCopyAudio: false };
    let checkedFirstVideo = false;
    let firstVideoValid = false;
    let checkedFirstAudio = false;
    let firstAudioMp4a = true;

    for (const track of moovChildren.filter((box) => box.type === "trak")) {
      const trackChildren = readMp4Children(input, view, track.body, track.end);
      const mdia = trackChildren?.find((box) => box.type === "mdia");
      const mdiaChildren = mdia
        ? readMp4Children(input, view, mdia.body, mdia.end)
        : null;
      const handler = mdiaChildren?.find((box) => box.type === "hdlr");
      if (!handler || handler.body + 12 > handler.end) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      const handlerType = String.fromCharCode(
        ...input.subarray(handler.body + 8, handler.body + 12),
      );
      const minf = mdiaChildren?.find((box) => box.type === "minf");
      const minfChildren = minf
        ? readMp4Children(input, view, minf.body, minf.end)
        : null;
      const stbl = minfChildren?.find((box) => box.type === "stbl");
      const stblChildren = stbl
        ? readMp4Children(input, view, stbl.body, stbl.end)
        : null;
      const stsd = stblChildren?.find((box) => box.type === "stsd");

      if (handlerType === "soun") {
        if (!checkedFirstAudio) {
          checkedFirstAudio = true;
          if (!stsd || stsd.body + 8 > stsd.end || view.getUint32(stsd.body + 4) !== 1) {
            firstAudioMp4a = false;
          } else {
            const audioEntry = readMp4Box(input, view, stsd.body + 8, stsd.end);
            if (!audioEntry || audioEntry.type !== "mp4a") {
              firstAudioMp4a = false;
            }
          }
        }
        continue;
      }

      if (handlerType !== "vide" || checkedFirstVideo) continue;
      checkedFirstVideo = true;
      const tkhd = trackChildren?.find((box) => box.type === "tkhd");
      if (!tkhd || !hasIdentityTrackMatrix(input, view, tkhd)) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      if (!stsd || stsd.body + 8 > stsd.end) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      if (view.getUint32(stsd.body + 4) !== 1) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      const entry = readMp4Box(input, view, stsd.body + 8, stsd.end);
      if (
        !entry ||
        (entry.end !== stsd.end && !isTrailingZeroPadding(input, entry.end, stsd.end)) ||
        (entry.type !== "avc1" && entry.type !== "avc3")
      ) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      if (entry.body + 78 > entry.end) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      const width = view.getUint16(entry.body + 24);
      const height = view.getUint16(entry.body + 26);
      if (!width || !height || width % 2 || height % 2) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      const entryChildren = readMp4Children(
        input,
        view,
        entry.body + 78,
        entry.end,
      );
      const avcC = entryChildren?.find((box) => box.type === "avcC");
      if (!avcC || !hasEightBit420AvcC(input, view, avcC)) {
        return { canRemuxVideo: false, canCopyAudio: false };
      }
      firstVideoValid = true;
    }

    return {
      canRemuxVideo: firstVideoValid,
      canCopyAudio: firstVideoValid && firstAudioMp4a,
    };
  } catch {
    return { canRemuxVideo: false, canCopyAudio: false };
  }
}

/** The fast path preserves common AVC video while deleting SEI and MP4 metadata. */
export function canFastRemuxH264(input: Uint8Array) {
  return inspectFastRemuxMp4(input).canRemuxVideo;
}
