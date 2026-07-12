from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis_strategy import router as analysis_strategy_router
from app.api.candidate_variables import router as candidate_variables_router
from app.api.causal_graph import router as causal_graph_router
from app.api.causal_roles import router as causal_roles_router
from app.api.causal_questions import router as causal_questions_router
from app.api.datasets import router as datasets_router
from app.api.documents import router as documents_router
from app.api.identification import router as identification_router
from app.api.rag import router as rag_router


app = FastAPI(
    title="Causal Studio API",
    description="Backend API for the Causal Studio causal-design support platform.",
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
app.include_router(rag_router)
app.include_router(datasets_router)
app.include_router(causal_questions_router)
app.include_router(candidate_variables_router)
app.include_router(causal_roles_router)
app.include_router(causal_graph_router)
app.include_router(identification_router)
app.include_router(analysis_strategy_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "project": "Causal Studio",
        "message": "Causal-design support backend API is running.",
    }


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Causal Studio backend is running."}
