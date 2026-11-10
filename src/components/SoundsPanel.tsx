/**
 * Sounds panel — user-recorded sound packs.
 *
 * This component is intentionally self-contained (it renders inside Settings) so it
 * does not fight the rest of the UI. It only handles the user's own recordings:
 * files are decoded locally, stored in IndexedDB, never uploaded and never bundled.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { DEFAULT_INSTRUMENT_ID, getInstrument, hasInstrument, selectableInstruments } from '../music/instruments';
import { getKey, midiToSpelledName } from '../music/keys';
import { resolvePad } from '../music/pitch';
import { useAppStore } from '../state/store';
import { playback } from '../state/playback';
import { analyzeFile, analyzeRecording } from '../audio/slicing';
import {
  createSoundPack,
  packBytes,
  packFileName,
  packFromJson,
  packToJson,
  playbackRateFor,
  type PackSample,
  type SoundPack,
} from '../audio/soundPack';
import { nearestSample } from '../audio/soundPack';
import {
  ensureSoundPacksLoaded,
  getLoadedSoundPacks,
  getSoundBankVersion,
  refreshSoundPacks,
  soundSourceInfo,
  subscribeSoundBank,
} from '../audio/sampleBank';
import { createSampleVoice } from '../audio/sampleVoice';
import { getSoundPackStorage } from '../storage/soundPacks';
import { downloadBlob } from '../export/exporters';

interface DecodedRecording {
  fileName: string;
  sampleRate: number;
  channels: Float32Array[];
  durationSeconds: number;
}

function midiLabel(midi: number | null, keyIndex: number): string {
  if (midi === null) return '—';
  return midiToSpelledName(midi, getKey(keyIndex));
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function decodeRecordingFile(file: File): Promise<DecodedRecording> {
  if (file.size > 64 * 1024 * 1024) {
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

/** The active pack / synth state for one instrument, kept live via the bank. */
export function useSoundBankVersion(): number {
  return useSyncExternalStore(subscribeSoundBank, getSoundBankVersion, getSoundBankVersion);
}

/** The active pack / synth state for one instrument, kept live via the bank. */
function useSoundSource(instrumentId: string) {
  const version = useSoundBankVersion();
  return useMemo(() => {
    void version;
    return soundSourceInfo(instrumentId);
  }, [instrumentId, version]);
}

export function SoundsPanel() {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const notify = useAppStore((state) => state.notify);
  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0];
  const instruments = useMemo(() => selectableInstruments(), []);
  const [instrumentId, setInstrumentId] = useState(activeTrack?.instrumentId ?? DEFAULT_INSTRUMENT_ID);
  const instrument = useMemo(() => getInstrument(instrumentId), [instrumentId]);
  const pitched = instrument.renderingMode === 'pitched';
  const keyIndex = project.key;

  const [packs, setPacks] = useState<SoundPack[]>([]);
  const [mode, setMode] = useState<'scale' | 'files'>('scale');
  const [name, setName] = useState('');
  const [thresholdDb, setThresholdDb] = useState(-32);
  const [minGapMs, setMinGapMs] = useState(90);
  const [recording, setRecording] = useState<DecodedRecording | null>(null);
  const [draft, setDraft] = useState<PackSample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const storage = getSoundPackStorage();
  const source = useSoundSource(instrumentId);

  const loadPacks = useCallback(async () => {
    await ensureSoundPacksLoaded();
    setPacks([...getLoadedSoundPacks()]);
  }, []);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  useEffect(() => {
    setRecording(null);
    setDraft([]);
    setError(null);
  }, [instrumentId]);

  const instrumentPacks = useMemo(
    () =>
      packs
        .filter((pack) => pack.instrumentId === instrumentId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [packs, instrumentId],
  );

  const padMapping = useMemo(() => {
    if (!pitched) return [];
    return instrument.pads.map((pad) => {
      const resolved = resolvePad(instrument, keyIndex, pad.index);
      const nearest = instrumentPacks.find((pack) => pack.enabled) ?? null;
      const sample = nearest && resolved.midi !== null ? nearestSample(nearest, resolved.midi) : null;
      return {
        pad: pad.index,
        name: resolved.noteName ?? `Pad ${pad.index + 1}`,
        midi: resolved.midi,
        sampleMidi: sample?.midi ?? null,
        shift: sample && resolved.midi !== null && sample.midi !== null ? resolved.midi - sample.midi : null,
      };
    });
  }, [instrument, instrumentPacks, keyIndex, pitched]);

  const updateSample = (index: number, patch: Partial<PackSample>) => {
    setDraft((current) => current.map((sample, i) => (i === index ? { ...sample, ...patch } : sample)));
  };

  const shiftSample = (index: number, delta: number) => {
    setDraft((current) =>
      current.map((sample, i) => {
        if (i !== index) return sample;
        const base = sample.midi ?? sample.detectedMidi ?? 60;
        return { ...sample, midi: Math.min(127, Math.max(0, base + delta)) };
      }),
    );
  };

  const makeDraft = useCallback(
    (samples: PackSample[]): PackSample[] => {
      if (pitched) return samples;
      return samples.map((sample, index) => ({
        ...sample,
        midi: null,
        detectedMidi: null,
        padIndex: index < instrument.pads.length ? index : null,
      }));
    },
    [instrument.pads.length, pitched],
  );

  const runScaleAnalysis = useCallback(
    (audio: DecodedRecording) => {
      setBusy(true);
      setError(null);
      try {
        const analyzed = analyzeRecording(audio.channels, audio.sampleRate, {
          thresholdDb,
          minGapSeconds: minGapMs / 1000,
          detectPitches: pitched,
        });
        const samples = makeDraft(analyzed.map((slice) => slice.sample));
        setDraft(samples);
        setNotice(
          samples.length === 0
            ? 'No note onsets were detected. Lower the threshold or increase the gap.'
            : `${samples.length} slice${samples.length === 1 ? '' : 's'} detected from ${audio.fileName}. Check the notes below and correct any mistakes.`,
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not analyse the recording.');
      } finally {
        setBusy(false);
      }
    },
    [makeDraft, minGapMs, pitched, thresholdDb],
  );

  const handleScaleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const audio = await decodeRecordingFile(file);
      setRecording(audio);
      runScaleAnalysis(audio);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Could not read that audio file.');
    }
  };

  const handleNoteFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setDraft([]);
    setRecording(null);
    try {
      const samples: PackSample[] = [];
      for (const file of files) {
        const audio = await decodeRecordingFile(file);
        const { sample } = analyzeFile(audio.channels, audio.sampleRate, pitched);
        samples.push(sample);
      }
      setDraft(makeDraft(samples));
      setNotice(
        `${samples.length} file${samples.length === 1 ? '' : 's'} loaded. ${
          pitched ? 'Detected notes are shown; correct any octave errors.' : 'Assign each sample to a pad below.'
        }`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read those audio files.');
    } finally {
      setBusy(false);
    }
  };

  const previewSample = async (sample: PackSample) => {
    const ok = await playback.ensureAudio();
    const ctx = playback.engine.ctx;
    const graph = playback.engine.graph;
    if (!ok || !ctx || !graph) return;
    const start = ctx.currentTime + 0.02;
    const draftPack: SoundPack = {
      id: 'draft-preview',
      name: name || 'Draft preview',
      instrumentId,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: '',
      samples: draft,
    };
    createSampleVoice(
      ctx,
      {
        instrument,
        keyIndex,
        pad: sample.padIndex ?? 0,
        startTime: start,
        durationSeconds: 1.2,
        velocity: 0.85,
        destination: graph.previewBus.input,
      },
      { pack: draftPack, sample, targetMidi: sample.midi, playbackRate: 1 },
      { start, velocity: 0.85 },
    );
  };

  const previewPad = async (padIndex: number) => {
    if (!pitched) {
      const sample = draft.find((item) => item.padIndex === padIndex) ?? null;
      if (sample) await previewSample(sample);
      return;
    }
    const activePack = instrumentPacks.find((pack) => pack.enabled);
    if (!activePack) {
      notify('No active pack for this instrument yet — save one first.', 'warning');
      return;
    }
    const resolved = resolvePad(instrument, keyIndex, padIndex);
    if (resolved.midi === null) return;
    const sample = nearestSample(activePack, resolved.midi);
    if (!sample) return;
    const ok = await playback.ensureAudio();
    const ctx = playback.engine.ctx;
    const graph = playback.engine.graph;
    if (!ok || !ctx || !graph) return;
    const start = ctx.currentTime + 0.02;
    createSampleVoice(
      ctx,
      {
        instrument,
        keyIndex,
        pad: padIndex,
        startTime: start,
        durationSeconds: 0.9,
        velocity: 0.85,
        destination: graph.previewBus.input,
      },
      { pack: activePack, sample, targetMidi: resolved.midi, playbackRate: playbackRateFor(sample, resolved.midi) },
      { start, velocity: 0.85 },
    );
  };

  const saveDraft = async () => {
    if (draft.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const pack = createSoundPack({
        name: name.trim() || `${instrument.displayName} recording`,
        instrumentId,
        enabled: true,
        samples: draft,
      });
      // Only one pack is active per instrument: disable older ones first so the
      // engine's "newest enabled" choice is unambiguous.
      const existing = await storage.loadAll();
      for (const other of existing) {
        if (other.id !== pack.id && other.instrumentId === instrumentId && other.enabled) {
          await storage.save({ ...other, enabled: false });
        }
      }
      await storage.save(pack);
      await refreshSoundPacks();
      setPacks([...getLoadedSoundPacks()]);
      setNotice(
        storage.persistent
          ? `Saved “${pack.name}” for ${instrument.displayName}. ${pack.samples.length} sample${pack.samples.length === 1 ? '' : 's'}, stored only in this browser.`
          : `Saved “${pack.name}” for this session only — IndexedDB is unavailable, so it will be lost when the tab closes. Export a backup.`,
      );
      setDraft([]);
      setRecording(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the sound pack.');
    } finally {
      setBusy(false);
    }
  };

  const activatePack = async (pack: SoundPack, enabled: boolean) => {
    setBusy(true);
    try {
      const all = await storage.loadAll();
      for (const other of all) {
        if (other.id !== pack.id && other.instrumentId === pack.instrumentId && other.enabled) {
          await storage.save({ ...other, enabled: false });
        }
      }
      await storage.save({ ...pack, enabled, updatedAt: new Date().toISOString() });
      await refreshSoundPacks();
      setPacks([...getLoadedSoundPacks()]);
      notify(
        enabled ? `Using “${pack.name}” for ${instrument.displayName}.` : `Back to the synthesizer for ${instrument.displayName}.`,
        'success',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the pack.');
    } finally {
      setBusy(false);
    }
  };

  const deletePack = async (pack: SoundPack) => {
    if (!window.confirm(`Delete “${pack.name}”? The recordings will be removed from this browser.`)) return;
    setBusy(true);
    try {
      await storage.remove(pack.id);
      await refreshSoundPacks();
      setPacks([...getLoadedSoundPacks()]);
      setNotice(`Deleted “${pack.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the pack.');
    } finally {
      setBusy(false);
    }
  };

  const exportPack = (pack: SoundPack) => {
    downloadBlob(new Blob([packToJson(pack)], { type: 'application/json' }), packFileName(pack));
    notify('Pack backup download started.', 'success');
  };

  const importPack = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let last: SoundPack | null = null;
      for (const file of files) {
        const pack = packFromJson(await file.text());
        if (!hasInstrument(pack.instrumentId)) {
          throw new Error(`This pack targets an unknown instrument “${pack.instrumentId}”.`);
        }
        await storage.save(pack);
        last = pack;
      }
      await refreshSoundPacks();
      setPacks([...getLoadedSoundPacks()]);
      if (last) setInstrumentId(last.instrumentId);
      setNotice(
        files.length === 1 && last
          ? `Imported “${last.name}” for ${getInstrument(last.instrumentId).displayName}.`
          : `Imported ${files.length} sound packs.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import that pack file.');
    } finally {
      setBusy(false);
    }
  };

  const hasDraft = draft.length > 0;
  const activePack = source.kind === 'sample' ? source.pack : null;

  return (
    <section className="settings-card wide sounds-panel">
      <SoundsStyles />
      <div className="sounds-heading">
        <div>
          <h3>Instrument sounds &amp; sample packs</h3>
          <p className="settings-note">
            Use your own recordings or personal sound packs. Packs included with this local build load automatically;
            recordings you import here are stored in this browser.
          </p>
        </div>
        <label className="field sounds-instrument-select">
          <span className="field-label">Instrument</span>
          <select
            className="input select"
            value={instrumentId}
            onChange={(event) => setInstrumentId(event.target.value)}
          >
            {instruments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} · {item.category}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`sounds-source ${source.kind}`}>
        <div>
          <strong>
            {activePack
              ? `Recorded pack in use: ${activePack.name}`
              : 'Synthesizer in use — original approximation'}
          </strong>
          <p>
            {activePack
              ? `${activePack.samples.length} recorded note${activePack.samples.length === 1 ? '' : 's'}. Notes between recordings are pitch-shifted; notes that match a recording play at their original pitch.`
              : 'No sample pack is active for this instrument. This app’s synth is original code, not a recording of Sky, and is labelled as an approximation throughout.'}
          </p>
        </div>
        {activePack && (
          <button type="button" className="mini-btn" onClick={() => void activatePack(activePack, false)} disabled={busy}>
            Use synth instead
          </button>
        )}
      </div>

      {!storage.persistent && (
        <p className="sounds-warning">
          IndexedDB is unavailable, so packs cannot be stored permanently in this browser. Export a backup or enable
          site data.
        </p>
      )}

      <div className="sounds-block">
        <div className="sounds-block-head">
          <h4>Your packs for {instrument.displayName}</h4>
          <label className="mini-btn sounds-file-button">
            Import pack files
            <input type="file" accept="application/json,.json" multiple onChange={(event) => void importPack(event)} hidden />
          </label>
        </div>
        {instrumentPacks.length === 0 ? (
          <p className="fine-print">No packs yet. Record a scale from your own game, or load one file per note below.</p>
        ) : (
          <ul className="sounds-pack-list">
            {instrumentPacks.map((pack) => (
              <li key={pack.id} className="sounds-pack-row">
                <div className="sounds-pack-info">
                  <strong>{pack.name}</strong>
                  <span>
                    {pack.samples.length} sample{pack.samples.length === 1 ? '' : 's'} ·{' '}
                    {formatMb(packBytes(pack))} ·{' '}
                    {pack.samples.some((sample) => sample.midi !== null) ? 'pitched' : 'pad-mapped'} · updated{' '}
                    {new Date(pack.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <label className="toggle-row sounds-pack-active">
                  <input
                    type="checkbox"
                    checked={pack.enabled}
                    onChange={(event) => void activatePack(pack, event.target.checked)}
                    disabled={busy}
                  />
                  <span>{pack.enabled ? 'Active' : 'Use'}</span>
                </label>
                <button type="button" className="mini-btn" onClick={() => exportPack(pack)}>
                  Export
                </button>
                <button type="button" className="mini-btn danger" onClick={() => void deletePack(pack)} disabled={busy}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sounds-block">
        <h4>Create a pack from your own recording</h4>
        <p className="fine-print">
          Record with whatever you use for your own gameplay capture (OBS, QuickTime, your phone). Play one note at a
          time, leave a short gap, and keep the game’s background music quiet. WAV is the safest format; MP3/OGG work
          where the browser can decode them. Never upload or redistribute someone else’s recording.
        </p>

        <div className="sounds-mode-row">
          <label className="toggle-row">
            <input type="radio" name="sounds-mode" checked={mode === 'scale'} onChange={() => setMode('scale')} />
            <span>One recording of a played scale — auto-slice at onsets</span>
          </label>
          <label className="toggle-row">
            <input type="radio" name="sounds-mode" checked={mode === 'files'} onChange={() => setMode('files')} />
            <span>One audio file per note</span>
          </label>
        </div>

        {mode === 'scale' ? (
          <>
            <div className="sounds-controls">
              <label className="slider-field">
                <div>
                  <span>Onset threshold</span>
                  <strong>{thresholdDb} dB</strong>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={-18}
                  step={1}
                  value={thresholdDb}
                  onChange={(event) => setThresholdDb(Number(event.target.value))}
                />
              </label>
              <label className="slider-field">
                <div>
                  <span>Minimum note gap</span>
                  <strong>{minGapMs} ms</strong>
                </div>
                <input
                  type="range"
                  min={60}
                  max={400}
                  step={10}
                  value={minGapMs}
                  onChange={(event) => setMinGapMs(Number(event.target.value))}
                />
              </label>
              <label className="mini-btn sounds-file-button primary">
                {recording ? 'Choose another scale recording' : 'Load scale recording'}
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/ogg,audio/*"
                  onChange={(event) => void handleScaleFile(event)}
                  hidden
                />
              </label>
              {recording && (
                <button type="button" className="mini-btn" onClick={() => runScaleAnalysis(recording)} disabled={busy}>
                  Re-slice with these settings
                </button>
              )}
            </div>
            {recording && (
              <p className="fine-print">
                {recording.fileName} · {formatSeconds(recording.durationSeconds)} · {recording.sampleRate} Hz ·{' '}
                {recording.channels.length === 1 ? 'mono' : 'stereo'}
              </p>
            )}
          </>
        ) : (
          <div className="sounds-controls">
            <label className="mini-btn sounds-file-button primary">
              Load one file per note
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/ogg,audio/*"
                multiple
                onChange={(event) => void handleNoteFiles(event)}
                hidden
              />
            </label>
            <span className="fine-print">
              Pitch is detected automatically{instrument.supportsHold ? '; long held notes are fine' : ''}. You can
              correct every detected note.
            </span>
          </div>
        )}

        {!pitched && (
          <p className="fine-print">
            Percussion packs are mapped by pad rather than pitch. Unassigned pads keep using the original synthesized
            drum voice.
          </p>
        )}

        {busy && <p className="fine-print">Working…</p>}
        {error && (
          <p className="sounds-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="sounds-notice">
            {notice}
          </p>
        )}

        {hasDraft && (
          <div className="sounds-draft">
            <div className="sounds-block-head">
              <h4>{draft.length} prepared sample{draft.length === 1 ? '' : 's'}</h4>
              <span className="mini-chip">{pitched ? 'auto-detected MIDI, editable' : 'assign to pads'}</span>
            </div>
            <div className="sounds-rows">
              {draft.map((sample, index) => (
                <div className="sounds-row" key={sample.id}>
                  <span className="sounds-row-index">{index + 1}</span>
                  <span className="sounds-row-time">
                    {formatSeconds(sample.sourceStartSeconds)} · {formatSeconds(sample.durationSeconds)}
                  </span>
                  {pitched ? (
                    <div className="sounds-note">
                      <button type="button" className="mini-btn" onClick={() => shiftSample(index, -1)} aria-label="One semitone lower">
                        −
                      </button>
                      <input
                        type="number"
                        className="input sounds-midi-input"
                        min={0}
                        max={127}
                        value={sample.midi ?? ''}
                        onChange={(event) => {
                          const value = event.target.value === '' ? null : Number(event.target.value);
                          updateSample(index, { midi: value === null ? null : Math.min(127, Math.max(0, Math.round(value))) });
                        }}
                        aria-label={`Note for sample ${index + 1}`}
                      />
                      <span className="sounds-note-name">{midiLabel(sample.midi, keyIndex)}</span>
                      <button type="button" className="mini-btn" onClick={() => shiftSample(index, 1)} aria-label="One semitone higher">
                        +
                      </button>
                      <span className="mini-chip">
                        detected {midiLabel(sample.detectedMidi, keyIndex)} · {Math.round(sample.confidence * 100)}%
                      </span>
                    </div>
                  ) : (
                    <select
                      className="input select sounds-pad-select"
                      value={sample.padIndex ?? ''}
                      onChange={(event) =>
                        updateSample(index, {
                          padIndex: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                      aria-label={`Pad for sample ${index + 1}`}
                    >
                      <option value="">Unassigned</option>
                      {instrument.pads.map((pad) => (
                        <option key={pad.index} value={pad.index}>
                          Pad {pad.index + 1} · {pad.label ?? 'percussion'}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="mini-btn" onClick={() => void previewSample(sample)}>
                    ▶ Preview
                  </button>
                </div>
              ))}
            </div>

            <div className="sounds-save-row">
              <label className="field sounds-name-field">
                <span className="field-label">Pack name</span>
                <input
                  className="input"
                  value={name}
                  placeholder={`${instrument.displayName} recording`}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                onClick={() => void saveDraft()}
                disabled={busy || draft.length === 0}
              >
                Save pack in this browser
              </button>
            </div>
          </div>
        )}
      </div>

      {pitched && activePack && padMapping.length > 0 && (
        <div className="sounds-block">
          <h4>How the recorded notes map to {instrument.displayName} pads</h4>
          <p className="fine-print">
            Pads whose note matches a recording play it unchanged. Other pads pitch-shift the nearest recording. Large
            shifts (more than a few semitones) change the character; record more notes for a closer match.
          </p>
          <div className="sounds-map-grid">
            {padMapping.map((entry) => (
              <button
                key={entry.pad}
                type="button"
                className="sounds-map-cell"
                onClick={() => void previewPad(entry.pad)}
                title={`Pad ${entry.pad + 1}: ${entry.name}`}
              >
                <strong>{entry.name}</strong>
                <span>
                  {entry.sampleMidi === null
                    ? 'no sample'
                    : entry.shift === 0
                      ? 'exact recording'
                      : `shift ${entry.shift && entry.shift > 0 ? '+' : ''}${entry.shift} semitones`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sounds-block sounds-privacy">
        <h4>Privacy, storage and the project rule</h4>
        <ul>
          <li>Recordings are decoded locally and stored in this browser’s IndexedDB. Nothing is uploaded.</li>
          <li>A pack backup file (.skypack.json) contains your own audio; keep control of it before sharing.</li>
          <li>Project files do not contain pack audio — a collaborator needs their own copy.</li>
          <li>
            Personal packs in this project are included in its local builds. Keep control of those files and the builds
            that contain them; you are responsible for the rights to audio you share.
          </li>
        </ul>
      </div>
    </section>
  );
}

function SoundsStyles(): ReactNode {
  return (
    <style>{`
      .sounds-panel { gap: 14px; }
      .sounds-heading { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
      .sounds-heading h3 { margin-bottom: 6px; }
      .sounds-instrument-select { min-width: 260px; }
      .sounds-source { display: flex; gap: 14px; align-items: center; justify-content: space-between; border-radius: 12px; padding: 12px 14px; border: 1px solid var(--line, rgba(255,255,255,.14)); background: rgba(255,255,255,.035); }
      .sounds-source.sample { border-color: rgba(124, 208, 255, .4); background: rgba(124, 208, 255, .07); }
      .sounds-source p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; opacity: .82; max-width: 70ch; }
      .sounds-warning { border: 1px solid rgba(255, 190, 100, .4); background: rgba(255, 190, 100, .08); border-radius: 10px; padding: 10px 12px; font-size: 12px; margin: 0; }
      .sounds-block { border-top: 1px solid var(--line, rgba(255,255,255,.1)); padding-top: 14px; display: flex; flex-direction: column; gap: 10px; }
      .sounds-block h4 { margin: 0; font-size: 14px; }
      .sounds-block-head { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .sounds-block-head h4 { margin: 0; }
      .sounds-file-button { cursor: pointer; display: inline-flex; align-items: center; }
      .sounds-pack-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .sounds-pack-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border: 1px solid var(--line, rgba(255,255,255,.1)); border-radius: 10px; padding: 9px 11px; }
      .sounds-pack-info { display: flex; flex-direction: column; flex: 1 1 240px; min-width: 180px; }
      .sounds-pack-info span { font-size: 11px; opacity: .72; }
      .sounds-pack-active { white-space: nowrap; }
      .sounds-mode-row { display: flex; gap: 14px; flex-wrap: wrap; }
      .sounds-controls { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
      .sounds-controls .slider-field { flex: 1 1 180px; min-width: 160px; }
      .sounds-draft { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: 12px; padding: 12px; }
      .sounds-rows { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow: auto; }
      .sounds-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,.03); }
      .sounds-row-index { width: 22px; text-align: right; font-size: 11px; opacity: .6; }
      .sounds-row-time { font-size: 11px; opacity: .65; min-width: 118px; }
      .sounds-note { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; flex: 1 1 320px; }
      .sounds-midi-input { width: 62px; }
      .sounds-note-name { min-width: 42px; font-weight: 600; }
      .sounds-pad-select { flex: 1 1 200px; }
      .sounds-save-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
      .sounds-name-field { flex: 1 1 260px; }
      .sounds-map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
      .sounds-map-cell { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: 8px; padding: 6px 8px; background: rgba(255,255,255,.03); color: inherit; cursor: pointer; font: inherit; }
      .sounds-map-cell:hover { border-color: rgba(124, 208, 255, .5); }
      .sounds-map-cell span { font-size: 10px; opacity: .7; }
      .sounds-error { color: #ffb4b4; font-size: 12px; margin: 0; }
      .sounds-notice { color: #a8e6c1; font-size: 12px; margin: 0; }
      .sounds-privacy ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.55; opacity: .85; }
      .mini-btn.danger { color: #ffb4b4; }
      @media (max-width: 640px) {
        .sounds-instrument-select { min-width: 100%; }
        .sounds-row-time { min-width: 0; }
        .sounds-note { flex-basis: 100%; }
      }
    `}</style>
  );
}
