/**
 * Sounds panel — user-recorded sound packs.
 *
 * It renders inside Settings and only handles the user's own recordings: files are
 * decoded locally, stored in IndexedDB, never uploaded and never bundled.
 */

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { DEFAULT_INSTRUMENT_ID, getInstrument, hasInstrument, selectableInstruments } from '../music/instruments';
import { resolvePad } from '../music/pitch';
import { useAppStore } from '../state/store';
import { playback } from '../state/playback';
import { useSoundBankVersion } from '../state/soundBank';
import { decodeRecordingFile, type DecodedRecording } from '../audio/recording';
import { analyzeFile, analyzeRecording } from '../audio/slicing';
import {
  createSoundPack,
  nearestSample,
  packFileName,
  packFromJson,
  packToJson,
  playbackRateFor,
  type PackSample,
  type SoundPack,
} from '../audio/soundPack';
import {
  ensureSoundPacksLoaded,
  getLoadedSoundPacks,
  refreshSoundPacks,
  saveExclusivePack,
  soundSourceInfo,
} from '../audio/sampleBank';
import { getSoundPackStorage } from '../storage/soundPacks';
import { downloadBlob } from '../export/exporters';
import { clamp, plural } from '../util';
import { formatSeconds, SoundDraftEditor } from './SoundDraftEditor';
import { SoundPackList, SoundPadMap, type PadMapEntry } from './SoundPackList';

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
  // The bank is the one copy of the packs; its version changes whenever they do.
  const bankVersion = useSoundBankVersion();

  useEffect(() => {
    void ensureSoundPacksLoaded();
  }, []);

  useEffect(() => {
    setRecording(null);
    setDraft([]);
    setError(null);
  }, [instrumentId]);

  const instrumentPacks = useMemo(() => {
    void bankVersion;
    return getLoadedSoundPacks()
      .filter((pack) => pack.instrumentId === instrumentId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [bankVersion, instrumentId]);
  const source = useMemo(() => {
    void bankVersion;
    return soundSourceInfo(instrumentId);
  }, [bankVersion, instrumentId]);
  const activePack = source.kind === 'sample' ? source.pack : null;

  const padMapping = useMemo<PadMapEntry[]>(() => {
    if (!pitched) return [];
    return instrument.pads.map((pad) => {
      const resolved = resolvePad(instrument, keyIndex, pad.index);
      const nearest = instrumentPacks.find((pack) => pack.enabled) ?? null;
      const sample = nearest && resolved.midi !== null ? nearestSample(nearest, resolved.midi) : null;
      return {
        pad: pad.index,
        name: resolved.noteName ?? `Pad ${pad.index + 1}`,
        sampleMidi: sample?.midi ?? null,
        shift: sample && resolved.midi !== null && sample.midi !== null ? resolved.midi - sample.midi : null,
      };
    });
  }, [instrument, instrumentPacks, keyIndex, pitched]);

  /** Runs a pack operation with the panel marked busy, and shows its error if it fails. */
  const withBusy = async (fallback: string, task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const updateSample = (index: number, patch: Partial<PackSample>) => {
    setDraft((current) => current.map((sample, i) => (i === index ? { ...sample, ...patch } : sample)));
  };

  const shiftSample = (index: number, delta: number) => {
    setDraft((current) =>
      current.map((sample, i) => {
        if (i !== index) return sample;
        const base = sample.midi ?? sample.detectedMidi ?? 60;
        return { ...sample, midi: clamp(base + delta, 0, 127) };
      }),
    );
  };

  /** Percussion has no pitch: its slices start out on the pads in the order they were played. */
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
            : `${samples.length} slice${plural(samples.length)} detected from ${audio.fileName}. Check the notes below and correct any mistakes.`,
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
    setError(null);
    setDraft([]);
    setRecording(null);
    await withBusy('Could not read those audio files.', async () => {
      const samples: PackSample[] = [];
      for (const file of files) {
        const audio = await decodeRecordingFile(file);
        const { sample } = analyzeFile(audio.channels, audio.sampleRate, pitched);
        samples.push(sample);
      }
      setDraft(makeDraft(samples));
      setNotice(
        `${samples.length} file${plural(samples.length)} loaded. ${
          pitched ? 'Detected notes are shown; correct any octave errors.' : 'Assign each sample to a pad below.'
        }`,
      );
    });
  };

  const previewSample = (sample: PackSample) => {
    const now = new Date().toISOString();
    const draftPack: SoundPack = {
      id: 'draft-preview',
      name: name || 'Draft preview',
      instrumentId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      notes: '',
      samples: draft,
    };
    void playback.previewRecording(instrument, sample.padIndex ?? 0, 1.2, {
      pack: draftPack,
      sample,
      targetMidi: sample.midi,
      playbackRate: 1,
    });
  };

  const previewPad = (padIndex: number) => {
    const enabledPack = instrumentPacks.find((pack) => pack.enabled);
    if (!enabledPack) {
      notify('No active pack for this instrument yet — save one first.', 'warning');
      return;
    }
    const resolved = resolvePad(instrument, keyIndex, padIndex);
    if (resolved.midi === null) return;
    const sample = nearestSample(enabledPack, resolved.midi);
    if (!sample) return;
    void playback.previewRecording(instrument, padIndex, 0.9, {
      pack: enabledPack,
      sample,
      targetMidi: resolved.midi,
      playbackRate: playbackRateFor(sample, resolved.midi),
    });
  };

  const saveDraft = async () => {
    if (draft.length === 0) return;
    setError(null);
    await withBusy('Could not save the sound pack.', async () => {
      const pack = createSoundPack({
        name: name.trim() || `${instrument.displayName} recording`,
        instrumentId,
        enabled: true,
        samples: draft,
      });
      await saveExclusivePack(pack);
      setNotice(
        storage.persistent
          ? `Saved “${pack.name}” for ${instrument.displayName}. ${pack.samples.length} sample${plural(pack.samples.length)}, stored only in this browser.`
          : `Saved “${pack.name}” for this session only — IndexedDB is unavailable, so it will be lost when the tab closes. Export a backup.`,
      );
      setDraft([]);
      setRecording(null);
    });
  };

  const activatePack = (pack: SoundPack, enabled: boolean) =>
    withBusy('Could not update the pack.', async () => {
      await saveExclusivePack({ ...pack, enabled, updatedAt: new Date().toISOString() });
      notify(
        enabled ? `Using “${pack.name}” for ${instrument.displayName}.` : `Back to the synthesizer for ${instrument.displayName}.`,
        'success',
      );
    });

  const deletePack = async (pack: SoundPack) => {
    if (!window.confirm(`Delete “${pack.name}”? The recordings will be removed from this browser.`)) return;
    await withBusy('Could not delete the pack.', async () => {
      await storage.remove(pack.id);
      await refreshSoundPacks();
      setNotice(`Deleted “${pack.name}”.`);
    });
  };

  const exportPack = (pack: SoundPack) => {
    downloadBlob(new Blob([packToJson(pack)], { type: 'application/json' }), packFileName(pack));
    notify('Pack backup download started.', 'success');
  };

  const importPack = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setError(null);
    await withBusy('Could not import that pack file.', async () => {
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
      if (last) setInstrumentId(last.instrumentId);
      setNotice(
        files.length === 1 && last
          ? `Imported “${last.name}” for ${getInstrument(last.instrumentId).displayName}.`
          : `Imported ${files.length} sound packs.`,
      );
    });
  };

  return (
    <section className="settings-card wide sounds-panel">
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
              ? `${activePack.samples.length} recorded note${plural(activePack.samples.length)}. Notes between recordings are pitch-shifted; notes that match a recording play at their original pitch.`
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

      <SoundPackList
        packs={instrumentPacks}
        instrumentName={instrument.displayName}
        busy={busy}
        onImport={(event) => void importPack(event)}
        onActivate={(pack, enabled) => void activatePack(pack, enabled)}
        onExport={exportPack}
        onDelete={(pack) => void deletePack(pack)}
      />

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

        {draft.length > 0 && (
          <SoundDraftEditor
            draft={draft}
            instrument={instrument}
            keyIndex={keyIndex}
            name={name}
            busy={busy}
            onRename={setName}
            onUpdate={updateSample}
            onShift={shiftSample}
            onPreview={previewSample}
            onSave={() => void saveDraft()}
          />
        )}
      </div>

      {pitched && activePack && padMapping.length > 0 && (
        <SoundPadMap instrumentName={instrument.displayName} entries={padMapping} onPreview={previewPad} />
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
