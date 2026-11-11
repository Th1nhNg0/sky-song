/**
 * Lossless packing for 16-bit audio: every sample comes back exactly as it went in.
 *
 * The shipped sound packs are several hundred megabytes as plain numbers. Most of a
 * recording is predictable from the few samples before it, so each sample is stored as
 * its difference from a prediction, and those small differences are written in as few
 * bits as they need (Rice coding). This is the method FLAC uses with its fixed
 * predictors, without the file format around it, so the same short decoder runs in
 * every browser and in Node.
 *
 * Layout, in blocks of `BLOCK` frames:
 *   stereo only: 1 bit, set when the block holds mid and side instead of left and right
 *   per channel: 3 bits for the predictor order, then per `PARTITION` frames
 *     5 bits for the Rice parameter and that many frames of coded differences
 * Predictions carry over block boundaries; before the first frame the signal is zero.
 */

const BLOCK = 4096;
const PARTITION = 256;
const MAX_ORDER = 4;
const MAX_RICE = 24;
/** Frames of earlier signal a prediction can look back on. */
const HISTORY = MAX_ORDER;

/** What the signal is expected to be at `at`, from the samples before it. */
function predict(signal: Int32Array, at: number, order: number): number {
  switch (order) {
    case 0: return 0;
    case 1: return signal[at - 1];
    case 2: return 2 * signal[at - 1] - signal[at - 2];
    case 3: return 3 * signal[at - 1] - 3 * signal[at - 2] + signal[at - 3];
    default: return 4 * signal[at - 1] - 6 * signal[at - 2] + 4 * signal[at - 3] - signal[at - 4];
  }
}

/**
 * The block's frames with `HISTORY` frames before them, as left and right or as mid and
 * side. Decoding recovers left and right from mid and side exactly, odd sums included.
 */
function blockSignal(channels: Int16Array[], start: number, length: number, midSide: boolean): Int32Array[] {
  const out = channels.map(() => new Int32Array(HISTORY + length));
  for (let i = -HISTORY; i < length; i++) {
    const frame = start + i;
    if (frame < 0) continue;
    if (midSide) {
      const left = channels[0][frame];
      const right = channels[1][frame];
      out[0][HISTORY + i] = (left + right) >> 1;
      out[1][HISTORY + i] = left - right;
    } else {
      for (let c = 0; c < channels.length; c++) out[c][HISTORY + i] = channels[c][frame];
    }
  }
  return out;
}

class BitWriter {
  private bytes = new Uint8Array(1 << 16);
  private length = 0;
  private held = 0;
  private heldBits = 0;

  write(value: number, bits: number): void {
    for (let bit = bits - 1; bit >= 0; bit--) {
      this.held = (this.held << 1) | ((value >>> bit) & 1);
      if (++this.heldBits === 8) this.flush();
    }
  }

  /** `count` one-bits and a zero. */
  unary(count: number): void {
    for (let i = 0; i < count; i++) this.write(1, 1);
    this.write(0, 1);
  }

  private flush(): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = this.held;
    this.held = 0;
    this.heldBits = 0;
  }

  finish(): Uint8Array {
    while (this.heldBits !== 0) this.write(0, 1);
    return this.bytes.slice(0, this.length);
  }
}

class BitReader {
  private position = 0;
  constructor(private bytes: Uint8Array) {}

  /** The next 25 or more bits at the top of a 32-bit word; past the end reads as zeros. */
  private peek(): number {
    const at = this.position >> 3;
    const bytes = this.bytes;
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) << (this.position & 7);
  }

  read(bits: number): number {
    if (bits === 0) return 0;
    const value = this.peek() >>> (32 - bits);
    this.position += bits;
    return value;
  }

  unary(): number {
    let count = 0;
    for (;;) {
      const ones = Math.clz32(~this.peek());
      if (ones < 25) {
        this.position += ones + 1;
        return count + ones;
      }
      count += 25;
      this.position += 25;
      if (this.position > this.bytes.length * 8) throw new Error('The packed audio ends too soon.');
    }
  }
}

const zigzag = (value: number) => (value << 1) ^ (value >> 31);
const unzigzag = (value: number) => (value >>> 1) ^ -(value & 1);

/** Bits a run of zigzagged differences takes with Rice parameter `rice`. */
function riceBits(values: Int32Array, from: number, to: number, rice: number): number {
  let bits = (to - from) * (rice + 1);
  for (let i = from; i < to; i++) bits += values[i] >>> rice;
  return bits;
}

/** The predictor order that leaves a channel's block the smallest differences, and their total size. */
function bestOrder(signal: Int32Array, length: number): { order: number; cost: number } {
  let best = { order: 0, cost: Infinity };
  for (let order = 0; order <= MAX_ORDER; order++) {
    let cost = 0;
    for (let i = HISTORY; i < HISTORY + length; i++) cost += Math.abs(signal[i] - predict(signal, i, order));
    if (cost < best.cost) best = { order, cost };
  }
  return best;
}

function writeChannel(out: BitWriter, signal: Int32Array, length: number, order: number): void {
  out.write(order, 3);
  const coded = new Int32Array(length);
  for (let i = 0; i < length; i++) coded[i] = zigzag(signal[HISTORY + i] - predict(signal, HISTORY + i, order));
  for (let from = 0; from < length; from += PARTITION) {
    const to = Math.min(length, from + PARTITION);
    let sum = 0;
    for (let i = from; i < to; i++) sum += coded[i];
    // Near the mean's size in bits is best; its neighbours are checked because the mean only estimates.
    const guess = Math.min(MAX_RICE, Math.max(0, Math.floor(Math.log2(sum / (to - from) + 1))));
    let rice = guess;
    let bits = riceBits(coded, from, to, guess);
    for (const candidate of [guess - 1, guess + 1]) {
      if (candidate < 0 || candidate > MAX_RICE) continue;
      const candidateBits = riceBits(coded, from, to, candidate);
      if (candidateBits < bits) {
        rice = candidate;
        bits = candidateBits;
      }
    }
    out.write(rice, 5);
    for (let i = from; i < to; i++) {
      out.unary(coded[i] >>> rice);
      out.write(coded[i], rice);
    }
  }
}

/** Packs one or two channels of equal length. `unpackAudio` gives them back unchanged. */
export function packAudio(channels: Int16Array[]): Uint8Array {
  if (channels.length < 1 || channels.length > 2) throw new Error('Audio must have one or two channels.');
  const frames = channels[0].length;
  if (channels.some((channel) => channel.length !== frames)) throw new Error('Channels must be the same length.');
  const out = new BitWriter();
  for (let start = 0; start < frames; start += BLOCK) {
    const length = Math.min(BLOCK, frames - start);
    let signal = blockSignal(channels, start, length, false);
    let orders = signal.map((channel) => bestOrder(channel, length));
    if (channels.length === 2) {
      const alternative = blockSignal(channels, start, length, true);
      const alternativeOrders = alternative.map((channel) => bestOrder(channel, length));
      const midSide = alternativeOrders[0].cost + alternativeOrders[1].cost < orders[0].cost + orders[1].cost;
      if (midSide) {
        signal = alternative;
        orders = alternativeOrders;
      }
      out.write(midSide ? 1 : 0, 1);
    }
    signal.forEach((channel, index) => writeChannel(out, channel, length, orders[index].order));
  }
  return out.finish();
}

/** Reverses `packAudio`. The channel count and length are not stored in the packed bytes. */
export function unpackAudio(bytes: Uint8Array, channelCount: number, frames: number): Int16Array[] {
  if (channelCount < 1 || channelCount > 2) throw new Error('Audio must have one or two channels.');
  const channels = Array.from({ length: channelCount }, () => new Int16Array(frames));
  const input = new BitReader(bytes);
  const signal = channels.map(() => new Int32Array(HISTORY + BLOCK));
  for (let start = 0; start < frames; start += BLOCK) {
    const length = Math.min(BLOCK, frames - start);
    const midSide = channelCount === 2 && input.read(1) === 1;
    // The frames before this block, in the form this block was predicted from.
    const history = blockSignal(channels, start, 0, midSide);
    for (let c = 0; c < channelCount; c++) {
      const channel = signal[c];
      channel.set(history[c]);
      const order = input.read(3);
      if (order > MAX_ORDER) throw new Error('The packed audio is damaged.');
      for (let from = 0; from < length; from += PARTITION) {
        const to = Math.min(length, from + PARTITION);
        const rice = input.read(5);
        if (rice > MAX_RICE) throw new Error('The packed audio is damaged.');
        for (let i = HISTORY + from; i < HISTORY + to; i++) {
          const coded = (input.unary() << rice) | input.read(rice);
          channel[i] = predict(channel, i, order) + unzigzag(coded);
        }
      }
    }
    for (let i = 0; i < length; i++) {
      if (midSide) {
        const side = signal[1][HISTORY + i];
        const sum = (signal[0][HISTORY + i] << 1) | (side & 1);
        channels[0][start + i] = (sum + side) >> 1;
        channels[1][start + i] = (sum - side) >> 1;
      } else {
        for (let c = 0; c < channelCount; c++) channels[c][start + i] = signal[c][HISTORY + i];
      }
    }
  }
  return channels;
}
