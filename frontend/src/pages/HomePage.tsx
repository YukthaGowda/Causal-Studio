import { BackendStatus } from "../components/BackendStatus";

const sections = [
  "Project Setup",
  "Document Knowledge Base",
  "Dataset Schema Review",
  "Assistant",
  "Causal Workflow",
];

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Research Platform</p>
          <h1>Causal Studio</h1>
          <p className="subtitle">
            Causal-design support dashboard using RAG, LLM orchestration, and
            deterministic validation
          </p>
        </div>
        <BackendStatus />
      </section>

      <section className="notice">
        Causal Studio supports study design and analytic planning. It is not a
        diagnostic tool or treatment-decision system.
      </section>

      <section className="section-grid" aria-label="Causal Studio workflow">
        {sections.map((section) => (
          <article className="workflow-card" key={section}>
            <h2>{section}</h2>
            <p>
              Placeholder workspace for collecting decisions and displaying
              backend-validated state.
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
