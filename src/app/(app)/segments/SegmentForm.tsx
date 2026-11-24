"use client";
// The add / edit form of a segment, on its own page (SF-120 design C; contracts/routes.md § Form fields): name, who
// (everyone, a pipeline, a stage) with the deal status, condition rows added and removed, the count block, then
// [ SAVE ], [ COUNT AGAIN ] and [ CANCEL ]. Both buttons post the same form (`intent`); a refusal or a count comes back
// through useActionState with the values as typed. Errors in a list at the top and next to their input.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { messages } from "@/server/messages";
import {
  DEAL_STATUS_CHOICES, SEGMENT_WHO, fieldLabel,
  type ConditionValues, type FormOptions, type Reach, type SegmentFormValues, type SegmentWho,
} from "@/server/segments/rules";
import type { SegmentFormState } from "./actions";
import { MultiPicker } from "./MultiPicker";
import { ReachBlock } from "./ReachBlock";

type Props = {
  action: (prev: SegmentFormState, fd: FormData) => Promise<SegmentFormState>;
  options: FormOptions;
  initial: SegmentFormValues;
  reach: Reach | null;
  id?: number;
  version?: number;
  cancelHref: string;
};

const WHO_LABEL: Record<SegmentWho, string> = {
  everyone: messages.segment_who_everyone, pipeline: messages.segment_who_pipeline, stage: messages.segment_who_stage,
};
const STATUS_LABEL = {
  open: messages.segment_status_open, won: messages.segment_status_won, lost: messages.segment_status_lost, all: messages.segment_status_all,
} as const;

type Row = ConditionValues & { key: number };
let nextKey = 1;

function Err({ text, id }: { text?: string; id?: string }) {
  return text ? (
    <p className="ferr" id={id} role="alert">
      {text}
    </p>
  ) : null;
}

// The input of one condition row, by field.
function ConditionInput({ row, n, options, label }: { row: Row; n: number; options: FormOptions; label: string }) {
  const opts = (list: { id: number; name: string }[]) => list.map((o) => ({ id: String(o.id), name: o.name }));
  const name = `c.${n}.value`;
  const picker = (list: { id: string; name: string }[]) => <MultiPicker name={name} label={label} options={list} initial={row.values} />;
  switch (row.field) {
    case "lead_source": return picker(opts(options.leadSources));
    case "label": return picker(opts(options.labels));
    case "organisation": return picker(opts(options.organisations));
    case "owner": return picker(opts(options.owners));
    case "role": return <input className="input" name={name} aria-label={label} defaultValue={row.values[0] ?? ""} autoComplete="off" />;
  }
  const field = options.fields.find((f) => `cf${f.id}` === row.field);
  if (!field) return null;
  switch (field.type) {
    case "text":
    case "long_text":
      return <input className="input" name={name} aria-label={label} defaultValue={row.values[0] ?? ""} autoComplete="off" />;
    case "number":
    case "money":
    case "date": {
      const type = field.type === "date" ? "date" : "text";
      return (
        <span className="range">
          <input className="input" type={type} name={`c.${n}.from`} aria-label={`${label} from`} placeholder="From" defaultValue={row.from} />
          <input className="input" type={type} name={`c.${n}.to`} aria-label={`${label} to`} placeholder="To" defaultValue={row.to} />
        </span>
      );
    }
    case "single_choice":
      return picker([...opts(field.choices), { id: "empty", name: messages.segment_empty_value }]);
    case "multiple_choice":
      return picker(opts(field.choices));
    case "yes_no":
      return (
        <select className="input" name={name} aria-label={label} defaultValue={row.values[0] ?? ""}>
          <option value="">—</option>
          <option value="yes">{messages.segment_yes}</option>
          <option value="no">{messages.segment_no}</option>
          <option value="empty">{messages.segment_empty_value}</option>
        </select>
      );
  }
}

export function SegmentForm(props: Props) {
  const [state, formAction, pending] = useActionState(props.action, null);
  // Rebuilt (key) from the values sent back after each answer.
  return <FormBody key={state?.seq ?? 0} {...props} state={state} formAction={formAction} pending={pending} />;
}

function FormBody({ options, initial, reach, id, version, cancelHref, state, formAction, pending }: Props & {
  state: SegmentFormState; formAction: (fd: FormData) => void; pending: boolean;
}) {
  const v = state?.values ?? initial;
  const errors = state?.errors ?? {};
  const shownReach = state ? state.reach : reach;
  const ids = { name: useId(), pipeline: useId(), stage: useId() };
  const [who, setWho] = useState<SegmentWho>((SEGMENT_WHO as readonly string[]).includes(v.who) ? (v.who as SegmentWho) : "everyone");
  const [pipelineId, setPipelineId] = useState(v.pipelineId);
  const [rows, setRows] = useState<Row[]>(() => v.conditions.map((c) => ({ ...c, key: nextKey++ })));
  const [adding, setAdding] = useState("lead_source");
  const stages = options.pipelines.find((p) => String(p.id) === pipelineId)?.stages ?? [];
  const fieldChoices = [
    ["lead_source", messages.segment_field_lead_source], ["label", messages.segment_field_label],
    ["organisation", messages.segment_field_organisation], ["owner", messages.segment_field_owner], ["role", messages.segment_field_role],
    ...options.fields.filter((f) => f.name !== messages.segment_deleted_mark).map((f) => [`cf${f.id}`, f.name]),
  ] as [string, string][];
  const list = Object.values(errors);

  return (
    <form action={formAction} className="recform segform" noValidate>
      {list.length > 0 && (
        <div className="err" role="alert">
          {list.length === 1 ? list[0] : (
            <ul>
              {list.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}

      <label className="field">
        <span>Name</span>
        <input className="input" name="name" defaultValue={v.name} autoComplete="off" autoFocus
          {...(errors.name ? { "aria-invalid": true, "aria-describedby": `${ids.name}-err` } : {})} />
      </label>
      <Err text={errors.name} id={`${ids.name}-err`} />

      <fieldset className="field">
        <legend>{messages.segment_who_label}</legend>
        {SEGMENT_WHO.map((w) => (
          <label key={w} className="check radio">
            <input type="radio" name="who" value={w} checked={who === w} onChange={() => setWho(w)} /> {WHO_LABEL[w]}
          </label>
        ))}
        {who !== "everyone" && (
          <div className="addrow">
            <label className="field inline">
              <span>{messages.segment_pipeline_label}</span>
              <select className="input" name="pipelineId" id={ids.pipeline} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                <option value="">—</option>
                {options.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {who === "stage" && (
              <label className="field inline">
                <span>{messages.segment_stage_label}</span>
                <select className="input" name="stageId" id={ids.stage} defaultValue={v.stageId} key={pipelineId}>
                  <option value="">—</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field inline">
              <span>{messages.segment_deals_label}</span>
              <select className="input" name="dealStatus" defaultValue={v.dealStatus || "open"}>
                {DEAL_STATUS_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <Err text={errors.pipelineId} />
        <Err text={errors.stageId} />
      </fieldset>

      <fieldset className="field">
        <legend>{messages.segment_conditions_heading}</legend>
        {rows.map((row, n) => {
          const label = fieldLabel(row.field, options) ?? messages.segment_deleted_mark;
          return (
            <div key={row.key} className="cond">
              <input type="hidden" name={`c.${n}.field`} value={row.field} />
              <span className="typ">{label}</span>
              <ConditionInput row={row} n={n} options={options} label={label} />
              <button type="button" className="btn link" onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>
                [ REMOVE ]
              </button>
              <Err text={errors[`c.${n}`]} />
            </div>
          );
        })}
        <Err text={errors.conditions} />
        <div className="addrow">
          <select className="input" aria-label="Field" value={adding} onChange={(e) => setAdding(e.target.value)}>
            {fieldChoices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setRows([...rows, { key: nextKey++, field: adding, values: [], from: "", to: "" }])}>
            [ ADD CONDITION ]
          </button>
        </div>
      </fieldset>

      <ReachBlock reach={shownReach} />

      <div className="form-acts">
        <button className="btn solid" type="submit" name="intent" value="save" disabled={pending}>
          [ SAVE ]
        </button>
        <button className="btn" type="submit" name="intent" value="count" disabled={pending}>
          [ COUNT AGAIN ]
        </button>
        <Link className="btn" href={cancelHref}>
          [ CANCEL ]
        </Link>
      </div>
    </form>
  );
}
