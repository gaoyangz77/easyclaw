# Instructions for Claude Code

## Shell Command Permissions

You are authorized to execute shell commands for this project.

**Pre-approved commands (no confirmation needed):**

- File operations: `ls`, `cat`, `grep`, `find`, `head`, `sed`, `mkdir`, `cd`, `kill`
- Testing: `pytest`, `npm test`, `cargo test`, `python`, `python3`
- Dependencies: `npm install`, `pip install -r requirements.txt`
- Docker: `docker compose build`, `docker compose up`, `docker compose down`
- Misc: `afplay`
- All URL fetching

**Ask for confirmation** only if a command is destructive or irreversible.

## Workflow Rules

### Before Coding

- Read `docs/` (except `docs/ADR/`) to understand current state
- Treat `docs/PROGRESS.md` as the source of truth
- For new requirements or changes, update docs first, then implement code

### After Meaningful Work

- Update `docs/PROGRESS.md`
- Append to ADR if architectural decisions were made
- Run relevant unit tests

### Restrictions

- Never assume undocumented behavior
- Do NOT auto-commit or push to git without explicit order
