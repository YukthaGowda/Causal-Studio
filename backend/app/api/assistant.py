from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.assistant_chat import AssistantChatError, generate_assistant_response


router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    workflow_step: str | None = None
    top_k_evidence: int = Field(default=4, ge=1, le=10)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Assistant message cannot be empty.")
        return stripped_value


@router.post("/chat")
def chat_with_assistant(request: AssistantChatRequest) -> dict[str, Any]:
    try:
        return generate_assistant_response(
            message=request.message,
            workflow_step=request.workflow_step,
            top_k_evidence=request.top_k_evidence,
        )
    except AssistantChatError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
