from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, TypedDict
from uuid import uuid4


WORKFLOW_STEPS = {
    1: "Project Setup and Document Upload",
    2: "Data Foundation and Understanding",
    3: "Broad Data Exploration",
    4: "Causal Question and Provisional Variable Design",
    5: "Targeted Variable Data Exploration and Feasibility Check",
    6: "Causal Graph and Final Role Validation",
    7: "Identification and Estimation Strategy",
    8: "Review and Export",
}


class WorkflowState(TypedDict, total=False):
    workflow_id: str
    current_step: int
    current_step_name: str
    completed_steps: list[int]
    project_title: str | None
    research_objective: str | None
    uploaded_documents: list[dict[str, Any]]
    document_ingestion_status: dict[str, Any] | None
    dataset_filename: str | None
    schema_summary: dict[str, Any] | None
    broad_exploration_summary: dict[str, Any] | None
    candidate_questions: list[dict[str, Any]]
    selected_candidate_question: dict[str, Any] | str | None
    candidate_variables: list[dict[str, Any]]
    selected_variables: list[Any]
    targeted_feasibility_result: dict[str, Any] | None
    role_recommendations: list[dict[str, Any]]
    role_validation_result: dict[str, Any] | None
    graph: dict[str, Any] | None
    graph_validation_result: dict[str, Any] | None
    identification_result: dict[str, Any] | None
    analysis_strategy: dict[str, Any] | None
    assumptions_review: dict[str, Any] | None
    report: dict[str, Any] | None
    warnings: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    next_required_user_action: str
    updated_at: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def step_name(step: int) -> str:
    return WORKFLOW_STEPS.get(step, "Unknown Step")


def create_initial_state(initial_values: dict[str, Any] | None = None) -> WorkflowState:
    state: WorkflowState = {
        "workflow_id": uuid4().hex,
        "current_step": 1,
        "current_step_name": step_name(1),
        "completed_steps": [],
        "uploaded_documents": [],
        "candidate_questions": [],
        "candidate_variables": [],
        "selected_variables": [],
        "role_recommendations": [],
        "warnings": [],
        "errors": [],
        "next_required_user_action": "Add project setup details and confirm document upload or ingestion status.",
        "updated_at": utc_now(),
    }
    if initial_values:
        state.update({key: value for key, value in initial_values.items() if value is not None})
    return refresh_step_name(state)


def refresh_step_name(state: WorkflowState) -> WorkflowState:
    state["current_step_name"] = step_name(int(state.get("current_step", 1)))
    state["updated_at"] = utc_now()
    return state


def workflow_message(message: str, severity: str = "warning") -> dict[str, str]:
    return {"message": message, "severity": severity}


def mark_completed(state: WorkflowState, step: int) -> None:
    completed = list(state.get("completed_steps", []))
    if step not in completed:
        completed.append(step)
    state["completed_steps"] = sorted(completed)
