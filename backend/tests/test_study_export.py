"""Offline export tests: every database and output is temporary and synthetic."""
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from app.api.study import Event, PostSurvey, PreSurvey, SessionRequest
from app.services import study_storage
from scripts import export_study_data as exporter


class StudyExportPathTests(unittest.TestCase):
    """Path-only checks: no database, participant records, or exports are created."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.scripts = self.repo / 'backend' / 'scripts'
        self.scripts.mkdir(parents=True)
        (self.repo / '.git').mkdir()
        location = patch.object(exporter, '__file__', str(self.scripts / 'export_study_data.py'))
        location.start()
        self.addCleanup(location.stop)
        # output_path must not open SQLite, even accidentally.
        database = patch.object(exporter.sqlite3, 'connect', side_effect=AssertionError('Path validation must not access SQLite'))
        database.start()
        self.addCleanup(database.stop)

    def test_deployed_layout_protects_app_and_allows_external_output(self):
        # Model the exact Railway layout without creating /app or /data locally.
        with patch.object(exporter, '__file__', '/app/scripts/export_study_data.py'), patch.object(Path, 'exists', return_value=False):
            for value in ('/app', '/app/export', '/app/something/export'):
                with self.subTest(path=value), self.assertRaisesRegex(exporter.ExportError, 'outside repository/source'):
                    exporter.output_path(value)
            for value in ('/tmp/export', '/data/study_exports/export'):
                with self.subTest(path=value):
                    self.assertEqual(exporter.output_path(value), Path(value).resolve())

    def test_local_backend_remains_protected_without_git_metadata(self):
        (self.repo / '.git').rmdir()
        for value in (self.repo / 'backend', self.repo / 'backend' / 'export', self.scripts / 'nested' / 'export'):
            with self.subTest(path=value), self.assertRaisesRegex(exporter.ExportError, 'outside repository/source'):
                exporter.output_path(value)

    def test_local_git_ancestors_protect_entire_repository(self):
        for marker_type in ('directory', 'file'):
            if marker_type == 'file':
                (self.repo / '.git').rmdir()
                (self.repo / '.git').touch()  # Git worktrees use a .git file.
            for value in (self.repo, self.repo / 'export', self.repo / 'frontend' / 'nested' / 'export'):
                with self.subTest(marker=marker_type, path=value), self.assertRaisesRegex(exporter.ExportError, 'outside repository/source'):
                    exporter.output_path(value)

    def test_local_output_outside_repository_is_allowed(self):
        output = self.root / 'external' / 'export'
        self.assertEqual(exporter.output_path(output), output)
        self.assertFalse(output.exists())

    def test_existing_external_output_directory_is_rejected(self):
        output = self.root / 'existing'
        output.mkdir()
        with self.assertRaisesRegex(exporter.ExportError, 'already exists'):
            exporter.output_path(output)
        self.assertTrue(output.is_dir())

    def test_symlink_into_source_or_repository_is_rejected(self):
        link = self.root / 'source-link'
        link.symlink_to(self.repo, target_is_directory=True)
        for value in (link / 'backend' / 'export', link / 'frontend' / 'export'):
            with self.subTest(path=value), self.assertRaisesRegex(exporter.ExportError, 'outside repository/source'):
                exporter.output_path(value)


class StudyExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'study.sqlite'
        env = patch.dict(os.environ, {'STUDY_DB_PATH': str(self.path)})
        env.start()
        self.addCleanup(env.stop)
        with study_storage.connection():
            pass
        self.first = self.identity()
        self.second_session = self.identity(participant=self.first['participant_id'])
        self.other = self.identity()
        self.synthetic = self.identity(version='persistence-test-v1')

    def identity(self, participant=None, version='causal-studio-pilot-v1'):
        return {'participant_id': participant or 'participant_' + str(uuid4()),
                'session_id': 'session_' + str(uuid4()), 'study_version': version}

    def session(self, identity):
        data = SessionRequest(**identity, client_created_at='2026-09-25T12:00:00Z').model_dump(mode='json')
        study_storage.register_session(data)

    def pre(self, identity):
        data = PreSurvey(**identity, submitted_at='2026-09-25T12:01:00Z', expertise_area='other', career_stage='other',
                         causal_inference_experience='none', llm_experience='none', rag_experience='none', passive_sensing_experience='none')
        study_storage.save_survey('pre', data.model_dump(mode='json'))

    def post(self, identity, feedback='Synthetic feedback'):
        data = PostSurvey(**identity, submitted_at='2026-09-25T12:10:00Z', overall_usability=3, trust_in_guidance=3,
                          causal_workflow_clarity=3, ai_assistant_helpfulness=3, final_report_confidence=3, open_feedback=feedback)
        study_storage.save_survey('post', data.model_dump(mode='json'))

    def event(self, identity, kind='page_view', **extra):
        data = Event(**identity, event_id=str(uuid4()), client_timestamp='2026-09-25T12:02:00Z', phase='review',
                     event_type=kind, event_label='synthetic_test', **extra).model_dump(mode='json')
        study_storage.save_events([data])
        return data['event_id']

    def seed(self):
        for identity in (self.first, self.second_session, self.other, self.synthetic):
            self.session(identity)
        self.pre(self.first)
        self.post(self.first)
        self.pre(self.other)
        self.post(self.other)
        self.pre(self.synthetic)
        self.post(self.synthetic)
        for kind in ('page_view', 'phase_change', 'chat_user_message', 'chat_assistant_response', 'feasibility_check', 'report_export'):
            self.event(self.first, kind)
        self.event(self.other)
        self.event(self.synthetic)

    def export(self, name='export', **options):
        output = self.root / name
        manifest = exporter.export_study_data(self.path, output, **options)
        files = {}
        for path in output.glob('*.csv'):
            with path.open(newline='', encoding='utf-8') as handle:
                files[path.stem] = list(csv.DictReader(handle))
        return files, manifest, output

    def test_four_tables_export_exact_allowlisted_stored_columns(self):
        self.seed()
        files, _, _ = self.export()
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            for table, columns in exporter.TABLE_COLUMNS.items():
                self.assertEqual(set(files[table][0]), set(columns))
                originals = [dict(row) for row in db.execute('SELECT * FROM ' + table)]
                originals = [{k: str(v) for k, v in row.items()} for row in originals]
                key = 'event_id' if table == 'study_events' else 'session_id'
                self.assertEqual(sorted(files[table], key=lambda r: r[key]), sorted(originals, key=lambda r: r[key]))

    def test_participant_summary_counts_and_observed_timestamps(self):
        self.seed()
        files, _, _ = self.export()
        row = next(r for r in files['participant_summary'] if r['session_id'] == self.first['session_id'])
        self.assertEqual(row['total_event_count'], '6')
        for field in ('phase_change_count', 'chat_user_message_count', 'chat_assistant_response_count', 'analysis_action_count', 'report_export_action_count'):
            self.assertEqual(row[field], '1')
        self.assertEqual(row['pre_survey_completed'], 'True')
        self.assertEqual(row['post_survey_completed'], 'True')
        self.assertEqual(row['pre_survey_submitted_at'], files['pre_surveys'][next(i for i, r in enumerate(files['pre_surveys']) if r['session_id'] == self.first['session_id'])]['submitted_at'])
        events = [r for r in files['study_events'] if r['session_id'] == self.first['session_id']]
        self.assertEqual(row['first_event_timestamp'], events[0]['server_timestamp'])
        self.assertEqual(row['last_event_timestamp'], events[-1]['server_timestamp'])

    def test_event_order_is_reproducible_with_ties(self):
        self.seed()
        with sqlite3.connect(self.path) as db:
            # Synthetic fixture only: force server/client ties, leaving UUID tiebreaks.
            db.execute("UPDATE study_events SET server_timestamp='2026-09-25T12:03:00Z'")
        first, _, _ = self.export('first')
        second, _, _ = self.export('second')
        events = first['study_events']
        self.assertEqual(events, second['study_events'])
        keys = ['participant_id', 'session_id', 'server_timestamp', 'client_timestamp', 'event_id']
        self.assertEqual(events, sorted(events, key=lambda r: tuple(r[k] for k in keys)))

    def test_study_version_filter_applies_to_every_csv(self):
        self.seed()
        files, _, _ = self.export(study_version='persistence-test-v1')
        for rows in files.values():
            self.assertTrue(rows)
            self.assertTrue(all(r['study_version'] == 'persistence-test-v1' for r in rows))

    def test_persistence_test_version_excluded_from_pilot(self):
        self.seed()
        files, _, _ = self.export(study_version='causal-studio-pilot-v1')
        for rows in files.values():
            self.assertTrue(all(r['study_version'] == 'causal-studio-pilot-v1' for r in rows))
        self.assertEqual(len(files['study_sessions']), 3)

    def test_participant_filter_preserves_multiple_sessions(self):
        self.seed()
        files, manifest, _ = self.export(participant_id=self.first['participant_id'])
        for rows in files.values():
            self.assertTrue(all(r['participant_id'] == self.first['participant_id'] for r in rows))
        self.assertEqual(len(files['participant_summary']), 2)
        self.assertEqual(manifest['counts']['participants'], 1)

    def test_session_and_combined_filters(self):
        self.seed()
        files, _, _ = self.export(session_id=self.first['session_id'], participant_id=self.first['participant_id'], study_version=self.first['study_version'])
        for rows in files.values():
            self.assertTrue(all(r['session_id'] == self.first['session_id'] for r in rows))
        self.assertEqual(len(files['participant_summary']), 1)
        empty, _, _ = self.export('mismatch', session_id=self.first['session_id'], participant_id=self.other['participant_id'])
        self.assertTrue(all(not rows for rows in empty.values()))

    def test_exclusion_file_removes_all_sessions_and_related_records(self):
        self.seed()
        excluded = self.root / 'excluded.txt'
        excluded.write_text('# Synthetic fixtures\n\n' + self.first['participant_id'] + '\n' + self.first['participant_id'] + '\n')
        files, manifest, _ = self.export(exclude_participants=excluded)
        for rows in files.values():
            self.assertTrue(all(r['participant_id'] != self.first['participant_id'] for r in rows))
        self.assertEqual(manifest['excluded_participant_id_count'], 1)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM study_sessions').fetchone()[0], 4)

    def test_missing_pre_survey_is_not_invented(self):
        self.session(self.first)
        self.post(self.first)
        files, _, _ = self.export()
        row = files['participant_summary'][0]
        self.assertEqual(row['pre_survey_completed'], 'False')
        self.assertEqual(row['pre_survey_submitted_at'], '')
        self.assertEqual(row['post_survey_completed'], 'True')

    def test_missing_post_survey_and_events_are_not_invented(self):
        self.session(self.first)
        self.pre(self.first)
        files, _, _ = self.export()
        row = files['participant_summary'][0]
        self.assertEqual(row['post_survey_completed'], 'False')
        for field in ('post_survey_submitted_at', 'first_event_timestamp', 'last_event_timestamp'):
            self.assertEqual(row[field], '')
        self.assertEqual(row['total_event_count'], '0')

    def test_empty_initialized_database_exports_headers_and_zero_counts(self):
        files, manifest, output = self.export()
        self.assertEqual(len(files), 5)
        self.assertTrue(all(not rows for rows in files.values()))
        self.assertTrue(all(count == 0 for count in manifest['counts'].values()))
        for table, columns in {**exporter.TABLE_COLUMNS, 'participant_summary': exporter.SUMMARY_COLUMNS}.items():
            with (output / f'{table}.csv').open(newline='') as handle:
                self.assertEqual(next(csv.reader(handle)), list(columns))

    def test_nonexistent_and_invalid_databases_fail_without_replacement_or_output(self):
        missing = self.root / 'missing.sqlite'
        output = self.root / 'output'
        with self.assertRaises(exporter.ExportError):
            exporter.export_study_data(missing, output)
        self.assertFalse(missing.exists())
        self.assertFalse(output.exists())
        invalid = self.root / 'invalid.sqlite'
        invalid.write_text('not a SQLite database')
        with self.assertRaises(exporter.ExportError):
            exporter.export_study_data(invalid, output)
        self.assertFalse(output.exists())
        self.assertEqual(invalid.read_text(), 'not a SQLite database')

    def test_source_database_bytes_and_schema_unchanged(self):
        self.seed()
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.export()
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_connection_is_readonly_and_export_issues_no_write_statements(self):
        self.seed()
        connect = sqlite3.connect
        statements = []

        def checked_connect(address, **options):
            self.assertEqual(address, self.path.resolve().as_uri() + '?mode=ro')
            self.assertTrue(options['uri'])
            db = connect(address, **options)
            db.set_trace_callback(statements.append)
            return db

        with patch.object(exporter.sqlite3, 'connect', side_effect=checked_connect):
            self.export()
        self.assertIn('PRAGMA query_only=ON', statements)
        self.assertTrue(all(sql.split()[0].upper() in ('PRAGMA', 'BEGIN', 'SELECT') for sql in statements), statements)

    def test_database_without_study_schema_is_not_initialized(self):
        blank = self.root / 'blank.sqlite'
        sqlite3.connect(blank).close()
        before = blank.read_bytes()
        with self.assertRaisesRegex(exporter.ExportError, 'Missing required study table'):
            exporter.export_study_data(blank, self.root / 'output')
        self.assertEqual(blank.read_bytes(), before)
        self.assertFalse((self.root / 'output').exists())

    def test_readonly_mode_handles_active_wal_without_missing_committed_rows(self):
        with study_storage.connection() as writer:
            self.session(self.first)
            wal = Path(str(self.path) + '-wal')
            self.assertGreater(wal.stat().st_size, 0)
            before_db, before_wal = self.path.read_bytes(), wal.read_bytes()
            files, _, _ = self.export()
            self.assertEqual(len(files['study_sessions']), 1)
            self.assertEqual(self.path.read_bytes(), before_db)
            self.assertEqual(wal.read_bytes(), before_wal)
            self.assertEqual(writer.execute('PRAGMA journal_mode').fetchone()[0], 'wal')

    def test_consistent_snapshot_while_another_connection_writes(self):
        self.session(self.first)
        original = exporter.write_csv

        def concurrent_write(path, columns, rows):
            original(path, columns, rows)
            if path.name == 'study_sessions.csv':
                self.pre(self.first)
                self.event(self.first)

        with patch.object(exporter, 'write_csv', side_effect=concurrent_write):
            files, manifest, _ = self.export()
        self.assertEqual(files['pre_surveys'], [])
        self.assertEqual(files['study_events'], [])
        self.assertEqual(manifest['counts']['events'], 0)
        later, _, _ = self.export('later')
        self.assertEqual(len(later['study_events']), 1)

    def test_unknown_database_columns_and_external_tables_are_never_exported(self):
        self.session(self.first)
        self.event(self.first, 'chat_user_message', user_input_text='Contact test@example.com',
                   metadata_json={'system_prompt': 'HIDDEN_PROMPT', 'filename': 'HIDDEN_FILE', 'source': 'deterministic_response'})
        with sqlite3.connect(self.path) as db:
            db.execute('ALTER TABLE study_events ADD COLUMN private_extra TEXT')
            db.execute("UPDATE study_events SET private_extra='HIDDEN_EXTRA'")
            db.execute('CREATE TABLE recruitment (email TEXT)')
            db.execute("INSERT INTO recruitment VALUES ('HIDDEN_EMAIL')")
        files, _, output = self.export()
        content = ''.join(p.read_text() for p in output.iterdir())
        self.assertNotIn('HIDDEN_', content)
        self.assertNotIn('test@example.com', content)
        self.assertNotIn('private_extra', content)
        self.assertEqual(files['study_events'][0]['user_input_text'], 'Contact [email removed]')
        self.assertEqual(json.loads(files['study_events'][0]['metadata_json']), {'source': 'deterministic_response', 'metadata_sanitized': True, 'text_sanitized': True})

    def test_manifest_counts_filters_and_no_text(self):
        self.seed()
        files, manifest, output = self.export()
        self.assertEqual(json.loads((output / 'manifest.json').read_text()), manifest)
        self.assertEqual(manifest['counts'], {'sessions': 4, 'participants': 3, 'pre_surveys': 3, 'post_surveys': 3, 'events': 8})
        for label, table in [('sessions', 'study_sessions'), ('pre_surveys', 'pre_surveys'), ('post_surveys', 'post_surveys'), ('events', 'study_events')]:
            self.assertEqual(manifest['counts'][label], len(files[table]))
        self.assertNotIn('Synthetic feedback', (output / 'manifest.json').read_text())
        self.assertNotIn(str(self.path), (output / 'manifest.json').read_text())
        self.assertEqual(manifest['database_schema']['user_version'], 0)
        self.assertEqual(manifest['export_script_version'], exporter.SCRIPT_VERSION)

    def test_spreadsheet_formula_escaping_and_multiline_unicode_roundtrip(self):
        self.session(self.first)
        self.post(self.first, '=1+1')
        self.event(self.first, 'chat_assistant_response', assistant_output_text='Visible reply, with "quotes"\nand Unicode α.')
        files, _, _ = self.export()
        self.assertEqual(files['post_surveys'][0]['open_feedback'], "'=1+1")
        self.assertEqual(files['study_events'][0]['assistant_output_text'], 'Visible reply, with "quotes"\nand Unicode α.')
        for value in [' =SUM(1,1)', '+1', '-1', '@SUM(1)', '\tplain', '\rplain', '\nplain']:
            self.assertEqual(exporter.spreadsheet_safe(value), "'" + value)

    def test_output_refuses_source_tree_existing_directory_and_symlink_into_repo(self):
        repo = Path(exporter.__file__).resolve().parents[2]
        with self.assertRaises(exporter.ExportError):
            exporter.export_study_data(self.path, repo / 'backend' / 'unexpected-study-export')
        with self.assertRaises(exporter.ExportError):
            exporter.export_study_data(self.path, self.root)
        link = self.root / 'source-link'
        link.symlink_to(repo, target_is_directory=True)
        with self.assertRaises(exporter.ExportError):
            exporter.export_study_data(self.path, link / 'unexpected-study-export')

    def test_optional_timestamp_and_ui_column_fallback(self):
        self.session(self.first)
        self.event(self.first)
        with sqlite3.connect(self.path) as db:
            db.execute('ALTER TABLE study_events DROP COLUMN server_timestamp')
            db.execute('ALTER TABLE study_events DROP COLUMN ui_element')
        files, manifest, _ = self.export()
        event = files['study_events'][0]
        self.assertEqual(event['server_timestamp'], '')
        self.assertEqual(event['ui_element'], '')
        self.assertEqual(files['participant_summary'][0]['first_event_timestamp'], event['client_timestamp'])
        self.assertEqual(manifest['database_schema']['missing_optional_columns']['study_events'], ['server_timestamp', 'ui_element'])

    def test_failure_removes_partial_output_and_keeps_source_unchanged(self):
        self.seed()
        before = self.path.read_bytes()
        with patch.object(exporter, 'write_csv', side_effect=OSError('private diagnostic')):
            with self.assertRaisesRegex(exporter.ExportError, 'Export failed') as failure:
                self.export()
        self.assertNotIn('private diagnostic', str(failure.exception))
        self.assertFalse((self.root / 'export').exists())
        self.assertEqual(self.path.read_bytes(), before)

    def test_output_permissions_are_restricted(self):
        _, _, output = self.export()
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in output.iterdir()))

    def test_invalid_filters_and_exclusions_fail_before_writing(self):
        for options in ({'participant_id': 'invalid'}, {'session_id': 'invalid'}, {'study_version': "' OR 1=1 --"}, {'exclude_participants': self.root / 'missing'}):
            with self.subTest(options=options), self.assertRaises(exporter.ExportError):
                self.export(**options)
        excluded = self.root / 'invalid-exclusions.txt'
        excluded.write_text('not-an-anonymous-id')
        with self.assertRaises(exporter.ExportError):
            self.export(exclude_participants=excluded)
        self.assertFalse((self.root / 'export').exists())

    def test_cli_runs_standalone_and_handles_missing_source(self):
        script = Path(exporter.__file__).resolve()
        result = subprocess.run([sys.executable, '-I', str(script), '--db', str(self.path), '--output', str(self.root / 'cli')],
                                cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'ok')
        missing = self.root / 'missing.sqlite'
        result = subprocess.run([sys.executable, '-I', str(script), '--db', str(missing), '--output', str(self.root / 'absent')],
                                cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('Traceback', result.stderr)
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
