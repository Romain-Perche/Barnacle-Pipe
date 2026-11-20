"use client";
// Pipeline and stage of a new deal: the stage list follows the chosen pipeline. Without JavaScript both lists
// still post; the server refuses a stage of another pipeline (deal_stage_required).
import { useState } from "react";
import type { PipelineStages } from "@/server/deals/deals";

export function StageSelect({ pipelines, pipelineId, stageId }: { pipelines: PipelineStages[]; pipelineId: string; stageId: string }) {
  const usable = pipelines.filter((p) => p.stages.length > 0);
  const [chosen, setChosen] = useState<PipelineStages | undefined>(() => usable.find((p) => String(p.id) === pipelineId) ?? usable[0]);
  const [stage, setStage] = useState(() => (chosen?.stages.some((s) => String(s.id) === stageId) ? stageId : String(chosen?.stages[0]?.id ?? "")));
  return (
    <>
      <label className="field">
        <span>Pipeline</span>
        <select
          className="input"
          name="pipelineId"
          value={chosen ? String(chosen.id) : ""}
          onChange={(e) => {
            const next = usable.find((p) => String(p.id) === e.target.value);
            setChosen(next);
            setStage(String(next?.stages[0]?.id ?? ""));
          }}
        >
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Stage</span>
        <select className="input" name="stageId" value={stage} onChange={(e) => setStage(e.target.value)}>
          {chosen?.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
