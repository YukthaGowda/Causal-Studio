"""Isolated SQLite study storage, initialized lazily (never during import)."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3


class StudyConflict(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def database_path():
    return Path(os.environ.get('STUDY_DB_PATH') or Path(__file__).resolve().parents[2] / 'study_data' / 'study.sqlite')


@contextmanager
def connection():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS study_sessions (
          participant_id TEXT NOT NULL, session_id TEXT PRIMARY KEY, study_version TEXT NOT NULL,
          client_created_at TEXT NOT NULL, server_created_at TEXT NOT NULL,
          UNIQUE(participant_id, session_id, study_version));
        CREATE TABLE IF NOT EXISTS pre_surveys (
          participant_id TEXT NOT NULL, session_id TEXT PRIMARY KEY, study_version TEXT NOT NULL, submitted_at TEXT NOT NULL,
          expertise_area TEXT NOT NULL, career_stage TEXT NOT NULL, causal_inference_experience TEXT NOT NULL,
          llm_experience TEXT NOT NULL, rag_experience TEXT NOT NULL, passive_sensing_experience TEXT NOT NULL,
          FOREIGN KEY(participant_id,session_id,study_version) REFERENCES study_sessions(participant_id,session_id,study_version));
        CREATE TABLE IF NOT EXISTS post_surveys (
          participant_id TEXT NOT NULL, session_id TEXT PRIMARY KEY, study_version TEXT NOT NULL, submitted_at TEXT NOT NULL,
          overall_usability INTEGER NOT NULL, trust_in_guidance INTEGER NOT NULL, causal_workflow_clarity INTEGER NOT NULL,
          ai_assistant_helpfulness INTEGER NOT NULL, final_report_confidence INTEGER NOT NULL, open_feedback TEXT NOT NULL,
          FOREIGN KEY(participant_id,session_id,study_version) REFERENCES study_sessions(participant_id,session_id,study_version));
        CREATE TABLE IF NOT EXISTS study_events (
          event_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, session_id TEXT NOT NULL, study_version TEXT NOT NULL,
          client_timestamp TEXT NOT NULL, server_timestamp TEXT NOT NULL, phase TEXT NOT NULL, event_type TEXT NOT NULL,
          event_label TEXT NOT NULL, ui_element TEXT NOT NULL, user_input_text TEXT NOT NULL, assistant_output_text TEXT NOT NULL,
          analysis_result_summary TEXT NOT NULL, metadata_json TEXT NOT NULL,
          FOREIGN KEY(participant_id,session_id,study_version) REFERENCES study_sessions(participant_id,session_id,study_version));
        ''')
        with db:
            yield db
    finally:
        db.close()


def require_session(db, data):
    row = db.execute('SELECT 1 FROM study_sessions WHERE participant_id=? AND session_id=? AND study_version=?',
                     tuple(data[k] for k in ('participant_id', 'session_id', 'study_version'))).fetchone()
    if not row:
        raise StudyConflict('Register this session and study version first.')


def insert_once(db, table, data, key, ignored=()):
    existing = db.execute(f'SELECT * FROM {table} WHERE {key}=?', (data[key],)).fetchone()
    if existing:
        if any(existing[k] != v for k, v in data.items() if k not in ignored):
            raise StudyConflict('Identifier already exists with different content.')
        return False
    columns = list(data)
    db.execute(f'INSERT INTO {table} ({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})', tuple(data.values()))
    return True


def register_session(data):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        return insert_once(db, 'study_sessions', dict(data, server_created_at=now()), 'session_id', ('server_created_at',))


def save_survey(kind, data):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        require_session(db, data)
        return insert_once(db, {'pre': 'pre_surveys', 'post': 'post_surveys'}[kind], data, 'session_id')


def save_events(events):
    inserted = 0
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        for event in events:
            require_session(db, event)
            data = dict(event, server_timestamp=now())
            data['metadata_json'] = json.dumps(data['metadata_json'], sort_keys=True)
            inserted += insert_once(db, 'study_events', data, 'event_id', ('server_timestamp',))
    return inserted


def health():
    with connection() as db:
        db.execute('SELECT 1').fetchone()
    return True
