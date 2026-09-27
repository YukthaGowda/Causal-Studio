"""Offline study export. Standard library only; never imports the application."""
import argparse
from contextlib import closing
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys

SCRIPT_VERSION = '1.0.0'
IDENTITY = ('participant_id', 'session_id', 'study_version')
TABLE_COLUMNS = {
    'study_sessions': (*IDENTITY, 'client_created_at', 'server_created_at'),
    'pre_surveys': (*IDENTITY, 'submitted_at', 'expertise_area', 'career_stage',
                    'causal_inference_experience', 'llm_experience', 'rag_experience', 'passive_sensing_experience'),
    'post_surveys': (*IDENTITY, 'submitted_at', 'overall_usability', 'trust_in_guidance',
                     'causal_workflow_clarity', 'ai_assistant_helpfulness', 'final_report_confidence', 'open_feedback'),
    'study_events': ('event_id', *IDENTITY, 'client_timestamp', 'server_timestamp', 'phase',
                     'event_type', 'event_label', 'ui_element', 'user_input_text', 'assistant_output_text',
                     'analysis_result_summary', 'metadata_json'),
}
# Older databases may omit optional timestamps/UI fields. Export blanks instead
# of manufacturing values; at least one timestamp is required for event ordering.
OPTIONAL_COLUMNS = {'client_timestamp', 'server_timestamp', 'ui_element'}
SUMMARY_COLUMNS = (*IDENTITY, 'session_created_at', 'pre_survey_completed', 'pre_survey_submitted_at',
                   'post_survey_completed', 'post_survey_submitted_at', 'first_event_timestamp',
                   'last_event_timestamp', 'total_event_count', 'phase_change_count',
                   'chat_user_message_count', 'chat_assistant_response_count',
                   'analysis_action_count', 'report_export_action_count')
ANALYSIS_EVENTS = {'feasibility_check', 'graph_action', 'identification_check', 'estimation_action'}
UUID = r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}'


class ExportError(Exception):
    """Safe operator-facing failure; no participant text or SQL dump."""


def validate_filters(study_version, participant_id, session_id):
    if study_version is not None and not re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}', study_version):
        raise ExportError('Invalid study-version filter.')
    for prefix, value in (('participant', participant_id), ('session', session_id)):
        if value is not None and not re.fullmatch(prefix + '_' + UUID, value):
            raise ExportError(f'Invalid {prefix}-id filter.')


def read_exclusions(path):
    if path is None:
        return set()
    excluded = set()
    try:
        lines = Path(path).read_text(encoding='utf-8-sig').splitlines()
    except (OSError, UnicodeError) as error:
        raise ExportError('Cannot read the participant exclusion file.') from error
    for number, line in enumerate(lines, 1):
        value = line.strip()
        if not value or value.startswith('#'):
            continue
        if not re.fullmatch('participant_' + UUID, value):
            raise ExportError(f'Invalid participant ID on exclusion-file line {number}.')
        excluded.add(value)
    return excluded


def output_path(value):
    path = Path(value).expanduser().resolve()
    # scripts/ lives directly under /app in deployment, or backend/ locally.
    # Git-ancestor checks below also protect the rest of a local repository.
    source_root = Path(__file__).resolve().parents[1]
    if path == source_root or source_root in path.parents or any((p / '.git').exists() for p in (path, *path.parents)):
        raise ExportError('Output must be outside repository/source directories.')
    if path.exists():
        raise ExportError('Output directory already exists; choose a new directory to avoid overwriting research data.')
    return path


def inspect_schema(db):
    available = {}
    for table, columns in TABLE_COLUMNS.items():
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            raise ExportError(f'Missing required study table: {table}. No schema changes were made.')
        actual = {row['name'] for row in db.execute(f'PRAGMA table_info("{table}")')}
        if set(columns) - actual - OPTIONAL_COLUMNS:
            raise ExportError(f'Unsupported schema in {table}: required study columns are missing.')
        if table == 'study_events' and not actual.intersection({'server_timestamp', 'client_timestamp'}):
            raise ExportError('Study events require a stored server or client timestamp.')
        available[table] = [column for column in columns if column in actual]
    return available


def selected_rows(db, table, available, filters, excluded):
    # All identifiers below are constants from the explicit schema allowlist.
    columns = TABLE_COLUMNS[table]
    projection = ', '.join(f't."{c}" AS "{c}"' if c in available[table] else f'NULL AS "{c}"' for c in columns)
    join = '' if table == 'study_sessions' else ' JOIN study_sessions AS s ON ' + ' AND '.join(f't."{c}"=s."{c}"' for c in IDENTITY)
    clauses, params = [], []
    for column, value in filters.items():
        if value is not None:
            clauses.append(f't."{column}"=?')
            params.append(value)
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    if table == 'study_events':
        server = 'NULLIF(t.server_timestamp,\'\')' if 'server_timestamp' in available[table] else 'NULL'
        client = 'NULLIF(t.client_timestamp,\'\')' if 'client_timestamp' in available[table] else 'NULL'
        order = f't.participant_id, t.session_id, COALESCE({server}, {client}, \'\'), COALESCE({client}, {server}, \'\'), t.event_id'
    else:
        order = 't.participant_id, t.session_id, t.study_version'
    for row in db.execute(f'SELECT {projection} FROM "{table}" AS t{join}{where} ORDER BY {order}', params):
        if row['participant_id'] not in excluded:
            yield dict(row)


def spreadsheet_safe(value):
    # Quoting alone does not stop Excel/LibreOffice formulas. Text otherwise
    # remains the stored sanitized value; numeric ratings/counts stay numeric.
    if isinstance(value, str) and (value.startswith(('\t', '\r', '\n')) or value.lstrip().startswith(('=', '+', '-', '@'))):
        return "'" + value
    return value


def private_file(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8', newline='')


def write_csv(path, columns, rows):
    with private_file(path) as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction='raise')
        writer.writeheader()
        for row in rows:
            writer.writerow({c: spreadsheet_safe(row.get(c)) for c in columns})


def empty_summary(session):
    return {**{key: session[key] for key in IDENTITY},
            'session_created_at': session['server_created_at'] or session['client_created_at'],
            'pre_survey_completed': False, 'pre_survey_submitted_at': None,
            'post_survey_completed': False, 'post_survey_submitted_at': None,
            'first_event_timestamp': None, 'last_event_timestamp': None,
            **{key: 0 for key in SUMMARY_COLUMNS if key.endswith('_count')}}


def export_study_data(db_path, output, *, study_version=None, participant_id=None, session_id=None, exclude_participants=None):
    validate_filters(study_version, participant_id, session_id)
    excluded = read_exclusions(exclude_participants)
    try:
        target = output_path(output)
        source = Path(db_path).expanduser().resolve()
    except (OSError, RuntimeError) as error:
        raise ExportError('Cannot resolve database/output paths; check filesystem access and symbolic links.') from error
    if not source.is_file():
        raise ExportError('Study database does not exist or is not a readable file; no replacement database was created.')
    filters = {'study_version': study_version, 'participant_id': participant_id, 'session_id': session_id}
    created = False
    try:
        # Do NOT reuse study_storage.connection(): it initializes schema. Do NOT
        # use immutable=1: it can miss committed data still in a live WAL file.
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=5, isolation_level=None)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN')  # One consistent read snapshot across all files.
            available = inspect_schema(db)
            schema = {'user_version': db.execute('PRAGMA user_version').fetchone()[0],
                      'application_id': db.execute('PRAGMA application_id').fetchone()[0],
                      'exported_stored_columns': available,
                      'missing_optional_columns': {t: [c for c in TABLE_COLUMNS[t] if c not in available[t]] for t in TABLE_COLUMNS}}
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.mkdir(mode=0o700)
            created = True
            summaries, counts = {}, {}

            def collect(table):
                counts[table] = 0
                for row in selected_rows(db, table, available, filters, excluded):
                    counts[table] += 1
                    key = tuple(row[c] for c in IDENTITY)
                    if table == 'study_sessions':
                        summaries[key] = empty_summary(row)
                    elif table in ('pre_surveys', 'post_surveys'):
                        kind = 'pre' if table == 'pre_surveys' else 'post'
                        summaries[key][f'{kind}_survey_completed'] = True
                        summaries[key][f'{kind}_survey_submitted_at'] = row['submitted_at']
                    else:
                        summary = summaries[key]
                        timestamp = row['server_timestamp'] or row['client_timestamp']
                        if summary['total_event_count'] == 0:
                            summary['first_event_timestamp'] = timestamp
                        summary['last_event_timestamp'] = timestamp
                        summary['total_event_count'] += 1
                        kind = row['event_type']
                        if kind in ('phase_change', 'chat_user_message', 'chat_assistant_response'):
                            summary[kind + '_count'] += 1
                        summary['analysis_action_count'] += int(kind in ANALYSIS_EVENTS)
                        summary['report_export_action_count'] += int(kind == 'report_export')
                    yield row

            for table, columns in TABLE_COLUMNS.items():
                write_csv(target / f'{table}.csv', columns, collect(table))
            write_csv(target / 'participant_summary.csv', SUMMARY_COLUMNS, summaries.values())
            manifest = {
                'export_generated_at': datetime.now(timezone.utc).isoformat(),
                'export_script_version': SCRIPT_VERSION, 'filters': filters,
                'counts': {'sessions': counts['study_sessions'], 'participants': len({key[0] for key in summaries}),
                           'pre_surveys': counts['pre_surveys'], 'post_surveys': counts['post_surveys'], 'events': counts['study_events']},
                'excluded_participant_id_count': len(excluded), 'database_schema': schema,
                'event_order': ['participant_id', 'session_id', 'server_timestamp', 'client_timestamp', 'event_id'],
                'timestamp_fallback': 'Use the other stored timestamp when a timestamp is missing or empty; otherwise blank.',
                'csv_formula_protection': 'Potential spreadsheet formulas in text cells are prefixed with an apostrophe.',
                'summary_count_semantics': 'Counts are telemetry rows, including attempted/blocked actions and outcomes; not completed analyses or saved downloads.',
            }
            # Written last: a manifest marks a complete export, never a partial one.
            with private_file(target / 'manifest.json') as handle:
                json.dump(manifest, handle, indent=2, ensure_ascii=False)
                handle.write('\n')
            return manifest
    except (OSError, sqlite3.Error, csv.Error, ExportError) as error:
        if created:
            try:
                shutil.rmtree(target)
            except OSError as cleanup_error:
                raise ExportError('Export failed and partial output could not be removed. Secure/remove the incomplete output before retrying.') from cleanup_error
        if isinstance(error, ExportError):
            raise
        raise ExportError('Export failed: check database readability, SQLite/WAL access, and output permissions. No source records were changed.') from error


def main(argv=None):
    parser = argparse.ArgumentParser(description='Offline, read-only study CSV export for authorized researchers. No network access.')
    parser.add_argument('--db', required=True, help='Existing study SQLite database, e.g. /data/study/study.sqlite')
    parser.add_argument('--output', required=True, help='New output directory outside the repository (must not already exist)')
    parser.add_argument('--study-version')
    parser.add_argument('--participant-id')
    parser.add_argument('--session-id')
    parser.add_argument('--exclude-participants', help='UTF-8 file with one anonymous participant ID per line')
    args = parser.parse_args(argv)
    try:
        result = export_study_data(args.db, args.output, study_version=args.study_version,
                                   participant_id=args.participant_id, session_id=args.session_id,
                                   exclude_participants=args.exclude_participants)
    except ExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({'status': 'ok', 'counts': result['counts']}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
