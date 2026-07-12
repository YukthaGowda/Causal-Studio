from __future__ import annotations

from typing import Any


CAUSE_LIKE_ROLES = {
    "exposure",
    "confounder",
    "mediator",
    "effect_modifier",
    "baseline_covariate",
    "time_varying_covariate",
    "temporal_context_variable",
}
ID_FIELD_NAMES = {"pid", "id", "participant_id", "subject_id", "user_id"}
TIMESTAMP_FIELD_NAMES = {"time_stamp", "timestamp", "date", "datetime", "time"}
PROXY_TERMS = {"proxy", "surrogate", "indirect", "sensing"}
UNKNOWN_TIMING_TERMS = {"unknown", "unclear", "not specified", "uncertain"}
POST_OUTCOME_TERMS = {"post-outcome", "after outcome", "future outcome"}
POST_EXPOSURE_TERMS = {"post-exposure", "after exposure", "after treatment"}
FUTURE_LEAKAGE_TERMS = {"future", "next observation", "next-day outcome", "post-outcome"}


def _as_lower_text(*values: Any) -> str:
    return " ".join(str(value or "").lower() for value in values)


def _make_issue(
    *,
    variable_name: str | None,
    issue_type_key: str,
    issue_type: str,
    message: str,
    severity: str,
    suggested_fix: str,
) -> dict[str, Any]:
    return {
        "variable_name": variable_name,
        issue_type_key: issue_type,
        "message": message,
        "severity": severity,
        "suggested_fix": suggested_fix,
    }


def _is_adjustment_candidate(recommendation: dict[str, Any]) -> bool:
    return recommendation.get("adjustment_recommendation") == "include_in_adjustment_candidate"


def validate_causal_roles(
    *,
    selected_variables: list[dict[str, Any]],
    role_recommendations: list[dict[str, Any]],
    schema: dict[str, Any],
    estimand_type: str,
) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    schema_missingness = schema.get("missing_value_percentage_per_column", {})
    possible_ids = set(schema.get("possible_id_columns", []))
    possible_timestamps = set(schema.get("possible_timestamp_date_columns", []))
    selected_by_name = {
        str(variable.get("variable_name") or variable.get("source_field") or "").lower(): variable
        for variable in selected_variables
    }

    for recommendation in role_recommendations:
        variable_name = str(recommendation.get("variable_name") or "")
        source_field = str(recommendation.get("source_field") or variable_name)
        selected = selected_by_name.get(variable_name.lower()) or selected_by_name.get(
            source_field.lower(),
            {},
        )
        roles = {
            str(role).strip().lower()
            for role in recommendation.get("recommended_roles", [])
            if str(role).strip()
        }
        primary_role = str(recommendation.get("primary_role") or "").lower()
        timing_text = _as_lower_text(
            recommendation.get("temporal_role"),
            recommendation.get("measurement_role"),
            recommendation.get("rationale"),
            recommendation.get("uncertainty_notes"),
            selected.get("measurement_timing"),
            selected.get("user_notes"),
        )
        combined_text = _as_lower_text(
            variable_name,
            source_field,
            selected.get("data_category"),
            selected.get("direct_or_derived"),
            selected.get("missingness_warning"),
            selected.get("possible_role_hint"),
            recommendation.get("rationale"),
            recommendation.get("uncertainty_notes"),
        )
        field_key = source_field if source_field in schema_missingness else variable_name
        missingness = schema_missingness.get(field_key)

        if "exposure" in roles and "outcome" in roles:
            errors.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="error_type",
                    issue_type="same_variable_exposure_and_outcome",
                    message="A variable cannot be both the exposure and outcome for the same causal question.",
                    severity="blocking",
                    suggested_fix="Choose a distinct exposure and outcome, or split this into separate design candidates.",
                )
            )

        if roles & CAUSE_LIKE_ROLES and any(term in timing_text for term in POST_OUTCOME_TERMS):
            errors.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="error_type",
                    issue_type="post_outcome_variable_treated_as_cause",
                    message="A variable measured after the outcome cannot be treated as a cause of that outcome.",
                    severity="blocking",
                    suggested_fix="Remove this variable from causal exposure/covariate roles or redefine the time window.",
                )
            )

        if "baseline_covariate" in roles and any(term in timing_text for term in POST_EXPOSURE_TERMS):
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="post_exposure_baseline_confounder",
                    message="A post-exposure variable should not be treated as a baseline confounder.",
                    severity="high",
                    suggested_fix="Use a pre-exposure measurement or relabel as time-varying/post-exposure for review.",
                )
            )

        if estimand_type == "total_effect" and "mediator" in roles and _is_adjustment_candidate(recommendation):
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="mediator_adjustment_total_effect",
                    message="Mediators should not be automatically included in total-effect adjustment sets.",
                    severity="high",
                    suggested_fix="Mark mediator candidates as review_required or do_not_adjust for total-effect estimation.",
                )
            )

        if "collider" in roles and _is_adjustment_candidate(recommendation):
            errors.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="error_type",
                    issue_type="collider_adjustment",
                    message="Colliders should not be adjusted for.",
                    severity="blocking",
                    suggested_fix="Set adjustment_recommendation to do_not_adjust unless a different graph justifies review.",
                )
            )

        source_lower = source_field.lower()
        name_lower = variable_name.lower()
        is_id_like = (
            source_lower in ID_FIELD_NAMES
            or name_lower in ID_FIELD_NAMES
            or source_field in possible_ids
            or variable_name in possible_ids
            or "id_or_grouping_variable" in roles
        )
        if is_id_like and ({"exposure", "outcome"} & roles):
            errors.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="error_type",
                    issue_type="id_variable_as_causal_variable",
                    message="ID/grouping variables should not be treated as causal exposures or outcomes.",
                    severity="blocking",
                    suggested_fix="Use the ID only for grouping, clustering, repeated measures, or random effects structure.",
                )
            )
        elif is_id_like:
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="id_or_grouping_variable",
                    message="This appears to be an ID/grouping variable, not a causal construct.",
                    severity="info",
                    suggested_fix="Keep it available for grouping or repeated-measures structure, not causal interpretation.",
                )
            )

        is_timestamp_like = (
            source_lower in TIMESTAMP_FIELD_NAMES
            or name_lower in TIMESTAMP_FIELD_NAMES
            or source_field in possible_timestamps
            or variable_name in possible_timestamps
        )
        if is_timestamp_like and "exposure" in roles and "explicit" not in timing_text:
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="timestamp_as_exposure",
                    message="Timestamp variables should not be treated as causal exposures unless explicitly justified.",
                    severity="high",
                    suggested_fix="Use timestamp fields to define ordering, windows, lags, or calendar context.",
                )
            )

        if selected.get("direct_or_derived") == "derived" and any(
            term in combined_text for term in FUTURE_LEAKAGE_TERMS
        ):
            errors.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="error_type",
                    issue_type="derived_feature_future_leakage",
                    message="Derived features must not use future outcome information.",
                    severity="blocking",
                    suggested_fix="Recalculate the feature using only information available before the target outcome window.",
                )
            )

        if isinstance(missingness, (int, float)) and missingness >= 30:
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="high_missingness",
                    message=f"This variable has {missingness:.2f}% missingness in the uploaded dataset.",
                    severity="warning" if missingness < 50 else "high",
                    suggested_fix="Review missing-data handling before using this variable in design or adjustment.",
                )
            )

        if any(term in timing_text for term in UNKNOWN_TIMING_TERMS):
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="unknown_timing",
                    message="Measurement timing is unclear and requires review before graph generation.",
                    severity="warning",
                    suggested_fix="Specify whether this variable is measured before exposure, between exposure and outcome, or after outcome.",
                )
            )

        if "proxy_variable" in roles or any(term in combined_text for term in PROXY_TERMS):
            warnings.append(
                _make_issue(
                    variable_name=variable_name,
                    issue_type_key="warning_type",
                    issue_type="proxy_variable",
                    message="This variable appears to be a proxy and should not be treated as a direct construct measure.",
                    severity="info",
                    suggested_fix="Label the target construct and proxy measurement separately.",
                )
            )

    blocking_errors = [error for error in errors if error["severity"] == "blocking"]
    high_warnings = [warning for warning in warnings if warning["severity"] == "high"]
    validation_status = "passed"
    if blocking_errors:
        validation_status = "failed"
    elif warnings or errors:
        validation_status = "passed_with_warnings"

    safe_to_continue = not blocking_errors
    if high_warnings and estimand_type == "total_effect":
        safe_to_continue = False

    if validation_status == "failed":
        recommended_next_action = "Resolve blocking validation errors before graph generation."
    elif not safe_to_continue:
        recommended_next_action = "Review high-severity warnings before graph generation."
    elif warnings:
        recommended_next_action = "Review warnings, confirm roles, then proceed cautiously."
    else:
        recommended_next_action = "Roles passed deterministic checks; user confirmation is still required."

    return {
        "validation_status": validation_status,
        "warnings": warnings,
        "errors": errors,
        "recommended_next_action": recommended_next_action,
        "safe_to_continue_to_graph": safe_to_continue,
    }
