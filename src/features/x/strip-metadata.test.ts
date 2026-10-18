import { describe, expect, it } from "vitest";
import { stripImageMetadata, stripVideoMetadata } from "./strip-metadata";
const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap(p => [...p]));
const u32 = (n: number) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n]);
const box = (type: string, body = new Uint8Array()) => concat(u32(body.length + 8), text(type), body);
const chunk = (type: string, body = new Uint8Array()) => concat(u32(body.length), text(type), body, u32(0));
const segment = (marker: number, body: Uint8Array) => concat(new Uint8Array([255, marker, 0, body.length + 2]), body);
const jpeg = concat(new Uint8Array([255,216]), segment(218, new Uint8Array()), new Uint8Array([10,255,0,20,255,208,30,255,217]));

describe("second-pass metadata removal", () => {
  it("drops every JPEG APP and comment, including between progressive scans and after EOI", () => {
    const payload = text("PRIVATE GPS XMP serial number");
    const contaminated = concat(jpeg.slice(0,2), ...Array.from({length:16},(_,i)=>segment(224+i,payload)), segment(254,payload), jpeg.slice(2,-2), segment(225,payload), segment(218,new Uint8Array()), new Uint8Array([20,255,217]),payload);
    const result = stripImageMetadata(contaminated,"image/jpeg");
    expect(new TextDecoder().decode(result)).not.toContain("PRIVATE");
    expect([...result.slice(-2)]).toEqual([255,217]);
    expect([...result]).toContain(30);
    expect(stripImageMetadata(result,"image/jpeg")).toEqual(result);
  });
  it("drops PNG EXIF, text, ICC, timestamp and trailing content while keeping transparency", () => {
    const head = new Uint8Array([137,80,78,71,13,10,26,10]);
    const core = [chunk("IHDR",new Uint8Array(13)),chunk("PLTE",new Uint8Array([1,2,3])),chunk("tRNS",new Uint8Array([0])),chunk("IDAT",new Uint8Array([1,2])),chunk("IEND")];
    const dirty = concat(head,core[0],...['eXIf','tEXt','iTXt','zTXt','iCCP','tIME'].map(k=>chunk(k,text("PRIVATE"))),...core.slice(1),text("PRIVATE"));
    expect(stripImageMetadata(dirty,"image/png")).toEqual(concat(head,...core));
  });
  it("rejects truncated, wrong-format and incomplete images", () => {
    for (const data of [jpeg.slice(0,-1),text("not a photo"),new Uint8Array([255,216,255,225,255,255])]) expect(()=>stripImageMetadata(data,"image/jpeg")).toThrow();
    expect(()=>stripImageMetadata(jpeg,"image/png")).toThrow();
  });
  it("zeros nested MP4 metadata and dates without moving video samples", () => {
    const header = new Uint8Array(100).fill(19);header[0]=0;
    const headerV1 = new Uint8Array(110).fill(21);headerV1[0]=1;
    const movie = box("moov",concat(box("mvhd",header),box("trak",concat(box("tkhd",headerV1),box("mdia",concat(box("mdhd",header),box("hdlr",concat(new Uint8Array(24),text("PRIVATE"))))))),box("udta",text("PRIVATE GPS")),box("uuid",text("PRIVATE ID"))));
    const input = concat(box("ftyp",text("isom")),movie,box("free",text("PRIVATE")),box("mdat",text("VIDEO AUDIO")));
    const result = stripVideoMetadata(input);
    expect(result.length).toBe(input.length);
    expect(new TextDecoder().decode(result)).not.toContain("PRIVATE");
    expect(result.slice(-19)).toEqual(input.slice(-19));
    const decoded = new TextDecoder().decode(result);
    for(const name of ['mvhd','tkhd','mdhd']) {
      const at=decoded.indexOf(name)+4;
      expect([...result.slice(at+4,at+4+(name==='tkhd'?16:8))].every(n=>n===0)).toBe(true);
    }
    expect(new TextDecoder().decode(input)).toContain("PRIVATE");
    expect(stripVideoMetadata(result)).toEqual(result);
  });
  it("clears the codec display name inside sample descriptions", () => {
    const visual = new Uint8Array(78); visual.set(text("PRIVATE ENCODER"),42);
    const input = concat(box("ftyp"),box("moov",box("stsd",concat(new Uint8Array(8),box("avc1",visual)))),box("mdat",text("PIXELS")));
    const result = stripVideoMetadata(input);
    expect(new TextDecoder().decode(result)).not.toContain("PRIVATE");
    expect(result.length).toBe(input.length);
  });
  it("refuses invalid MP4 lengths or missing media boxes", () => {
    expect(()=>stripVideoMetadata(box("moov"))).toThrow();
    expect(()=>stripVideoMetadata(concat(u32(1000),text("moov")))).toThrow();
  });
});
