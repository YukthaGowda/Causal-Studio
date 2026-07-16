from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.broad_exploration import (
    BroadExplorationError,
    explore_broad_dataset,
)


router = APIRouter(prefix="/exploration", tags=["exploration"])


class BroadExplorationRequest(BaseModel):
    dataset_filename: str = Field(..., min_length=1)
    max_columns: int = Field(default=30, ge=2, le=50)
    target_column: str | None = None
    participant_id_column: str | None = None
    timestamp_column: str | None = None

    @field_validator("dataset_filename")
    @classmethod
    def validate_dataset_filename(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Dataset filename cannot be empty.")
        return stripped_value


@router.post("/broad")
def run_broad_exploration(request: BroadExplorationRequest) -> dict[str, Any]:
    try:
        return explore_broad_dataset(
            dataset_filename=request.dataset_filename,
            max_columns=request.max_columns,
            target_column=request.target_column,
            participant_id_column=request.participant_id_column,
            timestamp_column=request.timestamp_column,
        )
    except BroadExplorationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
