import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useAppStore } from './state/store';
import { playback } from './state/playback';
import { TopBar } from './components/TopBar';
import { TrackStrip } from './components/TrackStrip';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { WelcomePanel } from './components/WelcomePanel';
import { CatalogPanel, type CatalogIntent } from './components/CatalogPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { ExportPanel } from './components/ExportPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HelpPanel } from './components/HelpPanel';
import { TracksPanel } from './components/TracksPanel';
import { lastOpenedProjectId } from './storage/library';
import { SparkIcon } from './components/Icons';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/** Dev only: first-time import of the songs in the owner's local folder. */
async function importLocalSongs(): Promise<boolean> {
  const response = await fetch('/__local-packs/songs.json');
  if (!response.ok) return false;
  const songs = (await response.json()) as { file: string; title: string; version: number }[];
  const fresh = songs.filter((song) => localStorage.getItem(`local-song:${song.file}`) !== String(song.version));
  if (fresh.length === 0) return false;
  const state = useAppStore.getState();
  for (const song of fresh.reverse()) {
    const file = await fetch(`/__local-packs/${song.file}`);
    if (file.ok && (await state.importMidi(await file.arrayBuffer(), song.title))) {
      localStorage.setItem(`local-song:${song.file}`, String(song.version));
    }
  }
  state.finishOnboarding();
  return true;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sky Music Studio crashed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <SparkIcon size={30} />
          <h1>The studio hit an unexpected note.</h1>
          <p>{this.state.error.message}</p>
          <p className="fine-print">Your last autosave should still be in the local library. Reload and reopen it.</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Reload studio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const panel = useAppStore((state) => state.panel);
  const welcomeOpen = useAppStore((state) => state.welcomeOpen);
  const saveState = useAppStore((state) => state.saveState);
  const project = useAppStore((state) => state.project);
  const [catalogIntent, setCatalogIntent] = useState<CatalogIntent>({ mode: 'browse' });
  const initialized = useRef(false);

  const openCatalog = (intent: CatalogIntent) => {
    setCatalogIntent(intent);
    useAppStore.getState().setPanel('catalog');
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const state = useAppStore.getState();
    (async () => {
      await state.initialize();
      if (import.meta.env.DEV && (await importLocalSongs())) return;
      const fresh = useAppStore.getState();
      const last = lastOpenedProjectId();
      if (last && fresh.library.some((entry) => entry.id === last)) {
        await fresh.openLibraryProject(last);
      }
      const after = useAppStore.getState();
      if (!after.preferences.onboardingDone || after.library.length === 0) {
        after.setWelcomeOpen(true);
      }
    })();
  }, []);

  useEffect(() => {
    document.title = `${project.title} — Sky Music Studio`;
  }, [project.title]);

  useEffect(() => {
    if (saveState !== 'unsaved') return;
    const timer = window.setTimeout(() => {
      void useAppStore.getState().saveNow();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [saveState, project]);

  useEffect(() => {
    if (saveState === 'saved' || saveState === 'saving') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      const state = useAppStore.getState();
      const key = event.key;
      const lower = key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      if (key === 'Escape') {
        if (state.panel) {
          state.setPanel(null);
          return;
        }
        if (state.welcomeOpen) {
          state.finishOnboarding();
          state.setWelcomeOpen(false);
        }
        return;
      }

      if (state.welcomeOpen) return;
      if (state.panel) return;

      if (mod) {
        if (lower === 'z') {
          event.preventDefault();
          if (event.shiftKey) state.redo();
          else state.undo();
          return;
        }
        if (lower === 'y') {
          event.preventDefault();
          state.redo();
          return;
        }
        if (lower === 'a') {
          event.preventDefault();
          state.selectAllNotes();
          return;
        }
        if (lower === 'c') {
          event.preventDefault();
          state.copySelection();
          return;
        }
        if (lower === 'x') {
          event.preventDefault();
          state.cutSelection();
          return;
        }
        if (lower === 'v') {
          event.preventDefault();
          state.pasteClipboard(playback.position());
          return;
        }
        if (lower === 'd') {
          event.preventDefault();
          state.duplicateSelection();
          return;
        }
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        state.deleteSelectedNotes();
        return;
      }

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (event.shiftKey) playback.stop();
        else void playback.togglePlay();
        return;
      }

      if (lower === 'l') {
        event.preventDefault();
        state.toggleLoop();
      } else if (lower === 'm') {
        event.preventDefault();
        state.setPreferences({ metronomeEnabled: !state.preferences.metronomeEnabled });
      } else if (key === '?') {
        state.setPanel('help');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ErrorBoundary>
      <div className={`app-shell ${panel ? 'has-panel' : ''}`}>
        <TopBar onOpenCatalog={() => openCatalog({ mode: 'browse' })} />
        <TrackStrip onOpenCatalog={openCatalog} />
        <main className="studio-main">
          <Timeline />
        </main>

        {panel === 'catalog' && <CatalogPanel intent={catalogIntent} onClose={() => useAppStore.getState().setPanel(null)} />}
        {panel === 'library' && <LibraryPanel onClose={() => useAppStore.getState().setPanel(null)} />}
        {panel === 'export' && <ExportPanel onClose={() => useAppStore.getState().setPanel(null)} />}
        {panel === 'settings' && <SettingsPanel onClose={() => useAppStore.getState().setPanel(null)} />}
        {panel === 'help' && <HelpPanel onClose={() => useAppStore.getState().setPanel(null)} />}
        {panel === 'tracks' && (
          <TracksPanel
            onOpenCatalog={openCatalog}
            onClose={() => useAppStore.getState().setPanel(null)}
          />
        )}

        {welcomeOpen && <WelcomePanel />}
        <Toast />

        <span className="sr-only" aria-live="polite">
          {project.tracks.length} performer tracks loaded. Use the instrument catalog to add more.
        </span>
      </div>
    </ErrorBoundary>
  );
}
