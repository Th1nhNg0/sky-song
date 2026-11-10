/**
 * Sound-pack persistence.
 *
 * Packs live only in this browser. The primary store is IndexedDB (large PCM data
 * does not fit reliably in localStorage). If IndexedDB is blocked, a session-only
 * in-memory store is used and the UI says the pack will not survive a reload. No
 * sample is uploaded. Personal packs shipped with a local build are fetched from
 * that same app origin before they are cached here.
 */

import type { SoundPack } from '../audio/soundPack';
import { openStoreDatabase } from './indexedDb';

export interface SoundPackStorage {
  readonly kind: 'indexeddb' | 'memory';
  /** False means the data is lost when the tab closes. */
  readonly persistent: boolean;
  save(pack: SoundPack): Promise<void>;
  load(id: string): Promise<SoundPack | null>;
  loadAll(): Promise<SoundPack[]>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'sky-music-studio-sounds';
const DB_VERSION = 1;
const STORE = 'packs';

function clonePack(pack: SoundPack): SoundPack {
  return {
    ...pack,
    samples: pack.samples.map((sample) => ({
      ...sample,
      channels: sample.channels.map((channel) => new Float32Array(channel)),
    })),
  };
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  dbPromise ??= openStoreDatabase(DB_NAME, DB_VERSION, STORE);
  return dbPromise;
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      if (!request) {
        resolve(fallback);
        return;
      }
      request.onsuccess = () => resolve(request.result ?? fallback);
      request.onerror = () => resolve(fallback);
      tx.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

class IndexedDbSoundPackStorage implements SoundPackStorage {
  readonly kind = 'indexeddb' as const;
  readonly persistent = true;

  async save(pack: SoundPack): Promise<void> {
    const db = await openDatabase();
    if (!db) throw new Error('IndexedDB is not available in this browser.');
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(clonePack(pack));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('Could not save the sound pack (browser storage error).'));
        tx.onabort = () => reject(new Error('Could not save the sound pack (transaction aborted).'));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not save the sound pack.'));
      }
    });
  }

  async load(id: string): Promise<SoundPack | null> {
    const db = await openDatabase();
    if (!db) return null;
    const result = await withStore<SoundPack | undefined>(db, 'readonly', (store) => store.get(id), undefined);
    return result ? clonePack(result) : null;
  }

  async loadAll(): Promise<SoundPack[]> {
    const db = await openDatabase();
    if (!db) return [];
    const result = await withStore<SoundPack[]>(db, 'readonly', (store) => store.getAll(), []);
    return result.map(clonePack);
  }

  async remove(id: string): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    await withStore(db, 'readwrite', (store) => store.delete(id), undefined);
  }
}

class MemorySoundPackStorage implements SoundPackStorage {
  readonly kind = 'memory' as const;
  readonly persistent = false;
  private packs = new Map<string, SoundPack>();

  async save(pack: SoundPack): Promise<void> {
    this.packs.set(pack.id, clonePack(pack));
  }

  async load(id: string): Promise<SoundPack | null> {
    const pack = this.packs.get(id);
    return pack ? clonePack(pack) : null;
  }

  async loadAll(): Promise<SoundPack[]> {
    return [...this.packs.values()].map(clonePack);
  }

  async remove(id: string): Promise<void> {
    this.packs.delete(id);
  }
}

let storage: SoundPackStorage | null = null;

export function getSoundPackStorage(): SoundPackStorage {
  if (storage) return storage;
  storage = typeof indexedDB === 'undefined' ? new MemorySoundPackStorage() : new IndexedDbSoundPackStorage();
  return storage;
}
