from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis_strategy import router as analysis_strategy_router
from app.api.assistant import router as assistant_router
from app.api.assumptions import router as assumptions_router
from app.api.candidate_variables import router as candidate_variables_router
from app.api.causal_graph import router as causal_graph_router
from app.api.causal_roles import router as causal_roles_router
from app.api.causal_questions import router as causal_questions_router
from app.api.datasets import router as datasets_router
from app.api.debug import router as debug_router
from app.api.documents import router as documents_router
from app.api.estimation import router as estimation_router
from app.api.exploration import router as exploration_router
from app.api.identification import router as identification_router
from app.api.rag import router as rag_router
from app.api.reports import router as reports_router
from app.api.workflow import router as workflow_router


app = FastAPI(
    title="Causal Design Agent API",
    description=(
        "Backend API for the Causal Design Agent causal-design support platform. "
        "Supports the official 8-step workflow from project setup through "
        "data foundation, broad exploration, question and variable design, "
        "targeted feasibility, graph validation, strategy, and review/export."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)
app.include_router(assistant_router)
app.include_router(rag_router)
app.include_router(datasets_router)
app.include_router(exploration_router)
app.include_router(causal_questions_router)
app.include_router(candidate_variables_router)
app.include_router(causal_roles_router)
app.include_router(causal_graph_router)
app.include_router(identification_router)
app.include_router(analysis_strategy_router)
app.include_router(assumptions_router)
app.include_router(estimation_router)
app.include_router(reports_router)
app.include_router(workflow_router)
app.include_router(debug_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "project": "Causal Design Agent",
        "message": "Causal-design support backend API is running.",
    }


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Causal Design Agent backend is running."}
