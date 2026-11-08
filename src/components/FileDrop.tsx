import { useEffect, useState } from 'react';
import { importSongFile, isSongFile } from '../state/importFile';
import { useAppStore } from '../state/store';
import { UploadIcon } from './Icons';

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Drop a MIDI file or a .skymusic.json project anywhere on the window to open it. */
export function FileDrop() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    // dragenter and dragleave fire for every child crossed, so count to know when the pointer really left.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setOver(true);
    };
    const overWindow = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file in place of the app.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const file = files.find(isSongFile) ?? files[0];
      if (!file) return;
      void importSongFile(file).then((ok) => {
        const state = useAppStore.getState();
        if (!ok) return;
        if (!state.preferences.onboardingDone) state.finishOnboarding();
        if (files.length > 1) state.notify(`Opened “${file.name}”. Drop one song at a time; the other ${files.length - 1} file${files.length === 2 ? ' was' : 's were'} skipped.`, 'info');
      });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overWindow);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overWindow);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!over) return null;
  return (
    <div className="file-drop" aria-hidden="true">
      <div className="file-drop-card">
        <UploadIcon size={30} />
        <strong>Drop to open the song</strong>
        <span>MIDI (.mid) or a Sky Music Studio project (.skymusic.json)</span>
      </div>
    </div>
  );
}
