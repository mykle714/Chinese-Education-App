# Oracle Run Reports

One report per `/oracle-backfill` run, named `oracle-run-<UTC-timestamp>.md`.

Each run enriches the dictionary-entry tables **directly on production** with a
local answerer standing in for the Anthropic API (see
`.claude/commands/oracle-backfill.md` §0). These reports are the review record for
that work: what was written, what the validators rejected, which guardrails fired,
and a sample of the actual generated content so quality can be judged rather than
inferred from row counts.

Reports are written by §7 of the skill and are meant to be read by a human before
the next run.
