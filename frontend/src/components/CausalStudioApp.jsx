import { useStudy } from "./study/StudyProvider.jsx";
import { createDashboardEvents, safeUploadMetadata } from "../lib/dashboardEvents.js";
import { PostSurvey } from "./study/PostSurvey.jsx";
import { followIngestion } from "../lib/ingestionLifecycle.js";
import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { buildChatContext, recentChatHistory } from "../lib/assistantContext.js";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Circle,
  UploadCloud,
  FileText,
  Trash2,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
  ClipboardList,
  ShieldAlert,
  Save,
  ArrowRight,
  LayoutGrid,
  Database,
  Compass,
  GitBranch,
  Clock,
  FileCheck2,
  Send,
  Link2,
  Lock,
  Wand2,
  Play,
  Search,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  assistantAction,
  assistantChat,
  startStudyMode,
  assembleReviewPackage,
  checkBackendHealth,
  exportReviewPackage,
  exportReport,
  generateCausalGraph,
  generateAnalysisStrategy,
  interpretEstimation,
  listEstimationRuns,
  getDatasetSchema,
  getIngestionStatus,
  generateQuestionCandidates,
  ingestDocuments,
  recommendCandidateVariables,
  runBroadExploration,
  runFeasibilityCheck,
  searchRag,
  selectPrimaryEstimationRun,
  uploadDataset,
  uploadDocument,
  validateDocumentCategory,
  runEstimation as runBackendEstimation,
  runClaimAudit,
  validateEstimationConfig,
  validateAnalysisStrategy,
  validateCausalGraph,
} from "../lib/api.js";
import { getReviewExportBlockers, normalizeClaimAuditResult, renderReportContent } from "../lib/reviewExport";

const CHART_TYPE_OPTIONS = [
  { key: "bar", label: "Bar" },
  { key: "line", label: "Line" },
  { key: "area", label: "Area" },
  { key: "pie", label: "Pie" },
];
const CHART_PALETTE = ["#2F5D8A", "#B8382B", "#3E8E7E", "#C4933F", "#7B5EA7", "#4A6FA5"];

class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Causal Studio panel error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" role="alert">
          <div className="card-head"><div className="card-title">Panel unavailable</div></div>
          <p className="card-desc">Something went wrong in this panel. Please refresh or go back to the previous step.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function FlexibleChart({ data, xKey, series, type = "bar", height = 145, layout = "horizontal", xLabel, yLabel }) {
  if (!Array.isArray(data) || data.length === 0) return <div style={{ padding: 12, fontSize: 12, color: "#5B6472" }}>No data yet.</div>;
  const seriesArr = Array.isArray(series) ? series : [series];
  const effectiveHeight = Math.max(height, 210);
  const chartMargin = { left: 28, right: 20, bottom: 44, top: 10 };
  const xAxisLabel = xLabel ? { value: xLabel, position: "insideBottom", offset: -8, fontSize: 11, fill: "#5B6472" } : undefined;
  const yAxisLabel = yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: "#5B6472", style: { textAnchor: "middle" } } : undefined;
  const axisChildren = layout === "vertical"
    ? [
        <CartesianGrid key="grid" strokeDasharray="3 3" stroke="#EDEFF3" horizontal={false} />,
        <XAxis key="x" type="number" tick={{ fontSize: 11 }} label={xAxisLabel} />,
        <YAxis key="y" type="category" dataKey={xKey} width={110} tick={{ fontSize: 11 }} label={yAxisLabel} />,
        <Tooltip key="tt" />,
        seriesArr.length > 1 ? <Legend key="lg" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" /> : null,
      ]
    : [
        <CartesianGrid key="grid" strokeDasharray="3 3" stroke="#EDEFF3" />,
        <XAxis key="x" dataKey={xKey} tick={{ fontSize: 11 }} label={xAxisLabel} />,
        <YAxis key="y" tick={{ fontSize: 11 }} label={yAxisLabel} />,
        <Tooltip key="tt" />,
        seriesArr.length > 1 ? <Legend key="lg" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" /> : null,
      ];
  return (
    <div style={{ width: "100%", height: effectiveHeight }}>
      <ResponsiveContainer>
        {type === "line" ? (
          <LineChart data={data} margin={chartMargin}>
            {axisChildren}
            {seriesArr.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key} stroke={s.color || CHART_PALETTE[i % CHART_PALETTE.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={chartMargin}>
            {axisChildren}
            {seriesArr.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key} stroke={s.color || CHART_PALETTE[i % CHART_PALETTE.length]} fill={s.color || CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.25} />
            ))}
          </AreaChart>
        ) : type === "pie" ? (
          <PieChart margin={{ left: 6, right: 8, bottom: 8, top: 8 }}>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Pie data={data} dataKey={seriesArr[0].key} nameKey={xKey} outerRadius={Math.min(effectiveHeight / 2 - 30, 80)} label={{ fontSize: 10 }}>
              {data.map((_, idx) => <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />)}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} layout={layout} margin={chartMargin}>
            {axisChildren}
            {seriesArr.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name || s.key} fill={s.color || CHART_PALETTE[i % CHART_PALETTE.length]} radius={layout === "vertical" ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function ChartTypeSwitcher({ value, onChange, allow = ["bar", "line", "area", "pie"] }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, background: "#F2F4F7", padding: 3, borderRadius: 6 }}>
      {CHART_TYPE_OPTIONS.filter((o) => allow.includes(o.key)).map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            padding: "3px 9px",
            fontSize: 11,
            fontWeight: 600,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            background: value === o.key ? "#fff" : "transparent",
            color: value === o.key ? "#16233D" : "#5B6472",
            boxShadow: value === o.key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CardInfo({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, alignSelf: "center" }}>
      <button
        className={`card-info-btn${open ? " active" : ""}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="What is this?" title="What is this?"
      >?</button>
      {open && <div className="card-info-popover">{text}</div>}
    </div>
  );
}

const STEPS = [
  { key: "setup", short: "Project Setup", full: "Project Setup and Document Upload", icon: LayoutGrid },
  { key: "data-foundation", short: "Data Foundation", full: "Data Foundation and Understanding", icon: Database },
  { key: "explore", short: "Broad Exploration", full: "Broad Data Exploration", icon: Compass },
  { key: "question", short: "Question & Variables", full: "Causal Question and Provisional Variable Design", icon: GitBranch },
  { key: "feasibility", short: "Feasibility", full: "Targeted Variable Exploration and Feasibility Check", icon: Clock },
  { key: "graph", short: "Causal Graph", full: "Causal Graph and Final Role Validation", icon: GitBranch },
  { key: "strategy", short: "Analysis Strategy", full: "Identification and Analysis Strategy", icon: FileCheck2 },
  { key: "estimation", short: "Estimation & Calculation", full: "Estimation and Calculation", icon: Play },
  { key: "review", short: "Review & Export", full: "Review and Export", icon: FileCheck2 },
];
const BUILT_PAGES = ["setup", "data-foundation", "explore", "question", "feasibility", "graph", "strategy", "estimation", "review"];

const NEXT_PAGE = {
  setup: "data-foundation",
  "data-foundation": "explore",
  explore: "question",
  question: "feasibility",
  feasibility: "graph",
  graph: "strategy",
  strategy: "estimation",
  estimation: "review",
  review: null,
};

// ══════════════════════════════════════════════════════════════════════════════
//  AI CONTENT VARIANTS — 3 alternative phrasings per block
//  Index 0 = default shown on first load. Regenerate cycles forward.
// ══════════════════════════════════════════════════════════════════════════════

const POPULATION_BODY_VARIANTS = [
  [
    "This is the group your study makes causal claims about. Based on your uploaded data and objective, the population is adults in active outpatient AUD (alcohol use disorder) treatment, observed repeatedly over a monitoring window with daily EMA check-ins and passive sensing.",
    "Inclusions implied by your data: participants with at least one parseable EMA record and a valid participant ID. Participants with more than 30% missing daily surveys risk producing biased estimates if their missingness relates to alcohol use — consider a separate sensitivity analysis for this subgroup.",
    "Generalizability: findings will apply to outpatient AUD programs of similar intensity and demographic profile. Extension to inpatient, community, or adolescent populations requires additional untested assumptions and should be stated explicitly as a limitation.",
  ],
  [
    "Your study population is operationally defined by enrollment and data availability: adults in outpatient AUD treatment who contributed at least one complete EMA record and whose data can be linked across sources via a shared participant ID.",
    "Who is implicitly excluded: participants with no EMA responses, those missing a linking key, and anyone whose data was flagged as corrupted. These exclusions should be documented in a consort-style flow diagram for the study report.",
    "Study vs. target population: the study population (those with usable records) may differ from all enrolled patients if missingness is non-random. High-use days tend to produce more missed surveys — a pattern that can bias within-person estimates downward if not handled explicitly.",
  ],
  [
    "For causal identification, the relevant population is not just who was enrolled, but who contributes estimable contrasts — participants who experienced both high and low values of the exposure across the observation window.",
    "Within-person design implication: participants who consistently had poor sleep (or consistently good sleep) throughout the study contribute no within-person contrast and are effectively excluded by the variation threshold set in Feasibility.",
    "Causal effects estimated from within-person designs generalize most naturally to individuals like the participants who had variation in the exposure — not to all enrolled participants, and not to populations beyond this program type.",
  ],
];

const EXPOSURE_BODY_VARIANTS = [
  [
    "Why it is the exposure: sleep_quality is recorded each night before the alcohol-use outcome is checked the following day, establishing a clear temporal ordering — cause before effect. The causal question is whether a night of objectively poor sleep increases next-day drinking probability.",
    "Exposure vs. treatment: in your observational data it varies naturally across nights. You must argue — and demonstrate — that after conditioning on confounders like stress_level and actigraphy_activity, nights with poor vs. good sleep quality are as-good-as randomly assigned within each participant.",
    "Why not reverse the direction? Reversing flips sleep_quality into the outcome and alcohol_use_event into the exposure — changing the required confounder set and identification strategy entirely. The current direction is better supported by temporal ordering in EMA-based AUD studies.",
  ],
  [
    "How sleep_quality is operationalized: collected via end-of-day EMA using a 1–5 single-item scale ('How would you rate your sleep last night?'). Single-item measures are subject to recall and response-style bias, but their simplicity makes them feasible in intensive longitudinal designs.",
    "Continuous vs. binary exposure: the current design treats sleep_quality as continuous, which preserves information but requires linearity assumptions in some estimators. Dichotomizing (e.g., scores 1–2 = poor) can aid interpretation at the cost of efficiency loss.",
    "Actigraphy cross-check: your dataset includes actigraphy-derived sleep duration. If EMA-reported quality and actigraphy-derived duration are correlated (expected: r ≈ 0.3–0.5 in AUD samples), the EMA item likely captures a meaningful construct.",
  ],
  [
    "Sources of confounding for this exposure: the main threats are variables that independently cause both poor sleep and higher alcohol use — primarily stress_level (daily stressors impair sleep and increase craving), actigraphy_activity, and unmeasured baseline psychiatric comorbidities.",
    "Within-person design advantage: using participant as their own control eliminates all time-stable confounders (personality, baseline severity, genetics). Only time-varying confounders — those that change night-to-night alongside sleep quality — need explicit adjustment.",
    "Residual confounding: daily mood, treatment session attendance, and social contact are time-varying confounders not fully captured in this dataset. They should appear as limitations and, where possible, be addressed via sensitivity analysis.",
  ],
];

const TIMEWINDOW_INTRO_VARIANTS = [
  "The time window is not just a technical parameter — it defines the causal mechanism you are testing. A 24-hour lag asks whether sleep disruption affects craving through overnight neurobiological recovery. A same-day window asks whether sleep and drinking are concurrently driven by a shared daily factor like stress. These are scientifically distinct claims.",
  "Your lag choice directly controls how many participant-days remain in the analysis. Each additional day of lag trims the observation window — participants observed for fewer days than the lag are entirely excluded. The table below shows the trade-off between scientific specificity (longer lags, longer-horizon effects) and statistical power (longer lags, smaller sample).",
  "From a clinical standpoint, the 24-hour lag is the most actionable: it maps directly to a practical question — 'if a patient reports poor sleep tonight, how likely are they to drink tomorrow?' This is directly usable for treatment providers who have daily EMA contact with patients.",
];

const UNIT_BODY_VARIANTS = [
  [
    "Each row in your analysis will represent one participant on one calendar day. The same participant contributes one row per day, so observations are correlated — day 4 for participant #12 is not independent of day 3. Treating rows as independent inflates your effective sample size and produces standard errors that are too narrow.",
    "The fix is a mixed-effects model with a random participant intercept (or GEE with exchangeable working correlation), configured in Analysis Strategy. Alternative units: participant-week would have fewer rows with less noise but lower granularity; participant (one row per person, summary scores) loses the within-person variability that is the main identification source here.",
  ],
  [
    "Participant-day maximizes your effective sample size relative to what the data can support. With repeated daily observations, you estimate within-person effects rather than between-person differences — a much more powerful design for detecting short-horizon exposure effects, because each person acts as their own control.",
    "Practical consequence: your N is not the number of participants but the number of usable participant-days — determined by the lag window, missingness rate, and exposure variation threshold you configured in Feasibility. Check the feasibility verdict before moving on.",
  ],
  [
    "Choosing participant-day commits you to a set of assumptions about how daily observations relate. Exchangeability must hold at the day level: on any given day, participants with high vs. low sleep quality are exchangeable after conditioning on measured confounders — including same-day confounders.",
    "Sequential ignorability: because you use lagged values (yesterday's sleep predicts today's drinking), you implicitly assume no-anticipation — participants don't change today's sleep because they plan to drink tomorrow. This assumption is plausible but worth stating explicitly in the limitations.",
  ],
];

const ESTIMAND_BODY_VARIANTS = [
  [
    "A risk difference answers: 'by how many percentage points does the probability of an alcohol-use event increase on day N+1 when sleep quality on night N is poor vs. good, holding confounders fixed?' A risk difference of +0.09 means poor sleep is associated with a 9 percentage-point higher probability of drinking the next day.",
    "Why risk difference, not odds ratio: odds ratios overstate the relative magnitude of effect when the outcome is common. Alcohol-use events in outpatient AUD samples typically occur on 20–40% of participant-days — well above the ~10% threshold where odds ratios diverge meaningfully from risk differences.",
    "Total effect vs. direct effect: this targets the total effect of sleep quality on alcohol use — including indirect pathways through stress reactivity, craving, or inhibitory control. Switching to a direct or mediated estimand in Step 7 would isolate one specific mechanism.",
  ],
  [
    "The Average Treatment Effect (ATE) asks: what would happen to average drinking probability across all participant-days if we intervened to change sleep quality from good to poor for everyone? This is a population-level contrast, not a prediction for any individual.",
    "ATE vs. ATT: the ATT restricts the contrast to participant-days that actually had poor sleep. For a within-person design with moderate exposure prevalence (~30–50% of days with poor sleep), the ATE and ATT are typically close numerically but differ in their population interpretation.",
    "Scale choice for reporting: reporting on the risk difference scale (absolute, percentage points) is preferred over relative risk when communicating to clinical audiences — a 9% absolute increase is more actionable than a 1.4× relative risk.",
  ],
  [
    "The estimand should match the decision it informs. If the goal is to evaluate a sleep-improvement intervention (e.g., CBT-I added to AUD treatment), the relevant estimand is the individual-level risk difference — how many additional drinking days per month would be prevented if this participant's sleep quality improved?",
    "From estimand to policy: a risk difference of +0.09 translates to approximately 2.7 additional drinking days per month for someone observed over 30 days. Across 60 participants, this represents roughly 16 drinking-day-equivalents prevented per month.",
    "Uncertainty propagation: these translations assume the point estimate is the true effect. The CI (determined in Estimation) defines the range of clinically plausible effects — the policy implications of the lower vs. upper bound should be interpreted explicitly in the study report.",
  ],
];

const QUESTION_ALT_PHRASINGS = {
  p1: [
    "Does poor sleep quality increase the likelihood of alcohol use in the days that follow, among adults in outpatient AUD treatment?",
    "Among adults in outpatient AUD treatment, do nights with worse sleep quality predict a higher probability of alcohol use the next day?",
    "Is there a next-day effect of sleep disruption on alcohol-use probability in an outpatient AUD cohort observed via EMA?",
  ],
  p2: [
    "Does higher phone screen time increase same-day alcohol-use likelihood?",
    "Is elevated phone screen time associated with a higher probability of alcohol use on the same day, among outpatient AUD participants?",
    "Among adults in AUD treatment, does phone screen time on a given day predict same-day alcohol-use events?",
  ],
  p3: [
    "Does elevated stress increase next-day alcohol-use probability?",
    "Is daily stress level a predictor of subsequent alcohol-use events in outpatient AUD treatment?",
    "Among adults in AUD treatment, does higher stress on a given day raise the likelihood of drinking the following day?",
  ],
  custom: [
    "Does poor sleep quality increase the likelihood of alcohol use in the days that follow, among adults in outpatient AUD treatment?",
    "Among adults in outpatient AUD treatment, do nights with worse sleep quality predict a higher probability of alcohol use the next day?",
    "Is there a next-day effect of sleep disruption on alcohol-use probability in an outpatient AUD cohort observed via EMA?",
  ],
};

// ── useVersionedContent hook ───────────────────────────────────────────────
function useVersionedContent(variants) {
  const [idx, setIdx] = useState(0);
  const [locked, setLocked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const regenerate = useCallback(() => {
    if (locked || generating || variants.length <= 1) return;
    setGenerating(true);
    setCompareMode(false);
    setTimeout(() => {
      setIdx(i => (i + 1) % variants.length);
      setGenerating(false);
    }, 850);
  }, [locked, generating, variants.length]);

  return {
    current: variants[Math.min(idx, variants.length - 1)],
    prev: idx > 0 ? variants[idx - 1] : null,
    idx, total: variants.length, locked, generating, compareMode,
    setCompareMode,
    regenerate,
    lock: () => setLocked(true),
    unlock: () => { setLocked(false); setCompareMode(false); },
    navPrev: () => { if (!locked) setIdx(i => Math.max(0, i - 1)); },
    navNext: () => { if (!locked) setIdx(i => Math.min(variants.length - 1, i + 1)); },
  };
}

// ── RegenerateBlock component ─────────────────────────────────────────────
// Wraps any AI-generated content with: version nav, Regenerate, Compare, Lock in.
function RegenerateBlock({ variants, renderVariant, onLock, onUnlock, externalVersions, onRegenerate }) {
  const effectiveVariants = externalVersions && externalVersions.length > 0 ? externalVersions : variants;
  const v = useVersionedContent(effectiveVariants || [""]);

  const handleLock = () => { v.lock(); onLock?.(v.current); };
  const handleUnlock = () => { v.unlock(); onUnlock?.(); };
  const handleRegenerate = onRegenerate
    ? () => { if (v.locked || v.generating) return; v.setCompareMode(false); onRegenerate(); }
    : v.regenerate;

  const render = (content) =>
    renderVariant ? renderVariant(content) : <p className="insight-body">{content}</p>;

  return (
    <div className={`regen-block${v.locked ? " regen-block-locked" : ""}`}>
      {v.compareMode && v.prev ? (
        <div className="regen-compare">
          <div className="regen-compare-panel">
            <div className="regen-compare-label">Version {v.idx}</div>
            {render(v.prev)}
          </div>
          <div className="regen-compare-panel regen-compare-panel-current">
            <div className="regen-compare-label regen-compare-label-current">Version {v.idx + 1} — current</div>
            {render(v.current)}
          </div>
        </div>
      ) : render(v.current)}

      <div className="regen-toolbar">
        <div className="regen-toolbar-left">
          {v.total > 1 && !v.locked && (
            <div className="regen-nav">
              <button className="regen-nav-btn" onClick={v.navPrev} disabled={v.idx === 0} title="Previous version">‹</button>
              <span className="regen-version-label">v{v.idx + 1}/{v.total}</span>
              <button className="regen-nav-btn" onClick={v.navNext} disabled={v.idx === v.total - 1} title="Next version">›</button>
            </div>
          )}
          {v.total > 1 && v.idx > 0 && !v.locked && (
            <button className="btn btn-ghost btn-sm regen-compare-btn" onClick={() => v.setCompareMode(m => !m)}>
              <Eye size={11} />{v.compareMode ? "Close compare" : "Compare"}
            </button>
          )}
        </div>
        <div className="regen-toolbar-right">
          {v.locked ? (
            <>
              <span className="regen-locked-badge"><Lock size={11} /> Locked in</span>
              <button className="btn btn-ghost btn-sm" onClick={handleUnlock}>Unlock</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleRegenerate} disabled={v.generating} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} className={v.generating ? "spin" : ""} />
                {v.generating ? "Generating…" : "Regenerate"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleLock} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Lock size={11} /> Lock in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SuggestedQuestionCard ─────────────────────────────────────────────────
// Each promoted pattern gets its own card with per-phrasing Regenerate.
function SuggestedQuestionCard({ pid, selectedQuestionId, selectSuggestedQuestion }) {
  const phrasings = QUESTION_ALT_PHRASINGS[pid] || [QUESTION_ALT_PHRASINGS.p1[0]];
  const v = useVersionedContent(phrasings);
  const isSelected = selectedQuestionId === pid;

  return (
    <div className="pattern-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingBottom: 10 }}>
      {v.compareMode && v.prev ? (
        <div className="regen-compare" style={{ width: "100%" }}>
          <div className="regen-compare-panel">
            <div className="regen-compare-label">Version {v.idx}</div>
            <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>{v.prev}</p>
          </div>
          <div className="regen-compare-panel regen-compare-panel-current">
            <div className="regen-compare-label regen-compare-label-current">Version {v.idx + 1} — current</div>
            <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>{v.current}</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", width: "100%", gap: 8 }}>
          <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{v.current}</span>
          {isSelected ? (
            <span className="chip chip-success" style={{ flexShrink: 0 }}><CheckCircle2 size={13} /> In use</span>
          ) : (
            <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => selectSuggestedQuestion(pid, v.current)}>Use this question</button>
          )}
        </div>
      )}
      <div className="regen-toolbar" style={{ width: "100%", paddingTop: 6, marginTop: 0, borderTop: "1px dashed #D5DBE4" }}>
        <div className="regen-toolbar-left">
          <div className="regen-nav">
            <button className="regen-nav-btn" onClick={v.navPrev} disabled={v.idx === 0}>‹</button>
            <span className="regen-version-label">v{v.idx + 1}/{v.total}</span>
            <button className="regen-nav-btn" onClick={v.navNext} disabled={v.idx === v.total - 1}>›</button>
          </div>
          {v.idx > 0 && (
            <button className="btn btn-ghost btn-sm regen-compare-btn" onClick={() => v.setCompareMode(m => !m)}>
              <Eye size={11} />{v.compareMode ? "Close compare" : "Compare"}
            </button>
          )}
        </div>
        <div className="regen-toolbar-right">
          <button className="btn btn-ghost btn-sm" onClick={v.regenerate} disabled={v.generating} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <RefreshCw size={11} className={v.generating ? "spin" : ""} />
            {v.generating ? "Generating…" : "Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PAGE_INTRO_MESSAGES = {
  setup: "👋 Welcome to Causal Studio! This is Step 1 — Project Setup. Start by writing a brief research objective, then upload your dataset and data dictionary. Once those three are in place, you're ready to move forward. Protocol and papers are optional but help me give better suggestions along the way.",

  "data-foundation": "Great — let's take a closer look at your data! 🔍 I've scanned everything you uploaded and laid it all out here. Have a read through each section — anything in red needs to be fixed before we move on, but yellow flags can wait. Once it looks good, we're ready for the next step!",

  explore: "Now for the fun part — let's explore what your data is actually showing! 📊 Use the time window slider and layer checkboxes to zoom in on the variables you care about most. When you spot a pattern that looks relevant to your research question, hit Promote to carry it forward. Aim for 1–3 good ones.",

  question: "Time to get specific about what we're actually studying. 🎯 Start by checking the variable-role table — I've made some suggestions, but you know your data best, so feel free to adjust. Then either pick one of my suggested questions or write your own. Fill in all seven fields and we're good to go!",

  feasibility: "Let's make sure we have enough data to answer your question. 📐 Drag the lag slider to match your expected mechanism (e.g. 24 hours for a next-day effect) and watch the verdict update live. If it comes back Marginal or Infeasible, try tweaking the threshold — I'll tell you what to adjust.",

  graph: "Now let's map out the causal story. 🗺️ I've pre-drawn some arrows based on your variables — confirm the ones that look right, remove any that don't fit, and add any missing confounders. Mark each arrow as Supported or Uncertain, then check the adjustment set at the bottom. That's our roadmap for the analysis!",

  strategy: "Almost there — let's set up how the analysis will actually run. ⚙️ Choose your effect type, pick an estimator, enable the random intercept, and flag any sensitivity checks you want. Each choice here flows directly into the estimation step, so take a moment to make sure it reflects your design.",

  estimation: "This is the calculation step. Check the config summary, validate it, then run estimation in Python. Once results come back, review the backend-returned diagnostics and warnings before selecting a primary result.",

  review: "You made it to the final step — well done! 🎉 Take a moment to read through the assumption boundaries; they spell out exactly what you can and can't claim from this analysis. If anything needs tweaking, you can navigate back and it'll update here automatically. When you're satisfied, go ahead and export.",
};

const SETUP_QUESTIONS = [
  "What does each upload on this page do?",
  "What do I need before I can continue?",
  "What makes a good research objective?",
];
const DF_QUESTIONS = [
  "What does each section on this page show?",
  "I have warnings — can I still continue?",
  "What does the linking key check mean?",
];
const EXPLORE_QUESTIONS = [
  "How do the filters affect the charts?",
  "How many patterns should I promote?",
  "What does promoting a pattern do?",
];
const QUESTION_PAGE_QUESTIONS = [
  "How do I use the variable-role table?",
  "What should I fill in the question builder?",
  "What is an estimand and which should I pick?",
];
const FEASIBILITY_QUESTIONS = [
  "What do the lag and threshold sliders control?",
  "My verdict is Marginal — what should I do?",
  "What does overlap mean and why does it matter?",
];
const GRAPH_QUESTIONS = [
  "How do I add and connect variables here?",
  "How do I know when my graph is ready?",
  "What is a backdoor path and why does it matter?",
];
const STRATEGY_QUESTIONS = [
  "What does each option on this page control?",
  "Which sensitivity assumptions should I check?",
  "Total effect vs. direct effect — which do I want?",
];
const ESTIMATION_QUESTIONS = [
  "What does each section of the results show?",
  "A diagnostic is flagged — what should I do?",
  "What does the point estimate and CI tell me?",
];
const REVIEW_QUESTIONS = [
  "What does the assumption boundaries section show?",
  "Is there anything to check before exporting?",
  "What can and can't I claim from this analysis?",
];

const ANSWERS = {
  // ── Project Setup ──────────────────────────────────────────────────────────
  "What does each upload on this page do?":
    "Objective: frames the population and relationship — used to tailor suggestions throughout. Dataset: the raw data the analysis runs on (one file per source). Dictionary: maps every column to its type and range — required for role assignment. Protocol: flags design-vs-data inconsistencies. Papers: prior evidence used when suggesting roles and causal relationships.",
  "What do I need before I can continue?":
    "Three things: a written objective, at least one parseable dataset (green status), and a data dictionary with no blocking issues. Protocol and papers are optional. The readiness checklist at the top shows what's still missing.",
  "What makes a good research objective?":
    "Name the population, the setting, and the broad relationship of interest. Causal language (exposure, outcome, estimand) comes in Step 4 — a plain sentence is enough here. Example: 'Investigate whether sleep disruption is associated with next-day alcohol craving in outpatient AUD treatment.'",

  // ── Data Foundation ────────────────────────────────────────────────────────
  "What does each section on this page show?":
    "Data summary: record and participant counts. Variable schema: all detected columns and their types. Linking key: confirms datasets share a participant ID. Measurement frequency: when each variable was collected. Missingness & quality: high-missing or implausible-value flags. Inconsistency alerts: dictionary-vs-data mismatches.",
  "I have warnings — can I still continue?":
    "Yes — yellow warnings don't block you, but they resurface in later steps. Red blocking issues must be fixed first. For each warning, decide whether it materially affects your analysis before moving on.",
  "What does the linking key check mean?":
    "It confirms all datasets share a participant identifier (e.g. participant_id) so rows can be joined to the same person. Mismatched field names or formatting (P001 vs 1) will fail the join.",

  // ── Broad Exploration ──────────────────────────────────────────────────────
  "How do the filters affect the charts?":
    "The time window slider sets how many days appear in the trend chart. Layer checkboxes toggle which data sources appear in the coverage and missingness views. Both affect display only — no data is removed from later steps.",
  "How many patterns should I promote?":
    "One to three is ideal. Prioritise patterns involving your expected exposure and outcome. A confounder-related pattern is worth promoting too — it will appear in the variable-role table in Step 4.",
  "What does promoting a pattern do?":
    "It carries the pattern forward as evidence for your causal question. In Step 4 it generates a suggested research question and adds the involved variables to the role table. Promoted patterns are observational — not causal claims.",

  // ── Question & Variables ───────────────────────────────────────────────────
  "How do I use the variable-role table?":
    "Each row is a detected variable. Change the suggested role using the dropdown. Use Select/Discard to control what carries forward — only selected variables proceed. Click '+ Add variable' to add one not in the list. Roles here are provisional; Causal Graph (Step 6) is where they're validated.",
  "What should I fill in the question builder?":
    "All seven fields: population, exposure, comparator, outcome, time window, unit of analysis, and target estimand. Leaving any blank causes issues in Feasibility and Strategy. The time window should match the lag you plan to test.",
  "What is an estimand and which should I pick?":
    "The estimand is the exact causal quantity you're targeting. For a binary EMA outcome, risk difference is usually best — it's directly interpretable and doesn't overstate effect size the way odds ratios do at high prevalence (>10%).",

  // ── Feasibility ────────────────────────────────────────────────────────────
  "What do the lag and threshold sliders control?":
    "Lag: the time gap between exposure and outcome measurement — longer lags trim participant-days. Threshold: the minimum within-person variability to include a participant — low variation means nothing to contrast. Both update the verdict and sample count live.",
  "My verdict is Marginal — what should I do?":
    "Try lowering the exposure variation threshold first — it usually recovers more participant-days than shortening the lag. If the lag is flexible, a shorter lag helps too. Combine small adjustments to both if needed, then enable robust SEs in Strategy to compensate.",
  "What does overlap mean and why does it matter?":
    "Overlap means exposed and unexposed participant-days exist across all covariate combinations. Without it, comparisons rely on extrapolation rather than observed data, making estimates model-dependent. The formal check happens when the estimator is fitted in Strategy.",

  // ── Causal Graph ───────────────────────────────────────────────────────────
  "How do I add and connect variables here?":
    "Add a node via 'Add variable', rename it and assign a role in the right panel. To add an arrow: select a node, click 'Add edge from here', then click the target. Click any arrow to mark it Supported or Uncertain. The adjustment set updates automatically.",
  "How do I know when my graph is ready?":
    "All selected variables are nodes with roles assigned, every arrow is marked Supported or Uncertain, and the adjustment set contains only confounders — not mediators. You don't need a perfect graph, just one that accurately reflects your assumptions.",
  "What is a backdoor path and why does it matter?":
    "A non-causal path from exposure to outcome through a common cause — e.g. sleep ← stress → alcohol. Without conditioning on stress, the estimate mixes its effect with sleep's. Blocking all backdoor paths via the adjustment set is what makes the estimate interpretable as causal.",

  // ── Analysis Strategy ──────────────────────────────────────────────────────
  "What does each option on this page control?":
    "Effect type: whether mediators enter the adjustment set. Estimator: model family (mixed-effects logistic for binary repeated-measures; GEE for population-averaged; MSM for time-varying exposure). Repeated-measures options: random intercept (required), MI, robust SEs. Sensitivity assumptions: each adds a specific robustness test in Estimation.",
  "Which sensitivity assumptions should I check?":
    "Missing data if >10% missingness in key variables. Positivity if overlap was below 80% in Feasibility. Unmeasured confounding for any observational study (adds E-value). SUTVA if participants could influence each other's exposure. Exclusion restriction only if using an IV.",
  "Total effect vs. direct effect — which do I want?":
    "Total effect for most questions — it captures the full impact of intervening on the exposure. Direct effect only if you specifically want to isolate one mechanism (e.g. sleep → craving, excluding the stress pathway). Direct effect requires stronger assumptions about the mediator.",

  // ── Estimation & Calculation ───────────────────────────────────────────────
  "What does each section of the results show?":
    "Point estimate: best-guess effect size. SE: sampling variability. 95% CI: range the data can't rule out. N: participant-days in the model. SMD table: covariate balance before and after adjustment — below 0.10 is adequate. Sensitivity results: E-value, MI comparison, overlap-weighted estimate (only if flagged in Strategy).",
  "A diagnostic is flagged — what should I do?":
    "SMD > 0.10: consider overlap weighting or adding the poorly-balanced variable to the adjustment set, then re-run. Non-convergence: try a simpler estimator or reduce covariates. Positivity warning: restrict to the overlapping region or switch to overlap weighting. Use 'Explain This Warning' for plain-language detail on any specific flag.",
  "What does the point estimate and CI tell me?":
    "The point estimate is the best-guess effect size and direction. If the CI excludes zero, the data are inconsistent with no effect. If it includes zero, a null effect can't be ruled out. The E-value shows how strong an unmeasured confounder would need to be to explain the result away.",

  // ── Review & Export ────────────────────────────────────────────────────────
  "What does the assumption boundaries section show?":
    "A plain-language statement of the conditions under which your estimate is valid — which identification assumptions were checked, which were assumed, and what claim the result supports. It defines the defensible scope of the finding before you report it.",
  "Is there anything to check before exporting?":
    "Confirm: (1) the primary result matches what you selected in Step 8, (2) assumption boundaries match your design, (3) limitations cover confounding and missing data, (4) the research question and roles shown are correct. Navigate back to fix anything — the export updates automatically.",
  "What can and can't I claim from this analysis?":
    "You can claim: an effect estimate consistent with your stated assumptions, adjustment set, and estimand, in this population and window. You can't claim: proof of causation, generalisability beyond the sample, or precision beyond the CI. Include the E-value when reporting.",

  // ── Legacy / shared ────────────────────────────────────────────────────────
  "Explain this validation issue":
    "Open 'Validation details' on the relevant card — it lists what was detected, what's missing, and the action needed.",
  "What documents count as domain guidance?":
    "Clinical practice guidelines, measurement standards, reporting standards, and professional body guidance. Published empirical studies belong in Research Papers instead.",
  "What is an E-value and why does it matter?":
    "The minimum confounding strength needed to fully explain away your estimate. A large E-value means the finding is robust to confounding; a small one means even weak unmeasured confounders could explain it. It doesn't prove causation — it quantifies sensitivity to the main threat.",
};

const DATA_SCHEMA = [
  { name: "participant_id", type: "ID", source: "All files", roleGuess: "ID / linking key", documented: true },
  { name: "timestamp", type: "Datetime", source: "All files", roleGuess: "Linking key", documented: true },
  { name: "sleep_quality", type: "Number (1\u20135)", source: "EMA survey", roleGuess: "Exposure", documented: true, frequency: "daily" },
  { name: "alcohol_use_event", type: "Binary (Y/N)", source: "EMA survey", roleGuess: "Outcome", documented: true, frequency: "daily" },
  { name: "stress_level", type: "Number (0\u2013100)", source: "EMA survey", roleGuess: "Confounder", documented: true, frequency: "3x/day" },
  { name: "actigraphy_activity", type: "Number (min)", source: "Actigraphy", roleGuess: "Confounder", documented: true, frequency: "daily" },
  { name: "phone_screen_time", type: "Number (min)", source: "Passive sensing", roleGuess: "Proxy", documented: false, frequency: "daily" },
];
const BASELINE_VARIABLES = ["age", "sex / gender", "AUD diagnosis", "outpatient status"];
const ROLE_COLORS = {
  "ID / linking key": "chip-accent",
  "Linking key": "chip-accent",
  Exposure: "chip-accent",
  Outcome: "chip-danger",
  Confounder: "chip-warning",
  Proxy: "chip-muted",
};

const ROLE_CAUTION_TEXT = {
  sleep_quality: "prior sleep research typically treats sleep quality as the exposure of interest in craving and use studies.",
  alcohol_use_event: "this is consistently modeled as the outcome in the substance-use literature.",
  stress_level: "stress is a well-documented common cause of both sleep disruption and alcohol use, which is why it's usually a confounder.",
  actigraphy_activity: "physical activity is frequently controlled for as a confounder in sleep-behavior studies.",
  phone_screen_time: "screen time is usually treated as an imperfect proxy for a broader behavior pattern, not a direct cause.",
};

function inferFrequency(name) {
  if (/survey|ema/i.test(name)) return "Daily self-report";
  if (/actigra|wearable|accel/i.test(name)) return "Continuous passive sensing";
  if (/phone|screen|smartphone/i.test(name)) return "Continuous passive sensing";
  if (/clinic|visit/i.test(name)) return "Scheduled clinical visit";
  if (/baseline|demo/i.test(name)) return "Collected once at enrollment";
  return "Frequency not detected \u2014 confirm in the data dictionary";
}

function buildDataSummary(datasets, dictionary) {
  if (datasets.length === 0) {
    return "No datasets uploaded yet, so I can't summarize your data structure. Upload at least one dataset in Project Setup first.";
  }
  const domains = new Set();
  datasets.forEach((d) => DOMAIN_MAP.forEach((m) => m.match.test(d.name) && domains.add(m.label)));
  const totalRows = datasets.reduce((s, d) => s + d.rows, 0);
  const participantFields = [...new Set(datasets.map((d) => d.participantField).filter(Boolean))];
  const linkingNote =
    datasets.length > 1
      ? participantFields.length <= 1
        ? `They link cleanly on ${participantFields[0] || "a shared identifier"}.`
        : "They currently use different identifier fields, so linking needs your review."
      : "";
  const docNote = dictionary
    ? dictionary.described === dictionary.total
      ? "Your data dictionary documents every variable I can see."
      : `${dictionary.total - dictionary.described} variable(s) in your data dictionary still need documentation.`
    : "No data dictionary has been uploaded yet, so variable meanings can't be fully verified.";
  return `Here's a summary of your data: ${datasets.length} dataset${datasets.length > 1 ? "s" : ""} totaling about ${totalRows.toLocaleString()} records. The observation unit looks like participant-day, consistent with repeated self-report and sensor measurement. Categories present: ${domains.size ? [...domains].join(", ") : "uncategorized"}. ${linkingNote} ${docNote}`;
}

function buildDataSummaryVariants(datasets, dictionary) {
  const v1 = buildDataSummary(datasets, dictionary);
  if (datasets.length === 0) return [v1];
  const totalRows = datasets.reduce((s, d) => s + d.rows, 0);
  const docNote = dictionary
    ? `${dictionary.described}/${dictionary.total} variables fully documented.`
    : "No data dictionary uploaded yet.";
  const v2 = `Temporal structure: ${datasets.length} dataset${datasets.length > 1 ? "s" : ""} with ~${totalRows.toLocaleString()} records arranged as participant-day observations. The timeline spans EMA check-ins (daily), actigraphy (continuous), and passive sensing (hourly). ${docNote}`;
  const v3 = `Data coverage: ~${totalRows.toLocaleString()} records across ${datasets.length} source${datasets.length > 1 ? "s" : ""}. Participant-day is the natural unit of analysis. Watch for missingness in EMA data (late or skipped surveys) and actigraphy gaps overnight. ${docNote}`;
  return [v1, v2, v3];
}

function buildClarificationAsk() {
  return "Before you move on, one thing needs your input: your data dictionary lists phone_screen_time in hours, but the dataset values range 0\u2013540 \u2014 consistent with minutes, not hours. Can you confirm the correct unit? You can reply right here.";
}

function seedFromName(name, salt = 0) {
  let h = salt;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function StatusChip({ status }) {
  const map = {
    not_uploaded: { icon: Circle, label: "Not uploaded", cls: "chip-muted" },
    uploading: { icon: RefreshCw, label: "Uploading", cls: "chip-accent", spin: true },
    ready: { icon: CheckCircle2, label: "Ready", cls: "chip-success" },
    verified: { icon: CheckCircle2, label: "Verified", cls: "chip-success" },
    clarification: { icon: AlertTriangle, label: "Needs clarification", cls: "chip-warning" },
    review: { icon: AlertTriangle, label: "Needs review", cls: "chip-warning" },
    warning: { icon: ShieldAlert, label: "Review before continuing", cls: "chip-warning" },
    blocking: { icon: XCircle, label: "Cannot be used", cls: "chip-danger" },
    complete: { icon: CheckCircle2, label: "Complete", cls: "chip-success" },
  };
  const m = map[status] || map.not_uploaded;
  const Icon = m.icon;
  return (
    <span className={`chip ${m.cls}`}>
      <Icon size={13} className={m.spin ? "spin" : ""} />
      {m.label}
    </span>
  );
}

function ReadinessRow({ state, label, sub }) {
  const icon =
    state === "complete" ? (
      <CheckCircle2 size={15} className="ok" />
    ) : state === "attention" ? (
      <AlertTriangle size={15} className="warn" />
    ) : (
      <Circle size={15} className="muted" />
    );
  return (
    <div className="readiness-row">
      {icon}
      <div>
        <div className={`readiness-label ${state === "optional" ? "muted-text" : ""}`}>{label}</div>
        {sub && <div className="readiness-sub">{sub}</div>}
      </div>
    </div>
  );
}

function genDatasetDetail(file, seed) {
  const bucket = seed % 3;
  const rows = 1000 + (seed % 40000);
  const cols = 8 + (seed % 30);
  if (bucket === 0) {
    return {
      status: "ready",
      rows,
      cols,
      participantField: "participant_id",
      timestampFields: ["survey_ts"],
      detail: {
        detected: `The file parsed cleanly. Column headers are present and ${rows.toLocaleString()} records were detected across ${cols} columns.`,
        issues: "No structural issues detected.",
        why: "A clean parse means downstream steps can safely reference these columns.",
        action: "No action needed.",
        blocking: false,
      },
    };
  }
  if (bucket === 1) {
    return {
      status: "clarification",
      rows,
      cols,
      participantField: "participant_id",
      timestampFields: ["ts_local", "ts_utc"],
      detail: {
        detected: `${rows.toLocaleString()} records detected. Two timestamp columns were found: ts_local and ts_utc.`,
        issues: "The two timestamp columns use different formats and it isn't clear whether both represent the same events.",
        why: "Misaligned timestamps can distort measures of timing between exposure and outcome later in the workflow.",
        action: "Confirm whether both timestamp columns represent local time, or describe the difference in the data dictionary.",
        blocking: false,
      },
    };
  }
  return {
    status: "warning",
    rows,
    cols,
    participantField: "email",
    timestampFields: ["visit_date"],
    detail: {
      detected: `${rows.toLocaleString()} records detected. A column named "email" may contain direct identifiers.`,
      issues: "Potential direct identifier in an unexpected column.",
      why: "Research data should be de-identified before upload. This automated screen does not certify the dataset is fully de-identified or compliant with institutional requirements.",
      action: "Review the flagged column and remove or hash direct identifiers before continuing.",
      blocking: false,
    },
  };
}

function friendlyError(error, fallback = "The backend request failed.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

const ASSISTANT_RESPONSE_UNAVAILABLE = "Assistant response is unavailable. Please try again.";

function assistantMessageFromResponse(response) {
  if (!response || typeof response !== "object") return ASSISTANT_RESPONSE_UNAVAILABLE;

  const directMessage = [
    response.answer,
    response.assistant_message,
    response.assistantMessage,
    response.message,
    typeof response.response === "string" ? response.response : null,
  ].find((value) => typeof value === "string" && value.trim());
  if (directMessage) return directMessage.trim();

  const suggestionText = [response.recommendations, response.suggestions]
    .filter(Array.isArray)
    .flat()
    .map((item) => typeof item === "string" ? item : item?.message || item?.text || item?.label)
    .filter((item) => typeof item === "string" && item.trim())
    .join(" ");
  return suggestionText || ASSISTANT_RESPONSE_UNAVAILABLE;
}

function describeColumnSource(name) {
  const lower = name.toLowerCase();
  if (lower.includes("pid") || lower.includes("participant") || lower.endsWith("_id")) return "Identifier";
  if (lower.includes("time") || lower.includes("date") || lower.includes("day") || lower.includes("week")) return "Timing";
  if (lower.includes("acc") || lower.includes("magnitude") || lower.includes("step") || lower.includes("wear")) return "Wearable-derived";
  if (lower.includes("phone") || lower.includes("screen") || lower.includes("gps") || lower.includes("lat") || lower.includes("long")) return "Smartphone-derived";
  if (lower.includes("stress") || lower.includes("sleep") || lower.includes("crav") || lower.includes("mood") || lower.includes("label")) return "EMA/self-report";
  if (lower.includes("age") || lower.includes("sex") || lower.includes("gender") || lower.includes("race")) return "Demographic";
  return "Needs clarification";
}

function describeColumnTag(name, schema) {
  const lower = name.toLowerCase();
  const missing = schema?.missing_value_percentage_per_column?.[name] ?? 0;
  if (schema?.possible_id_columns?.includes(name) || lower === "pid" || lower.includes("participant")) return "Identifier";
  if (schema?.possible_timestamp_date_columns?.includes(name) || lower.includes("time") || lower.includes("date") || lower.includes("day")) return "Timestamp";
  if (lower.includes("age") || lower.includes("sex") || lower.includes("gender") || lower.includes("baseline")) return "Baseline";
  if (lower.includes("acc") || lower.includes("magnitude") || lower.includes("wear")) return "Wearable-derived";
  if (lower.includes("phone") || lower.includes("screen") || lower.includes("gps") || lower.includes("lat") || lower.includes("long")) return missing > 30 ? "Proxy measure" : "Smartphone-derived";
  if (lower.includes("stress") || lower.includes("sleep") || lower.includes("crav") || lower.includes("label")) return "EMA/self-report";
  if (lower.includes("lag") || lower.includes("rolling") || lower.includes("window")) return "Derived feature";
  if (missing > 30) return "Needs clarification";
  return "Time-varying";
}

function schemaRows(schema, limit = 30) {
  if (!schema?.column_names?.length) return DATA_SCHEMA.map((v) => ({
    name: v.name,
    type: v.type,
    source: v.source,
    tag: describeColumnTag(v.name, null),
  }));
  return schema.column_names.slice(0, limit).map((name) => ({
    name,
    type: schema.pandas_data_types?.[name] || "Unknown",
    source: describeColumnSource(name),
    tag: describeColumnTag(name, schema),
    missingPct: schema.missing_value_percentage_per_column?.[name] ?? 0,
  }));
}

function descriptiveTagClass(tag) {
  if (tag === "Identifier" || tag === "Timestamp") return "chip-accent";
  if (tag === "Proxy measure" || tag === "Needs clarification") return "chip-warning";
  if (tag === "EMA/self-report" || tag === "Wearable-derived" || tag === "Smartphone-derived") return "chip-success";
  return "chip-muted";
}

function schemaToDataset(file, uploaded, schema, fallbackDetail) {
  const idField = schema?.possible_id_columns?.[0] || null;
  const timestampFields = schema?.possible_timestamp_date_columns || [];
  const warnings = schema?.warnings || [];
  const highMissing = warnings
    .filter((warning) => (warning.missing_percentage ?? 0) >= 30)
    .slice(0, 3);
  const warningText = highMissing.length
    ? `High missingness: ${highMissing.map((w) => `${w.column} ${w.missing_percentage}%`).join(", ")}.`
    : "No high-missingness warnings were returned by schema parsing.";

  return {
    id: uploaded?.saved_filename || `${file.name}-${Date.now()}`,
    savedFilename: uploaded?.saved_filename || file.name,
    originalFilename: uploaded?.original_filename || file.name,
    name: uploaded?.original_filename || file.name,
    size: uploaded?.file_size_bytes || file.size,
    status: "ready",
    rows: schema?.number_of_rows ?? fallbackDetail.rows,
    cols: schema?.number_of_columns ?? fallbackDetail.cols,
    participantField: idField,
    timestampFields,
    schema,
    expanded: false,
    detail: {
      detected: `The backend parsed this dataset: ${(schema?.number_of_rows ?? 0).toLocaleString()} rows and ${schema?.number_of_columns ?? 0} columns.`,
      issues: warningText,
      why: "Phase 2 uses this schema to explain data structure and quality. It does not assign final causal roles.",
      action: highMissing.length ? "Review high-missingness fields before using them in later causal design steps." : "No action needed before data foundation review.",
      blocking: false,
    },
  };
}

function buildRealSchemaAssistantMessage(schema) {
  const ids = schema.possible_id_columns?.join(", ") || "no obvious ID fields";
  const times = schema.possible_timestamp_date_columns?.join(", ") || "no obvious timing fields";
  const highMissing = (schema.warnings || [])
    .filter((warning) => (warning.missing_percentage ?? 0) >= 30)
    .slice(0, 3)
    .map((warning) => `${warning.column} has ${warning.missing_percentage}% missingness`)
    .join("; ");
  return `Uploaded and validated. This dataset has ${schema.number_of_rows.toLocaleString()} rows and ${schema.number_of_columns} columns. I detected ${ids} as possible ID fields and ${times} as timing fields.${highMissing ? ` Biggest missingness warnings: ${highMissing}.` : ""}`;
}

function topMissingness(schema, limit = 6) {
  if (!schema?.missing_value_percentage_per_column) return [];
  return Object.entries(schema.missing_value_percentage_per_column)
    .map(([name, pct]) => ({ name, pct: Number(pct) || 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit);
}

function statusMessage(status) {
  if (!status) return null;
  return status.kind === "error" ? `Error: ${status.message}` : status.message;
}

function actionNoteClass(status) {
  if (!status?.kind) return "";
  if (status.kind === "error") return "action-note-error";
  if (status.kind === "warning") return "action-note-warning";
  if (status.kind === "success") return "action-note-success";
  return "";
}

function WorkflowActivityIndicator({ page, state }) {
  const {
    backendStatus, actionStatus, studyMode, datasets, broadExploration, phase4Status,
    targetedFeasibilityResult, graphValidationResult, graphActionStatus,
    analysisStrategyValidation, analysisStrategyStatus, latestEstimationRun,
    primaryEstimationRun,
  } = state;
  const pageActions = {
    setup: [actionStatus.studyMode, actionStatus.datasetUpload, actionStatus.dictionaryUpload],
    "data-foundation": [actionStatus.datasetUpload, actionStatus.dictionaryUpload, actionStatus.documentIngestion],
    explore: [actionStatus.broadExploration],
    question: [phase4Status],
    feasibility: [actionStatus.targetedFeasibility],
    graph: [graphActionStatus],
    strategy: [analysisStrategyStatus],
  };
  const action = (pageActions[page] || []).find((item) => item?.kind === "loading")
    || (pageActions[page] || []).find(Boolean);
  const hasGraphWarnings = (graphValidationResult?.warnings || []).length > 0;
  const hasStrategyWarnings = (analysisStrategyValidation?.warnings || []).length > 0;
  const phaseLabel = {
    setup: studyMode ? "Loaded from approved BDE workspace" : "Requires user confirmation",
    "data-foundation": datasets?.length ? "Backend-computed schema available" : "Requires user confirmation",
    explore: broadExploration ? "Backend-computed exploration summary" : "Run backend exploration to compute a summary",
    question: "Generated draft — editable",
    feasibility: targetedFeasibilityResult ? "Feasibility computed from active dataset" : "Requires user confirmation",
    graph: graphValidationResult ? (hasGraphWarnings ? "Validated with warnings" : "Validated by backend") : "Requires user confirmation",
    strategy: analysisStrategyValidation ? (hasStrategyWarnings ? "Validated with warnings" : "Validated by backend") : "Requires user confirmation",
    estimation: primaryEstimationRun || latestEstimationRun ? "Computed by backend/Python" : "Requires user confirmation",
    review: primaryEstimationRun ? "Backend-computed review package requires user confirmation" : "Requires user confirmation",
  }[page] || "Backend-connected workflow";
  const isLoading = action?.kind === "loading";
  const statusClass = isLoading ? "" : actionNoteClass(action);

  return (
    <div className={`action-note ${statusClass}`} style={{ margin: "10px 16px 0" }} role="status" aria-live="polite">
      <strong>{isLoading ? "Backend action in progress" : backendStatus.connected ? "Backend-connected" : "Backend unavailable"}</strong>
      {isLoading && <RefreshCw size={13} className="spin" style={{ marginLeft: 6, verticalAlign: "-2px" }} />}
      <span> · {isLoading ? action.message : phaseLabel}</span>
      {!isLoading && action?.message && <span> · {action.message}</span>}
      <div className="helper" style={{ marginTop: 4 }}>
        {studyMode ? "Approved study dataset is loaded. " : ""}
        {page === "estimation" ? "Numerical outputs are computed by backend/Python." : "LLM guidance only — not numerical estimation."}
      </div>
    </div>
  );
}

function documentValidationMessage(validation, fallback = "Upload successful.") {
  const labels = {
    uploaded_and_validated: "Uploaded and validated",
    requires_clarification: "Requires clarification",
    incomplete_document: "Incomplete document",
    incorrect_document_type: "Incorrect document type",
    error: "Validation error",
  };
  if (!validation?.status) return fallback;
  const warnings = validation.warnings?.length ? ` Warnings: ${validation.warnings.slice(0, 2).join(" ")}` : "";
  return `${labels[validation.status] || "Upload successful"}. ${validation.summary || ""}${warnings}`.trim();
}

function documentValidationKind(validation) {
  if (!validation?.status) return "success";
  if (validation.status === "uploaded_and_validated") return "success";
  if (["requires_clarification", "incomplete_document", "incorrect_document_type"].includes(validation.status)) return "warning";
  return "error";
}

function firstRealDataset(datasets) {
  return datasets.find((dataset) => dataset.savedFilename) || datasets[0] || null;
}

function realDatasetFilename(dataset) {
  return dataset?.savedFilename || dataset?.name || "";
}

function schemaColumnNames(dataset) {
  return dataset?.schema?.column_names || [];
}

function resolveDatasetColumn(dataset, candidates = []) {
  const columns = schemaColumnNames(dataset);
  if (!columns.length) return candidates.find(Boolean) || "";
  const normalized = candidates
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);
  const exact = normalized.find((value) => columns.includes(value));
  if (exact) return exact;
  const lowerExact = normalized
    .map((value) => columns.find((column) => column.toLowerCase() === value.toLowerCase()))
    .find(Boolean);
  if (lowerExact) return lowerExact;
  const tokenMatch = normalized
    .map((value) => {
      const lower = value.toLowerCase();
      return columns.find((column) => lower.includes(column.toLowerCase()) || column.toLowerCase().includes(lower));
    })
    .find(Boolean);
  return tokenMatch || "";
}

function formatList(values, fallback = "None detected") {
  if (!values?.length) return fallback;
  return values.slice(0, 8).join(", ");
}

const ASSISTANT_PHASE_MAP = {
  setup: "phase_1_project_setup",
  "data-foundation": "phase_2_data_foundation",
  explore: "phase_3_broad_exploration",
  question: "phase_4_question_variables",
  feasibility: "phase_5_feasibility",
  graph: "phase_6_causal_graph",
  strategy: "phase_7_analysis_strategy",
  estimation: "phase_8_estimation",
  review: "phase_9_review_export",
};

function assistantActionForPrompt(pageKey, prompt) {
  const lowered = prompt.toLowerCase();
  if (lowered.includes("warning") || lowered.includes("quality") || lowered.includes("diagnostic") || lowered.includes("blocked")) return "explain_warning";
  if (lowered.includes("regenerate")) return "regenerate";
  if (lowered.includes("alternative")) return "generate_alternative";
  if (lowered.includes("reprocess")) return "reprocess_with_feedback";
  if (lowered.includes("revise")) return "revise_using_my_changes";
  if (lowered.includes("next") || lowered.includes("should i") || lowered.includes("what should")) return "recommend_next_action";
  if (pageKey === "setup") return "summarize";
  return "interpret";
}

function acceptedExtensions(accept) {
  return (accept || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.startsWith("."));
}

function splitAcceptedFiles(files, accept) {
  const extensions = acceptedExtensions(accept);
  if (!extensions.length) return { accepted: files, rejected: [] };
  return files.reduce((acc, file) => {
    const lowerName = file.name.toLowerCase();
    const allowed = extensions.some((ext) => lowerName.endsWith(ext));
    acc[allowed ? "accepted" : "rejected"].push(file);
    return acc;
  }, { accepted: [], rejected: [] });
}

function UploadDropzone({ label, onFiles, multiple, accept, compact, rejectedMessage }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const { accepted, rejected } = splitAcceptedFiles(files, accept);
    if (rejected.length > 0) {
      window.alert(rejectedMessage || `Unsupported file type: ${rejected.map((file) => file.name).join(", ")}. Accepted formats: ${acceptedExtensions(accept).join(", ") || "listed formats"}.`);
    }
    if (accepted.length > 0) onFiles(multiple ? accepted : accepted.slice(0, 1));
  }
  return (
    <div
      className={`dropzone ${dragOver ? "dropzone-active" : ""} ${compact ? "dropzone-compact" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
    >
      <UploadCloud size={compact ? 18 : 22} className="dropzone-icon" />
      <div className="dropzone-text">
        <span className="dropzone-title">Drag files here</span>
        <span className="dropzone-sub">{label}</span>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
        Select files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ValidationDetails({ detail }) {
  return (
    <div className="validation-panel">
      <div className="validation-row"><span className="validation-label">What was detected</span><p>{detail.detected}</p></div>
      <div className="validation-row"><span className="validation-label">Potential issues</span><p>{detail.issues}</p></div>
      <div className="validation-row"><span className="validation-label">Why it matters</span><p>{detail.why}</p></div>
      <div className="validation-row"><span className="validation-label">Required action</span><p>{detail.action}</p></div>
      <div className="validation-row">
        <span className={`blocking-tag ${detail.blocking ? "blocking" : "nonblocking"}`}>
          {detail.blocking ? "Blocks continuation" : "Does not block continuation"}
        </span>
      </div>
    </div>
  );
}

function DatasetRow({ ds, onRemove, onReplace, onToggle, onPreview, simple }) {
  return (
    <div className="file-row">
      <div className="file-row-main">
        <FileText size={18} className="file-icon" />
        <div className="file-meta">
          <div className="file-name">{ds.name}</div>
          <div className="file-sub">
            {formatBytes(ds.size)} \u00b7 {ds.rows.toLocaleString()} rows \u00b7 {ds.cols} columns
            {ds.participantField && <> \u00b7 id: {ds.participantField}</>}
          </div>
        </div>
        <StatusChip status={ds.status} />
        {!simple && (
          <div className="file-actions">
            <button className="icon-btn" aria-label="Preview dataset" title="Preview" onClick={onPreview}><Eye size={15} /></button>
            <button className="icon-btn" aria-label="Replace dataset" title="Replace" onClick={onReplace}><RefreshCw size={15} /></button>
            <button className="icon-btn icon-btn-danger" aria-label="Remove dataset" title="Remove" onClick={onRemove}><Trash2 size={15} /></button>
          </div>
        )}
        {simple && (
          <button className="icon-btn icon-btn-danger" aria-label="Remove dataset" title="Remove" onClick={onRemove}><Trash2 size={15} /></button>
        )}
      </div>
      {!simple && (
        <>
          <button className="expand-toggle" onClick={onToggle}>
            {ds.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Validation details
          </button>
          {ds.expanded && <ValidationDetails detail={ds.detail} />}
        </>
      )}
    </div>
  );
}

const GUIDELINE_TYPES = [
  "Clinical practice guideline",
  "Measurement guideline",
  "Reporting standard",
  "Government guidance",
  "Professional association guidance",
];

const STYLE = `
  .ps-root {
    --bg: #F5F7FA; --card: #FFFFFF; --border: #E1E5EB; --navy: #16233D; --text-2: #5B6472; --text-3: #8A93A3;
    --accent: #2F5D8A; --accent-soft: #EAF1F8; --success: #2A7A55; --success-soft: #E7F4ED;
    --warning: #A6650E; --warning-soft: #FBF0DA; --danger: #B8382B; --danger-soft: #FBEAE7; --radius: 10px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg); color: var(--navy);
    display: grid; grid-template-columns: 220px minmax(0, 1fr) 320px; grid-template-rows: 1fr;
    height: 100vh; width: 100%; min-height: 560px; margin: 0;
    border: none; border-radius: 0; overflow: hidden;
  }
  .ps-root * { box-sizing: border-box; }
  .ps-root h1, .ps-root h2, .ps-root h3 { font-family: 'IBM Plex Sans', 'Inter', sans-serif; color: var(--navy); margin: 0; }
  @media (max-width: 980px) { .ps-root { grid-template-columns: 1fr; height: auto; max-height: none; } .leftnav, .assistant-col { display: none; } }

  .leftnav { background: var(--navy); color: #fff; padding: 18px 14px; display: flex; flex-direction: column; overflow-y: auto; height: 100%; min-height: 0; }
  .leftnav-brand { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 600; padding: 4px 6px 20px; }
  .leftnav-brand .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; font-size: 12.5px; color: rgba(255,255,255,0.55); margin-bottom: 2px; cursor: pointer; border: none; background: none; width: 100%; text-align: left; }
  .nav-item.active { background: rgba(255,255,255,0.1); color: #fff; font-weight: 500; }
  .nav-item.builtinactive:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .nav-item .num { width: 17px; height: 17px; border-radius: 50%; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; font-size: 9.5px; flex-shrink: 0; }
  .nav-item.active .num { background: var(--accent); }
  .nav-item .lock { margin-left: auto; opacity: 0.5; }
  .nav-footer { margin-top: auto; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.12); font-size: 11.5px; color: rgba(255,255,255,0.5); }

  .main-col { padding: 12px 18px 24px; overflow-y: auto; min-height: 0; }
  .text-justify { text-align: justify; }
  .main-col-canvas { padding: 0; overflow: hidden; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ps-header { margin-bottom: 8px; }
  .ps-header-top { display: flex; align-items: center; gap: 10px; }
  .ps-header h1 { font-size: 18px; }
  .ps-header p { color: var(--text-2); font-size: 12px; line-height: 1.45; max-width: 560px; margin: 4px 0 0; }
  .ps-header .note { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12px; color: var(--accent); background: var(--accent-soft); padding: 5px 10px; border-radius: 6px; }

  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 13px; margin-bottom: 8px; }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .card-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .card-desc { font-size: 11px; color: var(--text-2); line-height: 1.4; margin: 1px 0 7px; max-width: 540px; }
  .card-info-btn { width: 17px; height: 17px; border-radius: 50%; border: 1.5px solid #CBD5E1; background: transparent; color: #94A3B8; font-size: 9.5px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 1; transition: background .15s, border-color .15s, color .15s; flex-shrink: 0; }
  .card-info-btn:hover, .card-info-btn.active { background: #EFF7FF; border-color: #2F5D8A; color: #2F5D8A; }
  .card-info-popover { position: absolute; top: calc(100% + 6px); right: 0; width: 275px; background: #fff; border: 1px solid #CFE0EE; border-radius: 8px; padding: 10px 13px; font-size: 11.5px; font-weight: 400; line-height: 1.6; color: #374151; box-shadow: 0 6px 24px rgba(0,0,0,0.12); z-index: 200; }
  .card-info-popover::before { content: ""; position: absolute; top: -5px; right: 5px; width: 9px; height: 9px; background: #fff; border-left: 1px solid #CFE0EE; border-top: 1px solid #CFE0EE; transform: rotate(45deg); }

  .insight-card { border-left: 3px solid var(--accent); background: #FAFCFF; }
  .insight-card-header { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
  .insight-icon { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .insight-icon-blue { background: var(--accent-soft); color: var(--accent); }
  .insight-icon-green { background: var(--success-soft); color: var(--success); }
  .insight-icon-orange { background: var(--warning-soft); color: var(--warning); }
  .insight-icon-purple { background: #EEE8F8; color: #6B46A8; }
  .insight-icon-teal { background: #E4F4F2; color: #1F7A6E; }
  .insight-subtitle { font-size: 10px; color: var(--text-3); font-style: italic; margin-top: 1px; }
  .insight-value { font-size: 12.5px; font-weight: 600; border-radius: 6px; padding: 6px 10px; margin: 0 0 8px; line-height: 1.45; }
  .insight-value-blue { background: var(--accent-soft); color: var(--accent); }
  .insight-value-green { background: var(--success-soft); color: var(--success); }
  .insight-value-orange { background: var(--warning-soft); color: var(--warning); }
  .insight-value-purple { background: #EEE8F8; color: #6B46A8; }
  .insight-value-teal { background: #E4F4F2; color: #1F7A6E; }
  .insight-body { font-size: 12px; color: var(--text-2); line-height: 1.6; margin: 0 0 6px; }
  .insight-body strong { color: var(--navy); }
  .insight-body em { font-style: italic; color: var(--navy); }
  .insight-note { font-size: 11px; color: var(--text-3); background: #F5F7FA; border-radius: 5px; padding: 6px 9px; margin-top: 8px; display: flex; gap: 5px; align-items: flex-start; line-height: 1.5; }

  /* ── Graph regen bar ── */
  .graph-regen-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 14px; background: #F8FAFC; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .graph-regen-bar-locked { background: #F0FAF4; border-bottom-color: var(--success); }

  /* ── RegenerateBlock ── */
  .regen-block { position: relative; }
  .regen-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #D5DBE4; }
  .regen-toolbar-left { display: flex; align-items: center; gap: 6px; }
  .regen-toolbar-right { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .regen-nav { display: flex; align-items: center; gap: 2px; background: #F1F3F6; border-radius: 6px; padding: 2px; }
  .regen-nav-btn { border: none; background: transparent; color: var(--navy); cursor: pointer; width: 22px; height: 22px; border-radius: 4px; font-size: 13px; display: flex; align-items: center; justify-content: center; }
  .regen-nav-btn:hover:not(:disabled) { background: #E2E5EB; }
  .regen-nav-btn:disabled { color: #C5CAD3; cursor: not-allowed; }
  .regen-version-label { font-size: 10.5px; color: var(--text-2); font-weight: 600; padding: 0 4px; }
  .regen-locked-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; color: var(--success); background: var(--success-soft); border-radius: 999px; padding: 3px 9px; }
  .regen-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
  .regen-compare-panel { border-radius: 7px; padding: 10px 12px; border: 1px solid var(--border); background: #F8F9FB; }
  .regen-compare-panel-current { background: var(--accent-soft); border-color: #CFE0EE; }
  .regen-compare-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin-bottom: 6px; }
  .regen-compare-label-current { color: var(--accent); }
  .regen-block-locked .regen-toolbar { border-top-style: solid; border-top-color: var(--success); }
  .regen-compare-btn { display: flex; align-items: center; gap: 4px; padding: 3px 7px !important; }
  .lag-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 8px 0 4px; }
  .lag-table th { text-align: left; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); padding: 3px 8px 5px; border-bottom: 1px solid var(--border); }
  .lag-table td { padding: 5px 8px; border-bottom: 1px solid #F2F4F7; vertical-align: top; }
  .lag-table .row-active td { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .lag-table .row-active td:first-child { border-radius: 4px 0 0 4px; }
  .lag-table .row-active td:last-child { border-radius: 0 4px 4px 0; }
  .badge { font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; padding: 2px 7px; border-radius: 5px; flex-shrink: 0; }
  .badge-required { background: var(--danger-soft); color: var(--danger); }
  .badge-optional { background: #EEF0F4; color: var(--text-2); }
  .helper { font-size: 10.5px; color: var(--text-3); margin-top: 7px; display: flex; gap: 5px; align-items: flex-start; }
  .backend-status { margin-top: 8px; display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; border: 1px solid var(--border); padding: 5px 9px; font-size: 11px; font-weight: 700; }
  .backend-status small { font-size: 10.5px; font-weight: 500; color: var(--text-3); }
  .backend-status-ok { background: #ECFDF5; border-color: #BBF7D0; color: #047857; }
  .backend-status-warn { background: #FFF7ED; border-color: #FED7AA; color: #B45309; }
  .action-note { margin-top: 8px; border-radius: 8px; background: #F8FAFC; border: 1px solid var(--border); padding: 8px 10px; color: var(--text-2); font-size: 11.5px; line-height: 1.4; }
  .action-note-success { background: #ECFDF5; border-color: #BBF7D0; color: #047857; }
  .action-note-warning { background: #FFFBEB; border-color: #FDE68A; color: #92400E; }
  .action-note-error { background: #FFF1F2; border-color: #FECDD3; color: #BE123C; }
  .button-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .real-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
  .real-summary-card { border: 1px solid var(--border); border-radius: 9px; background: #FAFBFC; padding: 8px 10px; min-width: 0; }
  .real-summary-card span { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-3); font-weight: 700; margin-bottom: 3px; }
  .real-summary-card strong { display: block; color: var(--navy); font-size: 11.5px; line-height: 1.35; font-weight: 650; overflow-wrap: anywhere; }
  .real-summary-card-wide { grid-column: span 2; }
  .backend-warning-list { margin: 10px 0 0; padding-left: 18px; color: var(--warning); font-size: 11.5px; line-height: 1.45; }
  @media (max-width: 1100px) { .real-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  .readiness-card .card-head { margin-bottom: 8px; }
  .readiness-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0px 20px; }
  .readiness-count-inline { font-size: 12px; color: var(--text-2); font-weight: 500; }
  .readiness-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }

  textarea.objective-input { width: 100%; min-height: 90px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 13px; font-family: inherit; resize: vertical; color: var(--navy); }
  textarea.objective-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .objective-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
  .char-count { font-size: 11px; color: var(--text-3); }

  .btn { border-radius: 7px; font-size: 12.5px; font-weight: 500; padding: 7px 13px; border: 1px solid var(--border); background: #fff; color: var(--navy); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .btn:hover { background: #F8F9FB; }
  .btn-sm { padding: 5px 10px; font-size: 11.5px; }
  .btn-secondary { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .btn-secondary:hover { background: #E0EBF4; }
  .btn-primary { background: var(--navy); color: #fff; border-color: var(--navy); }
  .btn-primary:hover { background: #223251; }
  .btn-primary:disabled { background: #C7CBD3; border-color: #C7CBD3; cursor: not-allowed; }
  .btn-ghost { border-color: transparent; background: transparent; }

  .feedback-panel { margin-top: 12px; background: var(--accent-soft); border: 1px solid #CFE0EE; border-radius: 8px; padding: 12px 14px; }
  .feedback-panel .title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--accent); margin-bottom: 6px; }
  .feedback-panel p { font-size: 12.5px; color: var(--navy); margin: 0 0 10px; line-height: 1.5; }
  .feedback-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .dropzone { border: 1.5px dashed var(--border); border-radius: 10px; padding: 16px; display: flex; align-items: center; gap: 14px; background: #FBFCFD; }
  .dropzone-active { border-color: var(--accent); background: var(--accent-soft); }
  .dropzone-compact { padding: 12px; }
  .dropzone-icon { color: var(--text-3); flex-shrink: 0; }
  .dropzone-text { flex: 1; display: flex; flex-direction: column; }
  .dropzone-title { font-size: 12.5px; font-weight: 500; }
  .dropzone-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }

  .file-row { border: 1px solid var(--border); border-radius: 9px; padding: 9px 12px; margin-top: 8px; }
  .file-row-main { display: flex; align-items: center; gap: 10px; }
  .file-icon { color: var(--text-3); flex-shrink: 0; }
  .file-meta { flex: 1; min-width: 0; }
  .file-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }
  .file-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .icon-btn { border: none; background: transparent; color: var(--text-2); padding: 5px; border-radius: 6px; cursor: pointer; display: flex; }
  .icon-btn:hover { background: #F1F2F5; }
  .icon-btn-danger:hover { background: var(--danger-soft); color: var(--danger); }
  .expand-toggle { margin-top: 8px; border: none; background: none; color: var(--accent); font-size: 11.5px; display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 0; }

  .validation-panel { margin-top: 8px; background: #FAFBFC; border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; }
  .validation-row { margin-bottom: 5px; }
  .validation-row:last-child { margin-bottom: 0; }
  .validation-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
  .validation-row p { font-size: 12.5px; margin: 3px 0 0; line-height: 1.5; color: var(--navy); }
  .blocking-tag { font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 5px; }
  .blocking-tag.blocking { background: var(--danger-soft); color: var(--danger); }
  .blocking-tag.nonblocking { background: var(--success-soft); color: var(--success); }

  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 999px; flex-shrink: 0; }
  .chip-muted { background: #EEF0F4; color: var(--text-3); }
  .chip-accent { background: var(--accent-soft); color: var(--accent); }
  .chip-success { background: var(--success-soft); color: var(--success); }
  .chip-warning { background: var(--warning-soft); color: var(--warning); }
  .chip-danger { background: var(--danger-soft); color: var(--danger); }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .coverage-bar-track { height: 6px; background: #EDEFF3; border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .coverage-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; }

  .upload-detail-box { background: #F7F8FA; border: 1px solid var(--border); border-radius: 9px; padding: 10px 14px; margin: 8px 0 12px; display: flex; flex-direction: column; gap: 7px; }
  .upload-detail-row { display: flex; gap: 10px; font-size: 12px; line-height: 1.5; }
  .upload-detail-row-col { flex-direction: column; gap: 4px; }
  .upload-detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); white-space: nowrap; min-width: 100px; padding-top: 1px; }
  .upload-detail-sub { font-size: 12px; color: var(--text-2); line-height: 1.5; }
  .upload-checklist { margin: 4px 0 0 16px; padding: 0; font-size: 12px; color: var(--navy); line-height: 1.7; }
  .upload-checklist li { margin: 0; }
  .upload-checklist code { background: #EEF0F4; padding: 1px 5px; border-radius: 4px; font-size: 11px; }

  .readiness-row { display: flex; gap: 8px; padding: 6px 0; align-items: flex-start; }
  .readiness-row .ok { color: var(--success); flex-shrink: 0; margin-top: 1px; }
  .readiness-row .warn { color: var(--warning); flex-shrink: 0; margin-top: 1px; }
  .readiness-row .muted { color: var(--text-3); flex-shrink: 0; margin-top: 1px; }
  .readiness-label { font-size: 12px; font-weight: 500; line-height: 1.4; }
  .muted-text { color: var(--text-3); font-weight: 400; }
  .readiness-sub { font-size: 10.5px; color: var(--text-3); margin-top: 1px; }

  .overlay { position: fixed; inset: 0; background: rgba(22,35,61,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
  .dialog { background: #fff; border-radius: 12px; padding: 22px 24px; max-width: 420px; width: 100%; }
  .dialog h3 { font-size: 15px; margin-bottom: 8px; }
  .dialog p { font-size: 13px; color: var(--text-2); line-height: 1.55; margin-bottom: 18px; }
  .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }

  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--navy); color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 13px; z-index: 60; }

  .assistant-col { background: #FAFBFC; border-left: 1px solid var(--border); display: flex; flex-direction: column; height: 100%; max-height: 100%; min-height: 0; }
  .assistant-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
  .assistant-head span { font-size: 13.5px; font-weight: 600; }
  .assistant-body { padding: 14px 14px 8px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .msg { font-size: 12.5px; line-height: 1.5; padding: 9px 11px; border-radius: 10px; max-width: 92%; white-space: pre-line; }
  .msg-user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 3px; }
  .msg-assistant { align-self: flex-start; background: #EFF1F5; color: var(--navy); border-bottom-left-radius: 3px; }
  .assistant-questions { display: flex; flex-direction: column; gap: 6px; padding: 8px 14px 4px; flex-shrink: 0; }
  .assistant-next-row { padding: 4px 14px 8px; flex-shrink: 0; }
  .assistant-next-btn { width: 100%; background: var(--navy); color: #fff; border: none; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .assistant-next-btn:hover { background: #223251; }
  .assistant-q { text-align: left; font-size: 11.5px; border: 1px solid var(--border); background: #fff; border-radius: 7px; padding: 6px 10px; cursor: pointer; color: var(--navy); }
  .assistant-q:hover { background: var(--accent-soft); border-color: var(--accent); }
  .assistant-caveat { font-size: 10px; color: var(--text-3); padding: 8px 14px; line-height: 1.4; flex-shrink: 0; }
  .assistant-inputbar { display: flex; gap: 6px; padding: 10px 14px 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
  .assistant-inputbar input { flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; font-family: inherit; }
  .assistant-inputbar input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .assistant-send { background: var(--navy); color: #fff; border: none; border-radius: 8px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .assistant-send:hover { background: #223251; }

  .paper-row, .guideline-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; margin-top: 8px; }
  .paper-meta { flex: 1; min-width: 0; }
  .paper-title { font-size: 12.5px; font-weight: 500; }
  .paper-sub { font-size: 10.5px; color: var(--text-3); margin-top: 2px; }
  .source-tag { font-size: 10px; font-weight: 600; padding: 3px 7px; border-radius: 5px; background: #EEF0F4; color: var(--text-2); white-space: nowrap; }
  .dup-tag { font-size: 10px; font-weight: 600; padding: 3px 7px; border-radius: 5px; background: var(--warning-soft); color: var(--warning); white-space: nowrap; }

  .connection-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px; }
  .connection-card { border: 1px solid var(--border); border-radius: 9px; padding: 12px 14px; }
  .connection-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .connection-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
  .connection-value { font-size: 13.5px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; }
  .connection-sub { font-size: 11px; color: var(--text-2); margin-top: 4px; line-height: 1.4; }

  .next-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--accent-soft); border: 1px solid #CFE0EE; border-radius: 10px; padding: 14px 16px; margin-top: 4px; }
  .next-bar p { font-size: 12.5px; color: var(--accent); margin: 0; }

  .filter-row { display: flex; flex-wrap: wrap; gap: 24px; }
  .filter-group { display: flex; flex-direction: column; gap: 6px; }
  .filter-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
  .filter-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .filter-pill { font-size: 11.5px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--text-2); cursor: pointer; }
  .filter-pill-active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }
  .two-col .card { margin-bottom: 0; }

  .mini-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .mini-table th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-3); font-weight: 700; padding: 3px 7px; border-bottom: 1px solid var(--border); }
  .mini-table td { padding: 4px 7px; border-bottom: 1px solid #F0F1F4; color: var(--navy); font-size: 11px; }
  .cell-ok { color: var(--success); font-weight: 600; }
  .cell-warn { color: var(--warning); font-weight: 600; }

  .pattern-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid #F0F1F4; font-size: 12px; }
  .pattern-row:last-child { border-bottom: none; }
  .pattern-row span:first-child { flex: 1; }
  .pattern-stat { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--text-3); margin-left: 6px; }

  .unit-callout { font-size: 13px; font-weight: 500; color: var(--accent); background: var(--accent-soft); border-radius: 8px; padding: 9px 12px; }
  .mini-stat-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .mini-stat { flex: 1; min-width: 140px; background: #FAFBFC; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
  .mini-stat-label { font-size: 10.5px; color: var(--text-3); }
  .mini-stat-value { font-size: 17px; font-weight: 600; color: var(--navy); }

  .plain-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .plain-list li { font-size: 12.5px; color: var(--navy); display: flex; align-items: center; gap: 8px; }
  .freq-tag { font-size: 10px; padding: 2px 7px; }

  .metric-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
  .metric-bar-label { width: 150px; font-size: 12px; color: var(--navy); flex-shrink: 0; }
  .metric-bar-track { flex: 1; height: 8px; background: #EDEFF3; border-radius: 4px; overflow: hidden; }
  .metric-bar-fill { height: 100%; border-radius: 4px; }
  .metric-bar-value { width: 44px; text-align: right; font-size: 12px; font-weight: 600; color: var(--navy); flex-shrink: 0; }

  .link-check-row { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--success); background: var(--success-soft); padding: 6px 12px; border-radius: 999px; }
  .link-check-row.warn { color: var(--warning); background: var(--warning-soft); }

  .inconsistency-card { background: var(--warning-soft); border: 1px solid #F0D9AE; border-radius: 10px; padding: 14px 16px; }
  .inconsistency-card p { font-size: 12.5px; color: #6B4A0E; margin: 0; line-height: 1.55; }

  .lag-reality-box { background: #F7F8FA; border: 1px solid var(--border); border-radius: 9px; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .lag-reality-row { display: flex; gap: 12px; font-size: 12px; line-height: 1.55; }
  .lag-reality-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); white-space: nowrap; min-width: 130px; padding-top: 2px; flex-shrink: 0; }
  .text-warn { color: var(--warning); font-weight: 500; }
  .corr-table td { vertical-align: middle; }
  .tempo-card { border-left: 4px solid var(--success); }
  .tempo-card-partial { border-left: 4px solid var(--warning); }
  .tempo-card-invalid { border-left: 4px solid var(--danger); }
  .summary-callout { font-size: 13px; color: var(--navy); background: #FAFBFC; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; line-height: 1.6; }

  .select-input { border: 1px solid var(--border); border-radius: 7px; padding: 5px 10px; font-size: 11.5px; font-family: inherit; color: var(--navy); background: #fff; flex-shrink: 0; }
  .select-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

  .question-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 14px; }
  .question-field { display: flex; flex-direction: column; gap: 5px; }

  .feature-row { border: 1px solid var(--border); border-radius: 9px; padding: 7px 12px; margin-top: 6px; }
  .feature-checkbox { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
  .feature-checkbox input { margin-top: 3px; flex-shrink: 0; }
  .feature-label { font-size: 12.5px; font-weight: 500; color: var(--navy); }
  .feature-desc { font-size: 11px; color: var(--text-3); margin-top: 2px; }

  .slider-row { margin-bottom: 14px; }
  .slider-row input[type="range"] { width: 100%; margin-top: 6px; accent-color: var(--accent); }

  .graph-page { display: flex; flex-direction: column; height: 100%; }
  .graph-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); flex-wrap: wrap; flex-shrink: 0; }
  .graph-toolbar-title { font-size: 14.5px; font-weight: 600; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
  .graph-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--text-2); align-items: center; }
  .legend-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .legend-dash { width: 14px; height: 0; border-top: 2px dashed var(--text-3); border-radius: 0; background: none; }
  .graph-canvas-wrap { position: relative; flex: 1; min-height: 480px; background: #FAFBFC; }
  .graph-canvas-wrap svg { width: 100%; height: 100%; display: block; }
  .graph-node-label { font-size: 11px; font-weight: 600; }
  .graph-node-sub { font-size: 9px; }
  .graph-notice { position: absolute; bottom: 14px; left: 16px; background: #fff; border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; font-size: 11.5px; color: var(--text-2); }
  .graph-side-panel { position: absolute; top: 16px; right: 16px; width: 250px; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; box-shadow: 0 6px 20px rgba(22,35,61,0.15); }
  .graph-side-panel h4 { font-size: 13px; margin: 0 0 8px; }
  .graph-side-panel p { font-size: 11.5px; color: var(--text-2); line-height: 1.5; margin: 8px 0; }

  .radio-row { display: flex; gap: 20px; }
  .radio-option { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--navy); cursor: pointer; }

  .estimator-row { border: 1px solid var(--border); border-radius: 9px; padding: 7px 12px; margin-top: 6px; cursor: pointer; }
  .estimator-row:hover { background: #FAFBFC; }
  .estimator-row-active { border-color: var(--accent); background: var(--accent-soft); }
`;

function ProjectSetupView({ state, actions }) {
  const { objective, showFeedback, feedbackApplied, datasets, dictionary, protocol, papers, guidelines, backendStatus, actionStatus, ingestionInfo, ragSummary, studyMode, studySessionLog } = state;
  const {
    setObjective, setShowFeedback, applyFeedback, addDatasets, removeDataset, toggleDataset, replaceDataset,
    addDictionary, setDictionary, addProtocol, setProtocol, addPapers, setPapers, addGuidelines, setGuidelines,
    checks, requiredCount, requiredTotal, canContinue, handleContinue, showToast, blockingDatasets, handleDocumentIngestion, handleDictionaryRagCheck, startFixedBdeStudyMode, exportStudySessionLog,
  } = actions;
  const ingestedChunks = ingestionInfo?.number_of_stored_chunks ?? ingestionInfo?.stored_chunks ?? ingestionInfo?.lastResult?.number_of_chunks_created ?? ingestionInfo?.lastResult?.chunks_created ?? 0;

  return (
    <>
      <div className="ps-header">
        <h1>Project setup</h1>
        <p>
          Define the initial study objective and upload the materials needed to understand your data.
          Each item is reviewed separately because it serves a different purpose in the causal design workflow.
        </p>
        <span className="note"><Info size={12} /> Your research objective and variable definitions can be refined later.</span>
        <div className={`backend-status ${backendStatus.connected ? "backend-status-ok" : "backend-status-warn"}`}>
          <span>{backendStatus.connected ? "Backend connected" : "Backend not connected"}</span>
          <small>{backendStatus.message}</small>
        </div>
      </div>

      <div className="card readiness-card">
        <div className="button-row" style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={startFixedBdeStudyMode}><Sparkles size={14} /> Load approved BDE study workspace</button>
          {studyMode && <button className="btn btn-secondary" onClick={exportStudySessionLog}><Save size={14} /> Export study session log ({studySessionLog?.length || 0})</button>}
          <span className="chip chip-warning">Prepared draft — editable, not yet confirmed.</span>
        </div>
        <div className="card-head">
          <div className="card-title"><ClipboardList size={16} color="var(--accent)" /> Project readiness</div>
          <span className="readiness-count-inline">{requiredCount} of {requiredTotal} required checks complete</span>
          <CardInfo text="Tracks which required and optional items need to be completed before moving forward. Green = complete, amber = still needed. At minimum, one dataset and a data dictionary must be uploaded." />
        </div>
        <div className="readiness-grid">
          <ReadinessRow state={checks.objectiveAdded ? "complete" : "attention"} label="Research objective added" />
          <ReadinessRow state={checks.dictionaryUploaded ? "complete" : "attention"} label="Data dictionary uploaded" />
          <ReadinessRow state={checks.datasetUploaded ? "complete" : "attention"} label="At least one dataset uploaded" />
          <ReadinessRow
            state={!checks.dictionaryUploaded ? "attention" : checks.variablesMatched ? "complete" : "attention"}
            label="Variables matched to dictionary"
            sub={dictionary && dictionary.described < dictionary.total ? `${dictionary.total - dictionary.described} undocumented` : undefined}
          />
          <ReadinessRow
            state={!checks.datasetUploaded ? "attention" : checks.datasetParsed ? "complete" : "attention"}
            label="Dataset can be parsed"
            sub={blockingDatasets ? "One or more datasets unreadable" : undefined}
          />
          <ReadinessRow state={checks.blockingResolved ? "complete" : "attention"} label="Blocking clarifications resolved" />
          <ReadinessRow state={protocol ? "complete" : "optional"} label="Optional protocol added" />
          <ReadinessRow state={papers.length || guidelines.length ? "complete" : "optional"} label="Optional evidence sources added" />
        </div>
        <div className="readiness-actions">
          <button className="btn" onClick={() => showToast("Draft saved")}><Save size={14} /> Save draft</button>
          <button className="btn btn-primary" onClick={handleContinue}>
            Continue to data foundation <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Sparkles size={16} color="var(--accent)" /> Initial research objective</div>
          <span className="badge badge-required">REQUIRED</span>
          <CardInfo text="A 1–3 sentence plain-language statement of what you want to study. No need to specify exposure, outcome, or timing yet — those are defined formally in Step 4 (Question & Variables)." />
        </div>
        <p className="card-desc">Briefly describe what you want to investigate and the study population. This does not need to be a finalized causal question.</p>
        <textarea
          className="objective-input"
          placeholder="Investigate whether short-term sleep disruption is associated with increased next-day alcohol craving among adults participating in an outpatient treatment study."
          value={objective}
          maxLength={600}
          onChange={(e) => setObjective(e.target.value)}
        />
        <div className="objective-footer">
          <span className="char-count">{objective.length} / 600 \u00b7 autosaved</span>
          <button className="btn btn-secondary btn-sm" onClick={() => actions.reviewObjective()} disabled={objective.trim().length === 0}>Review objective</button>
        </div>
        {showFeedback && (
          <div className="feedback-panel">
            <div className="title"><Sparkles size={13} /> AI feedback</div>
            <p>Your objective identifies a population and a general relationship of interest. The timing of sleep and craving will need to be clarified later, in Step 4.</p>
            <div className="feedback-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => applyFeedback()}>Apply suggested wording</button>
              <button className="btn btn-sm" onClick={() => setShowFeedback(false)}>Keep my wording</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowFeedback(false)}>Dismiss</button>
            </div>
          </div>
        )}
        <div className="helper"><Info size={13} style={{ flexShrink: 0, marginTop: 1 }} /> Exposure, outcome, comparator, time window, and estimand will be formally defined in Step 4.</div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><ClipboardList size={16} color="var(--accent)" /> Study dataset(s)</div>
          <span className="badge badge-required">AT LEAST ONE REQUIRED</span>
          <CardInfo text="The raw data files from your study — EMA surveys, wearable exports, clinical records. Upload one file per data source; multiple datasets are linked later by a shared participant ID column." />
        </div>
        <p className="card-desc">The raw data files collected for your study — EMA surveys, wearable sensor exports, smartphone logs, clinical records, or baseline assessments. Upload one file per data source; you can add more later.</p>
        <div className="upload-detail-box">
          <div className="upload-detail-row"><span className="upload-detail-label">Formats accepted</span><span>CSV or Excel (.xlsx, .xls)</span></div>
          <div className="upload-detail-row"><span className="upload-detail-label">Examples</span><span>ema_daily_survey.csv &nbsp;·&nbsp; actigraphy_30day.xlsx &nbsp;·&nbsp; baseline_clinical.xls</span></div>
          <div className="upload-detail-row"><span className="upload-detail-label">Must include</span><span>A participant identifier column (e.g. <code>participant_id</code>), at least one timestamp column, and the variables you plan to treat as exposure or outcome.</span></div>
        </div>
        <div className="helper" style={{ marginTop: 0, marginBottom: 12 }}>
          <ShieldAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          Upload only appropriately authorized and de-identified research data. The system may flag obvious direct identifiers, but it does not certify that a dataset is fully de-identified or compliant with institutional requirements.
        </div>
        <UploadDropzone
          label="Upload CSV or Excel dataset"
          multiple
          accept=".csv,.xlsx,.xls"
          rejectedMessage="Unsupported dataset type. Upload a .csv, .xlsx, or .xls file."
          onFiles={addDatasets}
        />
        {statusMessage(actionStatus.datasetUpload) && (
          <div className={`action-note ${actionNoteClass(actionStatus.datasetUpload)}`}>
            {statusMessage(actionStatus.datasetUpload)}
          </div>
        )}
        {datasets.map((ds) => (
          <DatasetRow
            key={ds.id}
            ds={ds}
            onRemove={() => removeDataset(ds.id)}
            onToggle={() => toggleDataset(ds.id)}
            onPreview={() => showToast(`Dataset preview: ${ds.name} — ${ds.rows.toLocaleString()} rows, ${ds.cols} columns. Expand validation details to review the parsed schema.`)}
            onReplace={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".csv";
              inp.onchange = (e) => replaceDataset(ds.id, e.target.files[0]);
              inp.click();
            }}
          />
        ))}
        {datasets.length === 0 && (
          <div className="helper" style={{ marginTop: 12 }}><Info size={13} /> Try naming a file with "corrupt" in it to preview the blocking-issue state.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><FileText size={16} color="var(--accent)" /> Data dictionary / schema</div>
          <span className="badge badge-required">REQUIRED</span>
          <CardInfo text="A file that defines each variable — name, type, valid range, unit, and collection method. Required so the system can match variables to your causal question and flag measurement gaps." />
        </div>
        <p className="card-desc">A document that describes what every column in your dataset means, so I can interpret variables correctly. Without this I cannot reliably assign variable roles or detect measurement issues.</p>
        <div className="upload-detail-box">
          <div className="upload-detail-row"><span className="upload-detail-label">Formats accepted</span><span>PDF, Word (.docx), plain text</span></div>
          <div className="upload-detail-row upload-detail-row-col">
            <span className="upload-detail-label">For each variable, include</span>
            <ul className="upload-checklist">
              <li><strong>Variable name</strong> — e.g. <code>sleep_quality</code></li>
              <li><strong>Data type</strong> — number, text, date, yes/no</li>
              <li><strong>Possible values or range</strong> — e.g. 1–5, or Yes / No</li>
              <li><strong>An example value</strong> — e.g. 3, "2026-07-09"</li>
              <li><strong>Collection method</strong> — self-reported via EMA, passively sensed via wearable, extracted from phone logs, etc.</li>
              <li><strong>Measurement timing</strong> — when during the day or study the variable was recorded</li>
            </ul>
          </div>
          <div className="upload-detail-row upload-detail-row-col">
            <span className="upload-detail-label">Also include participant demographics</span>
            <span className="upload-detail-sub">Age range, sex / gender distribution, clinical characteristics (e.g. AUD diagnosis, outpatient status), and any other relevant population details.</span>
          </div>
        </div>
        {!dictionary ? (
          <UploadDropzone label="One document describing your dataset variables" accept=".pdf,.docx,.txt" onFiles={addDictionary} />
        ) : (
          <div className="file-row">
            <div className="file-row-main">
              <FileText size={18} className="file-icon" />
              <div className="file-meta">
                <div className="file-name">{dictionary.name}</div>
                <div className="file-sub">{formatBytes(dictionary.size)} \u00b7 {dictionary.described} of {dictionary.total} variables described</div>
              </div>
              <StatusChip status={dictionary.described === dictionary.total ? "ready" : "clarification"} />
              <div className="file-actions">
                <button className="icon-btn" aria-label="Preview data dictionary" title="Preview" onClick={() => showToast("Data-dictionary preview is not available in this proof of concept. Use Replace to review a revised file.")}><Eye size={15} /></button>
                <button
                  className="icon-btn" aria-label="Replace data dictionary" title="Replace"
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = ".pdf,.docx,.txt";
                    inp.onchange = (e) => e.target.files[0] && addDictionary([e.target.files[0]]);
                    inp.click();
                  }}
                ><RefreshCw size={15} /></button>
                <button className="icon-btn icon-btn-danger" aria-label="Remove data dictionary" title="Remove" onClick={() => setDictionary(null)}><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="coverage-bar-track">
              <div className="coverage-bar-fill" style={{ width: `${Math.round((dictionary.described / dictionary.total) * 100)}%` }} />
            </div>
            {dictionary.described < dictionary.total && (
              <div className="validation-panel" style={{ marginTop: 10 }}>
                <div className="validation-row"><span className="validation-label">Needs clarification</span><p>sleep_score is present in the dataset but does not have a unit, valid range, calculation method, or measurement timing.</p></div>
                <div className="validation-row"><span className="blocking-tag nonblocking">Does not block continuation</span></div>
              </div>
            )}
          </div>
        )}
        {statusMessage(actionStatus.dictionaryUpload) && (
          <div className={`action-note ${actionNoteClass(actionStatus.dictionaryUpload)}`}>
            {statusMessage(actionStatus.dictionaryUpload)}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Research protocol / study description</div>
          <span className="badge badge-optional">OPTIONAL</span>
          <CardInfo text="Your study design document — recruitment criteria, measurement schedule, and procedures. Used to detect inconsistencies between what the protocol says and what the data actually contains." />
        </div>
        <p className="card-desc">A document describing how the study was designed and run. I'll use it to understand your recruitment criteria, measurement schedule, and any pre-planned analysis decisions — and to flag inconsistencies with your uploaded data.</p>
        <div className="upload-detail-box">
          <div className="upload-detail-row"><span className="upload-detail-label">Formats accepted</span><span>PDF, Word (.docx), plain text</span></div>
          <div className="upload-detail-row"><span className="upload-detail-label">Useful to include</span><span>Population eligibility criteria, recruitment method, measurement schedule, pre-specified hypotheses.</span></div>
        </div>
        {!protocol ? (
          <UploadDropzone label="Study protocol or description document" compact accept=".pdf,.docx,.txt" onFiles={addProtocol} />
        ) : (
          <div className="file-row">
            <div className="file-row-main">
              <FileText size={18} className="file-icon" />
              <div className="file-meta">
                <div className="file-name">{protocol.name}</div>
                <div className="file-sub">{formatBytes(protocol.size)} \u00b7 population, design, and schedule detected</div>
              </div>
              <StatusChip status="ready" />
              <div className="file-actions">
                <button className="icon-btn icon-btn-danger" aria-label="Remove protocol" title="Remove" onClick={() => setProtocol(null)}><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        )}
        {statusMessage(actionStatus.protocolUpload) && (
          <div className={`action-note ${actionNoteClass(actionStatus.protocolUpload)}`}>
            {statusMessage(actionStatus.protocolUpload)}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Related research papers</div>
          <span className="badge badge-optional">OPTIONAL · MULTIPLE</span>
          <CardInfo text="Published studies relevant to your exposure, outcome, or population. Used as supporting evidence when suggesting variable roles and causal relationships in later steps." />
        </div>
        <p className="card-desc">Published studies, articles, or pre-prints relevant to what you're trying to study. I'll use these as supporting evidence when suggesting patterns, variable roles, and causal relationships. The more relevant papers you provide, the better grounded my suggestions will be.</p>
        <div className="upload-detail-box">
          <div className="upload-detail-row"><span className="upload-detail-label">Formats accepted</span><span>PDF only</span></div>
          <div className="upload-detail-row"><span className="upload-detail-label">Examples</span><span>RCTs, observational studies, systematic reviews, or meta-analyses related to your exposure or outcome of interest.</span></div>
        </div>
        <UploadDropzone
          label="Upload PDF research paper"
          multiple
          compact
          accept=".pdf"
          rejectedMessage="Research papers must be PDF files."
          onFiles={addPapers}
        />
        {statusMessage(actionStatus.paperUpload) && (
          <div className={`action-note ${actionNoteClass(actionStatus.paperUpload)}`}>
            {statusMessage(actionStatus.paperUpload)}
          </div>
        )}
        {papers.map((p) => (
          <div className="paper-row" key={p.id}>
            <FileText size={16} className="file-icon" />
            <div className="paper-meta">
              <div className="paper-title">{p.title}</div>
              <div className="paper-sub">{p.authors} \u00b7 {p.year} \u00b7 empirical study</div>
            </div>
            {p.duplicate && <span className="dup-tag">Possible duplicate</span>}
            <button className="icon-btn icon-btn-danger" aria-label={`Remove ${p.title}`} title="Remove" onClick={() => setPapers((arr) => arr.filter((x) => x.id !== p.id))}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Clinical guidelines / domain guidance</div>
          <span className="badge badge-optional">OPTIONAL · MULTIPLE</span>
          <CardInfo text="Official standards or guidelines (e.g., clinical practice guidelines, measurement standards). Treated as domain knowledge, not empirical evidence — informs how measurement concepts are framed." />
        </div>
        <p className="card-desc">Clinical guidelines, measurement standards, reporting checklists, or domain reference documents relevant to your study. I'll label these as guidance rather than empirical evidence and use them to flag deviations from established practice.</p>
        <div className="upload-detail-box">
          <div className="upload-detail-row"><span className="upload-detail-label">Formats accepted</span><span>PDF, Word (.docx), plain text</span></div>
          <div className="upload-detail-row"><span className="upload-detail-label">Examples</span><span>DSM-5 criteria, STROBE checklist, CONSORT guidelines, WHO measurement standards.</span></div>
        </div>
        <UploadDropzone label="One or more guideline or guidance documents · PDF / DOCX / TXT" multiple compact accept=".pdf,.docx,.txt" onFiles={addGuidelines} />
        {statusMessage(actionStatus.guidelineUpload) && (
          <div className={`action-note ${actionNoteClass(actionStatus.guidelineUpload)}`}>
            {statusMessage(actionStatus.guidelineUpload)}
          </div>
        )}
        {guidelines.map((g) => (
          <div className="guideline-row" key={g.id}>
            <FileText size={16} className="file-icon" />
            <div className="paper-meta">
              <div className="paper-title">{g.name}</div>
              <div className="paper-sub">{formatBytes(g.size)}</div>
            </div>
            <span className="source-tag">{g.sourceType}</span>
            <button className="icon-btn icon-btn-danger" aria-label={`Remove ${g.name}`} title="Remove" onClick={() => setGuidelines((arr) => arr.filter((x) => x.id !== g.id))}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Database size={16} color="var(--accent)" /> Document knowledge base</div>
          <CardInfo text="Uploads are stored first, then ingested into ChromaDB so later RAG searches can retrieve supporting passages. This is evidence retrieval, not causal proof." />
        </div>
        <p className="card-desc">Ingest uploaded PDF, DOCX, and TXT documents into the local ChromaDB knowledge base, then run a quick evidence check.</p>
        <div className="button-row">
          <button className="btn btn-primary" onClick={handleDocumentIngestion} disabled={actionStatus.documentIngestion?.kind === "loading"}>
            <RefreshCw size={14} className={actionStatus.documentIngestion?.kind === "loading" ? "spin" : ""} /> Ingest documents
          </button>
          <button className="btn btn-secondary" onClick={handleDictionaryRagCheck} disabled={actionStatus.ragCheck?.kind === "loading" || actionStatus.documentIngestion?.kind === "loading" || !["completed", "ready"].includes(ingestionInfo?.status)}>
            <Search size={14} /> Check RAG evidence
          </button>
          {ingestedChunks > 0 && <span className="chip chip-success">{ingestedChunks} chunks indexed</span>}
        </div>
        {statusMessage(actionStatus.documentIngestion) && (
          <div className={`action-note ${actionNoteClass(actionStatus.documentIngestion)}`}>
            {statusMessage(actionStatus.documentIngestion)}
          </div>
        )}
        {statusMessage(actionStatus.ragCheck) && (
          <div className={`action-note ${actionNoteClass(actionStatus.ragCheck)}`}>
            {statusMessage(actionStatus.ragCheck)}
          </div>
        )}
        {ragSummary && <div className="summary-callout" style={{ marginTop: 8 }}>{ragSummary}</div>}
        <div className="helper">
          <ShieldAlert size={13} /> This setup stage checks file completeness and study context. It does not perform causal analysis.
        </div>
      </div>
    </>
  );
}

function DataFoundationView({ state, actions }) {
  const { datasets, dictionary } = state;
  const { lockContent, unlockContent, runAssistantAction } = actions || {};
  const selectedDataset = firstRealDataset(datasets);
  const selectedSchema = selectedDataset?.schema;
  const parsedRows = schemaRows(selectedSchema, 40);
  const missingnessRows = topMissingness(selectedSchema, 6);
  const hasRealSchema = Boolean(selectedSchema?.column_names?.length);
  const realIdColumns = selectedSchema?.possible_id_columns || [];
  const realTimestampColumns = selectedSchema?.possible_timestamp_date_columns || [];
  const highMissingRows = missingnessRows.filter((row) => row.pct >= 30);
  const stableStructureRows = hasRealSchema
    ? parsedRows.filter((row) => ["Identifier", "Timestamp", "Baseline"].includes(row.tag)).slice(0, 8)
    : [];
  const repeatedStructureRows = hasRealSchema
    ? parsedRows.filter((row) => !["Identifier", "Baseline"].includes(row.tag)).slice(0, 12)
    : [];

  const parsedOk = datasets.length > 0 && !datasets.some((d) => d.status === "blocking");
  const participantFields = [...new Set(datasets.map((d) => d.participantField).filter(Boolean))];
  const linkingStatus = datasets.length < 2 ? "not_uploaded" : participantFields.length <= 1 ? "verified" : "review";
  const multiTimestamp = datasets.some((d) => d.timestampFields && d.timestampFields.length > 1);
  const timestampStatus = datasets.length === 0 ? "not_uploaded" : multiTimestamp ? "review" : "verified";
  const isComplete = parsedOk && linkingStatus !== "review" && timestampStatus !== "review";

  const hasData = datasets.length > 0;
  const barColor = (pct) => (pct > 20 ? "var(--danger)" : pct > 10 ? "var(--warning)" : "var(--success)");

  return (
    <>
      <div className="ps-header">
        <div className="ps-header-top">
          <h1>Data foundation & understanding</h1>
          <StatusChip status={isComplete ? "complete" : "clarification"} />
        </div>
        <p>Before you explore anything, here's what was found in your data. This page is automated \u2014 it isn't interactive analysis.</p>
        <span className="note"><Info size={12} /> A written summary and any clarifying questions from this check are in the assistant panel, on the right.</span>
        <span className="note"><ShieldAlert size={12} /> Phase 2 explains data structure and quality. It does not assign final causal roles.</span>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Interpret Data Structure")}>
            <Sparkles size={13} /> Interpret Data Structure
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Explain Data Quality Issues")}>
            <AlertTriangle size={13} /> Explain Data Quality Issues
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><Sparkles size={16} color="var(--accent)" /> Data summary</div><CardInfo text="Auto-generated overview of your uploaded dataset — total rows, participant count, date range, and variable count. Populated once at least one file is uploaded." /></div>
        <p className="card-desc">A plain-language read of your data structure, generated from what's been uploaded so far.</p>
        <RegenerateBlock
          variants={buildDataSummaryVariants(datasets, dictionary)}
          renderVariant={(text) => <div className="summary-callout">{text}</div>}
          onLock={(val) => lockContent("dataSummary", val)}
          onUnlock={() => unlockContent("dataSummary")}
        />
        {hasRealSchema && (
          <div className="real-summary-grid">
            <div className="real-summary-card"><span>Rows parsed</span><strong>{selectedSchema.number_of_rows?.toLocaleString()}</strong></div>
            <div className="real-summary-card"><span>Columns parsed</span><strong>{selectedSchema.number_of_columns}</strong></div>
            <div className="real-summary-card"><span>Possible IDs</span><strong>{formatList(realIdColumns)}</strong></div>
            <div className="real-summary-card"><span>Timing fields</span><strong>{formatList(realTimestampColumns)}</strong></div>
            <div className="real-summary-card real-summary-card-wide"><span>High missingness</span><strong>{highMissingRows.length ? highMissingRows.slice(0, 4).map((row) => `${row.name} ${row.pct.toFixed(2)}%`).join(", ") : "None above 30%"}</strong></div>
            <div className="real-summary-card real-summary-card-wide"><span>Phase 2 labels</span><strong>Descriptive structure only; causal roles are assigned later.</strong></div>
          </div>
        )}
        {hasData && (
          <div className="unit-callout" style={{ marginTop: 8 }}>
            <Compass size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
            {hasRealSchema
              ? `Backend schema loaded: ${selectedSchema.number_of_rows?.toLocaleString()} rows, ${selectedSchema.number_of_columns} columns, ${formatList(realIdColumns, "no obvious ID field")}, and ${formatList(realTimestampColumns, "no obvious timing field")}.`
              : "A dataset is listed, but its backend schema is not available yet. Parse the CSV before interpreting its structure."}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><ClipboardList size={16} color="var(--accent)" /> Schema overview</div><CardInfo text="Every variable detected across your uploaded files, its inferred data type, descriptive source, and quality notes. Causal roles are assigned later." /></div>
        <p className="card-desc">
          {selectedSchema
            ? `${selectedDataset.name}: ${selectedSchema.number_of_rows.toLocaleString()} rows and ${selectedSchema.number_of_columns} columns parsed by FastAPI.`
            : "Upload a CSV dataset in Project Setup to populate this with the real backend schema."}
        </p>
        {selectedSchema && (
          <div className="real-summary-grid">
            <div className="real-summary-card"><span>Duplicate rows</span><strong>{selectedSchema.duplicate_row_count ?? "not checked"}</strong></div>
            <div className="real-summary-card"><span>Participant-time duplicates</span><strong>{selectedSchema.duplicate_participant_time_records?.length || 0}</strong></div>
            <div className="real-summary-card"><span>Constant variables</span><strong>{formatList(selectedSchema.constant_or_no_variation_columns || [])}</strong></div>
            <div className="real-summary-card"><span>Timezone</span><strong>{formatList(Object.values(selectedSchema.timezone_by_timestamp_column || {}), "unknown")}</strong></div>
            <div className="real-summary-card real-summary-card-wide"><span>Timestamp ranges</span><strong>{Object.entries(selectedSchema.timestamp_ranges || {}).slice(0, 2).map(([column, range]) => `${column}: ${range.min_timestamp || "?"} to ${range.max_timestamp || "?"}`).join("; ") || "not inferable"}</strong></div>
            <div className="real-summary-card real-summary-card-wide"><span>Impossible value checks</span><strong>{selectedSchema.possible_impossible_numeric_values?.length ? selectedSchema.possible_impossible_numeric_values.map((item) => `${item.column}: ${item.warning}`).join("; ") : "No simple-rule warnings"}</strong></div>
          </div>
        )}
        <table className="mini-table">
          <thead><tr><th>Variable</th><th>Type</th><th>Source</th><th>Descriptive label</th><th>Missing</th></tr></thead>
          <tbody>
            {parsedRows.map((v) => (
              <tr key={v.name}>
                <td className="mono">{v.name}</td>
                <td>{v.type}</td>
                <td>{v.source}</td>
                <td><span className={`chip ${descriptiveTagClass(v.tag)}`}>{v.tag}</span></td>
                <td>{typeof v.missingPct === "number" ? `${v.missingPct.toFixed(2)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><Clock size={16} color="var(--accent)" /> Timestamps & measurement frequency</div><CardInfo text="When each variable was collected and how often — daily, hourly, event-triggered. Critical for checking whether the lag window you choose later can actually be constructed from the data." /></div>
        {hasRealSchema ? (
          <div className="helper"><Info size={13} /> Detected timing fields: {formatList(realTimestampColumns, "none detected")}. Per-variable measurement frequency is not derived by the current backend and must not be inferred from this screen.</div>
        ) : (
          <div className="helper"><Info size={13} /> Upload and parse a CSV before reviewing timing fields. No example measurement schedule is substituted for study data.</div>
        )}
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><div className="card-title">Stable or linking fields</div><CardInfo text="Fields that look like identifiers, timestamps, or baseline descriptors. Phase 2 describes measurement structure only; it does not assign final causal roles." /></div>
          <p className="card-desc">{hasRealSchema ? "Detected from the parsed backend schema." : "Available after a CSV schema is parsed."}</p>
          <ul className="plain-list">
            {stableStructureRows.length ? stableStructureRows.map((v) => <li key={v.name || v}>{v.name || v} {v.tag && <span className="chip chip-muted freq-tag">{v.tag}</span>}</li>) : <li className="helper">No parsed structure is available yet.</li>}
          </ul>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Repeated or measured fields</div><CardInfo text="Fields that appear time-indexed, self-reported, wearable-derived, smartphone-derived, or otherwise measured repeatedly. Causal labels are intentionally deferred to later phases." /></div>
          <p className="card-desc">{hasRealSchema ? "Descriptive labels inferred from column names and backend schema metadata." : "Available after a CSV schema is parsed."}</p>
          <ul className="plain-list">
            {repeatedStructureRows.length ? repeatedStructureRows.map((v) => (
              <li key={v.name}><span className="mono">{v.name}</span> <span className="chip chip-muted freq-tag">{v.tag}</span></li>
            )) : <li className="helper">No parsed repeated-measure fields are available yet.</li>}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Missingness & data quality</div><CardInfo text="Flags variables with high missing rates, implausible values, or inconsistent formatting. High missingness in key variables can threaten feasibility or introduce bias." /></div>
        {hasData ? (
          <>
            {missingnessRows.map((r) => (
              <div className="metric-bar-row" key={r.name}>
                <span className="metric-bar-label mono">{r.name}</span>
                <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.min(r.pct, 100)}%`, background: barColor(r.pct) }} /></div>
                <span className="metric-bar-value">{r.pct.toFixed ? r.pct.toFixed(2) : r.pct}%</span>
              </div>
            ))}
            {missingnessRows[0]?.pct > 15 && (
              <div className="helper" style={{ marginTop: 8 }}>
                <AlertTriangle size={13} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                <span><span className="mono">{missingnessRows[0]?.name}</span> missingness is high enough to flag — review the source data and measurement process before analysis.</span>
              </div>
            )}
            {!missingnessRows.length && <div className="helper"><Info size={13} /> The parsed schema did not return variable-level missingness for display.</div>}
          </>
        ) : (
          <div className="helper"><Info size={13} /> Upload a dataset to compute missingness.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><Link2 size={16} color="var(--accent)" /> Linking keys across datasets</div><CardInfo text="Shows which fields are used to join multiple uploaded files. A shared participant ID column is required to link datasets — mismatches or missing keys are flagged here." /></div>
        <div className="filter-pills">
          <span className={`link-check-row ${linkingStatus === "review" ? "warn" : ""}`}>
            {linkingStatus === "review" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {linkingStatus === "not_uploaded" ? "Upload 2+ datasets to check linking" : linkingStatus === "review" ? "Identifier fields don't match across files" : `${participantFields[0] || "participant_id"} verified across ${datasets.length} file${datasets.length === 1 ? "" : "s"}`}
          </span>
          <span className={`link-check-row ${timestampStatus === "review" ? "warn" : ""}`}>
            {timestampStatus === "review" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {timestampStatus === "not_uploaded" ? "Upload datasets to check timestamps" : timestampStatus === "review" ? "Mixed timestamp formats detected" : "Timestamps UTC-synced"}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Inconsistency detected</div><CardInfo text="A mismatch between the data dictionary and the actual data — for example, a variable declared numeric that contains text values, or a range that's violated in the data." /></div>
        {!dictionary ? (
          <div className="helper"><Info size={13} /> Upload a data dictionary in Project Setup to run this check.</div>
        ) : selectedSchema?.possible_impossible_numeric_values?.length ? (
          <div className="inconsistency-card"><p>{selectedSchema.possible_impossible_numeric_values.map((item) => `${item.column}: ${item.warning}`).join(" ")}</p></div>
        ) : (
          <div className="helper"><Info size={13} /> No dictionary-to-data inconsistency result is available from the current backend. Review units and coding before analysis.</div>
        )}
      </div>
    </>
  );
}

const WINDOW_OPTIONS = ["7 Days", "10 Days", "14 Days", "Full"];
const WINDOW_DAYS = { "7 Days": 7, "10 Days": 10, "14 Days": 14, Full: 21 };
const LAYER_OPTIONS = ["EMA Survey", "Actigraphy", "Passive Sensing", "HRV", "Heart Rate"];

const TEMPORAL_METRIC_OPTIONS = [
  { key: "sleep_quality", label: "Sleep quality", axisLabel: "Sleep quality (1\u20135)" },
  { key: "stress_level", label: "Stress level", axisLabel: "Stress level (0\u2013100)" },
  { key: "phone_screen_time", label: "Screen time", axisLabel: "Screen time (min)" },
];

function buildTimeseries(seed, days, metricKey) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const sleep = 40 + ((seed + i * 13) % 45);
    const stress = 30 + ((seed + i * 9) % 60);
    const screen = 60 + ((seed + i * 17) % 180);
    const alcohol = (seed + i * 7) % 100 > 70 ? 1 : 0;
    const values = { sleep_quality: sleep, stress_level: stress, phone_screen_time: screen };
    out.push({ day: `Day ${i + 1}`, primary: values[metricKey], alcohol_events: alcohol * 60 });
  }
  return out;
}

const DIST_VARIABLE_OPTIONS = [
  { key: "sleep_quality", label: "Sleep quality (1\u20135)", axisLabel: "Sleep quality score", bins: ["1", "2", "3", "4", "5"] },
  { key: "stress_level", label: "Stress level (0\u2013100)", axisLabel: "Stress level (binned)", bins: ["0\u201320", "21\u201340", "41\u201360", "61\u201380", "81\u2013100"] },
  { key: "phone_screen_time", label: "Screen time (min)", axisLabel: "Screen time, minutes (binned)", bins: ["0\u201360", "61\u2013120", "121\u2013180", "181\u2013240", "241+"] },
];

function buildDistribution(seed, variableKey) {
  const opt = DIST_VARIABLE_OPTIONS.find((o) => o.key === variableKey) || DIST_VARIABLE_OPTIONS[0];
  return opt.bins.map((b, i) => ({ bucket: b, count: 5 + ((seed + i * 19 + variableKey.length) % 45) }));
}

const DOMAIN_MAP = [
  { match: /survey|ema/i, label: "EMA survey" },
  { match: /actigra|wearable|accel/i, label: "Actigraphy" },
  { match: /phone|screen|smartphone/i, label: "Smartphone sensing" },
  { match: /clinic|visit/i, label: "Clinical visit" },
  { match: /baseline|demo/i, label: "Baseline" },
];

const CANDIDATE_VARIABLES = [
  { name: "sleep_quality", source: "EMA survey", meaning: "Self-reported sleep quality (1\u20135)", relevance: "high" },
  { name: "stress_level", source: "EMA survey", meaning: "Momentary stress (0\u2013100 VAS)", relevance: "medium" },
  { name: "phone_screen_time", source: "Passive sensing", meaning: "Daily screen time (minutes)", relevance: "medium" },
  { name: "alcohol_use_event", source: "EMA survey", meaning: "Binary alcohol-use report", relevance: "high" },
  { name: "actigraphy_activity", source: "Actigraphy", meaning: "Moderate+ activity (minutes)", relevance: "low" },
];

function RelevanceTag({ level }) {
  const cls = level === "high" ? "chip-success" : level === "medium" ? "chip-warning" : "chip-muted";
  return <span className={`chip ${cls}`}>{level} relevance</span>;
}

function ExploreView({ state, actions, onGoNext }) {
  const { datasets, promotedPatterns, actionStatus, broadExploration, savedExploreViews, studyMode } = state;
  const { promotePattern, saveExploreView, showToast, pushAssistantNote, handleBroadExploration, runAssistantAction } = actions;
  // Turn-based guidance: each flag fires its message exactly once per mount
  const windowGuidanceFired = useRef(false);
  const layerGuidanceFired = useRef(false);
  const [windowDays, setWindowDays] = useState(14);
  const [windowInput, setWindowInput] = useState("14");
  const [layers, setLayers] = useState(() => Object.fromEntries(LAYER_OPTIONS.map((l) => [l, true])));
  const [tempMetric, setTempMetric] = useState("sleep_quality");
  const [distMetric, setDistMetric] = useState("sleep_quality");
  const [coverageMetric, setCoverageMetric] = useState("coverage");
  const [variabilityMetric, setVariabilityMetric] = useState("variability");
  const [distChartType, setDistChartType] = useState("bar");
  const [coverageChartType, setCoverageChartType] = useState("bar");
  const [tempChartType, setTempChartType] = useState("line");
  const [varChartType, setVarChartType] = useState("bar");

  const seed = datasets.length ? seedFromName(datasets[0].name, datasets.length) : 42;
  const series = useMemo(() => buildTimeseries(seed, windowDays, tempMetric), [seed, windowDays, tempMetric]);
  const tempMetricInfo = TEMPORAL_METRIC_OPTIONS.find((m) => m.key === tempMetric);

  const coverage = LAYER_OPTIONS.map((l, i) => {
    const pct = Math.min(97, 55 + ((seed + i * 17) % 40));
    return { layer: l, pct, display: coverageMetric === "coverage" ? pct : 100 - pct };
  });

  const domains = useMemo(() => {
    const found = new Set();
    datasets.forEach((d) => DOMAIN_MAP.forEach((m) => m.match.test(d.name) && found.add(m.label)));
    if (found.size === 0 && datasets.length) found.add("Uncategorized data");
    return [...found];
  }, [datasets]);

  const missingRows = ["P001", "P002", "P003", "P004"].map((p, i) => ({
    participant: p,
    ema: 4 + ((seed + i * 3) % 12),
    actigraphy: 2 + ((seed + i * 5) % 10),
    phone: 5 + ((seed + i * 2) % 20),
    variability: 20 + ((seed + i * 11) % 60),
  }));

  const sleepDistribution = useMemo(() => buildDistribution(seed, distMetric), [seed, distMetric]);
  const distMetricInfo = DIST_VARIABLE_OPTIONS.find((o) => o.key === distMetric);

  // The current backend returns a structural broad-exploration summary, not chart-ready
  // series. Keep prototype visualizations out of the study workflow until matching
  // Python-backed endpoints exist.
  const showPrototypeVisualizations = false;

  return (
    <>
      <div className="ps-header">
        <h1>Broad data exploration</h1>
        <p>Look across the whole dataset before committing to a causal question. Nothing here is a causal claim \u2014 it's a map of what the data can plausibly support.</p>
        <span className="note" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
          <Info size={12} /> Exploratory mode: patterns are observational only. Use "Promote" to carry a pattern into Causal Question and Variables.
        </span>
        <span className="note"><ShieldAlert size={12} /> Exploratory patterns can support hypothesis generation, but they do not establish causality.</span>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Database size={16} color="var(--accent)" /> Backend broad exploration</div>
          <CardInfo text="Runs the FastAPI/Python broad exploration service on the selected uploaded CSV. Results summarize data quality and structure only." />
        </div>
        <p className="card-desc">Run the backend exploration service for rows, columns, missingness, participant structure, temporal fields, broad correlations, and caution text.</p>
        <div className="button-row">
          <button className="btn btn-primary" onClick={handleBroadExploration} disabled={actionStatus.broadExploration?.kind === "loading"}>
            <RefreshCw size={14} className={actionStatus.broadExploration?.kind === "loading" ? "spin" : ""} /> Run broad exploration
          </button>
          <button className="btn btn-secondary" onClick={() => runAssistantAction?.("Interpret Current Exploration")}>
            <Sparkles size={14} /> Interpret Current Exploration
          </button>
          <button className="btn btn-secondary" onClick={() => runAssistantAction?.("Ask AI What to Explore Next")}>
            <Compass size={14} /> Ask AI What to Explore Next
          </button>
          <button className="btn btn-secondary" onClick={() => saveExploreView?.({
            label: `${tempMetricInfo?.label || tempMetric} by ${windowDays} days`,
            settings: { primary_variable: tempMetric, comparison_variable: distMetric, time_range: `${windowDays} days`, chart_type: tempChartType, aggregation_level: "population-level", missing_data_option: "available-case display" },
          })}>
            <Save size={14} /> Save View
          </button>
          <button className="btn btn-secondary" onClick={() => {
            pushAssistantNote(`Compare variables request captured: ${tempMetricInfo?.label || tempMetric} versus ${distMetricInfo?.label || distMetric}. Review correlation and distribution panels; exploratory comparisons do not establish causality.`);
            showToast("Variable comparison noted.");
          }}>
            <Search size={14} /> Compare Variables
          </button>
          {firstRealDataset(datasets) && <span className="chip chip-accent">{realDatasetFilename(firstRealDataset(datasets))}</span>}
        </div>
        {statusMessage(actionStatus.broadExploration) && (
          <div className={`action-note ${actionNoteClass(actionStatus.broadExploration)}`}>
            {statusMessage(actionStatus.broadExploration)}
          </div>
        )}
        {broadExploration && (
          <div className="real-summary-grid">
            <div className="real-summary-card"><span>Rows</span><strong>{broadExploration.number_of_rows?.toLocaleString()}</strong></div>
            <div className="real-summary-card"><span>Columns</span><strong>{broadExploration.number_of_columns}</strong></div>
            <div className="real-summary-card"><span>ID fields</span><strong>{formatList(broadExploration.possible_id_columns)}</strong></div>
            <div className="real-summary-card"><span>Timestamp fields</span><strong>{formatList(broadExploration.possible_timestamp_columns)}</strong></div>
            <div className="real-summary-card real-summary-card-wide">
              <span>High missingness</span>
              <strong>
                {broadExploration.high_missingness_columns?.length
                  ? broadExploration.high_missingness_columns.slice(0, 4).map((item) => `${item.column} ${item.missing_percentage}%`).join(", ")
                  : "None above threshold"}
              </strong>
            </div>
            <div className="real-summary-card real-summary-card-wide">
              <span>Participant summary</span>
              <strong>
                {broadExploration.participant_summary
                  ? `${broadExploration.participant_summary.number_of_unique_participants} participants; avg ${broadExploration.participant_summary.rows_per_participant?.average} rows each`
                  : "No participant ID summary available"}
              </strong>
            </div>
          </div>
        )}
        {studyMode?.study_summary && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head"><div className="card-title">Backend-computed study summary</div><span className="chip chip-accent">Backend-computed</span></div>
            <div className="real-summary-grid">
              <div className="real-summary-card"><span>Exposure</span><strong>{studyMode.study_summary.exposure?.column || "Not yet available"}</strong></div>
              <div className="real-summary-card"><span>Non-missing exposure values</span><strong>{studyMode.study_summary.exposure?.count?.toLocaleString?.() ?? "Not yet available"}</strong></div>
              <div className="real-summary-card"><span>Exposure mean (SD)</span><strong>{studyMode.study_summary.exposure ? `${studyMode.study_summary.exposure.mean?.toFixed?.(3) ?? "Not yet available"} (${studyMode.study_summary.exposure.std?.toFixed?.(3) ?? "Not yet available"})` : "Not yet available"}</strong></div>
              <div className="real-summary-card"><span>Exposure range</span><strong>{studyMode.study_summary.exposure ? `${studyMode.study_summary.exposure.min?.toFixed?.(3) ?? "Not yet available"} to ${studyMode.study_summary.exposure.max?.toFixed?.(3) ?? "Not yet available"}` : "Not yet available"}</strong></div>
            </div>
            <div className="pattern-row"><span>Outcome distribution: <strong>label</strong></span><span>{studyMode.study_summary.outcome_distribution?.map((item) => `${item.value}: ${item.count} (${item.percentage}%)`).join("; ") || "Not yet available"}</span></div>
            <div className="pattern-row"><span>Key-variable missingness</span><span>{studyMode.study_summary.key_missingness?.map((item) => `${item.column}: ${item.missing_percentage}%`).join("; ") || "Not yet available"}</span></div>
            <div className="pattern-row"><span>Candidate-variable summaries</span><span>{studyMode.study_summary.candidate_variables?.map((item) => `${item.column}: ${item.unique_values} observed values`).join("; ") || "Not yet available"}</span></div>
            <div className="helper"><ShieldAlert size={13} /> These are backend-computed descriptive values, not causal estimates or claims.</div>
          </div>
        )}
        {broadExploration?.data_quality_warnings?.length > 0 && (
          <ul className="backend-warning-list">
            {broadExploration.data_quality_warnings.slice(0, 6).map((warning, index) => (
              <li key={`${warning.warning_type}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        )}
        {!broadExploration && (
          <div className="action-note action-note-warning">
            No backend exploration result is loaded yet. Run the Python broad-exploration check; chart-ready visualizations remain unavailable until a matching backend response exists.
          </div>
        )}
        <div className="helper">
          <ShieldAlert size={13} /> Numerical results must come from Python/R computation, not the LLM.
        </div>
        {savedExploreViews?.length > 0 && (
          <div className="action-note">
            <strong>Saved views:</strong> {savedExploreViews.map((view) => view.label).join("; ")}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Additional visual exploration</div></div>
        <p className="card-desc">Chart-ready distributions, temporal series, participant-level missingness, and correlation patterns are not yet returned by the backend.</p>
        <div className="helper"><Info size={13} /> These visual summaries are intentionally unavailable rather than populated with demonstration values. Use the Python-backed broad-exploration summary above, then continue to Phase 4.</div>
      </div>

      {showPrototypeVisualizations && <>
      <div className="card">
        <div className="card-head"><div className="card-title">Filters</div><CardInfo text="Narrow the displayed data by variable domain, participant group, or date window. Use these to focus your exploration on a relevant subset before assigning causal roles." /></div>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <div className="filter-group" style={{ flex: "1 1 260px" }}>
            <span className="filter-label">Time window</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <input
                type="range"
                min={1}
                max={30}
                value={windowDays}
                onChange={(e) => { setWindowDays(Number(e.target.value)); setWindowInput(String(e.target.value)); }}
                onMouseUp={() => {
                  actions.beginStudyAction("button_click", "exploration_window_commit").success();
                  if (!windowGuidanceFired.current) {
                    windowGuidanceFired.current = true;
                    pushAssistantNote("Time window set ✓ — next step: pick which data layers to include using the checkboxes below the filter ↓. Each checkbox controls which data source feeds the pattern charts on this page.");
                  }
                }}
                style={{ flex: 1, accentColor: "var(--accent)" }}
              />
              <input
                type="number"
                min={1}
                max={30}
                value={windowInput}
                onChange={(e) => {
                  setWindowInput(e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1 && n <= 30) setWindowDays(n);
                }}
                style={{ width: 56, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13, textAlign: "center" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>days</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              <span>1 day</span><span>30 days</span>
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Data layers</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
              {LAYER_OPTIONS.map((l) => (
                <label key={l} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={layers[l]}
                    onChange={() => {
                      actions.beginStudyAction("button_click", "exploration_layer_change").success();
                      setLayers((s) => ({ ...s, [l]: !s[l] }));
                      if (!layerGuidanceFired.current) {
                        layerGuidanceFired.current = true;
                        pushAssistantNote("Data layers updated ✓ — the pattern charts above will reflect your selection. Take a look at the trends, then click Continue when you're satisfied with what you're seeing.");
                      }
                    }}
                    style={{ accentColor: "var(--accent)", width: 14, height: 14, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12.5, color: layers[l] ? "var(--navy)" : "var(--text-3)", fontWeight: layers[l] ? 500 : 400 }}>{l}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Available data domains</div><CardInfo text="Variable categories detected across your uploaded datasets — e.g., mood, sleep, activity. Helps you identify candidates for each causal role (exposure, outcome, confounder)." /></div>
        <p className="card-desc">Categories detected across your uploaded datasets.</p>
        <div className="filter-pills">
          {domains.length ? domains.map((d) => <span key={d} className="chip chip-accent">{d}</span>) : <span className="helper">Upload datasets in Project Setup to populate this.</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Variable distributions</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ChartTypeSwitcher value={distChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setDistChartType(value); }} />
            <select className="select-input" value={distMetric} onChange={(e) => { actions.beginStudyAction("button_click", "exploration_metric_change").success(); setDistMetric(e.target.value); }}>
              {DIST_VARIABLE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <CardInfo text="Distribution of selected variables across all responses. Check for outliers, floor/ceiling effects, and skew — these affect which estimators are appropriate and whether the outcome is analyzable as binary." />
        </div>
        <p className="card-desc">Distribution of {distMetricInfo.label.toLowerCase()} across all responses.</p>
        <FlexibleChart
          data={sleepDistribution}
          xKey="bucket"
          series={[{ key: "count", name: "Responses" }]}
          type={distChartType}
          xLabel={distMetricInfo.axisLabel}
          yLabel="Number of responses"
        />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Sensor adherence & coverage</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ChartTypeSwitcher value={coverageChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setCoverageChartType(value); }} />
              <select className="select-input" value={coverageMetric} onChange={(e) => { actions.beginStudyAction("button_click", "exploration_metric_change").success(); setCoverageMetric(e.target.value); }}>
                <option value="coverage">Coverage %</option>
                <option value="missing">Missing %</option>
              </select>
            </div>
            <CardInfo text="Share of expected observations actually captured per data source. Low adherence in a key variable may reduce feasibility or introduce missingness bias if non-collection is systematic." />
          </div>
          <p className="card-desc">Share of expected observations {coverageMetric === "coverage" ? "actually captured" : "missing"}, per data source.</p>
          <FlexibleChart
            data={coverage.filter((c) => layers[c.layer])}
            xKey="layer"
            series={[{ key: "display", name: coverageMetric === "coverage" ? "Coverage %" : "Missing %" }]}
            type={coverageChartType}
            layout={coverageChartType === "bar" ? "vertical" : "horizontal"}
            xLabel={coverageChartType === "bar" ? (coverageMetric === "coverage" ? "Coverage (%)" : "Missing (%)") : "Data source"}
            yLabel={coverageChartType === "bar" ? "Data source" : (coverageMetric === "coverage" ? "Coverage (%)" : "Missing (%)")}
          />

        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Temporal pattern</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ChartTypeSwitcher value={tempChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setTempChartType(value); }} allow={["line", "area", "bar"]} />
              <select className="select-input" value={tempMetric} onChange={(e) => { actions.beginStudyAction("button_click", "exploration_metric_change").success(); setTempMetric(e.target.value); }}>
                {TEMPORAL_METRIC_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            <CardInfo text="A time-series view of variable values over the study period. Shows trends, seasonality, and irregular gaps — all of which can affect temporal ordering assumptions in a lagged causal design." />
          </div>
          <p className="card-desc">{tempMetricInfo.label} against alcohol-use events, last {windowDays} day{windowDays !== 1 ? "s" : ""}.</p>
          <FlexibleChart
            data={series}
            xKey="day"
            series={[
              { key: "primary", name: tempMetricInfo.label, color: "#2F5D8A" },
              { key: "alcohol_events", name: "Alcohol events", color: "#B8382B" },
            ]}
            type={tempChartType}
            xLabel="Study day"
            yLabel={tempMetricInfo.axisLabel}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Missingness by participant</div><CardInfo text="How much data is missing per participant, broken down by data source. Systematic missingness (e.g., only when symptomatic) can bias within-person estimates." /></div>
        <p className="card-desc">Percent of expected observations missing, by source.</p>
        <table className="mini-table">
          <thead><tr><th>Participant</th><th>EMA</th><th>Actigraphy</th><th>Phone</th></tr></thead>
          <tbody>
            {missingRows.map((r) => (
              <tr key={r.participant}>
                <td>{r.participant}</td>
                <td><span className={r.ema > 12 ? "cell-warn" : "cell-ok"}>{r.ema}%</span></td>
                <td><span className={r.actigraphy > 12 ? "cell-warn" : "cell-ok"}>{r.actigraphy}%</span></td>
                <td><span className={r.phone > 18 ? "cell-warn" : "cell-ok"}>{r.phone}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {highMissingParticipant.phone > 18 && (
          <div className="helper" style={{ marginTop: 10 }}>
            <AlertTriangle size={13} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{highMissingParticipant.participant} has elevated missingness in passive sensing ({highMissingParticipant.phone}%) \u2014 worth checking device compliance before this participant anchors any pattern.</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Within-person variability</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ChartTypeSwitcher value={varChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setVarChartType(value); }} />
            <select className="select-input" value={variabilityMetric} onChange={(e) => { actions.beginStudyAction("button_click", "exploration_metric_change").success(); setVariabilityMetric(e.target.value); }}>
              <option value="variability">Variability index</option>
              <option value="phone">Phone missingness %</option>
              <option value="ema">EMA missingness %</option>
            </select>
          </div>
          <CardInfo text="How much each variable fluctuates within a single individual over time. High within-person variability is needed for a within-person causal analysis — low variability means the exposure rarely changes and within-person signal is weak." />
        </div>
        <p className="card-desc">
          {variabilityMetric === "variability" ? "A rough index of how much each participant's daily values swing, relative to their own average." : "Percent of expected observations missing for this source, by participant."}
        </p>
        <FlexibleChart
          data={missingRows}
          xKey="participant"
          series={[{ key: variabilityMetric, name: variabilityMetric === "variability" ? "Variability" : "Missing %" }]}
          type={varChartType}
          xLabel="Participant"
          yLabel={variabilityMetric === "variability" ? "Variability index (0–100)" : "Missing (%)"}
        />
      </div>


      <div className="card">
        <div className="card-head"><div className="card-title">Detected patterns</div><CardInfo text="Automatically identified temporal patterns — lagged correlations, trends, cyclical structure — that are worth investigating as potential causal hypotheses to build your research question around." /></div>
        <p className="card-desc">Broad associations surfaced from the uploaded data. Promoting a pattern carries it forward as a candidate for your causal question.</p>
        {patterns.map((p) => (
          <div className="pattern-row" key={p.id}>
            <span>{p.text} <span className="pattern-stat">{p.stat}</span></span>
            {promotedPatterns.includes(p.id) ? (
              <span className="chip chip-success"><CheckCircle2 size={13} /> Promoted</span>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => { promotePattern(p.id); showToast("Pattern promoted to Causal Question and Variables."); }}>
                <Wand2 size={13} /> Promote
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Potentially useful variables</div><CardInfo text="Variables showing meaningful within-person variation or correlation with likely exposure or outcome candidates, ranked by relevance to your stated research objective." /></div>
        <p className="card-desc">Variables and derived features that look relevant so far. Roles like exposure or confounder are assigned later, in Causal Question and Causal Graph.</p>
        <table className="mini-table">
          <thead><tr><th>Variable</th><th>Source</th><th>Meaning</th><th></th></tr></thead>
          <tbody>
            {CANDIDATE_VARIABLES.map((v) => (
              <tr key={v.name}>
                <td className="mono">{v.name}</td>
                <td>{v.source}</td>
                <td>{v.meaning}</td>
                <td><RelevanceTag level={v.relevance} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      </>}

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Next:</strong> formalize a causal question and provisional variable roles.</p>
        <button className="btn btn-primary" onClick={onGoNext}>Question & variables <ArrowRight size={14} /></button>
      </div>
    </>
  );
}

const ROLE_OPTIONS = ["Exposure", "Outcome", "Confounder", "Mediator", "Proxy", "Unassigned"];
const ROLE_TABLE_VARIABLES = DATA_SCHEMA.filter((v) => v.frequency);

const QUESTION_TEMPLATES = {
  p1: {
    question: "Does poor sleep quality increase the likelihood of alcohol use in the days that follow, among adults in outpatient AUD treatment?",
    population: "Adults 18\u201345 in outpatient AUD treatment",
    exposure: "Sleep quality (EMA, 1\u20135)",
    comparator: "Nights with higher reported sleep quality",
    outcome: "Alcohol-use event in the following 1\u20132 days (binary)",
    timeWindow: "Lag of 1\u20132 days",
    unitOfAnalysis: "Participant-day",
    estimand: "Increase in probability (risk difference)",
  },
  p2: {
    question: "Does higher phone screen time increase same-day alcohol-use likelihood?",
    population: "Adults 18\u201345 in outpatient AUD treatment",
    exposure: "Phone screen time (minutes)",
    comparator: "Days with lower screen time",
    outcome: "Same-day alcohol-use event (binary)",
    timeWindow: "Same day",
    unitOfAnalysis: "Participant-day",
    estimand: "Increase in probability (risk difference)",
  },
  p3: {
    question: "Does elevated within-person stress on weekends increase alcohol use more than similar stress on weekdays?",
    population: "Adults 18\u201345 in outpatient AUD treatment",
    exposure: "Stress level (EMA, 0\u2013100), interacted with weekend",
    comparator: "Weekday stress of similar magnitude",
    outcome: "Alcohol-use event (binary)",
    timeWindow: "Same day",
    unitOfAnalysis: "Participant-day",
    estimand: "Difference in effect size across day type",
  },
};
const PATTERN_TEXT = {
  p1: "Poor sleep quality precedes same-week alcohol-use events at a higher rate than chance.",
  p2: "Self-reported alcohol use is more frequent following high phone screen-time days.",
  p3: "Within-person stress shows more variability on weekend days than weekdays.",
};

const BLANK_QUESTION_FIELDS = { question: "", population: "", exposure: "", comparator: "", outcome: "", timeWindow: "", unitOfAnalysis: "", estimand: "" };

const DERIVED_FEATURE_OPTIONS = [
  { id: "f1", label: "7-day rolling average sleep quality", desc: "Smooths daily noise to capture a short-term sleep trend." },
  { id: "f2", label: "Weekend indicator", desc: "Flags Saturday and Sunday, useful for interaction effects." },
  { id: "f3", label: "Cumulative weekly screen time", desc: "Aggregates passive sensing into a weekly exposure proxy." },
  { id: "f4", label: "Prior-day alcohol use (lag-1)", desc: "Captures autocorrelation in the outcome." },
];

function QuestionView({ state, actions, onGoNext }) {
  const {
    promotedPatterns, variableRoles, selectedQuestionId, questionFields, questionCandidates,
    candidateVariables, derivedFeatureCandidates, phase4Status, derivedFeatures, datasets, lagHours, exposureThreshold,
  } = state;
  const {
    setVariableRole, selectSuggestedQuestion, writeOwnQuestion, updateQuestionField, toggleDerivedFeature, showToast,
    lockContent, unlockContent, handleGenerateQuestionCandidates, handleRecommendCandidateVariables,
    selectGeneratedQuestion, updateQuestionCandidate, confirmCurrentQuestion, phase4Feedback, setPhase4Feedback, applyVariableDecision,
    runAssistantAction,
  } = actions;
  const [showRefine, setShowRefine] = useState(false);
  const baseInfo = useMemo(() => computeFeasibility(datasets, 0, 0), [datasets]);
  const [varStatuses, setVarStatuses] = useState({});
  const [customVars, setCustomVars] = useState([]);
  const [newVarDraft, setNewVarDraft] = useState({ name: "", source: "", values: "", role: "Unassigned" });
  const [addingVar, setAddingVar] = useState(false);
  const questionBuilderRef = useRef(null);
  const hasParsedDataset = Boolean(firstRealDataset(datasets)?.schema);
  const hasQuestionDraft = Boolean(questionFields?.question || questionCandidates.length);
  const schemaRoleRows = useMemo(() => {
    const dataset = firstRealDataset(datasets);
    const schema = dataset?.schema;
    return (schema?.column_names || []).map((name) => ({
      name,
      source: describeColumnSource(name),
      type: schema?.pandas_data_types?.[name] || "Unknown",
      roleGuess: "Unassigned",
    }));
  }, [datasets]);
  const roleTableRows = [...schemaRoleRows, ...customVars];

  function handleContinueToFeasibility() {
    if (!questionFields?.question?.trim()) {
      showToast("Please confirm or use a research question before continuing.");
      return;
    }
    if (!questionFields.exposure?.trim()) {
      showToast("Please select one exposure variable before continuing to Feasibility.");
      return;
    }
    if (!questionFields.outcome?.trim()) {
      showToast("Please select one outcome variable before continuing to Feasibility.");
      return;
    }
    if (!selectedQuestionId && phase4Status?.kind !== "success") {
      showToast("Please confirm or use a research question before continuing.");
      return;
    }
    onGoNext();
  }

  function editGeneratedQuestion(candidate) {
    selectGeneratedQuestion({ ...candidate, status: "user_edited" });
    showToast("Editable question fields are ready below. Review and revise them before confirming.");
    requestAnimationFrame(() => questionBuilderRef.current?.focus());
  }

  function viewCandidateEvidence(candidate) {
    if (!(candidate.supporting_evidence || []).length) {
      showToast("No supporting evidence is attached to this candidate yet. Ingest documents or run RAG evidence check first.");
      return;
    }
    runAssistantAction?.("View Supporting Evidence");
  }

  return (
    <>
      <div className="ps-header">
        <h1>Causal question & provisional variable design</h1>
        <p>Start from a suggested variable role table and a few candidate questions built from what you promoted in Broad Exploration. Nothing here is locked \u2014 tweak any suggestion or write your own from scratch.</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">AI-generated structured Phase 4 outputs</div>
          {phase4Status && (
            <span className={`chip ${phase4Status.kind === "error" ? "chip-danger" : phase4Status.kind === "warning" ? "chip-warning" : phase4Status.kind === "success" ? "chip-success" : "chip-muted"}`}>
              {phase4Status.message}
            </span>
          )}
        </div>
        <p className="card-desc">
          Generate editable draft questions, provisional variables, and derived-feature candidates from the current objective, schema, RAG evidence, and broad exploration context.
        </p>
        <textarea
          className="objective-input"
          style={{ minHeight: 54, marginBottom: 10 }}
          placeholder="Optional feedback for reprocessing: what to preserve, what to change, variables/evidence to exclude, constraints to apply."
          value={phase4Feedback}
          onChange={(e) => setPhase4Feedback(e.target.value)}
        />
        {!hasParsedDataset && (
          <div className="status-box status-error" style={{ marginBottom: 10 }}>
            Upload and parse a dataset before generating candidate questions.
          </div>
        )}
        <div className="button-row">
          <button className="btn btn-primary btn-sm" onClick={() => handleGenerateQuestionCandidates("generate")} disabled={!hasParsedDataset}>
            <Sparkles size={13} /> Generate Question Candidates
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleGenerateQuestionCandidates("alternative")} disabled={!hasParsedDataset}>
            <RefreshCw size={13} /> Generate Alternatives
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              runAssistantAction?.("Reprocess with Feedback");
              handleGenerateQuestionCandidates("feedback");
            }}
            disabled={!hasParsedDataset || !phase4Feedback.trim()}
          >
            <Sparkles size={13} /> Reprocess with Feedback
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleRecommendCandidateVariables} disabled={!hasParsedDataset || !hasQuestionDraft}>
            <Database size={13} /> Recommend Candidate Variables
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleRecommendCandidateVariables} disabled={!hasParsedDataset || !hasQuestionDraft}>
            <Wand2 size={13} /> Recommend Derived Features
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Interpret Variable Recommendations")}>
            <Info size={13} /> Interpret Variable Recommendations
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Validate Provisional Roles")}>
            <ShieldAlert size={13} /> Validate Provisional Roles
          </button>
        </div>
        <div className="helper" style={{ marginTop: 10 }}>
          <AlertTriangle size={13} /> Candidate questions are AI-generated drafts and require user review. Variable roles are provisional until graph validation and user confirmation. This phase does not establish causal validity.
        </div>
      </div>

      {questionCandidates.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Generated candidate questions</div>
            <span className="chip chip-warning">Needs user review</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {questionCandidates.map((q, index) => (
              <div key={q.id || index} className="paper-row" style={{ alignItems: "stretch", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <strong>{q.id || `q${index + 1}`} - {q.status || "AI-generated draft"}</strong>
                  <span className="chip chip-muted">Version {index + 1}</span>
                </div>
                <textarea
                  className="objective-input"
                  style={{ minHeight: 58 }}
                  value={q.question_text || ""}
                  onChange={(e) => {
                    updateQuestionCandidate?.(q.id, { question_text: e.target.value });
                  }}
                  readOnly={false}
                />
                <div className="question-field-grid">
                  {[
                    ["Population", q.population],
                    ["Exposure", q.exposure],
                    ["Comparator", q.comparator],
                    ["Outcome", q.outcome],
                    ["Time window", q.time_window],
                    ["Unit", q.unit_of_analysis],
                    ["Focus", q.within_or_between_person],
                    ["Estimand", q.initial_estimand_direction],
                  ].map(([label, value]) => (
                    <div className="question-field" key={label}>
                      <span className="filter-label">{label}</span>
                      <div className="helper" style={{ margin: 0 }}>{value || "Needs review"}</div>
                    </div>
                  ))}
                </div>
                <div className="helper"><strong>Feasibility:</strong> {q.preliminary_data_feasibility || "Preliminary feasibility needs Phase 5 review."}</div>
                {(q.limitations || []).length > 0 && <div className="helper"><strong>Limitations:</strong> {q.limitations.join(" ")}</div>}
                {(q.supporting_evidence || []).length > 0 ? (
                  <div className="helper"><strong>Evidence:</strong> {(q.supporting_evidence || []).slice(0, 2).map((e) => e.source_filename || e).join("; ")}</div>
                ) : (
                  <div className="helper">No supporting evidence attached to this candidate.</div>
                )}
                <div className="button-row">
                  <button className="btn btn-primary btn-sm" onClick={() => selectGeneratedQuestion(q)}>Select This Question</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => editGeneratedQuestion(q)}>Edit / Use Parts</button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      selectGeneratedQuestion(q);
                      confirmCurrentQuestion(q);
                    }}
                  >
                    Confirm Question
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleGenerateQuestionCandidates("alternative")}>Generate Alternative</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => viewCandidateEvidence(q)}>View Supporting Evidence</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {candidateVariables.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Structured candidate variable recommendations</div>
            <span className="chip chip-warning">Provisional roles</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Measurement</th>
                  <th>Temporal</th>
                  <th>Possible role</th>
                  <th>Rationale</th>
                  <th>Evidence</th>
                  <th>Limitations</th>
                  <th>User decision</th>
                </tr>
              </thead>
              <tbody>
                {candidateVariables.map((v, index) => (
                  <tr key={`${v.variable_name || "variable"}-${index}`}>
                    <td className="mono">{v.variable_name}</td>
                    <td><span className="chip chip-muted">{String(v.candidate_status || "consider").replaceAll("_", " ")}</span></td>
                    <td>{v.data_category}</td>
                    <td>{String(v.measurement_role || "unknown").replaceAll("_", " ")}</td>
                    <td>{String(v.temporal_role || "unknown").replaceAll("_", " ")}</td>
                    <td>{String(v.possible_structural_role || "unknown").replaceAll("_", " ")}</td>
                    <td style={{ minWidth: 190 }}>{v.rationale}</td>
                    <td>{(v.supporting_evidence || []).length ? `${v.supporting_evidence.length} item(s)` : "None attached"}</td>
                    <td>{(v.limitations || []).slice(0, 2).join(" ")}</td>
                    <td>
                      <select className="select-input" value={v.user_decision || "Needs clarification"} onChange={(e) => applyVariableDecision(v.variable_name, e.target.value)}>
                        {["Keep", "Modify", "Exclude", "Mark unavailable", "Needs clarification"].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {derivedFeatureCandidates.length > 0 && (
        <div className="card">
          <div className="card-head"><div className="card-title">AI-derived feature candidates</div><span className="chip chip-muted">Requires backend computation</span></div>
          <div style={{ display: "grid", gap: 10 }}>
            {derivedFeatureCandidates.map((f, index) => (
              <div className="feature-row" key={f.feature_name || index}>
                <div>
                  <div className="feature-label">{f.feature_name}</div>
                  <div className="feature-desc">Sources: {(f.source_variables || []).join(", ") || "Needs review"}</div>
                  <div className="feature-desc">Method: {f.calculation_method || "Not specified"}; aggregation: {f.aggregation_method || "Not specified"}</div>
                  <div className="feature-desc">Window: {f.time_window || "Needs review"}; missing data: {f.missing_data_handling || "Needs review"}</div>
                  <div className="feature-desc">Leakage risk: {f.leakage_risk || "Needs review"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div className="card-title">Provisional variable-role recommendations</div><CardInfo text="AI first-pass role assignments (Exposure, Outcome, Confounder, Mediator, Proxy) based on your documents and data patterns. Review and override — these are starting suggestions, not final decisions." /></div>
        <p className="card-desc">Based on the patterns you promoted. These are starting points, not final — Causal Graph will validate them. Check the box or click <strong>Select</strong> to carry a variable forward; <strong>Discard</strong> removes it from later steps.</p>
        <table className="mini-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Variable</th>
              <th>Source</th>
              <th>Values</th>
              <th>Suggested role</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {roleTableRows.map((v) => {
              const status = varStatuses[v.name] || "selected";
              const discarded = status === "discarded";
              return (
                <tr key={v.name} style={{ opacity: discarded ? 0.4 : 1 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!discarded}
                      onChange={() => { const nextStatus = discarded ? "selected" : "discarded"; setVarStatuses((s) => ({ ...s, [v.name]: nextStatus })); if (nextStatus === "discarded") setVariableRole(v.name, "Unassigned"); showToast(v.name + " " + nextStatus + "."); }}
                      style={{ accentColor: "var(--accent)", width: 14, height: 14, cursor: "pointer" }}
                    />
                  </td>
                  <td className="mono">{v.name}</td>
                  <td>{v.source}</td>
                  <td>{v.type || v.values || "—"}</td>
                  <td>
                    {discarded ? (
                      <span className="chip chip-muted">Discarded</span>
                    ) : (
                      <select className="select-input" value={variableRoles[v.name] || v.roleGuess} onChange={(e) => setVariableRole(v.name, e.target.value)}>
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    {discarded ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { actions.beginStudyAction("variable_selection", "variable_selected", {variable_count:1}).success(); setVarStatuses((s) => ({ ...s, [v.name]: "selected" })); showToast(v.name + " selected for review."); }}
                      >Select</button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontWeight: 500 }}
                        onClick={() => { setVarStatuses((s) => ({ ...s, [v.name]: "discarded" })); setVariableRole(v.name, "Unassigned"); showToast(v.name + " discarded from the provisional role table."); }}
                      >Discard</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {addingVar ? (
              <tr>
                <td>
                  <input type="checkbox" checked disabled style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                </td>
                <td>
                  <input
                    className="select-input"
                    style={{ width: "100%" }}
                    placeholder="variable_name"
                    value={newVarDraft.name}
                    onChange={(e) => setNewVarDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="select-input"
                    style={{ width: "100%" }}
                    placeholder="Source"
                    value={newVarDraft.source}
                    onChange={(e) => setNewVarDraft((d) => ({ ...d, source: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="select-input"
                    style={{ width: "100%" }}
                    placeholder="e.g. 1–5, Yes/No"
                    value={newVarDraft.values}
                    onChange={(e) => setNewVarDraft((d) => ({ ...d, values: e.target.value }))}
                  />
                </td>
                <td>
                  <select
                    className="select-input"
                    value={newVarDraft.role}
                    onChange={(e) => setNewVarDraft((d) => ({ ...d, role: e.target.value }))}
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ display: "flex", gap: 5, paddingTop: 2 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const trimmed = newVarDraft.name.trim();
                      if (!trimmed) return;
                      setCustomVars((cv) => [...cv, { name: trimmed, source: newVarDraft.source, type: newVarDraft.values, roleGuess: newVarDraft.role }]);
                      setVarStatuses((s) => ({ ...s, [trimmed]: "selected" }));
                      setVariableRole(trimmed, newVarDraft.role);
                      setNewVarDraft({ name: "", source: "", values: "", role: "Unassigned" });
                      setAddingVar(false);
                    }}
                  >Add</button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setAddingVar(false); setNewVarDraft({ name: "", source: "", values: "", role: "Unassigned" }); }}
                  >Cancel</button>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6} style={{ paddingTop: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddingVar(true)}>+ Add variable</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Suggested research questions</div><CardInfo text="Ready-to-select question templates derived from detected data patterns and your objective. Clicking one auto-populates the question fields below so you can refine them." /></div>
        <p className="card-desc">Drafted from the patterns you promoted in Broad Exploration.</p>
        {promotedPatterns.length === 0 ? (
          <div className="helper"><Info size={13} /> No patterns promoted yet. Go back to Broad Exploration and promote at least one, or write a question from scratch below.</div>
        ) : (
          promotedPatterns.map((pid) => (
            <SuggestedQuestionCard
              key={pid}
              pid={pid}
              selectedQuestionId={selectedQuestionId}
              selectSuggestedQuestion={selectSuggestedQuestion}
            />
          ))
        )}
        <div className="helper" style={{ marginTop: 10 }}>
          <Info size={13} />
          <span>Prefer to start blank? <button className="btn-ghost btn-sm" style={{ display: "inline", padding: 0, border: "none", color: "var(--accent)", cursor: "pointer" }} onClick={writeOwnQuestion}>Write your own question</button> instead.</span>
        </div>
      </div>

      {questionFields && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Research question builder</div>
            {selectedQuestionId && <span className="badge badge-optional">{selectedQuestionId === "custom" ? "CUSTOM" : "FROM SUGGESTION"}</span>}
          </div>
          <p className="card-desc">Tweak any field below, or rewrite the question outright \u2014 nothing here is final until Causal Graph.</p>
          <textarea
            className="objective-input"
            style={{ minHeight: 64 }}
            ref={questionBuilderRef}
            placeholder="Type your research question in plain language."
            value={questionFields.question}
            onChange={(e) => updateQuestionField("question", e.target.value)}
          />
          <div className="question-field-grid">
            {[
              ["population", "Population"],
              ["exposure", "Exposure"],
              ["comparator", "Comparator"],
              ["outcome", "Outcome"],
              ["timeWindow", "Time window"],
              ["unitOfAnalysis", "Unit of analysis"],
              ["estimand", "Target estimand direction"],
            ].map(([key, label]) => (
              <div className="question-field" key={key}>
                <span className="filter-label">{label}</span>
                <input
                  className="select-input"
                  style={{ width: "100%" }}
                  value={questionFields[key]}
                  onChange={(e) => updateQuestionField(key, e.target.value)}
                  onBlur={() => { if (["exposure", "outcome"].includes(key)) actions.beginStudyAction("variable_selection", "question_variable_reviewed", {role:key}).success(); if ((key === "timeWindow" || key === "estimand") && questionFields[key]) actions.noteQuestionFieldEdit(key); }}
                />
              </div>
            ))}
          </div>
          <div className="objective-footer">
            <span className="char-count">Every field stays editable through Step 5.</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowRefine(true)}>Refine with AI</button>
          </div>
          {showRefine && (
            <div className="feedback-panel">
              <div className="title"><Sparkles size={13} /> AI feedback</div>
              <p>Consider specifying the time window more precisely (24 vs. 48 hours), and confirming whether "alcohol use" means any use or a heavier drinking threshold.</p>
              <div className="feedback-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    updateQuestionField("question", questionFields.question + (questionFields.question.endsWith(".") || !questionFields.question ? "" : ".") + " Time window and drinking threshold will be pinned down precisely.");
                    setShowRefine(false);
                  }}
                >
                  Apply suggestion
                </button>
                <button className="btn btn-sm" onClick={() => setShowRefine(false)}>Keep my wording</button>
              </div>
            </div>
          )}
        </div>
      )}

      {questionFields && (
        <>
          {/* ── Card 1: Population ── */}
          <div className="card insight-card">
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-blue"><ClipboardList size={13} /></div>
              <div>
                <div className="card-title">Definition of the population</div>
                <div className="insight-subtitle">LLM-derived from your research objective and uploaded dataset</div>
              </div>
            </div>
            <div className="insight-value insight-value-blue">{questionFields.population || "—"}</div>
            <RegenerateBlock
              variants={POPULATION_BODY_VARIANTS}
              renderVariant={(paras) => <>{paras.map((p, i) => <p key={i} className="insight-body">{p}</p>)}</>}
              onLock={(val) => lockContent("population", val)}
              onUnlock={() => unlockContent("population")}
            />
            <div className="insight-note"><Info size={11} />Population boundaries determine where your causal estimate applies. A narrower, well-justified population reduces unmeasured confounding risk.</div>
          </div>

          {/* ── Card 2: Exposure / Treatment ── */}
          <div className="card insight-card" style={{ borderLeftColor: "var(--success)" }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-green"><Wand2 size={13} /></div>
              <div>
                <div className="card-title">Exposure or treatment</div>
                <div className="insight-subtitle">The variable whose causal effect on the outcome is being estimated</div>
              </div>
            </div>
            <div className="insight-value insight-value-green">{questionFields.exposure || "—"}</div>
            <RegenerateBlock
              variants={EXPOSURE_BODY_VARIANTS}
              renderVariant={(paras) => <>{paras.map((p, i) => <p key={i} className="insight-body">{p}</p>)}</>}
              onLock={(val) => lockContent("exposure", val)}
              onUnlock={() => unlockContent("exposure")}
            />
            <div className="insight-note"><Info size={11} />If you reverse the exposure direction in Causal Graph (Step 6), return here to update the comparator and estimand to stay consistent.</div>
          </div>

          {/* ── Card 3: Time window ── */}
          <div className="card insight-card" style={{ borderLeftColor: "var(--warning)" }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-orange"><Clock size={13} /></div>
              <div>
                <div className="card-title">Time window</div>
                <div className="insight-subtitle">How long after exposure the outcome is measured — different windows answer different questions</div>
              </div>
            </div>
            <div className="insight-value insight-value-orange">{questionFields.timeWindow || "—"}</div>
            <RegenerateBlock
              variants={TIMEWINDOW_INTRO_VARIANTS}
              renderVariant={(text) => <p className="insight-body">{text}</p>}
              onLock={(val) => lockContent("timeWindow", val)}
              onUnlock={() => unlockContent("timeWindow")}
            />
            <table className="lag-table">
              <thead>
                <tr><th>Lag setting</th><th>Est. sample</th><th>Overlap</th><th>What causal question this answers</th></tr>
              </thead>
              <tbody>
                {[
                  { lag: 0,  label: "0h — same day",    question: "Do poor sleep and drinking co-occur on the same day?" },
                  { lag: 12, label: "12h — half-day",   question: "Does poor sleep predict craving or use by the same evening?" },
                  { lag: 24, label: "24h — next day",   question: "Does poor sleep increase next-day drinking probability?" },
                  { lag: 48, label: "48h — two days",   question: "Is there a 2-day carryover effect from sleep disruption?" },
                  { lag: 72, label: "72h — three days", question: "Does accumulated sleep loss over 3 days affect use?" },
                ].map(({ lag, label, question }) => {
                  const f = computeFeasibility(datasets, lag, exposureThreshold);
                  const isActive = lagHours === lag;
                  return (
                    <tr key={lag} className={isActive ? "row-active" : ""}>
                      <td>{label}{isActive ? " ← current" : ""}</td>
                      <td>~{f.finalSample.toLocaleString()} person-days</td>
                      <td>{f.overlapPct}%</td>
                      <td style={{ color: "var(--text-2)" }}>{question}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="insight-note"><Info size={11} />The highlighted row reflects your current lag slider in Step 5 (Feasibility). Change it there to see how your sample and overlap shift across windows.</div>
          </div>

          {/* ── Card 4: Unit of analysis ── */}
          <div className="card insight-card" style={{ borderLeftColor: "#6B46A8" }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-purple"><Database size={13} /></div>
              <div>
                <div className="card-title">Unit of analysis</div>
                <div className="insight-subtitle">What each row in your final analysis dataset represents</div>
              </div>
            </div>
            <div className="insight-value insight-value-purple">{questionFields.unitOfAnalysis || "—"}</div>
            <RegenerateBlock
              variants={UNIT_BODY_VARIANTS}
              renderVariant={(paras) => <>{paras.map((p, i) => <p key={i} className="insight-body">{p}</p>)}</>}
              onLock={(val) => lockContent("unitOfAnalysis", val)}
              onUnlock={() => unlockContent("unitOfAnalysis")}
            />
            <div className="insight-note"><Info size={11} />Participant-day is the right unit for a within-person causal question. It maximizes temporal resolution and leverages the natural experiment of night-to-night sleep variation.</div>
          </div>

          {/* ── Card 5: Estimand direction ── */}
          <div className="card insight-card" style={{ borderLeftColor: "#1F7A6E" }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-teal"><GitBranch size={13} /></div>
              <div>
                <div className="card-title">Initial target estimand direction</div>
                <div className="insight-subtitle">The precise causal quantity being targeted — provisional, can be updated in Analysis Strategy (Step 7)</div>
              </div>
            </div>
            <div className="insight-value insight-value-teal">{questionFields.estimand || "—"}</div>
            <RegenerateBlock
              variants={ESTIMAND_BODY_VARIANTS}
              renderVariant={(paras) => <>{paras.map((p, i) => <p key={i} className="insight-body">{p}</p>)}</>}
              onLock={(val) => lockContent("estimand", val)}
              onUnlock={() => unlockContent("estimand")}
            />
            <div className="insight-note"><AlertTriangle size={11} />This is provisional. Once you complete the Causal Graph in Step 6, the estimand may need refinement — for example, if you discover a collider on the adjustment path or decide to target a different pathway.</div>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head"><div className="card-title">Derived-feature recommendations</div></div>
        <p className="card-desc">Engineered features to consider alongside your raw variables — lags, rolling windows, aggregates.</p>
        {derivedFeatures.map((f) => (
          <div className="feature-row" key={f.id}>
            <label className="feature-checkbox">
              <input type="checkbox" checked={f.selected} onChange={() => toggleDerivedFeature(f.id)} />
              <div>
                <div className="feature-label">{f.label}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Next:</strong> check whether the data can actually support this question.</p>
        <button className="btn btn-primary" onClick={handleContinueToFeasibility}>Feasibility check <ArrowRight size={14} /></button>
      </div>
    </>
  );
}

const SENSITIVITY_ITEMS = [
  { id: "missingData", label: "Missing data (MCAR vs. MAR)" },
  { id: "positivity", label: "Positivity assumption" },
  { id: "unmeasuredConf", label: "Unmeasured confounding sensitivity" },
  { id: "consistency", label: "Consistency (SUTVA)" },
  { id: "exclusionRestriction", label: "Exclusion restriction (if an IV is used)" },
];

const FEASIBILITY_VARIABLE_BY_PATTERN = { p1: "sleep_quality", p2: "phone_screen_time", p3: "stress_level", custom: "sleep_quality" };

function computeFeasibility(datasets, lagHours, exposureThreshold) {
  const seed = datasets.length ? seedFromName(datasets[0].name, datasets.length) : 42;
  const participants = 60 + (seed % 100);
  const days = 14 + (seed % 20);
  const baseRows = participants * days;
  const retainedFraction = 1 - (lagHours / 72) * 0.35;
  const finalSample = Math.round(baseRows * retainedFraction * (1 - exposureThreshold / 500));
  const overlapPct = Math.round(Math.max(20, 92 - exposureThreshold * 0.4));
  const verdict = finalSample > 2000 && overlapPct > 50 ? "Feasible" : finalSample > 1000 ? "Marginal" : "Not feasible";
  const retainedPct = Math.round(retainedFraction * 100);
  return { baseRows, finalSample, overlapPct, verdict, retainedPct, participants, days };
}

function VerdictBadge({ verdict }) {
  const cls = verdict === "Feasible" ? "chip-success" : verdict === "Marginal" ? "chip-warning" : "chip-danger";
  return <span className={`chip ${cls}`} style={{ fontSize: 13, padding: "6px 14px" }}>{verdict}</span>;
}

function FeasibilityView({ state, actions, onGoNext }) {
  const { datasets, questionFields, selectedQuestionId, variableRoles, lagHours, exposureThreshold, sensitivityChecks, targetedFeasibilityResult, actionStatus } = state;
  const { setLagHours, setExposureThreshold, toggleSensitivity, showToast, handleRunFeasibilityCheck, runAssistantAction, goToPage } = actions;

  const feas = useMemo(() => computeFeasibility(datasets, lagHours, exposureThreshold), [datasets, lagHours, exposureThreshold]);
  const seed = datasets.length ? seedFromName(datasets[0].name, datasets.length) : 42;
  const defaultVarKey = FEASIBILITY_VARIABLE_BY_PATTERN[selectedQuestionId] || "sleep_quality";

  // Variables the user has actively picked for this question (all roles except Unassigned/Proxy).
  const targetedVars = useMemo(() => {
    const picked = ROLE_TABLE_VARIABLES.filter((v) => {
      const r = variableRoles[v.name] || v.roleGuess;
      return r && r !== "Unassigned";
    }).map((v) => v.name);
    // ensure the default is present + available for the distribution helper
    const distKeys = DIST_VARIABLE_OPTIONS.map((o) => o.key);
    const merged = [...new Set([defaultVarKey, ...picked])].filter((k) => distKeys.includes(k));
    return merged.length ? merged : [defaultVarKey];
  }, [variableRoles, defaultVarKey]);

  const [focusVar, setFocusVar] = useState(defaultVarKey);
  useEffect(() => { if (!targetedVars.includes(focusVar)) setFocusVar(targetedVars[0]); }, [targetedVars, focusVar]);

  const [distChartType, setDistChartType] = useState("bar");
  const [tempChartType, setTempChartType] = useState("area");
  const [freqChartType, setFreqChartType] = useState("bar");

  const distInfo = DIST_VARIABLE_OPTIONS.find((o) => o.key === focusVar) || DIST_VARIABLE_OPTIONS[0];
  const distribution = useMemo(() => buildDistribution(seed, focusVar), [seed, focusVar]);

  // Temporal pattern for the focused variable (14-day rolling mean).
  const temporalSeries = useMemo(() => {
    const base = 40 + (seed % 20);
    return Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      value: Math.round(base + Math.sin((i + seed) * 0.6) * 12 + ((seed + i * 7) % 8)),
    }));
  }, [seed, focusVar]);

  // Measurement frequency per targeted variable (obs / participant / week).
  const freqData = useMemo(() => targetedVars.map((v, i) => {
    const meta = ROLE_TABLE_VARIABLES.find((r) => r.name === v);
    const freq = meta?.frequency || "";
    const obs = /event|ema|daily/i.test(freq) ? 14 + ((seed + i) % 8)
              : /hour|minute|sensor/i.test(freq) ? 84 + ((seed + i * 3) % 20)
              : 4 + ((seed + i) % 4);
    return { variable: v, obs };
  }), [targetedVars, seed]);

  // Correlations of focused variable against the other targeted variables.
  const correlationData = useMemo(() => targetedVars
    .filter((v) => v !== focusVar)
    .map((v, i) => ({ variable: v, r: Math.round(((((seed + i * 13 + v.length) % 140) / 100) - 0.7) * 100) / 100 })),
  [targetedVars, focusVar, seed]);

  const exposureMissing = 4 + (seed % 12);
  const outcomeMissing = 3 + (seed % 8);
  const participantCoverage = 60 + (seed % 30);
  const derivedFeatureReady = feas.retainedPct >= 55;

  const focusRole = variableRoles[focusVar] || ROLE_TABLE_VARIABLES.find((v) => v.name === focusVar)?.roleGuess || "Unassigned";
  const backendDataset = firstRealDataset(datasets);
  const resolvedExposure = resolveDatasetColumn(backendDataset, [questionFields?.exposure, ...Object.entries(variableRoles).filter(([, role]) => role === "Exposure").map(([name]) => name), "acc_mean_magnitude", "sleep_quality"]);
  const resolvedOutcome = resolveDatasetColumn(backendDataset, [questionFields?.outcome, ...Object.entries(variableRoles).filter(([, role]) => role === "Outcome").map(([name]) => name), "label", "alcohol_use_event"]);
  const canRunFeasibility = Boolean(questionFields?.question && backendDataset?.savedFilename && resolvedExposure && resolvedOutcome);
  const feasibilityStatus = targetedFeasibilityResult?.status || "not_run";
  const statusClass = feasibilityStatus === "ready"
    ? "chip-success"
    : feasibilityStatus === "marginal"
      ? "chip-warning"
      : feasibilityStatus === "not_run"
        ? "chip-muted"
        : "chip-danger";
  const statusMessageText = {
    ready: "Ready to proceed to graph design.",
    marginal: "This can proceed only if limitations are explicitly accepted.",
    requires_revision: "Please revise the question, exposure, comparator, timing, or variables before graph design.",
    not_feasible: "The current data cannot support this proposed analysis.",
    not_run: "Run Python feasibility checks before proceeding.",
  }[feasibilityStatus] || "Review required before proceeding.";
  const missingRows = targetedFeasibilityResult?.missingness_check?.variables || [];

  function requestFeasibilityCheck() {
    if (!questionFields?.question?.trim()) {
      showToast("Please confirm or use a research question before continuing.");
      return;
    }
    if (!questionFields.exposure?.trim()) {
      showToast("Please select one exposure variable before continuing to Feasibility.");
      return;
    }
    if (!questionFields.outcome?.trim()) {
      showToast("Please select one outcome variable before continuing to Feasibility.");
      return;
    }
    if (!backendDataset?.savedFilename) {
      showToast("Upload and parse a CSV dataset before running feasibility checks.");
      return;
    }
    if (!resolvedExposure || !resolvedOutcome) {
      showToast("Feasibility cannot run yet because selected variables are missing from the parsed dataset.");
      return;
    }
    handleRunFeasibilityCheck();
  }
  const coverage = targetedFeasibilityResult?.coverage_check || {};
  const sampleCheck = targetedFeasibilityResult?.analysis_ready_sample_check || {};
  const exposureCheck = targetedFeasibilityResult?.exposure_check || {};
  const outcomeCheck = targetedFeasibilityResult?.outcome_check || {};
  const overlapCheck = targetedFeasibilityResult?.overlap_positivity_check || {};
  const lagCheck = targetedFeasibilityResult?.lag_feasibility_check || {};

  // Temporal ordering check
  const temporalOrdering = useMemo(() => {
    const exposureVar = questionFields?.exposure || "sleep_quality";
    const outcomeVar = questionFields?.outcome || "alcohol_use_event";
    const total = feas.participants;
    const validCount = Math.min(total, Math.round(total * (0.88 + (seed % 8) * 0.012)));
    const exceptionCount = total - validCount;
    const status = exceptionCount === 0 ? "valid" : exceptionCount <= Math.round(total * 0.15) ? "partial" : "invalid";
    const reasons = ["timestamp / timezone issue", "same-day assessment overlap", "missing timestamp column"];
    const reason = reasons[seed % reasons.length];
    return { exposureVar, outcomeVar, status, validCount, exceptionCount, total, reason };
  }, [feas.participants, seed, questionFields]);

  // Participant-level data availability
  const participantStats = useMemo(() => {
    const minDays = 3 + (seed % 5);
    const maxDays = feas.days;
    const medianDays = Math.round((minDays + maxDays) / 2 + (seed % 3));
    const belowMin = Math.max(0, Math.round(feas.participants * 0.05 + (seed % 4)));
    const withFull = Math.round(feas.participants * (0.55 + (seed % 20) * 0.01));
    return { minDays, medianDays, maxDays, belowMin, withFull, total: feas.participants };
  }, [feas, seed]);

  // Pairwise correlation matrix (all unique pairs of targeted variables)
  const pairwiseCorr = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < targetedVars.length; i++) {
      for (let j = i + 1; j < targetedVars.length; j++) {
        const a = targetedVars[i];
        const b = targetedVars[j];
        const raw = ((seed + i * 13 + j * 7 + a.length * 3 + b.length * 5) % 180) / 100 - 0.9;
        const r = Math.round(raw * 100) / 100;
        pairs.push({ a, b, r });
      }
    }
    return pairs;
  }, [targetedVars, seed]);

  // These cards were previously populated from seeded demonstration values. Keep
  // them unavailable until the backend supplies matching Python-derived outputs.
  const showPrototypeVisualizations = false;

  return (
    <>
      <div className="ps-header">
        <h1>Targeted variable exploration & feasibility check</h1>
        <p>{questionFields?.question ? <>Checking feasibility for: <strong style={{ color: "var(--navy)" }}>{questionFields.question}</strong></> : "No research question selected yet \u2014 go back to Question & Variables."}</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Python targeted feasibility check</div>
          <span className={`chip ${statusClass}`}>{String(feasibilityStatus).replaceAll("_", " ")}</span>
        </div>
        <p className="card-desc">This checks whether the selected question and candidate variables can be implemented with the uploaded dataset. It does not generate a graph, identify an estimand, estimate an effect, or prove causality.</p>
        <div className="question-field-grid">
          <div className="question-field"><span className="filter-label">Dataset</span><div className="helper" style={{ margin: 0 }}>{realDatasetFilename(backendDataset) || "No uploaded dataset selected"}</div></div>
          <div className="question-field"><span className="filter-label">Exposure</span><div className="helper mono" style={{ margin: 0 }}>{resolvedExposure || "Needs dataset-backed exposure"}</div></div>
          <div className="question-field"><span className="filter-label">Comparator</span><div className="helper" style={{ margin: 0 }}>{questionFields?.comparator || `One-unit increase in ${resolvedExposure || "exposure"}`}</div></div>
          <div className="question-field"><span className="filter-label">Outcome</span><div className="helper mono" style={{ margin: 0 }}>{resolvedOutcome || "Needs dataset-backed outcome"}</div></div>
          <div className="question-field"><span className="filter-label">Time window</span><div className="helper" style={{ margin: 0 }}>{questionFields?.timeWindow || `${lagHours}h lag, next observation window`}</div></div>
          <div className="question-field"><span className="filter-label">Selected variables</span><div className="helper" style={{ margin: 0 }}>{targetedVars.join(", ")}</div></div>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={requestFeasibilityCheck} disabled={actionStatus.targetedFeasibility?.kind === "loading"}>
            <RefreshCw size={13} className={actionStatus.targetedFeasibility?.kind === "loading" ? "spin" : ""} /> Run Feasibility Checks
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Interpret Feasibility Results")}>
            <Info size={13} /> Interpret Feasibility Results
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Explain This Warning")}>
            <AlertTriangle size={13} /> Explain This Warning
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction?.("Reprocess with Feedback")}>
            <Sparkles size={13} /> Reprocess with Feedback
          </button>
          <button className="btn btn-secondary btn-sm" onClick={requestFeasibilityCheck} disabled={actionStatus.targetedFeasibility?.kind === "loading"}>
            <RefreshCw size={13} /> Recalculate
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => { showToast("Returning to Phase 4 to revise the question."); goToPage?.("question"); }}>
            Revise Question
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => { showToast("Returning to Phase 4 to revise variables."); goToPage?.("question"); }}>
            Revise Variables
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => { showToast("Returning to Phase 4 to choose an alternative exposure."); goToPage?.("question"); }}>
            Try Alternative Exposure
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={onGoNext}
            disabled={!targetedFeasibilityResult?.safe_to_continue_to_graph}
            title="Enabled only when Python feasibility says the design can continue to graph review."
          >
            Proceed with Limitations
          </button>
        </div>
        {statusMessage(actionStatus.targetedFeasibility) && (
          <div className={`action-note ${actionNoteClass(actionStatus.targetedFeasibility)}`}>
            {statusMessage(actionStatus.targetedFeasibility)}
          </div>
        )}
        {!canRunFeasibility && (
          <div className="status-box status-warning" style={{ marginTop: 10 }}>
            {!questionFields?.question?.trim()
              ? "Please confirm or use a research question before continuing."
              : !questionFields.exposure?.trim()
                ? "Please select one exposure variable before continuing to Feasibility."
                : !questionFields.outcome?.trim()
                  ? "Please select one outcome variable before continuing to Feasibility."
                  : "Feasibility cannot run yet because selected variables are missing from the parsed dataset."}
          </div>
        )}
        <div className={`helper ${feasibilityStatus === "not_feasible" || feasibilityStatus === "requires_revision" ? "" : ""}`} style={{ marginTop: 10 }}>
          <ShieldAlert size={13} /> {statusMessageText}
        </div>
        <div className="helper" style={{ marginTop: 8 }}>
          <Info size={13} /> Python calculated these feasibility diagnostics from the uploaded dataset. These checks do not establish causality. Feasibility only means the proposed analysis may be technically implementable.
        </div>
      </div>

      {targetedFeasibilityResult && (
        <div className="two-col">
          <div className="card">
            <div className="card-head"><div className="card-title">Core variable diagnostics</div><span className="chip chip-muted">Python computed</span></div>
            <table className="mini-table">
              <thead><tr><th>Check</th><th>Variable</th><th>Variation</th><th>Non-missing</th><th>Status</th></tr></thead>
              <tbody>
                <tr>
                  <td>Exposure</td>
                  <td className="mono">{exposureCheck.variable || "Not matched"}</td>
                  <td>{String(Boolean(exposureCheck.has_variation))}</td>
                  <td>{exposureCheck.non_missing_observations ?? "n/a"}</td>
                  <td><span className={`chip ${exposureCheck.status === "ready" ? "chip-success" : "chip-warning"}`}>{exposureCheck.status || "review"}</span></td>
                </tr>
                <tr>
                  <td>Outcome</td>
                  <td className="mono">{outcomeCheck.variable || "Not matched"}</td>
                  <td>{String(Boolean(outcomeCheck.has_variation))}</td>
                  <td>{outcomeCheck.non_missing_observations ?? "n/a"}</td>
                  <td><span className={`chip ${outcomeCheck.status === "ready" ? "chip-success" : "chip-warning"}`}>{outcomeCheck.status || "review"}</span></td>
                </tr>
              </tbody>
            </table>
            <div className="mini-stat-row" style={{ marginTop: 10 }}>
              <div className="mini-stat"><span className="mini-stat-label">Total rows</span><span className="mini-stat-value">{(sampleCheck.total_rows ?? 0).toLocaleString()}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Complete cases</span><span className="mini-stat-value">{(sampleCheck.complete_case_rows_for_exposure_outcome_and_selected ?? sampleCheck.complete_case_rows_for_selected_variables ?? 0).toLocaleString()}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Participants</span><span className="mini-stat-value">{coverage.number_of_participants ?? "n/a"}</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Warnings, blockers, and revisions</div><span className="chip chip-warning">{(targetedFeasibilityResult.warnings || []).length} notes</span></div>
            {(targetedFeasibilityResult.blocking_issues || []).length > 0 && (
              <div className="helper" style={{ background: "var(--danger-soft)", borderColor: "#FBBFBB", marginBottom: 8 }}>
                <XCircle size={13} style={{ color: "var(--danger)" }} /> Blocking issues: {targetedFeasibilityResult.blocking_issues.map((item) => item.message).join(" ")}
              </div>
            )}
            <ul className="tight-list">
              {(targetedFeasibilityResult.warnings || []).slice(0, 6).map((warning, index) => (
                <li key={`${warning.warning_type || "warning"}-${index}`}>{warning.message}</li>
              ))}
            </ul>
            <div className="helper" style={{ marginTop: 8 }}><strong>Recommended revisions:</strong> {(targetedFeasibilityResult.recommended_revisions || []).join(" ")}</div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Missingness summary</div></div>
            <table className="mini-table">
              <thead><tr><th>Variable</th><th>Missing %</th><th>Status</th></tr></thead>
              <tbody>
                {missingRows.slice(0, 8).map((row) => (
                  <tr key={row.variable}>
                    <td className="mono">{row.variable}</td>
                    <td>{row.missing_percentage ?? "n/a"}%</td>
                    <td><span className={`chip ${row.severity === "high" ? "chip-warning" : "chip-success"}`}>{row.severity === "high" ? "High missingness" : "OK"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Timing, overlap, and derived features</div></div>
            <div className="lag-reality-box">
              <div className="lag-reality-row"><span className="lag-reality-label">Lag feasibility</span><span>{lagCheck.status || "review"}; timestamp exists: {String(Boolean(lagCheck.timestamp_column_exists))}; participant ID exists: {String(Boolean(lagCheck.participant_id_exists))}</span></div>
              <div className="lag-reality-row"><span className="lag-reality-label">Overlap / positivity</span><span>{overlapCheck.status || "review required"}</span></div>
              <div className="lag-reality-row"><span className="lag-reality-label">High correlations</span><span>{targetedFeasibilityResult.correlation_redundancy_check?.high_correlations?.length || 0} pair(s) flagged</span></div>
              <div className="lag-reality-row"><span className="lag-reality-label">Derived features</span><span>Lagged exposure possible: {String(Boolean(targetedFeasibilityResult.derived_feature_check?.lagged_exposure_possible))}; rolling features possible: {String(Boolean(targetedFeasibilityResult.derived_feature_check?.rolling_or_cumulative_features_possible))}</span></div>
            </div>
            <div className="helper" style={{ marginTop: 10 }}>
              <Info size={13} /> {targetedFeasibilityResult.python_calculation_note}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div className="card-title">Additional feasibility visualizations</div></div>
        <p className="card-desc">Distribution, temporal, frequency, correlation, and analysis-ready sample visualizations require matched Python outputs that the current backend does not provide.</p>
        <div className="helper"><Info size={13} /> These prototype cards are intentionally unavailable rather than populated with demonstration values. Use the Python targeted-feasibility results above for the current decision.</div>
      </div>

      {showPrototypeVisualizations && <>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Which variable do you want to inspect?</div>
          <span className="chip chip-muted">{targetedVars.length} targeted</span>
        </div>
        <p className="card-desc">Pick one of the variables you assigned a role to on the previous step. All charts below refocus on it.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {targetedVars.map((v) => (
            <button
              key={v}
              onClick={() => setFocusVar(v)}
              className={`chip ${focusVar === v ? "chip-success" : "chip-muted"}`}
              style={{ cursor: "pointer", border: focusVar === v ? "1px solid var(--success)" : "1px solid transparent" }}
            >
              {v} <span style={{ opacity: 0.7, marginLeft: 4 }}>({variableRoles[v] || ROLE_TABLE_VARIABLES.find((r) => r.name === v)?.roleGuess || "Unassigned"})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Feasibility controls</div><Sparkles size={13} color="var(--accent)" /></div>
        <p className="card-desc">Adjust these to see how your analysis-ready sample and overlap change in real time. AI will re-score below.</p>
        <div className="slider-row">
          <span className="filter-label">Lag between exposure and outcome: {lagHours}h</span>
          <input type="range" min={0} max={72} step={6} value={lagHours} onChange={(e) => setLagHours(Number(e.target.value))} onMouseUp={() => actions.noteFeasibilityChange()} onTouchEnd={() => actions.noteFeasibilityChange()} onKeyUp={() => actions.noteFeasibilityChange()} />
        </div>
        <div className="slider-row">
          <span className="filter-label">Minimum required exposure variation: {exposureThreshold}%</span>
          <input type="range" min={0} max={100} step={5} value={exposureThreshold} onChange={(e) => setExposureThreshold(Number(e.target.value))} onMouseUp={() => actions.noteFeasibilityChange()} onTouchEnd={() => actions.noteFeasibilityChange()} onKeyUp={() => actions.noteFeasibilityChange()} />
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Distribution — {focusVar}</div>
            <ChartTypeSwitcher value={distChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setDistChartType(value); }} />
          </div>
          <p className="card-desc">{distInfo.label} · role: <strong>{focusRole}</strong>. Try switching chart types.</p>
          <FlexibleChart
            data={distribution}
            xKey="bucket"
            series={[{ key: "count", name: "Count", color: "#2F5D8A" }]}
            type={distChartType}
            height={160}
            xLabel={distInfo.axisLabel}
            yLabel="Count"
          />
          <div className="unit-callout" style={{ marginTop: 8 }}>
            AI note: distribution looks {distribution.some((d) => d.count < 8) ? "uneven — some bins are thin, which can hurt overlap." : "reasonably balanced across bins."}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Temporal pattern — {focusVar}</div>
            <ChartTypeSwitcher value={tempChartType} onChange={value => { actions.beginStudyAction("button_click", "exploration_chart_change").success(); setTempChartType(value); }} allow={["line", "area", "bar"]} />
          </div>
          <p className="card-desc">14-day trajectory (mean per day). Use this to sanity-check timestamps and drift.</p>
          <FlexibleChart
            data={temporalSeries}
            xKey="day"
            series={[{ key: "value", name: focusVar, color: "#3E8E7E" }]}
            type={tempChartType}
            height={160}
            xLabel="Day"
            yLabel="Mean"
          />
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><div className="card-title">Missingness & coverage</div></div>
          <p className="card-desc">For the exposure and outcome in your selected question.</p>
          <div className="metric-bar-row">
            <span className="metric-bar-label">Exposure missing</span>
            <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${exposureMissing}%`, background: exposureMissing > 15 ? "var(--warning)" : "var(--success)" }} /></div>
            <span className="metric-bar-value">{exposureMissing}%</span>
          </div>
          <div className="metric-bar-row">
            <span className="metric-bar-label">Outcome missing</span>
            <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${outcomeMissing}%`, background: outcomeMissing > 15 ? "var(--warning)" : "var(--success)" }} /></div>
            <span className="metric-bar-value">{outcomeMissing}%</span>
          </div>
          <div className="metric-bar-row">
            <span className="metric-bar-label">Participants w/ data</span>
            <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${participantCoverage}%`, background: participantCoverage > 70 ? "var(--success)" : "var(--warning)" }} /></div>
            <span className="metric-bar-value">{participantCoverage}%</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Measurement frequency</div>
            <ChartTypeSwitcher value={freqChartType} onChange={setFreqChartType} allow={["bar", "pie"]} />
            <CardInfo text="Observations per participant per week for each targeted variable. Guides whether your chosen lag window is achievable — a 24h lag requires at least daily measurement for both exposure and outcome." />
          </div>
          <p className="card-desc">Observations per participant per week, across all targeted variables.</p>
          <FlexibleChart
            data={freqData}
            xKey="variable"
            series={[{ key: "obs", name: "obs / participant / week", color: "#C4933F" }]}
            type={freqChartType}
            height={160}
            layout={freqChartType === "bar" ? "vertical" : "horizontal"}
            xLabel={freqChartType === "bar" ? "Observations / participant / week" : "Variable"}
            yLabel={freqChartType === "bar" ? "Variable" : "Observations / participant / week"}
          />

        </div>
      </div>

      {/* ── Temporal Ordering compact card ── */}
      <div className={`card tempo-card${temporalOrdering.status === "partial" ? "-partial" : temporalOrdering.status === "invalid" ? "-invalid" : ""}`}
           style={{ borderLeft: `4px solid ${temporalOrdering.status === "valid" ? "var(--success)" : temporalOrdering.status === "partial" ? "var(--warning)" : "var(--danger)"}` }}>
        <div className="card-head">
          <div className="card-title">Temporal ordering</div>
          <span className={`chip ${temporalOrdering.status === "valid" ? "chip-success" : temporalOrdering.status === "partial" ? "chip-warning" : "chip-danger"}`}>
            {temporalOrdering.status === "valid" ? "✓ Valid" : temporalOrdering.status === "partial" ? "⚠ Partially valid" : "✕ Invalid"}
          </span>
          <CardInfo text="Checks whether the exposure is consistently measured before the outcome within each lag window. If exposure sometimes follows outcome for some participants, the causal direction assumption is violated for those rows." />
        </div>
        <p className="card-desc" style={{ margin: 0 }}>
          <span className="mono">{temporalOrdering.exposureVar}</span> (measured overnight) precedes <span className="mono">{temporalOrdering.outcomeVar}</span> (measured the next evening) for <strong>{temporalOrdering.validCount} of {temporalOrdering.total} participants</strong>.
        </p>
        {temporalOrdering.status !== "valid" && (
          <div className="helper" style={{ marginTop: 8 }}>
            <AlertTriangle size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />
            {temporalOrdering.exceptionCount} participant{temporalOrdering.exceptionCount > 1 ? "s" : ""} — {temporalOrdering.reason}. Safe to continue if this is below 15% of your sample; otherwise investigate those records in the dataset.
          </div>
        )}
      </div>

      {/* ── Lag Construction Reality Check ── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Lag construction — reality check</div>
          <span className={`chip ${feas.retainedPct >= 70 ? "chip-success" : feas.retainedPct >= 50 ? "chip-warning" : "chip-danger"}`}>
            {feas.retainedPct}% of days retained
          </span>
          <CardInfo text="Breaks down what the chosen lag means operationally: which participant-days are dropped, what percentage is retained, and whether the lag is plausible given your data's measurement frequency and missingness." />
        </div>
        <p className="card-desc">Whether a valid exposure → outcome pair can actually be built at the chosen lag of <strong>{lagHours}h</strong>, given your data's measurement frequency and missingness.</p>
        <div className="lag-reality-box">
          <div className="lag-reality-row">
            <span className="lag-reality-label">What this lag means</span>
            <span>Each participant-day's <span className="mono">{temporalOrdering.exposureVar}</span> must be recorded at least {lagHours}h before the <span className="mono">{temporalOrdering.outcomeVar}</span> record. Days where the gap between consecutive observations exceeds {lagHours + 12}h are excluded.</span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">What gets dropped</span>
            <span>{100 - feas.retainedPct}% of participant-days are lost at this lag — typically due to missed EMA check-ins, sensor dropouts, or participants skipping a day. That leaves <strong>{feas.finalSample.toLocaleString()} usable rows</strong> from a base of {feas.baseRows.toLocaleString()}.</span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">Reality check</span>
            <span className={feas.retainedPct >= 65 ? "" : "text-warn"}>
              {feas.retainedPct >= 65
                ? `✓ Retention of ${feas.retainedPct}% is acceptable. The ${lagHours}h lag is constructible for the majority of your sample.`
                : `⚠ Retention drops to ${feas.retainedPct}% at ${lagHours}h. A lag of 12–24h typically retains 75%+ of participant-days in EMA studies. Consider shortening the lag unless the longer window is theoretically necessary.`}
            </span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">Overlap (positivity)</span>
            <span>
              <span className={feas.overlapPct > 50 ? "cell-ok" : "cell-warn"}>
                {feas.overlapPct > 50 ? "✓" : "⚠"} {feas.overlapPct}% of participant-days have both exposed and unexposed neighbors across covariate strata — positivity {feas.overlapPct > 50 ? "appears satisfied" : "may be violated at the margins"}.
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Participant-level data availability ── */}
      <div className="card">
        <div className="card-head"><div className="card-title">Participant-level data availability</div><CardInfo text="Min, median, and max observation-days per participant. Within-person estimators need enough repeated measurements per person — too few days limits the within-person signal that causal estimation relies on." /></div>
        <p className="card-desc">How many observation-days each participant contributed. Within-person estimators need enough repeated measurements per individual to separate within-person signal from between-person differences.</p>
        <div className="mini-stat-row" style={{ marginBottom: 12 }}>
          <div className="mini-stat"><span className="mini-stat-label">Min days observed</span><span className="mini-stat-value">{participantStats.minDays}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Median days observed</span><span className="mini-stat-value">{participantStats.medianDays}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Max days observed</span><span className="mini-stat-value">{participantStats.maxDays}</span></div>
        </div>
        <div className="metric-bar-row">
          <span className="metric-bar-label">Below 7-day minimum</span>
          <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.round(participantStats.belowMin / participantStats.total * 100)}%`, background: participantStats.belowMin > 5 ? "var(--warning)" : "var(--success)" }} /></div>
          <span className="metric-bar-value">{participantStats.belowMin} / {participantStats.total}</span>
        </div>
        <div className="metric-bar-row">
          <span className="metric-bar-label">With ≥ 10 days</span>
          <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.round(participantStats.withFull / participantStats.total * 100)}%`, background: "var(--success)" }} /></div>
          <span className="metric-bar-value">{participantStats.withFull} / {participantStats.total}</span>
        </div>
        {participantStats.belowMin > 0 && (
          <div className="helper" style={{ marginTop: 8 }}>
            <Info size={12} style={{ flexShrink: 0 }} />
            {participantStats.belowMin} participant{participantStats.belowMin > 1 ? "s have" : " has"} fewer than 7 days of data — too few for reliable within-person estimation. Consider excluding them from the primary analysis and including them in a sensitivity analysis.
          </div>
        )}
      </div>

      {/* ── Correlation & Redundancy — pairwise matrix ── */}
      <div className="card">
        <div className="card-head"><div className="card-title">Correlation & redundancy</div><CardInfo text="Pairwise Pearson r between all targeted variables. Pairs with |r| > 0.8 are near-redundant — including both in the same adjustment model risks multicollinearity and inflated standard errors." /></div>
        <p className="card-desc">Pairwise Pearson r between all targeted variables. Pairs with |r| &gt; 0.8 are likely redundant — including both in the same model risks multicollinearity and inflated standard errors.</p>
        {pairwiseCorr.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Assign roles to at least two variables to see pairwise correlations.</div>
        ) : (
          <table className="mini-table corr-table" style={{ marginTop: 4 }}>
            <thead>
              <tr><th>Variable A</th><th>Variable B</th><th style={{ width: 60 }}>r</th><th>Interpretation</th></tr>
            </thead>
            <tbody>
              {pairwiseCorr.map((c) => {
                const abs = Math.abs(c.r);
                const label = abs > 0.8 ? "Likely redundant" : abs > 0.5 ? "Moderate" : abs > 0.2 ? "Weak" : "Near independent";
                const cls = abs > 0.8 ? "chip-danger" : abs > 0.5 ? "chip-warning" : "chip-success";
                return (
                  <tr key={`${c.a}-${c.b}`}>
                    <td className="mono">{c.a}</td>
                    <td className="mono">{c.b}</td>
                    <td style={{ fontWeight: 700, color: abs > 0.8 ? "var(--danger)" : abs > 0.5 ? "var(--warning)" : "var(--success)" }}>{c.r.toFixed(2)}</td>
                    <td><span className={`chip ${cls}`} style={{ fontSize: 10 }}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pairwiseCorr.some((c) => Math.abs(c.r) > 0.8) && (
          <div className="helper" style={{ marginTop: 10, background: "var(--danger-soft)", borderColor: "#FBBFBB" }}>
            <AlertTriangle size={12} style={{ color: "var(--danger)", flexShrink: 0 }} />
            One or more pairs exceed r = 0.8. Consider using the lower-missingness variable, treating the other as a proxy, or removing it from the adjustment set before proceeding to Causal Graph.
          </div>
        )}
      </div>

      {/* ── Derived-feature feasibility ── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Derived-feature feasibility</div>
          <span className={`chip ${derivedFeatureReady ? "chip-success" : "chip-warning"}`}>{derivedFeatureReady ? "Constructible" : "At risk"}</span>
          <CardInfo text="Checks whether the engineered features implied by your question — lagged exposure, 7-day rolling mean, night-to-night delta — can actually be constructed from your data at the current lag setting." />
        </div>
        <p className="card-desc">Whether the engineered features implied by your question — lagged exposures, rolling means, night-to-night delta scores — can actually be built from your data at the current lag.</p>
        <div className="lag-reality-box">
          <div className="lag-reality-row">
            <span className="lag-reality-label">Lagged exposure ({lagHours}h)</span>
            <span className={feas.retainedPct >= 55 ? "cell-ok" : "cell-warn"}>
              {feas.retainedPct >= 55 ? `✓ ${feas.retainedPct}% of days survive this lag — sufficient rows to construct the lagged variable.` : `⚠ Only ${feas.retainedPct}% of days survive. Lagged exposure will be sparse; consider a shorter lag.`}
            </span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">7-day rolling mean</span>
            <span className={participantStats.medianDays >= 7 ? "cell-ok" : "cell-warn"}>
              {participantStats.medianDays >= 7 ? `✓ Median ${participantStats.medianDays} days observed — rolling window is achievable for most participants.` : `⚠ Median ${participantStats.medianDays} days — the rolling window may not fill for many participants.`}
            </span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">Night-to-night delta</span>
            <span className="cell-ok">✓ Consecutive EMA entries detected in dataset — delta scores can be computed.</span>
          </div>
        </div>
        {!derivedFeatureReady && (
          <div className="helper" style={{ marginTop: 8 }}>
            <Info size={12} style={{ flexShrink: 0 }} />
            Reduce the lag below 30h to recover enough rows for reliable derived-feature construction.
          </div>
        )}
      </div>

      {/* ── Analysis-ready sample size & person-time ── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Analysis-ready sample size & person-time</div>
          <VerdictBadge verdict={feas.verdict} />
          <CardInfo text="Participant-days retained after applying lag and missingness filters. Shows total person-time, covariate budget (events-per-variable rule), and the feasibility verdict for the current lag and threshold settings." />
        </div>
        <div className="mini-stat-row" style={{ marginBottom: 12 }}>
          <div className="mini-stat"><span className="mini-stat-label">Base participant-days</span><span className="mini-stat-value">{feas.baseRows.toLocaleString()}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">After lag filter</span><span className="mini-stat-value">{feas.finalSample.toLocaleString()}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Overlap (positivity)</span><span className="mini-stat-value">{feas.overlapPct}%</span></div>
        </div>
        <div className="lag-reality-box">
          <div className="lag-reality-row">
            <span className="lag-reality-label">Person-time</span>
            <span>~{Math.round(feas.finalSample / Math.max(1, feas.participants))} observation-days per participant on average, across {feas.participants} participants.</span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">Covariate budget</span>
            <span>For a binary outcome with a mixed-effects logistic model, allow ~10 events per covariate. With ~{Math.round(feas.finalSample * 0.3)} estimated outcome events, you can include up to <strong>~{Math.round(feas.finalSample * 0.3 / 10)} covariates</strong> in the adjustment set without overfitting.</span>
          </div>
          <div className="lag-reality-row">
            <span className="lag-reality-label">Verdict reasoning</span>
            <span className={feas.verdict === "Not feasible" ? "text-warn" : ""}>
              {feas.verdict === "Feasible" && "✓ Sample size and overlap both meet the minimum thresholds. You can proceed to the Causal Graph."}
              {feas.verdict === "Marginal" && "⚠ Sample or overlap is below the comfortable threshold. Analysis is possible but powered conservatively — consider pre-registering this as a limitation."}
              {feas.verdict === "Not feasible" && "✕ At these settings, the analysis-ready sample is too small. Reduce the lag or lower the required exposure variation above to recover rows."}
            </span>
          </div>
        </div>
      </div>

      {/* ── Clarity & validity of variable definitions ── */}
      <div className="card">
        <div className="card-head"><div className="card-title">Clarity & validity of variable definitions</div><CardInfo text="Flags ambiguous variable definitions — unclear units, undocumented scoring direction, undefined binary thresholds — that could affect effect-direction interpretation or make results non-reproducible." /></div>
        <p className="card-desc">Issues detected in your data dictionary or dataset that may affect how variables are interpreted in the analysis model. Ambiguous definitions can reverse effect direction or make results non-reproducible.</p>
        <table className="mini-table" style={{ marginTop: 4 }}>
          <thead><tr><th>Variable</th><th>Issue</th><th>Severity</th><th>Action needed</th></tr></thead>
          <tbody>
            <tr>
              <td className="mono">phone_screen_time</td>
              <td style={{ fontSize: 11 }}>Unit ambiguous — minutes vs. hours unclear</td>
              <td><span className="chip chip-warning" style={{ fontSize: 10 }}>Clarify</span></td>
              <td style={{ fontSize: 11 }}>Fix in Data Foundation before using as covariate</td>
            </tr>
            <tr>
              <td className="mono">sleep_quality</td>
              <td style={{ fontSize: 11 }}>Scoring direction not stated — higher = better or worse?</td>
              <td><span className="chip chip-warning" style={{ fontSize: 10 }}>Clarify</span></td>
              <td style={{ fontSize: 11 }}>Confirm in data dictionary — affects effect-direction interpretation</td>
            </tr>
            <tr>
              <td className="mono">alcohol_use_event</td>
              <td style={{ fontSize: 11 }}>Binary threshold undocumented — any use vs. &gt;2 drinks?</td>
              <td><span className="chip chip-warning" style={{ fontSize: 10 }}>Clarify</span></td>
              <td style={{ fontSize: 11 }}>Define cut-off in data dictionary for reproducibility</td>
            </tr>
          </tbody>
        </table>
        <div className="helper" style={{ marginTop: 10 }}>
          <Info size={12} style={{ flexShrink: 0 }} />
          These issues do not block analysis, but resolving them before finalizing the analysis plan prevents results from being misinterpreted or challenged during review.
        </div>
      </div>

      </>}

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Next:</strong> build the causal graph only after Python feasibility limitations are reviewed.</p>
        <div className="button-row">
          {(feasibilityStatus === "requires_revision" || feasibilityStatus === "not_feasible") && (
            <button className="btn btn-secondary" onClick={() => actions.showToast("Use Phase 4 in the left navigation to revise the question, exposure, comparator, timing, or variables.")}>
              Revise Phase 4 inputs
            </button>
          )}
          {feasibilityStatus === "marginal" && targetedFeasibilityResult?.safe_to_continue_to_graph && (
            <button className="btn btn-secondary" onClick={() => { showToast("Limitations accepted for this design draft. Keep them in the final report."); onGoNext(); }}>
              Proceed with limitations <ArrowRight size={14} />
            </button>
          )}
          <button className="btn btn-primary" disabled={!targetedFeasibilityResult?.safe_to_continue_to_graph} onClick={() => {
            if (!targetedFeasibilityResult?.safe_to_continue_to_graph) {
              showToast("Run and pass the Python feasibility check before continuing to Causal Graph.");
              return;
            }
            onGoNext();
          }}>Causal graph <ArrowRight size={14} /></button>
        </div>
      </div>
    </>
  );
}


const ROLE_NODE_COLOR = { Exposure: "#2F5D8A", Outcome: "#0F9F6E", Confounder: "#A6650E", Mediator: "#6B4A9E", "Collider Candidate": "#D97706", Proxy: "#8A93A3", Unassigned: "#8A93A3" };
const ROLE_EXPLANATION = {
  Exposure: "This is your hypothesized cause \u2014 the variable you believe influences the outcome.",
  Outcome: "This is what you're trying to explain or predict.",
  Confounder: "Affects both exposure and outcome. It typically must be adjusted for to avoid a biased estimate.",
  Mediator: "Lies on the causal path between exposure and outcome. Adjusting for it can remove part of the true effect.",
  Proxy: "An imperfect stand-in for the concept you actually care about \u2014 worth flagging as measurement uncertainty.",
  Unassigned: "No role assigned yet. Give it one so it can be reasoned about downstream.",
};

const GRAPH_TYPE_OPTIONS = [
  { key: "DAG", label: "DAG", desc: "Directed Acyclic Graph — every edge is directed and no cycles. Encodes your assumed causal structure directly. This is the default working graph." },
  { key: "CPDAG", label: "CPDAG", desc: "Completed Partially Directed Acyclic Graph — represents an equivalence class of DAGs consistent with the observed data. Some edges remain undirected when direction cannot be identified from data alone." },
  { key: "PAG", label: "PAG", desc: "Partial Ancestral Graph — extends CPDAGs to allow for unmeasured (latent) confounding. Edges carry marks (arrowhead / circle / tail) to represent uncertainty about direction and hidden causes." },
  { key: "MAG", label: "MAG", desc: "Maximal Ancestral Graph — a mixed graph with directed and bidirected edges, used when some variables are unobserved. Bidirected edges denote a shared latent confounder." },
];

// ── Causal Graph AI content variants ─────────────────────────────────────

const GRAPH_STRUCTURE_SUMMARY_VARIANTS = [
  "The current DAG encodes a within-person causal model where sleep_quality on night N is the primary exposure and alcohol_use_event on day N+1 is the outcome. The graph assumes this path is confounded by stress_level and actigraphy_activity — both of which causally affect sleep quality and independently predict drinking. After conditioning on these confounders, remaining variation in alcohol-use probability is attributed to the direct effect of sleep disruption.",
  "Your causal graph represents a time-lagged observational design. The key structural claim is that there are no unmeasured common causes of sleep_quality and alcohol_use_event beyond those already represented as nodes. If any hidden confounder affects both sleep and drinking, the E-value in Estimation will quantify exactly how strong it would need to be to explain away the estimate.",
  "The DAG's structure implies that sleep_quality is not itself caused by the same-day or prior-day alcohol_use_event — this no-feedback assumption is required for a valid causal interpretation of the 24 h lag design. If reverse causation exists (prior drinking impairing next-night sleep), a cross-lagged panel model or NPSEM would be needed instead.",
];

const GRAPH_ASSUMPTIONS_VARIANTS = [
  [
    "Causal Markov condition: each node is independent of all non-descendants given its parents. This is what lets d-separation serve as a testable conditional-independence criterion.",
    "Faithfulness: every conditional independence in the data corresponds to a d-separation in the graph — no path cancellations produce spurious independences.",
    "Acyclicity: the 24 h lag between sleep quality (night N) and alcohol use (day N+1) operationalizes this by construction — temporal ordering rules out same-day feedback.",
    "Sufficient adjustment: the marked confounder set blocks all backdoor paths without conditioning on colliders or mediators. Verify this in the adjustment-warnings card below.",
  ],
  [
    "No unmeasured confounders: after conditioning on the adjustment set, remaining exposure variation is assumed as-good-as-random. The E-value in Estimation quantifies robustness to violations of this assumption.",
    "Consistency (SUTVA): the potential outcome under sleep quality level s is the same regardless of how s was achieved, and no interference exists between participants — both plausible in an outpatient EMA design.",
    "Positivity: for every covariate stratum, participant-days with both good and poor sleep quality exist. The overlap % from Feasibility is the empirical check.",
    "Temporal precedence: sleep quality (night N) precedes alcohol use (day N+1). The EMA protocol enforces this for the 24 h lag by construction.",
  ],
  [
    "Exchangeability: conditional on measured confounders, participant-days with poor vs. good sleep quality are comparable on all causally relevant variables. The within-person design eliminates time-stable confounders; time-varying confounders (daily mood, medication adherence) remain a threat.",
    "Correct graph specification: the depicted nodes and edges accurately reflect the true data-generating process. Omitted nodes (social contact, treatment attendance) represent unmeasured confounders not captured by the adjustment set.",
    "No differential measurement error: sleep_quality is assumed measured without systematic bias related to drinking status. Recall bias in single-item EMA scales could create non-classical measurement error.",
    "No selection bias: participants who contributed usable records are not systematically different from those who did not with respect to the sleep–alcohol relationship.",
  ],
];

const GRAPH_TYPE_DESC_VARIANTS = {
  DAG: [
    "Directed Acyclic Graph — every edge is directed and no cycles. Encodes your assumed causal structure directly. This is the default working graph.",
    "DAGs are appropriate when domain knowledge is strong enough to fix edge directions and rule out feedback loops. For EMA data with a clear temporal lag, a DAG is valid — the 24 h window prevents same-day cycles by construction. Every edge you draw asserts a directional causal claim.",
    "In a DAG, d-separation determines conditional independence, and the backdoor criterion (if satisfied by your adjustment set) guarantees identifiability of the target effect. Cycles in the underlying process must be broken by the study's temporal design.",
  ],
  CPDAG: [
    "Completed Partially Directed Acyclic Graph — represents an equivalence class of DAGs consistent with the observed data. Some edges remain undirected when direction cannot be identified from data alone.",
    "CPDAGs arise from constraint-based algorithms (e.g., PC) applied to observational data. If you're uncertain about edge directions, a CPDAG is more honest than a fully specified DAG — it explicitly shows which parts of the structure are identifiable from data and which are not.",
    "An undirected edge in a CPDAG means both directions are Markov-equivalent — no observational test can distinguish them. Orienting them requires domain knowledge, a temporal ordering argument, or an interventional experiment.",
  ],
  PAG: [
    "Partial Ancestral Graph — extends CPDAGs to allow for unmeasured (latent) confounding. Edges carry marks (arrowhead / circle / tail) to represent uncertainty about direction and hidden causes.",
    "PAGs are the appropriate representation when unmeasured confounders are likely and you want to be explicit about what the data can and cannot identify. The FCI algorithm produces a PAG, not a DAG, from observational data with latent variables.",
    "A bidirected edge A ↔ B in a PAG asserts that A and B share at least one unmeasured common cause — structurally different from a directed edge, changing what causal effects are identifiable and how they must be estimated.",
  ],
  MAG: [
    "Maximal Ancestral Graph — a mixed graph with directed and bidirected edges, used when some variables are unobserved. Bidirected edges denote a shared latent confounder.",
    "MAGs are used when you want to model unmeasured confounders explicitly without enumerating all possible latent variable structures. The m-separation criterion plays the role that d-separation plays in DAGs.",
    "Switching from a DAG to a MAG is appropriate when you believe a latent common cause exists between two observed variables (e.g., a shared genetic predisposition affecting both sleep and alcohol use) that cannot be measured or adjusted for.",
  ],
};

const NODE_TEMPORAL_ORDER = {
  stress_level: 1,
  actigraphy_activity: 1,
  phone_screen_time: 1,
  sleep_quality: 2,
  alcohol_use_event: 3,
};

function analyzeGraph(nodes, edges, variableRoles) {
  const roleOf = (id) => {
    if (variableRoles[id]) return variableRoles[id];
    const guess = ROLE_TABLE_VARIABLES.find((v) => v.name === id)?.roleGuess;
    return guess || "Unassigned";
  };
  const parents = {};
  const children = {};
  nodes.forEach((n) => { parents[n.id] = []; children[n.id] = []; });
  edges.forEach((e) => {
    if (parents[e.to]) parents[e.to].push(e.from);
    if (children[e.from]) children[e.from].push(e.to);
  });

  const chains = [];
  const forks = [];
  const colliders = [];
  nodes.forEach((mid) => {
    const ps = parents[mid.id];
    const cs = children[mid.id];
    if (ps.length >= 1 && cs.length >= 1) {
      ps.forEach((p) => cs.forEach((c) => {
        if (p !== c) chains.push({ a: p, b: mid.id, c });
      }));
    }
    if (cs.length >= 2) {
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++)
          forks.push({ a: cs[i], b: mid.id, c: cs[j] });
    }
    if (ps.length >= 2) {
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++)
          colliders.push({ a: ps[i], b: mid.id, c: ps[j] });
    }
  });

  const exposureIds = nodes.filter((n) => roleOf(n.id) === "Exposure").map((n) => n.id);
  const outcomeIds = nodes.filter((n) => roleOf(n.id) === "Outcome").map((n) => n.id);

  const descendantsOf = (start) => {
    const seen = new Set();
    const stack = [...(children[start] || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      (children[cur] || []).forEach((c) => stack.push(c));
    }
    return seen;
  };
  const postTreatment = new Set();
  exposureIds.forEach((e) => descendantsOf(e).forEach((d) => postTreatment.add(d)));

  const temporalViolations = edges.filter((e) => {
    const a = NODE_TEMPORAL_ORDER[e.from];
    const b = NODE_TEMPORAL_ORDER[e.to];
    return a != null && b != null && a > b;
  });

  const adjusted = nodes.filter((n) => roleOf(n.id) === "Confounder").map((n) => n.id);
  const badAdjustments = [];
  adjusted.forEach((id) => {
    const role = roleOf(id);
    if (role === "Confounder" && postTreatment.has(id)) {
      badAdjustments.push({ id, reason: "descendant of the exposure — adjusting for it can block part of the causal path." });
    }
  });
  colliders.forEach((c) => {
    if (roleOf(c.b) === "Confounder") {
      badAdjustments.push({ id: c.b, reason: `it is a collider between ${c.a} and ${c.c} — adjusting opens a spurious path.` });
    }
  });
  nodes.forEach((n) => {
    if (roleOf(n.id) === "Mediator" && adjusted.includes(n.id)) {
      badAdjustments.push({ id: n.id, reason: "marked as a mediator — adjusting removes part of the total effect." });
    }
  });

  return { chains, forks, colliders, postTreatment: [...postTreatment], temporalViolations, badAdjustments };
}

const DEFAULT_GRAPH_NODES = [
  { id: "sleep_quality", label: "sleep_quality", isCore: true, x: 230, y: 130 },
  { id: "alcohol_use_event", label: "alcohol_use_event", isCore: true, x: 640, y: 130 },
  { id: "stress_level", label: "stress_level", isCore: true, x: 435, y: 300 },
  { id: "actigraphy_activity", label: "actigraphy_activity", isCore: true, x: 170, y: 340 },
  { id: "phone_screen_time", label: "phone_screen_time", isCore: true, x: 700, y: 340 },
];
const DEFAULT_GRAPH_EDGES = [
  { id: "e1", from: "stress_level", to: "sleep_quality", type: "supported" },
  { id: "e2", from: "stress_level", to: "alcohol_use_event", type: "supported" },
  { id: "e3", from: "sleep_quality", to: "alcohol_use_event", type: "supported" },
  { id: "e4", from: "actigraphy_activity", to: "alcohol_use_event", type: "supported" },
  { id: "e5", from: "phone_screen_time", to: "alcohol_use_event", type: "uncertain" },
];

const DEMO_GRAPH_VARIABLES = [
  "pid",
  "label",
  "time_stamp",
  "time_of_day",
  "day_of_week",
  "acc_min_magnitude",
  "acc_max_magnitude",
  "acc_mean_magnitude",
  "avg_latitude",
];
const DEFAULT_CONFIRMED_QUESTION = "Among adults in the uploaded EMA/passive sensing dataset, what is the effect of sleep-related features during window t on alcohol-use-related label during the next observation window?";

function roleToBackendRole(role) {
  const map = {
    Exposure: "exposure",
    Outcome: "outcome",
    Confounder: "confounder",
    Mediator: "mediator",
    Proxy: "proxy",
    Unassigned: "unknown",
  };
  return map[role] || String(role || "unknown").toLowerCase();
}

function backendRoleToFrontendRole(role) {
  const map = {
    exposure: "Exposure",
    outcome: "Outcome",
    confounder: "Confounder",
    mediator: "Mediator",
    proxy: "Proxy",
    unknown: "Unassigned",
    collider_candidate: "Unassigned",
  };
  return map[String(role || "").toLowerCase()] || "Unassigned";
}

function graphSelectedVariables(datasets) {
  const schema = firstRealDataset(datasets)?.schema;
  const columns = schema?.column_names || [];
  // Never fall back to demo variable names for a parsed uploaded dataset.
  const names = columns.slice(0, 12);
  return names.map((name) => ({
    variable_name: name,
    missingness_warning: schema?.warnings?.find((warning) => warning.column === name)?.message || "",
    missing_percent: schema?.missing_value_percentage_per_column?.[name] ?? null,
  }));
}

function frontendNodesToBackend(nodes, variableRoles) {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    role: roleToBackendRole(variableRoles[node.id] || node.role || "Unassigned"),
    temporal_role: node.temporalRole || node.temporal_role || "unknown",
    measurement_role: node.measurementRole || node.measurement_role || "unknown",
    data_category: node.dataCategory || node.data_category || "dataset_variable",
    locked: Boolean(node.locked),
    notes: node.notes || "",
  }));
}

function frontendEdgesToBackend(edges) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    edge_type: edge.edgeType || (edge.type === "uncertain" ? "uncertain" : "directed"),
    rationale: edge.rationale || "",
    supporting_evidence: edge.supportingEvidence || [],
    confidence: edge.confidence || (edge.type === "uncertain" ? "uncertain" : "medium"),
    temporal_constraint: edge.temporalConstraint || edge.temporal_constraint || "Requires user review before downstream use.",
    locked: Boolean(edge.locked),
    user_modified: Boolean(edge.userModified),
  }));
}

function backendGraphToFrontend(graphResponse) {
  const nodes = (graphResponse.nodes || []).map((node, index) => {
    const columns = 4;
    const x = 140 + (index % columns) * 210;
    const y = 120 + Math.floor(index / columns) * 145;
    return {
      id: node.id || node.node_id || node.variable_name,
      label: node.label || node.display_name || node.variable_name || node.id,
      role: backendRoleToFrontendRole(node.role),
      temporalRole: node.temporal_role || "unknown",
      measurementRole: node.measurement_role || "unknown",
      dataCategory: node.data_category || "dataset_variable",
      locked: Boolean(node.locked),
      notes: node.notes || "",
      isCore: true,
      x,
      y,
    };
  }).filter((node) => node.id);
  const edges = (graphResponse.edges || []).map((edge) => ({
    id: edge.id || `${edge.source || edge.from}__${edge.target || edge.to}`,
    from: edge.source || edge.from,
    to: edge.target || edge.to,
    type: (edge.edge_type || edge.type) === "uncertain" ? "uncertain" : "supported",
    edgeType: edge.edge_type || (edge.type === "uncertain" ? "uncertain" : "directed"),
    rationale: edge.rationale || "",
    supportingEvidence: edge.supporting_evidence || [],
    confidence: edge.confidence || "uncertain",
    temporalConstraint: edge.temporal_constraint || "Requires user review before downstream use.",
    locked: Boolean(edge.locked),
    userModified: Boolean(edge.user_modified),
  })).filter((edge) => edge.from && edge.to);
  return { nodes, edges };
}

function graphValidationBadge(validationResult) {
  const status = validationResult?.status;
  if (!status) return { label: "Not validated", className: "chip-muted" };
  if (status === "valid") return { label: "Valid", className: "chip-success" };
  if (status === "valid_with_warnings") return { label: "Valid with warnings", className: "chip-warning" };
  return { label: "Invalid", className: "chip-danger" };
}

// ── Alternative causal graph structures (GenAI first-pass variants) ────────
const GRAPH_VARIANTS = [
  {
    name: "Stress-confounded sleep effect",
    desc: "Stress is the primary confounder. It disrupts sleep quality and independently drives drinking. Activity level and screen time both affect alcohol use directly.",
    nodes: DEFAULT_GRAPH_NODES.map((n) => ({ ...n })),
    edges: DEFAULT_GRAPH_EDGES.map((e) => ({ ...e })),
  },
  {
    name: "Activity-mediated model",
    desc: "Physical activity mediates through both sleep and stress. Screen time disrupts sleep rather than alcohol use directly. Removes the direct activity→alcohol path.",
    nodes: [
      { id: "sleep_quality",       label: "sleep_quality",       isCore: true, x: 230, y: 130 },
      { id: "alcohol_use_event",   label: "alcohol_use_event",   isCore: true, x: 640, y: 130 },
      { id: "stress_level",        label: "stress_level",        isCore: true, x: 435, y: 300 },
      { id: "actigraphy_activity", label: "actigraphy_activity", isCore: true, x: 170, y: 340 },
      { id: "phone_screen_time",   label: "phone_screen_time",   isCore: true, x: 700, y: 340 },
    ],
    edges: [
      { id: "e1", from: "stress_level",        to: "sleep_quality",     type: "supported" },
      { id: "e2", from: "stress_level",        to: "alcohol_use_event", type: "supported" },
      { id: "e3", from: "sleep_quality",       to: "alcohol_use_event", type: "supported" },
      { id: "e4", from: "actigraphy_activity", to: "sleep_quality",     type: "supported" },
      { id: "e5", from: "actigraphy_activity", to: "stress_level",      type: "supported" },
      { id: "e6", from: "phone_screen_time",   to: "sleep_quality",     type: "uncertain" },
    ],
  },
  {
    name: "Phone-as-confounder model",
    desc: "Screen time confounds both sleep and drinking. Activity affects sleep (not drinking). Stress remains an independent confounder, but phone use is now the primary upstream driver.",
    nodes: [
      { id: "sleep_quality",       label: "sleep_quality",       isCore: true, x: 230, y: 130 },
      { id: "alcohol_use_event",   label: "alcohol_use_event",   isCore: true, x: 640, y: 130 },
      { id: "stress_level",        label: "stress_level",        isCore: true, x: 435, y: 300 },
      { id: "actigraphy_activity", label: "actigraphy_activity", isCore: true, x: 170, y: 340 },
      { id: "phone_screen_time",   label: "phone_screen_time",   isCore: true, x: 700, y: 300 },
    ],
    edges: [
      { id: "e1", from: "phone_screen_time",   to: "sleep_quality",     type: "supported" },
      { id: "e2", from: "phone_screen_time",   to: "alcohol_use_event", type: "supported" },
      { id: "e3", from: "sleep_quality",       to: "alcohol_use_event", type: "supported" },
      { id: "e4", from: "stress_level",        to: "sleep_quality",     type: "supported" },
      { id: "e5", from: "stress_level",        to: "alcohol_use_event", type: "supported" },
      { id: "e6", from: "actigraphy_activity", to: "sleep_quality",     type: "uncertain" },
    ],
  },
];

function computeGraphEdgeDiff(variantA, variantB) {
  const keyA = new Set(variantA.edges.map((e) => `${e.from}→${e.to}`));
  const keyB = new Set(variantB.edges.map((e) => `${e.from}→${e.to}`));
  return {
    added:     variantB.edges.filter((e) => !keyA.has(`${e.from}→${e.to}`)),
    removed:   variantA.edges.filter((e) => !keyB.has(`${e.from}→${e.to}`)),
    unchanged: variantB.edges.filter((e) =>  keyA.has(`${e.from}→${e.to}`)),
  };
}

function GraphView({ state, actions, onGoNext }) {
  const {
    graphNodes,
    graphEdges,
    variableRoles,
    selectedNodeId,
    selectedEdgeId,
    graphType,
    graphVersionLabel,
    graphValidationResult,
    graphAlternatives,
    confirmedGraph,
    graphActionStatus,
    targetedFeasibilityResult,
  } = state;
  const {
    updateNodePos,
    selectNode,
    selectEdge,
    addGraphNode,
    removeGraphNode,
    renameNode,
    setNodeRole,
    addGraphEdge,
    removeGraphEdge,
    setEdgeType,
    resetGraph,
    loadGraphVariant,
    setGraphType,
    generateFirstPassGraph,
    validateCurrentGraph,
    generateAlternativeGraph,
    saveGraphAlternative,
    confirmGraph,
    reverseGraphEdge,
    toggleEdgeLock,
    runAssistantAction,
    lockContent,
    unlockContent,
    showToast,
  } = actions;

  const svgRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const movedRef = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [edgeMode, setEdgeMode] = useState(false);
  const [edgeFrom, setEdgeFrom] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showGraphHelper, setShowGraphHelper] = useState(true);
  const analysis = useMemo(() => analyzeGraph(graphNodes, graphEdges, variableRoles), [graphNodes, graphEdges, variableRoles]);
  const graphTypeInfo = GRAPH_TYPE_OPTIONS.find((o) => o.key === graphType);

  // ── Graph variant (Regenerate / Compare / Lock) ──────────────────────────
  const [variantIdx, setVariantIdx] = useState(0);
  const [graphLocked, setGraphLocked] = useState(false);
  const [graphGenerating, setGraphGenerating] = useState(false);
  const [graphCompareMode, setGraphCompareMode] = useState(false);
  const totalVariants = GRAPH_VARIANTS.length;

  function applyVariant(idx) {
    const v = GRAPH_VARIANTS[idx];
    loadGraphVariant(v.nodes, v.edges);
  }
  function handleGraphRegenerate() {
    if (graphLocked || graphGenerating) return;
    setGraphGenerating(true);
    setGraphCompareMode(false);
    setTimeout(() => {
      const next = (variantIdx + 1) % totalVariants;
      setVariantIdx(next);
      applyVariant(next);
      setGraphGenerating(false);
    }, 900);
  }
  function handleGraphNavPrev() {
    if (graphLocked || variantIdx === 0) return;
    const idx = variantIdx - 1;
    setVariantIdx(idx);
    applyVariant(idx);
    setGraphCompareMode(false);
  }
  function handleGraphNavNext() {
    if (graphLocked || variantIdx === totalVariants - 1) return;
    const idx = variantIdx + 1;
    setVariantIdx(idx);
    applyVariant(idx);
    setGraphCompareMode(false);
  }
  function handleGraphLock() {
    setGraphLocked(true);
    setGraphCompareMode(false);
    lockContent("causalGraph", { variantIdx, name: GRAPH_VARIANTS[variantIdx].name });
  }
  function handleGraphUnlock() {
    setGraphLocked(false);
    unlockContent("causalGraph");
  }
  const edgeDiff = graphCompareMode && variantIdx > 0
    ? computeGraphEdgeDiff(GRAPH_VARIANTS[variantIdx - 1], GRAPH_VARIANTS[variantIdx])
    : null;

  function toViewBox(clientX, clientY) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * 900, y: ((clientY - rect.top) / rect.height) * 520 };
  }

  function onNodeMouseDown(e, node) {
    e.stopPropagation();
    const p = toViewBox(e.clientX, e.clientY);
    dragOffset.current = { x: p.x - node.x, y: p.y - node.y };
    movedRef.current = false;
    setDragId(node.id);
  }
  function onSvgMouseMove(e) {
    if (!dragId) return;
    const p = toViewBox(e.clientX, e.clientY);
    movedRef.current = true;
    updateNodePos(dragId, p.x - dragOffset.current.x, p.y - dragOffset.current.y);
  }
  function onSvgMouseUp() {
    if (dragId && !movedRef.current) handleNodeClick(dragId);
    setDragId(null);
  }
  function handleNodeClick(id) {
    if (edgeMode) {
      if (!edgeFrom) setEdgeFrom(id);
      else if (edgeFrom !== id) {
        addGraphEdge(edgeFrom, id);
        setEdgeFrom(null);
        setEdgeMode(false);
      }
    } else {
      selectNode(id);
    }
  }

  const selectedNode = graphNodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = graphEdges.find((e) => e.id === selectedEdgeId);
  const supportedCount = graphEdges.filter((e) => e.type === "supported").length;
  const uncertainCount = graphEdges.length - supportedCount;
  const validationBadge = graphValidationBadge(graphValidationResult);
  const canUseGraphBackend = Boolean(targetedFeasibilityResult);

  function handleContinueToStrategy() {
    if (!confirmedGraph && !graphAlternatives.length) {
      showToast("Please confirm the graph or save it as a draft before continuing to Analysis Strategy.");
      return;
    }
    if (!confirmedGraph) {
      showToast("Continuing with a saved graph draft. Its assumptions and warnings remain subject to review.");
    }
    onGoNext();
  }

  return (
    <div className="graph-page">
      <div className="graph-toolbar">
        <div className="graph-toolbar-title">
          <GitBranch size={16} color="var(--accent)" /> Causal graph & final role validation
          <span className="chip chip-accent" style={{ marginLeft: 8, fontSize: 10.5, padding: "2px 8px" }}><Sparkles size={10} /> GenAI first-pass</span>
          <span className={`chip ${validationBadge.className}`} style={{ marginLeft: 4, fontSize: 10.5, padding: "2px 8px" }}>{validationBadge.label}</span>
          {graphVersionLabel && <span className="chip chip-muted" style={{ fontSize: 10.5, padding: "2px 8px" }}>{graphVersionLabel}</span>}
          {state.studyMode && <span className="chip chip-warning" style={{ fontSize: 10.5, padding: "2px 8px" }}>Assumption-based graph draft — not causal proof.</span>}
        </div>
        <div className="graph-legend">
          {Object.entries(ROLE_NODE_COLOR).filter(([r]) => r !== "Unassigned").map(([role, color]) => (
            <span key={role}><span className="legend-dot" style={{ background: color }} />{role}</span>
          ))}
          <span><span className="legend-dot legend-dash" />Uncertain edge</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select className="select-input" value={graphType} onChange={(e) => { actions.beginStudyAction("graph_action", "graph_type_change").success(); setGraphType(e.target.value); }} title="Graph type">
            {GRAPH_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => generateFirstPassGraph()} disabled={!canUseGraphBackend || graphActionStatus?.kind === "loading"}>
            <Wand2 size={13} /> Generate First-Pass Graph
          </button>
          <button className="btn btn-sm" onClick={() => generateFirstPassGraph("Regenerated Graph")} disabled={!canUseGraphBackend || graphActionStatus?.kind === "loading"}>
            <RefreshCw size={13} /> Regenerate Graph
          </button>
          <button className="btn btn-sm" onClick={generateAlternativeGraph} disabled={!canUseGraphBackend || graphActionStatus?.kind === "loading"}>
            <Sparkles size={13} /> Generate Alternative Graph
          </button>
          <button className="btn btn-sm" onClick={() => generateFirstPassGraph("Reprocessed User Edits", "Keep my locked/user-edited edges where possible.")} disabled={!canUseGraphBackend || graphActionStatus?.kind === "loading"}>
            <Play size={13} /> Reprocess Using My Edits
          </button>
          <button className="btn btn-secondary btn-sm" onClick={validateCurrentGraph} disabled={!canUseGraphBackend || graphActionStatus?.kind === "loading"}>
            <ShieldAlert size={13} /> Validate My Changes
          </button>
          <button className={`btn btn-sm ${edgeMode ? "btn-secondary" : ""}`} onClick={() => { setEdgeMode((m) => !m); setEdgeFrom(null); }}>
            <Link2 size={13} /> {edgeMode ? (edgeFrom ? "Pick target node\u2026" : "Pick source node\u2026") : "Connect nodes"}
          </button>
          <button className="btn btn-sm" onClick={addGraphNode}><ClipboardList size={13} /> Add node</button>
          <button className="btn btn-sm" onClick={resetGraph}><RefreshCw size={13} /> Reset layout</button>
          <button className="btn btn-sm" onClick={() => setShowAnalysis((s) => !s)}>{showAnalysis ? "Hide analysis" : "Show analysis"}</button>
          {!showGraphHelper && <button className="btn btn-sm" aria-label="Show graph helper" onClick={() => setShowGraphHelper(true)}>Show graph helper</button>}
          <button className="btn btn-sm" onClick={() => runAssistantAction("Interpret This Graph")}><Info size={13} /> Interpret This Graph</button>
          <button className="btn btn-primary btn-sm" onClick={handleContinueToStrategy}>Analysis strategy <ArrowRight size={13} /></button>
        </div>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "#F8FAFC", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="helper" style={{ margin: 0 }}>
          <AlertTriangle size={13} /> Graph edges are assumptions, not proven causal relationships. The LLM can draft alternatives, but backend validation checks graph structure.
        </span>
        {graphType !== "DAG" && (
          <span className="chip chip-warning">{graphType} experimental: full representation-specific validation is not yet implemented.</span>
        )}
        {!confirmedGraph && !graphAlternatives.length && (
          <span className="chip chip-warning">Save a draft or validate and confirm the graph before Phase 7.</span>
        )}
        {graphActionStatus?.message && (
          <span className={`chip ${graphActionStatus.kind === "error" ? "chip-danger" : graphActionStatus.kind === "success" ? "chip-success" : "chip-muted"}`}>
            {graphActionStatus.message}
          </span>
        )}
        {confirmedGraph && <span className="chip chip-success">Confirmed graph saved for downstream review</span>}
        {graphAlternatives?.length > 0 && <span className="chip chip-muted">{graphAlternatives.length} saved alternative{graphAlternatives.length === 1 ? "" : "s"}</span>}
        {!canUseGraphBackend && <span className="chip chip-warning">Run feasibility checks before generating a graph.</span>}
      </div>
      {graphValidationResult && (
        <div className={`action-note ${graphValidationResult.safe_to_continue ? "action-note-warning" : "action-note-error"}`} style={{ margin: "10px 16px 0" }}>
          <strong>Graph validation:</strong> {graphValidationResult.safe_to_continue
            ? "No blocking graph error was returned. Review every warning before continuing; edges remain design assumptions, not proven causal facts."
            : "Blocking graph errors were returned. Fix cycles, self-loops, invalid nodes, or invalid role/timing choices before continuing."}
          {(graphValidationResult.errors?.length || graphValidationResult.warnings?.length) ? (
            <span> Errors: {graphValidationResult.errors?.length || 0}; warnings: {graphValidationResult.warnings?.length || 0}.</span>
          ) : null}
        </div>
      )}

      {/* ── Graph Regenerate / Version / Lock toolbar ── */}
      <div className={`graph-regen-bar${graphLocked ? " graph-regen-bar-locked" : ""}`}>
        <div className="regen-toolbar-left" style={{ gap: 8 }}>
          <div className="regen-nav">
            <button className="regen-nav-btn" onClick={handleGraphNavPrev} disabled={variantIdx === 0 || graphLocked}>‹</button>
            <span className="regen-version-label">v{variantIdx + 1}/{totalVariants}</span>
            <button className="regen-nav-btn" onClick={handleGraphNavNext} disabled={variantIdx === totalVariants - 1 || graphLocked}>›</button>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>{GRAPH_VARIANTS[variantIdx].name}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 340 }}>{GRAPH_VARIANTS[variantIdx].desc}</span>
          {variantIdx > 0 && !graphLocked && (
            <button className="btn btn-ghost btn-sm regen-compare-btn" onClick={() => setGraphCompareMode((m) => !m)}>
              <Eye size={11} />{graphCompareMode ? "Close compare" : "Compare"}
            </button>
          )}
        </div>
        <div className="regen-toolbar-right">
          {graphLocked ? (
            <>
              <span className="regen-locked-badge"><Lock size={11} /> Locked in</span>
              <button className="btn btn-ghost btn-sm" onClick={handleGraphUnlock}>Unlock</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleGraphRegenerate} disabled={graphGenerating} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} className={graphGenerating ? "spin" : ""} />
                {graphGenerating ? "Generating…" : "Regenerate graph"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleGraphLock} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Lock size={11} /> Lock in
              </button>
              <button className="btn btn-ghost btn-sm" onClick={saveGraphAlternative}>
                <Save size={11} /> Save Alternative Graph
              </button>
              <button className="btn btn-ghost btn-sm" onClick={confirmGraph}>
                <CheckCircle2 size={11} /> Confirm Graph
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Compare edge-diff panel ── */}
      {graphCompareMode && edgeDiff && (
        <div style={{ padding: "10px 16px", background: "#F8F9FB", borderBottom: "1px solid var(--border)", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 11.5 }}>
          <div>
            <div style={{ fontWeight: 700, color: "var(--success)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Added ({edgeDiff.added.length})</div>
            {edgeDiff.added.length === 0
              ? <span style={{ color: "var(--text-3)" }}>—</span>
              : edgeDiff.added.map((e) => <div key={e.id} className="mono" style={{ color: "var(--success)" }}>{e.from} → {e.to}{e.type === "uncertain" ? " (uncertain)" : ""}</div>)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "var(--danger)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Removed ({edgeDiff.removed.length})</div>
            {edgeDiff.removed.length === 0
              ? <span style={{ color: "var(--text-3)" }}>—</span>
              : edgeDiff.removed.map((e) => <div key={e.id} className="mono" style={{ color: "var(--danger)", textDecoration: "line-through" }}>{e.from} → {e.to}</div>)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "var(--text-3)", marginBottom: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unchanged ({edgeDiff.unchanged.length})</div>
            {edgeDiff.unchanged.map((e) => <div key={e.id} className="mono" style={{ color: "var(--text-3)" }}>{e.from} → {e.to}</div>)}
          </div>
        </div>
      )}

      <div className="graph-canvas-wrap">
        <svg ref={svgRef} viewBox="0 0 900 520" onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onMouseLeave={onSvgMouseUp}>
          <defs>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto">
              <path d="M0,0 L9,4 L0,8 Z" fill="#8A93A3" />
            </marker>
          </defs>
          {graphEdges.map((edge) => {
            const from = graphNodes.find((n) => n.id === edge.from);
            const to = graphNodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            const dx = to.x - from.x, dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const pad = 48;
            const x1 = from.x + (dx / len) * pad, y1 = from.y + (dy / len) * pad;
            const x2 = to.x - (dx / len) * pad, y2 = to.y - (dy / len) * pad;
            const selected = edge.id === selectedEdgeId;
            return (
              <g key={edge.id} onClick={(e) => { e.stopPropagation(); selectEdge(edge.id); }} style={{ cursor: "pointer" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={selected ? "#2F5D8A" : "#8A93A3"}
                  strokeWidth={selected ? 2.5 : 1.5}
                  strokeDasharray={edge.type === "uncertain" ? "5,4" : "0"}
                  markerEnd="url(#arrow)"
                />
              </g>
            );
          })}
          {graphNodes.map((node) => {
            const role = variableRoles[node.id] || (DEFAULT_GRAPH_NODES.find((d) => d.id === node.id) ? ROLE_TABLE_VARIABLES.find((v) => v.name === node.id)?.roleGuess : "Unassigned") || "Unassigned";
            const color = ROLE_NODE_COLOR[role] || ROLE_NODE_COLOR.Unassigned;
            const selected = node.id === selectedNodeId;
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`} onMouseDown={(e) => onNodeMouseDown(e, node)} style={{ cursor: "grab" }}>
                <circle r={selected ? 46 : 42} fill="#fff" stroke={color} strokeWidth={selected ? 3 : 2} />
                <circle r={5} fill={color} cy={-4} />
                <text textAnchor="middle" y={16} className="graph-node-label" fill="#16233D">{node.label.length > 16 ? node.label.slice(0, 15) + "\u2026" : node.label}</text>
                <text textAnchor="middle" y={30} className="graph-node-sub" fill={color}>{role}</text>
              </g>
            );
          })}
        </svg>

        <div className="graph-notice">{supportedCount} edge{supportedCount === 1 ? "" : "s"} supported \u00b7 {uncertainCount} marked uncertain</div>

        {selectedNode && (
          <div className="graph-side-panel">
            <h4>Node</h4>
            <input className="select-input" style={{ width: "100%", marginBottom: 8 }} value={selectedNode.label} onBlur={() => actions.beginStudyAction("graph_action", "graph_node_label_reviewed").success()} onChange={(e) => renameNode(selectedNode.id, e.target.value)} />
            <span className="filter-label">Role</span>
            <select className="select-input" style={{ width: "100%", marginTop: 4 }} value={variableRoles[selectedNode.id] || "Unassigned"} onChange={(e) => setNodeRole(selectedNode.id, e.target.value)}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p>{ROLE_EXPLANATION[variableRoles[selectedNode.id] || "Unassigned"]}</p>
            <p>
              <strong>Variable:</strong> <span className="mono">{selectedNode.id}</span><br />
              <strong>Temporal role:</strong> {selectedNode.temporalRole || "unknown"}<br />
              <strong>Measurement role:</strong> {selectedNode.measurementRole || "unknown"}<br />
              <strong>Data category:</strong> {selectedNode.dataCategory || ROLE_TABLE_VARIABLES.find((v) => v.name === selectedNode.id)?.source || "unknown"}<br />
              <strong>Locked:</strong> {selectedNode.locked ? "yes" : "no"}<br />
              <strong>Notes:</strong> {selectedNode.notes || "No node notes recorded yet."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" onClick={() => selectNode(null)}>Close</button>
              {!selectedNode.isCore && <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => removeGraphNode(selectedNode.id)}>Remove node</button>}
            </div>
          </div>
        )}

        {selectedEdge && (
          <div className="graph-side-panel">
            <h4><span className="mono">{selectedEdge.from}</span> \u2192 <span className="mono">{selectedEdge.to}</span></h4>
            <p>{selectedEdge.type === "uncertain" ? "Uncertain: confirm timing/evidence or remove before moving on." : "Evidence-informed draft edge. This remains an assumption until user review and validation."}</p>
            <p>
              <strong>Edge type:</strong> {selectedEdge.edgeType || "directed"}<br />
              <strong>Confidence:</strong> {selectedEdge.confidence || "uncertain"}<br />
              <strong>Temporal compatibility:</strong> {selectedEdge.temporalConstraint || "Needs review"}<br />
              <strong>User decision:</strong> {selectedEdge.locked ? "Locked/user accepted" : selectedEdge.userModified ? "User-specified" : "Draft"}<br />
              <strong>Rationale:</strong> {selectedEdge.rationale || "No rationale recorded yet."}<br />
              <strong>Supporting evidence:</strong> {selectedEdge.supportingEvidence?.length ? selectedEdge.supportingEvidence.join("; ") : "Unsupported by retrieved evidence"}<br />
              <strong>Limitations:</strong> Graph edges are assumptions, not proven causal relationships.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={() => setEdgeType(selectedEdge.id, selectedEdge.type === "supported" ? "uncertain" : "supported")}>
                Mark as {selectedEdge.type === "supported" ? "uncertain" : "supported"}
              </button>
              <button className="btn btn-sm" onClick={() => reverseGraphEdge(selectedEdge.id)}>Reverse edge</button>
              <button className="btn btn-sm" onClick={() => toggleEdgeLock(selectedEdge.id)}>{selectedEdge.locked ? "Unlock" : "Lock"} edge</button>
              <button className="btn btn-sm" onClick={() => runAssistantAction("Explain Selected Edge")}>Explain Selected Edge</button>
              <button className="btn btn-sm" onClick={() => runAssistantAction("What Happens If I Adjust for This Variable?")}>Adjustment impact</button>
              <button className="btn btn-sm" onClick={() => selectEdge(null)}>Close</button>
              <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => removeGraphEdge(selectedEdge.id)}>Remove edge</button>
            </div>
          </div>
        )}

        {!selectedNode && !selectedEdge && showGraphHelper && (
          <div className="graph-side-panel">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h4 style={{ margin: 0 }}>Graph helper</h4>
              <button className="btn btn-sm" aria-label="Close graph helper" onClick={() => setShowGraphHelper(false)}>Close</button>
            </div>
            <p>Click a node or edge to inspect role, timing, evidence rationale, confidence, and lock status. Drag nodes to edit layout; use Connect nodes to add arrows.</p>
          </div>
        )}
      </div>

      {graphValidationResult && (
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "#fff" }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Deterministic graph validation</div>
              <span className={`chip ${validationBadge.className}`}>{validationBadge.label}</span>
            </div>
            <div className="filter-pills">
              {Object.entries(graphValidationResult.checks || {}).map(([key, value]) => (
                <span key={key} className={`chip ${value ? "chip-success" : "chip-warning"}`}>{key.replaceAll("_", " ")}: {String(value)}</span>
              ))}
            </div>
            {(graphValidationResult.errors || []).map((error, index) => (
              <div key={`graph-error-${index}`} className="helper" style={{ color: "var(--danger)", marginTop: 8 }}><XCircle size={13} /> {error}</div>
            ))}
            {(graphValidationResult.warnings || []).map((warning, index) => (
              <div key={`graph-warning-${index}`} className="helper" style={{ marginTop: 8 }}><AlertTriangle size={13} /> {warning}</div>
            ))}
          </div>
        </div>
      )}

      {showAnalysis && (
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "#fff", maxHeight: "42vh", overflowY: "auto" }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Graph concepts and assistant checks</div>
              <span className="chip chip-muted">Education only</span>
            </div>
            <p className="card-desc">Variable roles remain provisional until deterministic validation and user confirmation. These explanations support review; they do not prove graph validity.</p>
            <div className="button-row">
              <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction("Show Backdoor Paths")}>Show Backdoor Paths</button>
              <button className="btn btn-secondary btn-sm" onClick={() => runAssistantAction("What Happens If I Adjust for This Variable?")}>Adjustment Consequences</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setGraphCompareMode((m) => !m)}>Compare Graph Versions</button>
            </div>
            <div className="question-field-grid" style={{ marginTop: 10 }}>
              <div className="question-field"><span className="filter-label">Chain</span><div className="helper" style={{ margin: 0 }}>A -&gt; B -&gt; C. Adjusting for B blocks the path.</div></div>
              <div className="question-field"><span className="filter-label">Fork</span><div className="helper" style={{ margin: 0 }}>B causes A and C. B is a common-cause candidate.</div></div>
              <div className="question-field"><span className="filter-label">Collider</span><div className="helper" style={{ margin: 0 }}>A -&gt; B &lt;- C. Adjusting for B can open a noncausal path.</div></div>
              <div className="question-field"><span className="filter-label">Mediator</span><div className="helper" style={{ margin: 0 }}>Exposure -&gt; mediator -&gt; outcome. Adjusting changes total-effect interpretation.</div></div>
              <div className="question-field"><span className="filter-label">Backdoor path</span><div className="helper" style={{ margin: 0 }}>A noncausal route from exposure to outcome through common causes.</div></div>
              <div className="question-field"><span className="filter-label">Total vs direct effect</span><div className="helper" style={{ margin: 0 }}>Total includes mediated paths; direct blocks selected mediators.</div></div>
            </div>
          </div>

          {/* ── AI: Graph structure summary ── */}
          <div className="card insight-card" style={{ marginTop: 0 }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-blue"><Sparkles size={13} /></div>
              <div>
                <div className="card-title">Graph structure summary</div>
                <div className="insight-subtitle">GenAI first-pass interpretation of your current causal graph</div>
              </div>
            </div>
            <RegenerateBlock
              variants={GRAPH_STRUCTURE_SUMMARY_VARIANTS}
              renderVariant={(text) => <p className="insight-body">{text}</p>}
              onLock={(val) => lockContent("graphStructureSummary", val)}
              onUnlock={() => unlockContent("graphStructureSummary")}
            />
          </div>

          {/* ── AI: Key causal assumptions ── */}
          <div className="card insight-card" style={{ borderLeftColor: "#6B46A8" }}>
            <div className="insight-card-header">
              <div className="insight-icon insight-icon-purple"><ShieldAlert size={13} /></div>
              <div>
                <div className="card-title">Key causal assumptions encoded by this graph</div>
                <div className="insight-subtitle">GenAI-drafted — review and lock before moving to Analysis Strategy</div>
              </div>
            </div>
            <RegenerateBlock
              variants={GRAPH_ASSUMPTIONS_VARIANTS}
              renderVariant={(items) => (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                  {items.map((item, i) => <li key={i} className="insight-body" style={{ marginBottom: 4 }}>{item}</li>)}
                </ul>
              )}
              onLock={(val) => lockContent("graphAssumptions", val)}
              onUnlock={() => unlockContent("graphAssumptions")}
            />
          </div>

          {/* ── Graph type ── */}
          <div className="card">
            <div className="card-head"><div className="card-title">Graph type — {graphTypeInfo.label}</div><CardInfo text="The type of causal graph being displayed. DAG (default) assumes directed edges and no cycles. CPDAG, PAG, and MAG encode different assumptions about causal equivalence and unmeasured confounding." /></div>
            <RegenerateBlock
              key={graphType}
              variants={GRAPH_TYPE_DESC_VARIANTS[graphType] || [graphTypeInfo.desc]}
              renderVariant={(text) => <p className="card-desc" style={{ marginBottom: 6 }}>{text}</p>}
              onLock={(val) => lockContent(`graphTypeDesc_${graphType}`, val)}
              onUnlock={() => unlockContent(`graphTypeDesc_${graphType}`)}
            />
            <div className="filter-pills">
              {GRAPH_TYPE_OPTIONS.map((o) => (
                <span key={o.key} className={`chip ${o.key === graphType ? "chip-accent" : "chip-muted"}`} style={{ cursor: "pointer" }} onClick={() => setGraphType(o.key)}>{o.label}</span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Structural patterns detected</div><CardInfo text="Chains (A→B→C), forks (A←B→C), and colliders (A→B←C) found in the current graph. Chains transmit effects, forks create confounding paths, and colliders open spurious paths only when adjusted for." /></div>
            <p className="card-desc">Chains transmit effects, forks create confounding paths, and colliders open spurious paths only when adjusted for.</p>
            <div className="pattern-row"><span><strong>Chains</strong> (A → B → C): mediation-style paths</span><span className="chip chip-muted">{analysis.chains.length}</span></div>
            {analysis.chains.slice(0, 4).map((c, i) => (
              <div className="pattern-row" key={`ch${i}`}><span className="mono">{c.a} → {c.b} → {c.c}</span><span className="chip chip-accent">chain</span></div>
            ))}
            <div className="pattern-row"><span><strong>Forks</strong> (A ← B → C): shared common cause</span><span className="chip chip-muted">{analysis.forks.length}</span></div>
            {analysis.forks.slice(0, 4).map((c, i) => (
              <div className="pattern-row" key={`fk${i}`}><span className="mono">{c.a} ← {c.b} → {c.c}</span><span className="chip chip-accent">fork</span></div>
            ))}
            <div className="pattern-row"><span><strong>Colliders</strong> (A → B ← C): do NOT adjust</span><span className="chip chip-muted">{analysis.colliders.length}</span></div>
            {analysis.colliders.slice(0, 4).map((c, i) => (
              <div className="pattern-row" key={`co${i}`}><span className="mono">{c.a} → {c.b} ← {c.c}</span><span className="chip chip-warning">collider</span></div>
            ))}
            {analysis.chains.length + analysis.forks.length + analysis.colliders.length === 0 && (
              <div className="helper"><Info size={13} /> No three-node structures yet — add or connect nodes to see patterns.</div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Temporal-order validation</div><CardInfo text="Checks that directed edges flow from earlier-measured to later-measured variables, based on your measurement schedule. Reversed edges violate the temporal ordering assumption required for causal inference." /></div>
            {analysis.temporalViolations.length === 0 ? (
              <div className="helper"><CheckCircle2 size={13} color="var(--success)" /> All directed edges respect the assumed temporal order.</div>
            ) : (
              analysis.temporalViolations.map((e) => (
                <div className="pattern-row" key={e.id}>
                  <span className="mono">{e.from} → {e.to}</span>
                  <span className="chip chip-warning"><AlertTriangle size={12} /> Edge runs against expected time order</span>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Post-treatment variables</div><CardInfo text="Variables that are descendants of the exposure node. Adjusting for them can block part of the causal pathway or open collider bias — check your adjustment set carefully before finalizing." /></div>
            {analysis.postTreatment.length === 0 ? (
              <div className="helper"><Info size={13} /> No exposure marked yet, or no downstream variables detected.</div>
            ) : (
              <>
                <p className="card-desc">These variables are descendants of the exposure. Adjusting for them can bias the causal effect.</p>
                <div className="filter-pills">
                  {analysis.postTreatment.map((id) => <span key={id} className="chip chip-warning mono">{id}</span>)}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Adjustment warnings</div><CardInfo text="Alerts for role assignments that could bias the causal estimate — e.g., adjusting for a collider (which opens a spurious path) or a mediator when estimating the total effect (which removes part of it)." /></div>
            {analysis.badAdjustments.length === 0 ? (
              <div className="helper"><CheckCircle2 size={13} color="var(--success)" /> No collider- or mediator-adjustment warnings for the current role assignments.</div>
            ) : (
              analysis.badAdjustments.map((w, i) => (
                <div className="pattern-row" key={i}>
                  <span><span className="mono">{w.id}</span> — {w.reason}</span>
                  <span className="chip chip-warning"><AlertTriangle size={12} /> Review</span>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Unsupported / uncertain edges</div><CardInfo text="Edges you've marked uncertain because the direction is ambiguous or the relationship lacks empirical support. Each represents a plausible alternative causal structure worth reporting in your analysis." /></div>
            {graphEdges.filter((e) => e.type === "uncertain").length === 0 ? (
              <div className="helper"><CheckCircle2 size={13} color="var(--success)" /> Every edge is currently marked as supported.</div>
            ) : (
              graphEdges.filter((e) => e.type === "uncertain").map((e) => (
                <div className="pattern-row" key={e.id}>
                  <span className="mono">{e.from} → {e.to}</span>
                  <span className="chip chip-warning">uncertain — confirm or remove</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ESTIMATOR_OPTIONS = [
  { key: "mixed_logistic", label: "Mixed-effects logistic regression", desc: "A solid default for a binary repeated-measures outcome with a participant-level random intercept." },
  { key: "gee", label: "Generalized estimating equations (GEE)", desc: "Gives population-averaged effects and is robust to a misspecified within-person correlation structure." },
  { key: "msm", label: "Marginal structural model (IPTW)", desc: "Better suited if the exposure varies over time and is itself affected by past outcomes or confounders." },
];
const REPEATED_MEASURES_ITEMS = [
  { id: "randomIntercept", label: "Random intercept for participant" },
  { id: "multipleImputation", label: "Multiple imputation for missing EMA data" },
  { id: "robustSE", label: "Cluster-robust standard errors" },
];

function computeAdjustment(variableRoles) {
  const roles = variableRoles || {};
  const hasFixedBdeRoles = ["acc_mean_magnitude", "binge_drinking_event", "time_of_day", "day_of_week"]
    .some((name) => Object.prototype.hasOwnProperty.call(roles, name));
  const roleEntries = hasFixedBdeRoles
    ? Object.entries(roles).map(([name, role]) => ({ name, role }))
    : ROLE_TABLE_VARIABLES.map((variable) => ({ name: variable.name, role: roles[variable.name] || variable.roleGuess }));
  const namesWithRole = (role) => roleEntries
    .filter((item) => item.role === role)
    .map((item) => item.name);
  return {
    confounders: namesWithRole("Confounder"),
    mediators: namesWithRole("Mediator"),
    proxies: namesWithRole("Proxy"),
  };
}

function StrategyView({ state, actions, onGoNext }) {
  const { questionFields, variableRoles, effectType, estimatorFamily, repeatedMeasuresChecks, sensitivityChecks, feasibility } = state;
  const { setEffectType, setEstimatorFamily, toggleRepeatedMeasures, toggleSensitivity, pushAssistantNote } = actions;

  const { confounders, mediators, proxies } = useMemo(() => computeAdjustment(variableRoles), [variableRoles]);
  const identifiable = confounders.length > 0;
  const adjustmentSet = effectType === "direct" ? [...confounders, ...mediators] : confounders;
  const chosenEstimator = ESTIMATOR_OPTIONS.find((o) => o.key === estimatorFamily) || ESTIMATOR_OPTIONS[0];

  // Bot-guided interaction handlers
  function selectEffectType(type) {
    setEffectType(type);
    if (type === "total") {
      pushAssistantNote("Total effect selected ✓ — mediators are excluded from the adjustment set. Now choose the estimator below.");
    } else {
      pushAssistantNote("Direct effect selected ✓ — mediators enter the adjustment set automatically. Use this only if you need to isolate a specific mechanism.");
    }
    advanceGuidance("analysis-strategy", "effect_type_set", "Effect type set! Next, choose your estimator below. For a binary repeated-measures outcome like this, mixed-effects logistic is usually the right call.");
  }

  function selectEstimator(key) {
    setEstimatorFamily(key);
    const msgs = {
      mixed_logistic: "Mixed-effects logistic selected ✓ — enable the random intercept below (required for within-person data).",
      gee: "GEE selected ✓ — gives population-averaged estimates; robust to misspecified correlation structure. Review repeated-measures options below.",
      msm: "MSM (IPTW) selected ✓ — best for time-varying exposure. Confirm positivity was flagged in sensitivity assumptions.",
    };
    pushAssistantNote(msgs[key] || "Estimator selected ✓ — configure repeated-measures options below.");
    advanceGuidance("analysis-strategy", "estimator_set", "Estimator chosen — great! Now enable the random intercept below (it's required for repeated-measures data), and flag any sensitivity assumptions you want tested before we run the analysis.");
  }

  const rmMsgs = {
    randomIntercept: (checked) => checked
      ? "Random intercept enabled ✓ — required for within-person data; accounts for each participant's baseline."
      : "Random intercept disabled ⚠ — SEs will be too narrow for repeated-measures data. Re-enable before proceeding.",
    multipleImputation: (checked) => checked
      ? "Multiple imputation enabled ✓ — handles missing EMA data under the MAR assumption. Also flag missing data in sensitivity assumptions."
      : "Multiple imputation disabled — complete-case analysis only. Re-enable if key variables have >10% missingness.",
    robustSE: (checked) => checked
      ? "Cluster-robust SEs enabled ✓ — less sensitive to model misspecification for unbalanced panel data."
      : "Cluster-robust SEs disabled — standard SEs will be used. Re-enable if you see heteroskedasticity in diagnostics.",
  };

  function handleRepeatedMeasures(id) {
    const nowChecked = !repeatedMeasuresChecks[id];
    toggleRepeatedMeasures(id);
    const msg = rmMsgs[id]?.(nowChecked);
    if (msg) pushAssistantNote(msg);
    advanceGuidance("analysis-strategy", "rm_configured", "Repeated-measures options configured! One more thing — flag any sensitivity assumptions below (unmeasured confounding and missing data are worth checking for most observational studies). Then you're all set — click Continue to Estimation & Calculation. 🚀");
  }

  const sensMsgs = {
    missingData: (on) => on
      ? "Missing data flagged ✓ — adds an MI vs. complete-case comparison in Estimation. Also enable multiple imputation in the repeated-measures options."
      : "Missing data unflagged — MI comparison removed. Only uncheck if missingness is negligible.",
    positivity: (on) => on
      ? "Positivity flagged ✓ — adds an overlap-weighted robustness check in Estimation. Recommended if Feasibility overlap was below 80%."
      : "Positivity unflagged — overlap-weighted check removed. Only uncheck if overlap was >90% in Feasibility.",
    unmeasuredConf: (on) => on
      ? "Unmeasured confounding flagged ✓ — adds an E-value in Estimation. Recommended for every observational study."
      : "Unmeasured confounding unflagged — E-value will not be calculated. Reviewers will expect this to be addressed.",
    consistency: (on) => on
      ? "SUTVA flagged ✓ — adds a consistency note to the report. Flag if participants could influence each other's exposure."
      : "SUTVA unflagged — removed from the sensitivity plan.",
    exclusionRestriction: (on) => on
      ? "Exclusion restriction flagged ✓ — adds an IV validity check. Only relevant if you're using an instrumental variable."
      : "Exclusion restriction unflagged — removed. Only needed for IV analyses.",
  };

  function handleSensitivity(id) {
    const nowOn = !sensitivityChecks[id];
    toggleSensitivity(id);
    const msg = sensMsgs[id]?.(nowOn);
    if (msg) pushAssistantNote(msg);
  }

  return (
    <>
      <div className="ps-header">
        <h1>Identification & estimation strategy</h1>
        <p>{questionFields?.question ? <>For: <strong style={{ color: "var(--navy)" }}>{questionFields.question}</strong></> : "No research question selected yet."}</p>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Identifiability assessment</div><CardInfo text="Whether the target causal effect can be recovered from data given the current graph and adjustment set. Requires at least one confounder to be marked and adjusted for." /></div>
        <span className={`chip ${identifiable ? "chip-success" : "chip-warning"}`} style={{ fontSize: 12.5, padding: "6px 12px" }}>
          {identifiable ? "Identifiable via backdoor adjustment" : "Not yet identifiable \u2014 no confounders adjusted for"}
        </span>
        <p className="card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
          {identifiable
            ? "Adjusting for the confounder set below is expected to block every backdoor path in your current graph."
            : "Go back to Causal Graph and mark at least one variable as a confounder, or confirm none exists and proceed with that assumption stated explicitly."}
        </p>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Backdoor path analysis</div><CardInfo text="Lists all paths from exposure to outcome that run through common causes (backdoor paths). Every such path must be blocked by the adjustment set for the causal estimate to be unconfounded." /></div>
        {confounders.length === 0 ? (
          <div className="helper"><AlertTriangle size={13} color="var(--warning)" /> No confounders identified in your current graph \u2014 check for unmeasured confounding before trusting this estimate.</div>
        ) : (
          confounders.map((c) => (
            <div className="pattern-row" key={c}>
              <span>exposure <span className="mono">\u2190 {c} \u2192</span> outcome</span>
              <span className="chip chip-success"><CheckCircle2 size={13} /> Blocked by adjustment</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Recommended adjustment set</div><CardInfo text="The minimal set of variables to condition on to block all identified backdoor paths without introducing collider bias. Derived automatically from your variable role assignments in Causal Graph." /></div>
        <div className="filter-pills">
          {adjustmentSet.length ? adjustmentSet.map((v) => <span key={v} className="chip chip-accent mono">{v}</span>) : <span className="helper">None yet \u2014 adjust roles in Causal Graph.</span>}
        </div>
        {mediators.length > 0 && (
          <div className="helper" style={{ marginTop: 10 }}>
            <Info size={13} />
            {effectType === "direct"
              ? <span><span className="mono">{mediators.join(", ")}</span> {mediators.length > 1 ? "are" : "is"} included since you're estimating the direct effect.</span>
              : <span><span className="mono">{mediators.join(", ")}</span> {mediators.length > 1 ? "are" : "is"} excluded from adjustment \u2014 adjusting for a mediator would remove part of the total effect.</span>}
          </div>
        )}
        {proxies.length > 0 && (
          <div className="helper" style={{ marginTop: 6 }}><Info size={13} /> <span className="mono">{proxies.join(", ")}</span> {proxies.length > 1 ? "are" : "is"} a proxy, not a confounder \u2014 left out of adjustment by default.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Effect type</div><CardInfo text="Total effect captures all causal pathways from exposure to outcome, including indirect ones through mediators. Direct effect isolates only the pathway not running through any mediator variable." /></div>
        <p className="card-desc">Choose what causal quantity you want to estimate. Total effect includes all pathways (direct + indirect through mediators). Direct effect isolates the pathway not running through mediators.</p>
        <div className="radio-row">
          <label className="radio-option"><input type="radio" checked={effectType === "total"} onChange={() => selectEffectType("total")} /> Total effect</label>
          <label className="radio-option"><input type="radio" checked={effectType === "direct"} onChange={() => selectEffectType("direct")} /> Direct effect</label>
        </div>
        {effectType === "direct" && mediators.length === 0 && (
          <div className="helper" style={{ marginTop: 8 }}><Info size={13} /> No mediator identified yet — direct and total effect will look identical until one is marked in Causal Graph.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Recommended estimator family</div><CardInfo text="The statistical model family best suited to your data structure, effect type, and feasibility settings. Click a row to select it — your choice is carried into the exported report." /></div>
        <p className="card-desc">Click the model that best fits your data structure. Each row shows the estimator label and when it works best.</p>
        {ESTIMATOR_OPTIONS.map((o) => (
          <div key={o.key} className={`estimator-row ${estimatorFamily === o.key ? "estimator-row-active" : ""}`} onClick={() => selectEstimator(o.key)}>
            <div className="feature-label">{o.label}{estimatorFamily === o.key && <span className="chip chip-success" style={{ marginLeft: 8, fontSize: 10 }}>Selected</span>}</div>
            <div className="feature-desc">{o.desc}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Repeated-measures & missing-data strategy</div><CardInfo text="Options for handling within-person data structure and incomplete observations. Random intercepts account for repeated measures; multiple imputation handles missing data under the Missing At Random assumption." /></div>
        <p className="card-desc">Check all that apply to your data and study design. Each option adjusts how the model handles within-person correlation or incomplete data.</p>
        {REPEATED_MEASURES_ITEMS.map((item) => (
          <div className="feature-row" key={item.id}>
            <label className="feature-checkbox">
              <input type="checkbox" checked={!!repeatedMeasuresChecks[item.id]} onChange={() => handleRepeatedMeasures(item.id)} />
              <div className="feature-label">{item.label}</div>
            </label>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Positivity & overlap checks</div><CardInfo text="Positivity requires that both exposed and unexposed participant-days exist across all covariate strata — a necessary condition for valid causal estimation. The overlap % is carried from your Feasibility settings." /></div>
        <p className="card-desc">Positivity requires that both exposed and unexposed participant-days exist across all covariate strata. The overlap % is carried from your Feasibility settings.</p>
        <div className="metric-bar-row">
          <span className="metric-bar-label">Overlap (from Feasibility)</span>
          <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${feasibility.overlapPct}%`, background: feasibility.overlapPct > 50 ? "var(--success)" : "var(--warning)" }} /></div>
          <span className="metric-bar-value">{feasibility.overlapPct}%</span>
        </div>
        {feasibility.overlapPct <= 50 && (
          <div className="helper" style={{ marginTop: 8 }}>
            <AlertTriangle size={13} color="var(--warning)" /> Overlap is below 50% — positivity may be violated. Consider trimming the analysis sample or using overlap weights. Flag this in the sensitivity plan below.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Robustness & sensitivity plan</div><CardInfo text="Flag each assumption that applies to your study. Checked items generate specific robustness checks in the sensitivity-analysis plan, which is included in the exported PDF report." /></div>
        <p className="card-desc">Flag each assumption that applies to your study. Checked items are included in the sensitivity-analysis plan and exported to the report.</p>
        {SENSITIVITY_ITEMS.map((item) => (
          <div className="feature-row" key={item.id}>
            <label className="feature-checkbox">
              <input type="checkbox" checked={!!sensitivityChecks[item.id]} onChange={() => handleSensitivity(item.id)} />
              <div>
                <div className="feature-label">{item.label}</div>
                <div className="feature-desc">
                  {item.id === "missingData" && "Plan a multiple-imputation vs. complete-case comparison to bracket the impact of missing EMA data."}
                  {item.id === "positivity" && "Assess whether both exposure levels exist across all covariate strata; use overlap weights or trimming if needed."}
                  {item.id === "unmeasuredConf" && "Compute an E-value to quantify the minimum confounding strength needed to explain away the estimated effect."}
                  {item.id === "consistency" && "Confirm there is one well-defined treatment version and no interference between participants (SUTVA)."}
                  {item.id === "exclusionRestriction" && "Relevant if an instrumental variable is used — the IV must affect the outcome only through the exposure."}
                </div>
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Assumption review</div><CardInfo text="The complete set of assumptions the recommended analysis strategy relies on. Any assumption left unchecked should be explicitly discussed as a limitation in the exported report." /></div>
        <p className="card-desc">These are the assumptions the recommended strategy relies on. Adjust in the checklist above; unchecked items should be discussed in the report.</p>
        <div className="filter-pills">
          <span className="chip chip-muted">Consistency (SUTVA)</span>
          <span className="chip chip-muted">Exchangeability given adjustment set</span>
          <span className="chip chip-muted">Positivity / overlap</span>
          <span className="chip chip-muted">Correct outcome model</span>
          <span className="chip chip-muted">No informative missingness beyond MAR</span>
        </div>
        <p className="card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
          <Info size={13} style={{ verticalAlign: "middle" }} /> This step provides analysis <em>guidance</em>. It does not, on its own, establish that a causal effect has been demonstrated.
        </p>
      </div>

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Next:</strong> assemble everything into a reviewable, exportable report.</p>
        <button className="btn btn-primary" onClick={onGoNext}>Review & export <ArrowRight size={14} /></button>
      </div>
    </>
  );
}

function phase7WarningText(warning) {
  if (typeof warning === "string") return warning.trim();
  if (!warning || typeof warning !== "object") return "A Phase 7 warning requires review.";
  if (warning.message) return String(warning.message);
  if (warning.warning) {
    const variable = warning.variable_name || warning.column;
    const missingness = Number.isFinite(Number(warning.missing_percentage))
      ? " (" + Number(warning.missing_percentage).toFixed(1) + "% missing)"
      : "";
    return (variable ? variable + ": " : "") + warning.warning + missingness;
  }
  return "A Phase 7 data-quality note requires review.";
}

function phase7WarningGroups({ errors = [], warnings = [], activeVariables = [] }) {
  const seen = new Set();
  const grouped = { critical: [], design: [], dataQuality: [] };
  const active = activeVariables.filter(Boolean).map((name) => String(name).toLowerCase());

  [...errors.map((item) => ({ item, forceCritical: true })), ...warnings.map((item) => ({ item, forceCritical: false }))]
    .forEach(({ item, forceCritical }) => {
      const text = phase7WarningText(item);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      const raw = typeof item === "object" && item ? item : {};
      const lower = text.toLowerCase();
      const critical = forceCritical || ["blocking", "missing exposure", "missing outcome", "cycle", "collider", "post-treatment", "not identifiable", "cannot run"].some((term) => lower.includes(term));
      const designRelevant = active.some((name) => lower.includes(name)) || ["proxy", "sensor", "adjustment", "overlap", "positivity", "missingness", "no variation"].some((term) => lower.includes(term));
      const entry = { text, suggestedFix: raw.suggested_fix || "" };
      if (critical) grouped.critical.push(entry);
      else if (designRelevant) grouped.design.push(entry);
      else grouped.dataQuality.push(entry);
    });

  const noVariation = grouped.dataQuality.filter((entry) => /constant|no[- ]variation/i.test(entry.text));
  if (noVariation.length > 1) {
    grouped.dataQuality = grouped.dataQuality.filter((entry) => !/constant|no[- ]variation/i.test(entry.text));
    grouped.dataQuality.unshift({ text: noVariation.length + " unused variables have constant/no-variation values. View details for the individual fields." });
  }
  return grouped;
}

function StrategyViewPhase7({ state, actions, onGoNext }) {
  const {
    questionFields,
    graphNodes,
    graphValidationResult,
    targetedFeasibilityResult,
    feasibility,
    analysisStrategyResult,
    analysisStrategyValidation,
    analysisStrategyDraft,
    editableAdjustmentSet,
    analysisStrategyConfirmed,
    analysisStrategyStatus,
    confirmedGraph,
  } = state;
  const {
    handleGenerateAnalysisStrategy,
    handleValidateAnalysisStrategy,
    updateAnalysisDraft,
    setEditableAdjustmentSet,
    confirmAnalysisStrategy,
    runAssistantAction,
  } = actions;
  const [newAdjustmentVar, setNewAdjustmentVar] = useState("");
  const identification = analysisStrategyResult?.identification || {};
  const estimand = analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand || {};
  const strategy = analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy || {};
  const availableVariables = useMemo(() => [...new Set((graphNodes || []).map((n) => n.id).filter(Boolean))], [graphNodes]);
  const exposure = estimand.exposure || graphNodes?.find((n) => (n.role || "").toLowerCase() === "exposure")?.id || "acc_mean_magnitude";
  const outcome = estimand.outcome || graphNodes?.find((n) => (n.role || "").toLowerCase() === "outcome")?.id || "label";
  const graphStatus = graphValidationResult?.status || "not validated";
  const validationStatus = analysisStrategyValidation?.status || "not validated";
  const canRunStrategy = Boolean(confirmedGraph);
  const canConfirm = Boolean(analysisStrategyResult && analysisStrategyValidation && analysisStrategyValidation.status !== "invalid" && graphValidationResult?.status !== "invalid");
  const [showAllDataQuality, setShowAllDataQuality] = useState(false);
  const warningGroups = useMemo(() => phase7WarningGroups({
    errors: analysisStrategyValidation?.errors || [],
    warnings: [
      ...(analysisStrategyResult?.warnings || []),
      ...(analysisStrategyValidation?.warnings || []),
    ],
    activeVariables: [questionFields?.exposure, questionFields?.outcome, ...editableAdjustmentSet],
  }), [analysisStrategyResult, analysisStrategyValidation, questionFields, editableAdjustmentSet]);

  function addAdjustmentVar() {
    if (!newAdjustmentVar || editableAdjustmentSet.includes(newAdjustmentVar)) return;
    actions.beginStudyAction("variable_selection", "adjustment_variable_add", {role:"confounder",variable_count:editableAdjustmentSet.length+1}).success();
    setEditableAdjustmentSet([...editableAdjustmentSet, newAdjustmentVar]);
    setNewAdjustmentVar("");
  }

  function removeAdjustmentVar(variable) {
    actions.beginStudyAction("variable_selection", "adjustment_variable_remove", {role:"confounder",variable_count:Math.max(0,editableAdjustmentSet.length-1)}).success();
    setEditableAdjustmentSet(editableAdjustmentSet.filter((item) => item !== variable));
  }

  return (
    <>
      <div className="ps-header">
        <h1>Identification and analysis strategy</h1>
        <p>{questionFields?.question ? <>For: <strong style={{ color: "var(--navy)" }}>{questionFields.question}</strong></> : "No research question selected yet."}</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Phase 7 backend workflow</div>
            <p className="card-desc">Phase 7 defines the analysis plan. It does not calculate treatment effects. Identification and adjustment-set results require user review.</p>
          </div>
          <span className={`chip ${analysisStrategyConfirmed ? "chip-success" : "chip-warning"}`}>{analysisStrategyConfirmed ? "Confirmed" : "Requires review"}</span>
        </div>
        {state.studyMode && <div className="helper"><Info size={13} /> Prepared draft — editable, not yet confirmed. Association wording only; residual confounding, timing, missing-data, and repeated-measures limitations require review.</div>}
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => handleGenerateAnalysisStrategy("generate")} disabled={!canRunStrategy}><Play size={13} /> Run Identification</button>
          <button className="btn" onClick={() => runAssistantAction("Interpret Identification Results")}><Info size={13} /> Interpret Identification Results</button>
          <button className="btn" onClick={() => runAssistantAction("Explain Adjustment Set")}><Search size={13} /> Explain Adjustment Set</button>
          <button className="btn btn-secondary" onClick={handleValidateAnalysisStrategy} disabled={!canRunStrategy}><CheckCircle2 size={13} /> Validate My Adjustment Set</button>
          <button className="btn" onClick={() => handleGenerateAnalysisStrategy("rerun", "Re-run identification with the current graph and edited strategy.")} disabled={!canRunStrategy}><RefreshCw size={13} /> Re-run Identification</button>
          <button className="btn" onClick={() => handleGenerateAnalysisStrategy("alternative", "Generate an alternative defensible strategy for expert review.")} disabled={!canRunStrategy}><Wand2 size={13} /> Generate Alternative Strategy</button>
          <button className="btn" onClick={() => runAssistantAction("Reprocess Analysis Plan")}><Sparkles size={13} /> Reprocess Analysis Plan</button>
          <button className="btn btn-primary" disabled={!canConfirm} onClick={confirmAnalysisStrategy}><Save size={13} /> Confirm Analysis Strategy</button>
        </div>
        {!canRunStrategy && (
          <div className="status-box status-warning" style={{ marginTop: 10 }}>
            Confirm a graph before running identification.
          </div>
        )}
        {analysisStrategyStatus && <div className={`status-box status-${analysisStrategyStatus.kind}`} style={{ marginTop: 10 }}>{analysisStrategyStatus.message}</div>}
        <div className="helper" style={{ marginTop: 10 }}><ShieldAlert size={13} /> Backend checks support validation, but they do not prove causal validity.</div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Design inputs</div><CardInfo text="Inputs carried from the graph, feasibility check, and confirmed question." /></div>
          <table className="mini-table"><tbody>
            <tr><td>Exposure</td><td className="mono">{exposure}</td></tr>
            <tr><td>Outcome</td><td className="mono">{outcome}</td></tr>
            <tr><td>Comparator</td><td>{estimand.comparator || questionFields?.comparator || "Not specified"}</td></tr>
            <tr><td>Time window</td><td>{estimand.time_window || questionFields?.timeWindow || "Not specified"}</td></tr>
            <tr><td>Graph status</td><td><span className="chip chip-muted">{graphStatus}</span></td></tr>
            <tr><td>Feasibility status</td><td><span className="chip chip-muted">{targetedFeasibilityResult?.status || feasibility?.verdict || "not run"}</span></td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Identification status</div><CardInfo text="Deterministic graph checks and simple adjustment-set heuristics. Full formal identification is not implemented yet." /></div>
          <span className={`chip ${identification.status === "not_identified" ? "chip-danger" : "chip-warning"}`}>{identification.status || "not run"}</span>
          <p className="card-desc" style={{ marginTop: 10 }}>{identification.summary || "Run Identification to inspect paths, candidate adjustment sets, warnings, and assumptions."}</p>
          {analysisStrategyValidation && <div className="helper"><CheckCircle2 size={13} /> Adjustment validation: {validationStatus}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Backdoor paths and candidate adjustment sets</div><CardInfo text="Heuristic paths and sets returned by the backend. Review before using them downstream." /></div>
        {(identification.backdoor_paths || []).length ? (
          (identification.backdoor_paths || []).map((path, idx) => (
            <div className="pattern-row" key={`${Array.isArray(path) ? path.join("-") : path}-${idx}`}><span className="mono">{Array.isArray(path) ? path.join(" ") : String(path)}</span><span className="chip chip-warning">Review</span></div>
          ))
        ) : <div className="helper"><Info size={13} /> No measured backdoor paths were returned, or identification has not run yet.</div>}
        <div className="filter-pills" style={{ marginTop: 12 }}>
          {(identification.candidate_adjustment_sets || []).map((set, idx) => (
            <span key={idx} className="chip chip-muted mono">{Array.isArray(set) && set.length ? set.join(", ") : "empty set"}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Editable adjustment set</div><span className="chip chip-accent">User edited</span></div>
        <div className="filter-pills">
          {editableAdjustmentSet.length ? editableAdjustmentSet.map((variable) => (
            <button key={variable} className="chip chip-accent mono" onClick={() => removeAdjustmentVar(variable)} title="Remove from adjustment set">{variable} x</button>
          )) : <span className="helper">No adjustment variables selected.</span>}
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <select value={newAdjustmentVar} onChange={(e) => setNewAdjustmentVar(e.target.value)}>
            <option value="">Add variable...</option>
            {availableVariables.filter((v) => !editableAdjustmentSet.includes(v)).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <button className="btn" onClick={addAdjustmentVar}>Add</button>
          <button className="btn btn-secondary" onClick={handleValidateAnalysisStrategy}>Validate edited set</button>
        </div>
        {(identification.variables_not_to_adjust_for || []).length > 0 && (
          <div className="helper" style={{ marginTop: 10 }}>
            <AlertTriangle size={13} color="var(--warning)" /> Avoid adjusting for: {(identification.variables_not_to_adjust_for || []).map((item) => `${item.variable} (${item.reason})`).join("; ")}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Estimand</div><CardInfo text="Editable draft of the target causal quantity. This is a plan, not an estimate." /></div>
          <label className="field-label">Label</label>
          <input value={estimand.label || ""} onChange={(e) => updateAnalysisDraft("estimand", "label", e.target.value)} />
          <label className="field-label">Effect type</label>
          <select value={estimand.effect_type || "total_effect"} onChange={(e) => updateAnalysisDraft("estimand", "effect_type", e.target.value)}>
            <option value="total_effect">Total effect</option>
            <option value="direct_effect">Direct effect</option>
            <option value="controlled_direct_effect">Controlled direct effect</option>
            <option value="unknown">Unknown</option>
          </select>
          <label className="field-label">Unit of analysis</label>
          <input value={estimand.unit_of_analysis || ""} onChange={(e) => updateAnalysisDraft("estimand", "unit_of_analysis", e.target.value)} />
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Estimator recommendation</div><CardInfo text="Editable statistical-model family and repeated-measures strategy for Phase 8." /></div>
          <label className="field-label">Estimator family</label>
          <input value={strategy.estimator_family || ""} onChange={(e) => updateAnalysisDraft("strategy", "estimator_family", e.target.value)} />
          <label className="field-label">Repeated-measures strategy</label>
          <textarea rows={3} value={strategy.repeated_measures_strategy || ""} onChange={(e) => updateAnalysisDraft("strategy", "repeated_measures_strategy", e.target.value)} />
          <label className="field-label">Missing-data strategy</label>
          <textarea rows={3} value={strategy.missing_data_strategy || ""} onChange={(e) => updateAnalysisDraft("strategy", "missing_data_strategy", e.target.value)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Sensitivity and robustness plan</div><CardInfo text="Planned checks for Phase 8 and final reporting. These are not effect estimates." /></div>
          <h4>Sensitivity plan</h4>
          <textarea
            rows={6}
            value={(strategy.sensitivity_plan || []).join("\n")}
            onChange={(e) => updateAnalysisDraft("strategy", "sensitivity_plan", e.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
          />
          <h4>Robustness checks</h4>
          <ul className="compact-list">{(strategy.robustness_checks || []).map((item, idx) => <li key={idx}>{item}</li>)}</ul>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Assumption checklist</div><CardInfo text="Each item requires user review before estimation and reporting." /></div>
          {(analysisStrategyResult?.assumption_checklist || []).length ? (
            (analysisStrategyResult.assumption_checklist || []).map((item) => (
              <div className="pattern-row" key={item.assumption}>
                <span>{item.assumption}<br /><small>{item.rationale}</small></span>
                <span className={`chip ${item.status === "supported" ? "chip-success" : "chip-warning"}`}>{item.status}</span>
              </div>
            ))
          ) : <div className="helper">Run Identification to generate the assumption checklist.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Warnings and next actions</div><CardInfo text="Warnings carry forward to Phase 8 and Review. They are not hidden by confirmation." /></div>
        {warningGroups.critical.length > 0 && <><strong>Critical / blocking warnings</strong>{warningGroups.critical.map((warning, idx) => <div key={`critical-${idx}`} className="status-box status-error">{warning.text}{warning.suggestedFix && <div className="helper">Suggested action: {warning.suggestedFix}</div>}</div>)}</>}
        {warningGroups.design.length > 0 && <><strong>Design-relevant warnings</strong>{warningGroups.design.map((warning, idx) => <div key={`design-${idx}`} className="helper"><AlertTriangle size={13} color="var(--warning)" /> {warning.text}{warning.suggestedFix && ` Suggested action: ${warning.suggestedFix}`}</div>)}</>}
        {warningGroups.dataQuality.length > 0 && <>
          <strong>General data-quality notes</strong>
          {warningGroups.dataQuality.slice(0, showAllDataQuality ? undefined : 3).map((warning, idx) => <div key={`quality-${idx}`} className="helper"><Info size={13} /> {warning.text}</div>)}
          {warningGroups.dataQuality.length > 3 && <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAllDataQuality((value) => !value)}>{showAllDataQuality ? "Hide data-quality details" : `View all data-quality details (${warningGroups.dataQuality.length})`}</button>}
        </>}
        {warningGroups.critical.length + warningGroups.design.length + warningGroups.dataQuality.length === 0 && <div className="helper"><CheckCircle2 size={13} color="var(--success)" /> No Phase 7 warnings were returned.</div>}
        <ul className="compact-list">{(analysisStrategyResult?.recommended_next_actions || []).map((item, idx) => <li key={idx}>{item}</li>)}</ul>
      </div>

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Next:</strong> Phase 8 can run only after this plan is reviewed and validated. No numerical effects are produced in Phase 7.</p>
        <button className="btn btn-primary" disabled={!canConfirm} onClick={onGoNext}>Estimation & calculation <ArrowRight size={14} /></button>
        {!canConfirm && <span className="helper"><AlertTriangle size={13} /> Run identification, validate the adjustment set, and confirm the analysis strategy before continuing to Estimation.</span>}
      </div>
    </>
  );
}

function buildGraphSVG(graphNodes, graphEdges, variableRoles) {
  const COLORS = { Exposure: "#2F5D8A", Outcome: "#B8382B", Confounder: "#A6650E", Mediator: "#6B4A9E", Proxy: "#8A93A3", Unassigned: "#8A93A3" };
  const getRole = (id) => {
    if (variableRoles[id]) return variableRoles[id];
    return ROLE_TABLE_VARIABLES.find((v) => v.name === id)?.roleGuess || "Unassigned";
  };
  const pad = 46;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const edgesSVG = graphEdges.map((edge) => {
    const from = graphNodes.find((n) => n.id === edge.from);
    const to   = graphNodes.find((n) => n.id === edge.to);
    if (!from || !to) return "";
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const x1 = from.x + (dx / len) * pad, y1 = from.y + (dy / len) * pad;
    const x2 = to.x   - (dx / len) * pad, y2 = to.y   - (dy / len) * pad;
    const uncertain = edge.type === "uncertain";
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    const edgeLabel = uncertain ? "uncertain" : "supported";
    const labelColor = uncertain ? "#A6650E" : "#1A7A4A";
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return `
    <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
      stroke="${uncertain ? "#C49030" : "#8A93A3"}"
      stroke-width="${uncertain ? 2 : 1.8}"
      stroke-dasharray="${uncertain ? "7,5" : "none"}"
      marker-end="${uncertain ? "url(#arrow-unc)" : "url(#arrow-sup)"}" />
    <text x="${midX.toFixed(1)}" y="${(midY - 7).toFixed(1)}" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="${labelColor}" opacity="0.85"
      transform="rotate(${(Math.abs(angle) > 90 ? angle + 180 : angle).toFixed(1)},${midX.toFixed(1)},${midY.toFixed(1)})">${edgeLabel}</text>`;
  }).join("\n");

  const nodesSVG = graphNodes.map((node) => {
    const role  = getRole(node.id);
    const color = COLORS[role] || COLORS.Unassigned;
    const lbl   = node.label.length > 17 ? node.label.slice(0, 16) + "…" : node.label;
    // shadow ring
    return `
    <g transform="translate(${node.x},${node.y})">
      <circle r="46" fill="#fff" stroke="${color}" stroke-width="2.5" filter="url(#shadow)" />
      <circle r="5"  fill="${color}" cy="-6" />
      <text text-anchor="middle" y="13" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#16233D">${esc(lbl)}</text>
      <text text-anchor="middle" y="28" font-family="sans-serif" font-size="9.5"  font-weight="500" fill="${color}">${esc(role)}</text>
    </g>`;
  }).join("\n");

  const legendRoles = [...new Set(graphNodes.map((n) => getRole(n.id)))].filter((r) => r !== "Unassigned");
  const legendItems = [...legendRoles, "uncertain edge"];
  const legendX0 = 20, legendY = 500;
  const legendSVG = legendItems.map((item, i) => {
    const x = legendX0 + i * 130;
    const isEdge = item === "uncertain edge";
    const color = isEdge ? "#C49030" : (COLORS[item] || "#8A93A3");
    const dotEl = isEdge
      ? `<line x1="${x}" y1="${legendY}" x2="${x + 20}" y2="${legendY}" stroke="${color}" stroke-width="2" stroke-dasharray="5,3"/>`
      : `<circle cx="${x + 6}" cy="${legendY}" r="6" fill="${color}" opacity="0.9"/>`;
    return `${dotEl}<text x="${x + (isEdge ? 25 : 16)}" y="${legendY + 4}" font-family="sans-serif" font-size="10" fill="#444">${esc(item)}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520" width="860" height="494"
    style="display:block;max-width:100%;border:1px solid #DDE3EC;border-radius:8px;background:#FAFBFC">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#00000018"/>
    </filter>
    <marker id="arrow-sup" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto">
      <path d="M0,0 L9,4 L0,8 Z" fill="#8A93A3"/>
    </marker>
    <marker id="arrow-unc" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto">
      <path d="M0,0 L9,4 L0,8 Z" fill="#C49030"/>
    </marker>
  </defs>
  <rect width="900" height="520" fill="#FAFBFC" rx="8"/>
  ${edgesSVG}
  ${nodesSVG}
  ${legendSVG}
</svg>`;
}

function buildReportHTML(state) {
  const { questionFields, variableRoles, feasibility, graphEdges, effectType, estimatorFamily, repeatedMeasuresChecks, sensitivityChecks, papers, guidelines, objective, primaryEstimationRun } = state;
  const { confounders, mediators, proxies } = computeAdjustment(variableRoles);
  const estimator = ESTIMATOR_OPTIONS.find((o) => o.key === estimatorFamily) || ESTIMATOR_OPTIONS[0];
  const adjustmentSet = effectType === "direct" ? [...confounders, ...mediators] : confounders;
  const uncertainEdges = graphEdges.filter((e) => e.type === "uncertain");
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const verdictColor = feasibility.verdict === "Feasible" ? "#1A7A4A" : feasibility.verdict === "Marginal" ? "#B8760E" : "#B8382B";
  const roleBg = { Exposure: "#EBF2FA", Outcome: "#FAEAEA", Confounder: "#FEF3E2", Mediator: "#F0EBF8", Proxy: "#EEF0F4", Unassigned: "#EEF0F4" };
  const roleClr = { Exposure: "#2F5D8A", Outcome: "#B8382B", Confounder: "#A6650E", Mediator: "#6B4A9E", Proxy: "#555", Unassigned: "#555" };
  const tag = (label, role) => `<span style="display:inline-block;padding:2px 9px;border-radius:4px;font-size:9pt;font-weight:700;background:${roleBg[role]||"#EEF0F4"};color:${roleClr[role]||"#555"}">${label}</span>`;
  const code = (v) => `<code style="font-family:monospace;background:#EEF0F4;padding:1px 5px;border-radius:3px;font-size:9.5pt">${v}</code>`;
  const fieldRow = (label, value) => value ? `<tr><td style="color:#555;font-size:10pt;padding:4px 0;width:175px;vertical-align:top">${label}</td><td style="font-size:11pt;padding:4px 0">${value}</td></tr>` : "";
  const run = primaryEstimationRun;
  const runWarnings = estimationRunWarnings(run);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Causal Design, Estimation, and Evidence Report</title>
<style>
*{box-sizing:border-box}body{font-family:Georgia,serif;font-size:12pt;color:#1a1a2e;margin:0;padding:0}
.page{max-width:760px;margin:0 auto;padding:48px 44px}
h1{font-size:21pt;color:#16233D;margin:0 0 4px;padding-bottom:12px;border-bottom:2.5px solid #2F5D8A}
.subtitle{font-size:10pt;color:#666;margin:0 0 28px}
h2{font-size:13pt;font-weight:700;color:#2F5D8A;margin:30px 0 8px;padding-bottom:4px;border-bottom:1px solid #CFE0EE;page-break-after:avoid}
h3{font-size:11pt;color:#16233D;margin:12px 0 4px}
p{font-size:11pt;line-height:1.6;margin:6px 0}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10pt}
th{background:#F0F4F8;text-align:left;padding:6px 10px;font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:1.5px solid #CFE0EE}
td{padding:5px 10px;border-bottom:1px solid #F0F1F4;vertical-align:top}
.stat-row{display:flex;gap:12px;margin:10px 0;flex-wrap:wrap}
.stat{border:1px solid #CFE0EE;border-radius:6px;padding:8px 16px;background:#F7FBFF;min-width:130px}
.stat-l{font-size:9pt;color:#666;margin-bottom:2px}
.stat-v{font-size:16pt;font-weight:700}
.q-block{background:#F7FBFF;border-left:4px solid #2F5D8A;padding:12px 16px;border-radius:0 6px 6px 0;margin:8px 0}
.q-text{font-size:13pt;font-style:italic;color:#16233D;line-height:1.55;margin:0 0 10px}
.edge-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F0F1F4;font-size:10.5pt}
.edge-row:last-child{border-bottom:none}
.ts{background:#E8F5EE;color:#1A7A4A;padding:2px 8px;border-radius:4px;font-size:9pt;font-weight:600}
.tu{background:#FEF3E2;color:#A6650E;padding:2px 8px;border-radius:4px;font-size:9pt;font-weight:600}
.box-blue{background:#EFF7FF;border:1px solid #CFE0EE;border-radius:6px;padding:12px 16px;margin:8px 0}
.box-warn{background:#FFF9F0;border:1px solid #F0D9AE;border-radius:6px;padding:12px 16px;margin:8px 0}
.box-green{background:#EDF7F2;border:1px solid #B0DEC5;border-radius:6px;padding:12px 16px;margin:8px 0}
ul{margin:6px 0;padding-left:20px}li{margin-bottom:4px;font-size:10.5pt;line-height:1.55}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #CFE0EE;font-size:9pt;color:#888;line-height:1.5}
@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.page-break{page-break-before:always}h2{page-break-before:auto}table{page-break-inside:avoid}}
</style></head><body><div class="page">

<h1>Causal Design, Estimation, and Evidence Report</h1>
<p class="subtitle">Generated by Causal Studio &nbsp;·&nbsp; ${date}${objective ? ` &nbsp;·&nbsp; <em>${objective.slice(0, 90)}${objective.length > 90 ? "…" : ""}</em>` : ""}</p>

<h2>1. Final Research Question</h2>
<div class="q-block">
  <p class="q-text">${questionFields?.question || "<em>Not yet defined.</em>"}</p>
  ${questionFields ? `<table style="margin-top:6px">${fieldRow("Population", questionFields.population)}${fieldRow("Exposure", questionFields.exposure)}${fieldRow("Comparator", questionFields.comparator)}${fieldRow("Outcome", questionFields.outcome)}${fieldRow("Time window", questionFields.timeWindow)}${fieldRow("Unit of analysis", questionFields.unitOfAnalysis)}${fieldRow("Target estimand", questionFields.estimand)}</table>` : ""}
</div>

<h2>2. Data Feasibility Summary</h2>
<div class="stat-row">
  <div class="stat"><div class="stat-l">Base participant-days</div><div class="stat-v">${feasibility.baseRows.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-l">Analysis-ready sample</div><div class="stat-v">${feasibility.finalSample.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-l">Overlap (positivity)</div><div class="stat-v">${feasibility.overlapPct}%</div></div>
  <div class="stat"><div class="stat-l">Feasibility verdict</div><div class="stat-v" style="color:${verdictColor}">${feasibility.verdict}</div></div>
</div>
<p style="font-size:10.5pt;color:#555;margin-top:6px">Dataset spans approximately ${feasibility.participants} participants observed over ~${feasibility.days} days. ${feasibility.retainedPct}% of participant-days were retained after lag and missingness filters.</p>

<h2 class="page-break">3. Variable-Role Table</h2>
<table><thead><tr><th>Variable</th><th>Source</th><th>Final Role</th></tr></thead><tbody>
${ROLE_TABLE_VARIABLES.map((v) => { const role = variableRoles[v.name] || v.roleGuess; return `<tr><td>${code(v.name)}</td><td>${v.source}</td><td>${tag(role, role)}</td></tr>`; }).join("")}
</tbody></table>

<h2>4. Final Causal Graph</h2>
${graphEdges.length === 0 ? '<p style="color:#888">No causal graph constructed yet.</p>' : `<div style="margin-top:4px">${graphEdges.map((e) => `<div class="edge-row">${code(e.from)} &nbsp;→&nbsp; ${code(e.to)}<span class="${e.type === "supported" ? "ts" : "tu"}">${e.type}</span></div>`).join("")}</div>`}

<h2>5. Alternative or Uncertain Graphs</h2>
${uncertainEdges.length === 0
  ? '<div class="box-green"><p style="margin:0;color:#1A7A4A">✓ No uncertain edges — every edge in the final graph is marked as supported.</p></div>'
  : `<p style="font-size:10.5pt">The following edges were left uncertain. Each represents a plausible alternative causal structure that should be reported alongside the primary analysis.</p><div style="margin-top:4px">${uncertainEdges.map((e) => `<div class="edge-row">${code(e.from)} &nbsp;→&nbsp; ${code(e.to)}<span class="tu">alternative / uncertain</span></div>`).join("")}</div><div class="box-warn" style="margin-top:10px"><p style="margin:0;font-size:10.5pt">For each uncertain edge, consider reporting a sensitivity analysis in which the edge is reversed or removed, to assess how conclusions change under that alternative structure.</p></div>`}

<h2>6. Adjustment Set</h2>
<p style="font-size:10.5pt"><strong>Effect type:</strong> ${effectType === "direct" ? "Direct effect — mediators included in adjustment" : "Total effect — mediators excluded from adjustment to preserve the full causal pathway"}</p>
<p style="font-size:10.5pt"><strong>Adjustment set:</strong> ${adjustmentSet.length ? adjustmentSet.map(code).join(", ") : "None identified."}</p>
${mediators.length > 0 ? `<p style="font-size:10.5pt"><strong>Mediators:</strong> ${mediators.map(code).join(", ")} — ${effectType === "direct" ? "included in adjustment for direct-effect estimation." : "excluded to preserve the total effect."}</p>` : ""}
${proxies.length > 0 ? `<p style="font-size:10.5pt"><strong>Proxies:</strong> ${proxies.map(code).join(", ")} — excluded from adjustment by default.</p>` : ""}

<h2>7. Identification Assessment</h2>
<div class="${confounders.length > 0 ? "box-green" : "box-warn"}">
  <p style="margin:0;font-weight:700;font-size:11pt">${confounders.length > 0 ? "✓ Identifiable via backdoor adjustment" : "⚠ Not yet identifiable — no confounders marked"}</p>
  <p style="margin:6px 0 0;font-size:10.5pt">${confounders.length > 0 ? `Conditioning on ${adjustmentSet.map(code).join(", ")} is expected to block every backdoor path between ${code(questionFields?.exposure || "exposure")} and ${code(questionFields?.outcome || "outcome")} in the current graph.` : "Return to Causal Graph and mark at least one variable as a Confounder, or explicitly state that no measured confounders exist and document the assumption."}</p>
</div>

<h2 class="page-break">8. Recommended Analysis Strategy</h2>
<div class="box-blue">
  <p style="margin:0 0 4px;font-weight:700">${estimator.label}</p>
  <p style="margin:0;font-size:10.5pt;color:#333">${estimator.desc}</p>
</div>
${Object.entries(repeatedMeasuresChecks).filter(([, v]) => v).length > 0 ? `<h3>Repeated-measures &amp; missing-data options selected</h3><ul>${Object.entries(repeatedMeasuresChecks).filter(([, v]) => v).map(([k]) => { const item = REPEATED_MEASURES_ITEMS.find((i) => i.id === k); return item ? `<li>${item.label}</li>` : ""; }).join("")}</ul>` : ""}

<h2>9. Selected Primary Estimation Run</h2>
${run ? `
<div class="stat-row">
  <div class="stat"><div class="stat-l">Run ID</div><div class="stat-v" style="font-size:10pt">${run.id}</div></div>
  <div class="stat"><div class="stat-l">Point estimate</div><div class="stat-v">${run.results?.pointEstimate ?? "N/A"}</div></div>
  <div class="stat"><div class="stat-l">SE</div><div class="stat-v">${run.results?.se ?? "N/A"}</div></div>
  <div class="stat"><div class="stat-l">95% CI</div><div class="stat-v" style="font-size:12pt">[${run.results?.ciLower ?? "?"}, ${run.results?.ciUpper ?? "?"}]</div></div>
  <div class="stat"><div class="stat-l">N</div><div class="stat-v">${Number(run.results?.n || 0).toLocaleString()}</div></div>
</div>
<table><tbody>
  ${fieldRow("Estimator", run.config?.estimator)}
  ${fieldRow("Estimand", run.results?.estimandLabel || run.config?.estimand)}
  ${fieldRow("Exposure", run.config?.exposure)}
  ${fieldRow("Outcome", run.config?.outcome)}
  ${fieldRow("Adjustment set", run.config?.adjustmentSet)}
  ${fieldRow("Rows before filtering", run.results?.diagnostics?.rows_before_filtering)}
  ${fieldRow("Rows after filtering", run.results?.diagnostics?.rows_after_filtering)}
  ${fieldRow("Excluded rows", run.results?.diagnostics?.excluded_rows)}
  ${fieldRow("Convergence", run.results?.convergence || run.results?.diagnostics?.convergence)}
  ${fieldRow("Random seed", run.config?.seed)}
</tbody></table>
${runWarnings.length ? `<div class="box-warn"><h3>Run warnings</h3><ul>${runWarnings.map((w) => `<li>${w}</li>`).join("")}</ul></div>` : `<div class="box-green"><p style="margin:0;color:#1A7A4A">No Phase 8 warnings reported.</p></div>`}
<div class="box-blue"><p style="margin:0;font-size:10.5pt">These values are backend-computed Phase 8 outputs under the selected model and assumptions. They do not prove causality by themselves.</p></div>
` : `<div class="box-warn"><p style="margin:0">No primary estimation run has been selected. Return to Phase 8 to run estimation and select a primary run. Export is incomplete until this is done.</p></div>`}

<h2>10. Assumption Checklist</h2>
<table><thead><tr><th>Assumption</th><th>Status</th></tr></thead><tbody>
${SENSITIVITY_ITEMS.map((item) => `<tr><td>${item.label}</td><td>${sensitivityChecks[item.id] ? '<span style="color:#1A7A4A;font-weight:700">✓ Flagged for analysis</span>' : '<span style="color:#999">— Not flagged</span>'}</td></tr>`).join("")}
</tbody></table>
<div class="box-blue" style="margin-top:10px"><p style="margin:0;font-size:10pt">Core assumptions this strategy relies on: Consistency (SUTVA), Exchangeability given adjustment set, Positivity / overlap, Correct outcome model specification, No informative missingness beyond MAR.</p></div>

<h2>11. Sensitivity-Analysis Plan</h2>
<ul>
  <li>Refit the primary model without each confounder in turn to assess adjustment stability.</li>
  <li>Compute an E-value for unmeasured confounding on the primary point estimate.</li>
  <li>Sensitivity to alternative lag windows and exposure thresholds (from Feasibility page).</li>
  <li>Compare estimator families (${ESTIMATOR_OPTIONS.map((o) => o.label.split(" ")[0]).join(", ")}) as a robustness check.</li>
  <li>Rerun with multiple imputation vs. complete-case analysis to bracket missing-data impact.</li>
  ${uncertainEdges.length > 0 ? "<li>Rerun analysis with each uncertain edge reversed or removed to quantify graph-structure sensitivity.</li>" : ""}
  ${sensitivityChecks.positivity ? "<li>Assess positivity violations at covariate extremes using overlap weights or trimming.</li>" : ""}
</ul>

<h2>12. Supporting Evidence</h2>
${papers.length === 0 && guidelines.length === 0
  ? '<p style="color:#888;font-size:10.5pt">No supporting evidence uploaded in Project Setup.</p>'
  : `${papers.length > 0 ? `<h3>Research papers</h3><ul>${papers.map((p) => `<li>${p.title || p.name || "Evidence metadata unavailable."}${p.year ? ` (${p.year})` : ""}${p.authors ? ` — ${p.authors}` : ""}</li>`).join("")}</ul>` : ""}${guidelines.length > 0 ? `<h3>Clinical guidelines / domain guidance</h3><ul>${guidelines.map((g) => `<li>${g.name || "Evidence metadata unavailable."}${g.sourceType ? ` — ${g.sourceType}` : ""}</li>`).join("")}</ul>` : ""}`}

<h2>13. Limitations</h2>
<div class="box-warn"><ul style="margin:0">
  <li>Findings reflect an observational analysis — unmeasured confounding cannot be ruled out without further validation.</li>
  <li>Self-reported measures (EMA) are subject to recall and reporting bias.</li>
  <li>The observation window (~${feasibility.days} days) may not capture longer-term patterns or delayed treatment effects.</li>
  ${sensitivityChecks.missingData ? "<li>Missing data is handled under the Missing At Random (MAR) assumption — results may differ if data are Missing Not At Random (MNAR).</li>" : ""}
  ${sensitivityChecks.unmeasuredConf ? "<li>Potential unmeasured confounders are flagged; an E-value analysis is planned to quantify the minimum confounding strength that would explain away the estimated effect.</li>" : ""}
  ${sensitivityChecks.positivity ? "<li>Positivity may be limited at the margins of the covariate space — IPW-based estimates should be interpreted with caution in those regions.</li>" : ""}
</ul></div>

<h2>14. What Can and Cannot Be Claimed</h2>
<div class="box-blue">
  <p style="margin:0 0 8px;font-size:11pt;line-height:1.65"><strong>Can claim:</strong> This analysis supports a statement of association consistent with a causal interpretation of the ${effectType === "direct" ? "direct" : "total"} effect of ${code(questionFields?.exposure || "the exposure")} on ${code(questionFields?.outcome || "the outcome")} in the study population, conditional on the stated assumptions holding — specifically, that the adjustment set ${code(adjustmentSet.join(", ") || "∅")} adequately blocks all measured backdoor paths and no important unmeasured confounders remain.</p>
  <p style="margin:0;font-size:11pt;line-height:1.65"><strong>Cannot claim:</strong> This analysis alone cannot prove causation, cannot be generalized beyond the stated population without additional untested assumptions, and should not be used to make individual clinical decisions without further prospective validation.</p>
</div>

<div class="footer">
  <strong>Causal Design Agent</strong> - Causal Design, Estimation, and Evidence Report &nbsp;·&nbsp; Generated ${date}<br>
  This report provides analysis guidance based on researcher-specified assumptions and uploaded data. It does not constitute clinical advice and does not independently verify that the stated assumptions hold in the data.
</div>
</div></body></html>`;
}

function buildPackageReportHTML(report) {
  const escape = (value) => String(value ?? "Not available.").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const sections = Array.isArray(report?.sections) ? report.sections : [];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(report?.package_title || "Causal Design, Estimation, and Evidence Report")}</title><style>body{font-family:Georgia,serif;color:#16233D;margin:42px;line-height:1.5}h1{border-bottom:2px solid #2F5D8A;padding-bottom:10px}h2{color:#2F5D8A;margin-top:28px;white-space:pre-wrap}table{border-collapse:collapse;width:100%;font-size:10pt;overflow-wrap:anywhere}th,td{border:1px solid #ccd3dc;padding:7px;text-align:left;vertical-align:top}th{background:#edf2f7}thead{display:table-header-group}tr{break-inside:avoid} .warning{background:#fff8e8;border-left:4px solid #b8760e;padding:10px 14px;margin:10px 0}</style></head><body><h1>${escape(report?.package_title || "Causal Design, Estimation, and Evidence Report")}</h1><p>${escape(report?.executive_summary || "This package supports review and reporting. It does not prove causality.")}</p>${sections.map((section) => `<h2>${escape(section?.title || "Report section")}</h2>${renderReportContent(section?.content ?? "Not yet specified")}${Array.isArray(section?.warnings) && section.warnings.length ? `<div class="warning"><strong>Warnings</strong><ul>${section.warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul></div>` : ""}`).join("")}</body></html>`;
}

function downloadPDFReport(state, report) {
  const html = Array.isArray(report?.sections) ? buildPackageReportHTML(report) : buildReportHTML(state);
  const w = window.open("", "_blank", "width=960,height=800,scrollbars=yes");
  if (!w) { alert("Pop-up blocked — please allow pop-ups for this page and try again."); return false; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 700);
  return true;
}

function backendEstimationToRun(response, tag, fallbackConfig = {}) {
  const estimate = response.estimate || response.primary_result || {};
  const diagnostics = response.diagnostics || {};
  const sensitivity = response.sensitivity || {};
  const reproducibility = response.reproducibility || {};
  const ci = estimate.confidence_interval || [null, null];
  const warnings = [
    ...(response.warnings || []),
    ...(response.readiness?.warnings || []),
    ...(diagnostics.model_warnings || []),
    ...(diagnostics.data_warnings || []),
    ...(sensitivity.warnings || []),
  ].filter(Boolean).filter((warning, index, array) => array.indexOf(warning) === index);
  return {
    id: response.run_id,
    tag,
    timestamp: reproducibility.timestamp || new Date().toLocaleString(),
    raw: response,
    config: {
      question: fallbackConfig.question || "",
      estimand: estimate.estimand || fallbackConfig.estimand || "ATE",
      exposure: estimate.exposure || fallbackConfig.exposure || "",
      comparator: fallbackConfig.comparator || "one-unit lower vs one-unit higher",
      outcome: estimate.outcome || fallbackConfig.outcome || "",
      timeWindow: fallbackConfig.timeWindow || "",
      adjustmentSet: fallbackConfig.adjustmentSet || (reproducibility.variables_used || []).filter((v) => v !== estimate.exposure && v !== estimate.outcome).join(", ") || "(none)",
      effectType: fallbackConfig.effectType || "ATE",
      estimator: estimate.estimator || reproducibility.estimator || fallbackConfig.estimator || "statsmodels",
      library: "statsmodels backend computation",
      randomIntercept: fallbackConfig.randomIntercept || "Clustered SE when participant ID is available",
      multipleImputation: "No - complete-case proof of concept",
      robustSE: "Cluster/robust SE when available",
      missingDataHandling: "Complete-case filtering",
      sampleSize: estimate.sample_size || diagnostics.rows_after_filtering || 0,
      exclusions: `${diagnostics.excluded_rows ?? 0} rows (${diagnostics.excluded_percent ?? 0}%)`,
      personTime: "Not calculated in proof of concept",
      seed: reproducibility.random_seed ?? 42,
      softwareVersion: `Python ${reproducibility.python_version || ""}`.trim(),
      packages: Object.entries(reproducibility.package_versions || {}).map(([name, version]) => `${name}==${version}`),
    },
    results: {
      pointEstimate: estimate.point_estimate,
      se: estimate.standard_error,
      ciLower: ci[0],
      ciUpper: ci[1],
      pValue: estimate.p_value,
      n: estimate.sample_size || diagnostics.rows_after_filtering || 0,
      convergence: diagnostics.convergence || "not_applicable",
      warnings,
      balanceDiagnostics: [],
      sensitivityResults: (sensitivity.checks || []).map((check, index) => ({ label: `Check ${index + 1}`, value: "planned/review", desc: check })),
      estimandLabel: estimate.estimand || "ATE",
      comparatorDef: fallbackConfig.comparator || "one-unit change",
      diagnostics,
      sensitivity,
      interpretationBoundary: estimate.interpretation_boundary || response.safe_interpretation_note,
    },
  };
}

function EstimationView({ state, actions, onGoNext }) {
  const { questionFields, feasibility, targetedFeasibilityResult, effectType, estimatorFamily, repeatedMeasuresChecks, sensitivityChecks, variableRoles, lagHours, datasets, backendStatus, confirmedGraph, graphValidationResult, analysisStrategyResult, analysisStrategyDraft, editableAdjustmentSet, analysisStrategyValidation, analysisStrategyConfirmed, studyMode } = state;
  const { pushAssistantNote, showToast, setLatestEstimationRun, setPrimaryEstimationRun, runAssistantAction, recordStudyEvent, advanceGuidance, goToPage } = actions;

  const { confounders, mediators } = useMemo(() => computeAdjustment(variableRoles), [variableRoles]);
  const adjustmentSet = effectType === "direct" ? [...confounders, ...mediators] : confounders;
  const chosenEstimator = ESTIMATOR_OPTIONS.find((o) => o.key === estimatorFamily) || ESTIMATOR_OPTIONS[0];
  const estimationDataset = firstRealDataset(datasets);
  const estimationColumns = estimationDataset?.schema?.column_names || [];
  const estimationExposure = estimationColumns.includes("acc_mean_magnitude") ? "acc_mean_magnitude" : questionFields?.exposure || "";
  const estimationOutcome = studyMode?.dataset?.derived_outcome?.column && estimationColumns.includes(studyMode.dataset.derived_outcome.column)
    ? studyMode.dataset.derived_outcome.column
    : estimationColumns.includes("label") ? "label" : questionFields?.outcome || "";
  const estimationAdjustment = ["time_of_day", "day_of_week"].filter((name) => estimationColumns.includes(name));
  const readinessItems = [
    { label: "Backend connected", ok: backendStatus.connected },
    { label: "Dataset uploaded", ok: Boolean(estimationDataset?.savedFilename) },
    { label: `Exposure available (${estimationExposure || "not selected"})`, ok: Boolean(estimationExposure && estimationColumns.includes(estimationExposure)) },
    { label: `Outcome available (${estimationOutcome || "not selected"})`, ok: Boolean(estimationOutcome && estimationColumns.includes(estimationOutcome)) },
    { label: "Graph confirmed", ok: Boolean(confirmedGraph), warning: true },
    { label: "Identification confirmed", ok: Boolean(graphValidationResult?.safe_to_continue), warning: true },
    { label: "Assumptions reviewed", ok: Object.values(sensitivityChecks).some(Boolean), warning: true },
  ];

  const [configOpen, setConfigOpen] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runs, setRuns] = useState([]);
  const [primaryRunId, setPrimaryRunId] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [activeRunId, setActiveRunId] = useState(null);
  const [interpretVersions, setInterpretVersions] = useState([]);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [interpretLockedIdx, setInterpretLockedIdx] = useState(null);
  const [estimationValidation, setEstimationValidation] = useState(null);
  const [estimationStatus, setEstimationStatus] = useState(null);

  const activeRun = runs.find((r) => r.id === activeRunId) || runs[runs.length - 1] || null;
  const compareRuns = compareIds.length >= 2 ? runs.filter((r) => compareIds.includes(r.id)) : [];
  const phase7Estimand = analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand || {};
  const phase7Strategy = analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy || {};
  const phase7Adjustment = editableAdjustmentSet?.length ? editableAdjustmentSet : estimationAdjustment.length ? estimationAdjustment : adjustmentSet.filter((name) => estimationColumns.includes(name));
  const canValidateEstimation = Boolean(
    backendStatus.connected
    && estimationDataset?.savedFilename
    && (analysisStrategyConfirmed || analysisStrategyValidation?.safe_to_continue_to_estimation)
  );
  const canRunEstimation = Boolean(
    canValidateEstimation
    && (!estimationValidation || estimationValidation.safe_to_run_estimation !== false)
  );
  const plannedCalculationMessage = "This feature is planned for a later implementation. The current proof of concept only supports the primary backend calculation.";

  function explainPlannedCalculation() {
    showToast(plannedCalculationMessage);
    pushAssistantNote(plannedCalculationMessage);
  }

  function buildEstimationPayload(tag = "Primary") {
    const dataset = firstRealDataset(datasets);
    const exposure = estimationExposure || phase7Estimand.exposure || dataset?.schema?.possible_numeric_columns?.[0] || "";
    const outcome = estimationOutcome || phase7Estimand.outcome || dataset?.schema?.column_names?.find((name) => name !== exposure) || "";
    return {
      dataset_filename: dataset?.savedFilename || "",
      confirmed_question: questionFields?.question || "Among adults in the uploaded EMA/passive sensing dataset, what is the association between accelerometer magnitude and label under the specified model?",
      estimand: {
        label: phase7Estimand.label || (effectType === "direct" ? "Direct effect guidance" : "Total effect guidance"),
        effect_type: phase7Estimand.effect_type || (effectType === "direct" ? "direct_effect" : "total_effect"),
        population: phase7Estimand.population || "uploaded study population",
        exposure,
        comparator: phase7Estimand.comparator || "one-unit change",
        outcome,
        time_window: phase7Estimand.time_window || `${Math.max(1, Math.round(lagHours / 24))}d lag`,
        unit_of_analysis: phase7Estimand.unit_of_analysis || "participant-window observation",
      },
      exposure,
      comparator: { type: "continuous_unit_change", reference: "one-unit lower", treatment: "one-unit higher" },
      outcome,
      adjustment_set: phase7Adjustment.filter((name) => estimationColumns.includes(name)),
      strategy: {
        estimator_family: tag === "Exploratory" ? "linear_regression" : "logistic_regression",
        repeated_measures_strategy: phase7Strategy.repeated_measures_strategy || "not_implemented_poc",
        missing_data_strategy: "complete_case",
        sensitivity_plan: phase7Strategy.sensitivity_plan || [],
        robustness_checks: phase7Strategy.robustness_checks || [],
      },
      participant_id: estimationDataset?.participantField || "pid",
      timestamp: estimationDataset?.timestampFields?.[0] || "time_stamp",
      preprocessing: { drop_missing: true, standardize_exposure: false },
      time_window: { exposure_window: "8h", lag: `${Math.max(1, Math.round(lagHours / 24))}d`, outcome_window: "24h" },
      run_label: `${tag} run`,
      random_seed: 42,
      identification_confirmed: Boolean(analysisStrategyConfirmed || analysisStrategyValidation?.safe_to_continue_to_estimation),
      graph_confirmed: Boolean(confirmedGraph),
      assumptions_reviewed: Object.values(sensitivityChecks).some(Boolean),
      allow_unconfirmed_analysis: true,
    };
  }

  async function validateConfig() {
    const studyTrace = actions.beginStudyAction("estimation_action", "estimation_validation", {});
    try {
    const payload = buildEstimationPayload();
    if (!backendStatus.connected) {
      setEstimationStatus({ kind: "error", message: "Backend unavailable - validation needs FastAPI." });
      return;
    }
    if (!payload.dataset_filename) {
      setEstimationStatus({ kind: "error", message: "Upload and parse a CSV or Excel dataset before validation." });
      return;
    }
    setEstimationStatus({ kind: "loading", message: "Validating estimation configuration..." });
    try {
      const response = await validateEstimationConfig({
        dataset_filename: payload.dataset_filename,
        exposure: payload.exposure,
        outcome: payload.outcome,
        adjustment_set: payload.adjustment_set,
        strategy: payload.strategy,
        participant_id: payload.participant_id,
        timestamp: payload.timestamp,
      });
      studyTrace.capture(response);
      setEstimationValidation(response);
      recordStudyEvent?.("estimation_validated", { status: response.status || "unknown" });
      setEstimationStatus({ kind: response.status === "invalid" ? "error" : "success", message: `Configuration ${response.status}.` });
      pushAssistantNote(response.safe_to_run_estimation
        ? "Phase 8 configuration validation completed. Python will compute all numerical results; I will only interpret returned values."
        : "Phase 8 configuration is not runnable yet. Review the blocking issues before running estimation.");
    } catch (error) {
      studyTrace.fail();
      setEstimationStatus({ kind: "error", message: friendlyError(error, "Config validation failed.") });
      pushAssistantNote(`Estimation config validation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function runEstimation(tag = "Primary") {
    const studyTrace = actions.beginStudyAction("estimation_action", "estimation_run", {});
    try {
    if (isRunning) return;
    const dataset = firstRealDataset(datasets);
    if (!backendStatus.connected) {
      pushAssistantNote("Backend unavailable - Phase 8 numerical estimation must run in Python. Start FastAPI and try again.");
      showToast("Backend unavailable - estimation needs FastAPI.");
      return;
    }
    if (!dataset?.savedFilename) {
      pushAssistantNote("Upload and parse a CSV or Excel dataset before running Phase 8 estimation.");
      showToast("Upload a dataset first.");
      return;
    }
    if (!analysisStrategyConfirmed && !analysisStrategyValidation?.safe_to_continue_to_estimation) {
      setEstimationStatus({ kind: "error", message: "Confirm an analysis strategy before running estimation." });
      pushAssistantNote("Confirm an analysis strategy before running estimation. Phase 8 uses the Phase 7 plan and does not create its own causal design.");
      return;
    }

    setIsRunning(true);
    setEstimationStatus({ kind: "loading", message: "Running backend estimation…" });
    setRunProgress(0);
    setInterpretVersions([]);
    setInterpretLockedIdx(null);
    pushAssistantNote("Phase 8 is running in Python now. The backend will calculate the estimate, uncertainty, diagnostics, and warnings; I can interpret the computed output afterward, but I do not generate numerical results.");
    const backendRunInterval = setInterval(() => setRunProgress((p) => Math.min(p + 18, 90)), 380);
    const payload = buildEstimationPayload(tag);
    const fallbackConfig = {
      question: payload.confirmed_question,
      estimand: payload.estimand?.label || payload.estimand?.effect_type || "Specified estimand",
      exposure: payload.exposure,
      comparator: `${payload.comparator.reference} vs ${payload.comparator.treatment}`,
      outcome: payload.outcome,
      timeWindow: `${payload.time_window.exposure_window} exposure, ${payload.time_window.lag} lag, ${payload.time_window.outcome_window} outcome`,
      adjustmentSet: payload.adjustment_set.join(", ") || "(none)",
      effectType: payload.estimand?.effect_type || "specified",
      estimator: "statsmodels",
      randomIntercept: payload.strategy?.repeated_measures_strategy || "not_implemented_poc",
    };
    try {
      const response = await runBackendEstimation(payload);
      studyTrace.capture(response);
      recordStudyEvent?.("estimation_run", { status: response.status || "unknown" });
      clearInterval(backendRunInterval);
      setRunProgress(100);
      if (response.status === "blocked_not_ready" || response.status === "not_runnable") {
        setEstimationStatus({
          kind: "error",
          message: "This estimation configuration is not runnable yet. Review the blocking issues below.",
        });
        setEstimationValidation({
          status: "invalid",
          errors: response.readiness?.blocking_issues || response.diagnostics?.model_warnings || ["Estimation is not runnable."],
          warnings: response.warnings || response.readiness?.warnings || [],
          checks: response.readiness?.checks || {},
          safe_to_run_estimation: false,
        });
        pushAssistantNote(`Estimation was blocked by readiness checks: ${response.readiness?.blocking_issues?.join("; ") || "not ready"}`);
        showToast("Estimation blocked by readiness checks.");
        return;
      }
      const newRun = backendEstimationToRun(response, tag, fallbackConfig);
      setRuns((prev) => [...prev, newRun]);
      setActiveRunId(newRun.id);
      setLatestEstimationRun(newRun);
      if (response.status === "completed_with_warnings") {
        setEstimationStatus({
          kind: "warning",
          message: "Estimation completed with warnings. Review diagnostics before selecting this as the primary run.",
        });
      } else {
        setEstimationStatus({ kind: "success", message: "Estimation completed. Review diagnostics before selecting a primary run." });
      }
      if (newRun.results.warnings.length) {
        pushAssistantNote(`Python estimation complete with ${newRun.results.warnings.length} warning(s). Point estimate ${newRun.results.pointEstimate} (95% CI: ${newRun.results.ciLower}, ${newRun.results.ciUpper}), SE ${newRun.results.se}, p=${newRun.results.pValue}, N=${Number(newRun.results.n || 0).toLocaleString()}. This is computed under the specified model and assumptions; it does not prove causality by itself.`);
        advanceGuidance("estimation", "run_complete", "Results are in - review warnings before selecting a primary result. Use Interpret Current Estimate for a plain-language explanation of the computed output.");
      } else {
        pushAssistantNote(`Python estimation complete. Point estimate ${newRun.results.pointEstimate} (95% CI: ${newRun.results.ciLower}, ${newRun.results.ciUpper}), SE ${newRun.results.se}, p=${newRun.results.pValue}, N=${Number(newRun.results.n || 0).toLocaleString()}. This is computed output only; it does not prove causality by itself.`);
        advanceGuidance("estimation", "run_complete", "Clean run - no warnings. Use Interpret Current Estimate for a plain-language explanation of the computed output.");
      }
    } catch (error) {
      studyTrace.fail();
      clearInterval(backendRunInterval);
      pushAssistantNote(`Estimation failed: ${friendlyError(error)} Try checking the selected exposure, outcome, adjustment variables, and whether Logit needs a linear fallback.`);
      showToast("Estimation failed.");
    } finally {
      setIsRunning(false);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function interpretEstimate() {
    if (!activeRun || interpretLoading) return;
    setInterpretLoading(true);
    try {
      const text = await runAssistantAction("Interpret Current Estimate")
        || "No computed estimate was provided to interpret. Run Phase 8 estimation first.";
      setInterpretVersions(prev => [...prev, text]);
      advanceGuidance("estimation", "interpreted", "Interpretation done. Now review diagnostics and sensitivity notes before selecting a primary run.");
    } catch (error) {
      pushAssistantNote(`Interpretation failed: ${friendlyError(error)} The numerical output remains valid as backend-computed output; only the interpretation step failed.`);
    } finally {
      setInterpretLoading(false);
    }
  }
  async function interpretDiagnostics() {
    if (!activeRun) return;
    await runAssistantAction("Explain Diagnostics");
  }
  function exportRunLog() {
    const studyTrace = actions.beginStudyAction("report_export", "run_log_export", {});
    try {
    const lines = runs.map((r, i) =>
      [
        `--- Run ${i + 1} ---`,
        `ID: ${r.id}`,
        `Timestamp: ${r.timestamp}`,
        `Tag: ${r.tag}`,
        `Estimator: ${r.config.estimator}`,
        `Library: ${r.config.library}`,
        `Point estimate: ${r.results.pointEstimate}`,
        `SE: ${r.results.se}`,
        `95% CI: [${r.results.ciLower}, ${r.results.ciUpper}]`,
        `N: ${r.results.n}`,
        `Convergence: ${r.results.convergence}`,
        `Warnings: ${r.results.warnings.length === 0 ? "None" : r.results.warnings.join("; ")}`,
        `Packages: ${r.config.packages.join(", ")}`,
        `Seed: ${r.config.seed}`,
        `Software: ${r.config.softwareVersion}`,
        `Primary: ${primaryRunId === r.id ? "Yes" : "No"}`,
      ].join("\n")
    ).join("\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "estimation_run_log.txt"; a.click();
    URL.revokeObjectURL(url);
    showToast("Run log exported.");

    studyTrace.downloadInitiated();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function selectPrimaryRun(run) {
    const studyTrace = actions.beginStudyAction("estimation_action", "primary_run_selection", {});
    try {
    setPrimaryRunId(run.id);
    setPrimaryEstimationRun(run);
    recordStudyEvent?.("primary_estimation_selected", { run_id: run.id });
    if (backendStatus.connected) {
      try {
        const response = await selectPrimaryEstimationRun({ run_id: run.id });
      studyTrace.capture(response);
        if (response.status !== "success") {
          pushAssistantNote(response.message || "Primary run was selected locally, but backend selection did not complete.");
        }
      } catch (error) {
      studyTrace.fail();
        pushAssistantNote(`Primary run selected locally, but backend selection failed: ${friendlyError(error)}`);
      }
    }
    pushAssistantNote(`Run selected as the primary result. Confirm and Continue is now enabled. This selection does not prove causality; it marks the computed run for review/export.`);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  return (
    <>
      <div className="ps-header">
        <h1>Estimation &amp; calculation</h1>
        <p>Run your pre-specified analysis, review results and diagnostics, and confirm a primary result before continuing to Review &amp; Export.</p>
        <span className="note"><ShieldAlert size={12} /> Proof-of-concept calculation support only: backend results help review the design, but they do not prove a causal effect or support clinical decisions.</span>
      </div>

      {/* ── Section 1: Pre-Run Config Summary ── */}
      {studyMode?.dataset?.derived_outcome && <div className="status-box status-warning"><strong>Backend-derived binary outcome from approved label field.</strong> {studyMode.dataset.derived_outcome.rule}. This transparent fixed-task calculation is used only for the Phase 8 model; it does not establish causality.</div>}

      <div className="card">
        <div className="card-head">
          <div className="card-title">Pre-run configuration summary</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CardInfo text="Read-only recap of all choices made in previous steps. This is exactly what the backend will use when you click Run Estimation." />
            <button className="btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setConfigOpen((o) => !o)}>
              {configOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {configOpen ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        {configOpen && (
          <table className="mini-table" style={{ marginTop: 6 }}>
            <tbody>
              <tr><td style={{ color: "#5B6472", width: 190 }}>Research question</td><td>{questionFields?.question || <span className="helper">Not set \u2014 go back to Question &amp; Variables.</span>}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Estimand</td><td>{phase7Estimand.label || (effectType === "direct" ? "Average Direct Effect (ADE)" : "Average Treatment Effect (ATE)")}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Exposure</td><td className="mono">{estimationExposure || phase7Estimand.exposure || questionFields?.exposure || "not selected"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Comparator</td><td>{phase7Estimand.comparator || questionFields?.comparator || "One-unit exposure contrast"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Outcome</td><td className="mono">{estimationOutcome || phase7Estimand.outcome || questionFields?.outcome || "not selected"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Time window</td><td>{phase7Estimand.time_window || `${lagHours}h lag`}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Adjustment set</td><td className="mono">{phase7Adjustment.length ? phase7Adjustment.join(", ") : "(none identified)"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Excluded vars</td><td className="mono">{mediators.length && effectType !== "direct" ? `${mediators.join(", ")} (mediator \u2014 excluded from adjustment)` : "\u2014"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Estimator</td><td>{chosenEstimator.label}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Library / function</td><td className="mono">statsmodels OLS/Logit with robust or clustered standard errors</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Repeated-measures strategy</td><td>{phase7Strategy.repeated_measures_strategy || "Clustered standard errors when participant ID is available"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Missing-data handling</td><td>{phase7Strategy.missing_data_strategy || "Complete-case analysis only in this proof of concept"}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Analysis sample</td><td>{targetedFeasibilityResult?.analysis_ready_sample_check?.complete_case_rows_for_exposure_outcome_and_selected ?? targetedFeasibilityResult?.analysis_ready_sample_check?.complete_case_rows_for_selected_variables ?? "Not computed — run Python feasibility checks."}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Exclusions</td><td>{targetedFeasibilityResult?.analysis_ready_sample_check ? "See the Python feasibility result for filtering and exclusions." : "Not computed — run Python feasibility checks."}</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Person-time</td><td>Not calculated until a backend computation provides it.</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Random seed</td><td className="mono">42</td></tr>
              <tr><td style={{ color: "#5B6472" }}>Software version</td><td className="mono">Python backend / statsmodels / pandas / numpy / scipy</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Readiness check</div>
          <CardInfo text="Phase 8 is cautious by default. Missing graph, identification, or assumption confirmation is shown as a warning; backend estimation can still run only because this proof of concept sends allow_unconfirmed_analysis=true." />
        </div>
        <div className="filter-pills">
          {readinessItems.map((item) => (
            <span key={item.label} className={`chip ${item.ok ? "chip-success" : item.warning ? "chip-warning" : "chip-danger"}`}>
              {item.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {item.label}
            </span>
          ))}
        </div>
        <p className="card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
          Required variables for the safe demo run: exposure <span className="mono">{estimationExposure || "not selected"}</span>, outcome <span className="mono">{estimationOutcome || "not selected"}</span>, adjustment set <span className="mono">{phase7Adjustment.join(", ") || "(none)"}</span>. Numerical results are calculated by Python/backend, not by the LLM.
        </p>
        {estimationValidation && (
          <div style={{ marginTop: 10 }}>
            <span className={`chip ${estimationValidation.status === "invalid" ? "chip-danger" : "chip-warning"}`}>Backend config: {estimationValidation.status}</span>
            {(estimationValidation.errors || []).map((error, idx) => <div key={`err-${idx}`} className="status-box status-error" style={{ marginTop: 8 }}>{error}</div>)}
            {(estimationValidation.warnings || []).map((warning, idx) => <div key={`warn-${idx}`} className="helper" style={{ marginTop: 6 }}><AlertTriangle size={13} color="var(--warning)" /> {warning}</div>)}
          </div>
        )}
        {!canValidateEstimation && (
          <div className="status-box status-warning" style={{ marginTop: 10 }}>
            Confirm an analysis strategy before running estimation.
          </div>
        )}
      </div>

      {/* ── Section 2: Backend Execution ── */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Backend execution</div>
          <CardInfo text="Triggers the estimation pipeline. All numeric computation happens in backend Python/statsmodels. The AI assistant only interprets results; it never generates estimates." />
        </div>
        <p className="card-desc">Validate the configuration first, then run estimation. These estimates are conditional on the selected design, model, assumptions, and data limitations. This phase does not prove causality.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={validateConfig} disabled={!canValidateEstimation || isRunning} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CheckCircle2 size={13} /> Validate Estimation Config
          </button>
          <button className="btn btn-primary" onClick={() => runEstimation("Primary")} disabled={!canRunEstimation || isRunning} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Play size={13} /> {isRunning ? "Running backend estimation…" : runs.length === 0 ? "Run Estimation" : "Re-run with Updated Settings"}
          </button>
          {runs.length > 0 && !isRunning && (
            <>
              <button className="btn" onClick={explainPlannedCalculation} disabled={!canRunEstimation} style={{ display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={12} /> Try Alternative Estimator</button>
              <button className="btn" onClick={explainPlannedCalculation} disabled={!canRunEstimation} style={{ display: "flex", alignItems: "center", gap: 6 }}><ShieldAlert size={12} /> Run Sensitivity Analysis</button>
            </>
          )}
        </div>
        {estimationStatus && <div className={`status-box status-${estimationStatus.kind}`} style={{ marginTop: 10 }}>{estimationStatus.message}</div>}
        {isRunning && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5B6472", marginBottom: 4 }}>
              <span>Fitting {chosenEstimator.label}\u2026</span><span>{Math.min(runProgress, 99)}%</span>
            </div>
            <div className="metric-bar-track">
              <div className="metric-bar-fill" style={{ width: `${Math.min(runProgress, 99)}%`, transition: "width 0.35s ease", background: "var(--accent)" }} />
            </div>
            <div style={{ fontSize: 11, color: "#5B6472", marginTop: 6 }}>Computing adjustment weights, fitting model, running convergence checks\u2026</div>
          </div>
        )}
      </div>

      {/* ── Section 3: Results Display ── */}
      {activeRun && !isRunning && (
        <>
          <div className="card">
            <div className="card-head">
              <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Results
                {activeRun.tag === "Primary" && <span className="chip chip-success" style={{ fontSize: 11 }}>Primary</span>}
                {activeRun.tag === "Exploratory" && <span className="chip chip-accent" style={{ fontSize: 11 }}>Exploratory</span>}
                {activeRun.tag === "Robustness" && <span className="chip chip-muted" style={{ fontSize: 11 }}>Robustness</span>}
              </div>
              <CardInfo text="Point estimate and inferential statistics from the fitted model. All values are computed by the backend — the AI interprets but does not generate them." />
            </div>
            <div className="mini-stat-row">
              <div className="mini-stat">
                <span className="mini-stat-label">{activeRun.results.estimandLabel}</span>
                <span className="mini-stat-value" style={{ fontSize: 22, color: "var(--navy)" }}>{activeRun.results.pointEstimate}</span>
              </div>
              <div className="mini-stat"><span className="mini-stat-label">SE</span><span className="mini-stat-value">{activeRun.results.se}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">95% CI</span><span className="mini-stat-value">[{activeRun.results.ciLower}, {activeRun.results.ciUpper}]</span></div>
              <div className="mini-stat"><span className="mini-stat-label">p-value</span><span className="mini-stat-value">{activeRun.results.pValue ?? "—"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">N</span><span className="mini-stat-value">{activeRun.results.n.toLocaleString()}</span></div>
            </div>
            <div className="helper" style={{ marginTop: 8 }}>
              <Info size={13} /> Comparator definition: <em>{activeRun.results.comparatorDef}</em>. {activeRun.results.interpretationBoundary}
            </div>
          </div>

          {activeRun.results.balanceDiagnostics.length > 0 && (
            <div className="card">
              <div className="card-head"><div className="card-title">Covariate balance / overlap diagnostics</div><CardInfo text="Standardized mean differences (SMD) before and after adjustment for each confounder. SMD < 0.10 indicates adequate balance." /></div>
              <table className="mini-table">
                <thead><tr><th>Variable</th><th>SMD before</th><th>SMD after</th><th>Balanced?</th></tr></thead>
                <tbody>
                  {activeRun.results.balanceDiagnostics.map((d) => (
                    <tr key={d.variable}>
                      <td className="mono">{d.variable}</td>
                      <td style={{ color: d.smdBefore > 0.1 ? "var(--warning)" : "inherit" }}>{d.smdBefore}</td>
                      <td style={{ color: d.smdAfter <= 0.1 ? "var(--success)" : "var(--warning)" }}>{d.smdAfter}</td>
                      <td><span className={`chip ${d.smdAfter <= 0.1 ? "chip-success" : "chip-warning"}`}>{d.smdAfter <= 0.1 ? "\u2713 Yes" : "Review"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="metric-bar-row" style={{ marginTop: 12 }}>
                <span className="metric-bar-label">Overlap (propensity)</span>
                <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${feasibility.overlapPct}%`, background: feasibility.overlapPct > 50 ? "var(--success)" : "var(--warning)" }} /></div>
                <span className="metric-bar-value">{feasibility.overlapPct}%</span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><div className="card-title">Model / weighting diagnostics</div><CardInfo text="Convergence status and computation warnings from the estimation run. Address any warnings before marking a run as primary." /></div>
            <div className="pattern-row">
              <span>Convergence</span>
              <span className="chip chip-success"><CheckCircle2 size={12} /> {activeRun.results.convergence}</span>
            </div>
            <div className="pattern-row"><span>Rows before filtering</span><span className="mono">{activeRun.results.diagnostics?.rows_before_filtering ?? "—"}</span></div>
            <div className="pattern-row"><span>Rows after filtering</span><span className="mono">{activeRun.results.diagnostics?.rows_after_filtering ?? "—"}</span></div>
            <div className="pattern-row"><span>Excluded rows</span><span className="mono">{activeRun.results.diagnostics?.excluded_rows ?? "—"} ({activeRun.results.diagnostics?.excluded_percent ?? "—"}%)</span></div>
            <div className="pattern-row">
              <span>Exposure variation</span>
              <span className="mono">
                mean {activeRun.results.diagnostics?.exposure_variation?.mean ?? "—"} · std {activeRun.results.diagnostics?.exposure_variation?.std ?? "—"} · unique {activeRun.results.diagnostics?.exposure_variation?.unique_values ?? "—"}
              </span>
            </div>
            {activeRun.results.warnings.length > 0 ? (
              activeRun.results.warnings.map((w, i) => (
                <div key={i} style={{ marginTop: 8, background: "#FFF8E7", borderRadius: 6, padding: "8px 10px", display: "flex", gap: 6, fontSize: 13 }}>
                  <AlertTriangle size={13} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} /> <span>{w}</span>
                </div>
              ))
            ) : (
              <div className="helper" style={{ marginTop: 8 }}><CheckCircle2 size={13} color="var(--success)" /> No convergence or computation warnings.</div>
            )}
          </div>

          {activeRun.results.sensitivityResults.length > 0 && (
            <div className="card">
              <div className="card-head"><div className="card-title">Sensitivity &amp; refutation results</div><CardInfo text="Results from pre-specified sensitivity analyses derived from your flagged assumptions. These assess how robust the primary estimate is to violations." /></div>
              {activeRun.results.sensitivityResults.map((s, i) => (
                <div className="pattern-row" key={i}>
                  <span>
                    <strong>{s.label}</strong>
                    <br /><span style={{ fontSize: 11, color: "#5B6472" }}>{s.desc}</span>
                  </span>
                  <span className="chip chip-muted mono">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Section 4: Interpretation & Rerun Controls ── */}
      {activeRun && !isRunning && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Interpretation &amp; rerun controls</div>
            <CardInfo text="LLM-assisted interpretation reads the structured result output and explains magnitude, uncertainty, and assumption status. It does not generate new numeric values or make causal claims beyond what the data support." />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: interpretVersions.length > 0 ? 12 : 0 }}>
            <button className="btn btn-primary" onClick={interpretEstimate} disabled={interpretLoading} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={13} /> {interpretLoading ? "Interpreting\u2026" : (interpretVersions.length > 0 ? "Re-interpret" : "Interpret Current Estimate")}
            </button>
            <button className="btn" onClick={() => runAssistantAction("Explain Diagnostics")} style={{ display: "flex", alignItems: "center", gap: 6 }}><Info size={13} /> Explain Diagnostics</button>
            {activeRun.results.warnings.length > 0 && (
              <button className="btn" onClick={() => runAssistantAction("Explain This Warning")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} /> Explain This Warning
              </button>
            )}
          </div>
          {interpretVersions.length > 0 && (
            <RegenerateBlock
              externalVersions={interpretVersions}
              renderVariant={(text) => (
                <div className="inconsistency-card" style={{ background: "var(--accent-soft)", borderColor: "#CFE0EE", whiteSpace: "pre-line" }}>
                  <p style={{ color: "var(--navy)", margin: 0, lineHeight: 1.65 }}>{text}</p>
                </div>
              )}
              onRegenerate={interpretEstimate}
              onLock={(val) => actions.lockContent("interpretation", val)}
              onUnlock={() => actions.unlockContent("interpretation")}
            />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, borderTop: "1px solid #EDEFF3", paddingTop: 10 }}>
            <button className="btn" onClick={() => runEstimation("Primary")} disabled={!canRunEstimation || isRunning} style={{ display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={12} /> Re-run with Updated Settings</button>
            <button className="btn" onClick={explainPlannedCalculation} disabled={!canRunEstimation || isRunning} style={{ display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={12} /> Try Alternative Estimator</button>
            <button className="btn" onClick={explainPlannedCalculation} disabled={!canRunEstimation || isRunning} style={{ display: "flex", alignItems: "center", gap: 6 }}><ShieldAlert size={12} /> Run Sensitivity Analysis</button>
            <button className="btn" onClick={() => { goToPage("strategy"); showToast("Returned to Analysis Strategy. Update and confirm the plan before re-running estimation."); }} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowRight size={12} /> Return to Strategy
            </button>
          </div>
        </div>
      )}

      {/* ── Section 5: Reproducibility Panel ── */}
      {runs.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Reproducibility panel</div>
            <CardInfo text="Immutable log of every estimation run — config snapshot, results, package versions, timestamp, and warnings. Each entry is never overwritten. Select a primary result to enable Confirm and Continue." />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {runs.length >= 2 && (
              <button className="btn" onClick={() => setCompareIds((c) => c.length >= 2 ? [] : runs.slice(-2).map((r) => r.id))} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Eye size={12} /> {compareIds.length >= 2 ? "Close Compare" : "Compare Runs"}
              </button>
            )}
            <button className="btn" onClick={exportRunLog} style={{ display: "flex", alignItems: "center", gap: 6 }}><Save size={12} /> Export Run Log</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {runs.map((run, idx) => (
              <div
                key={run.id}
                className={`estimator-row ${activeRunId === run.id ? "estimator-row-active" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => { setActiveRunId(run.id); setInterpretVersions([]); setInterpretLockedIdx(null); }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                  <div>
                    <span className="feature-label">Run {idx + 1}</span>
                    {run.tag === "Primary" && <span className="chip chip-success" style={{ fontSize: 10, marginLeft: 6 }}>Primary</span>}
                    {run.tag === "Exploratory" && <span className="chip chip-accent" style={{ fontSize: 10, marginLeft: 6 }}>Exploratory</span>}
                    {run.tag === "Robustness" && <span className="chip chip-muted" style={{ fontSize: 10, marginLeft: 6 }}>Robustness</span>}
                    {primaryRunId === run.id && <span className="chip chip-success" style={{ fontSize: 10, marginLeft: 6 }}>\u2605 Primary result</span>}
                    <span style={{ fontSize: 11, color: "#5B6472", marginLeft: 8 }}>{run.timestamp}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 12 }}>Est: {run.results.pointEstimate} [{run.results.ciLower}, {run.results.ciUpper}]</span>
                    {primaryRunId !== run.id && (
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px" }} onClick={(e) => { e.stopPropagation(); selectPrimaryRun(run); }}>
                        Select as Primary
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#5B6472", marginTop: 4 }}>
                  {run.config.estimator} \u00b7 N={run.results.n.toLocaleString()} \u00b7 {run.config.softwareVersion} \u00b7 Seed: {run.config.seed}
                  {run.results.warnings.length > 0 && <span style={{ color: "var(--warning)", marginLeft: 8 }}>\u26a0 {run.results.warnings.length} warning(s)</span>}
                </div>
              </div>
            ))}
          </div>

          {compareIds.length >= 2 && compareRuns.length >= 2 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              {compareRuns.map((run) => (
                <div key={run.id} style={{ background: "#F7F9FC", borderRadius: 8, padding: 12, border: "1px solid #EDEFF3" }}>
                  <div className="feature-label" style={{ marginBottom: 8 }}>Run {runs.indexOf(run) + 1} \u2014 {run.tag}</div>
                  <table className="mini-table">
                    <tbody>
                      <tr><td style={{ color: "#5B6472" }}>Estimator</td><td>{run.config.estimator}</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>Point estimate</td><td className="mono">{run.results.pointEstimate}</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>SE</td><td className="mono">{run.results.se}</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>95% CI</td><td className="mono">[{run.results.ciLower}, {run.results.ciUpper}]</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>N</td><td className="mono">{run.results.n.toLocaleString()}</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>Warnings</td><td>{run.results.warnings.length === 0 ? <span style={{ color: "var(--success)" }}>None</span> : <span style={{ color: "var(--warning)" }}>{run.results.warnings.length}</span>}</td></tr>
                      <tr><td style={{ color: "#5B6472" }}>Packages</td><td style={{ fontSize: 11 }}>{run.config.packages.slice(0, 2).join(", ")}</td></tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, borderTop: "1px solid #EDEFF3", paddingTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={!primaryRunId}
              onClick={onGoNext}
              style={{ display: "flex", alignItems: "center", gap: 6, opacity: primaryRunId ? 1 : 0.45, cursor: primaryRunId ? "pointer" : "not-allowed" }}
            >
              Confirm and Continue <ArrowRight size={13} />
            </button>
            {!primaryRunId && (
              <span className="helper" style={{ margin: 0 }}>
                <Lock size={12} /> Select a primary result above to enable this.
              </span>
            )}
          </div>
        </div>
      )}

      {runs.length === 0 && (
        <div className="inconsistency-card" style={{ marginTop: 4 }}>
          <p style={{ margin: 0 }}>No estimation run has been executed yet. Validate the configuration before running estimation.</p>
        </div>
      )}
    </>
  );
}

function estimationRunWarnings(run) {
  if (!run) return [];
  return [
    ...(run.results?.warnings || []),
    ...(run.results?.diagnostics?.model_warnings || []),
    ...(run.results?.diagnostics?.data_warnings || []),
    ...(run.raw?.readiness?.warnings || []),
  ].filter(Boolean);
}

function reportPayloadFromState(state, claimAudit = null) {
  const { questionFields, variableRoles, feasibility, graphEdges, graphNodes, effectType, estimatorFamily, repeatedMeasuresChecks, sensitivityChecks, datasets, broadExploration, graphValidationResult, confirmedGraph, primaryEstimationRun, papers, guidelines, objective, ragSummary } = state;
  const dataset = firstRealDataset(datasets) || datasets?.[0] || {};
  const schema = dataset.schema || {};
  const { confounders, mediators, proxies } = computeAdjustment(variableRoles);
  const adjustmentSet = effectType === "direct" ? [...confounders, ...mediators] : confounders;
  const estimator = ESTIMATOR_OPTIONS.find((o) => o.key === estimatorFamily) || ESTIMATOR_OPTIONS[0];
  const selectedVariables = ROLE_TABLE_VARIABLES.map((v) => v.name);
  const roleRecommendations = ROLE_TABLE_VARIABLES.map((v) => ({
    variable_name: v.name,
    primary_role: variableRoles[v.name] || v.roleGuess,
    recommended_roles: [variableRoles[v.name] || v.roleGuess],
    temporal_role: v.name.includes("time") || v.name.includes("day") ? "temporal/context" : "requires review",
    adjustment_recommendation: adjustmentSet.includes(v.name) ? "include in adjustment set" : "do not adjust by default",
    confidence: "frontend_review",
    rationale: v.meaning || v.source,
  }));

  return {
    project_title: "Causal Design, Estimation, and Evidence Report",
    research_objective: objective || questionFields?.question || "",
    confirmed_question: questionFields?.question || "Research question requires confirmation.",
    dataset_filename: realDatasetFilename(dataset) || dataset.name || "demo_dataset.csv",
    schema_summary: {
      filename: realDatasetFilename(dataset) || dataset.name,
      number_of_rows: schema.number_of_rows || dataset.rows,
      number_of_columns: schema.number_of_columns || dataset.cols,
      possible_id_columns: schema.possible_id_columns || (dataset.participantField ? [dataset.participantField] : []),
      possible_timestamp_date_columns: schema.possible_timestamp_date_columns || dataset.timestampFields || [],
      warnings: schema.warnings || [],
    },
    broad_exploration_summary: broadExploration || {},
    candidate_questions: questionFields ? [questionFields.question] : [],
    selected_candidate_question: questionFields,
    candidate_variables: ROLE_TABLE_VARIABLES,
    targeted_feasibility_result: feasibility,
    selected_variables: selectedVariables,
    role_recommendations: roleRecommendations,
    role_validation_result: { status: "frontend_reviewed", note: "Variable roles require human confirmation." },
    graph: {
      graph_type: "DAG",
      nodes: (confirmedGraph?.nodes || graphNodes || []).map((node) => ({ id: node.id, label: node.label, role: node.role || variableRoles[node.id] })),
      edges: (confirmedGraph?.edges || graphEdges || []).map((edge) => ({ source: edge.from, target: edge.to, type: edge.type })),
      graph_rationale: "Final reviewed graph from Phase 6.",
    },
    graph_validation_result: graphValidationResult || confirmedGraph?.validation || {},
    identification_result: {
      identification_status: adjustmentSet.length ? "reviewed_with_adjustment_set" : "needs_review",
      exposure: questionFields?.exposure,
      outcome: questionFields?.outcome,
      proposed_adjustment_set: adjustmentSet,
    },
    analysis_strategy: {
      strategy_status: "draft_guidance",
      estimator: estimator.label,
      estimator_family: estimatorFamily,
      effect_type: effectType,
      adjustment_set: adjustmentSet,
      repeated_measures_checks: repeatedMeasuresChecks,
      sensitivity_checks: sensitivityChecks,
      limitations: [
        "Estimation is conditional on graph, model, adjustment set, and assumptions.",
        "The analysis package does not prove causality by itself.",
      ],
    },
    assumptions_review: {
      review_status: Object.values(sensitivityChecks).some(Boolean) ? "reviewed_with_warnings" : "not_reviewed",
      assumptions: SENSITIVITY_ITEMS.map((item) => ({
        name: item.label,
        status: sensitivityChecks[item.id] ? "reviewed" : "uncertain",
      })),
      sensitivity_checks: SENSITIVITY_ITEMS.filter((item) => sensitivityChecks[item.id]).map((item) => item.label),
    },
    selected_primary_estimation_run: primaryEstimationRun,
    rag_evidence: [
      ...(ragSummary ? [{ summary: ragSummary }] : []),
      ...papers.map((p) => ({ source_filename: p.name || p.title, document_type: "research_paper" })),
      ...guidelines.map((g) => ({ source_filename: g.name, document_type: "guideline" })),
    ],
    claim_audit: claimAudit,
    user_notes: "Generated from the Causal Design Agent workflow. Human review required before external use.",
  };
}

function reportValueList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean).filter((item) => item !== "(none)");
  return value ? [String(value).trim()] : [];
}

function sameReportVariableSet(left, right) {
  const normalize = (value) => [...new Set(reportValueList(value).map((item) => item.toLowerCase()))].sort();
  return normalize(left).join("|") === normalize(right).join("|");
}

function activeReportConfiguration(state, selectedRun = state.primaryEstimationRun) {
  const question = state.questionFields || {};
  const config = selectedRun?.config || {};
  const runExposure = selectedRun?.results?.exposure || config.exposure || "";
  const runOutcome = selectedRun?.results?.outcome || config.outcome || "";
  const estimationCovariates = reportValueList(config.adjustmentSet || config.adjustment_set);
  const confirmedAdjustmentSet = reportValueList(state.analysisStrategyConfirmed?.adjustmentSet);
  const editableAdjustmentSet = reportValueList(state.editableAdjustmentSet);
  const roleAdjustmentSet = reportValueList(computeAdjustment(state.variableRoles || {}).confounders);
  const reportAdjustmentSet = confirmedAdjustmentSet.length
    ? confirmedAdjustmentSet
    : editableAdjustmentSet.length
      ? editableAdjustmentSet
      : roleAdjustmentSet;
  const reportAdjustmentSource = confirmedAdjustmentSet.length
    ? "confirmed Phase 7 adjustment set"
    : editableAdjustmentSet.length
      ? "editable report adjustment draft"
      : roleAdjustmentSet.length
        ? "selected variable roles"
        : "missing";
  const adjustmentSet = estimationCovariates.length ? estimationCovariates : reportAdjustmentSet;
  const graphNodes = (state.graphNodes || []).map((node) => node?.id || node?.label).filter(Boolean);
  const names = [...new Set([
    ...Object.keys(state.variableRoles || {}),
    question.exposure, question.outcome, runExposure, runOutcome, ...adjustmentSet,
  ].filter(Boolean))];
  const roleTable = names.map((name) => ({
    variable_name: name,
    source: name === "binge_drinking_event" ? "Backend-derived from label == BD" : "Active study dataset",
    final_role: state.variableRoles?.[name]
      || (name === (runExposure || question.exposure) ? "Exposure" : name === (runOutcome || question.outcome) ? "Outcome" : adjustmentSet.includes(name) ? "Confounder" : "Unassigned"),
    descriptive_meaning: name === "binge_drinking_event" ? "Derived binary BDE event indicator" : "Selected in the active workflow.",
    missingness_warning: "",
  }));
  const issues = [];
  if (selectedRun) {
    if (question.exposure && runExposure && question.exposure !== runExposure) issues.push(`Research-question exposure (${question.exposure}) does not match the selected estimation exposure (${runExposure}).`);
    if (question.outcome && runOutcome && question.outcome !== runOutcome) issues.push(`Research-question outcome (${question.outcome}) does not match the selected estimation outcome (${runOutcome}).`);
    const runAdjustment = estimationCovariates;
    const selectedAdjustment = reportAdjustmentSet;
    if (runAdjustment.length && !selectedAdjustment.length) {
      issues.push(`Report adjustment set is missing. The selected estimation run used ${runAdjustment.join(", ")}. Return to Analysis Strategy to confirm this adjustment set, or apply the selected estimation covariates as the report draft.`);
    } else if (runAdjustment.length && !sameReportVariableSet(selectedAdjustment, runAdjustment)) {
      issues.push(`Report adjustment set (${selectedAdjustment.join(", ")}) does not match the selected estimation covariates (${runAdjustment.join(", ")}).`);
    }
    const expectedGraphNodes = [runExposure, runOutcome, ...runAdjustment].filter(Boolean);
    if (graphNodes.length && expectedGraphNodes.some((name) => !graphNodes.includes(name))) issues.push("The confirmed graph does not contain all variables used by the selected estimation run.");
    if (state.studyMode?.active && runExposure && runExposure !== "acc_mean_magnitude") issues.push("The fixed BDE task requires acc_mean_magnitude as the selected exposure.");
    if (state.studyMode?.active && runOutcome && runOutcome !== "binge_drinking_event") issues.push("The fixed BDE task requires the backend-derived binge_drinking_event outcome (label == BD).");
  }
  return {
    adjustmentSet,
    reportAdjustmentSet,
    reportAdjustmentSource,
    estimationCovariates,
    canApplyEstimationCovariates: Boolean(estimationCovariates.length && !reportAdjustmentSet.length),
    roleTable,
    issues: [...new Set(issues)],
    runExposure,
    runOutcome,
  };
}

function reviewExportPayloadFromState(state, reportPreferences = {}) {
  const {
    objective,
    datasets,
    dictionary,
    protocol,
    papers,
    guidelines,
    broadExploration,
    savedExploreViews,
    promotedPatterns,
    questionFields,
    questionCandidates,
    candidateVariables,
    derivedFeatureCandidates,
    derivedFeatures,
    variableRoles,
    targetedFeasibilityResult,
    feasibility,
    graphNodes,
    graphEdges,
    graphValidationResult,
    graphAlternatives,
    confirmedGraph,
    analysisStrategyResult,
    analysisStrategyDraft,
    analysisStrategyValidation,
    editableAdjustmentSet,
    analysisStrategyConfirmed,
    primaryEstimationRun,
    latestEstimationRun,
    ragSummary,
    ingestionInfo,
    studyMode,
  } = state;
  const dataset = firstRealDataset(datasets) || datasets?.[0] || {};
  const schema = dataset.schema || {};
  const { confounders, mediators } = computeAdjustment(variableRoles);
  const selectedRun = primaryEstimationRun || null;
  const reportConfiguration = activeReportConfiguration(state, selectedRun);
  const fallbackAdjustmentSet = reportConfiguration.adjustmentSet;
  const roleTable = reportConfiguration.roleTable;
  const confirmedQuestion = {
    question_text: questionFields?.question || "",
    population: questionFields?.population || "",
    exposure: questionFields?.exposure || "",
    comparator: questionFields?.comparator || "",
    outcome: questionFields?.outcome || "",
    time_window: questionFields?.timeWindow || "",
    unit_of_analysis: questionFields?.unitOfAnalysis || "",
    estimand: questionFields?.estimand || analysisStrategyDraft?.estimand?.label || "",
  };

  return {
    project: {
      title: "Causal Design Agent Review Package",
      research_objective: objective || questionFields?.question || "",
      dataset_filename: realDatasetFilename(dataset) || dataset.name || "",
      document_status: {
        data_dictionary_uploaded: Boolean(dictionary),
        protocol_uploaded: Boolean(protocol),
        research_paper_count: papers.length,
        guidance_document_count: guidelines.length,
      },
      rag_status: ingestionInfo || { summary: ragSummary || "No RAG status attached." },
      study_workspace: { active: Boolean(studyMode?.active), label: studyMode?.label || "" },
    },
    phase_2_data_foundation: {
      schema_summary: {
        filename: realDatasetFilename(dataset) || dataset.name,
        number_of_rows: schema.number_of_rows || dataset.rows,
        number_of_columns: schema.number_of_columns || dataset.cols,
        column_names: schema.column_names || [],
        possible_id_columns: schema.possible_id_columns || (dataset.participantField ? [dataset.participantField] : []),
        possible_timestamp_date_columns: schema.possible_timestamp_date_columns || dataset.timestampFields || [],
        warnings: schema.warnings || [],
      },
      data_quality_summary: {
        warnings: schema.warnings || [],
        high_missingness: topMissingness(schema, 8).filter((item) => item.pct >= 30),
      },
      clarifications: dictionary && dictionary.described < dictionary.total
        ? [`${dictionary.total - dictionary.described} variable definition(s) still need clarification.`]
        : [],
    },
    phase_3_broad_exploration: {
      saved_views: [
        ...(savedExploreViews || []),
        ...(broadExploration ? [{ label: "Latest backend broad exploration", result: broadExploration }] : []),
      ],
      promoted_patterns: promotedPatterns,
      exploration_warnings: [
        broadExploration?.exploration_warning,
        ...(broadExploration?.data_quality_warnings || []),
      ].filter(Boolean),
    },
    phase_4_question_variables: {
      confirmed_question: confirmedQuestion,
      candidate_questions: questionCandidates,
      candidate_variables: candidateVariables,
      derived_features: [
        ...(derivedFeatureCandidates || []),
        ...(derivedFeatures || []).filter((item) => item.selected),
      ],
      confirmed_roles: roleTable,
    },
    phase_5_feasibility: {
      feasibility_result: targetedFeasibilityResult || feasibility,
    },
    phase_6_graph: {
      confirmed_graph: confirmedGraph || {
        graph_type: "DAG",
        nodes: (graphNodes || []).map((node) => ({ id: node.id, label: node.label, role: node.role || variableRoles[node.id] })),
        edges: (graphEdges || []).map((edge) => ({ source: edge.from, target: edge.to, type: edge.type || edge.edgeType })),
      },
      graph_validation_result: graphValidationResult || confirmedGraph?.validation || {},
      alternative_graphs: graphAlternatives || [],
    },
    phase_7_strategy: {
      identification_result: analysisStrategyResult?.identification || analysisStrategyResult || {},
      adjustment_set: fallbackAdjustmentSet,
      estimand: analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand || { label: questionFields?.estimand || "Estimand requires review." },
      strategy: analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy || {
        estimator_family: state.estimatorFamily,
        effect_type: state.effectType,
        adjustment_set: fallbackAdjustmentSet,
        mediators_for_direct_effect: mediators,
      },
      assumption_checklist: analysisStrategyResult?.assumption_checklist || analysisStrategyConfirmed?.assumption_checklist || [],
      validation: analysisStrategyValidation || {},
    },
    phase_8_estimation: {
      selected_primary_run: selectedRun,
      estimation_runs: [selectedRun, latestEstimationRun].filter(Boolean),
    },
    artifact_consistency: { issues: reportConfiguration.issues, source: "active_dashboard_state" },
    rag_evidence: [
      ...(ragSummary ? [{ summary: ragSummary, document_type: "rag_summary" }] : []),
      ...papers.map((item) => ({ source_filename: item.name || item.title, document_type: "research_paper" })),
      ...guidelines.map((item) => ({ source_filename: item.name, document_type: "domain_guidance" })),
    ],
    user_notes: "Generated from the Causal Design Agent workflow. Human review required before external use.",
    report_preferences: {
      audience: "researcher",
      include_appendix: true,
      include_reproducibility: true,
      include_evidence_table: true,
      ...reportPreferences,
    },
  };
}

function reportToMarkdown(report, state) {
  if (Array.isArray(report?.sections)) {
    return [
      `# ${report.package_title || "Causal Design, Estimation, and Evidence Report"}`,
      "",
      report.executive_summary || "This package supports review and reporting. It does not prove causality.",
      "",
      ...report.sections.flatMap((section) => [
        `## ${section?.title || "Report section"}`,
        "",
        String(section?.content ?? "Not available."),
        ...(Array.isArray(section?.warnings) && section.warnings.length ? ["", "Warnings:", ...section.warnings.map((warning) => `- ${warning}`)] : []),
        "",
      ]),
    ].join("\n");
  }
  const primaryRun = state.primaryEstimationRun;
  const estimate = primaryRun?.results || {};
  const diagnostics = estimate.diagnostics || {};
  const warnings = estimationRunWarnings(primaryRun);
  const sections = report?.sections || {};
  return [
    "# Causal Design, Estimation, and Evidence Report",
    "",
    "This package reviews the causal design, selected estimation run, diagnostics, sensitivity checks, evidence notes, and claim boundaries. It does not prove causality by itself.",
    "",
    "## Research Question",
    state.questionFields?.question || "Not confirmed.",
    "",
    "## Selected Primary Estimation Run",
    primaryRun
      ? [
          `- Run ID: ${primaryRun.id}`,
          `- Estimator: ${primaryRun.config?.estimator || "Not available"}`,
          `- Estimand: ${estimate.estimandLabel || primaryRun.config?.estimand || "Not available"}`,
          `- Point estimate: ${estimate.pointEstimate ?? "Not available"}`,
          `- Standard error: ${estimate.se ?? "Not available"}`,
          `- Confidence interval: [${estimate.ciLower ?? "?"}, ${estimate.ciUpper ?? "?"}]`,
          `- P-value: ${estimate.pValue ?? "Not available"}`,
          `- Sample size: ${estimate.n ?? "Not available"}`,
        ].join("\n")
      : "No primary estimation run has been selected. Return to Phase 8 to run estimation and select a primary run.",
    "",
    "## Diagnostics and Sensitivity",
    primaryRun
      ? [
          `- Rows before filtering: ${diagnostics.rows_before_filtering ?? "Not available"}`,
          `- Rows after filtering: ${diagnostics.rows_after_filtering ?? "Not available"}`,
          `- Excluded rows: ${diagnostics.excluded_rows ?? "Not available"}`,
          `- Convergence: ${estimate.convergence || diagnostics.convergence || "Not available"}`,
          `- Warnings: ${warnings.length ? warnings.join("; ") : "None reported"}`,
        ].join("\n")
      : "Incomplete until Phase 8 primary run is selected.",
    "",
    "## Claim Safety Audit",
    report?.claim_audit || state.reportClaimAudit
      ? `Status: ${(report?.claim_audit || state.reportClaimAudit).status}`
      : "Claim audit has not been run.",
    "",
    "## Export Status",
    `Report status: ${report?.status || "draft"}`,
    `Available sections: ${Object.keys(sections).join(", ") || "local preview only"}`,
    "",
    "## Safety Boundary",
    "The LLM may revise explanatory wording, but it cannot modify numerical estimates. Claims must remain consistent with the graph, identification result, assumptions, diagnostics, evidence, and the selected backend-computed estimate.",
  ].join("\n");
}

function ReviewView({ state, actions }) {
  const { questionFields, variableRoles, feasibility, graphEdges, effectType, estimatorFamily, repeatedMeasuresChecks, sensitivityChecks, papers, guidelines, primaryEstimationRun, latestEstimationRun, confirmedGraph, graphValidationResult, backendStatus, ragSummary, studyMode, studyReportDraft } = state;
  const { showToast, pushAssistantNote, runAssistantAction, resetApprovedBdeWorkspaceVariables, applySelectedEstimationCovariatesToReportDraft, goToPage } = actions;
  const { confounders, mediators, proxies } = useMemo(() => computeAdjustment(variableRoles), [variableRoles]);
  const estimator = ESTIMATOR_OPTIONS.find((o) => o.key === estimatorFamily) || ESTIMATOR_OPTIONS[0];
  const checkedAssumptions = SENSITIVITY_ITEMS.filter((i) => sensitivityChecks[i.id]);
  const selectedRun = primaryEstimationRun || null;
  const latestDraftRun = latestEstimationRun && latestEstimationRun.id !== selectedRun?.id ? latestEstimationRun : null;
  const estimationWarnings = estimationRunWarnings(selectedRun);
  const severeDiagnostics = estimationWarnings.filter((warning) => /blocked|failed|severe|not ready|positivity|convergence/i.test(String(warning)));
  const reportConfiguration = useMemo(() => activeReportConfiguration(state, selectedRun), [state, selectedRun]);
  const consistencyMessage = "Report cannot be exported yet because the selected question, graph, adjustment set, and estimation run are not aligned.";
  const signoffBlockers = [
    !questionFields?.question && "No confirmed research question.",
    !(confirmedGraph || graphEdges.length) && "No final graph is available.",
    !graphValidationResult && "Graph/identification validation has not been reviewed.",
    !selectedRun && consistencyMessage,
    severeDiagnostics.length > 0 && "Severe diagnostics or estimation warnings remain unresolved.",
    reportConfiguration.issues.length > 0 && consistencyMessage,
  ].filter(Boolean);
  const [reportDraft, setReportDraft] = useState(() => studyReportDraft ? { package_title: studyReportDraft.title, status: "frozen_study_draft", warnings: ["Prepared draft — editable, not yet confirmed.", "No Phase 8 estimate has been selected yet."], ready_for_export: false, requires_user_review: true } : null);
  const [claimAudit, setClaimAudit] = useState(null);
  const [reportPreview, setReportPreview] = useState(() => studyReportDraft?.content || "");
  const [reportHistory, setReportHistory] = useState([]);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const reviewExportBlockers = useMemo(() => getReviewExportBlockers({
    selectedRun,
    claimAudit,
    reportDraft,
    backendConnected: backendStatus.connected,
    signoffBlockers,
  }), [selectedRun, claimAudit, reportDraft, backendStatus.connected, signoffBlockers]);
  const exportReady = reviewExportBlockers.length === 0;
  // Expose the same review facts used by this screen, without changing its gates.
  useEffect(() => {
    actions.reviewContextRef.current = {
      status: reportDraft?.status || 'not generated',
      export_ready: exportReady,
      export_blockers: reviewExportBlockers,
      claim_audit: claimAudit,
      unresolved_warnings: reportDraft?.unresolved_warnings || estimationWarnings,
      evidence_summary: reportDraft?.evidence_summary || null,
    };
  });
  useEffect(() => () => { actions.reviewContextRef.current = null; }, [actions.reviewContextRef]);
  const approvedBdeWorkspaceActive = Boolean(studyMode?.active || studyMode?.status === "ready");
  const hasAlignmentBlocker = Boolean(reportConfiguration.issues.length || !selectedRun);
  const firstAlignmentIssue = reportConfiguration.issues[0];
  const blockedPreviewExportMessage = firstAlignmentIssue
    ? `Export is blocked because ${firstAlignmentIssue.charAt(0).toLowerCase()}${firstAlignmentIssue.slice(1)}`
    : "Export is blocked because no selected backend estimation run is available. Return to Analysis Strategy and Phase 8 before exporting.";

  useEffect(() => {
    if (selectedRun && reportDraft?.status === "frozen_study_draft") {
      setReportDraft((draft) => ({
        ...draft,
        warnings: (draft?.warnings || []).filter((warning) => !/No Phase 8 estimate has been selected yet/i.test(String(warning))),
      }));
    }
  }, [selectedRun?.id]);

  function notifyPreviewExportBlocked() {
    showToast(blockedPreviewExportMessage);
    pushAssistantNote(blockedPreviewExportMessage, "review");
  }

  function returnToRecoveryPhase(phase) {
    goToPage(phase, "recovery");
    showToast(phase === "question" ? "Returned to Question & Variables to align the report design." : "Returned to Analysis Strategy to align the adjustment set and estimation plan.");
  }

  function handleResetApprovedBdeVariables() {
    if (!approvedBdeWorkspaceActive) {
      showToast("The approved BDE reset is available only when the approved BDE workspace is active.");
      return;
    }
    if (!window.confirm("Reset to approved BDE variables? This will clear stale graph, feasibility, strategy, estimation, and report state.")) return;
    if (!resetApprovedBdeWorkspaceVariables?.()) return;
    setReportDraft(null);
    setReportPreview("");
    setReportHistory([]);
    setClaimAudit(null);
    setIsEditingReport(false);
  }

  function handleApplyEstimationCovariatesToReportDraft() {
    const covariates = reportConfiguration.estimationCovariates;
    if (!covariates.length) {
      showToast("The selected estimation run does not include covariates to apply to the report draft.");
      return;
    }
    if (!window.confirm(`Apply ${covariates.join(", ")} as the report adjustment draft? Review it before generating or exporting the report.`)) return;
    if (!applySelectedEstimationCovariatesToReportDraft?.(covariates)) return;
    setReportDraft(null);
    setReportPreview("");
    setClaimAudit(null);
    showToast("Adjustment set draft updated from the selected estimation run. Please review before export.");
    pushAssistantNote("The report adjustment draft now reflects the selected backend estimation covariates. Review the design and generate the report before export.");
  }

  function handlePreviewReport() {
    const studyTrace = actions.beginStudyAction("button_click", "report_preview", {});
    try {
    if (hasAlignmentBlocker) {
      notifyPreviewExportBlocked();
      return;
    }
    if (!reportDraft) {
      showToast("Generate the report before switching between edit and preview.");
      return;
    }
    setIsEditingReport((value) => !value);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function saveReportVersion(label, text, packageSnapshot = reportDraft, auditSnapshot = claimAudit) {
    setReportHistory((prev) => [
      ...prev,
      {
        label,
        text,
        assembled_package: packageSnapshot,
        claim_audit_result: auditSnapshot,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  async function handleReviewAssistant(prompt) {
    if (!backendStatus.connected) {
      await runAssistantAction(prompt);
      return;
    }
    actions.beginStudyAction("button_click", "review_assistant_action").success();
    const chatTrace = actions.beginStudyChat(prompt);
    try {
      const response = await assistantAction({
        phase: "phase_9_review_export",
        action: assistantActionForPrompt("review", prompt),
        page_state: {
          assembled_package: reportDraft || {},
          report_preview: reportPreview,
          claim_audit_result: claimAudit || {},
          final_design_summary: reportDraft?.final_design_summary || {},
          selected_estimation_run: selectedRun || {},
          selected_primary_estimation_run: selectedRun || {},
          unresolved_warnings: reportDraft?.unresolved_warnings || estimationWarnings,
          evidence_summary: reportDraft?.evidence_summary || {},
        },
        selected_item: { prompt },
        user_feedback: prompt,
        rag_evidence: reportDraft?.rag_evidence || [],
      });
      const answer = assistantMessageFromResponse(response);
      pushAssistantNote(answer, "review", chatTrace.message(answer, response));
    } catch (error) {
      const answer = `Review assistant action failed: ${friendlyError(error)} Use deterministic report sections and claim audit as the source of truth.`;
      pushAssistantNote(answer, "review", chatTrace.message(answer, {}, "error_response"));
    }
  }

  async function handleGenerateReport() {
    const studyTrace = actions.beginStudyAction("report_export", "report_generation", {});
    try {
    if (hasAlignmentBlocker) {
      notifyPreviewExportBlocked();
      return;
    }
    setReportLoading(true);
    const payload = reviewExportPayloadFromState(state, {
      unresolved_warnings_acknowledged: false,
      include_appendix: true,
      include_reproducibility: true,
      include_evidence_table: true,
    });
    try {
      if (!backendStatus.connected) throw new Error("Backend unavailable - generated local incomplete draft.");
      const report = await assembleReviewPackage(payload);
      studyTrace.capture(report);
      const preview = reportToMarkdown(report, { ...state, reportClaimAudit: claimAudit });
      setReportDraft(report);
      setReportPreview(preview);
      actions.recordStudyEvent?.("report_generated", { source: "backend" });
      saveReportVersion("Draft 1", preview, report, claimAudit);
      pushAssistantNote("The Phase 9 review package is assembled. Review missing items, estimation diagnostics, evidence limits, and claim boundaries before exporting.");
      showToast("Review package assembled.");
    } catch (error) {
      studyTrace.fail();
      const localDraft = {
        package_title: "Causal Design Agent Review Package",
        status: selectedRun ? "fallback" : "fallback",
        executive_summary: "Local draft only. Backend assembly was unavailable.",
        warnings: [friendlyError(error), ...(!selectedRun ? ["No primary estimation run has been selected."] : [])],
        sections: [
          { section_id: "selected_estimation", title: "Selected primary estimation run", status: selectedRun ? "complete" : "missing", content: JSON.stringify(selectedRun?.results || {}, null, 2) },
          { section_id: "diagnostics", title: "Diagnostics", status: selectedRun ? "warning" : "missing", content: JSON.stringify(selectedRun?.results?.diagnostics || {}, null, 2) },
        ],
        selected_estimation_summary: selectedRun?.results || null,
        unresolved_warnings: estimationRunWarnings(selectedRun),
        limitations: ["Local fallback. This package does not prove causality."],
        missing_required_items: selectedRun ? [] : ["selected_primary_estimation_run"],
        ready_for_export: Boolean(selectedRun),
        requires_user_review: true,
      };
      const preview = reportToMarkdown(localDraft, { ...state, reportClaimAudit: claimAudit });
      setReportDraft(localDraft);
      setReportPreview(preview);
      actions.recordStudyEvent?.("report_generated", { source: "local_incomplete_draft" });
      saveReportVersion("Draft 1 - local fallback", preview, localDraft, claimAudit);
      pushAssistantNote("I created a local incomplete report preview because the backend report endpoint was unavailable. Review it as a draft only.");
      showToast("Local report preview generated.");
    } finally {
      setReportLoading(false);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function handleClaimAudit() {
    const studyTrace = actions.beginStudyAction("report_export", "report_claim_audit", {});
    try {
    setAuditLoading(true);
    try {
      const assembled = reportDraft || (backendStatus.connected
        ? await assembleReviewPackage(reviewExportPayloadFromState(state))
        : {
            package_title: "Causal Design Agent Review Package",
            status: selectedRun ? "fallback" : "missing_primary_estimation_run",
            selected_estimation_summary: selectedRun?.results || null,
            final_design_summary: {},
            unresolved_warnings: selectedRun ? [] : ["No primary estimation run has been selected."],
            ready_for_export: false,
          });
      if (!reportDraft) setReportDraft(assembled);
      const payload = {
        report_text: reportPreview || reportToMarkdown(assembled, { ...state, reportClaimAudit: claimAudit }),
        final_design_summary: assembled.final_design_summary || {},
        selected_estimation_summary: assembled.selected_estimation_summary || {},
        assumption_checklist: reviewExportPayloadFromState(state).phase_7_strategy.assumption_checklist,
        unresolved_warnings: assembled.unresolved_warnings || [],
        rag_evidence: reviewExportPayloadFromState(state).rag_evidence,
      };
      const audit = backendStatus.connected ? await runClaimAudit(payload) : {
        status: "fail",
        flagged_claims: [{ text: "Claim audit unavailable", issue_type: "missing_limitation", severity: "blocking", explanation: "Backend unavailable - human review required.", suggested_revision: "Run backend claim audit before export." }],
        blocked_phrases: ["backend unavailable"],
        safe_language_suggestions: ["under the specified model and assumptions", "requires expert review"],
        ready_for_export: false,
      };
      studyTrace.capture(audit);
      setClaimAudit(normalizeClaimAuditResult(audit));
      saveReportVersion("Claim-audited draft", reportPreview || reportToMarkdown(assembled, { ...state, reportClaimAudit: audit }), assembled, audit);
      const blockingCount = (audit.flagged_claims || []).filter((item) => item.severity === "blocking").length;
      pushAssistantNote(`Claim audit returned ${audit.status}. ${blockingCount} blocking issue(s) must be revised before external export.`);
      showToast("Claim audit complete.");
    } catch (error) {
      studyTrace.fail();
      setClaimAudit(normalizeClaimAuditResult({ status: "fail", flagged_claims: [{ text: "Claim audit request", issue_type: "diagnostic_conflict", severity: "blocking", explanation: friendlyError(error), suggested_revision: "Fix the audit request and rerun before export." }], blocked_phrases: [], safe_language_suggestions: [], ready_for_export: false }));
      pushAssistantNote(`Claim audit failed: ${friendlyError(error)} Keep report language conservative until this is resolved.`);
      showToast("Claim audit failed.");
    } finally {
      setAuditLoading(false);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function handleExportReviewPackage(format) {
    const studyTrace = actions.beginStudyAction("report_export", format === "pdf" ? "report_pdf_preview" : "report_export", { export_format: format });
    try {
    actions.recordStudyEvent?.("export_attempted", { format });
    if (format === "pdf") {
      if (!exportReady) {
        notifyPreviewExportBlocked();
        return;
      }
      const previewOpened = downloadPDFReport(state, reportDraft);
      if (previewOpened) studyTrace.opened(); else { studyTrace.blocked(); return; }
      showToast("Print-ready report opened - use your browser's Print dialog to save as PDF.");
      pushAssistantNote("I opened a print-ready report preview. This proof of concept uses browser Save as PDF; a server-generated PDF can be added later.");
      return;
    }
    if (reviewExportBlockers.length > 0) {
      notifyPreviewExportBlocked();
      return;
    }
    const assembled = reportDraft || (backendStatus.connected ? await assembleReviewPackage(reviewExportPayloadFromState(state)) : reportDraft);
    if (!reportDraft) setReportDraft(assembled);
    const audit = normalizeClaimAuditResult(claimAudit || {
      status: "warning",
      flagged_claims: [{ text: "claim audit", issue_type: "missing_limitation", severity: "medium", explanation: "Run claim audit before export.", suggested_revision: "Run claim audit before external use." }],
      ready_for_export: false,
    });
    const result = backendStatus.connected
      ? await exportReviewPackage({
          assembled_package: assembled,
          claim_audit_result: audit,
          format,
          include_appendix: true,
          include_reproducibility: true,
        })
      : {
          filename: `causal_design_agent_review_export.${format === "markdown" ? "md" : "json"}`,
          content: format === "markdown" ? (reportPreview || reportToMarkdown(assembled, { ...state, reportClaimAudit: audit })) : JSON.stringify({ assembled_package: assembled, claim_audit_result: audit, report_preview: reportPreview }, null, 2),
          warnings: ["Backend unavailable - local export generated."],
        };
      studyTrace.capture(result);
    const filename = exportReport(format === "markdown" ? { markdown: result.content } : JSON.parse(result.content), format);
    studyTrace.downloadInitiated();
    saveReportVersion(`Exported ${format.toUpperCase()}`, result.content, assembled, audit);
    (result.warnings || []).forEach((warning) => pushAssistantNote(warning));
    showToast(`Exported ${result.filename || filename}`);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function applySafeRevision(flaggedClaim) {
    const studyTrace = actions.beginStudyAction("button_click", "report_safe_revision", {});
    try {
    if (!flaggedClaim?.suggested_revision) return;
    const original = flaggedClaim.text || "";
    const replacement = flaggedClaim.suggested_revision;
    const nextPreview = reportPreview && original
      ? reportPreview.replace(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement)
      : `${reportPreview}\n\nSuggested safer wording: ${replacement}`.trim();
    setReportPreview(nextPreview);
    saveReportVersion("Revised draft", nextPreview, reportDraft, claimAudit);
    showToast("Suggested safer wording applied to the report preview.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  return (
    <>
      <div className="ps-header">
        <div className="ps-header-top">
          <h1>Review & export</h1>
        </div>
        <p>Everything confirmed across the workflow, assembled into one document you can export and share.</p>
      </div>

      <PostSurvey />

      {studyMode && <div className="card"><div className="card-head"><div className="card-title">Prepared study report draft</div><span className="chip chip-warning">Prepared draft — editable, not yet confirmed.</span></div><p className="card-desc">This draft preserves warnings, incomplete states, limitations, and claim boundaries. Generate the backend package and complete claim audit before external export.</p><textarea className="text-area" value={reportPreview} onChange={(event) => setReportPreview(event.target.value)} rows={12} aria-label="Editable prepared study report draft" /></div>}

      <div className="card">
        <div className="card-head"><div className="card-title">Final research question</div><CardInfo text="The formalized causal question from Step 4, shown here for final review before export. Includes the population, exposure, comparator, outcome, time window, and target estimand. Go back to Step 4 to adjust." /></div>
        <p className="card-desc" style={{ marginBottom: 0 }}>{questionFields?.question || "Not yet defined \u2014 go back to Question & Variables."}</p>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Data feasibility summary</div><CardInfo text="Key metrics carried from Step 5 — analysis-ready sample size after lag and missingness filters, overlap % (positivity), and the overall feasibility verdict for the current settings." /></div>
        <div className="mini-stat-row">
          <div className="mini-stat"><span className="mini-stat-label">Analysis-ready sample</span><span className="mini-stat-value">{feasibility.finalSample.toLocaleString()}</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Overlap</span><span className="mini-stat-value">{feasibility.overlapPct}%</span></div>
          <div className="mini-stat"><span className="mini-stat-label">Verdict</span><span className="mini-stat-value"><VerdictBadge verdict={feasibility.verdict} /></span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Variable role table</div><CardInfo text="Final confirmed roles for every variable — Exposure, Outcome, Confounder, Mediator, or Proxy — as assigned in Step 6 (Causal Graph). These roles determine the adjustment set and what gets estimated." /></div>
        <table className="mini-table">
          <thead><tr><th>Variable</th><th>Source</th><th>Final role</th></tr></thead>
          <tbody>
            {reportConfiguration.roleTable.map((item) => (
              <tr key={item.variable_name}>
                <td className="mono">{item.variable_name}</td>
                <td>{item.source}</td>
                <td><span className={`chip ${ROLE_COLORS[item.final_role] || "chip-muted"}`}>{item.final_role}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Final causal graph</div><CardInfo text="Every edge in the causal DAG as finalized in Step 6, with its support status (supported or uncertain). Uncertain edges are listed separately below and represent alternative causal structures to report." /></div>
        {graphEdges.map((e) => (
          <div className="pattern-row" key={e.id}>
            <span className="mono">{e.from} \u2192 {e.to}</span>
            <span className={`chip ${e.type === "supported" ? "chip-success" : "chip-warning"}`}>{e.type}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Alternative or uncertain graphs</div><CardInfo text="Edges left as uncertain in Step 6. Each represents a plausible alternative causal structure — for each one, consider running a sensitivity analysis with the edge reversed or removed." /></div>
        {graphEdges.filter((e) => e.type === "uncertain").length === 0 ? (
          <div className="helper"><CheckCircle2 size={13} color="var(--success)" /> No alternative structures flagged — every edge in the final graph is marked supported.</div>
        ) : (
          <>
            <p className="card-desc">These edges were left uncertain in the final graph. Each represents a plausible alternative causal structure worth reporting.</p>
            {graphEdges.filter((e) => e.type === "uncertain").map((e) => (
              <div className="pattern-row" key={e.id}>
                <span className="mono">{e.from} → {e.to}</span>
                <span className="chip chip-warning">alternative / uncertain</span>
              </div>
            ))}
          </>
        )}
      </div>



      <div className="card">
        <div className="card-head"><div className="card-title">Adjustment set & identification</div><CardInfo text="The adjustment set and effect type confirmed in Step 7. Defines what the causal estimate controls for and what causal quantity is being estimated (total vs. direct effect)." /></div>
        <div className="filter-pills">
          {reportConfiguration.adjustmentSet.length ? reportConfiguration.adjustmentSet.map((v) => <span key={v} className="chip chip-accent mono">{v}</span>) : <span className="helper">None identified.</span>}
        </div>
        <p className="card-desc" style={{ marginTop: 10, marginBottom: 0 }}>Effect type: {effectType === "direct" ? "Direct effect" : "Total effect"}{mediators.length ? ` \u2014 mediator(s): ${mediators.join(", ")}` : ""}{proxies.length ? ` \u2014 proxy: ${proxies.join(", ")}` : ""}</p>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Recommended analysis strategy</div><CardInfo text="The estimator family and repeated-measures options chosen in Step 7, carried here as the primary analysis approach. Included verbatim in the exported PDF report." /></div>
        <p className="card-desc" style={{ marginBottom: 6 }}><strong style={{ color: "var(--navy)" }}>{estimator.label}</strong> \u2014 {estimator.desc}</p>
        <div className="filter-pills">
          {Object.entries(repeatedMeasuresChecks).filter(([, v]) => v).map(([k]) => <span key={k} className="chip chip-muted">{REPEATED_MEASURES_ITEMS.find((i) => i.id === k)?.label}</span>)}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Assumption checklist</div><CardInfo text="Which causal and statistical assumptions were flagged in Step 7. Checked items appear as 'reviewed' in the report; unchecked items should be discussed as limitations." /></div>
        <div className="filter-pills">
          {SENSITIVITY_ITEMS.map((i) => (
            <span key={i.id} className={`chip ${sensitivityChecks[i.id] ? "chip-success" : "chip-muted"}`}>
              {sensitivityChecks[i.id] ? <CheckCircle2 size={12} /> : <Circle size={12} />} {i.label}
            </span>
          ))}
        </div>
        {checkedAssumptions.length === 0 && <div className="helper" style={{ marginTop: 8 }}><Info size={13} /> No assumptions have been reviewed yet \u2014 consider going back to Feasibility or Analysis Strategy.</div>}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Sensitivity-analysis plan</div><CardInfo text="Planned robustness checks auto-generated from your flagged assumptions and graph uncertainty. Each check targets a specific assumption and is included in the exported PDF report." /></div>
        <p className="card-desc">Planned checks to probe how robust the estimate is to violations of the assumptions above.</p>
        <ul className="plain-list">
          <li>Refit the primary model without each confounder in turn to assess adjustment stability.</li>
          <li>E-value for unmeasured confounding on the primary estimate.</li>
          <li>Sensitivity to alternative lag windows and exposure thresholds (from Feasibility).</li>
          <li>Compare estimator families ({ESTIMATOR_OPTIONS.map((o) => o.label.split(" ")[0]).join(", ")}) as a robustness check.</li>
          <li>Rerun with multiple-imputation vs complete-case to bracket missing-data impact.</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Selected primary estimation run</div>
          <CardInfo text="The selected Phase 8 run is the only source for numerical estimates in the final package. The assistant may explain wording, but it cannot invent or change these values." />
        </div>
        {selectedRun ? (
          <>
            <div className="mini-stat-row">
              <div className="mini-stat"><span className="mini-stat-label">Run ID</span><span className="mini-stat-value" style={{ fontSize: 13 }}>{selectedRun.id}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Estimator</span><span className="mini-stat-value" style={{ fontSize: 13 }}>{selectedRun.config?.estimator || "Not available"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Estimand</span><span className="mini-stat-value">{selectedRun.results?.estimandLabel || selectedRun.config?.estimand || "ATE"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Status</span><span className="mini-stat-value"><span className={estimationWarnings.length ? "chip chip-warning" : "chip chip-success"}>{estimationWarnings.length ? "Completed with warnings" : "Completed"}</span></span></div>
            </div>
            <div className="mini-stat-row" style={{ marginTop: 10 }}>
              <div className="mini-stat"><span className="mini-stat-label">Point estimate</span><span className="mini-stat-value">{selectedRun.results?.pointEstimate ?? "—"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">SE</span><span className="mini-stat-value">{selectedRun.results?.se ?? "—"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">95% CI</span><span className="mini-stat-value">[{selectedRun.results?.ciLower ?? "?"}, {selectedRun.results?.ciUpper ?? "?"}]</span></div>
              <div className="mini-stat"><span className="mini-stat-label">p-value</span><span className="mini-stat-value">{selectedRun.results?.pValue ?? "—"}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Sample size</span><span className="mini-stat-value">{Number(selectedRun.results?.n || 0).toLocaleString()}</span></div>
            </div>
            <div className="inconsistency-card" style={{ marginTop: 12, background: "var(--accent-soft)", borderColor: "#CFE0EE" }}>
              <p style={{ color: "var(--navy)", margin: 0 }}>This report includes computed estimates under the selected model and assumptions. It does not prove causality by itself.</p>
            </div>
          </>
        ) : (
          <div className="inconsistency-card">
            <p style={{ margin: 0 }}>No primary estimation run has been selected. You can still create a design-only draft, but the complete design and analysis package requires a selected estimation run.</p>
            <p style={{ margin: "8px 0 0" }}>Return to Phase 8 to run estimation and select a primary run when you need the complete package.</p>
            {latestDraftRun && <p style={{ margin: "8px 0 0" }}>A latest draft run exists ({latestDraftRun.id}), but it has not been selected as primary.</p>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Diagnostics and sensitivity</div>
          <CardInfo text="Rows, convergence, data exclusions, exposure variation, warnings, and sensitivity checks carried from Phase 8." />
        </div>
        {selectedRun ? (
          <>
            <div className="pattern-row"><span>Rows before filtering</span><span className="mono">{selectedRun.results?.diagnostics?.rows_before_filtering ?? "—"}</span></div>
            <div className="pattern-row"><span>Rows after filtering</span><span className="mono">{selectedRun.results?.diagnostics?.rows_after_filtering ?? "—"}</span></div>
            <div className="pattern-row"><span>Excluded rows</span><span className="mono">{selectedRun.results?.diagnostics?.excluded_rows ?? "—"} ({selectedRun.results?.diagnostics?.excluded_percent ?? "—"}%)</span></div>
            <div className="pattern-row"><span>Convergence</span><span className="chip chip-muted">{selectedRun.results?.convergence || selectedRun.results?.diagnostics?.convergence || "not available"}</span></div>
            <div className="pattern-row">
              <span>Exposure variation</span>
              <span className="mono">mean {selectedRun.results?.diagnostics?.exposure_variation?.mean ?? "—"} · std {selectedRun.results?.diagnostics?.exposure_variation?.std ?? "—"} · unique {selectedRun.results?.diagnostics?.exposure_variation?.unique_values ?? "—"}</span>
            </div>
            {selectedRun.results?.sensitivityResults?.length ? (
              selectedRun.results.sensitivityResults.map((item, index) => (
                <div className="pattern-row" key={`${item.label}-${index}`}>
                  <span>{item.label}<br /><span style={{ color: "#5B6472", fontSize: 11 }}>{item.desc}</span></span>
                  <span className="chip chip-muted">{item.value}</span>
                </div>
              ))
            ) : (
              <div className="helper" style={{ marginTop: 8 }}><Info size={13} /> No completed sensitivity result values were returned; planned checks remain in the analysis package.</div>
            )}
            {estimationWarnings.length ? estimationWarnings.map((warning, index) => (
              <div key={`${warning}-${index}`} className="inconsistency-card" style={{ marginTop: 8 }}>
                <p style={{ margin: 0 }}>{warning}</p>
              </div>
            )) : <div className="helper" style={{ marginTop: 8 }}><CheckCircle2 size={13} color="var(--success)" /> No Phase 8 warnings reported.</div>}
          </>
        ) : (
          <div className="helper"><Lock size={13} /> Diagnostics and sensitivity are incomplete until a primary Phase 8 run is selected.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Evidence source verification</div>
          <CardInfo text="RAG and uploaded document evidence are included as support for design reasoning and limitations, not as proof of causal effects." />
        </div>
        {ragSummary ? <p className="card-desc">{ragSummary}</p> : <div className="helper"><Info size={13} /> No RAG evidence summary has been attached yet.</div>}
        <div className="filter-pills" style={{ marginTop: 10 }}>
          {papers.map((p) => <span key={p.id} className="chip chip-accent">{p.title}</span>)}
          {guidelines.map((g) => <span key={g.id} className="chip chip-muted">{g.name}</span>)}
          {papers.length === 0 && guidelines.length === 0 && <span className="helper">No source files linked.</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Claim auditor</div>
          <CardInfo text="Flags proof language, treatment/diagnosis language, unsupported generalization, and claims not linked to graph, evidence, assumptions, diagnostics, or the selected estimate." />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={handleClaimAudit} disabled={auditLoading}><ShieldAlert size={13} /> {auditLoading ? "Auditing..." : "Run Claim Audit"}</button>
          <button className="btn" onClick={() => handleReviewAssistant("Ask AI to Revise Report")}><Sparkles size={13} /> Ask AI to Revise Report</button>
          <button className="btn" onClick={() => handleReviewAssistant("Interpret Final Design")}><Info size={13} /> Interpret Final Design</button>
          <button className="btn" onClick={() => handleReviewAssistant("Summarize Key Decisions")}><ClipboardList size={13} /> Summarize Key Decisions</button>
          <button className="btn" onClick={() => handleReviewAssistant("Review Unresolved Warnings")}><AlertTriangle size={13} /> Review Unresolved Warnings</button>
          <button className="btn" onClick={() => handleReviewAssistant("Reprocess with Selected Evidence")}><RefreshCw size={13} /> Reprocess with Selected Evidence</button>
        </div>
        {claimAudit ? (
          <>
            <div className="mini-stat-row">
              <div className="mini-stat"><span className="mini-stat-label">Audit status</span><span className="mini-stat-value"><span className={claimAudit.status === "fail" ? "chip chip-danger" : claimAudit.status === "warning" ? "chip chip-warning" : "chip chip-success"}>{claimAudit.status}</span></span></div>
              <div className="mini-stat"><span className="mini-stat-label">Flagged</span><span className="mini-stat-value">{claimAudit.flagged_claims?.length || 0}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Blocking</span><span className="mini-stat-value">{(claimAudit.flagged_claims || []).filter((item) => item.severity === "blocking").length}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Ready</span><span className="mini-stat-value">{claimAudit.ready_for_export ? "Yes" : "No"}</span></div>
            </div>
            {(claimAudit.flagged_claims || []).map((item, index) => (
              <div className="inconsistency-card" key={`blocked-${index}`} style={{ marginTop: 8 }}>
                <p style={{ margin: 0 }}><strong>{item.severity}:</strong> {item.text}</p>
                <p style={{ margin: "4px 0 0" }}>{item.explanation}</p>
                {item.suggested_revision && <p style={{ margin: "4px 0 0" }}><strong>Safer wording:</strong> {item.suggested_revision}</p>}
                {item.suggested_revision && (
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => applySafeRevision(item)}>
                    Apply suggested wording
                  </button>
                )}
              </div>
            ))}
            {(claimAudit.safe_language_suggestions || []).map((item, index) => (
              <div className="helper" key={`rewrite-${index}`} style={{ marginTop: 8 }}><CheckCircle2 size={13} color="var(--success)" /> Safe language: {item}</div>
            ))}
          </>
        ) : (
          <div className="helper"><Info size={13} /> Run claim audit before export.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Report preview and export</div>
          <CardInfo text="Generate a structured draft package. JSON and Markdown are saved directly; PDF opens a browser print preview for this proof of concept." />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={handleGenerateReport} disabled={reportLoading}><FileCheck2 size={13} /> {reportLoading ? "Assembling report…" : "Generate Report"}</button>
          <button className="btn" onClick={handlePreviewReport}><FileText size={13} /> {isEditingReport ? "Preview Report" : "Edit Report"}</button>
          <button className="btn" onClick={() => handleExportReviewPackage("json")}><Save size={13} /> Export JSON</button>
          <button className="btn" onClick={() => handleExportReviewPackage("markdown")}><FileText size={13} /> Export Markdown</button>
          <button className="btn" onClick={() => handleExportReviewPackage("pdf")}><FileCheck2 size={13} /> Export PDF Preview</button>
        </div>
        {reviewExportBlockers.length > 0 && (
          <div className="status-box status-warning" style={{ marginBottom: 12 }}>
            <div>{reviewExportBlockers.join(" • ")}</div>
            {hasAlignmentBlocker && (
              <>
                <div className="mini-stat-row" style={{ marginTop: 10 }}>
                  <div className="mini-stat"><span className="mini-stat-label">Question exposure</span><span className="mini-stat-value mono">{questionFields?.exposure || "Not selected"}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Estimation exposure</span><span className="mini-stat-value mono">{reportConfiguration.runExposure || "No selected run"}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Question outcome</span><span className="mini-stat-value mono">{questionFields?.outcome || "Not selected"}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Estimation outcome</span><span className="mini-stat-value mono">{reportConfiguration.runOutcome || "No selected run"}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Report adjustment set</span><span className="mini-stat-value mono">{reportConfiguration.reportAdjustmentSet.join(", ") || "None"}</span><span className="helper">{reportConfiguration.reportAdjustmentSource}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Estimation covariates</span><span className="mini-stat-value mono">{reportConfiguration.estimationCovariates.join(", ") || "No selected run"}</span></div>
                  <div className="mini-stat"><span className="mini-stat-label">Selected estimation run</span><span className="mini-stat-value mono">{selectedRun?.id || "None"}</span></div>
                </div>
                <div className="button-row" style={{ marginTop: 10 }}>
                  {reportConfiguration.canApplyEstimationCovariates && <button className="btn btn-secondary btn-sm" onClick={handleApplyEstimationCovariatesToReportDraft}>Apply selected estimation covariates to report draft</button>}
                  {approvedBdeWorkspaceActive && <button className="btn btn-secondary btn-sm" onClick={handleResetApprovedBdeVariables}>Reset to approved BDE workspace variables</button>}
                  <button className="btn btn-secondary btn-sm" onClick={() => returnToRecoveryPhase("question")}>Return to Question & Variables</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => returnToRecoveryPhase("strategy")}>Return to Analysis Strategy</button>
                </div>
                {approvedBdeWorkspaceActive && <div className="helper" style={{ marginTop: 8 }}><Info size={13} /> Resetting restores the approved BDE variables and sends you back to Feasibility because feasibility, graph validation, strategy confirmation, and estimation must be rerun.</div>}
              </>
            )}
          </div>
        )}
        {reportDraft ? (
          <>
            <div className="pattern-row"><span>Report title</span><span>{reportDraft.package_title || reportDraft.title || reportDraft.report_title}</span></div>
            <div className="pattern-row"><span>Status</span><span className={reportDraft.ready_for_export ? "chip chip-success" : "chip chip-warning"}>{reportDraft.status || "draft"}</span></div>
            <div className="pattern-row"><span>Sections</span><span className="mono">{Array.isArray(reportDraft.sections) ? reportDraft.sections.length : Object.keys(reportDraft.sections || {}).length}</span></div>
            <div className="pattern-row"><span>Draft history</span><span className="mono">{reportHistory.length} version(s)</span></div>
            {(reportDraft.unresolved_warnings || reportDraft.warnings || []).map((warning, index) => (
              <div className="helper" style={{ marginTop: 6 }} key={`${warning}-${index}`}><AlertTriangle size={13} color="var(--warning)" /> {warning}</div>
            ))}
            {isEditingReport ? (
              <textarea
                className="text-input"
                value={reportPreview}
                onChange={(event) => setReportPreview(event.target.value)}
                onBlur={() => saveReportVersion("User-edited draft", reportPreview, reportDraft, claimAudit)}
                rows={16}
                style={{ marginTop: 12, width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: 1.55 }}
              />
            ) : (
              <div className="report-preview" style={{ marginTop: 12, maxHeight: 360, overflow: "auto" }}
                dangerouslySetInnerHTML={{ __html: renderReportContent(reportPreview || reportToMarkdown(reportDraft, { ...state, reportClaimAudit: claimAudit })) }}
              />
            )}
          </>
        ) : (
          <div className="helper"><Info size={13} /> Generate Report to preview backend report sections, missing items, warnings, and export options.</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Human review checklist</div>
          <CardInfo text="Final sign-off is blocked until the essential causal design, estimation, diagnostics, evidence, and claim-safety items are reviewed." />
        </div>
        {[
          ["Confirmed research question", Boolean(questionFields?.question)],
          ["Confirmed graph", Boolean(confirmedGraph || graphEdges.length)],
          ["Identification reviewed", Boolean(graphValidationResult)],
          ["Assumptions reviewed", checkedAssumptions.length > 0],
          ["Estimation run selected", Boolean(selectedRun)],
          ["Diagnostics reviewed", Boolean(selectedRun && !severeDiagnostics.length)],
          ["Claim audit passed", Boolean(claimAudit && claimAudit.status !== "fail")],
          ["Evidence reviewed", Boolean(ragSummary || papers.length || guidelines.length)],
          ["Limitations documented", true],
        ].map(([label, ok]) => (
          <div className="pattern-row" key={label}>
            <span>{label}</span>
            <span className={ok ? "chip chip-success" : "chip chip-warning"}>{ok ? "Reviewed" : "Needs review"}</span>
          </div>
        ))}
        {signoffBlockers.length ? (
          <div className="inconsistency-card" style={{ marginTop: 12 }}>
            <p style={{ margin: "0 0 6px" }}><strong>Sign-off blocked</strong></p>
            <ul className="plain-list" style={{ margin: 0 }}>{signoffBlockers.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        ) : (
          <div className="helper" style={{ marginTop: 10 }}><CheckCircle2 size={13} color="var(--success)" /> No blocking items detected. Proceed with warnings only after documenting limitations.</div>
        )}
      </div>



      <div className="card">
        <div className="card-head"><div className="card-title">Supporting evidence</div><CardInfo text="Papers and guidelines uploaded in Step 1, cited in the exported report as the empirical and domain-knowledge basis for the analysis design." /></div>
        {papers.length === 0 && guidelines.length === 0 ? (
          <div className="helper"><Info size={13} /> No supporting evidence uploaded in Project Setup.</div>
        ) : (
          <div className="filter-pills">
            {papers.map((p) => <span key={p.id} className="chip chip-accent">{p.title}</span>)}
            {guidelines.map((g) => <span key={g.id} className="chip chip-muted">{g.name}</span>)}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Limitations & what can be claimed</div><CardInfo text="The scope of the causal claim this analysis supports and the key limitations to report. Describes what can and cannot be inferred from an observational within-person design like this one." /></div>
        <ul className="plain-list">
          <li>Findings reflect an observational analysis \u2014 unmeasured confounding can't be ruled out.</li>
          <li>Self-reported measures are subject to recall and reporting bias.</li>
          <li>The observation window may not capture longer-term patterns.</li>
        </ul>
        <div className="inconsistency-card" style={{ marginTop: 12, background: "var(--accent-soft)", borderColor: "#CFE0EE" }}>
          <p style={{ color: "var(--navy)" }}>{reportConfiguration.issues.length ? "Report requires revision before interpretation because the selected question, graph, adjustment set, and estimation run are not aligned." : "If the active artifacts are aligned, this backend-computed run may be described only as an association under the selected model and reviewed assumptions. It cannot prove causation or support individual clinical decisions."}</p>
        </div>
      </div>

      <div className="next-bar">
        <p><strong style={{ color: "var(--navy)" }}>Causal Design, Estimation, and Evidence Report:</strong> export a draft package only after reviewing Phase 8 estimates, diagnostics, assumptions, evidence, and claim boundaries.</p>
        <button className="btn" onClick={() => { pushAssistantNote("Return to the previous phase to revise the selected estimation run, diagnostics, assumptions, or analysis strategy before final export."); showToast("Use the sidebar to return to Phase 8."); }}><ArrowRight size={14} /> Return to Previous Phase</button>
        <button
          className="btn btn-primary"
          disabled={signoffBlockers.length > 0 || claimAudit?.status === "fail"}
          style={{ opacity: signoffBlockers.length > 0 || claimAudit?.status === "fail" ? 0.55 : 1 }}
          onClick={() => {
            downloadPDFReport(state, reportDraft);
            showToast("Report opened - use your browser's Print dialog to save as PDF.");
          }}
        >
          <FileCheck2 size={14} /> Approve / Sign Off Preview
        </button>
      </div>
    </>
  );
}

export default function CausalStudioApp() {
  const study = useStudy();
  const dashboardEventsRef = useRef(null);
  if (!dashboardEventsRef.current) dashboardEventsRef.current = createDashboardEvents(event => study?.logStudyEvent?.(event));
  const dashboardEvents = dashboardEventsRef.current;
  useEffect(() => { dashboardEvents.enter("setup"); }, [dashboardEvents]);
  function beginStudyAction(type, label, metadata) { return dashboardEvents.begin(page, type, label, metadata); }
  const [page, setPage] = useState("setup");
  const [visited, setVisited] = useState({ setup: true });

  const [objective, setObjective] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackApplied, setFeedbackApplied] = useState(false);
  const [datasets, setDatasets] = useState([]);
  const [dictionary, setDictionary] = useState(null);
  const [protocol, setProtocol] = useState(null);
  const [papers, setPapers] = useState([]);
  const [guidelines, setGuidelines] = useState([]);
  const [promotedPatterns, setPromotedPatterns] = useState([]);
  const [savedExploreViews, setSavedExploreViews] = useState([]);
  const [variableRoles, setVariableRoles] = useState({});
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [questionFields, setQuestionFields] = useState(null);
  const [questionCandidates, setQuestionCandidates] = useState([]);
  const [candidateVariables, setCandidateVariables] = useState([]);
  const [derivedFeatureCandidates, setDerivedFeatureCandidates] = useState([]);
  const [phase4Status, setPhase4Status] = useState(null);
  const [phase4Feedback, setPhase4Feedback] = useState("");
  const [derivedFeatures, setDerivedFeatures] = useState(() => DERIVED_FEATURE_OPTIONS.map((f) => ({ ...f, selected: false })));
  const [lockedContent, setLockedContent] = useState({});
  const lockContent = (key, value) => setLockedContent(c => ({ ...c, [key]: value }));
  const unlockContent = (key) => setLockedContent(c => { const n = { ...c }; delete n[key]; return n; });

  const [lagHours, setLagHours] = useState(24);
  const [exposureThreshold, setExposureThreshold] = useState(30);
  const [sensitivityChecks, setSensitivityChecks] = useState({ missingData: true, positivity: true, unmeasuredConf: false, consistency: false, exclusionRestriction: false });
  const [targetedFeasibilityResult, setTargetedFeasibilityResult] = useState(null);

  const [graphNodes, setGraphNodes] = useState(DEFAULT_GRAPH_NODES.map((n) => ({ ...n })));
  const [graphEdges, setGraphEdges] = useState(DEFAULT_GRAPH_EDGES.map((e) => ({ ...e })));
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [graphType, setGraphType] = useState("DAG");
  const [graphValidationResult, setGraphValidationResult] = useState(null);
  const [graphAlternatives, setGraphAlternatives] = useState([]);
  const [confirmedGraph, setConfirmedGraph] = useState(null);
  const [graphVersionLabel, setGraphVersionLabel] = useState("Version 0");
  const [graphActionStatus, setGraphActionStatus] = useState(null);

  const [effectType, setEffectType] = useState("total");
  const [estimatorFamily, setEstimatorFamily] = useState("mixed_logistic");
  const [repeatedMeasuresChecks, setRepeatedMeasuresChecks] = useState({ randomIntercept: true, multipleImputation: false, robustSE: false });
  const [analysisStrategyResult, setAnalysisStrategyResult] = useState(null);
  const [analysisStrategyValidation, setAnalysisStrategyValidation] = useState(null);
  const [analysisStrategyDraft, setAnalysisStrategyDraft] = useState(null);
  const [editableAdjustmentSet, setEditableAdjustmentSet] = useState([]);
  const [analysisStrategyConfirmed, setAnalysisStrategyConfirmed] = useState(null);
  const [analysisStrategyStatus, setAnalysisStrategyStatus] = useState(null);
  const [latestEstimationRun, setLatestEstimationRun] = useState(null);
  const [primaryEstimationRun, setPrimaryEstimationRun] = useState(null);

  const [ackOpen, setAckOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [backendStatus, setBackendStatus] = useState({ checked: false, connected: false, message: "Checking backend..." });
  const [actionStatus, setActionStatus] = useState({});
  const [ingestionInfo, setIngestionInfo] = useState(null);
  const ingestionMonitor = useRef(null);
  useEffect(() => () => ingestionMonitor.current?.abort(), []);
  const [ragSummary, setRagSummary] = useState("");
  const [broadExploration, setBroadExploration] = useState(null);
  const [studyMode, setStudyMode] = useState(null);
  const [studySessionLog, setStudySessionLog] = useState([]);
  const [studyReportDraft, setStudyReportDraft] = useState(null);

  const [assistantThreads, setAssistantThreads] = useState({
    setup: [
      { role: "assistant", text: PAGE_INTRO_MESSAGES.setup },
    ],
  });
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [assistantThinkingMessage, setAssistantThinkingMessage] = useState("Thinking...");
  const [assistantInput, setAssistantInput] = useState("");
  const assistantScrollRef = useRef(null);
  const reviewContextRef = useRef(null);
  const typedChatHistory = useRef([]);
  const typedChatPending = useRef(false);
  const typedChatDataset = useRef(null);
  const guidanceProgress = useRef({});
  const assistantThread = assistantThreads[page] || [];
  useEffect(() => {
    dashboardEvents.displayMessages(page, assistantThreads[page]);
  }, [dashboardEvents, page, assistantThreads]);

  useEffect(() => {
    if (assistantScrollRef.current) assistantScrollRef.current.scrollTop = assistantScrollRef.current.scrollHeight;
  }, [assistantThreads, assistantThinking, page]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };
  const setAction = (key, status) => setActionStatus((current) => ({ ...current, [key]: status }));
  function pushAssistantNote(text, targetPage, studyMessage) {
    const key = targetPage || page;
    setAssistantThreads((t) => ({ ...t, [key]: [...(t[key] || []), studyMessage || { role: "assistant", text }] }));
  }
  // Fires a guidance message exactly once per (pageKey, task) pair for the lifetime of the session.
  // Use this for turn-based guidance: when a user completes one task, call advanceGuidance to
  // explain the next task. Subsequent calls with the same key are silently ignored.
  function advanceGuidance(pageKey, task, message) {
    const key = `${pageKey}::${task}`;
    if (guidanceProgress.current[key]) return;
    guidanceProgress.current[key] = true;
    pushAssistantNote(message, pageKey);
  }

  useEffect(() => {
    let active = true;
    checkBackendHealth()
      .then((health) => {
        if (active) setBackendStatus({ checked: true, connected: true, message: `Connected to ${health.api_base_url || "FastAPI"}` });
      })
      .catch((error) => {
        if (!active) return;
        setBackendStatus({ checked: true, connected: false, message: friendlyError(error, "Backend unavailable - demo mode active") });
        pushAssistantNote("Backend unavailable - demo mode active. Real upload, RAG, and Python exploration require FastAPI to be running.", "setup");
      });
    return () => {
      active = false;
    };
  }, []);

  function recordStudyEvent(event, details = {}) {
    if (!studyMode && event !== "study_mode_started") return;
    setStudySessionLog((log) => [...log, { event, at: new Date().toISOString(), ...details }]);
  }

  function exportStudySessionLog() {
    recordStudyEvent("export_attempted", { export: "study_session_log" });
    const blob = new Blob([JSON.stringify({ study_mode: studyMode?.label || "Fixed BDE task", events: studySessionLog }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "causal_studio_study_session_log.json"; link.click();
    URL.revokeObjectURL(url);
    showToast("Study session log exported.");
  }

  async function startFixedBdeStudyMode() {
    const studyTrace = beginStudyAction("button_click", "study_workspace_open", {});
    try {
    setAction("studyMode", { kind: "loading", message: "Loading approved workspace…" });
    try {
      const result = await startStudyMode();
      studyTrace.capture(result);
      const dataset = schemaToDataset({ name: result.dataset.original_filename, size: result.dataset.file_size_bytes }, result.dataset, result.dataset.schema, { rows: 0, cols: 0 });
      const drafts = result.frozen_drafts || {};
      setStudyMode({ ...result, active: true });
      recordStudyEvent("study_mode_started");
      setObjective(result.objective || "");
      setDatasets([{ ...dataset, studyMode: true, studyLabel: "Approved study dataset" }]);
      setDictionary({ name: "BDE data description.docx", savedFilename: "BDE data description.docx", total: result.dataset.schema?.number_of_columns || 0, described: result.dataset.schema?.number_of_columns || 0, studyMode: true });
      setProtocol({ name: "BDE Data collection.pdf", savedFilename: "BDE Data collection.pdf", studyMode: true });
      setPapers([{ id: "study-paper", name: "BDE Research paper.pdf", title: "Approved study evidence", studyMode: true }]);
      setQuestionFields({ question: drafts.question?.question_text || "", population: "Participants in the approved BDE study dataset", exposure: drafts.question?.exposure || "acc_mean_magnitude", comparator: "Lower movement values", outcome: drafts.question?.outcome || "binge_drinking_event", timeWindow: "Prior analysis window to later binge-drinking event", unitOfAnalysis: "participant-window", estimand: "Association; causal interpretation requires reviewed assumptions" });
      setQuestionCandidates([{ id: "study-frozen", status: "Prepared draft — editable, not yet confirmed.", question_text: drafts.question?.question_text || "", exposure: drafts.question?.exposure, outcome: drafts.question?.outcome, limitations: ["Observational design; no causal conclusion without reviewed assumptions."] }]);
      const studyRoles = { acc_mean_magnitude: "Exposure", binge_drinking_event: "Outcome", time_of_day: "Confounder", day_of_week: "Confounder" };
      const graphNodeNames = drafts.graph?.nodes || ["time_of_day", "day_of_week", "acc_mean_magnitude", "binge_drinking_event"];
      const graphPositions = [[180, 120], [180, 355], [465, 235], [740, 235]];
      const graphNodesDraft = graphNodeNames.map((id, index) => ({ id, label: id, role: studyRoles[id] || "Unassigned", isCore: true, x: graphPositions[index]?.[0] || 450, y: graphPositions[index]?.[1] || 260, notes: "Prepared draft — editable, not yet confirmed." }));
      const graphEdgesDraft = (drafts.graph?.edges || []).map(([from, to], index) => ({ id: `study-edge-${index + 1}`, from, to, type: "uncertain", edgeType: "uncertain", notes: "Assumption-based graph draft — not causal proof." }));
      setVariableRoles(studyRoles);
      setGraphNodes(graphNodesDraft);
      setGraphEdges(graphEdgesDraft);
      setGraphVersionLabel("Prepared draft — editable, not yet confirmed.");
      setGraphValidationResult(null);
      setConfirmedGraph(null);
      setGraphActionStatus({ kind: "warning", message: "Assumption-based graph draft — not causal proof. Save, validate, and confirm before Phase 7." });
      setEditableAdjustmentSet(drafts.strategy?.adjustment_set || ["time_of_day", "day_of_week"]);
      setAnalysisStrategyDraft({
        estimand: { label: drafts.strategy?.estimand || "Association only — not a causal effect claim.", exposure: "acc_mean_magnitude", outcome: "binge_drinking_event", comparator: "one-unit higher movement value", time_window: "prior analysis window to later binge-drinking event", unit_of_analysis: "participant-window" },
        strategy: { estimator_family: "logistic_regression", adjustment_set: drafts.strategy?.adjustment_set || ["time_of_day", "day_of_week"], repeated_measures_strategy: drafts.strategy?.repeated_measures_note || "Requires review", missing_data_strategy: "complete_case", warning: drafts.strategy?.warning || "Residual confounding and temporal assumptions require review." },
      });
      setAnalysisStrategyResult(null);
      setAnalysisStrategyValidation(null);
      setAnalysisStrategyConfirmed(null);
      setAnalysisStrategyStatus({ kind: "warning", message: "Prepared strategy draft loaded. Run identification and validate it before confirmation." });
      setStudyReportDraft({ label: drafts.label || "Prepared draft — editable, not yet confirmed.", title: drafts.report?.title || "Fixed BDE study report draft", content: drafts.report?.content || "Not yet available" });
      setAction("studyMode", { kind: "success", message: "Approved BDE workspace loaded. Prepared drafts are editable and not yet confirmed." });
      pushAssistantNote("Approved BDE workspace loaded: approved files are registered. Prepared drafts are editable and not yet confirmed. Python computes all numerical outputs.", "setup");
    } catch (error) {
      studyTrace.fail();
      setAction("studyMode", { kind: "error", message: friendlyError(error, "Approved BDE workspace could not be loaded.") });
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function resetApprovedBdeWorkspaceVariables() {
    const drafts = studyMode?.frozen_drafts;
    if (!(studyMode?.active || studyMode?.status === "ready") || !drafts) {
      showToast("Load the approved BDE workspace before resetting its variables.");
      return false;
    }

    // Reuse the canonical payload returned by /study-mode/start. This reset does
    // not preserve any selected analysis artifact from the prior workspace state.
    const question = drafts.question || {};
    setStudyMode((current) => ({ ...current, active: true }));
    const adjustmentSet = ["time_of_day", "day_of_week"];
    const roles = {
      acc_mean_magnitude: "Exposure",
      binge_drinking_event: "Outcome",
      time_of_day: "Confounder",
      day_of_week: "Confounder",
    };
    const nodeNames = drafts.graph?.nodes || ["time_of_day", "day_of_week", "acc_mean_magnitude", "binge_drinking_event"];
    const positions = [[180, 120], [180, 355], [465, 235], [740, 235]];
    const canonicalQuestion = question.question_text || "Are smartphone-derived movement patterns during a prior analysis window associated with later binge-drinking event risk?";
    const canonicalReportDraft = {
      label: drafts.label || "Prepared draft — editable, not yet confirmed.",
      title: drafts.report?.title || "Fixed BDE study report draft",
      content: drafts.report?.content || "Not yet available",
    };

    // Phase 4: replace question/candidate/role state rather than updating fields.
    setQuestionFields({
      question: canonicalQuestion,
      population: "Participants in the approved BDE study dataset",
      exposure: "acc_mean_magnitude",
      comparator: "Lower movement values",
      outcome: "binge_drinking_event",
      timeWindow: "Prior analysis window to later binge-drinking event",
      unitOfAnalysis: "participant-window",
      estimand: "Association; causal interpretation requires reviewed assumptions",
    });
    setSelectedQuestionId("study-frozen");
    setPhase4Status({ kind: "success", message: "Approved BDE question restored for targeted feasibility review." });
    setQuestionCandidates([{
      id: "study-frozen",
      status: "Prepared draft — editable, not yet confirmed.",
      question_text: canonicalQuestion,
      exposure: "acc_mean_magnitude",
      outcome: "binge_drinking_event",
      limitations: ["Observational design; no causal conclusion without reviewed assumptions."],
    }]);
    setCandidateVariables([]);
    setDerivedFeatureCandidates([]);
    setDerivedFeatures(DERIVED_FEATURE_OPTIONS.map((feature) => ({ ...feature, selected: false })));
    setPhase4Feedback("");
    setVariableRoles(roles);
    setLockedContent({});

    // Phase 5: no previous diagnostic is valid after restoring the design.
    setLagHours(1);
    setExposureThreshold(30);
    setSensitivityChecks({ missingData: true, positivity: true, unmeasuredConf: false, consistency: false, exclusionRestriction: false });
    setTargetedFeasibilityResult(null);

    // Phase 6: retain only the approved draft graph; validation must be rerun.
    setGraphType("DAG");
    setGraphNodes(nodeNames.map((id, index) => ({
      id,
      label: id,
      role: roles[id] || "Unassigned",
      isCore: true,
      x: positions[index]?.[0] || 450,
      y: positions[index]?.[1] || 260,
      notes: "Prepared draft — editable, not yet confirmed.",
    })));
    setGraphEdges((drafts.graph?.edges || []).map(([from, to], index) => ({
      id: `study-edge-${index + 1}`,
      from,
      to,
      type: "uncertain",
      edgeType: "uncertain",
      notes: "Assumption-based graph draft — not causal proof.",
    })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setGraphAlternatives([]);
    setGraphValidationResult(null);
    setConfirmedGraph(null);
    setGraphVersionLabel("Prepared draft — editable, not yet confirmed.");
    setGraphActionStatus({ kind: "warning", message: "Approved BDE graph draft restored. Validate and confirm it before continuing." });

    // Phase 7 and 8: discard all prior strategy/estimation selections.
    setEffectType("total");
    setEstimatorFamily("mixed_logistic");
    setRepeatedMeasuresChecks({ randomIntercept: true, multipleImputation: false, robustSE: false });
    setEditableAdjustmentSet(adjustmentSet);
    setAnalysisStrategyDraft({
      estimand: { label: drafts.strategy?.estimand || "Association only — not a causal effect claim.", exposure: "acc_mean_magnitude", outcome: "binge_drinking_event", comparator: "one-unit higher movement value", time_window: "prior analysis window to later binge-drinking event", unit_of_analysis: "participant-window" },
      strategy: { estimator_family: "logistic_regression", adjustment_set: adjustmentSet, repeated_measures_strategy: drafts.strategy?.repeated_measures_note || "Requires review", missing_data_strategy: "complete_case", warning: drafts.strategy?.warning || "Residual confounding and temporal assumptions require review." },
    });
    setAnalysisStrategyResult(null);
    setAnalysisStrategyValidation(null);
    setAnalysisStrategyConfirmed(null);
    setAnalysisStrategyStatus({ kind: "warning", message: "Approved BDE strategy draft restored. Run identification, validate, and confirm it before estimation." });
    setPrimaryEstimationRun(null);
    setLatestEstimationRun(null);
    setPrimaryEstimationRun(null);

    // Phase 9: clear generated artifacts; retain only the canonical editable draft.
    setStudyReportDraft(canonicalReportDraft);
    setAckOpen(false);
    setBroadExploration(null);
    setSavedExploreViews([]);
    setPromotedPatterns([]);
    setActionStatus((current) => {
      const {
        targetedFeasibility,
        estimationValidation,
        estimationRun,
        estimationInterpretation,
        reviewPackage,
        claimAudit,
        ...remaining
      } = current;
      return {
        ...remaining,
        targetedFeasibility: { kind: "warning", message: "Approved BDE variables restored. Rerun feasibility diagnostics." },
      };
    });

    const message = "Approved BDE variables were restored. You are being returned to Feasibility because downstream steps must be rerun before export.";
    recordStudyEvent("approved_bde_variables_reset", {
      exposure: "acc_mean_magnitude",
      outcome: "binge_drinking_event",
      adjustment_set: adjustmentSet,
      next_phase: "feasibility",
    });
    showToast(message);
    pushAssistantNote(message, "feasibility");
    goToPage("feasibility");
    return true;
  }

  function applySelectedEstimationCovariatesToReportDraft(covariates) {
    const normalizedCovariates = reportValueList(covariates);
    if (!normalizedCovariates.length) return false;
    setEditableAdjustmentSet(normalizedCovariates);
    setAnalysisStrategyDraft((draft) => ({
      ...(draft || {}),
      strategy: {
        ...(draft?.strategy || {}),
        adjustment_set: normalizedCovariates,
      },
    }));
    recordStudyEvent("report_adjustment_draft_updated", {
      adjustment_set: normalizedCovariates,
      source: "selected_estimation_run",
    });
    return true;
  }

  async function addDatasets(files) {
    const studyTrace = beginStudyAction("dataset_upload", "dataset_upload", safeUploadMetadata(files));
    try {
    if (!files?.length) return;
    pushAssistantNote("Checking this now - confirming it is a valid dataset file, scanning columns and row structure...");
    setAction("datasetUpload", { kind: "loading", message: "Uploading dataset and parsing schema…" });

    const additions = [];
    for (const [i, f] of files.entries()) {
      const seed = seedFromName(f.name, datasets.length + i);
      const isCorrupt = f.name.toLowerCase().includes("corrupt");
      const fallback = isCorrupt
        ? {
            status: "blocking", rows: 0, cols: 0, participantField: null, timestampFields: [],
            detail: {
              detected: "The file could not be parsed. No valid delimiter or header row was found.",
              issues: "The structure of the file does not match a supported tabular format.",
              why: "Downstream steps cannot analyze a dataset that cannot be read.",
              action: "Re-export the file as CSV and upload again.",
              blocking: true,
            },
          }
        : genDatasetDetail(f, seed);
      try {
        const uploaded = await uploadDataset(f);
        const schema = await getDatasetSchema(uploaded.saved_filename);
        additions.push(schemaToDataset(f, uploaded, schema, fallback));
        setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
        pushAssistantNote(buildRealSchemaAssistantMessage(schema));
      } catch (error) {
      studyTrace.fail();
        additions.push({
          id: `${f.name}-${Date.now()}-${i}`,
          name: f.name,
          size: f.size || 0,
          expanded: true,
          status: "blocking",
          rows: 0,
          cols: 0,
          participantField: null,
          timestampFields: [],
          detail: {
            detected: "The backend could not upload or parse this dataset.",
            issues: friendlyError(error, "Dataset upload failed."),
            why: "Phase 2 needs a parseable schema before real data foundation summaries can be shown.",
            action: "Upload a CSV file supported by the backend.",
            blocking: true,
          },
        });
        pushAssistantNote(`Dataset upload failed: ${friendlyError(error)}`);
      }
    }
    if (additions.length) {
      // A new upload becomes the active analysis dataset. Clear artifacts from
      // the prior dataset (including the approved BDE workspace) instead of
      // silently carrying stale variables or numerical outputs forward.
      setDatasets(additions);
      setStudyMode(null);
      setBroadExploration(null);
      setPromotedPatterns([]);
      setSavedExploreViews([]);
      setVariableRoles({});
      setSelectedQuestionId(null);
      setQuestionFields(null);
      setQuestionCandidates([]);
      setCandidateVariables([]);
      setDerivedFeatureCandidates([]);
      setPhase4Status(null);
      setDerivedFeatures(DERIVED_FEATURE_OPTIONS.map((feature) => ({ ...feature, selected: false })));
      setGraphNodes((additions[0]?.schema?.column_names || []).slice(0, 8).map((name, index) => ({
        id: name, label: name, role: "Unassigned", isCore: true,
        x: 140 + (index % 4) * 210, y: 120 + Math.floor(index / 4) * 145,
      })));
      setGraphEdges([]);
      setGraphValidationResult(null);
      setGraphAlternatives([]);
      setConfirmedGraph(null);
      setEditableAdjustmentSet([]);
      setAnalysisStrategyResult(null);
      setAnalysisStrategyValidation(null);
      setAnalysisStrategyDraft(null);
      setAnalysisStrategyConfirmed(null);
      setLatestEstimationRun(null);
      setPrimaryEstimationRun(null);
      setStudyReportDraft(null);
      setRagSummary("");
    }
    setAction("datasetUpload", {
      kind: additions.some((item) => item.status === "blocking") ? "error" : "success",
      message: additions.some((item) => item.status === "blocking")
        ? "One or more datasets require clarification."
        : "Dataset uploaded and parsed by FastAPI. It is now the active dataset; prior dataset-specific drafts and results were cleared.",
    });
    if (additions.length) {
      const blocked = additions.find((a) => a.status === "blocking");
      if (blocked) studyTrace.fail();
      const flagged = additions.find((a) => a.status !== "ready" && a.status !== "blocking");
      if (blocked) {
        pushAssistantNote(`${blocked.name} could not be parsed - re-export as CSV and upload again.`);
      } else if (flagged) {
        pushAssistantNote(`${flagged.name} uploaded with a flag — open "Validation details" to see what needs attention.`);
      } else {
        const allGood = additions.map((a) => a.name).join(", ");
        const hasDictionary = !!dictionary;
        pushAssistantNote(
          hasDictionary
            ? `${allGood} uploaded ✓ — check the readiness checklist at the top and continue when it's green.`
            : `${allGood} uploaded ✓ — now upload a data dictionary in the section below so I can understand what each column means.`
        );
        if (!hasDictionary) {
          advanceGuidance("setup", "dataset_uploaded", "Dataset in — great! Now upload a data dictionary in the section below ↓. It tells me what each column means (type, valid range, an example value). Without it I can't reliably check your data or suggest variable roles.");
        } else {
          advanceGuidance("setup", "dataset_and_dict_complete", "You're all set for the next step! 🎉 Check the readiness checklist at the top — when everything's green, click \"Continue to Data Foundation\" to move on.");
        }
      }
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function removeDataset(id) { beginStudyAction("button_click", "dataset_remove").success(); setDatasets((d) => d.filter((x) => x.id !== id)); }
  function toggleDataset(id) { beginStudyAction("button_click", "dataset_schema_toggle").success(); setDatasets((d) => d.map((x) => (x.id === id ? { ...x, expanded: !x.expanded } : x))); }
  async function replaceDataset(_id, file) {
    if (!file) return;
    await addDatasets([file]);
  }
  async function addDictionary(files) {
    const studyTrace = beginStudyAction("document_upload", "dictionary_upload", safeUploadMetadata(files));
    try {
    const f = files[0];
    if (!f) return;
    setAction("dictionaryUpload", { kind: "loading", message: "Uploading data dictionary..." });
    try {
      const uploaded = await uploadDocument(f, "data_dictionary");
      const validation = await validateDocumentCategory(uploaded.saved_filename, "data_dictionary");
      studyTrace.capture(validation);
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      setAction("dictionaryUpload", { kind: documentValidationKind(validation), message: documentValidationMessage(validation, "Data dictionary stored in the backend document library.") });
    } catch (error) {
      studyTrace.fail();
      setAction("dictionaryUpload", { kind: "error", message: friendlyError(error, "Data dictionary upload failed.") });
      pushAssistantNote(`Data dictionary upload failed: ${friendlyError(error)} Backend document upload currently accepts PDF, DOCX, and TXT.`);
      return;
    }
    const seed = seedFromName(f.name, 7);
    const total = 90 + (seed % 20);
    const described = 60 + (seed % (total - 55));
    setDictionary({ name: f.name, size: f.size, total, described, expanded: false });
    const missing = total - described;
    if (described === total) {
      pushAssistantNote(
        datasets.length > 0
          ? `Dictionary uploaded ✓ — all required files in place. Check the readiness checklist and continue when it's green.`
          : `Dictionary uploaded ✓ — now upload your dataset(s) in the section above.`
      );
      if (datasets.length > 0) {
        advanceGuidance("setup", "dictionary_uploaded", "You're all set for the next step! 🎉 Check the readiness checklist — when everything's green, click \"Continue to Data Foundation\" to move on.");
      }
    } else {
      pushAssistantNote(`Dictionary uploaded — ${missing} variable(s) are incomplete. Add their data type, range, and an example value, then re-upload.`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function addProtocol(files) {
    const studyTrace = beginStudyAction("document_upload", "protocol_upload", safeUploadMetadata(files));
    try {
    if (!files?.[0]) return;
    setAction("protocolUpload", { kind: "loading", message: "Uploading protocol..." });
    try {
      const uploaded = await uploadDocument(files[0], "protocol");
      const validation = await validateDocumentCategory(uploaded.saved_filename, "protocol");
      studyTrace.capture(validation);
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      setAction("protocolUpload", { kind: documentValidationKind(validation), message: documentValidationMessage(validation, "Protocol stored in the backend document library.") });
    } catch (error) {
      studyTrace.fail();
      setAction("protocolUpload", { kind: "error", message: friendlyError(error, "Protocol upload failed.") });
      pushAssistantNote(`Protocol upload failed: ${friendlyError(error)}`);
      return;
    }
    setProtocol({ name: files[0].name, size: files[0].size });
    pushAssistantNote(`Protocol uploaded ✓ — I'll use it to flag any design-vs-data inconsistencies in Data Foundation.`);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function addPapers(files) {
    const studyTrace = beginStudyAction("document_upload", "papers_upload", safeUploadMetadata(files));
    try {
    if (!files?.length) return;
    setAction("paperUpload", { kind: "loading", message: "Uploading research papers..." });
    try {
      const validations = [];
      for (const file of files) {
        const uploaded = await uploadDocument(file, "research_paper");
        validations.push(await validateDocumentCategory(uploaded.saved_filename, "research_paper"));
      }
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      validations.forEach(validation => studyTrace.capture(validation));
      const needsReview = validations.find((item) => documentValidationKind(item) !== "success");
      setAction("paperUpload", { kind: needsReview ? documentValidationKind(needsReview) : "success", message: needsReview ? documentValidationMessage(needsReview) : "Research papers uploaded and validated." });
    } catch (error) {
      studyTrace.fail();
      setAction("paperUpload", { kind: "error", message: friendlyError(error, "Research paper upload failed.") });
      pushAssistantNote(`Research paper upload failed: ${friendlyError(error)}`);
      return;
    }
    const additions = files.map((f, i) => {
      const seed = seedFromName(f.name, i);
      const duplicate = papers.some((p) => p.name === f.name);
      return { id: `${f.name}-${Date.now()}-${i}`, name: f.name, size: f.size, title: f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "), authors: "Detected: J. Alvarez et al.", year: 2018 + (seed % 8), duplicate };
    });
    setPapers((p) => [...p, ...additions]);
    const dupCount = additions.filter((a) => a.duplicate).length;
    if (dupCount > 0) {
      pushAssistantNote(`Paper(s) uploaded — ${dupCount} flagged as a possible duplicate. Remove any confirmed copies below.`);
    } else {
      pushAssistantNote(`Paper(s) uploaded ✓ — I'll use these as evidence when suggesting variable roles and causal relationships.`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function addGuidelines(files) {
    const studyTrace = beginStudyAction("document_upload", "guidance_upload", safeUploadMetadata(files));
    try {
    if (!files?.length) return;
    setAction("guidelineUpload", { kind: "loading", message: "Uploading guidance documents..." });
    try {
      const validations = [];
      for (const file of files) {
        const uploaded = await uploadDocument(file, "domain_guidance");
        validations.push(await validateDocumentCategory(uploaded.saved_filename, "domain_guidance"));
      }
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      validations.forEach(validation => studyTrace.capture(validation));
      const needsReview = validations.find((item) => documentValidationKind(item) !== "success");
      setAction("guidelineUpload", { kind: needsReview ? documentValidationKind(needsReview) : "success", message: needsReview ? documentValidationMessage(needsReview) : "Guidance documents uploaded and validated." });
    } catch (error) {
      studyTrace.fail();
      setAction("guidelineUpload", { kind: "error", message: friendlyError(error, "Guidance upload failed.") });
      pushAssistantNote(`Guidance upload failed: ${friendlyError(error)}`);
      return;
    }
    const additions = files.map((f, i) => {
      const seed = seedFromName(f.name, i + 3);
      return { id: `${f.name}-${Date.now()}-${i}`, name: f.name, size: f.size, sourceType: GUIDELINE_TYPES[seed % GUIDELINE_TYPES.length] };
    });
    setGuidelines((g) => [...g, ...additions]);
    pushAssistantNote(`Guideline(s) uploaded ✓ — I'll use these as domain standards when framing measurement concepts and study limitations.`);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function handleDocumentIngestion() {
    const studyTrace = beginStudyAction("document_ingestion", "document_ingestion", {});
    try {
    if (ingestionMonitor.current) return;
    const controller = new AbortController();
    ingestionMonitor.current = controller;
    setAction("documentIngestion", { kind: "loading", message: "Checking ingestion status…" });
    try {
      const result = await followIngestion({
        start: ingestDocuments,
        readStatus: getIngestionStatus,
        initialStatus: ingestionInfo,
        signal: controller.signal,
        onUpdate: status => {
          if (status.status === "running") studyTrace.running();
          setIngestionInfo(status);
          if (!["completed", "ready"].includes(status.status)) {
            setAction("documentIngestion", { kind: "loading", message: status.status === "running"
              ? `Ingestion still running${status.step ? ` — ${status.step}` : ""}. ${status.message || ""}`
              : status.message });
          }
        },
      });
      studyTrace.capture(result);
      const chunkCount = result.stored_chunks ?? result.chunks_created ?? 0;
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      setAction("documentIngestion", { kind: "success", message: `Documents ingested. ${chunkCount} chunks available for RAG search.` });
      pushAssistantNote(`Document knowledge base updated: ${chunkCount} chunks are available. Retrieved evidence does not prove causal claims.`);
    } catch (error) {
      studyTrace.fail(error?.payload?.failed_step);
      if (controller.signal.aborted) return;
      setIngestionInfo(error.payload || { status: "unknown", message: friendlyError(error) });
      setAction("documentIngestion", { kind: "error", message: friendlyError(error, "Could not confirm ingestion completion.") });
      pushAssistantNote(friendlyError(error, "Could not confirm ingestion completion."));
    } finally {
      if (ingestionMonitor.current === controller) ingestionMonitor.current = null;
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function handleDictionaryRagCheck() {
    const studyTrace = beginStudyAction("rag_search", "rag_search", {});
    try {
    setAction("ragCheck", { kind: "loading", message: "Checking the document knowledge base..." });
    try {
      const response = await searchRag("What evidence or guidance helps interpret the uploaded study variables and measurement timing?", 3, ingestionInfo);
      studyTrace.capture(response);
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      const count = response.number_of_results ?? response.results?.length ?? 0;
      const sources = [...new Set((response.results || []).map((item) => item.source_filename || item.metadata?.source_filename).filter(Boolean))];
      const summary = count
        ? `RAG evidence check found ${count} supporting chunk${count === 1 ? "" : "s"} from ${formatList(sources, "uploaded documents")}.`
        : "RAG evidence check completed, but no matching chunks were returned.";
      setRagSummary(summary);
      setAction("ragCheck", { kind: "success", message: summary });
      pushAssistantNote(`${summary} Retrieved passages are supporting evidence for design review, not causal conclusions.`);
    } catch (error) {
      studyTrace.fail();
      setAction("ragCheck", { kind: "error", message: friendlyError(error, "RAG evidence check failed.") });
      pushAssistantNote(`RAG evidence check failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function handleBroadExploration() {
    const studyTrace = beginStudyAction("button_click", "broad_exploration", {});
    try {
    const dataset = firstRealDataset(datasets);
    if (!dataset) {
      setAction("broadExploration", { kind: "error", message: "Upload a CSV dataset before running broad exploration." });
      return;
    }
    if (!dataset.savedFilename) {
      setAction("broadExploration", { kind: "error", message: "Upload and parse a CSV dataset before running backend broad exploration." });
      return;
    }
    setAction("broadExploration", { kind: "loading", message: "Running Python broad exploration..." });
    try {
      const result = await runBroadExploration(realDatasetFilename(dataset));
      studyTrace.capture(result);
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      setBroadExploration(result);
      const warningCount = result.data_quality_warnings?.length || 0;
      setAction("broadExploration", { kind: "success", message: `Broad exploration complete with ${warningCount} data-quality note${warningCount === 1 ? "" : "s"}.` });
      pushAssistantNote("Python computed the broad exploration summaries. Review missingness, participant structure, timestamps, and correlations as hypothesis-generating evidence only. These patterns do not establish causality.");
    } catch (error) {
      studyTrace.fail();
      setAction("broadExploration", { kind: "error", message: friendlyError(error, "Broad exploration failed.") });
      pushAssistantNote(`Broad exploration failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function buildPhase4Payload(extra = {}) {
    const dataset = firstRealDataset(datasets);
    const schema = dataset?.schema || {};
    return {
      research_objective: objective.trim() || "Generate editable draft questions from the active dataset schema.",
      confirmed_question: questionFields?.question || "",
      dataset_filename: realDatasetFilename(dataset) || dataset?.name || "",
      schema_summary: {
        filename: realDatasetFilename(dataset) || dataset?.name || "",
        number_of_rows: schema.number_of_rows ?? dataset?.rows,
        number_of_columns: schema.number_of_columns ?? dataset?.cols,
        column_names: schema.column_names || [],
        pandas_data_types: schema.pandas_data_types || {},
        missing_value_percentage_per_column: schema.missing_value_percentage_per_column || {},
        possible_id_columns: schema.possible_id_columns || (dataset?.participantField ? [dataset.participantField] : []),
        possible_timestamp_date_columns: schema.possible_timestamp_date_columns || dataset?.timestampFields || [],
        possible_numeric_columns: schema.possible_numeric_columns || [],
        possible_categorical_columns: schema.possible_categorical_columns || [],
        warnings: schema.warnings || [],
      },
      broad_exploration_summary: broadExploration || {},
      rag_evidence: [],
      user_feedback: phase4Feedback,
      locked_decisions: lockedContent || {},
      ...extra,
    };
  }

  function questionCandidateToFields(candidate) {
    return {
      question: candidate.question_text || "",
      population: candidate.population || "",
      exposure: candidate.exposure || "",
      comparator: candidate.comparator || "",
      outcome: candidate.outcome || "",
      timeWindow: candidate.time_window || "",
      unitOfAnalysis: candidate.unit_of_analysis || "",
      estimand: candidate.initial_estimand_direction || "",
    };
  }

  async function handleGenerateQuestionCandidates(mode = "generate") {
    const studyTrace = beginStudyAction("button_click", "question_generation", {});
    try {
    if (!backendStatus.connected) {
      setPhase4Status({ kind: "error", message: "Backend unavailable - showing existing draft question examples." });
      pushAssistantNote("I could not call the Phase 4 backend, so keep using the local draft examples for now.");
      return;
    }
    setPhase4Status({ kind: "loading", message: mode === "alternative" ? "Generating alternative questions..." : "Generating question candidates..." });
    try {
      const response = await generateQuestionCandidates(buildPhase4Payload({
        user_feedback: mode === "alternative"
          ? `${phase4Feedback}\nGenerate an alternative set while preserving locked user decisions.`
          : phase4Feedback,
      }));
      studyTrace.capture(response);
      setQuestionCandidates(response.questions || []);
      setPhase4Status({
        kind: response.status === "fallback" ? "warning" : "success",
        message: `${response.questions?.length || 0} structured question candidate${(response.questions?.length || 0) === 1 ? "" : "s"} generated.`,
      });
      pushAssistantNote(
        response.status === "fallback"
          ? "I could not use the LLM, so I generated deterministic placeholder candidates from the current schema. Please review carefully."
          : "I generated candidate questions using the current schema, uploaded evidence, and exploration context. These are drafts and need your review before continuing."
      );
    } catch (error) {
      studyTrace.fail();
      setPhase4Status({ kind: "error", message: friendlyError(error, "Question candidate generation failed.") });
      pushAssistantNote(`Question candidate generation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  async function handleRecommendCandidateVariables() {
    const studyTrace = beginStudyAction("variable_selection", "variables_recommendation", {});
    try {
    const confirmed = questionFields?.question || questionCandidates[0]?.question_text || "";
    if (!confirmed) {
      showToast("Select or write a question before recommending variables.");
      return;
    }
    if (!backendStatus.connected) {
      setPhase4Status({ kind: "error", message: "Backend unavailable - variable recommendations need FastAPI." });
      pushAssistantNote("Backend is unavailable, so I cannot generate structured variable recommendations right now.");
      return;
    }
    setPhase4Status({ kind: "loading", message: "Recommending candidate variables..." });
    try {
      const response = await recommendCandidateVariables(buildPhase4Payload({
        confirmed_question: confirmed,
        user_feedback: phase4Feedback,
      }));
      studyTrace.capture(response);
      setCandidateVariables(response.candidate_variables || []);
      setDerivedFeatureCandidates(response.derived_feature_candidates || []);
      setPhase4Status({
        kind: response.status === "fallback" ? "warning" : "success",
        message: `${response.candidate_variables?.length || 0} candidate variable${(response.candidate_variables?.length || 0) === 1 ? "" : "s"} returned.`,
      });
      (response.candidate_variables || []).forEach((item) => {
        const name = item.variable_name;
        const role = String(item.possible_structural_role || "").replaceAll("_", " ");
        const option = ROLE_OPTIONS.find((candidate) => candidate.toLowerCase() === role.toLowerCase());
        if (name && option) setVariableRole(name, option);
      });
      pushAssistantNote(
        response.status === "fallback"
          ? "I could not use the LLM, so I generated deterministic placeholder variables from the current schema. Variable roles are provisional and need review."
          : "I generated candidate variables and derived features using the current schema, uploaded evidence, and exploration context. These are provisional and need your review before continuing."
      );
    } catch (error) {
      studyTrace.fail();
      setPhase4Status({ kind: "error", message: friendlyError(error, "Candidate variable recommendation failed.") });
      pushAssistantNote(`Candidate variable recommendation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function selectGeneratedQuestion(candidate) {
    const studyTrace = beginStudyAction("button_click", "question_selection", {});
    try {
    setSelectedQuestionId(candidate.id);
    setQuestionFields(questionCandidateToFields(candidate));
    setPhase4Status({ kind: "warning", message: "Question selected as needs user review. Confirm or edit it before Phase 5." });
    pushAssistantNote("Question selected as a draft. Review the comparator, time window, and estimand direction before confirming.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function updateQuestionCandidate(id, patch) {
    setQuestionCandidates((items) => items.map((item) => (
      item.id === id ? { ...item, ...patch, status: "user_edited" } : item
    )));
  }

  function confirmCurrentQuestion(candidate = null) {
    const studyTrace = beginStudyAction("button_click", "question_confirmation", {});
    try {
    const fields = candidate ? questionCandidateToFields(candidate) : questionFields;
    if (candidate) {
      setSelectedQuestionId(candidate.id);
      setQuestionFields(fields);
    }
    const requiredFields = [["research question", fields?.question], ["population", fields?.population], ["exposure", fields?.exposure], ["comparator", fields?.comparator], ["outcome", fields?.outcome], ["time window", fields?.timeWindow], ["unit of analysis", fields?.unitOfAnalysis], ["estimand direction", fields?.estimand]];
    const missingFields = requiredFields.filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
    if (missingFields.length) {
      const message = "Complete the following before confirming: " + missingFields.join(", ") + ".";
      setPhase4Status({ kind: "warning", message });
      showToast(message);
      return;
    }
    setPhase4Status({ kind: "success", message: "Question confirmed for targeted feasibility review." });
    recordStudyEvent("question_confirmed");
    pushAssistantNote("Question confirmed for Phase 5 feasibility review. This confirms wording, not causal validity.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function buildFeasibilityPayload() {
    const dataset = firstRealDataset(datasets);
    const schema = dataset?.schema || {};
    const columns = schemaColumnNames(dataset);
    const roleNames = Object.entries(variableRoles)
      .filter(([, role]) => role && role !== "Unassigned")
      .map(([name]) => name);
    const recommendedNames = candidateVariables
      .filter((item) => item.user_decision !== "Exclude" && item.user_decision !== "Mark unavailable")
      .map((item) => item.variable_name)
      .filter(Boolean);
    const selectedVariables = [...new Set([
      ...roleNames,
      ...recommendedNames,
      ...columns.filter((column) => roleNames.includes(column) || recommendedNames.includes(column)),
    ])];
    const exposure = resolveDatasetColumn(dataset, [
      questionFields?.exposure,
      ...Object.entries(variableRoles).filter(([, role]) => role === "Exposure").map(([name]) => name),
      "acc_mean_magnitude",
      "sleep_quality",
      "sleep_duration",
    ]);
    const outcome = resolveDatasetColumn(dataset, [
      questionFields?.outcome,
      ...Object.entries(variableRoles).filter(([, role]) => role === "Outcome").map(([name]) => name),
      "label",
      "alcohol_use_event",
      "craving",
    ]);
    const participantId = schema.possible_id_columns?.[0] || resolveDatasetColumn(dataset, ["pid", "participant_id", "subject_id"]);
    const timestamp = schema.possible_timestamp_date_columns?.[0] || resolveDatasetColumn(dataset, ["time_stamp", "timestamp", "date", "time_of_day"]);
    const selectedDerived = [
      ...derivedFeatures.filter((feature) => feature.selected).map((feature) => feature.label),
      ...derivedFeatureCandidates.map((feature) => feature.feature_name).filter(Boolean),
    ];

    return {
      dataset_filename: realDatasetFilename(dataset),
      confirmed_question: questionFields?.question || "Targeted feasibility check for the selected causal design question.",
      exposure,
      outcome,
      comparator: {
        type: "continuous_unit_change",
        reference: questionFields?.comparator || "one-unit lower value",
        treatment: questionFields?.exposure ? `one-unit increase in ${exposure || questionFields.exposure}` : "one-unit increase",
      },
      time_window: {
        exposure_window: questionFields?.timeWindow || `${lagHours}h exposure window`,
        lag: questionFields?.timeWindow || `${lagHours}h lag`,
        outcome_window: "next observation window",
      },
      selected_variables: selectedVariables,
      candidate_confounders: Object.entries(variableRoles).filter(([, role]) => role === "Confounder").map(([name]) => name),
      candidate_mediators: Object.entries(variableRoles).filter(([, role]) => role === "Mediator").map(([name]) => name),
      effect_modifiers: [],
      proxy_variables: Object.entries(variableRoles).filter(([, role]) => role === "Proxy").map(([name]) => name),
      derived_features: selectedDerived,
      participant_id: participantId || "",
      timestamp: timestamp || "",
    };
  }

  async function handleRunFeasibilityCheck() {
    const studyTrace = beginStudyAction("feasibility_check", "feasibility_check", {});
    try {
    const dataset = firstRealDataset(datasets);
    if (!dataset) {
      setAction("targetedFeasibility", { kind: "error", message: "Upload a CSV dataset before running targeted feasibility." });
      return;
    }
    if (!backendStatus.connected || !dataset.savedFilename) {
      setAction("targetedFeasibility", { kind: "error", message: "Backend unavailable - start FastAPI to run Python feasibility checks." });
      return;
    }
    const payload = buildFeasibilityPayload();
    if (!payload.exposure || !payload.outcome) {
      setAction("targetedFeasibility", { kind: "error", message: "Choose an exposure and outcome that exist in the uploaded dataset before running feasibility." });
      pushAssistantNote("I could not run Phase 5 yet because the exposure/outcome could not be matched to dataset columns. Go back to Phase 4 and choose dataset-backed variables.");
      return;
    }
    setAction("targetedFeasibility", { kind: "loading", message: "Running feasibility checks…" });
    try {
      const response = await runFeasibilityCheck(payload);
      studyTrace.capture(response);
      setTargetedFeasibilityResult(response);
      recordStudyEvent("feasibility_run", { status: response.status || "unknown" });
      const issueCount = (response.blocking_issues || []).length + (response.warnings || []).length;
      setAction("targetedFeasibility", {
        kind: response.status === "not_feasible" || response.status === "requires_revision" ? "warning" : "success",
        message: `Feasibility status: ${String(response.status || "unknown").replaceAll("_", " ")} with ${issueCount} diagnostic note${issueCount === 1 ? "" : "s"}.`,
      });
      pushAssistantNote("Python calculated the feasibility diagnostics from the uploaded dataset. I can explain the implications, but these checks do not establish causality.");
    } catch (error) {
      studyTrace.fail();
      setAction("targetedFeasibility", { kind: "error", message: friendlyError(error, "Targeted feasibility check failed.") });
      pushAssistantNote(`Targeted feasibility check failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function applyVariableDecision(variableName, decision) {
    const studyTrace = beginStudyAction("variable_selection", "variable_decision", {});
    try {
    setCandidateVariables((items) => items.map((item) => (
      item.variable_name === variableName ? { ...item, user_decision: decision, status: decision === "Modify" ? "user_edited" : "needs_user_review" } : item
    )));
    if (decision === "Exclude") {
      setVariableRole(variableName, "Unassigned");
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function promotePattern(id) {
    const studyTrace = beginStudyAction("button_click", "exploration_pattern_promote", {});
    try {
    setPromotedPatterns((p) => (p.includes(id) ? p : [...p, id]));
    pushAssistantNote("Pattern promoted ✓ — it will seed a suggested question in Step 4. Promote 1–2 more if relevant, then continue.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function saveExploreView(view) {
    const studyTrace = beginStudyAction("button_click", "exploration_view_save", {});
    try {
    const savedView = {
      id: `explore-view-${Date.now()}`,
      created_at: new Date().toISOString(),
      ...view,
    };
    setSavedExploreViews((views) => [...views, savedView]);
    pushAssistantNote(`Saved exploration view: ${savedView.label}. Treat it as hypothesis-generating context only, not causal evidence.`);
    showToast("Exploration view saved.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function toggleSensitivity(id) {
    setSensitivityChecks((s) => ({ ...s, [id]: !s[id] }));
  }
  function noteFeasibilityChange() {
    const feas = computeFeasibility(datasets, lagHours, exposureThreshold);

    if (feas.verdict === "Not feasible") {
      // Find the lowest lag that restores Feasible status
      const recommendedLag = [0, 6, 12, 18, 24].find((l) => {
        if (l >= lagHours) return false;
        return computeFeasibility(datasets, l, exposureThreshold).verdict === "Feasible";
      });
      // Find the lowest threshold that restores Feasible status
      const recommendedThreshold = [10, 15, 20, 25, 30].find((t) => {
        if (t >= exposureThreshold) return false;
        return computeFeasibility(datasets, lagHours, t).verdict === "Feasible";
      });

      if (recommendedLag !== undefined) {
        const proj = computeFeasibility(datasets, recommendedLag, exposureThreshold);
        pushAssistantNote(
          `At ${lagHours}h lag your analysis-ready sample is only ~${feas.finalSample.toLocaleString()} participant-days — below the reliable estimation threshold for a mixed-logistic model. Based on your data, setting the lag to ${recommendedLag}h would recover ~${proj.finalSample.toLocaleString()} participant-days with ${proj.overlapPct}% overlap, putting you solidly into Feasible. Is ${recommendedLag}h still clinically meaningful for your sleep→craving hypothesis?`
        );
      } else if (recommendedThreshold !== undefined) {
        const proj = computeFeasibility(datasets, lagHours, recommendedThreshold);
        pushAssistantNote(
          `Your sample is down to ~${feas.finalSample.toLocaleString()} participant-days — not enough for reliable estimation. The lag alone can't rescue it at this threshold. Try lowering the minimum exposure variation to ${recommendedThreshold}% — that would give you ~${proj.finalSample.toLocaleString()} participant-days and ${proj.overlapPct}% overlap (Feasible). You'd still have enough variation in sleep quality to support a contrast.`
        );
      } else {
        pushAssistantNote(
          `At ${lagHours}h lag and ${exposureThreshold}% threshold your sample is ~${feas.finalSample.toLocaleString()} participant-days — too thin for stable estimates. I'd recommend trying a lag under 18h and an exposure threshold under 25% together. That combination should bring you above 2,000 participant-days, which is the practical floor for this estimator with repeated measures.`
        );
      }
    } else if (feas.verdict === "Marginal") {
      // Find nearest lower lag that would make it Feasible
      const recommendedLag = [0, 6, 12, 18].find((l) => {
        if (l >= lagHours) return false;
        return computeFeasibility(datasets, l, exposureThreshold).verdict === "Feasible";
      });

      if (recommendedLag !== undefined) {
        const proj = computeFeasibility(datasets, recommendedLag, exposureThreshold);
        pushAssistantNote(
          `You're Marginal at ${lagHours}h — ~${feas.finalSample.toLocaleString()} participant-days and ${feas.overlapPct}% overlap. That's workable but leaves little room for covariate adjustment. Setting the lag to ${recommendedLag}h would bring you to ~${proj.finalSample.toLocaleString()} participant-days and ${proj.overlapPct}% overlap — solidly Feasible. Biologically, ${recommendedLag}h is still a defensible window for next-day craving following a sleep disruption event.`
        );
      } else {
        const recommendedThreshold = [10, 15, 20, 25].find((t) => {
          if (t >= exposureThreshold) return false;
          return computeFeasibility(datasets, lagHours, t).verdict === "Feasible";
        });
        if (recommendedThreshold !== undefined) {
          const proj = computeFeasibility(datasets, lagHours, recommendedThreshold);
          pushAssistantNote(
            `You're Marginal at ${lagHours}h (~${feas.finalSample.toLocaleString()} participant-days, ${feas.overlapPct}% overlap). The lag is already at a reasonable clinical value, so I'd instead lower the exposure variation threshold to ${recommendedThreshold}% — that recovers ~${proj.finalSample.toLocaleString()} participant-days (${proj.overlapPct}% overlap) without changing your temporal assumption.`
          );
        } else {
          pushAssistantNote(
            `You're Marginal at ${lagHours}h — ~${feas.finalSample.toLocaleString()} participant-days and ${feas.overlapPct}% overlap. This is on the edge; if you proceed, make sure to enable the robust standard errors and random-intercept options in Analysis Strategy to compensate for the thinner sample.`
          );
        }
      }
    } else {
      pushAssistantNote(
        `Good — at ${lagHours}h lag and ${exposureThreshold}% threshold you have ~${feas.finalSample.toLocaleString()} participant-days with ${feas.overlapPct}% overlap. That's a solid foundation for a mixed-logistic model with a random participant intercept. You can proceed to the Causal Graph step.`
      );
    }
  }
  function updateNodePos(id, x, y) {
    setGraphNodes((nodes) => nodes.map((n) => (n.id === id ? { ...n, x, y } : n)));
    setGraphValidationResult(null);
  }
  function selectNode(id) {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }
  function selectEdge(id) {
    setSelectedEdgeId(id);
    setSelectedNodeId(null);
  }
  function addGraphNode() {
    const studyTrace = beginStudyAction("graph_action", "graph_node_add", {});
    try {
    const id = `custom_${Date.now()}`;
    setGraphNodes((nodes) => [...nodes, { id, label: "New variable", role: "Unassigned", temporalRole: "unknown", measurementRole: "unknown", isCore: false, x: 450, y: 460 }]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setGraphValidationResult(null);
    pushAssistantNote("Node added — name it and assign a role in the right panel (Confounder, Mediator, or Proxy). Without a role it won't appear in the adjustment set.");
    advanceGuidance("causal-graph", "first_node_added", "Node added! Now let's connect it — select it as the source and click another node to draw a causal arrow between them.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function removeGraphNode(id) {
    const studyTrace = beginStudyAction("graph_action", "graph_node_remove", {});
    try {
    setGraphNodes((nodes) => nodes.filter((n) => n.id !== id));
    setGraphEdges((edges) => edges.filter((e) => e.from !== id && e.to !== id));
    setSelectedNodeId(null);
    setGraphValidationResult(null);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function renameNode(id, label) {
    setGraphNodes((nodes) => nodes.map((n) => (n.id === id ? { ...n, label } : n)));
    setGraphValidationResult(null);
  }
  function setNodeRole(id, role) {
    const studyTrace = beginStudyAction("graph_action", "graph_node_role_change", { role: String(role).toLowerCase() });
    try {
    setVariableRole(id, role);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function addGraphEdge(from, to) {
    const studyTrace = beginStudyAction("graph_action", "graph_edge_add", {});
    try {
    setGraphEdges((edges) => {
      if (edges.some((e) => e.from === from && e.to === to)) return edges;
      return [...edges, { id: `e_${Date.now()}`, from, to, type: "uncertain", edgeType: "uncertain", confidence: "uncertain", userModified: true }];
    });
    setGraphValidationResult(null);
    pushAssistantNote(`Arrow added: ${from} → ${to} (Uncertain). Click it to mark Supported if you have evidence, or remove it if the relationship is unclear.`);
    advanceGuidance("causal-graph", "first_edge_added", "First arrow drawn — nice! Keep adding the rest of your confounders and mediators, then classify each arrow as Supported or Uncertain. When the graph looks right, check the adjustment set at the bottom — that's your signal to move on.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function removeGraphEdge(id) {
    const studyTrace = beginStudyAction("graph_action", "graph_edge_remove", {});
    try {
    setGraphEdges((edges) => edges.filter((e) => e.id !== id));
    setSelectedEdgeId(null);
    setGraphValidationResult(null);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function setEdgeType(id, type) {
    const studyTrace = beginStudyAction("graph_action", "graph_edge_change", {});
    try {
    setGraphEdges((edges) => edges.map((e) => (e.id === id ? { ...e, type, edgeType: type === "uncertain" ? "uncertain" : "directed", userModified: true } : e)));
    setGraphValidationResult(null);
    const edge = graphEdges.find((e) => e.id === id);
    if (edge) {
      pushAssistantNote(
        type === "uncertain"
          ? `${edge.from} → ${edge.to} marked Uncertain — still included in the adjustment set but flagged as unverified.`
          : `${edge.from} → ${edge.to} marked Supported ✓ — strengthens the identification argument in the study report.`
      );
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function resetGraph() {
    const studyTrace = beginStudyAction("graph_action", "graph_reset", {});
    try {
    setGraphNodes(DEFAULT_GRAPH_NODES.map((n) => ({ ...n })));
    setGraphEdges(DEFAULT_GRAPH_EDGES.map((e) => ({ ...e })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setGraphValidationResult(null);
    setGraphVersionLabel("Version 0");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function loadGraphVariant(nodes, edges) {
    const studyTrace = beginStudyAction("graph_action", "graph_variant_load", {});
    try {
    setGraphNodes(nodes.map((n) => ({ ...n })));
    setGraphEdges(edges.map((e) => ({ ...e })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setGraphValidationResult(null);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function graphBackendPayload(extra = {}) {
    const dataset = firstRealDataset(datasets);
    const schema = dataset?.schema;
    const selectedVariables = graphSelectedVariables(datasets);
    const backendNodes = frontendNodesToBackend(graphNodes, variableRoles);
    const backendEdges = frontendEdgesToBackend(graphEdges);
    const exposure = backendNodes.find((node) => node.role === "exposure")?.id || resolveDatasetColumn(dataset, [questionFields?.exposure]);
    const outcome = backendNodes.find((node) => node.role === "outcome")?.id || resolveDatasetColumn(dataset, [questionFields?.outcome]);
    const adjustmentSet = backendNodes
      .filter((node) => ["confounder", "proxy"].includes(node.role) && node.id !== exposure && node.id !== outcome && node.id !== "pid")
      .map((node) => node.id);
    return {
      graph_type: graphType,
      confirmed_question: questionFields?.question || "",
      dataset_filename: dataset?.savedFilename || dataset?.name || "",
      selected_variables: selectedVariables,
      provisional_roles: variableRoles,
      feasibility_result: targetedFeasibilityResult || feasibility,
      comparator: {
        type: "continuous_unit_change",
        reference: questionFields?.comparator || "reference condition",
        treatment: questionFields?.exposure || exposure,
      },
      time_window: {
        exposure_window: questionFields?.timeWindow || "",
        lag: questionFields?.timeWindow || `${lagHours}h lag`,
        outcome_window: "next observation window",
      },
      schema_summary: schema || {},
      locked_decisions: lockedContent,
      rag_evidence: [],
      user_feedback: "",
      preserve_user_locked_edges: true,
      nodes: backendNodes,
      edges: backendEdges,
      exposure,
      outcome,
      adjustment_set: adjustmentSet,
      timestamp_fields: schema?.possible_timestamp_date_columns || ["time_stamp", "time_of_day", "day_of_week"],
      participant_id: schema?.possible_id_columns?.[0] || "pid",
      ...extra,
    };
  }
  function analysisStrategyPayload(extra = {}) {
    const base = graphBackendPayload();
    return {
      confirmed_question: base.confirmed_question,
      graph: {
        graph_type: base.graph_type,
        nodes: base.nodes,
        edges: base.edges,
      },
      exposure: base.exposure,
      outcome: base.outcome,
      comparator: base.comparator,
      time_window: base.time_window,
      selected_variables: base.selected_variables,
      provisional_roles: base.provisional_roles,
      confirmed_roles: base.provisional_roles,
      feasibility_result: base.feasibility_result,
      schema_summary: base.schema_summary,
      rag_evidence: ragSummary ? [{ source: "rag_search", summary: ragSummary }] : [],
      user_feedback: "",
      locked_decisions: {
        ...lockedContent,
        effect_type: effectType,
        estimator_family: estimatorFamily,
        unit_of_analysis: questionFields?.unitOfAnalysis || "participant-window observation",
      },
      ...extra,
    };
  }
  async function handleGenerateAnalysisStrategy(mode = "generate", userFeedback = "") {
    const studyTrace = beginStudyAction("identification_check", "identification_check", {});
    try {
    if (!backendStatus.connected) {
      setAnalysisStrategyStatus({ kind: "error", message: "Backend unavailable - start FastAPI to run Phase 7 identification." });
      pushAssistantNote("Phase 7 needs the FastAPI backend. This page can still display draft guidance, but backend identification and validation are unavailable.");
      return;
    }
    setAnalysisStrategyStatus({ kind: "loading", message: mode === "alternative" ? "Generating alternative strategy…" : "Generating strategy and validating identification…" });
    try {
      const response = await generateAnalysisStrategy(analysisStrategyPayload({ user_feedback: userFeedback }));
      studyTrace.capture(response);
      setAnalysisStrategyResult(response);
      const recommended = response.identification?.recommended_adjustment_set || [];
      setEditableAdjustmentSet(recommended);
      setAnalysisStrategyDraft({ estimand: response.estimand || {}, strategy: response.strategy || {} });
      setAnalysisStrategyValidation(null);
      setAnalysisStrategyConfirmed(null);
      const warningCount = (response.warnings || []).length + (response.identification?.warnings || []).length;
      setAnalysisStrategyStatus({ kind: response.identification?.status === "not_identified" ? "error" : "success", message: `Identification ${response.identification?.status || "reviewed"} with ${warningCount} warning${warningCount === 1 ? "" : "s"}.` });
      pushAssistantNote("Phase 7 identification checks are complete. This defines an analysis plan only; it does not estimate effects or prove causal validity.");
    } catch (error) {
      studyTrace.fail();
      setAnalysisStrategyStatus({ kind: "error", message: friendlyError(error, "Analysis strategy generation failed.") });
      pushAssistantNote(`Phase 7 strategy generation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function handleValidateAnalysisStrategy() {
    const studyTrace = beginStudyAction("identification_check", "adjustment_validation", {});
    try {
    if (!backendStatus.connected) {
      setAnalysisStrategyStatus({ kind: "error", message: "Backend unavailable - validation needs FastAPI." });
      return;
    }
    setAnalysisStrategyStatus({ kind: "loading", message: "Validating edited adjustment set..." });
    try {
      const base = analysisStrategyPayload();
      const response = await validateAnalysisStrategy({
        graph: base.graph,
        exposure: base.exposure,
        outcome: base.outcome,
        adjustment_set: editableAdjustmentSet,
        estimand: analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand || {},
        strategy: analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy || {},
        feasibility_result: base.feasibility_result,
        schema_summary: base.schema_summary,
      });
      studyTrace.capture(response);
      setAnalysisStrategyValidation(response);
      setAnalysisStrategyStatus({ kind: response.status === "invalid" ? "error" : "success", message: `Adjustment validation ${response.status}.` });
      pushAssistantNote(response.status === "invalid"
        ? "Adjustment-set validation found blocking issues. Fix them before Phase 8."
        : "Adjustment-set validation completed. If it requires review, document the warning before continuing to estimation.");
    } catch (error) {
      studyTrace.fail();
      setAnalysisStrategyStatus({ kind: "error", message: friendlyError(error, "Analysis strategy validation failed.") });
      pushAssistantNote(`Phase 7 validation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function updateAnalysisDraft(section, key, value) {
    setAnalysisStrategyDraft((draft) => ({
      estimand: { ...(analysisStrategyResult?.estimand || {}), ...(draft?.estimand || {}) },
      strategy: { ...(analysisStrategyResult?.strategy || {}), ...(draft?.strategy || {}) },
      ...draft,
      [section]: {
        ...((section === "estimand" ? analysisStrategyResult?.estimand : analysisStrategyResult?.strategy) || {}),
        ...(draft?.[section] || {}),
        [key]: value,
      },
    }));
    setAnalysisStrategyValidation(null);
    setAnalysisStrategyConfirmed(null);
  }
  function confirmAnalysisStrategy() {
    const studyTrace = beginStudyAction("identification_check", "strategy_confirmation", {});
    try {
    const validation = analysisStrategyValidation;
    const checks = validation?.checks || {};
    if (!analysisStrategyResult) {
      showToast("Run Identification before confirming Phase 7.");
      return;
    }
    if (!validation) {
      showToast("Validate the adjustment set before confirming Phase 7.");
      return;
    }
    if (validation.status === "invalid" || graphValidationResult?.status === "invalid") {
      showToast("Phase 7 cannot be confirmed while validation is invalid.");
      return;
    }
    if (!checks.exposure_present || !checks.outcome_present || !checks.outcome_not_adjusted_for || !checks.exposure_not_adjusted_for) {
      showToast("Fix exposure/outcome adjustment-set issues before confirming Phase 7.");
      return;
    }
    if (validation.status === "requires_review" || analysisStrategyResult.requires_user_review) {
      showToast("This strategy requires expert review before estimation.");
    }
    setAnalysisStrategyConfirmed({
      result: analysisStrategyResult,
      validation,
      adjustmentSet: editableAdjustmentSet,
      draft: analysisStrategyDraft,
      confirmedAt: new Date().toISOString(),
    });
    recordStudyEvent("strategy_confirmed");
    pushAssistantNote("Analysis strategy confirmed for Phase 8. This confirms a reviewed plan, not a causal conclusion.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function generateFirstPassGraph(versionLabel = "Version 1", userFeedback = "") {
    const studyTrace = beginStudyAction("graph_action", "graph_generation", {});
    try {
    if (!backendStatus.connected) {
      setGraphActionStatus({ kind: "error", message: "Backend unavailable - graph generation needs FastAPI." });
      pushAssistantNote("Start the FastAPI backend, then generate the first-pass graph. I will keep this as a draft until deterministic validation passes.");
      return;
    }
    setGraphActionStatus({ kind: "loading", message: "Generating graph draft..." });
    try {
      const payload = graphBackendPayload({ user_feedback: userFeedback });
      const response = await generateCausalGraph(payload);
      studyTrace.capture(response);
      const converted = backendGraphToFrontend(response);
      if (converted.nodes.length) {
        setGraphNodes(converted.nodes);
        const rolePatch = {};
        converted.nodes.forEach((node) => { rolePatch[node.id] = node.role; });
        setVariableRoles((current) => ({ ...current, ...rolePatch }));
      }
      if (converted.edges.length) setGraphEdges(converted.edges);
      setGraphVersionLabel(response.version_label || versionLabel);
      setGraphValidationResult(response.validation_result || null);
      setConfirmedGraph(null);
      const warningCount = (response.validation_result?.warnings || response.warnings || []).length;
      setGraphActionStatus({ kind: "success", message: `Draft generated with ${warningCount} warning${warningCount === 1 ? "" : "s"}.` });
      pushAssistantNote("First-pass causal graph generated. This is a draft for review; deterministic Python validation checks structure, timing, roles, and adjustment risks before continuation.");
    } catch (error) {
      studyTrace.fail();
      setGraphActionStatus({ kind: "error", message: friendlyError(error, "Graph generation failed.") });
      pushAssistantNote(`Graph generation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  async function validateCurrentGraph() {
    const studyTrace = beginStudyAction("graph_action", "graph_validation", {});
    try {
    if (!backendStatus.connected) {
      setGraphActionStatus({ kind: "error", message: "Backend unavailable - validation needs FastAPI." });
      return;
    }
    setGraphActionStatus({ kind: "loading", message: "Validating graph…" });
    try {
      const payload = graphBackendPayload();
      const response = await validateCausalGraph(payload);
      studyTrace.capture(response);
      setGraphValidationResult(response);
      recordStudyEvent("graph_saved_or_validated", { status: response.status || "unknown" });
      const problemCount = (response.errors?.length || 0) + (response.warnings?.length || 0);
      setGraphActionStatus({ kind: response.status === "invalid" ? "error" : "success", message: `Graph validation completed: ${response.status}; ${problemCount} issue${problemCount === 1 ? "" : "s"}.` });
      pushAssistantNote(response.safe_to_continue
        ? "Graph validation completed. Review warnings carefully; warning-level graphs may continue only after user review."
        : "Graph validation found blocking errors. Fix cycles, self-loops, unknown nodes, or invalid adjustment choices before continuing.");
    } catch (error) {
      studyTrace.fail();
      setGraphActionStatus({ kind: "error", message: friendlyError(error, "Graph validation failed.") });
      pushAssistantNote(`Graph validation failed: ${friendlyError(error)}`);
    }

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function generateAlternativeGraph() {
    const next = graphAlternatives.length + 1;
    setGraphAlternatives((items) => [...items, { label: graphVersionLabel || `Alternative ${next}`, nodes: graphNodes, edges: graphEdges, validation: graphValidationResult }]);
    generateFirstPassGraph(`Alternative ${next}`, "Generate a defensible alternative structure while preserving locked user edits.");
  }
  function saveGraphAlternative() {
    const studyTrace = beginStudyAction("graph_action", "graph_alternative_save", {});
    try {
    setGraphAlternatives((items) => [...items, { label: graphVersionLabel || `Alternative ${items.length + 1}`, nodes: graphNodes, edges: graphEdges, validation: graphValidationResult }]);
    showToast("Alternative graph saved.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function confirmGraph() {
    const studyTrace = beginStudyAction("graph_action", "graph_confirmation", {});
    try {
    if (graphValidationResult?.status === "invalid") {
      showToast("Graph validation is invalid. Fix errors before confirming the graph.");
      return;
    }
    if (!graphValidationResult) {
      showToast("Validate the graph before confirming it.");
      return;
    }
    if (graphValidationResult.status === "valid_with_warnings") {
      showToast("Confirmed with warnings. These limitations must stay visible in downstream reporting.");
    }
    setConfirmedGraph({ graphType, graphVersionLabel, nodes: graphNodes, edges: graphEdges, validation: graphValidationResult });
    recordStudyEvent("graph_saved_or_validated", { status: "confirmed" });
    pushAssistantNote("Graph confirmed for downstream planning. This confirms a reviewed design draft, not a proven causal structure.");
    showToast("Graph confirmed.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function reverseGraphEdge(id) {
    const studyTrace = beginStudyAction("graph_action", "graph_edge_reverse", {});
    try {
    setGraphEdges((edges) => edges.map((edge) => edge.id === id ? { ...edge, from: edge.to, to: edge.from, userModified: true, type: "uncertain", edgeType: "uncertain" } : edge));
    setGraphValidationResult(null);

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function toggleEdgeLock(id) {
    const studyTrace = beginStudyAction("graph_action", "graph_edge_lock", {});
    try {
    setGraphEdges((edges) => edges.map((edge) => edge.id === id ? { ...edge, locked: !edge.locked, userModified: true } : edge));

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function toggleRepeatedMeasures(id) {
    setRepeatedMeasuresChecks((s) => ({ ...s, [id]: !s[id] }));
  }

  function setVariableRole(name, role) {
    const studyTrace = beginStudyAction("variable_selection", "variable_role_change", { role: String(role).toLowerCase() });
    try {
    setVariableRoles((r) => {
      const next = { ...r };
      if (role === "Exposure" || role === "Outcome") {
        Object.keys(next).forEach((key) => {
          if (key !== name && next[key] === role) next[key] = "Unassigned";
        });
      }
      next[name] = role;
      return next;
    });
    setGraphValidationResult(null);
    recordStudyEvent("variable_roles_confirmed", { variable: name, role });
    const schemaVar = ROLE_TABLE_VARIABLES.find((v) => v.name === name);
    if (schemaVar) {
      if (role === schemaVar.roleGuess) {
        pushAssistantNote(`${name} → ${role} ✓ — matches the suggested role from prior evidence.`);
      } else {
        const reason = ROLE_CAUTION_TEXT[name] || "similar studies usually treat it differently";
        pushAssistantNote(`${name} → ${role} flagged: ${reason}. Change it back in Causal Graph (Step 6) if needed.`);
      }
    } else {
      pushAssistantNote(`${name} → ${role}. Add an arrow for it in Causal Graph to include it in the adjustment set.`);
    }
    advanceGuidance("question", "first_role_assigned", "First role assigned — keep going! Once every variable has a role, you're all set. Click Continue to Feasibility and we'll check if the data can actually support the analysis.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }
  function selectSuggestedQuestion(pid, altQuestion) {
    beginStudyAction("button_click", "suggested_question_selection").success();
    const q = QUESTION_TEMPLATES[pid];
    if (!q) return;
    setSelectedQuestionId(pid);
    setQuestionFields({ ...q, question: altQuestion || q.question });
    pushAssistantNote("Question selected ✓ — review each field below and adjust anything that doesn't match your design, especially the time window and estimand.");
    advanceGuidance("question", "question_selected", "Great choice! Now review the seven fields below and tweak anything that doesn't quite match your design — especially the time window and estimand. Then assign a role to each variable in the table.");
  }
  function writeOwnQuestion() {
    beginStudyAction("button_click", "question_draft_start").success();
    setSelectedQuestionId("custom");
    setQuestionFields({ ...BLANK_QUESTION_FIELDS });
    pushAssistantNote("Fill in all seven fields: population, exposure, comparator, outcome, time window, unit of analysis, and estimand. Every field stays editable through Step 5.");
    advanceGuidance("question", "question_selected", "Love it — writing your own question! Fill in all seven fields and then assign roles to each variable in the table below. Take your time, every field matters.");
  }
  function updateQuestionField(key, value) {
    setQuestionFields((f) => ({ ...f, [key]: value }));
  }
  function noteQuestionFieldEdit(key) {
    if (key === "timeWindow") {
      pushAssistantNote("Time window updated — test this lag value in Feasibility (Step 5) to see how it affects sample size.");
    } else if (key === "estimand") {
      pushAssistantNote("Estimand updated ✓ — confirm it's supported by the estimator you choose in Analysis Strategy.");
    }
  }
  function toggleDerivedFeature(id) {
    const studyTrace = beginStudyAction("variable_selection", "derived_feature_toggle", {});
    try {
    setDerivedFeatures((list) => list.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  function applyFeedback() {
    if (!feedbackApplied) {
      setObjective((o) => o + (o.endsWith(".") || o.length === 0 ? "" : ".") + " Timing of exposure relative to outcome will be defined in a later step.");
      setFeedbackApplied(true);
    }
    setShowFeedback(false);
  }
  function reviewObjective() {
    const studyTrace = beginStudyAction("button_click", "objective_review", {});
    try {
    setShowFeedback(true);
    pushAssistantNote("Objective reviewed — see feedback below. Address any flagged gaps, then upload your dataset in the section below.");
    advanceGuidance("setup", "objective_reviewed", "Nice — objective saved! Now upload your primary dataset below ↓. You can add one file per data source (EMA, wearable, clinical, etc.). The readiness checklist at the top will tick off as you go.");

    studyTrace.success();
    } catch (studyError) { studyTrace.fail(); throw studyError; }
    finally { studyTrace.finish(); }
  }

  const blockingDatasets = datasets.some((d) => d.status === "blocking");
  const nonBlockingWarnings = datasets.some((d) => d.status === "clarification" || d.status === "warning") || (dictionary && dictionary.described < dictionary.total);

  const checks = useMemo(() => {
    const approvedWorkspaceLoaded = studyMode?.status === "ready";
    const objectiveAdded = approvedWorkspaceLoaded || objective.trim().length > 0;
    const datasetUploaded = approvedWorkspaceLoaded || datasets.length > 0;
    const datasetParsed = approvedWorkspaceLoaded || (datasetUploaded && !blockingDatasets);
    const dictionaryUploaded = approvedWorkspaceLoaded || !!dictionary;
    const variablesMatched = approvedWorkspaceLoaded || (!!dictionary && dictionary.described === dictionary.total);
    const blockingResolved = approvedWorkspaceLoaded || !blockingDatasets;
    return { objectiveAdded, datasetUploaded, datasetParsed, dictionaryUploaded, variablesMatched, blockingResolved };
  }, [objective, datasets, dictionary, blockingDatasets, studyMode]);

  const requiredCount = Object.values(checks).filter(Boolean).length;
  const requiredTotal = 6;
  const canContinue = checks.objectiveAdded && checks.datasetUploaded && checks.datasetParsed && checks.dictionaryUploaded && checks.blockingResolved;

  const dataFoundationComplete = useMemo(() => {
    const parsedOk = datasets.length > 0 && !blockingDatasets;
    const participantFields = [...new Set(datasets.map((d) => d.participantField).filter(Boolean))];
    const linkingOk = datasets.length < 2 || participantFields.length <= 1;
    const multiTimestamp = datasets.some((d) => d.timestampFields && d.timestampFields.length > 1);
    return parsedOk && linkingOk && !multiTimestamp;
  }, [datasets, blockingDatasets]);

  function goToPage(key, navigationSource = "workflow") {
    if (key === page) return;
    if (!BUILT_PAGES.includes(key)) {
      showToast("This page hasn't been built in the prototype yet.");
      return;
    }
    dashboardEvents.enter(key, navigationSource);
    setPage(key);
    recordStudyEvent("phase_changed", { phase: key });
    if (!visited[key]) {
      setVisited((v) => ({ ...v, [key]: true }));
      pushAssistantNote(PAGE_INTRO_MESSAGES[key], key);
      if (key === "data-foundation") {
        pushAssistantNote(buildDataSummary(datasets, dictionary), key);
        pushAssistantNote(buildClarificationAsk(), key);
      }
    }
  }

  function handleContinue() {
    if (nonBlockingWarnings) setAckOpen(true);
    else goToPage("data-foundation");
  }

  function buildAssistantPageState(pageKey) {
    const dataset = firstRealDataset(datasets);
    const schema = dataset?.schema;
    const activeWarnings = [
      ...(targetedFeasibilityResult?.warnings || []),
      ...(graphValidationResult?.warnings || []),
      ...(analysisStrategyValidation?.warnings || []),
      ...estimationRunWarnings(primaryEstimationRun || latestEstimationRun),
    ].filter(Boolean);
    const base = {
      page: pageKey,
      research_objective: objective,
      backend_connected: backendStatus.connected,
      study_mode_active: Boolean(studyMode),
      study_mode: studyMode ? {
        label: studyMode.label,
        task: "Fixed BDE causal-design task",
        approved_dataset: studyMode.dataset?.label || "Approved study dataset",
        frozen_artifacts: "Prepared draft — editable, not yet confirmed.",
        graph_boundary: "Assumption-based graph draft — not causal proof.",
        numerical_boundary: "Numerical values must be backend-computed.",
      } : null,
      selected_question: questionFields || {},
      selected_exposure: questionFields?.exposure || Object.entries(variableRoles).find(([, role]) => role === "Exposure")?.[0] || null,
      selected_outcome: questionFields?.outcome || Object.entries(variableRoles).find(([, role]) => role === "Outcome")?.[0] || null,
      selected_covariates: Object.entries(variableRoles).filter(([, role]) => role === "Confounder").map(([name]) => name),
      feasibility_status: targetedFeasibilityResult?.status || feasibility?.verdict || "not run",
      graph_status: graphValidationResult?.status || (confirmedGraph ? "confirmed" : "draft/not validated"),
      strategy_status: analysisStrategyConfirmed ? "confirmed" : analysisStrategyValidation?.status || "draft/not validated",
      estimation_status: primaryEstimationRun ? "primary selected" : latestEstimationRun ? "computed/not selected" : "not run",
      report_status: primaryEstimationRun ? "ready for review and claim audit" : "draft/incomplete",
      active_warnings: activeWarnings,
      dataset_filename: dataset?.savedFilename || dataset?.name || "",
      active_dataset_schema: schema ? {
        filename: dataset?.savedFilename || dataset?.name || "",
        column_names: schema.column_names || [],
        possible_numeric_columns: schema.possible_numeric_columns || [],
        possible_categorical_columns: schema.possible_categorical_columns || [],
      } : {},
    };

    if (pageKey === "setup") {
      return {
        ...base,
        datasets: datasets.map((item) => ({
          filename: item.savedFilename || item.name,
          original_filename: item.originalFilename || item.name,
          rows: item.rows,
          columns: item.cols,
          status: item.status,
          possible_id_columns: item.participantField ? [item.participantField] : [],
          possible_timestamp_columns: item.timestampFields || [],
          column_names: item.schema?.column_names || [],
        })),
        documents: {
          dictionary_uploaded: Boolean(dictionary),
          protocol_uploaded: Boolean(protocol),
          papers_uploaded: papers.length,
          guidelines_uploaded: guidelines.length,
          ingestion_status: ingestionInfo,
          rag_summary: ragSummary,
        },
        readiness: checks,
      };
    }

    if (pageKey === "data-foundation") {
      return {
        ...base,
        dataset_filename: dataset?.savedFilename || dataset?.name,
        rows: schema?.number_of_rows ?? dataset?.rows,
        columns: schema?.number_of_columns ?? dataset?.cols,
        possible_id_columns: schema?.possible_id_columns || (dataset?.participantField ? [dataset.participantField] : []),
        possible_timestamp_columns: schema?.possible_timestamp_date_columns || dataset?.timestampFields || [],
        high_missingness: topMissingness(schema, 8)
          .filter((item) => item.pct >= 30)
          .map((item) => ({ column: item.name, missing_percent: Number(item.pct.toFixed(2)) })),
        descriptive_schema_rows: schemaRows(schema, 20).map((item) => ({
          variable: item.name,
          type: item.type,
          source: item.source,
          descriptive_label: item.tag,
          missing_percent: item.missingPct,
        })),
        data_quality_warnings: schema?.warnings || [],
      };
    }

    if (pageKey === "explore") {
      return {
        ...base,
        dataset_filename: dataset?.savedFilename || dataset?.name,
        broad_exploration: broadExploration,
        promoted_patterns: promotedPatterns,
        active_filters: {
          note: "Frontend chart filters are display controls only unless backend output is present.",
        },
        exploration_warning: broadExploration?.exploration_warning || "Exploratory patterns can support hypothesis generation, but they do not establish causality.",
      };
    }

    if (pageKey === "feasibility") {
      const selectedVariables = [
        ...new Set([
          ...Object.entries(variableRoles)
            .filter(([, role]) => role && role !== "Unassigned")
            .map(([name]) => name),
          ...(targetedFeasibilityResult?.selected_variables_checked || []),
        ]),
      ];
      return {
        ...base,
        phase: "phase_5_feasibility",
        dataset_filename: dataset?.savedFilename || dataset?.name,
        confirmed_question: questionFields || {},
        feasibility_result: targetedFeasibilityResult || {},
        targeted_feasibility_result: targetedFeasibilityResult || {},
        selected_variables: selectedVariables,
        schema_summary: schema || {},
        rag_evidence: [],
        variable_roles: variableRoles,
        status_message: targetedFeasibilityResult?.summary,
        safety_note: "Python feasibility diagnostics do not establish causality or estimate an effect.",
      };
    }

    if (pageKey === "graph") {
      const currentGraph = {
        graph_type: graphType,
        version_label: graphVersionLabel,
        nodes: frontendNodesToBackend(graphNodes, variableRoles),
        edges: frontendEdgesToBackend(graphEdges),
        alternatives_saved: graphAlternatives.length,
        confirmed: Boolean(confirmedGraph),
      };
      return {
        ...base,
        phase: "phase_6_causal_graph",
        dataset_filename: dataset?.savedFilename || dataset?.name,
        confirmed_question: questionFields?.question || DEFAULT_CONFIRMED_QUESTION,
        current_graph: currentGraph,
        selected_node: graphNodes.find((node) => node.id === selectedNodeId) || null,
        selected_edge: graphEdges.find((edge) => edge.id === selectedEdgeId) || null,
        validation_result: graphValidationResult || {},
        feasibility_result: targetedFeasibilityResult || feasibility || {},
        rag_evidence: ragSummary ? [{ source_filename: "RAG evidence summary", text: ragSummary }] : [],
        safety_note: "Graph edges are assumptions, not proven causal relationships. The LLM can draft graph alternatives, but backend validation checks graph structure.",
      };
    }

    if (pageKey === "strategy") {
      const basePayload = analysisStrategyPayload();
      return {
        ...base,
        phase: "phase_7_analysis_strategy",
        dataset_filename: dataset?.savedFilename || dataset?.name,
        confirmed_question: questionFields || {},
        graph: basePayload.graph,
        graph_validation_result: graphValidationResult || confirmedGraph?.validation || {},
        feasibility_result: targetedFeasibilityResult || feasibility || {},
        identification_result: analysisStrategyResult?.identification || {},
        adjustment_set: editableAdjustmentSet || [],
        estimand: analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand || {},
        strategy: analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy || {},
        assumption_checklist: analysisStrategyResult?.assumption_checklist || [],
        analysis_strategy_validation: analysisStrategyValidation || {},
        rag_evidence: ragSummary ? [{ source_filename: "RAG evidence summary", text: ragSummary }] : [],
        safety_note: "Phase 7 defines the analysis plan. It does not calculate treatment effects, and backend checks do not prove causal validity.",
      };
    }

    if (pageKey === "estimation") {
      const selectedRun = primaryEstimationRun || latestEstimationRun;
      const selectedRaw = selectedRun?.raw || {};
      const diagnostics = selectedRun?.results?.diagnostics || selectedRaw?.diagnostics || {};
      const warnings = estimationRunWarnings(selectedRun);
      return {
        ...base,
        phase: "phase_8_estimation",
        dataset_filename: dataset?.savedFilename || dataset?.name,
        confirmed_question: questionFields || {},
        estimation_config: selectedRun?.config || {
          exposure: questionFields?.exposure || "not selected",
          outcome: questionFields?.outcome || "not selected",
          adjustment_set: editableAdjustmentSet || [],
          estimator_family: estimatorFamily,
          effect_type: effectType,
        },
        validation_result: selectedRaw?.readiness || {},
        estimation_result: selectedRaw || selectedRun || {},
        diagnostics,
        warnings,
        provenance: selectedRaw?.provenance || selectedRaw?.reproducibility || selectedRun?.config || {},
        selected_primary_estimation_run: primaryEstimationRun,
        latest_estimation_run: latestEstimationRun,
        safety_note: "Phase 8 uses backend Python/statsmodels to compute numerical outputs. The assistant may explain returned values only and must not invent estimates or claim causality is proven.",
      };
    }

    return {
      ...base,
      dataset_filename: dataset?.savedFilename || dataset?.name,
      confirmed_question: questionFields?.question,
      selected_question_id: selectedQuestionId,
      variable_roles: variableRoles,
      feasibility,
      targeted_feasibility_result: targetedFeasibilityResult,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      graph_type: graphType,
      graph_version_label: graphVersionLabel,
      graph_validation_result: graphValidationResult,
      confirmed_graph: confirmedGraph,
      graph_alternative_count: graphAlternatives.length,
      identification_result: analysisStrategyResult?.identification,
      adjustment_set: editableAdjustmentSet,
      estimand: analysisStrategyDraft?.estimand || analysisStrategyResult?.estimand,
      strategy: analysisStrategyDraft?.strategy || analysisStrategyResult?.strategy,
      assumption_checklist: analysisStrategyResult?.assumption_checklist || [],
      analysis_strategy_validation: analysisStrategyValidation,
      analysis_strategy_confirmed: Boolean(analysisStrategyConfirmed),
      estimation_validation: pageKey === "estimation" ? null : undefined,
      latest_estimation_run: latestEstimationRun,
      selected_primary_estimation_run: primaryEstimationRun,
      selected_node_id: selectedNodeId,
      selected_edge_id: selectedEdgeId,
      effect_type: effectType,
      estimator_family: estimatorFamily,
      repeated_measures_checks: repeatedMeasuresChecks,
    };
  }

  function buildAssistantSelectedItem(pageKey, prompt) {
    if (pageKey === "data-foundation") {
      const schema = firstRealDataset(datasets)?.schema;
      return {
        prompt,
        high_missingness: topMissingness(schema, 5).filter((item) => item.pct >= 30),
      };
    }
    if (pageKey === "explore") {
      return {
        prompt,
        warnings: broadExploration?.data_quality_warnings || [],
        correlations: broadExploration?.broad_correlation_summary || null,
      };
    }
    if (pageKey === "feasibility") {
      return {
        prompt,
        feasibility_status: targetedFeasibilityResult?.status,
        warnings: targetedFeasibilityResult?.warnings || [],
        blocking_issues: targetedFeasibilityResult?.blocking_issues || [],
        recommended_revisions: targetedFeasibilityResult?.recommended_revisions || [],
      };
    }
    if (pageKey === "graph") {
      return {
        prompt,
        selected_node: graphNodes.find((node) => node.id === selectedNodeId) || null,
        selected_edge: graphEdges.find((edge) => edge.id === selectedEdgeId) || null,
        validation_status: graphValidationResult?.status || "not_validated",
        validation_errors: graphValidationResult?.errors || [],
        validation_warnings: graphValidationResult?.warnings || [],
      };
    }
    if (pageKey === "estimation") {
      return {
        prompt,
        latest_estimation_run: latestEstimationRun,
        selected_primary_estimation_run: primaryEstimationRun,
        warnings: estimationRunWarnings(primaryEstimationRun || latestEstimationRun),
      };
    }
    if (pageKey === "review") {
      return {
        prompt,
        selected_primary_estimation_run: primaryEstimationRun,
        final_design_summary: {
          confirmed_question: questionFields?.question,
          graph_confirmed: Boolean(confirmedGraph),
          strategy_confirmed: Boolean(analysisStrategyConfirmed),
        },
        warnings: estimationRunWarnings(primaryEstimationRun || latestEstimationRun),
      };
    }
    return { prompt };
  }

  async function runAssistantAction(prompt) {
    const studyTrace = beginStudyAction("button_click", "assistant_action");
    const chatTrace = dashboardEvents.chat(page, prompt);
    const phase = ASSISTANT_PHASE_MAP[page];
    const useBackendAction = Boolean(ASSISTANT_PHASE_MAP[page]);
    setAssistantThreads((t) => ({ ...t, [page]: [...(t[page] || []), { role: "user", text: prompt }] }));

    setAssistantThinking(true);
    setAssistantThinkingMessage("Assistant is reviewing the current page state...");
    try {
      const pageState = buildAssistantPageState(page);
      const response = await assistantAction({
        phase,
        action: assistantActionForPrompt(page, prompt),
        page_state: pageState,
        selected_item: buildAssistantSelectedItem(page, prompt),
        user_feedback: prompt,
        rag_evidence: pageState.rag_evidence || [],
      });
      setAssistantThreads((t) => ({
        ...t,
        [page]: [...(t[page] || []), chatTrace.message(assistantMessageFromResponse(response), response)],
      }));
      setBackendStatus({ checked: true, connected: true, message: "Connected to FastAPI" });
      studyTrace.success();
      return assistantMessageFromResponse(response);
    } catch (error) {
      const fallbackText = `LLM response is unavailable, but I can still explain the current workflow state using deterministic dashboard information.\n\n${friendlyError(error)}`;
      setAssistantThreads((t) => ({
        ...t,
        [page]: [
          ...(t[page] || []),
          chatTrace.message(fallbackText, {}, "fallback_response"),
        ],
      }));
      studyTrace.fail();
      return fallbackText;
    } finally {
      setAssistantThinking(false);
    }
  }
  async function submitAssistantInput() {
    const q = assistantInput.trim();
    if (!q || typedChatPending.current || assistantThinking) return;
    const chatTrace = dashboardEvents.chat(page, q);
    const originPage = page;
    const context = buildChatContext(state, page, {
      checks,
      alignment: activeReportConfiguration(state, primaryEstimationRun),
      review: reviewContextRef.current,
    });
    const datasetKey = `${context.dataset.filename}:${context.bde_workspace_active}`;
    if (typedChatDataset.current !== datasetKey) typedChatHistory.current = [];
    typedChatDataset.current = datasetKey;
    const history = recentChatHistory(typedChatHistory.current);
    typedChatPending.current = true;
    setAssistantInput("");
    setAssistantThinking(true);
    setAssistantThinkingMessage("Thinking...");
    setAssistantThreads(t => ({ ...t, [originPage]: [...(t[originPage] || []), { role: 'user', text: q }] }));
    try {
      const response = await assistantChat({ message: q, workflow_step: originPage, context, history });
      const answer = assistantMessageFromResponse(response);
      typedChatHistory.current = recentChatHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: answer }]);
      setAssistantThreads(t => ({ ...t, [originPage]: [...(t[originPage] || []), { ...chatTrace.message(answer, response), warning: response.warning }] }));
    } catch (error) {
      const answer = `I couldn't reach the chat service. ${friendlyError(error)} Please try again.`;
      setAssistantThreads(t => ({ ...t, [originPage]: [...(t[originPage] || []), chatTrace.message(answer, {}, "error_response")] }));
    } finally {
      typedChatPending.current = false;
      setAssistantThinking(false);
    }
  }

  const feasibility = useMemo(() => computeFeasibility(datasets, lagHours, exposureThreshold), [datasets, lagHours, exposureThreshold]);

  function handleAssistantNext() {
    const nextPage = NEXT_PAGE[page];
    if (!nextPage) return;
    if (page === "setup") {
      handleContinue();
      return;
    }
    if (page === "question") {
      if (!questionFields?.question?.trim() || (!selectedQuestionId && phase4Status?.kind !== "success")) {
        showToast("Please confirm or use a research question before continuing.");
        return;
      }
      if (!questionFields.exposure?.trim()) {
        showToast("Please select one exposure variable before continuing to Feasibility.");
        return;
      }
      if (!questionFields.outcome?.trim()) {
        showToast("Please select one outcome variable before continuing to Feasibility.");
        return;
      }
    }
    if (page === "feasibility" && !targetedFeasibilityResult?.safe_to_continue_to_graph) {
      showToast("Run feasibility checks and review the result before continuing to Causal Graph.");
      return;
    }
    if (page === "graph" && !confirmedGraph && !graphAlternatives.length) {
      showToast("Please confirm the graph or save it as a draft before continuing to Analysis Strategy.");
      return;
    }
    if (page === "strategy" && !analysisStrategyConfirmed) {
      showToast("Run identification, validate the adjustment set, and confirm the analysis strategy before continuing to Estimation.");
      return;
    }
    if (page === "estimation" && !primaryEstimationRun) {
      showToast("Run backend estimation and select a primary result before continuing to Review and Export.");
      return;
    }
    goToPage(nextPage, "assistant");
  }

  const actions = {
    reviewContextRef,
    setObjective, setShowFeedback, applyFeedback, reviewObjective, addDatasets, removeDataset, toggleDataset, replaceDataset,
    addDictionary, setDictionary, addProtocol, setProtocol, addPapers, setPapers, addGuidelines, setGuidelines,
    checks, requiredCount, requiredTotal, canContinue, handleContinue, showToast, blockingDatasets, promotePattern, saveExploreView, goToPage,
    beginStudyAction, beginStudyChat: (prompt) => dashboardEvents.chat(page, prompt), handleDocumentIngestion, handleDictionaryRagCheck, handleBroadExploration, startFixedBdeStudyMode, resetApprovedBdeWorkspaceVariables, applySelectedEstimationCovariatesToReportDraft, recordStudyEvent, exportStudySessionLog,
    handleGenerateQuestionCandidates, handleRecommendCandidateVariables, selectGeneratedQuestion, updateQuestionCandidate, confirmCurrentQuestion,
    phase4Feedback, setPhase4Feedback, applyVariableDecision,
    handleRunFeasibilityCheck,
    runAssistantAction, advanceGuidance,
    setVariableRole, selectSuggestedQuestion, writeOwnQuestion, updateQuestionField, noteQuestionFieldEdit, toggleDerivedFeature,
    setLagHours, setExposureThreshold, toggleSensitivity, noteFeasibilityChange,
    updateNodePos, selectNode, selectEdge, addGraphNode, removeGraphNode, renameNode, setNodeRole, addGraphEdge, removeGraphEdge, setEdgeType, resetGraph, loadGraphVariant,
    setGraphType, generateFirstPassGraph, validateCurrentGraph, generateAlternativeGraph, saveGraphAlternative, confirmGraph, reverseGraphEdge, toggleEdgeLock,
    handleGenerateAnalysisStrategy, handleValidateAnalysisStrategy, updateAnalysisDraft, setEditableAdjustmentSet, confirmAnalysisStrategy,
    setEffectType, setEstimatorFamily, toggleRepeatedMeasures,
    setLatestEstimationRun, setPrimaryEstimationRun,
    pushAssistantNote,
    lockContent, unlockContent, lockedContent,
  };
  const state = {
    objective, showFeedback, feedbackApplied, datasets, dictionary, protocol, papers, guidelines, promotedPatterns, savedExploreViews,
    backendStatus, actionStatus, ingestionInfo, ragSummary, broadExploration, studyMode, studySessionLog, studyReportDraft,
    variableRoles, selectedQuestionId, questionFields, questionCandidates, candidateVariables, derivedFeatureCandidates, phase4Status, derivedFeatures,
    lagHours, exposureThreshold, sensitivityChecks, feasibility, targetedFeasibilityResult,
    graphNodes, graphEdges, selectedNodeId, selectedEdgeId, graphType, graphValidationResult, graphAlternatives, confirmedGraph, graphVersionLabel, graphActionStatus,
    analysisStrategyResult, analysisStrategyValidation, analysisStrategyDraft, editableAdjustmentSet, analysisStrategyConfirmed, analysisStrategyStatus,
    effectType, estimatorFamily, repeatedMeasuresChecks, latestEstimationRun, primaryEstimationRun,
    lockedContent,
  };

  return (
    <div className="ps-root">
      <style>{STYLE}</style>

      <div className="leftnav">
        <div className="leftnav-brand"><span className="dot" /> Causal Studio</div>
        {STEPS.map((s, i) => (
          <button key={s.key} className={`nav-item ${page === s.key ? "active" : ""}`} title={s.full} onClick={() => goToPage(s.key, "sidebar")}>
            <span className="num">{i + 1}</span>
            {s.short}
            {!BUILT_PAGES.includes(s.key) && <Lock size={11} className="lock" />}
          </button>
        ))}
        <div className="nav-footer">Dr. research lead</div>
      </div>

      <div className={`main-col text-justify ${page === "graph" ? "main-col-canvas" : ""}`}>
        <WorkflowActivityIndicator page={page} state={state} />
        <PanelErrorBoundary key={page}>
        {page === "setup" && <ProjectSetupView state={state} actions={actions} />}
        {page === "data-foundation" && <DataFoundationView state={state} actions={actions} />}
        {page === "explore" && (
          <ExploreView state={state} actions={actions} onGoNext={() => goToPage("question")} />
        )}
        {page === "question" && (
          <QuestionView state={state} actions={actions} onGoNext={() => goToPage("feasibility")} />
        )}
        {page === "feasibility" && (
          <FeasibilityView state={state} actions={actions} onGoNext={() => goToPage("graph")} />
        )}
        {page === "graph" && (
          <GraphView state={state} actions={actions} onGoNext={() => goToPage("strategy")} />
        )}
        {page === "strategy" && (
          <StrategyViewPhase7 state={state} actions={actions} onGoNext={() => goToPage("estimation")} />
        )}
        {page === "estimation" && (
          <EstimationView state={state} actions={actions} onGoNext={() => goToPage("review")} />
        )}
        {page === "review" && <ReviewView state={state} actions={actions} />}
        </PanelErrorBoundary>
      </div>

      <div className="assistant-col">
        <PanelErrorBoundary key={page}>
        <div className="assistant-head"><Sparkles size={15} color="var(--accent)" /><span>AI research assistant</span></div>
        <div className="assistant-body" ref={assistantScrollRef}>
          {assistantThread.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "msg-user" : "msg-assistant text-justify"}`}>
              {m.text}
              {m.warning && <div style={{ fontSize: 11, marginTop: 8, color: "var(--text-3)" }}>{m.warning}</div>}
            </div>
          ))}
          {assistantThinking && <div className="msg msg-assistant">{assistantThinkingMessage}</div>}
        </div>
        <div className="assistant-questions">
          {(
            page === "setup" ? SETUP_QUESTIONS
            : page === "data-foundation" ? DF_QUESTIONS
            : page === "explore" ? EXPLORE_QUESTIONS
            : page === "question" ? QUESTION_PAGE_QUESTIONS
            : page === "feasibility" ? FEASIBILITY_QUESTIONS
            : page === "graph" ? GRAPH_QUESTIONS
            : page === "strategy" ? STRATEGY_QUESTIONS
            : page === "estimation" ? ESTIMATION_QUESTIONS
            : REVIEW_QUESTIONS
          ).map((q) => (
            <button key={q} className="assistant-q" onClick={() => runAssistantAction(q)}>{q}</button>
          ))}
        </div>
        {NEXT_PAGE[page] && (
          <div className="assistant-next-row">
            <button className="assistant-next-btn" onClick={handleAssistantNext}>
              Next: {STEPS.find((s) => s.key === NEXT_PAGE[page])?.short} <ArrowRight size={13} />
            </button>
          </div>
        )}
        <div className="assistant-caveat">LLM guidance only — not numerical estimation. The assistant uses the current dashboard state and FastAPI responses to explain the workflow; it does not make clinical decisions, diagnose patients, or judge whether data are sufficient for causal inference.</div>
        <div className="assistant-inputbar">
          <input placeholder="Ask a question\u2026" value={assistantInput} onChange={(e) => setAssistantInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitAssistantInput()} />
          <button className="assistant-send" aria-label="Send" onClick={submitAssistantInput}><Send size={15} /></button>
        </div>
        </PanelErrorBoundary>
      </div>

      {ackOpen && (
        <div className="overlay" onClick={() => setAckOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Continue with unresolved warnings?</h3>
            <p>You can continue with unresolved nonblocking warnings. These issues will remain visible in Data Foundation.</p>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setAckOpen(false)}>Return and review</button>
              <button className="btn btn-primary" onClick={() => { setAckOpen(false); goToPage("data-foundation"); }}>Continue with warnings</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
