import { version } from '../../package.json';
import { SparkIcon } from './Icons';
import { Modal } from './Modal';

const AUTHOR = 'Th1nhNg0';
const SKY_NAME = 'WeepingAngel89';
const AUTHOR_URL = 'https://github.com/Th1nhNg0';
const SOURCE_URL = 'https://github.com/Th1nhNg0/sky-song';

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About" eyebrow={`Sky Music Studio · version ${version}`} onClose={onClose} size="medium">
      <div className="about-hero">
        <span className="about-mark" aria-hidden="true">
          <SparkIcon size={26} />
        </span>
        <div>
          <h3>Sky Music Studio</h3>
          <p>
            A free music composer for <em>Sky: Children of the Light</em>. Write a song on the instruments the game
            really has, hear it with several players at once, then read it as a sheet and play it in the game.
          </p>
        </div>
      </div>

      <section className="about-card about-author">
        <p className="about-label">Made by</p>
        <h3>{AUTHOR}</h3>
        <p className="about-sky-name">
          <strong>{SKY_NAME}</strong> in Sky
        </p>
        <p>
          I built this because I wanted an easy way to arrange songs for Sky and share them with friends. It is free,
          has no ads or accounts, and your songs never leave your browser.
        </p>
        <div className="about-links">
          <a className="btn" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
            {AUTHOR} on GitHub
          </a>
          <a className="btn" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
          <a className="btn" href={`${SOURCE_URL}/issues`} target="_blank" rel="noopener noreferrer">
            Report a problem
          </a>
        </div>
      </section>

      <section className="about-card">
        <p className="about-label">Credits</p>
        <ul className="about-credits">
          <li>
            <strong>The game.</strong> <em>Sky: Children of the Light</em> is made by thatgamecompany. The instrument
            pictures and recorded instrument sounds come from the game and remain their work.
          </li>
          <li>
            <strong>The song library.</strong> Fan arrangements of well-known songs, made from community MIDI files on{' '}
            <Link href="https://bitmidi.com">BitMidi</Link> and fitted to Sky's keys. The songs belong to their
            writers and publishers.
          </li>
          <li>
            <strong>Built with.</strong> <Link href="https://react.dev">React</Link>,{' '}
            <Link href="https://github.com/pmndrs/zustand">Zustand</Link> and{' '}
            <Link href="https://github.com/Tonejs/Midi">Tone.js MIDI</Link>. The app's own code is open source under
            the MIT license.
          </li>
        </ul>
      </section>

      <p className="about-fine">
        Unofficial fan project. Sky: Children of the Light is a trademark of thatgamecompany. This app is not
        affiliated with or endorsed by them, and it does not change or control the game.
      </p>
    </Modal>
  );
}
