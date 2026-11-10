import type { Project } from '../music/types';
import { parseProjectJson } from '../music/validation';
import { newId, nowIso, projectToJson } from '../music/project';

const DB_NAME = 'sky-music-studio';
const DB_VERSION = 1;
const STORE = 'projects';
const LS_PREFIX = 'sky-music-studio:project:';
const LS_INDEX = 'sky-music-studio:project-index';
const LS_LAST = 'sky-music-studio:last-project';

export interface LibraryEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  trackCount: number;
  noteCount: number;
  bpm: number;
  key: number;
}

interface StoredProject extends LibraryEntry {
  data: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function entryFromProject(project: Project, data: string): StoredProject {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sizeBytes: data.length,
    trackCount: project.tracks.length,
    noteCount: project.tracks.reduce((sum, track) => sum + track.notes.length, 0),
    bpm: project.bpm,
    key: project.key,
    data,
  };
}

function readLocalIndex(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LibraryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalIndex(entries: LibraryEntry[]): void {
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(entries));
  } catch {
    // Quota errors are surfaced by the caller via save failure.
  }
}

async function saveWithIndexedDb(record: StoredProject): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function getAllWithIndexedDb(): Promise<StoredProject[] | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function toEntry(record: StoredProject): LibraryEntry {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sizeBytes: record.sizeBytes,
    trackCount: record.trackCount,
    noteCount: record.noteCount,
    bpm: record.bpm,
    key: record.key,
  };
}

export async function saveProjectToLibrary(project: Project): Promise<LibraryEntry> {
  const data = projectToJson(project);
  const record = entryFromProject(project, data);
  const saved = await saveWithIndexedDb(record);
  if (!saved) {
    try {
      localStorage.setItem(LS_PREFIX + project.id, data);
      const index = readLocalIndex().filter((entry) => entry.id !== project.id);
      index.push(toEntry(record));
      writeLocalIndex(index);
    } catch {
      throw new Error('Browser storage is full or unavailable. Export the project file to keep your work.');
    }
  }
  try {
    localStorage.setItem(LS_LAST, project.id);
  } catch {
    // Non-fatal.
  }
  return toEntry(record);
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const records = await getAllWithIndexedDb();
  const merged = new Map<string, LibraryEntry>();
  // The localStorage index can contain fallback saves even when IndexedDB is
  // available; merge both so a quota fallback never disappears from the library.
  for (const entry of readLocalIndex()) {
    try {
      if (localStorage.getItem(LS_PREFIX + entry.id) !== null) merged.set(entry.id, entry);
    } catch {
      // Storage unavailable; ignore this source.
    }
  }
  for (const record of records ?? []) {
    const entry = toEntry(record);
    const existing = merged.get(entry.id);
    if (!existing || existing.updatedAt <= entry.updatedAt) merged.set(entry.id, entry);
  }
  return [...merged.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function loadProjectFromLibrary(id: string): Promise<Project | null> {
  const records = await getAllWithIndexedDb();
  let data: string | null = null;
  if (records) {
    data = records.find((record) => record.id === id)?.data ?? null;
  }
  if (!data) {
    try {
      data = localStorage.getItem(LS_PREFIX + id);
    } catch {
      data = null;
    }
  }
  if (!data) return null;
  const parsed = parseProjectJson(data);
  return parsed.project;
}

export async function deleteProjectFromLibrary(id: string): Promise<void> {
  const db = await openDatabase();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  try {
    localStorage.removeItem(LS_PREFIX + id);
    writeLocalIndex(readLocalIndex().filter((entry) => entry.id !== id));
  } catch {
    // Non-fatal.
  }
}

export async function duplicateProjectInLibrary(id: string): Promise<Project | null> {
  const project = await loadProjectFromLibrary(id);
  if (!project) return null;
  const copy: Project = {
    ...structuredClone(project),
    id: newId('proj'),
    title: `${project.title} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveProjectToLibrary(copy);
  return copy;
}

export function lastOpenedProjectId(): string | null {
  try {
    return localStorage.getItem(LS_LAST);
  } catch {
    return null;
  }
}
