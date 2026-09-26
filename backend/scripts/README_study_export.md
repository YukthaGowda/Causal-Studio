# Researcher-only offline study export

Run `export_study_data.py` manually from an authorized backend environment with
filesystem access to the study database. It uses Python's standard library,
requires no network access, and adds no web page, API endpoint, or authentication
service. Access is controlled by Railway/project access and filesystem permissions.

Production study storage is configured as `/data/study/study.sqlite` on the
backend's persistent Railway volume. Confirm the actual mount and `STUDY_DB_PATH`
in the authorized environment. This utility requires an explicit `--db`; it does
not load environment files, credentials, or application services.

From the backend working directory **inside the deployed backend container**:

```sh
python scripts/export_study_data.py \
  --db /data/study/study.sqlite \
  --output /tmp/causal-study-pilot-export-20260925-01 \
  --study-version causal-studio-pilot-v1 \
  --exclude-participants scripts/excluded_study_participants.txt
```

This is an example command, not an automatic production task. Use a fresh,
explicit output directory for each export. `/tmp` is an example temporary
location, not durable storage. Retrieve the files using your approved secure
administrative process before a restart; this script does not transfer/upload
anything. Running the command locally does not provide access to Railway's volume.
For an offline copy, use an authorized SQLite backup that includes committed WAL
data; copying only the main `.sqlite` file from a running service can omit records.

For local synthetic databases, from the repository root:

```sh
python backend/scripts/export_study_data.py \
  --db /absolute/path/to/synthetic-study.sqlite \
  --output /absolute/path/outside-the-repository/new-study-export
```

## Files and linkage

| Output | Contents |
| --- | --- |
| `study_sessions.csv` | Anonymous participant/session IDs, study version, client/server creation times. |
| `pre_surveys.csv` | Stored categorical pre-survey answers and submission time. |
| `post_surveys.csv` | Stored ratings, sanitized feedback, and submission time. |
| `study_events.csv` | Stored event IDs, identity, timestamps, phase/type/label, UI element, permitted submitted/displayed chat text, compact result summary, and metadata JSON. |
| `participant_summary.csv` | One row per selected participant/session, survey completion/timestamps, first/last event timestamp, and event counts. |
| `manifest.json` | UTC generation time, script version, filters, counts, exclusion count, schema information, and CSV/timeline conventions. No participant text or database path. |

Join using `participant_id`, `session_id`, and `study_version`. Never join
recruitment names/emails into these files. A participant with multiple sessions
has multiple summary rows. Missing surveys have completion `False` and a blank
submission time. Sessions without events have zero counts and blank event times.

Summary columns are `participant_id`, `session_id`, `study_version`,
`session_created_at`, `pre_survey_completed`, `pre_survey_submitted_at`,
`post_survey_completed`, `post_survey_submitted_at`, `first_event_timestamp`,
`last_event_timestamp`, `total_event_count`, `phase_change_count`,
`chat_user_message_count`, `chat_assistant_response_count`,
`analysis_action_count`, and `report_export_action_count`.

`session_created_at` uses stored server creation time, falling back to the stored
client time if empty. Events sort by participant ID, session ID, server timestamp,
client timestamp, then event ID. A missing/empty timestamp falls back to the other
stored timestamp; if both values are empty, the timestamp remains blank.
An older schema missing both timestamp columns is rejected. Raw timestamp strings
are preserved and sorted as stored; the current server writes UTC timestamps.
First/last summary timestamps use that same server-first ordering. Delayed browser
retries can make server receipt time differ from client action time; both are
exported so researchers can examine this distinction.

All summary counts count **telemetry rows**, not unique actions or completed
analysis runs. `analysis_action_count` counts `feasibility_check`, `graph_action`,
`identification_check`, and `estimation_action` events. `report_export_action_count`
counts `report_export` events. Attempts, blocked actions, and outcomes can produce
separate rows. Inspect `event_label`, metadata status, and `request_id` when pairing
actions. PDF preview events do not prove a file was saved. Assistant metadata
retains its existing LLM/deterministic/fallback/error source distinction.

## Filters and synthetic exclusions

`--study-version`, `--participant-id`, and `--session-id` use exact matching and
combine with AND. No filter means all stored versions/participants/sessions.
Use `--study-version causal-studio-pilot-v1` to exclude `persistence-test-v1`.

The supplied `excluded_study_participants.txt` documents the three known synthetic
IDs. Pass it explicitly using `--exclude-participants`; exclusions are not applied
silently. You can supply another UTF-8 file with one participant ID per line;
blank lines and `#` comments are allowed. Duplicate IDs count once in the manifest.
Exclusions apply to every CSV, including every session for an excluded participant.
The manifest counts exclusion IDs supplied, even if some have no matching records.
Update your exclusion list when further synthetic testing occurs. Nothing is
deleted from the database.

## Read-only behavior and privacy

The source is opened with SQLite URI `mode=ro` and `query_only=ON`. A single read
transaction keeps all files consistent while the backend may continue writing.
There are no data writes, schema initialization, migrations, or WAL checkpoints.
Live WAL data is respected; `immutable=1` is deliberately not used. SQLite may
need its adjacent WAL/SHM files and normal read-lock coordination, so retain access
to the mounted database directory. The script fails clearly on missing/unreadable
or unsupported databases instead of creating replacements.

Only the four known study tables and explicitly allowed columns are read. Unknown
columns and unrelated tables are excluded. Exported text/JSON comes from the
existing study privacy layer; the script does not retrieve hidden prompts, RAG
chunks, datasets, documents, full reports, browser fingerprints, or recruitment
records. It does not infer identities or recover redacted content.
Use the trusted study database written by the study API. The utility cannot prove
that an independently modified database previously passed that privacy layer.

Anonymous IDs do **not** guarantee complete anonymization of free text. Existing
filters are heuristic: permitted chat/feedback can still contain participant-entered
identifying details. Treat all exports as restricted research data, review free
text before sharing, and follow the study's access, retention, and backup policies.

CSV text cells that could execute as spreadsheet formulas receive a leading
apostrophe; this presentation safeguard does not modify SQLite. CSV quoting
preserves Unicode, commas, quotes, and multiline text. Metadata remains JSON in a
CSV cell. An empty initialized study database produces header-only CSV files.

Outputs must be outside the source repository, in a **new** directory. Existing
directories are rejected to avoid overwriting earlier exports. The output directory
uses permissions `0700`; files use `0600` (subject to OS/filesystem behavior).
`manifest.json` is written last; handled failures remove partial exports. An abrupt
process termination may leave a partial directory without a manifest. Large or
slow exports hold a read snapshot and may temporarily increase WAL retention;
schedule appropriately for the small single-replica pilot.

Never commit participant exports, database files, or credentials to Git. No
`.gitignore` or unrelated deployment changes are required for this workflow.
