/**
 * Focused little-endian fixed-width bincode 1.3.3 reader/writer for the fspec
 * wire types only. NOT general-purpose bincode.
 * Conventions: u8=1,u16=2,u32=4,u64=8,u128=16 bytes LE; String/Vec/bytes get
 * u64-LE length prefixes; enums use u32-LE variant indices; Option uses a
 * 1-byte tag (00=None,01=Some). Decoding tolerates trailing bytes.
 */
export class WireDecodeError extends Error {}

export class BincodeReader {
  private pos = 0;
  private readonly view: DataView;
  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(
      buf.buffer,
      buf.byteOffset,
      buf.byteLength,
    );
  }
  get offset(): number {
    return this.pos;
  }
  get remaining(): number {
    return this.buf.length - this.pos;
  }
  private need(n: number, what: string): void {
    if (this.pos + n > this.buf.length) {
      throw new WireDecodeError(
        `out-of-bounds read: need ${n} bytes for ${what} at offset ${this.pos} but only ${this.remaining} remain`,
      );
    }
  }
  u8(what = "u8"): number {
    this.need(1, what);
    return this.buf[this.pos++];
  }
  u16(what = "u16"): number {
    this.need(2, what);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(what = "u32"): number {
    this.need(4, what);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u64(what = "u64"): number {
    this.need(8, what);
    const lo = this.view.getUint32(this.pos, true);
    const hi = this.view.getUint32(this.pos + 4, true);
    const v = hi * 0x100000000 + lo;
    if (v >= 2 ** 53) {
      throw new WireDecodeError(
        `u64 value 0x${hi.toString(16)}${lo.toString(16).padStart(8, "0")} at offset ${this.pos} exceeds Number.MAX_SAFE_INTEGER`,
      );
    }
    this.pos += 8;
    return v;
  }
  u128(what = "u128"): Uint8Array {
    this.need(16, what);
    const v = this.buf.slice(this.pos, this.pos + 16);
    this.pos += 16;
    return v;
  }
  /** 8-byte IEEE-754 little-endian f64 (bincode writes f64 as raw LE bits). */
  f64(what = "f64"): number {
    this.need(8, what);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  /** 4-byte IEEE-754 little-endian f32. */
  f32(what = "f32"): number {
    this.need(4, what);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** 4-byte two's-complement i32. */
  i32(what = "i32"): number {
    this.need(4, what);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** 8-byte two's-complement i64 (values beyond 2^53 lose precision). */
  i64(what = "i64"): number {
    this.need(8, what);
    const lo = this.view.getUint32(this.pos, true);
    const hi = this.view.getInt32(this.pos + 4, true);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }
  bytes(n: number, what = "bytes"): Uint8Array {
    if (n < 0 || n > this.remaining) {
      throw new WireDecodeError(
        `length prefix ${n} exceeds remaining ${this.remaining} bytes at offset ${this.pos - 8} (${what})`,
      );
    }
    this.need(n, what);
    const v = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  /** Reads a u64-LE length prefix then that many bytes. */
  lengthPrefixedBytes(what = "Vec/bytes"): Uint8Array {
    const offset = this.pos;
    const n = this.u64(`length of ${what}`);
    if (n > this.remaining) {
      throw new WireDecodeError(
        `u64 length prefix ${n} exceeds remaining ${this.remaining} bytes at offset ${offset} (${what})`,
      );
    }
    this.need(n, what);
    const v = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  string(what = "String"): string {
    const bytes = this.lengthPrefixedBytes(what);
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return s;
  }
  vecLen(what = "Vec"): number {
    return this.u64(`length of ${what}`);
  }
  /** 1-byte Option tag: 00=None,01=Some. Returns true when Some. */
  optionTag(what = "Option"): boolean {
    const t = this.u8(`option tag of ${what}`);
    if (t === 0) return false;
    if (t === 1) return true;
    throw new WireDecodeError(`invalid option tag ${t} at offset ${this.pos - 1} (${what})`);
  }
  bool(what = "bool"): boolean {
    const v = this.u8(what);
    if (v !== 0 && v !== 1) {
      throw new WireDecodeError(`invalid bool byte ${v} at offset ${this.pos - 1}`);
    }
    return v === 1;
  }
  enumIndex(name: string): number {
    return this.u32(`enum variant index of ${name}`);
  }
  /** Skips an Option<T> by invoking the reader for T when Some. */
  skipOption<T>(read: (r: BincodeReader) => T): T | null {
    return this.optionTag() ? read(this) : null;
  }
}

export class BincodeWriter {
  private parts: Uint8Array[] = [];
  private size = 0;
  private push(b: Uint8Array | number[]): void {
    const u = b instanceof Uint8Array ? b : new Uint8Array(b as number[]);
    this.parts.push(u);
    this.size += u.length;
  }
  u8(v: number): this {
    this.push([v & 0xff]);
    return this;
  }
  u16(v: number): this {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v >>> 0, true);
    this.push(b);
    return this;
  }
  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
    return this;
  }
  u64(v: number): this {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`u64 writer: unsafe/negative value ${v}`);
    }
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setUint32(0, v >>> 0, true);
    view.setUint32(4, Math.floor(v / 0x100000000) >>> 0, true);
    this.push(b);
    return this;
  }
  bytes(u: Uint8Array): this {
    this.push(u);
    return this;
  }
  /** 8-byte IEEE-754 little-endian f64 (bincode writes raw LE bits). */
  f64(v: number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.push(b);
    return this;
  }
  /** 4-byte two's-complement i32. */
  i32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.push(b);
    return this;
  }
  /** 8-byte two's-complement i64. */
  i64(v: number): this {
    if (!Number.isSafeInteger(v)) {
      throw new RangeError(`i64 writer: unsafe value ${v}`);
    }
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setUint32(0, v >>> 0, true);
    view.setInt32(4, Math.floor(v / 0x100000000), true);
    this.push(b);
    return this;
  }
  /** u64-LE length prefix + raw bytes. */
  lengthPrefixedBytes(u: Uint8Array): this {
    this.u64(u.length);
    this.push(u);
    return this;
  }
  string(s: string): this {
    this.lengthPrefixedBytes(new TextEncoder().encode(s));
    return this;
  }
  vecLen(n: number): this {
    this.u64(n);
    return this;
  }
  optionTag(some: boolean): this {
    this.u8(some ? 1 : 0);
    return this;
  }
  bool(v: boolean): this {
    this.u8(v ? 1 : 0);
    return this;
  }
  enumIndex(v: number): this {
    this.u32(v);
    return this;
  }
  /** Writes Option<T>: tag then the value via the callback when Some. */
  option<T>(value: T | null, write: (w: BincodeWriter, v: T) => void): this {
    this.optionTag(value !== null);
    if (value !== null) write(this, value);
    return this;
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}
