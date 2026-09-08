import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.assistant_actions import (
    SUPPORTED_ACTIONS,
    SUPPORTED_PHASES,
    AssistantActionError,
    run_assistant_action,
)
from app.services.assistant_chat import AssistantChatError, generate_assistant_response


router = APIRouter(prefix="/assistant", tags=["assistant"])


class ChatTurn(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(..., min_length=1, max_length=4000)


class AssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    workflow_step: str | None = None
    top_k_evidence: int = Field(default=4, ge=1, le=10)
    context: dict[str, Any] | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)

    @field_validator('context')
    @classmethod
    def validate_context(cls, value: dict[str, Any] | None):
        if value is not None and len(json.dumps(value)) > 200_000:
            raise ValueError('Dashboard context is too large. Reduce graph or evidence detail.')
        return value

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Assistant message cannot be empty.")
        return stripped_value


class AssistantActionRequest(BaseModel):
    phase: str = Field(..., min_length=1)
    action: str = Field(..., min_length=1)
    page_state: dict[str, Any] = Field(default_factory=dict)
    selected_item: dict[str, Any] = Field(default_factory=dict)
    user_feedback: str = ""
    rag_evidence: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("phase")
    @classmethod
    def validate_phase(cls, value: str) -> str:
        stripped_value = value.strip()
        if stripped_value not in SUPPORTED_PHASES:
            raise ValueError("Missing or unsupported phase.")
        return stripped_value

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        stripped_value = value.strip()
        if stripped_value not in SUPPORTED_ACTIONS:
            raise ValueError("Missing or unsupported action.")
        return stripped_value


@router.post("/chat")
def chat_with_assistant(request: AssistantChatRequest) -> dict[str, Any]:
    try:
        return generate_assistant_response(
            message=request.message,
            workflow_step=request.workflow_step,
            top_k_evidence=request.top_k_evidence,
            context=request.context,
            history=[turn.model_dump() for turn in request.history],
        )
    except AssistantChatError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/action")
def run_contextual_assistant_action(request: AssistantActionRequest) -> dict[str, Any]:
    try:
        return run_assistant_action(
            phase=request.phase,
            action=request.action,
            page_state=request.page_state,
            selected_item=request.selected_item,
            user_feedback=request.user_feedback,
            rag_evidence=request.rag_evidence,
        )
    except AssistantActionError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
