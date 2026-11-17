#!/usr/bin/env python3
"""Renders sound-pack notes through the installed game's own FMOD (render.ps1, from WSL) and
adds them to the Game packs in public/sound-packs.

  extend_packs.py jobs      write the render jobs (every 15-key pitched pack's event, the notes
                            above its top pad) to $SKY_RENDER_DIR (default C:\\tmp\\sky-render)
  extend_packs.py render    run render.ps1 on them (all.wav, and lg.wav for LightGuitarLocal)
  extend_packs.py cut       cut and check the notes: the top pad against the pack, the pitch
  extend_packs.py cut --write   and append them to every pack that plays the event

A pad sounds up to 11 semitones above its note in C, so the packs hold, besides the 15 pads,
the white keys D-B above the top one: in any song key a note is then a recording or a semitone
from one. Close the game first if it holds the files; the render needs no game running.
"""
import os, subprocess
R = os.environ.get('SKY_RENDER_DIR', '/mnt/c/tmp/sky-render')
WIN_R = 'C:\\' + R.split('/mnt/c/', 1)[1].replace('/', '\\') if R.startswith('/mnt/c/') else R
HERE = os.path.dirname(os.path.abspath(__file__))
GAME = '/mnt/c/Program Files (x86)/Steam/steamapps/common/Sky Children of the Light'
PACKS = os.path.join(HERE, '..', '..', 'public', 'sound-packs')
import base64, collections, datetime, glob, json, sys, wave
import numpy as np

SR, WIN, FADE, THR = 32000, 320, 320, 0.002
NEW = (26, 28, 29, 31, 33, 35)
PIANO = '99788ba5-4bc3-4392-926e-270b0ad58ae1'  # starts at once: the files' clock
LG = '9cf12b5a-6360-4022-ac3d-14243ffb6a6b'     # LightGuitarLocal: a random start delay


def read(name):
    w = wave.open(f'{R}/{name}.wav')
    assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (2, 2, SR)
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(np.int32) * 4
    log = [l.split() for l in open(f'{R}/{name}.log').read().splitlines() if l and not l.startswith('#')]
    return np.clip(x, -32768, 32767), log


def load_pack(inst):
    f = f'{PACKS}/Game-{inst}-{inst}.skypack.json'
    return f, json.load(open(f))


def decode(s):
    return np.stack([np.frombuffer(base64.b64decode(c), '<i2').astype(np.int32) for c in s['data']], 1)


def trim_lead_in(seg):
    """The guitars' quiet lead-in, trimmed as in the original packs: up to 0.19 s, until the
    0.02-0.2 s attack rms reaches 0.05, with a 5 ms fade at the new onset. A note that never
    gets there (a quieter high one) is trimmed to 5 ms before its attack, the first quarter of
    its peak, so neither a long lead-in nor the attack itself is kept or lost."""
    f = seg.astype(np.float64) / 32768
    t = next((t for t in range(0, int(0.19 * SR) + 1, 32)
              if np.sqrt((f[t + int(0.02 * SR):t + int(0.2 * SR)] ** 2).mean()) >= 0.05), None)
    if t is None:
        a = np.abs(f[:SR]).max(1)
        t = max(0, int(np.argmax(a >= 0.25 * a.max())) - 160)
    out = seg[t:].astype(np.float64)
    out[:160] *= np.linspace(0, 1, 160)[:, None]
    return np.round(out).astype(np.int32)


def cut(seg, cap):
    """(note, whether it ended on its own: decayed, or reached the cap)"""
    pk = np.abs(seg).max()
    env = np.abs(seg[:len(seg) // WIN * WIN]).max(1).reshape(-1, WIN).max(1)
    above = np.nonzero(env >= THR * pk)[0]
    end = min((above[-1] + 1) * WIN, cap, len(seg))
    whole = (above[-1] + 1) * WIN < len(seg) - WIN or end == cap
    out = seg[:end].astype(np.float64)
    out[-FADE:] *= np.linspace(1, 0, FADE)[:, None]
    return np.round(out).astype(np.int16), whole


def peaks(c, k=6):
    m = c.mean(1).astype(np.float64)[:int(0.5 * SR)]
    m = m * np.hanning(len(m))
    spec = np.abs(np.fft.rfft(m, 1 << 18)); fr = np.fft.rfftfreq(1 << 18, 1 / SR)
    out = []
    for _ in range(k):
        j = int(np.argmax(spec)); out.append(fr[j]); spec[max(0, j - 200):j + 200] = 0
    return [69 + 12 * np.log2(f / 440) for f in out if f > 0]


def make_jobs():
    EV = {}
    for line in open(f'{GAME}/data/assets/initial/Data/Audio/Fmod/fmodswitch/MasterBankGold.strings.bank', encoding='latin-1'):
        line = line.strip()
        if line.startswith('event:/sound/UI/Persistent/'):
            path, guid = line.split(', ')
            EV[path.rsplit('/', 1)[1]] = guid
    events = collections.OrderedDict()
    for f in sorted(glob.glob(f'{PACKS}/Game-*.skypack.json')):
        d = json.load(open(f))
        sm = [s for s in d['samples'] if s.get('midi') is not None]
        if len({s['midi'] for s in sm}) not in (15, 15 + len(NEW)): continue   # 15 keys (and those above)
        ev = d['notes'].split('FMOD event ')[1].split(',')[0].split(' ')[0]
        takes = max(collections.Counter(s['midi'] for s in sm).values())
        events.setdefault(ev, {'guid': EV[ev], 'packs': [], 'takes': takes})['packs'].append(d['instrumentId'])
    with open(f'{R}/jobs.txt', 'w') as out:
        for ev, e in events.items():
            if e['guid'] == LG: continue
            for p in (24,) + NEW:
                out.write(f"{e['guid']} {p} 6.3 4.0\n")
    with open(f'{R}/jobs-lg.txt', 'w') as out:   # a random start delay: held longer, 8 tries
        out.write(f"{PIANO} 12 3.0 4.0\n{PIANO} 12 3.0 4.0\n")
        for p in (24,) + NEW:
            for r in range(8): out.write(f"{LG} {p} 8.0 4.0\n")
    json.dump(events, open(f'{R}/events.json', 'w'), indent=1)
    print(len(events), 'events;', sum(1 for _ in open(f'{R}/jobs.txt')), 'notes')


def render():
    ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    script = subprocess.run(['wslpath', '-w', os.path.join(HERE, 'render.ps1')], capture_output=True, text=True, check=True).stdout.strip()
    game = subprocess.run(['wslpath', '-w', GAME], capture_output=True, text=True, check=True).stdout.strip()
    for name, jobs in (('all', 'jobs.txt'), ('lg', 'jobs-lg.txt')):
        subprocess.run([ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-GameDir', game,
                        '-Jobs', f'{WIN_R}\\{jobs}', '-OutWav', f'{WIN_R}\\{name}.wav', '-Log', f'{WIN_R}\\{name}.log'], check=True)


def cut_notes(write):
    events = json.load(open(f'{R}/events.json'))
    by_guid = {e['guid']: (name, e) for name, e in events.items()}
    renders = collections.defaultdict(list)   # (event, pitch) -> [note audio from its onset]
    for wav in ('all', 'lg'):
        x, log = read(wav)
        loud = np.abs(x).max(1) > 0
        def onset(i):
            at = int(log[i][3])
            nz = np.nonzero(loud[at:at + 8 * SR])[0]
            return at + int(nz[0]) if len(nz) else None
        lat = sorted(onset(i) - int(l[3]) for i, l in enumerate(log) if l[1] == PIANO and onset(i) is not None)
        latency = lat[len(lat) // 2]
        print(f'{wav}: latency {latency} samples ({latency / SR:.2f} s)')
        for i, (n, guid, pitch, at, pr) in enumerate(log):
            if (guid == LG) != (wav == 'lg'):
                continue
            name, e = by_guid[guid]
            on = onset(i)
            if on is None:
                print(f'  {name} {pitch}: silent'); continue
            stop = int(at) + latency + int(round((8.0 if guid == LG else 6.3) * SR))  # where the stop cuts it
            assert not loud[on - 4000:on].any(), (name, pitch, 'sound before the onset')
            renders[(name, int(float(pitch)))].append((x[on:stop], (on - int(at) - latency) / SR))

    report, new = [], {}
    for name, e in events.items():
        f, pack = load_pack(e['packs'][0])
        pitched = [s for s in pack['samples'] if s.get('midi') is not None]
        low = min(s['midi'] for s in pitched)
        cap = max(len(decode(s)) for s in pitched)
        takes_max = max(collections.Counter(s['midi'] for s in pitched).values())
        prep = (lambda s: trim_lead_in(s)) if name == 'LightGuitarLocal' else (lambda s: s)
        refs = [decode(s) for s in pitched if s['midi'] == low + 24]
        tops = [cut(prep(s), cap)[0] for s, _ in renders[(name, 24)]]
        match = max(max(float((np.abs(t[:min(len(r), len(t))].astype(np.int32) - r[:min(len(r), len(t))]) <= 1).mean())
                        for r in refs) for t in tops)
        delays = sorted({round(d, 2) for (_, pitch), rs in renders.items() if _ == name for _s, d in rs})
        line = (f"{name:17s} low {low:3d} takes {takes_max}  top pad: {len(tops[0]) / SR:.2f}s vs pack "
                f"{len(refs[0]) / SR:.2f}s, same samples {match:.3f}, delays {delays[:3]}{'..' if len(delays) > 3 else ''}")
        out = []
        for p in NEW:
            kept, dropped = [], 0
            for s, d in renders[(name, p)]:
                c, whole = cut(prep(s), cap)
                if not whole:
                    dropped += 1; continue
                if not any(np.abs(c[:SR].astype(np.int32) - k[:SR]).max() <= 8 for k in kept):
                    kept.append(c)
            if len(kept) > 1:   # a take far softer at its attack than the others makes a repeat drop out
                loud = [float(np.sqrt((k[int(0.02 * SR):int(0.2 * SR)].astype(np.float64) ** 2).mean())) for k in kept]
                kept = [k for k, l in zip(kept, loud) if l >= 0.8 * max(loud)]
            kept = kept[:max(1, min(3, takes_max))]
            want = low + p
            pk = peaks(kept[0])
            ok = any(abs(q - want) < 0.35 for q in pk)
            line += f" | {p}:{len(kept)}t{'' if ok else ' PITCH?'}{f' -{dropped}' if dropped else ''}"
            out.append((want, kept))
        new[name] = out
        report.append(line)
    print('\n'.join(report))

    if write:
        now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        for name, e in events.items():
            for inst in e['packs']:
                f, pack = load_pack(inst)
                wanted = {midi for midi, _ in new[name]}
                before = [s['data'] for s in pack['samples'] if s.get('midi') in wanted]
                pack['samples'] = [s for s in pack['samples'] if s.get('midi') not in wanted]   # a re-render replaces them
                multi = any(s['id'].count('-') > pack['id'].count('-') + 1 for s in pack['samples'])
                for k, (midi, takes) in enumerate(new[name]):
                    key = 15 + k
                    for t, c in enumerate(takes):
                        pack['samples'].append({
                            'id': f"{pack['id']}-{key}-{t}" if multi else f"{pack['id']}-{key}",
                            'midi': midi, 'padIndex': None, 'detectedMidi': midi, 'confidence': 1,
                            'sourceStartSeconds': 0, 'durationSeconds': len(c) / SR, 'gain': 1.5,
                            'sampleRate': SR, 'channels': 2,
                            'data': [base64.b64encode(np.ascontiguousarray(c[:, ch]).astype('<i2').tobytes()).decode()
                                     for ch in (0, 1)],
                        })
                if before == [s['data'] for s in pack['samples'] if s.get('midi') in wanted]:
                    print('unchanged', inst); continue
                pack['updatedAt'] = now
                pack['notes'] = pack['notes'].replace(
                    'one recording per key,',
                    'one recording per key and per key above the top pad that a higher song key reaches,')
                json.dump(pack, open(f, 'w'), separators=(',', ':'), ensure_ascii=False)
                print('wrote', inst, len(pack['samples']), 'samples')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'jobs': make_jobs()
    elif cmd == 'render': render()
    elif cmd == 'cut': cut_notes('--write' in sys.argv)
    else: sys.exit(__doc__)
