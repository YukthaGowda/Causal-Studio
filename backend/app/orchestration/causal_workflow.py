from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.services.broad_exploration import BroadExplorationError, explore_broad_dataset
from app.services.causal_questions import CausalQuestionGenerationError, resolve_dataset_path
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema
from app.services.report_generation import ReportGenerationError, generate_report
from app.services.targeted_feasibility import (
    TargetedFeasibilityError,
    run_targeted_feasibility,
)
from app.orchestration.workflow_state import (
    WorkflowState,
    create_initial_state,
    mark_completed,
    refresh_step_name,
    step_name,
    workflow_message,
)


WORKFLOWS: dict[str, WorkflowState] = {}


class WorkflowError(RuntimeError):
    pass


def node_for_step(step: int):
    def node(state: WorkflowState) -> WorkflowState:
        state["current_step"] = step
        state["current_step_name"] = step_name(step)
        return refresh_step_name(state)

    return node


def build_causal_workflow():
    graph = StateGraph(WorkflowState)
    for step in range(1, 9):
        graph.add_node(f"step_{step}", node_for_step(step))
    graph.set_entry_point("step_1")
    for step in range(1, 8):
        graph.add_edge(f"step_{step}", f"step_{step + 1}")
    graph.add_edge("step_8", END)
    return graph.compile()


CAUSAL_WORKFLOW_GRAPH = build_causal_workflow()


def get_state(workflow_id: str) -> WorkflowState:
    try:
        return WORKFLOWS[workflow_id]
    except KeyError as error:
        raise WorkflowError("Workflow was not found. In-memory workflow state resets when the backend restarts.") from error


def save_state(state: WorkflowState) -> WorkflowState:
    refresh_step_name(state)
    WORKFLOWS[state["workflow_id"]] = state
    return state


def merge_inputs(state: WorkflowState, inputs: dict[str, Any] | None) -> WorkflowState:
    if not inputs:
        return state
    for key, value in inputs.items():
        if value is not None:
            state[key] = value
    return state


def start_workflow(initial_values: dict[str, Any] | None = None) -> WorkflowState:
    state = create_initial_state(initial_values)
    state["next_required_user_action"] = (
        "Confirm project title/objective and document upload or ingestion status. "
        "Workflow state is stored in memory and resets when the backend restarts."
    )
    return save_state(state)


def block(state: WorkflowState, message: str, revise_to_step: int | None = None) -> WorkflowState:
    state.setdefault("errors", []).append(workflow_message(message, "blocking"))
    state["next_required_user_action"] = message
    if revise_to_step is not None:
        state["current_step"] = revise_to_step
    return save_state(state)


def advance_to(state: WorkflowState, next_step: int, message: str) -> WorkflowState:
    previous_step = int(state.get("current_step", 1))
    mark_completed(state, previous_step)
    state["current_step"] = next_step
    state["next_required_user_action"] = message
    return save_state(state)


def advance_step_1(state: WorkflowState) -> WorkflowState:
    if not state.get("research_objective") and not state.get("project_title"):
        return block(state, "Step 1 requires a project title or research objective before advancing.")
    state.setdefault("warnings", []).append(
        workflow_message("Human checkpoint: confirm document upload/ingestion before relying on RAG evidence.", "info")
    )
    return advance_to(state, 2, "Review dataset schema and confirm the uploaded CSV dataset.")


def advance_step_2(state: WorkflowState) -> WorkflowState:
    dataset_filename = state.get("dataset_filename")
    if not dataset_filename:
        return block(state, "Step 2 requires dataset_filename before schema review can advance.")
    try:
        dataset_path = resolve_dataset_path(dataset_filename)
        if not state.get("schema_summary"):
            state["schema_summary"] = parse_dataset_schema(dataset_path)
    except (CausalQuestionGenerationError, DatasetSchemaError) as error:
        return block(state, f"Dataset schema parsing failed: {error}")
    return advance_to(state, 3, "Review broad exploration before selecting a final question or variables.")


def advance_step_3(state: WorkflowState) -> WorkflowState:
    dataset_filename = state.get("dataset_filename")
    if not dataset_filename:
        return block(state, "Step 3 requires dataset_filename.", revise_to_step=2)
    try:
        if not state.get("broad_exploration_summary"):
            state["broad_exploration_summary"] = explore_broad_dataset(
                dataset_filename=dataset_filename,
            )
    except BroadExplorationError as error:
        return block(state, f"Broad exploration failed: {error}", revise_to_step=2)
    warnings = state["broad_exploration_summary"].get("data_quality_warnings", [])
    if any(warning.get("severity") in {"high", "blocking"} for warning in warnings):
        state.setdefault("warnings", []).append(
            workflow_message("Broad exploration found major data-quality warnings; user may continue with warnings or revise the dataset.", "warning")
        )
    return advance_to(state, 4, "Select or confirm a candidate causal question.")


def advance_step_4(state: WorkflowState) -> WorkflowState:
    if not state.get("selected_candidate_question"):
        return block(state, "Step 4 requires a selected candidate question before targeted feasibility.")
    if not state.get("selected_variables"):
        return block(state, "Step 4 requires selected variables before targeted feasibility.")
    return advance_to(state, 5, "Run and review targeted variable feasibility.")


def advance_step_5(state: WorkflowState) -> WorkflowState:
    if not state.get("targeted_feasibility_result"):
        try:
            state["targeted_feasibility_result"] = run_targeted_feasibility(
                dataset_filename=state.get("dataset_filename") or "",
                confirmed_question=str(state.get("selected_candidate_question") or state.get("research_objective") or ""),
                selected_variables=state.get("selected_variables", []),
                exposure=state.get("exposure"),
                outcome=state.get("outcome"),
                participant_id_column=state.get("participant_id_column"),
                timestamp_column=state.get("timestamp_column"),
                lag_definition=state.get("lag_definition"),
            )
        except TargetedFeasibilityError as error:
            return block(state, f"Targeted feasibility failed: {error}", revise_to_step=4)
    if not state["targeted_feasibility_result"].get("safe_to_continue_to_graph"):
        return block(
            state,
            "Targeted feasibility is not safe to continue to graph. Return to Step 4 and revise question or variables.",
            revise_to_step=4,
        )
    return advance_to(state, 6, "Review final roles and graph validation.")


def advance_step_6(state: WorkflowState) -> WorkflowState:
    role_status = (state.get("role_validation_result") or {}).get("validation_status")
    graph_status = (state.get("graph_validation_result") or {}).get("graph_validation_status")
    if not state.get("role_recommendations") or not state.get("role_validation_result"):
        return block(state, "Step 6 requires role recommendations and deterministic role validation.")
    if role_status == "failed":
        return block(state, "Role validation failed. Revise Step 4 or Step 5 inputs before continuing.")
    if not state.get("graph") or not state.get("graph_validation_result"):
        return block(state, "Step 6 requires graph draft and graph validation.")
    if graph_status == "failed":
        return block(state, "Graph validation failed. Remain at Step 6 and revise graph.")
    return advance_to(state, 7, "Run identification, analysis strategy, and assumptions review.")


def advance_step_7(state: WorkflowState) -> WorkflowState:
    identification = state.get("identification_result") or {}
    strategy = state.get("analysis_strategy") or {}
    assumptions = state.get("assumptions_review") or {}
    if not identification:
        return block(state, "Step 7 requires identification result.")
    if identification.get("identification_status") == "not_identifiable_with_current_design":
        return block(state, "Identification is not valid with current design. Return to Step 6 or earlier.", revise_to_step=6)
    strategy_status = strategy.get("strategy_status") or strategy.get("strategy_plan", {}).get("strategy_status")
    if not strategy or strategy_status in {"not_ready_for_analysis", "requires_design_revision"}:
        return block(state, "Analysis strategy is missing or not ready. Remain at Step 7.")
    assumption_status = assumptions.get("review_status") or assumptions.get("review", {}).get("review_status")
    if not assumptions or assumption_status in {"not_ready", "requires_design_revision"}:
        return block(state, "Assumptions review is missing or not ready. Remain at Step 7.")
    return advance_to(state, 8, "Generate and review the final guidance report.")


def advance_step_8(state: WorkflowState) -> WorkflowState:
    if not state.get("assumptions_review"):
        return block(state, "Step 8 is blocked because assumptions review is missing.", revise_to_step=7)
    if not state.get("report"):
        try:
            state["report"] = generate_report(
                project_title=state.get("project_title"),
                research_objective=state.get("research_objective"),
                confirmed_question=str(state.get("selected_candidate_question") or state.get("research_objective") or ""),
                dataset_filename=state.get("dataset_filename") or "",
                schema_summary=state.get("schema_summary"),
                broad_exploration_summary=state.get("broad_exploration_summary"),
                candidate_questions=state.get("candidate_questions"),
                selected_candidate_question=state.get("selected_candidate_question"),
                candidate_variables=state.get("candidate_variables"),
                targeted_feasibility_result=state.get("targeted_feasibility_result"),
                selected_variables=state.get("selected_variables", []),
                role_recommendations=state.get("role_recommendations", []),
                role_validation_result=state.get("role_validation_result"),
                graph=state.get("graph") or {},
                graph_validation_result=state.get("graph_validation_result"),
                identification_result=state.get("identification_result") or {},
                analysis_strategy=state.get("analysis_strategy") or {},
                assumptions_review=state.get("assumptions_review") or {},
            )
        except ReportGenerationError as error:
            return block(state, f"Report generation failed: {error}")
    mark_completed(state, 8)
    state["next_required_user_action"] = "Review report JSON. PDF export can be added later."
    return save_state(state)


ADVANCE_HANDLERS = {
    1: advance_step_1,
    2: advance_step_2,
    3: advance_step_3,
    4: advance_step_4,
    5: advance_step_5,
    6: advance_step_6,
    7: advance_step_7,
    8: advance_step_8,
}


def advance_workflow(workflow_id: str, inputs: dict[str, Any] | None = None) -> WorkflowState:
    state = merge_inputs(get_state(workflow_id), inputs)
    state["errors"] = []
    step = int(state.get("current_step", 1))
    handler = ADVANCE_HANDLERS.get(step)
    if handler is None:
        return block(state, f"Unknown workflow step: {step}")
    return handler(state)


def confirm_workflow(workflow_id: str, confirmation: dict[str, Any]) -> WorkflowState:
    state = merge_inputs(get_state(workflow_id), confirmation)
    step = int(state.get("current_step", 1))
    mark_completed(state, step)
    state["next_required_user_action"] = f"Confirmed Step {step}. Use advance to continue."
    return save_state(state)


def revise_workflow(workflow_id: str, target_step: int, reason: str | None = None) -> WorkflowState:
    if target_step < 1 or target_step > 8:
        raise WorkflowError("target_step must be between 1 and 8.")
    state = get_state(workflow_id)
    state["current_step"] = target_step
    state["completed_steps"] = [step for step in state.get("completed_steps", []) if step < target_step]
    state.setdefault("warnings", []).append(
        workflow_message(reason or f"User revised workflow back to Step {target_step}.", "warning")
    )
    state["next_required_user_action"] = f"Revise inputs for Step {target_step}: {step_name(target_step)}."
    return save_state(state)
