import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { formatSongLength, loadSongbook, openSongbookSong, type SongbookEntry } from '../state/songbook';
import { getInstrument } from '../music/instruments';
import { TRACK_COLORS } from '../music/project';
import { Modal } from './Modal';
import { InstrumentIcon } from './InstrumentIcon';
import { MusicIcon, PlayIcon, UndoIcon } from './Icons';

type Pace = 'all' | 'slow' | 'medium' | 'fast';
type Order = 'title' | 'artist' | 'newest' | 'oldest' | 'shortest';

const PACES: { value: Pace; label: string; test: (bpm: number) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'slow', label: 'Slow', test: (bpm) => bpm < 90 },
  { value: 'medium', label: 'Medium', test: (bpm) => bpm >= 90 && bpm < 120 },
  { value: 'fast', label: 'Fast', test: (bpm) => bpm >= 120 },
];

const ORDERS: { value: Order; label: string; compare: (a: SongbookEntry, b: SongbookEntry) => number }[] = [
  { value: 'title', label: 'Title A–Z', compare: (a, b) => a.title.localeCompare(b.title) },
  { value: 'artist', label: 'Artist A–Z', compare: (a, b) => a.artist.localeCompare(b.artist) },
  { value: 'newest', label: 'Newest first', compare: (a, b) => b.year - a.year },
  { value: 'oldest', label: 'Oldest first', compare: (a, b) => a.year - b.year },
  { value: 'shortest', label: 'Shortest first', compare: (a, b) => a.seconds - b.seconds },
];

/** A steady colour per song, so a card looks the same every time the panel opens. */
function songColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TRACK_COLORS[hash % TRACK_COLORS.length];
}

function SongCard({
  song,
  saved,
  current,
  busy,
  onOpen,
}: {
  song: SongbookEntry;
  saved: boolean;
  current: boolean;
  busy: boolean;
  onOpen: (fresh: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article className={`song-card ${current ? 'is-current' : ''}`} style={{ '--song': songColor(song.id) } as React.CSSProperties}>
      <div className="song-skyline" aria-hidden="true">
        {song.shape.map((height, index) => (
          <span key={index} style={{ height: `${Math.max(6, height * 100)}%` }} />
        ))}
        <span className="song-length">{formatSongLength(song.seconds)}</span>
      </div>

      <div className="song-card-body">
        <h3>{song.title}</h3>
        <p className="song-artist">
          {song.artist} · {song.year}
        </p>

        <ul className="song-instruments" aria-label="Instruments">
          {song.instruments.map((instrumentId, index) => {
            const name = getInstrument(instrumentId).displayName;
            return (
              <li key={`${instrumentId}-${index}`} title={name}>
                <InstrumentIcon instrumentId={instrumentId} size={22} />
                <span className="sr-only">{name}</span>
              </li>
            );
          })}
        </ul>

        <div className="song-card-foot">
          <span className="song-meta">
            {song.bpm} BPM · {song.notes.toLocaleString()} notes
          </span>
          {confirming ? (
            <span className="confirm-row">
              <button
                type="button"
                className="mini-btn danger-solid"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onOpen(true);
                }}
              >
                Replace my copy
              </button>
              <button type="button" className="mini-btn" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <span className="song-card-actions">
              {saved && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                  title="Throw away your edits and load the original again"
                  aria-label={`Start ${song.title} over from the original`}
                >
                  <UndoIcon size={14} />
                </button>
              )}
              {current ? (
                <span className="library-open-badge">Open now</span>
              ) : (
                <button type="button" className="btn small primary" disabled={busy} onClick={() => onOpen(false)}>
                  <PlayIcon size={12} /> {busy ? 'Opening…' : saved ? 'Continue' : 'Open'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function SongbookPanel({ onClose }: { onClose: () => void }) {
  const library = useAppStore((state) => state.library);
  const currentId = useAppStore((state) => state.project.id);
  const refreshLibrary = useAppStore((state) => state.refreshLibrary);
  const [songs, setSongs] = useState<SongbookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [pace, setPace] = useState<Pace>('all');
  const [order, setOrder] = useState<Order>('title');
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    let cancelled = false;
    loadSongbook().then(
      (loaded) => {
        if (!cancelled) setSongs(loaded);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The song list could not be loaded.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const savedIds = useMemo(() => new Set(library.map((entry) => entry.id)), [library]);
  const results = useMemo(() => {
    if (!songs) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inPace = PACES.find((item) => item.value === pace)!.test;
    const compare = ORDERS.find((item) => item.value === order)!.compare;
    return songs
      .filter((song) => {
        if (!inPace(song.bpm)) return false;
        const text = `${song.title} ${song.artist} ${song.year} ${song.instruments
          .map((id) => getInstrument(id).displayName)
          .join(' ')}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => compare(a, b) || a.title.localeCompare(b.title));
  }, [songs, query, pace, order]);

  const open = async (song: SongbookEntry, fresh: boolean) => {
    setOpening(song.id);
    try {
      if (await openSongbookSong(song, { fresh })) onClose();
    } finally {
      setOpening(null);
    }
  };

  return (
    <Modal
      title="Song library"
      eyebrow={songs ? `${songs.length} ready-made songs · open one to play or edit it` : 'Ready-made songs'}
      onClose={onClose}
      size="wide"
    >
      <div className="songbook-filters">
        <input
          type="search"
          className="input search-input"
          placeholder="Search by song, artist or instrument"
          aria-label="Search songs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="catalog-parts" role="group" aria-label="Filter by tempo">
          {PACES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={pace === item.value ? 'is-on' : ''}
              aria-pressed={pace === item.value}
              onClick={() => setPace(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="select"
          aria-label="Sort songs"
          value={order}
          onChange={(event) => setOrder(event.target.value as Order)}
        >
          {ORDERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {!songs && !error && <p className="loading-line">Loading songs…</p>}

      {error && (
        <div className="empty-state">
          <MusicIcon size={22} />
          <p>{error}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      <div className="songbook-grid">
        {results.map((song) => (
          <SongCard
            key={song.id}
            song={song}
            saved={savedIds.has(song.id)}
            current={song.id === currentId}
            busy={opening === song.id}
            onOpen={(fresh) => void open(song, fresh)}
          />
        ))}
      </div>

      {songs && results.length === 0 && (
        <div className="empty-state">
          <MusicIcon size={22} />
          <p>No songs match.</p>
        </div>
      )}

      <div className="library-footnote">
        <span>
          Fan arrangements made from community MIDI files and fitted to Sky's keys, so some parts differ from the
          originals. An opened song is copied to My songs, where your edits are kept.
        </span>
      </div>
    </Modal>
  );
}
