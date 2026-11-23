"use client";
// The activity form in a box over the page (SF-109 design A, contracts/routes.md § Components): schedule, edit, or
// "Schedule a follow-up?" after a tick. Type as three tabs, subject, date, time, duration, assignee, the deal, person
// and organisation pickers and a note. A refusal comes back through useActionState with the values as typed (`seq`
// rebuilds the fields); a success redirects to the page without the box.
import Link from "next/link";
import { useActionState, useId } from "react";
import type { LinkRef } from "@/server/activities/activities";
import { ACTIVITY_NOTE_MAX, ACTIVITY_TYPES, durationOptions, SUBJECT_MAX, TYPE_LABELS, type ActivityForm } from "@/server/activities/rules";
import { fieldMessage, messages } from "@/server/messages";
import type { Option } from "@/server/records/common";
import { FieldError } from "../records/FieldError";
import { PersonPicker } from "../records/PersonPicker";
import type { ActivityState } from "./actions";

export type BoxMode = "new" | "edit" | "followup";

type Props = {
  mode: BoxMode;
  action: (prev: ActivityState, fd: FormData) => Promise<ActivityState>;
  initial: ActivityForm;
  // Edit: the activity and the version it was read at.
  id?: number;
  version?: number;
  back: string;
  choices: { assignees: Option[]; deals: LinkRef[]; people: LinkRef[]; organisations: LinkRef[] };
};

const TITLES: Record<BoxMode, string> = { new: "Schedule activity", edit: "Edit activity", followup: messages.followup_question };
const DURATIONS = durationOptions();

function Fields({ values, state, choices }: { values: ActivityForm; state: ActivityState; choices: Props["choices"] }) {
  const err = state?.errors ?? {};
  const ids = { subject: useId(), dueOn: useId(), dueTime: useId(), duration: useId(), assigneeId: useId(), note: useId() };
  const invalid = (k: keyof typeof ids) => (err[k] ? { "aria-invalid": true as const, "aria-describedby": `${ids[k]}-err` } : {});
  return (
    <>
      <fieldset className="typetabs">
        <legend className="visually-hidden">Type</legend>
        {ACTIVITY_TYPES.map((t) => (
          <label key={t}>
            <input type="radio" name="type" value={t} defaultChecked={values.type === t} />
            <span>{TYPE_LABELS[t]}</span>
          </label>
        ))}
      </fieldset>
      <FieldError error={err.type} />
      <label className="field">
        <span>Subject</span>
        <input className="input" name="subject" maxLength={SUBJECT_MAX} defaultValue={values.subject} autoFocus {...invalid("subject")} />
      </label>
      <FieldError error={err.subject} id={`${ids.subject}-err`} />
      <div className="boxrow">
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" name="dueOn" defaultValue={values.dueOn} {...invalid("dueOn")} />
        </label>
        <label className="field">
          <span>Time</span>
          <input className="input" type="time" name="dueTime" step={300} defaultValue={values.dueTime} {...invalid("dueTime")} />
        </label>
        <label className="field">
          <span>Duration</span>
          <select className="input" name="duration" defaultValue={values.duration} {...invalid("duration")}>
            <option value="">None</option>
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FieldError error={err.dueOn} id={`${ids.dueOn}-err`} />
      <FieldError error={err.dueTime} id={`${ids.dueTime}-err`} />
      <FieldError error={err.duration} id={`${ids.duration}-err`} />
      <label className="field">
        <span>Assigned to</span>
        <select className="input" name="assigneeId" defaultValue={values.assigneeId} {...invalid("assigneeId")}>
          {choices.assignees.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <FieldError error={err.assigneeId} id={`${ids.assigneeId}-err`} />
      <div className="field">
        <span>Deal</span>
        <PersonPicker people={choices.deals} initialId={values.dealId} name="dealId" label="Deal" />
      </div>
      <div className="field">
        <span>Person</span>
        <PersonPicker people={choices.people} initialId={values.personId} name="personId" label="Person" />
      </div>
      <div className="field">
        <span>Organisation</span>
        <PersonPicker people={choices.organisations} initialId={values.organisationId} name="organisationId" label="Organisation" />
      </div>
      <label className="field">
        <span>Note</span>
        <textarea className="input" name="note" rows={3} maxLength={ACTIVITY_NOTE_MAX} defaultValue={values.note} {...invalid("note")} />
      </label>
      <FieldError error={err.note} id={`${ids.note}-err`} />
    </>
  );
}

export function ActivityBox({ mode, action, initial, id, version, back, choices }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const titleId = useId();
  const values = state?.values ?? initial;
  const formError = state?.errors.form ? fieldMessage(state.errors.form) : undefined;
  return (
    <div className="overlay">
      <div className="lostbox actbox" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <form action={formAction}>
          <h2 id={titleId}>{TITLES[mode]}</h2>
          {formError && (
            <p className="err" role="alert">
              {formError}
            </p>
          )}
          {id !== undefined && <input type="hidden" name="id" value={id} />}
          {version !== undefined && <input type="hidden" name="version" value={version} />}
          <input type="hidden" name="back" value={back} />
          <Fields key={state?.seq ?? 0} values={values} state={state} choices={choices} />
          <div className="form-acts">
            <Link className="btn" href={back} scroll={false}>
              {mode === "followup" ? "[ NOT NOW ]" : "[ CANCEL ]"}
            </Link>
            <button className="btn solid" type="submit" disabled={pending}>
              [ SAVE ]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
