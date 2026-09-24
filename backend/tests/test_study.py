import importlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.services import study_storage


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'study.sqlite'
        env = patch.dict(os.environ, {'STUDY_DB_PATH': str(self.path)})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)
        self.identity = {'participant_id': 'participant_' + str(uuid4()), 'session_id': 'session_' + str(uuid4()), 'study_version': 'pilot-v1'}
        self.time = '2026-09-22T12:00:00Z'

    def register(self):
        return self.client.post('/study/sessions', json={**self.identity, 'client_created_at': self.time})

    def rows(self, table):
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM ' + table)]

    def event(self, **overrides):
        return {**self.identity, 'event_id': str(uuid4()), 'client_timestamp': self.time, 'phase': 'review', 'event_type': 'button_click', 'event_label': 'export_report', **overrides}

    def batch(self, *events):
        return self.client.post('/study/events/batch', json={'events': list(events)})

    def test_health(self):
        response = self.client.get('/study/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'status': 'ok', 'storage_available': True,
            'configured_with_explicit_path': True, 'journal_mode': 'wal',
            'database_writable': True,
        })
        for table in ('study_sessions', 'pre_surveys', 'post_surveys', 'study_events'):
            self.assertEqual(self.rows(table), [])

    def test_explicit_path_and_nested_directory_creation(self):
        self.path = Path(self.temp.name) / 'volume' / 'study' / 'study.sqlite'
        with patch.dict(os.environ, {'STUDY_DB_PATH': str(self.path)}):
            self.assertEqual(study_storage.database_path(), self.path)
            self.assertFalse(self.path.parent.exists())
            self.assertEqual(self.client.get('/study/health').status_code, 200)
            self.assertTrue(self.path.is_file())
            self.assertEqual(list(Path(self.temp.name).rglob('*.sqlite')), [self.path])

    def test_sqlite_settings_and_wal_companions(self):
        with study_storage.connection() as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(db.execute('PRAGMA synchronous').fetchone()[0], 2)  # FULL
            self.assertEqual(db.execute('PRAGMA foreign_keys').fetchone()[0], 1)
            self.assertEqual(db.execute('PRAGMA busy_timeout').fetchone()[0], 5000)
            for suffix in ('-wal', '-shm'):
                self.assertTrue(self.path.with_name(self.path.name + suffix).is_file())
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO pre_surveys VALUES (?,?,?,?,?,?,?,?,?,?)", ('missing',) * 10)
        with study_storage.connection() as reopened:
            self.assertEqual(reopened.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(reopened.execute('PRAGMA synchronous').fetchone()[0], 2)

    def test_invalid_configured_paths_never_fall_back(self):
        blocker = Path(self.temp.name) / 'not-a-directory'
        blocker.write_text('existing file')
        for configured in (str(blocker / 'study.sqlite'), str(Path(self.temp.name)), '', '  '):
            with self.subTest(configured=repr(configured)), patch.dict(os.environ, {'STUDY_DB_PATH': configured}):
                response = self.client.get('/study/health')
                self.assertEqual(response.status_code, 503)
                self.assertIn('storage configuration', response.json()['detail'])
                self.assertNotIn(str(self.temp.name), response.text)
                self.assertEqual(self.register().status_code, 503)
        self.assertEqual(list(Path(self.temp.name).rglob('*.sqlite')), [])

    def test_permission_denied_is_safe(self):
        with patch.object(Path, 'mkdir', side_effect=PermissionError('sensitive volume path')):
            response = self.client.get('/study/health')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('sensitive', response.text)
        self.assertFalse(self.path.exists())

    def test_read_only_database_is_not_reported_writable(self):
        study_storage.health()
        real_connect = sqlite3.connect

        def read_only_connect(path, **kwargs):
            self.assertEqual(path, self.path)
            return real_connect(f'{self.path.as_uri()}?mode=ro', uri=True, **kwargs)

        with patch.object(study_storage.sqlite3, 'connect', side_effect=read_only_connect):
            response = self.client.get('/study/health')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('database_writable', response.json())
        self.assertNotIn(str(self.path), response.text)

    def test_busy_timeout_and_recovery(self):
        with study_storage.connection() as holder:
            holder.execute('BEGIN IMMEDIATE')
            # Exercise the real locking path without waiting the production five seconds.
            with patch.object(study_storage, 'BUSY_TIMEOUT_MS', 50):
                started = time.monotonic()
                response = self.client.get('/study/health')
                self.assertGreaterEqual(time.monotonic() - started, 0.025)
                self.assertEqual(response.status_code, 503)
            holder.rollback()
        self.assertEqual(self.client.get('/study/health').status_code, 200)

    def test_health_does_not_expose_records_or_paths(self):
        self.register()
        self.batch(self.event(user_input_text='Private study conversation'))
        response = self.client.get('/study/health')
        self.assertEqual(response.status_code, 200)
        for value in (*self.identity.values(), str(self.path), 'Private study conversation', 'persistent'):
            self.assertNotIn(value, response.text)
        self.assertEqual(len(self.rows('study_sessions')), 1)
        self.assertEqual(len(self.rows('study_events')), 1)

    def test_registration_and_retry(self):
        self.assertTrue(self.register().json()['created'])
        self.assertFalse(self.register().json()['created'])
        row = self.rows('study_sessions')[0]
        self.assertEqual(row['participant_id'], self.identity['participant_id'])
        self.assertEqual(row['session_id'], self.identity['session_id'])
        self.assertTrue(row['server_created_at'])

    def test_invalid_identity(self):
        self.identity['participant_id'] = 'person@example.com'
        response = self.register()
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('person@example.com', response.text)
        self.assertFalse(self.path.exists())

    def test_pre_survey(self):
        self.register()
        payload = {**self.identity, 'submitted_at': self.time, 'expertise_area': 'clinical_research', 'career_stage': 'early_career', **{k: 'beginner' for k in ('causal_inference_experience', 'llm_experience', 'rag_experience', 'passive_sensing_experience')}}
        self.assertEqual(self.client.post('/study/surveys/pre', json={**payload, 'email': 'x@y.com'}).status_code, 422)
        self.assertEqual(self.client.post('/study/surveys/pre', json=payload).status_code, 200)
        self.assertFalse(self.client.post('/study/surveys/pre', json=payload).json()['created'])
        self.assertEqual(set(self.rows('pre_surveys')[0]), set(payload))

    def test_post_survey(self):
        self.register()
        payload = {**self.identity, 'submitted_at': self.time, **{k: 4 for k in ('overall_usability', 'trust_in_guidance', 'causal_workflow_clarity', 'ai_assistant_helpfulness', 'final_report_confidence')}, 'open_feedback': 'Contact x@example.com'}
        self.assertEqual(self.client.post('/study/surveys/post', json={**payload, 'name': 'Someone'}).status_code, 422)
        self.assertEqual(self.client.post('/study/surveys/post', json=payload).status_code, 200)
        row = self.rows('post_surveys')[0]
        self.assertEqual(set(row), set(payload))
        self.assertNotIn('x@example.com', row['open_feedback'])
        self.assertEqual(self.client.post('/study/surveys/post', json={**payload, 'overall_usability': 9}).status_code, 422)

    def test_click_and_duplicate(self):
        self.register()
        event = self.event()
        self.assertEqual(self.batch(event, event).json()['inserted'], 1)
        self.assertEqual(self.batch(event).json()['duplicates'], 1)
        self.assertEqual(len(self.rows('study_events')), 1)

    def test_chat_sources(self):
        self.register()
        events = [self.event(event_type='chat_user_message', user_input_text='Explain my result')]
        for source in ('llm_response', 'deterministic_response', 'fallback_response', 'error_response'):
            events.append(self.event(event_type='chat_assistant_response', assistant_output_text='Review the assumptions.', metadata_json={'source': source}))
        self.assertEqual(self.batch(*events).json()['inserted'], 5)
        rows = self.rows('study_events')
        self.assertEqual(rows[0]['user_input_text'], 'Explain my result')
        self.assertEqual(json.loads(rows[2]['metadata_json'])['source'], 'deterministic_response')

    def test_metadata_allowlist(self):
        self.register()
        metadata = {key: 'sensitive' for key in ('name', 'email', 'phone', 'address', 'age', 'gender', 'institution', 'location', 'ip', 'ip_address', 'device_id', 'filename', 'stack_trace', 'api_key', 'environment', 'request_payload', 'report', 'dataset', 'document_excerpt')}
        metadata.update(source='llm_response', row_count=12, nested={'email': 'x@y.com'})
        self.assertEqual(self.batch(self.event(metadata_json=metadata)).status_code, 200)
        stored = json.loads(self.rows('study_events')[0]['metadata_json'])
        self.assertEqual(stored, {'source': 'llm_response', 'row_count': 12, 'metadata_sanitized': True})

    def test_text_and_payload_limits(self):
        self.register()
        for overrides in ({'user_input_text': 'x'*8001}, {'metadata_json': {'other': 'x'*8193}}, {'event_type': 'anything'}, {'event_id': ''}):
            self.assertEqual(self.batch(self.event(**overrides)).status_code, 422)
        self.assertEqual(self.client.post('/study/events/batch', content='x'*256001).status_code, 413)
        self.assertEqual(self.rows('study_events'), [])

    def test_dashboard_event_metadata(self):
        self.register()
        request_id = str(uuid4())
        safe = {
            'request_id': request_id, 'from_phase': 'setup', 'to_phase': 'graph',
            'role': 'confounder', 'text_sanitized': True, 'text_truncated': True,
            'chunk_count': 233, 'failed_step': 'embedding',
            'error_category': 'action_failed',
        }
        self.assertEqual(self.batch(self.event(metadata_json={
            **safe, 'variable_name': 'private_column', 'filename': 'private.pdf',
            'request_payload': {'email': 'private@example.com'},
            'navigation_source': 'sidebar', 'file_count': 2, 'adjustment_variable_count': 3,
        })).status_code, 200)
        stored = json.loads(self.rows('study_events')[0]['metadata_json'])
        self.assertEqual(stored, {**safe, 'metadata_sanitized': True})
        self.assertEqual(self.batch(self.event(metadata_json={
            'request_id': 'private@example.com', 'file_type': 'private.pdf',
            'from_phase': 'private_value', 'role': 'private_column', 'file_count': -1,
            'text_sanitized': 'private', 'text_truncated': 1,
        })).status_code, 200)
        self.assertEqual(json.loads(self.rows('study_events')[1]['metadata_json']), {'metadata_sanitized': True})

    def test_visible_chat_storage_and_sanitization_marker(self):
        self.register()
        request_id = str(uuid4())
        user = self.event(event_type='chat_user_message', phase='question', user_input_text='What did the evidence show?', metadata_json={'request_id': request_id})
        answer = self.event(event_type='chat_assistant_response', phase='question', assistant_output_text='The cited study supports review, not causal proof.', metadata_json={'request_id': request_id, 'source': 'llm_response', 'retrieved_chunks': ['HIDDEN_CHUNK'], 'system_prompt': 'HIDDEN_PROMPT'})
        self.assertEqual(self.batch(user, answer).json()['inserted'], 2)
        rows = self.rows('study_events')
        self.assertEqual(rows[0]['user_input_text'], user['user_input_text'])
        self.assertEqual(rows[1]['assistant_output_text'], answer['assistant_output_text'])
        self.assertEqual(json.loads(rows[1]['metadata_json'])['request_id'], json.loads(rows[0]['metadata_json'])['request_id'])
        self.assertNotIn('HIDDEN_', json.dumps(rows))
        self.batch(self.event(event_type='chat_assistant_response', assistant_output_text='Contact person@example.com', metadata_json={'source': 'error_response'}))
        row = self.rows('study_events')[-1]
        self.assertEqual(row['assistant_output_text'], 'Contact [email removed]')
        self.assertTrue(json.loads(row['metadata_json'])['text_sanitized'])

    def test_unknown_session_and_atomic_conflict(self):
        self.assertEqual(self.batch(self.event()).status_code, 409)
        self.register()
        original = self.event()
        self.batch(original)
        self.assertEqual(self.batch(self.event(), {**original, 'event_label': 'changed'}).status_code, 409)
        self.assertEqual(len(self.rows('study_events')), 1)

    def test_sensitive_diagnostic_removed(self):
        self.register()
        self.batch(self.event(analysis_result_summary='Traceback (most recent call last): secret details'))
        self.assertEqual(self.rows('study_events')[0]['analysis_result_summary'], '[Sensitive content omitted]')

    def test_storage_failure_is_safe(self):
        with patch.object(study_storage, 'health', side_effect=sqlite3.OperationalError('secret database path')):
            response = self.client.get('/study/health')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', response.text)

    def test_import_and_path(self):
        self.assertIsNotNone(importlib.import_module('app.main').app)
        self.assertEqual(study_storage.database_path(), self.path)
        self.assertFalse(self.path.exists())
        with patch.dict(os.environ):
            os.environ.pop('STUDY_DB_PATH', None)
            self.assertEqual(study_storage.database_path().name, 'study.sqlite')
            self.assertEqual(study_storage.database_path().parent.name, 'study_data')


if __name__ == '__main__':
    unittest.main()
