/** Decoding of the user's own recordings, before they are sliced into a sound pack. */

export interface DecodedRecording {
  fileName: string;
  sampleRate: number;
  channels: Float32Array[];
  durationSeconds: number;
}

const MAX_RECORDING_BYTES = 64 * 1024 * 1024;

export async function decodeRecordingFile(file: File): Promise<DecodedRecording> {
  if (file.size > MAX_RECORDING_BYTES) {
    throw new Error(`${file.name} is larger than 64 MB. Trim the recording first.`);
  }
  const AudioCtor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!AudioCtor) throw new Error('This browser cannot decode audio (no OfflineAudioContext).');
  const bytes = await file.arrayBuffer();
  const ctx = new AudioCtor(2, 1, 44100);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error(
      `${file.name} could not be decoded. Use a WAV file if this browser cannot decode MP3/OGG.`,
    );
  }
  const channelCount = Math.min(2, buffer.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    channels.push(new Float32Array(buffer.getChannelData(channel)));
  }
  return {
    fileName: file.name,
    sampleRate: buffer.sampleRate,
    channels,
    durationSeconds: buffer.duration,
  };
}
