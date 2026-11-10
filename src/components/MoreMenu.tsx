import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import type { PanelKind } from '../state/store';
import {
  HelpIcon,
  InfoIcon,
  MoreIcon,
  MusicIcon,
  SettingsIcon,
  VolumeIcon,
} from './Icons';

export function MoreMenu({ onOpenCatalog }: { onOpenCatalog: () => void }) {
  const setPanel = useAppStore((state) => state.setPanel);
  const preferences = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
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
      >
        <MoreIcon size={19} />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="More options">
          <div className="more-menu-links">
            <button type="button" role="menuitem" onClick={openInstruments}>
              <MusicIcon size={17} />
              <span>Instruments</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('tracks')}>
              <VolumeIcon size={17} />
              <span>Tracks &amp; mix</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('settings')}>
              <SettingsIcon size={17} />
              <span>Settings &amp; sound</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('help')}>
              <HelpIcon size={17} />
              <span>Help</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openPanel('about')}>
              <InfoIcon size={17} />
              <span>About</span>
            </button>
          </div>

          <div className="more-menu-tools">
            <p className="menu-heading">Playback &amp; editing</p>
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
            <label className="menu-row">
              <span>Hear notes while editing</span>
              <input
                type="checkbox"
                checked={preferences.notePreview}
                onChange={(event) => setPreferences({ notePreview: event.target.checked })}
              />
            </label>
          </div>

          <p className="more-menu-footer">Made by Th1nhNg0 (WeepingAngel89) · Unofficial fan app</p>
        </div>
      )}
    </div>
  );
}
