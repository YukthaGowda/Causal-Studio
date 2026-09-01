from app.services.assistant_actions import run_assistant_action


BASE_REQUEST = {
    "phase": "phase_1_project_setup",
    "action": "summarize",
    "page_state": {
        "research_objective": "Investigate a candidate exposure and later outcome.",
        "study_mode_active": False,
    },
}


def _response_for(prompt: str):
    return run_assistant_action(**BASE_REQUEST, user_feedback=prompt)


def test_research_question_phrasings_use_deterministic_drafts():
    prompts = [
        "give me a research question",
        "give me research questions",
        "research questions?",
        "research question?",
        "question ideas?",
        "causal questions?",
        "what questions can I ask?",
        "questions for BDE",
        "suggest a causal question",
        "formulate a question for this dataset",
    ]

    for prompt in prompts:
        response = _response_for(prompt)
        assert response["used_llm"] is False
        assert "Here are draft research-question examples:" in response["assistant_message"]
        assert "Load the approved BDE workspace" in response["assistant_message"]


def test_research_question_drafts_use_bde_context_when_workspace_is_loaded():
    workspace_request = {
        **BASE_REQUEST,
        "page_state": {
            "study_mode_active": True,
            "study_mode": {"task": "Fixed BDE causal-design task"},
            "selected_exposure": "acc_mean_magnitude",
            "selected_outcome": "binge_drinking_event",
            "selected_covariates": ["time_of_day", "day_of_week"],
        },
    }
    response = run_assistant_action(
        **workspace_request,
        user_feedback="give me a research question",
    )

    message = response["assistant_message"]
    assert response["used_llm"] is False
    assert "Here are draft BDE research questions:" in message
    assert "acc_mean_magnitude" in message
    assert "binge_drinking_event" in message
    assert "time of day and day of week" in message


def test_dynamic_workflow_question_explains_real_backend_actions():
    response = _response_for("is this static?")

    message = response["assistant_message"]
    assert response["used_llm"] is False
    assert "React build" in message
    assert "FastAPI backend" in message
    assert "Python estimation" in message
    assert "does not compute numerical estimates" in message
