"""Anonymous study collection only; deliberately no log-reading endpoints."""
from typing import Annotated, Literal
import sqlite3
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, ValidationError, field_validator, model_validator
from app.services import study_storage as storage
from app.services.study_privacy import safe_text, sanitize_metadata

router = APIRouter(prefix='/study', tags=['study'])
Token = Annotated[str, Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_.:-]+$')]
Participant = Annotated[str, Field(pattern=r'^participant_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
Session = Annotated[str, Field(pattern=r'^session_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
Text = Annotated[str, Field(max_length=8000)]
Experience = Literal['none', 'beginner', 'intermediate', 'advanced', 'prefer_not_to_answer']
Rating = Annotated[int, Field(strict=True, ge=1, le=5)]
EventType = Literal['page_view', 'phase_change', 'button_click', 'dataset_upload', 'document_upload', 'document_ingestion', 'rag_search', 'chat_user_message', 'chat_assistant_response', 'variable_selection', 'graph_action', 'feasibility_check', 'identification_check', 'estimation_action', 'report_export', 'pre_survey_submit', 'post_survey_submit', 'error']


class Identity(BaseModel):
    model_config = ConfigDict(extra='forbid')
    participant_id: Participant
    session_id: Session
    study_version: Token


class SessionRequest(Identity):
    client_created_at: AwareDatetime


class Survey(Identity):
    submitted_at: AwareDatetime


class PreSurvey(Survey):
    expertise_area: Literal['clinical_research', 'medicine', 'public_health', 'statistics', 'computer_science', 'engineering', 'behavioral_science', 'other', 'prefer_not_to_answer']
    career_stage: Literal['student', 'trainee', 'early_career', 'mid_career', 'senior', 'other', 'prefer_not_to_answer']
    causal_inference_experience: Experience
    llm_experience: Experience
    rag_experience: Experience
    passive_sensing_experience: Experience


class PostSurvey(Survey):
    overall_usability: Rating
    trust_in_guidance: Rating
    causal_workflow_clarity: Rating
    ai_assistant_helpfulness: Rating
    final_report_confidence: Rating
    open_feedback: Annotated[str, Field(max_length=4000)] = ''

    @field_validator('open_feedback')
    @classmethod
    def clean_feedback(cls, value):
        return safe_text(value)


class Event(Identity):
    event_id: Token
    client_timestamp: AwareDatetime
    phase: Literal['pre_survey', 'setup', 'data-foundation', 'explore', 'question', 'feasibility', 'graph', 'strategy', 'estimation', 'review', 'post_survey', 'unknown']
    event_type: EventType
    event_label: Token
    ui_element: Token = 'unspecified'
    user_input_text: Text = ''
    assistant_output_text: Text = ''
    analysis_result_summary: Annotated[str, Field(max_length=2000)] = ''
    metadata_json: dict = Field(default_factory=dict)

    @model_validator(mode='before')
    @classmethod
    def mark_text_sanitization(cls, value):
        # Preserve evidence of server-side redaction without retaining the original.
        # Leave text validation/length limits to the existing field validators.
        if isinstance(value, dict) and isinstance(value.get('metadata_json', {}), dict):
            fields = ('user_input_text', 'assistant_output_text', 'analysis_result_summary')
            if any(isinstance(value.get(key), str) and safe_text(value[key]) != value[key] for key in fields):
                value = {**value, 'metadata_json': {**value.get('metadata_json', {}), 'text_sanitized': True}}
        return value

    @field_validator('user_input_text', 'assistant_output_text', 'analysis_result_summary')
    @classmethod
    def clean_text(cls, value):
        return safe_text(value)

    @field_validator('metadata_json')
    @classmethod
    def clean_metadata(cls, value):
        return sanitize_metadata(value)


class Batch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    events: Annotated[list[Event], Field(min_length=1, max_length=100)]


async def parse(request, model):
    # Bound the body before JSON parsing; errors must never echo submitted text.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 256_000:
            raise HTTPException(413, 'Study request exceeds size limit.')
    try:
        return model.model_validate_json(body)
    except (ValidationError, ValueError):
        raise HTTPException(422, 'Invalid study request: check required fields, allowed values, IDs, timestamps and size limits.') from None


def store(call, *args):
    try:
        return call(*args)
    except storage.StudyConflict as error:
        raise HTTPException(409, str(error)) from None
    except (sqlite3.Error, OSError):
        raise HTTPException(503, 'Study storage unavailable. Please retry.') from None


@router.post('/sessions')
async def register(request: Request):
    data = await parse(request, SessionRequest)
    return {'status': 'ok', 'created': await run_in_threadpool(store, storage.register_session, data.model_dump(mode='json'))}


@router.post('/surveys/pre')
async def pre(request: Request):
    data = await parse(request, PreSurvey)
    return {'status': 'ok', 'created': await run_in_threadpool(store, storage.save_survey, 'pre', data.model_dump(mode='json'))}


@router.post('/surveys/post')
async def post(request: Request):
    data = await parse(request, PostSurvey)
    return {'status': 'ok', 'created': await run_in_threadpool(store, storage.save_survey, 'post', data.model_dump(mode='json'))}


@router.post('/events/batch')
async def events(request: Request):
    data = await parse(request, Batch)
    count = await run_in_threadpool(store, storage.save_events, [e.model_dump(mode='json') for e in data.events])
    return {'status': 'ok', 'inserted': count, 'duplicates': len(data.events) - count}


@router.get('/health')
def health():
    store(storage.health)
    return {'status': 'ok', 'storage_available': True}
