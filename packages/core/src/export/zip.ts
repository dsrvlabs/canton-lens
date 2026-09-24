// A ZIP writer with one job: hold the parts of an `.xlsx`. It is here rather than taken from npm for
// the same reason the Daml-LF reader is — this package carries no runtime dependencies, and an
// archive of a handful of small XML files needs a fraction of what a general library does.
//
// What it does **not** do, deliberately: no compression (every entry is stored), no directories, no
// zip64, no encryption, no timestamps beyond the one the caller passes. A spreadsheet of a few
// thousand rows is a few hundred kilobytes of XML, and the second a compressor is added this file
// stops being something a reader can check against the specification in one sitting.
//
// Format: APPNOTE 6.3.3 — local header + data per entry, then a central directory, then the
// end-of-central-directory record.

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
// "Stored" — the bytes go in as they are. 8 would be deflate, which this file does not implement.
const METHOD_STORED = 0;
// The version needed to extract a stored entry. 2.0 is what every reader in use supports.
const VERSION = 20;

export type ZipEntry = { path: string; bytes: Uint8Array };

// CRC-32 (IEEE 802.3), the checksum every ZIP entry carries. The table is built once on first use
// rather than written out as 256 literals.
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: the index is masked to 0–255 and the table has 256 entries.
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP stores a date and time in two 16-bit fields in MS-DOS format, whose epoch is 1980 and whose
// seconds field counts in twos. A date before 1980 cannot be represented, so it is clamped rather
// than written as a number that would read as some other date.
function dosDateTime(at: Date): { date: number; time: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  };
}

// A growable little-endian byte writer. ZIP is little-endian throughout.
class Bytes {
  private buffer = new Uint8Array(1024);
  private length = 0;

  private room(n: number) {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  u16(value: number): void {
    this.room(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number): void {
    this.room(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  raw(bytes: Uint8Array): void {
    this.room(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  get size(): number {
    return this.length;
  }

  done(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

export function zip(entries: readonly ZipEntry[], at: Date): Uint8Array {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(at);
  const out = new Bytes();
  const directory: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    directory.push({ name, crc, size: entry.bytes.length, offset: out.size });
    out.u32(LOCAL_HEADER);
    out.u16(VERSION);
    // Bit 11 says the file name is UTF-8. Every path this writer produces is ASCII, but saying so
    // costs nothing and keeps a reader from guessing a code page if that ever changes.
    out.u16(1 << 11);
    out.u16(METHOD_STORED);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(entry.bytes.length); // compressed size — the same, since nothing is compressed
    out.u32(entry.bytes.length);
    out.u16(name.length);
    out.u16(0); // extra field length
    out.raw(name);
    out.raw(entry.bytes);
  }

  const directoryAt = out.size;
  for (const item of directory) {
    out.u32(CENTRAL_HEADER);
    out.u16(VERSION); // version made by
    out.u16(VERSION); // version needed
    out.u16(1 << 11);
    out.u16(METHOD_STORED);
    out.u16(time);
    out.u16(date);
    out.u32(item.crc);
    out.u32(item.size);
    out.u32(item.size);
    out.u16(item.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(item.offset);
    out.raw(item.name);
  }

  // **Measured before the record that reports it.** Reading `out.size` further down would count the
  // twelve bytes of the end-of-central-directory record written between here and there, and a
  // directory reported longer than it is makes a reader look for entries past its end.
  const directorySize = out.size - directoryAt;
  out.u32(END_OF_CENTRAL_DIRECTORY);
  out.u16(0); // this disk
  out.u16(0); // disk the directory starts on
  out.u16(directory.length);
  out.u16(directory.length);
  out.u32(directorySize);
  out.u32(directoryAt);
  out.u16(0); // comment length
  return out.done();
}
