import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useAppStore } from '../state/store';
import { SNAP_OPTIONS, TIME_SIGNATURES } from '../music/time';
import type { PanelKind } from '../state/store';
import {
  DownloadIcon,
  HelpIcon,
  LibraryIcon,
  LoopIcon,
  MetronomeIcon,
  MoreIcon,
  MusicIcon,
  SettingsIcon,
  VolumeIcon,
} from './Icons';

export function MoreMenu({ onOpenCatalog }: { onOpenCatalog: () => void }) {
  const setPanel = useAppStore((state) => state.setPanel);
  const preferences = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const project = useAppStore((state) => state.project);
  const toggleLoop = useAppStore((state) => state.toggleLoop);
  const setMeter = useAppStore((state) => state.setMeter);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.more-button')?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openPanel = (panel: Exclude<PanelKind, null>) => {
    setOpen(false);
    setPanel(panel);
  };

  const importMidiFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setOpen(false);
    if (!file) return;
    await useAppStore.getState().importMidi(await file.arrayBuffer(), file.name.replace(/\.midi?$/i, ''));
  };

  const openInstruments = () => {
    setOpen(false);
    onOpenCatalog();
  };

  return (
    <div className="more-wrap" ref={rootRef}>
      <button
        type="button"
        className={`btn top-icon more-button ${open ? 'is-on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More options"
        title="More options"
        data-testid="more-button"
      >
        <MoreIcon size={19} />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="More options" data-testid="more-menu">
          <div className="more-menu-links">
            <button type="button" role="menuitem" onClick={() => openPanel('library')} data-testid="menu-library">
              <LibraryIcon size={17} />
              <span>My songs</span>
            </button>
            <label className="more-menu-file" role="menuitem">
              <MusicIcon size={17} />
              <span>Import MIDI</span>
              <input
                type="file"
                accept=".mid,.midi,audio/midi"
                hidden
                data-testid="midi-import"
                onChange={(event) => void importMidiFile(event)}
              />
            </label>
            <button type="button" role="menuitem" onClick={openInstruments} data-testid="menu-instruments">
              <MusicIcon size={17} />
              <span>Instruments</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('tracks')} data-testid="menu-tracks">
              <VolumeIcon size={17} />
              <span>Tracks &amp; mix</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('export')} data-testid="menu-export">
              <DownloadIcon size={17} />
              <span>Export</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('settings')} data-testid="menu-settings">
              <SettingsIcon size={17} />
              <span>Settings &amp; sound</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('help')} data-testid="menu-help">
              <HelpIcon size={17} />
              <span>Help</span>
            </button>
          </div>

          <div className="more-menu-tools">
            <p className="menu-heading">Grid &amp; timing</p>
            <label className="menu-row">
              <span>
                <LoopIcon size={16} /> Loop
              </span>
              <input
                type="checkbox"
                checked={project.loop.enabled}
                onChange={toggleLoop}
                data-testid="loop-toggle"
              />
            </label>
            <label className="menu-row">
              <span>
                <MetronomeIcon size={16} /> Click
              </span>
              <input
                type="checkbox"
                checked={preferences.metronomeEnabled}
                onChange={(event) => setPreferences({ metronomeEnabled: event.target.checked })}
                data-testid="metronome-toggle"
              />
            </label>
            <label className="menu-row select-row">
              <span>Meter</span>
              <select
                value={project.timeSignature.join('/')}
                onChange={(event) => {
                  const [numerator, denominator] = event.target.value.split('/').map(Number);
                  setMeter([numerator, denominator]);
                }}
                aria-label="Time signature"
              >
                {TIME_SIGNATURES.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-row select-row">
              <span>Snap</span>
              <select
                value={preferences.snap}
                onChange={(event) => setPreferences({ snap: Number(event.target.value) })}
                aria-label="Snap subdivision"
                data-testid="snap-select"
              >
                {SNAP_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-row select-row">
              <span>Count-in</span>
              <select
                value={preferences.countInMeasures}
                onChange={(event) => setPreferences({ countInMeasures: Number(event.target.value) })}
                aria-label="Count-in measures"
              >
                {[0, 1, 2, 4].map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? 'Off' : `${value} bar${value === 1 ? '' : 's'}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="menu-row">
              <span>Zoom</span>
              <div className="zoom-buttons">
                <button
                  type="button"
                  onClick={() => setPreferences({ zoom: Math.max(20, Math.round(preferences.zoom - 8)) })}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setPreferences({ zoom: Math.min(200, Math.round(preferences.zoom + 8)) })}
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="more-menu-footer">Unofficial fan app</p>
        </div>
      )}
    </div>
  );
}
