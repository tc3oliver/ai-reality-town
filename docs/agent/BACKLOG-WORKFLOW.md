# Backlog Workflow

How to use Backlog.md in this project. Commands are run via the project-local binary —
never depend on a global install.

- **Package:** `backlog.md`
- **Installed version:** 1.48.0 (dev dependency)
- **Config:** `backlog/config.yml` (project name, statuses, priorities, DoD, prefixes)
- **Backlog dir:** `backlog/` (`tasks/`, `drafts/`, `milestones/`, `decisions/`, `docs/`, `completed/`, `archive/`)
- **Task prefix:** `ART`

All commands are invoked as `npm run backlog -- <command>`. Always confirm exact options
with `npm run backlog -- <command> --help` for the installed version.

## Common commands

```bash
npm run backlog -- --version
npm run backlog -- instructions overview            # workflow guide index
npm run backlog -- instructions task-creation       # before creating/splitting tasks
npm run backlog -- instructions task-execution      # before planning/status/notes/code
npm run backlog -- instructions task-finalization   # before AC/summary/terminal status

npm run backlog -- task list --plain                # grouped by status
npm run backlog -- task list --json                 # machine-readable
npm run backlog -- task view ART-1

npm run backlog -- task create "<title>" \
  --status "To Do" --priority High --type feature \
  -d "<description>" \
  --ac "<acceptance criterion>" \
  --depends-on ART-2

npm run backlog -- task edit ART-1 --status "In Progress"   # change status/fields
npm run backlog -- task edit ART-1 --plan "<plan>"          # write implementation plan
npm run backlog -- task edit ART-1 --notes "<notes>"        # add implementation notes
npm run backlog -- task edit ART-1 --final-summary "<text>" # add final summary
npm run backlog -- task complete ART-1                      # finalize a Done task
```

## Statuses & priorities

Configured in `backlog/config.yml`:

- Statuses: `To Do`, `In Progress`, `Blocked`, `In Review`, `Done`
- Priorities: `Critical`, `High`, `Medium`, `Low`

> `statuses`, `priorities`, and `definition_of_done` are edited directly in
> `backlog/config.yml` — the CLI refuses to set list-valued config keys directly.

## PRD-to-Backlog flow

When a PRD exists but its task graph does not, read the versioned PRD backlog doc, create
one milestone for that version, map every requirement to independently acceptance-testable
tasks, and encode their dependencies. Check for gaps, cycles, duplicates, and task sizing;
merge trivial tasks and split over-large tasks. Do not modify product code or wait for
approval during decomposition. After the graph is complete, select the highest-priority
unblocked Ready task through the shared task loop in `AUTONOMOUS-DEVELOPMENT.md`.

Each PRD version remains a separate immutable backlog doc with its own milestone and task
graph; a later version does not overwrite an earlier one.

## Rules

- Use the **CLI** for all task lifecycle actions. Do **not** hand-edit task/draft/
  milestone/decision markdown — it breaks metadata, relationships, and history.
- Read `instructions <guide>` before the corresponding lifecycle action.
- One task ↔ one branch ↔ one PR.
- Write the implementation plan into the task before coding.
