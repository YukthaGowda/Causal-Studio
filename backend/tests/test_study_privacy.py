"""Synthetic text-only checks; never open a study database or call a service.

The same fixtures drive the JS privacy and queue tests. Node is only needed for
the cross-language check; the Python-only checks run without frontend tooling.
"""
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest.mock import patch

from app.api.study import Event
from app.services.study_privacy import safe_text

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((Path(__file__).parent / 'fixtures' / 'study_text_privacy.json').read_text())
IDENTITY = {
    'participant_id': 'participant_00000000-0000-4000-8000-000000000001',
    'session_id': 'session_00000000-0000-4000-8000-000000000002',
    'study_version': 'synthetic-privacy-test-v1',
}
BASE = dict(IDENTITY, event_id='00000000-0000-4000-8000-000000000003',
            client_timestamp='2026-09-27T12:00:00Z', phase='estimation',
            event_type='chat_assistant_response', event_label='synthetic_response')
REQUEST_ID = '00000000-0000-4000-8000-000000000004'


class StudyPrivacyTests(unittest.TestCase):
    def setUp(self):
        database = patch('sqlite3.connect', side_effect=AssertionError('Privacy tests must not access any database'))
        database.start()
        self.addCleanup(database.stop)

    def test_shared_fixture_coverage(self):
        self.assertEqual(sum(row['original'] for row in FIXTURES), 28)
        self.assertEqual(len({row['name'] for row in FIXTURES}), len(FIXTURES))

    def test_backend_filter_and_repeated_filtering(self):
        for sample in FIXTURES:
            with self.subTest(case=sample['name']):
                self.assertEqual(safe_text(sample['text']), sample['expected'])
                self.assertEqual(safe_text(safe_text(sample['text'])), sample['expected'])

    def test_event_validation_marks_actual_changes_and_preserves_identity(self):
        for sample in FIXTURES:
            for field in ('user_input_text', 'assistant_output_text'):
                with self.subTest(case=sample['name'], field=field):
                    event = Event.model_validate({**BASE, field: sample['text'],
                        'metadata_json': {'source': 'deterministic_response', 'request_id': REQUEST_ID}})
                    self.assertEqual(getattr(event, field), sample['expected'])
                    self.assertEqual(event.metadata_json.get('text_sanitized', False), sample['text'] != sample['expected'])
                    self.assertNotIn('text_truncated', event.metadata_json)
                    self.assertEqual(event.phase, 'estimation')
                    self.assertEqual(event.event_id, BASE['event_id'])
                    for key, value in IDENTITY.items():
                        self.assertEqual(getattr(event, key), value)
                    self.assertEqual(event.metadata_json['request_id'], REQUEST_ID)
                    self.assertEqual(event.metadata_json['source'], 'deterministic_response')
                    self.assertEqual(Event.model_validate_json(event.model_dump_json()), event)

    def test_historical_redaction_and_truncation_markers_are_never_reversed(self):
        text = 'Point estimate -2.[phone-like text removed]% CI; [email removed].'
        for truncated in (False, True):
            metadata = {'text_sanitized': True, **({'text_truncated': True} if truncated else {})}
            event = Event.model_validate({**BASE, 'assistant_output_text': text, 'metadata_json': metadata})
            self.assertEqual(event.assistant_output_text, text)
            self.assertEqual(event.metadata_json, metadata)

    @unittest.skipUnless(shutil.which('node'), 'Node required for frontend-to-backend privacy verification')
    def test_frontend_to_backend_matches_shared_expectations(self):
        # Invoke the real frontend event builder; transport/storage are in-memory
        # doubles, and no browser, API, model, database, or export is used.
        script = r'''
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createStudyEventLogger } from './frontend/src/lib/studyEvents.js';
globalThis.fetch=()=>{throw Error('No network in synthetic privacy tests');};
const {samples,identity}=JSON.parse(readFileSync(0,'utf8')), outputs=[];
for(const sample of samples) {
 const sent=[];
 const logger=createStudyEventLogger({getIdentity:()=>identity,uuid:()=>webcrypto.randomUUID(),
  now:()=> '2026-09-27T12:00:00Z',schedule:()=>1,cancel:()=>{},
  store:{load:async()=>[],put:async()=>true,update:async()=>{},remove:async()=>{}},
  send:async events=>{sent.push(...events);return {status:'ok',inserted:events.length,duplicates:0};}});
 const metadata={request_id:webcrypto.randomUUID(),response_source:'deterministic_response',
  system_prompt:'HIDDEN_PROMPT',retrieved_chunks:['HIDDEN_RAG'],backend_context:'HIDDEN_CONTEXT'};
 logger.log({event_type:'chat_user_message',event_label:'synthetic_input',phase:'estimation',submitted:true,user_input_text:sample.text,metadata});
 logger.log({event_type:'chat_assistant_response',event_label:'synthetic_response',phase:'estimation',displayed:true,assistant_output_text:sample.text,metadata});
 await logger.flush();logger.stop();outputs.push(sent);
}
process.stdout.write(JSON.stringify(outputs));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                input=json.dumps({'samples': FIXTURES, 'identity': IDENTITY}),
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        outputs = json.loads(result.stdout)
        self.assertEqual(len(outputs), len(FIXTURES))
        for sample, pair in zip(FIXTURES, outputs, strict=True):
            with self.subTest(case=sample['name']):
                self.assertEqual(len(pair), 2)
                self.assertEqual(pair[0]['metadata_json']['request_id'], pair[1]['metadata_json']['request_id'])
                self.assertNotIn('HIDDEN_', json.dumps(pair))
                for wire in pair:
                    field = 'user_input_text' if wire['event_type'] == 'chat_user_message' else 'assistant_output_text'
                    self.assertEqual(wire[field], sample['expected'], 'frontend-only result')
                    backend = Event.model_validate_json(json.dumps(wire))
                    self.assertEqual(getattr(backend, field), sample['expected'], 'combined result')
                    self.assertEqual(backend.metadata_json, wire['metadata_json'])
                    self.assertEqual(backend.event_id, wire['event_id'])
                    self.assertEqual(backend.phase, wire['phase'])
                    for key in IDENTITY:
                        self.assertEqual(getattr(backend, key), wire[key])


if __name__ == '__main__':
    unittest.main()
