export const PCM_SAMPLE_RATE = 16000
export const PCM_CHANNELS = 1
export const PCM_BITS_PER_SAMPLE = 16

export const WAV_HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

/**
 * Encode 16-bit mono PCM as a canonical RIFF/WAVE file.
 * The M1 pipeline only ever produces 16 kHz mono PCM16 (ADR-0003).
 */
export function encodeWav(pcm: Int16Array, sampleRate: number = PCM_SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, PCM_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), true)
  view.setUint16(32, PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), true)
  view.setUint16(34, PCM_BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(WAV_HEADER_BYTES + i * 2, pcm[i], true)
  }

  return new Uint8Array(buffer)
}

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataOffset: number
  dataBytes: number
  durationMs: number
}

function asciiAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4))
}

/**
 * Minimal chunk-aware reader used by the smoke/benchmark scripts and tests.
 * macOS `afconvert` inserts a `FLLR` chunk, so the data payload is not always
 * at byte 44; callers must use `dataOffset`.
 */
export function readWavInfo(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength < WAV_HEADER_BYTES) throw new Error('WAV too short')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (asciiAt(bytes, 0) !== 'RIFF' || asciiAt(bytes, 8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }

  let offset = 12
  let channels: number | undefined
  let sampleRate: number | undefined
  let bitsPerSample: number | undefined
  let dataOffset = -1
  let dataBytes = 0

  while (offset + 8 <= bytes.byteLength) {
    const id = asciiAt(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const payload = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || payload + 16 > bytes.byteLength) throw new Error('Invalid fmt chunk')
      channels = view.getUint16(payload + 2, true)
      sampleRate = view.getUint32(payload + 4, true)
      bitsPerSample = view.getUint16(payload + 14, true)
    } else if (id === 'data') {
      dataOffset = payload
      dataBytes = Math.min(size, bytes.byteLength - payload)
      break
    }
    offset = payload + size + (size % 2)
  }

  if (
    dataOffset < 0 ||
    channels === undefined ||
    sampleRate === undefined ||
    bitsPerSample === undefined
  ) {
    throw new Error('WAV is missing fmt or data chunks')
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataOffset,
    dataBytes,
    durationMs: (dataBytes / (channels * (bitsPerSample / 8) * sampleRate)) * 1000
  }
}
