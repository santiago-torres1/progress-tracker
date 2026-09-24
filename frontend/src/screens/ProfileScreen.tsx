/*
 * The profile page: who this session is, what it has done, and the two settings that matter.
 *
 * WHAT IT IS NOT. There is no trophy, badge, streak, level or score on this page, and none may be
 * added — "adding trophies or whatever just gamifies it, which is not the point." The four numbers
 * are plain counts the API already holds, stated once, never compared with anyone else and never
 * compared with this account's own past. Nothing on the page can go down in a way it calls a
 * failure, because nothing on the page grades anything.
 *
 * There is also no sign-in here, and nothing that hints at one: this release has no way to convert
 * an anonymous account, so an invitation to "secure your data" would be an invitation to nowhere.
 * The expiry line says what is true — 90 days from the last visit — and stops.
 *
 * WHY IT READS `/api/session` AGAIN. The gate already fetched the profile, and the counts in it are
 * as old as this page load: a visitor who ticked six things off and then opened their profile would
 * be told the number they had before. So this page asks once for itself, which is also why it has a
 * loading and a failure state of its own. A save then goes the other way — the PATCH answers with
 * the recomputed profile, and `applyProfile` hands it to the rest of the app without a refetch,
 * exactly as a completed goal refills its tile from its own response.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PersonIcon } from '../components/icons';
import { fetchSession, updateSession } from '../lib/api';
import { expiryNote, failureCopy } from '../lib/copy';
import {
  accountDate,
  memberSinceLine,
  savedNote,
  timeZoneChoices,
  weekStartChoices,
  weekStartLabel,
  zoneLabel,
} from '../lib/profile';
import { useAppSession } from '../lib/sessionContext';
import { useApiResource } from '../lib/useApiResource';
import { StatusNote } from './StatusNote';
import type { SessionProfile, UpdateSessionRequest } from '../types/api';
import './ProfileScreen.css';

const SECTION_LABEL = 'Profile';

/** Which row is open for editing. A union rather than two booleans: only one can be. */
type EditableField = 'timeZone' | 'weekStart';

/** What the page says after a save. Failure copy comes from `failureCopy`, never from upstream. */
export type ProfileNotice =
  { kind: 'saved'; text: string } | { kind: 'failed'; title: string; body: string };

/**
 * The page's outer region, rendered in all three states.
 *
 * It is a wrapper rather than something each state renders for itself so that the `<section>` is the
 * SAME element while the read is in flight, once it lands, and if it does not: a region that is torn
 * down and rebuilt takes its name with it, and anything holding a reference to it — a screen
 * reader's position, a test — is left pointing at a node that is no longer in the document.
 */
function ProfilePage({ children }: { children: ReactNode }) {
  return (
    <section className="profile" aria-label={SECTION_LABEL}>
      {children}
    </section>
  );
}

// --- the page ---------------------------------------------------------------------------------

export function ProfileScreen() {
  const { call, applyProfile } = useAppSession();

  const load = useCallback(
    (signal: AbortSignal) => call((options) => fetchSession(options), signal),
    [call],
  );
  const session = useApiResource(load);

  const [saved, setSaved] = useState<SessionProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ProfileNotice | null>(null);

  async function handleSave(patch: UpdateSessionRequest): Promise<boolean> {
    setBusy(true);
    setNotice(null);

    const result = await call((options) => updateSession(patch, options));
    setBusy(false);

    if (result.kind !== 'ok') {
      const copy = failureCopy(result);
      setNotice({ kind: 'failed', title: copy.title, body: copy.body });
      return false;
    }

    const profile = result.data.session;
    setSaved(profile);
    // The rest of the app counts days in this zone and starts weeks on this day. It must not have
    // to refetch to find out, and must not be left on the old one.
    applyProfile(profile);
    setNotice({ kind: 'saved', text: savedNote(patch) });
    return true;
  }

  /** What goes inside the region: one of the three states, never a fourth. */
  function body(): ReactNode {
    if (session.state.kind === 'loading') {
      return <StatusNote state="loading" title="Reading your profile…" />;
    }

    if (session.state.kind !== 'ok') {
      const copy = failureCopy(session.state);
      return (
        <StatusNote state="failure" title={copy.title} body={copy.body} onRetry={session.reload} />
      );
    }

    return (
      <ProfileFacts
        profile={saved ?? session.state.data.session}
        busy={busy}
        notice={notice}
        onSave={handleSave}
      />
    );
  }

  return <ProfilePage>{body()}</ProfilePage>;
}

// --- the page, without the reads ---------------------------------------------------------------

export interface ProfileViewProps {
  profile: SessionProfile;
  /** A save in flight. The controls go inert rather than vanishing, so nothing jumps. */
  busy: boolean;
  notice: ProfileNotice | null;
  /** Resolves true when the change was saved — which is what closes the open row. */
  onSave: (patch: UpdateSessionRequest) => Promise<boolean>;
  /** The clock, for naming the zone's current offset. Pinned by the tests and the gallery. */
  now?: Date;
  /** This browser's own zone, which the picker must always be able to offer. */
  browserTimeZone?: string;
}

function resolveBrowserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** The page as the gallery mounts it: everything except the reads. */
export function ProfileView(props: ProfileViewProps) {
  return (
    <ProfilePage>
      <ProfileFacts {...props} />
    </ProfilePage>
  );
}

function ProfileFacts({
  profile,
  busy,
  notice,
  onSave,
  now = new Date(),
  browserTimeZone,
}: ProfileViewProps) {
  const [editing, setEditing] = useState<EditableField | null>(null);

  const browserZone = browserTimeZone ?? resolveBrowserZone();
  const memberSince = accountDate(profile.createdAt, profile.timeZone);
  const expiry = expiryNote(profile.expiresAt);

  async function save(patch: UpdateSessionRequest): Promise<void> {
    const done = await onSave(patch);
    if (done) setEditing(null);
  }

  return (
    <>
      <header className="profile__head">
        <h2 className="profile__headline">This browser.</h2>
        <p className="profile__detail">
          {profile.isAnonymous
            ? 'You are signed in anonymously. There is no name here because nobody asked you for one.'
            : 'Your account, and the two settings that decide when your days begin and end.'}
        </p>
      </header>

      <div className="card profile__card">
        <div className="profile__id">
          <span className="bead bead--lg" aria-hidden="true">
            <PersonIcon className="bead__glyph" />
          </span>
          <div>
            <h3 className="profile__who">
              {profile.isAnonymous ? 'Anonymous account' : 'Your account'}
            </h3>
            <p className="profile__since">
              {memberSinceLine(profile.createdAt, profile.timeZone, profile.stats.daysSinceStart)}
            </p>
          </div>
        </div>

        {/*
          Four counts, in a list rather than a definition list, because the number is read before
          its name and a `<dl>` would put the name first or need CSS to reverse it. Nothing here is
          a total to beat.
        */}
        <ul className="counts profile__counts">
          <Count n={profile.stats.glassesFilled} label="glasses filled" />
          <Count n={profile.stats.goalsOnBoard} label="goals on the board" />
          <Count n={profile.stats.completionsRecorded} label="things ticked off" />
          <Count n={profile.stats.measurementsRecorded} label="check-ins recorded" />
        </ul>

        <dl className="rows profile__rows">
          <div className="rows__row">
            <dt>Member since</dt>
            <dd className="rows__value">{memberSince ?? 'Your first visit'}</dd>
          </div>

          <SettingRow
            label="Time zone"
            changeLabel="Change time zone"
            fieldId="profile-time-zone"
            value={zoneLabel(profile.timeZone, now)}
            open={editing === 'timeZone'}
            busy={busy}
            current={profile.timeZone}
            options={timeZoneChoices(profile.timeZone, browserZone).map((zone) => ({
              value: zone,
              label: zone,
            }))}
            onOpen={() => {
              setEditing('timeZone');
            }}
            onCancel={() => {
              setEditing(null);
            }}
            onSave={(value) => {
              void save({ timeZone: value });
            }}
          />

          <SettingRow
            label="Week starts on"
            changeLabel="Change week start"
            fieldId="profile-week-start"
            value={weekStartLabel(profile.weekStartsOn)}
            open={editing === 'weekStart'}
            busy={busy}
            current={String(profile.weekStartsOn)}
            options={weekStartChoices().map((choice) => ({
              value: String(choice.value),
              label: choice.label,
            }))}
            onOpen={() => {
              setEditing('weekStart');
            }}
            onCancel={() => {
              setEditing(null);
            }}
            onSave={(value) => {
              void save({ weekStartsOn: Number(value) });
            }}
          />

          <div className="rows__row">
            <dt>Session</dt>
            <dd className="rows__value">
              {profile.expiresAt === null
                ? 'Kept for as long as you want it'
                : 'Ends 90 days after your last visit'}
            </dd>
          </div>
        </dl>

        {notice !== null && (
          <div className="profile__notice">
            {notice.kind === 'saved' ? (
              <p className="profile__saved" role="status">
                {notice.text}
              </p>
            ) : (
              <StatusNote state="failure" variant="line" title={notice.title} body={notice.body} />
            )}
          </div>
        )}
      </div>

      {expiry !== null && <p className="footnote profile__expiry">{expiry}</p>}
    </>
  );
}

// --- pieces -----------------------------------------------------------------------------------

function Count({ n, label }: { n: number; label: string }) {
  return (
    <li className="count">
      <b className="count__n">{n}</b>
      <span className="count__label">{label}</span>
    </li>
  );
}

interface Choice {
  value: string;
  label: string;
}

interface SettingRowProps {
  /** The row's name, and the visible label of its field. */
  label: string;
  /**
   * What this row's Change button is called.
   *
   * Two rows means two buttons reading "Change", which is one name for two jobs — so the name says
   * which. It is an `aria-label` rather than hidden text beside the word because the accessible name
   * of adjacent inline elements is concatenated without a space by some implementations, and
   * "Changetime zone" is not a name anybody can say.
   */
  changeLabel: string;
  fieldId: string;
  /** The setting as it stands, in words. */
  value: string;
  open: boolean;
  busy: boolean;
  /** The option the picker opens on: the value currently held. */
  current: string;
  options: readonly Choice[];
  onOpen: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}

/**
 * One editable fact: its name, its value, and either a Change button or the picker.
 *
 * The control sits in a `<dd>` of its own rather than beside the value, which keeps the markup a
 * legal definition list — `<dl>` accepts `<div>` wrappers holding `<dt>` and `<dd>`, and nothing
 * else.
 */
function SettingRow({
  label,
  changeLabel,
  fieldId,
  value,
  open,
  busy,
  current,
  options,
  onOpen,
  onCancel,
  onSave,
}: SettingRowProps) {
  return (
    <div className="rows__row">
      <dt>{label}</dt>
      <dd className="rows__value">{value}</dd>
      <dd className="rows__control">
        {open ? (
          <ChoiceForm
            label={label}
            fieldId={fieldId}
            current={current}
            options={options}
            busy={busy}
            onCancel={onCancel}
            onSave={onSave}
          />
        ) : (
          <button
            className="rows__edit"
            type="button"
            aria-label={changeLabel}
            aria-expanded={false}
            onClick={onOpen}
          >
            Change
          </button>
        )}
      </dd>
    </div>
  );
}

interface ChoiceFormProps {
  label: string;
  fieldId: string;
  current: string;
  options: readonly Choice[];
  busy: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
}

/**
 * The picker, mounted only while a row is open — so opening it is what resets it.
 *
 * It takes focus on mount. A "Change" button that replaces itself with a field and leaves focus on
 * a button that is no longer there strands anyone not using a mouse.
 */
function ChoiceForm({ label, fieldId, current, options, busy, onCancel, onSave }: ChoiceFormProps) {
  const [chosen, setChosen] = useState(current);
  const fieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  return (
    <form
      className="rows__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(chosen);
      }}
    >
      <label className="visually-hidden" htmlFor={fieldId}>
        {label}
      </label>
      <select
        className="rows__select"
        id={fieldId}
        ref={fieldRef}
        value={chosen}
        disabled={busy}
        onChange={(event) => {
          setChosen(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="rows__save" type="submit" disabled={busy}>
        Save
      </button>
      <button className="rows__cancel" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
