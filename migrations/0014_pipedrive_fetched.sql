-- SF-122 fix round 1: a part keeps the Pipedrive answers it already got across a slow-down (429), so that a part that
-- needs more calls than Pipedrive allows between two slow-downs still ends. `fetched` holds {step, cursor, calls}: the
-- answers of the part of that step and cursor, never the token; cleared whenever the step or cursor moves.
alter table pipedrive_imports add column fetched jsonb;
