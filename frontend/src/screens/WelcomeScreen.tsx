/*
 * The front door.
 *
 * Everybody who has never been here sees this, and nobody who has ever been here sees it again —
 * `AuthStore.hasSession()` is what tells the two apart, and it is read before anything signs in.
 *
 * THAT ORDER IS THE POINT, not a detail of rendering. Until now the first request a visitor made
 * minted them a real `auth.users` row, whether they stayed or not: a link opened and closed, a
 * preview fetch, a bot. Accounts cost storage, they count against the project's anonymous sign-in
 * ceiling, and every one of them has to be swept after ninety days. Now the account is created by
 * somebody pressing a button, which is also the first moment there is any reason to believe a
 * person is on the other end.
 *
 * The words are the positioning the owner picked, and they are deliberately flat: this product's
 * readers left apps that told them how to feel, so the page states mechanics and lets them decide.
 * Nothing here asks anyone to see a glass as half full.
 */

import { MarkIcon } from '../components/icons';
import './WelcomeScreen.css';

export interface WelcomeScreenProps {
  /** Mint a session and go in. The only thing on this page that does anything. */
  onBegin: () => void;
}

export function WelcomeScreen({ onBegin }: WelcomeScreenProps) {
  return (
    <main className="welcome">
      {/*
       * The hero, and the only thing on this page that is decorated: one vessel, a little over
       * half full, poured once on arrival.
       *
       * Three elements rather than one because the liquid, the surface and the walls have to paint
       * in that order — the walls go last, so the glass sits in front of the water rather than
       * behind it — and one element carries only two pseudo-elements. It is the same three-layer
       * budget `GoalTile.css` keeps.
       *
       * Not `GoalWater`: the simulation pours when a level ARRIVES, and treats the first one as a
       * fact rather than an event, so a canvas here would draw a dead-still surface for the price
       * of a WebGL context. The CSS water pours because the level is a transform, and the pour is
       * the part worth watching.
       */}
      <div className="welcome__glass" aria-hidden="true">
        <span className="welcome__level" />
      </div>

      <div className="welcome__sheet">
        <p className="welcome__brand">
          <MarkIcon className="welcome__mark" />
          <span className="welcome__name">Half Full</span>
        </p>

        <h1 className="welcome__headline">A tracker with no way to tell you that you failed.</h1>

        <div className="welcome__points">
          <p>
            Every goal is a glass. Doing something puts water in it, and nothing takes water out.
          </p>
          <p>
            Habits carry a target and a minimum. Four runs a week is the target; one run keeps it
            going, and above the minimum there is nothing to fall short of.
          </p>
          <p>Come back after a month away and the glass is exactly where you left it.</p>
        </div>

        <button type="button" className="welcome__start" onClick={onBegin}>
          Start a board
        </button>

        <p className="welcome__note">
          Nothing to sign up for — no name, no email, no password. The board is kept in this browser
          and on our server, and 90 days without a visit deletes it.
        </p>
      </div>
    </main>
  );
}
