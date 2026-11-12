import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useAppStore } from './state/store';
import { handleShortcut } from './state/shortcuts';
import { TopBar } from './components/TopBar';
import { EditorToolbar } from './components/EditorToolbar';
import { KeyPanel, NoteFlash } from './components/KeyPanel';
import { StatusBar } from './components/StatusBar';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { FileDrop } from './components/FileDrop';
import { WelcomePanel } from './components/WelcomePanel';
import { CatalogPanel, type CatalogIntent } from './components/CatalogPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { SongbookPanel } from './components/SongbookPanel';
import { SheetPanel } from './components/SheetPanel';
import { ExportPanel } from './components/ExportPanel';
import { TimingPanel } from './components/TimingPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HelpPanel } from './components/HelpPanel';
import { AboutPanel } from './components/AboutPanel';
import { TracksPanel } from './components/TracksPanel';
import { lastOpenedProjectId } from './storage/library';
import { SparkIcon } from './components/Icons';

const closePanel = () => useAppStore.getState().setPanel(null);

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
  const keysOpen = useAppStore((state) => state.preferences.keysOpen);
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
      // Opening browser storage can finish after the user starts a song. Keep
      // their new project instead of restoring a save or reopening Welcome.
      if (useAppStore.getState().project !== state.project) return;
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
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <ErrorBoundary>
      <div className={`app-shell ${panel ? 'has-panel' : ''}`}>
        <TopBar onOpenCatalog={() => openCatalog({ mode: 'browse' })} />
        <EditorToolbar />
        <main className="studio-main">
          <Timeline onOpenCatalog={openCatalog} />
          {keysOpen && <KeyPanel />}
        </main>
        <StatusBar />
        <NoteFlash />

        {panel === 'catalog' && <CatalogPanel intent={catalogIntent} onClose={closePanel} />}
        {panel === 'library' && <LibraryPanel onClose={closePanel} />}
        {panel === 'songs' && <SongbookPanel onClose={closePanel} />}
        {panel === 'sheet' && <SheetPanel onClose={closePanel} />}
        {panel === 'export' && <ExportPanel onClose={closePanel} />}
        {panel === 'timing' && <TimingPanel onClose={closePanel} />}
        {panel === 'settings' && <SettingsPanel onClose={closePanel} />}
        {panel === 'help' && <HelpPanel onClose={closePanel} />}
        {panel === 'about' && <AboutPanel onClose={closePanel} />}
        {panel === 'tracks' && (
          <TracksPanel
            onOpenCatalog={openCatalog}
            onClose={closePanel}
          />
        )}

        {welcomeOpen && <WelcomePanel />}
        <FileDrop />
        <Toast />

        <span className="sr-only" aria-live="polite">
          {project.tracks.length} performer tracks loaded. Use the instrument catalog to add more.
        </span>
      </div>
    </ErrorBoundary>
  );
}
