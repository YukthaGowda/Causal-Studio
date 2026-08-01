from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.rag.search import RagSearchError, search_rag_chunks
from app.services.causal_questions import DEFAULT_MODEL, format_openai_error, summarize_evidence


QUESTION_STATUSES = {"success", "fallback", "error"}
VARIABLE_STATUSES = {
    "recommended",
    "consider",
    "not_recommended_for_adjustment",
    "unavailable_but_important",
    "redundant",
    "potential_derived_feature",
}
MEASUREMENT_ROLES = {"direct_measure", "proxy", "derived_feature", "unknown"}
TEMPORAL_ROLES = {"baseline", "time_varying", "post_treatment", "unknown"}
STRUCTURAL_ROLES = {
    "exposure",
    "outcome",
    "confounder",
    "mediator",
    "collider_candidate",
    "effect_modifier",
    "proxy",
    "unknown",
}


class Phase4DesignError(RuntimeError):
    pass


def _schema_columns(schema_summary: dict[str, Any]) -> list[str]:
    columns = schema_summary.get("column_names") or schema_summary.get("columns") or []
    if isinstance(columns, list):
        return [str(column) for column in columns]
    return []


def _first_matching(columns: list[str], keywords: list[str], default: str = "") -> str:
    lowered = [(column, column.lower()) for column in columns]
    for keyword in keywords:
        for original, lower in lowered:
            if keyword in lower:
                return original
    return default


def _available_evidence(rag_evidence: list[dict[str, Any]], query: str) -> tuple[list[dict[str, Any]], list[str]]:
    if rag_evidence:
        return rag_evidence[:6], []
    if not query.strip():
        return [], ["No supporting evidence found in uploaded documents."]
    # Keep Phase 4 generation responsive. The frontend can pass RAG evidence when
    # it has already been retrieved; otherwise absence of evidence must not block
    # structured draft generation or force an expensive embedding-model load.
    return [], ["No supporting evidence found in uploaded documents."]


def _evidence_notes(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    notes = []
    for item in evidence[:3]:
        notes.append(
            {
                "source_filename": item.get("source_filename") or item.get("filename") or "uploaded evidence",
                "page_number": item.get("page_number"),
                "chunk_index": item.get("chunk_index"),
                "evidence_type": "rag_chunk",
                "snippet": str(item.get("chunk_text") or item.get("text") or "")[:280],
            }
        )
    return notes


def _fallback_questions(
    *,
    research_objective: str,
    dataset_filename: str,
    schema_summary: dict[str, Any],
    rag_evidence: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    columns = _schema_columns(schema_summary)
    id_col = _first_matching(columns, ["pid", "participant", "subject", "id"], "participants")
    timestamp_col = _first_matching(columns, ["time_stamp", "timestamp", "date", "day"], "observation window")
    outcome = _first_matching(columns, ["label", "alcohol", "drink", "craving", "use"], "alcohol-use-related outcome")
    sleep = _first_matching(columns, ["sleep"], "sleep-related features")
    stress = _first_matching(columns, ["stress"], "stress-related signals")
    sensing = _first_matching(columns, ["acc_", "magnitude", "latitude", "location", "phone"], "passive sensing features")
    evidence = _evidence_notes(rag_evidence)

    questions = [
        {
            "id": "q1",
            "status": "ai_generated_draft",
            "question_text": (
                f"Among adults in the uploaded dataset, what is the association between {sensing} during window t "
                f"and {outcome} in the next observation window?"
            ),
            "population": "Adults represented in the uploaded EMA/passive-sensing dataset",
            "exposure": sensing,
            "comparator": "Higher versus lower values during window t",
            "outcome": outcome,
            "time_window": f"Window t to next observation window using {timestamp_col}",
            "unit_of_analysis": f"{id_col}-window" if id_col != "participants" else "participant-window",
            "within_or_between_person": "within-person focus, if repeated participant observations are available",
            "initial_estimand_direction": "Difference in next-window outcome risk or mean associated with exposure contrast",
            "supporting_evidence": evidence,
            "preliminary_data_feasibility": "Preliminary only: selected columns appear in the schema; feasibility requires Phase 5 checks.",
            "limitations": [
                "Draft only; causal validity has not been established.",
                "Timing, missingness, and confounding must be checked by deterministic backend validation.",
            ],
            "requires_user_review": True,
        },
        {
            "id": "q2",
            "status": "ai_generated_draft",
            "question_text": (
                f"Among participants with available repeated observations, what is the association between {sleep} "
                f"during window t and {outcome} during the following window?"
            ),
            "population": "Participants with usable repeated EMA/passive-sensing observations",
            "exposure": sleep,
            "comparator": "Poorer versus better sleep-related values",
            "outcome": outcome,
            "time_window": f"Lagged next-window relationship indexed by {timestamp_col}",
            "unit_of_analysis": "participant-window",
            "within_or_between_person": "within-person focus",
            "initial_estimand_direction": "Total effect direction to be reviewed after graph validation",
            "supporting_evidence": evidence,
            "preliminary_data_feasibility": (
                "Sleep construct may be unavailable if no sleep-specific columns exist; user should confirm source variables."
            ),
            "limitations": ["Draft only; sleep may be a construct rather than a directly available dataset column."],
            "requires_user_review": True,
        },
        {
            "id": "q3",
            "status": "ai_generated_draft",
            "question_text": (
                f"Among adults in the uploaded study data, what is the association between {stress} or contextual signals "
                f"during window t and {outcome} in a later window?"
            ),
            "population": "Adults in the uploaded study data",
            "exposure": stress,
            "comparator": "Elevated versus lower stress/context values",
            "outcome": outcome,
            "time_window": "Window t to later outcome window",
            "unit_of_analysis": "participant-window",
            "within_or_between_person": "within-person or mixed within/between-person focus, to be confirmed",
            "initial_estimand_direction": "Association compatible with a causal estimand only after graph and identification review",
            "supporting_evidence": evidence,
            "preliminary_data_feasibility": "Preliminary only; stress/context columns and temporal ordering require review.",
            "limitations": ["Do not interpret exploratory association as causal evidence."],
            "requires_user_review": True,
        },
    ]
    return {
        "status": "fallback",
        "questions": questions,
        "warnings": [
            "LLM generation is unavailable, so these are deterministic placeholder candidates based on available schema fields.",
            *warnings,
        ],
        "recommended_next_actions": [
            "Review and edit population, comparator, outcome, and time window.",
            "Confirm one question before running targeted feasibility checks.",
        ],
    }


def _fallback_variables(
    *,
    confirmed_question: str,
    schema_summary: dict[str, Any],
    rag_evidence: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    columns = _schema_columns(schema_summary)
    missing_pct = schema_summary.get("missing_value_percentage_per_column") or {}
    numeric = set(schema_summary.get("possible_numeric_columns") or [])
    timestamps = set(schema_summary.get("possible_timestamp_date_columns") or schema_summary.get("possible_timestamp_columns") or [])
    ids = set(schema_summary.get("possible_id_columns") or [])
    evidence = _evidence_notes(rag_evidence)

    def category(name: str) -> str:
        lower = name.lower()
        if name in ids or "pid" in lower or "id" == lower:
            return "identifier"
        if name in timestamps or "time" in lower or "day" in lower or "date" in lower:
            return "temporal_context"
        if "acc" in lower or "heart" in lower:
            return "wearable_sensing"
        if "lat" in lower or "lon" in lower or "phone" in lower or "screen" in lower:
            return "smartphone_sensing"
        if "label" in lower or "alcohol" in lower or "drink" in lower:
            return "ema_self_report"
        return "derived_or_unknown"

    candidates = []
    for name in columns[:30]:
        lower = name.lower()
        miss = missing_pct.get(name, 0)
        if name in ids:
            status = "not_recommended_for_adjustment"
            structural = "unknown"
            rationale = "Identifier/grouping fields should support clustering/linkage, not be treated as causal variables."
        elif "label" in lower or "alcohol" in lower:
            status = "recommended"
            structural = "outcome"
            rationale = "Outcome-like field relevant to alcohol-use-related question; must be confirmed by the user."
        elif "sleep" in lower or "acc" in lower or "stress" in lower:
            status = "recommended"
            structural = "exposure" if ("sleep" in lower or "acc" in lower) else "confounder"
            rationale = "Potentially relevant time-varying signal for the confirmed question."
        elif name in timestamps:
            status = "consider"
            structural = "confounder"
            rationale = "Temporal/context field useful for timing and adjustment review, not final causal role assignment."
        elif miss and miss >= 30:
            status = "consider"
            structural = "proxy"
            rationale = "Potentially useful proxy/context field, but high missingness requires Phase 5 review."
        elif name in numeric:
            status = "consider"
            structural = "unknown"
            rationale = "Numeric field may be useful after measurement meaning and timing are clarified."
        else:
            status = "consider"
            structural = "unknown"
            rationale = "Available field requires user clarification before causal design use."

        candidates.append(
            {
                "variable_name": name,
                "candidate_status": status,
                "data_category": category(name),
                "measurement_role": "proxy" if category(name) in {"wearable_sensing", "smartphone_sensing"} else "direct_measure" if "label" in lower else "unknown",
                "temporal_role": "time_varying" if name not in ids else "baseline",
                "possible_structural_role": structural,
                "rationale": rationale,
                "supporting_evidence": evidence,
                "limitations": [
                    "Role is provisional and requires user review.",
                    *(["High missingness may bias downstream analysis."] if miss and miss >= 30 else []),
                ],
                "requires_user_review": True,
            }
        )

    derived = []
    acc_cols = [c for c in columns if "acc_" in c.lower() or "magnitude" in c.lower()]
    if acc_cols:
        derived.append(
            {
                "feature_name": "window_t_activity_summary",
                "source_variables": acc_cols[:4],
                "calculation_method": "Aggregate accelerometer magnitude fields within the exposure window.",
                "aggregation_method": "mean/min/max summary by participant-window",
                "time_window": "window t",
                "minimum_data_requirement": "At least one non-missing sensor value per participant-window.",
                "missing_data_handling": "Flag missing windows and review complete-case versus imputed sensitivity analysis.",
                "leakage_risk": "low if computed before the outcome window; high if using post-outcome sensor values.",
                "supporting_evidence": evidence,
                "requires_backend_computation": True,
            }
        )
    if any("time" in c.lower() or "day" in c.lower() for c in columns):
        derived.append(
            {
                "feature_name": "lagged_temporal_context",
                "source_variables": [c for c in columns if "time" in c.lower() or "day" in c.lower()][:4],
                "calculation_method": "Construct lagged window indicators for temporal ordering.",
                "aggregation_method": "participant-window lag assignment",
                "time_window": "window t to next window",
                "minimum_data_requirement": "Valid timestamp/context values for exposure and outcome windows.",
                "missing_data_handling": "Exclude or flag windows with ambiguous timing.",
                "leakage_risk": "medium if same-window and next-window boundaries are not separated clearly.",
                "supporting_evidence": evidence,
                "requires_backend_computation": True,
            }
        )

    return {
        "status": "fallback",
        "candidate_variables": candidates,
        "derived_feature_candidates": derived,
        "warnings": [
            "LLM generation is unavailable, so these are deterministic placeholder candidates based on available schema fields.",
            *warnings,
        ],
        "recommended_next_actions": [
            "Keep, modify, exclude, or clarify each provisional variable.",
            "Run targeted feasibility before treating any role as final.",
        ],
    }


def _json_only_llm(messages: list[dict[str, str]]) -> dict[str, Any]:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise Phase4DesignError("OPENAI_API_KEY is not configured.")
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }
    if not model.startswith("gpt-5"):
        kwargs["temperature"] = 0.2
    try:
        response = OpenAI(api_key=api_key, timeout=12.0, max_retries=0).chat.completions.create(**kwargs)
    except OpenAIError as error:
        raise Phase4DesignError(format_openai_error(error)) from error
    try:
        return json.loads(response.choices[0].message.content or "{}")
    except json.JSONDecodeError as error:
        raise Phase4DesignError("LLM response was not valid JSON.") from error


def _question_messages(payload: dict[str, Any], evidence: list[dict[str, Any]]) -> list[dict[str, str]]:
    system = (
        "You generate Phase 4 candidate causal questions for Causal Design Agent. "
        "Return valid JSON only. Draft 2-4 candidates. Do not claim causal validity. "
        "Do not invent dataset columns. Missing important constructs must be marked as limitations or unavailable."
    )
    user = {
        "research_objective": payload.get("research_objective"),
        "dataset_filename": payload.get("dataset_filename"),
        "schema_summary": payload.get("schema_summary"),
        "broad_exploration_summary": payload.get("broad_exploration_summary"),
        "rag_evidence": evidence,
        "user_feedback": payload.get("user_feedback"),
        "locked_decisions": payload.get("locked_decisions"),
        "required_shape": {
            "questions": [
                {
                    "id": "q1",
                    "status": "ai_generated_draft",
                    "question_text": "",
                    "population": "",
                    "exposure": "",
                    "comparator": "",
                    "outcome": "",
                    "time_window": "",
                    "unit_of_analysis": "",
                    "within_or_between_person": "",
                    "initial_estimand_direction": "",
                    "supporting_evidence": [],
                    "preliminary_data_feasibility": "",
                    "limitations": [],
                    "requires_user_review": True,
                }
            ]
        },
    }
    return [{"role": "system", "content": system}, {"role": "user", "content": json.dumps(user, default=str)}]


def _variable_messages(payload: dict[str, Any], evidence: list[dict[str, Any]]) -> list[dict[str, str]]:
    system = (
        "You generate Phase 4 provisional candidate variable and derived-feature recommendations. "
        "Return valid JSON only. Do not assign final causal roles, do not generate graphs, and do not claim validity. "
        "Only use dataset columns from schema_summary unless candidate_status is unavailable_but_important."
    )
    user = {
        "confirmed_question": payload.get("confirmed_question"),
        "dataset_filename": payload.get("dataset_filename"),
        "schema_summary": payload.get("schema_summary"),
        "broad_exploration_summary": payload.get("broad_exploration_summary"),
        "rag_evidence": evidence,
        "user_feedback": payload.get("user_feedback"),
        "locked_decisions": payload.get("locked_decisions"),
        "allowed_candidate_statuses": sorted(VARIABLE_STATUSES),
        "allowed_measurement_roles": sorted(MEASUREMENT_ROLES),
        "allowed_temporal_roles": sorted(TEMPORAL_ROLES),
        "allowed_structural_roles": sorted(STRUCTURAL_ROLES),
    }
    return [{"role": "system", "content": system}, {"role": "user", "content": json.dumps(user, default=str)}]


def _normalize_questions(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    raw_questions = parsed.get("questions") or parsed.get("candidates") or []
    questions = []
    for index, item in enumerate(raw_questions[:4], start=1):
        if not isinstance(item, dict):
            continue
        questions.append(
            {
                "id": str(item.get("id") or item.get("candidate_id") or f"q{index}"),
                "status": str(item.get("status") or "ai_generated_draft"),
                "question_text": str(item.get("question_text") or item.get("question") or ""),
                "population": str(item.get("population") or ""),
                "exposure": str(item.get("exposure") or ""),
                "comparator": str(item.get("comparator") or ""),
                "outcome": str(item.get("outcome") or ""),
                "time_window": str(item.get("time_window") or ""),
                "unit_of_analysis": str(item.get("unit_of_analysis") or ""),
                "within_or_between_person": str(item.get("within_or_between_person") or item.get("within_person_or_between_person_focus") or ""),
                "initial_estimand_direction": str(item.get("initial_estimand_direction") or ""),
                "supporting_evidence": item.get("supporting_evidence") if isinstance(item.get("supporting_evidence"), list) else [],
                "preliminary_data_feasibility": str(item.get("preliminary_data_feasibility") or ""),
                "limitations": item.get("limitations") if isinstance(item.get("limitations"), list) else [],
                "requires_user_review": True,
            }
        )
    return questions


def _normalize_variables(parsed: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_variables = parsed.get("candidate_variables") or []
    if not raw_variables and isinstance(parsed.get("variable_groups"), dict):
        for items in parsed["variable_groups"].values():
            if isinstance(items, list):
                raw_variables.extend(items)
    variables = []
    for item in raw_variables[:40]:
        if not isinstance(item, dict):
            continue
        status = item.get("candidate_status") or item.get("recommendation_status") or "consider"
        variables.append(
            {
                "variable_name": str(item.get("variable_name") or item.get("source_field") or item.get("name") or ""),
                "candidate_status": status if status in VARIABLE_STATUSES else "consider",
                "data_category": str(item.get("data_category") or "unknown"),
                "measurement_role": item.get("measurement_role") if item.get("measurement_role") in MEASUREMENT_ROLES else "unknown",
                "temporal_role": item.get("temporal_role") if item.get("temporal_role") in TEMPORAL_ROLES else "unknown",
                "possible_structural_role": item.get("possible_structural_role") if item.get("possible_structural_role") in STRUCTURAL_ROLES else str(item.get("possible_role_hint") or "unknown"),
                "rationale": str(item.get("rationale") or item.get("relevance_to_question") or ""),
                "supporting_evidence": item.get("supporting_evidence") if isinstance(item.get("supporting_evidence"), list) else [],
                "limitations": item.get("limitations") if isinstance(item.get("limitations"), list) else [],
                "requires_user_review": True,
            }
        )
    raw_derived = parsed.get("derived_feature_candidates") or parsed.get("derived_features") or []
    derived = []
    for item in raw_derived[:12]:
        if not isinstance(item, dict):
            continue
        derived.append(
            {
                "feature_name": str(item.get("feature_name") or item.get("derived_feature_name") or ""),
                "source_variables": item.get("source_variables") or item.get("source_columns_needed") or [],
                "calculation_method": str(item.get("calculation_method") or ""),
                "aggregation_method": str(item.get("aggregation_method") or ""),
                "time_window": str(item.get("time_window") or item.get("calculation_window") or ""),
                "minimum_data_requirement": str(item.get("minimum_data_requirement") or ""),
                "missing_data_handling": str(item.get("missing_data_handling") or ""),
                "leakage_risk": str(item.get("leakage_risk") or ""),
                "supporting_evidence": item.get("supporting_evidence") if isinstance(item.get("supporting_evidence"), list) else [],
                "requires_backend_computation": True,
            }
        )
    return variables, derived


def generate_structured_question_candidates(payload: dict[str, Any]) -> dict[str, Any]:
    objective = str(payload.get("research_objective") or "").strip()
    if not objective:
        raise Phase4DesignError("Missing research_objective.")
    evidence, evidence_warnings = _available_evidence(payload.get("rag_evidence") or [], objective)
    try:
        parsed = _json_only_llm(_question_messages(payload, evidence))
        questions = _normalize_questions(parsed)
        if not questions:
            raise Phase4DesignError("LLM did not return candidate questions.")
        return {
            "status": "success",
            "questions": questions,
            "warnings": evidence_warnings,
            "recommended_next_actions": [
                "Edit or select one candidate question.",
                "Confirm the comparator and time window before targeted feasibility.",
            ],
        }
    except Phase4DesignError as error:
        return _fallback_questions(
            research_objective=objective,
            dataset_filename=str(payload.get("dataset_filename") or ""),
            schema_summary=payload.get("schema_summary") or {},
            rag_evidence=evidence,
            warnings=[*evidence_warnings, str(error)],
        )


def recommend_structured_candidate_variables(payload: dict[str, Any]) -> dict[str, Any]:
    question = str(payload.get("confirmed_question") or "").strip()
    if not question:
        raise Phase4DesignError("Missing confirmed_question.")
    evidence, evidence_warnings = _available_evidence(payload.get("rag_evidence") or [], question)
    try:
        parsed = _json_only_llm(_variable_messages(payload, evidence))
        variables, derived = _normalize_variables(parsed)
        if not variables:
            raise Phase4DesignError("LLM did not return candidate variables.")
        return {
            "status": "success",
            "candidate_variables": variables,
            "derived_feature_candidates": derived,
            "warnings": evidence_warnings,
            "recommended_next_actions": [
                "Review each provisional role hint.",
                "Keep, modify, exclude, or clarify variables before Phase 5.",
            ],
        }
    except Phase4DesignError as error:
        return _fallback_variables(
            confirmed_question=question,
            schema_summary=payload.get("schema_summary") or {},
            rag_evidence=evidence,
            warnings=[*evidence_warnings, str(error)],
        )
