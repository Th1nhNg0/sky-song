import { exportProjectToMidi } from './midi';
import { projectToJson } from '../music/project';
import type { Project } from '../music/types';

export function sanitizeFilename(title: string, fallback = 'sky-song'): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function estimateProjectJsonSize(project: Project): number {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

export function downloadProjectFile(project: Project): void {
  downloadText(projectToJson(project), `${sanitizeFilename(project.title)}.skymusic.json`, 'application/json');
}

export interface MidiExportInfo {
  filename: string;
  bytes: number;
  trackCount: number;
  noteCount: number;
}

export function exportMidiFile(project: Project): MidiExportInfo {
  const result = exportProjectToMidi(project);
  const midiCopy = new Uint8Array(result.bytes.length);
  midiCopy.set(result.bytes);
  downloadBlob(new Blob([midiCopy.buffer], { type: 'audio/midi' }), result.fileName);
  return {
    filename: result.fileName,
    bytes: result.bytes.length,
    trackCount: result.trackCount,
    noteCount: result.noteCount,
  };
}
