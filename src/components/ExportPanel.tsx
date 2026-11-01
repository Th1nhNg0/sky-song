import { useState } from 'react';
import { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { downloadProjectFile, estimateProjectJsonSize, exportMidiFile, exportSkyModFile, formatBytes, sanitizeFilename } from '../export/exporters';
import { SHARED_MEMORY_LIMIT_MS } from '../export/skymod';
import { DownloadIcon, HelpIcon, SparkIcon } from './Icons';

export function ExportPanel({ onClose }: { onClose: () => void }) {
  const project = useAppStore((state) => state.project);
  const notify = useAppStore((state) => state.notify);
  const [result, setResult] = useState<{ title: string; lines: string[] } | null>(null);

  const noteCount = project.tracks.reduce((sum, track) => sum + track.notes.length, 0);

  const exportProject = () => {
    downloadProjectFile(project);
    setResult({
      title: 'Project JSON downloaded',
      lines: [
        `File: ${sanitizeFilename(project.title)}.skymusic.json`,
        `Size: ${formatBytes(estimateProjectJsonSize(project))} · schema v1 · ${project.tracks.length} tracks · ${noteCount} notes`,
        'This is the complete native project: import it back to restore every track, pad, timing and preference stored in the project.',
      ],
    });
    notify('Project JSON downloaded.', 'success');
  };

  const exportMidi = () => {
    try {
      const info = exportMidiFile(project);
      setResult({
        title: 'Multitrack MIDI downloaded',
        lines: [
          `File: ${info.filename} · ${formatBytes(info.bytes)}`,
          `${info.trackCount} tracks · ${info.noteCount} notes · tempo ${project.bpm} BPM · key signature included`,
          'Percussion uses General MIDI channel 10. Pitched tracks use GM programs, so a DAW will render different timbres.',
        ],
      });
      notify('MIDI file downloaded.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.', 'error');
    }
  };

  const exportSkyMod = () => {
    try {
      const info = exportSkyModFile(project);
      const seconds = Math.ceil(info.durationMs / 1000);
      const lines = [
        `File: ${info.filename} · ${formatBytes(info.bytes)}`,
        `${info.trackCount} tracks · ${seconds} s including the count-in`,
        'Copy it to sheets\\mine in the Sky game folder, then open F5 → Music → My songs.',
      ];
      if (info.durationMs > SHARED_MEMORY_LIMIT_MS) {
        lines.push(`Longer than the ${SHARED_MEMORY_LIMIT_MS / 1000} s reported for one Shared Memory recording.`);
      }
      if (info.reducedPadTracks.length > 0) {
        lines.push(`Check these in game first; their keyboard layout is unverified: ${info.reducedPadTracks.join(', ')}.`);
      }
      setResult({ title: 'sky-mod song downloaded', lines });
      notify('sky-mod song downloaded.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.', 'error');
    }
  };

  return (
    <Modal title="Export" eyebrow="Project file · multitrack MIDI · sky-mod" onClose={onClose} size="large">
      <div className="export-panel">
        <div className="export-grid">
          <article className="export-card">
            <div className="export-icon"><SparkIcon size={18} /></div>
            <h3>Project JSON</h3>
            <p>Native versioned <code>.skymusic.json</code> with every track, pad, timing and project setting. Load it back from the Library.</p>
            <button type="button" className="btn primary" onClick={exportProject}>
              Export project
            </button>
          </article>
          <article className="export-card">
            <div className="export-icon"><DownloadIcon size={18} /></div>
            <h3>Multitrack MIDI</h3>
            <p>Type-1 file with tempo, meter, key signature, track names, GM programs and percussion on channel 10.</p>
            <button type="button" className="btn primary" onClick={exportMidi}>
              Export MIDI
            </button>
          </article>
          <article className="export-card">
            <div className="export-icon"><DownloadIcon size={18} /></div>
            <h3>sky-mod song</h3>
            <p>One <code>.skymod.json</code> with every track on a shared count-in, for recording layers in Shared Memory Duets.</p>
            <button type="button" className="btn primary" onClick={exportSkyMod}>
              Export for sky-mod
            </button>
          </article>
        </div>

        {result && (
          <div className="export-result">
            <div className="export-result-head">
              <DownloadIcon size={16} />
              <h3>{result.title}</h3>
            </div>
            <ul>
              {result.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        )}

        <div className="export-notes">
          <p><HelpIcon size={15} /> MIDI playback depends on your DAW’s soundfont/patch set. The exported pitches and timing are exact; timbres are not baked into MIDI.</p>
        </div>
      </div>
    </Modal>
  );
}
