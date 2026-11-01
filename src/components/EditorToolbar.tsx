import { SNAP_OPTIONS } from '../music/time';
import { useViewStore } from '../state/clock';
import { useAppStore } from '../state/store';
import { MAX_ZOOM, MIN_ZOOM } from '../storage/preferences';
import { FitIcon, KeysIcon, LoopIcon, MetronomeIcon, VolumeIcon } from './Icons';
import { ToolSwitch } from './Transport';

function Toggle({ on, onClick, label, title, children }: { on: boolean; onClick: () => void; label: string; title: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`tool-toggle ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on} title={title}>
      {children}
      <span>{label}</span>
    </button>
  );
}

export function EditorToolbar() {
  const snap = useAppStore((state) => state.preferences.snap);
  const zoom = useAppStore((state) => state.preferences.zoom);
  const metronome = useAppStore((state) => state.preferences.metronomeEnabled);
  const keysOpen = useAppStore((state) => state.preferences.keysOpen);
  const loopOn = useAppStore((state) => state.project.loop.enabled);
  const toggleLoop = useAppStore((state) => state.toggleLoop);
  const setPanel = useAppStore((state) => state.setPanel);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const navigation = useViewStore((state) => state.navigation);
  const position = Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);

  return (
    <section className="editor-toolbar" aria-label="Editing tools">
      <ToolSwitch />
      <label className="toolbar-field" title="Grid notes land on">
        <span>Snap</span>
        <select
          value={snap}
          onChange={(event) => {
            setPreferences({ snap: Number(event.target.value) });
            event.currentTarget.blur();
          }}
          aria-label="Snap subdivision"
        >
          {SNAP_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span className="toolbar-divider" />
      <Toggle on={loopOn} onClick={toggleLoop} label="Loop" title="Loop a region (L)">
        <LoopIcon size={15} />
      </Toggle>
      <Toggle on={metronome} onClick={() => setPreferences({ metronomeEnabled: !metronome })} label="Click" title="Metronome (M)">
        <MetronomeIcon size={15} />
      </Toggle>

      <div className="toolbar-end">
        <div className="zoom-control" role="group" aria-label="Zoom">
          <button type="button" onClick={() => navigation?.zoomTo(zoom / 1.3)} aria-label="Zoom out" title="Zoom out (−)">−</button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={position}
            aria-label="Zoom level"
            onChange={(event) => navigation?.zoomTo(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** Number(event.target.value))}
            onPointerUp={(event) => event.currentTarget.blur()}
          />
          <button type="button" onClick={() => navigation?.zoomTo(zoom * 1.3)} aria-label="Zoom in" title="Zoom in (+)">+</button>
          <button type="button" className="zoom-fit" onClick={() => navigation?.zoomToFit()} aria-label="Zoom to fit" title="Fit the whole song (0)">
            <FitIcon size={15} />
          </button>
        </div>
        <span className="toolbar-divider" />
        <button type="button" className="icon-text-button" onClick={() => setPanel('tracks')} title="All tracks and mix levels">
          <VolumeIcon size={15} />
          <span>Mix</span>
        </button>
        <Toggle on={keysOpen} onClick={() => setPreferences({ keysOpen: !keysOpen })} label="Keys" title="Show the instrument keys (K)">
          <KeysIcon size={15} />
        </Toggle>
      </div>
    </section>
  );
}
