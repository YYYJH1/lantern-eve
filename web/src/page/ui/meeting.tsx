import { useMemo, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import { Introductions } from "../meetings.ts";
import { type Relation, relationRows } from "../relations.ts";
import type { Person } from "../scene.ts";

/** The rows of `people` of a frame, and the person the player is meeting for the first time in the talk they are in, if there is one. */
export function useFirstMeeting(frame: ViewFrame | null, partner: string | null): { rows: Relation[] | null; meeting: string | null } {
  const tracker = useRef(new Introductions());
  const rows = useMemo(() => (frame === null ? null : relationRows(frame.relations)), [frame]);
  return { rows, meeting: tracker.current.update(rows, partner) };
}

/**
 * Who the player is talking to for the first time, at the side of the talk: the name, the line the town says of them (the same line that the page of
 * the first six people has, which says who they are), and that they are in the people book now. It is there for the length of that first talk.
 */
export function MeetingNote({ person, lang }: { person: Person; lang: Lang }) {
  const intro = pick(person.intro, lang);
  return (
    <div class="meeting-note" data-testid="meeting-note" data-person={person.id} role="note" aria-label={t("people.meeting.label")}>
      <p class="meeting-line">
        <strong class="meeting-name" data-testid="meeting-name">
          {pick(person.name, lang)}
        </strong>
        {intro === "" ? null : (
          <span class="meeting-intro" data-testid="meeting-intro">
            {intro}
          </span>
        )}
        <small class="meeting-added" data-testid="meeting-added">
          {t("people.meeting.added")}
        </small>
      </p>
    </div>
  );
}
