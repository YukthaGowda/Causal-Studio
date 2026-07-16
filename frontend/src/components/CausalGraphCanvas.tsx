import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  addEdge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type {
  BackendCausalGraphValidation,
  CausalGraphDraft,
  CausalGraphEdge,
  CausalGraphNode,
} from "../types/api";

type CausalGraphCanvasProps = {
  graphDraft: CausalGraphDraft | null;
  validation: BackendCausalGraphValidation | null;
  onGraphChange: (graphDraft: CausalGraphDraft) => void;
};

type GraphNodeData = {
  label: string;
  role: string;
  temporalRole: string;
  warning: boolean;
};

type GraphEdgeData = {
  uncertain?: boolean;
  confidence?: string;
  rationale?: string;
  temporalAssumption?: string;
  supportingEvidence?: string[];
};

const roleColors: Record<string, string> = {
  exposure: "#dbeafe",
  outcome: "#fee2e2",
  confounder: "#dcfce7",
  mediator: "#fef3c7",
  collider: "#fce7f3",
  proxy: "#ede9fe",
  temporal: "#e0f2fe",
  unknown: "#f8fafc",
};

function normalizeRole(role: string) {
  const normalized = role.toLowerCase();
  if (normalized.includes("exposure")) return "exposure";
  if (normalized.includes("outcome")) return "outcome";
  if (normalized.includes("confounder")) return "confounder";
  if (normalized.includes("mediator")) return "mediator";
  if (normalized.includes("collider")) return "collider";
  if (normalized.includes("proxy")) return "proxy";
  if (normalized.includes("temporal") || normalized.includes("time")) {
    return "temporal";
  }
  return "unknown";
}

function getWarningNodeIds(validation: BackendCausalGraphValidation | null) {
  if (!validation) return new Set<string>();
  return new Set(
    [...validation.warnings, ...validation.errors]
      .flatMap((issue) => [issue.source, issue.target])
      .filter((value): value is string => Boolean(value)),
  );
}

function graphToReactFlow(
  graphDraft: CausalGraphDraft,
  validation: BackendCausalGraphValidation | null,
) {
  const warningNodeIds = getWarningNodeIds(validation);
  const nodes: Node<GraphNodeData>[] = graphDraft.nodes.map((node, index) => {
    const role = normalizeRole(node.role || "");
    return {
      id: node.node_id,
      type: "default",
      position: {
        x: 80 + (index % 3) * 240,
        y: 80 + Math.floor(index / 3) * 160,
      },
      data: {
        label: node.display_name || node.variable_name || node.node_id,
        role: node.role || "unknown",
        temporalRole: node.temporal_role || "unknown timing",
        warning: warningNodeIds.has(node.node_id),
      },
      style: {
        width: 190,
        border: warningNodeIds.has(node.node_id)
          ? "2px solid #f59e0b"
          : "1px solid #b8c7db",
        borderRadius: 8,
        background: roleColors[role],
        color: "#0b1730",
        padding: 10,
      },
    };
  });

  const uncertainKeys = new Set(
    graphDraft.uncertain_edges.map((edge) => `${edge.source}->${edge.target}`),
  );
  const edges: Edge<GraphEdgeData>[] = graphDraft.edges.map((edge, index) => {
    const uncertain =
      uncertainKeys.has(`${edge.source}->${edge.target}`) ||
      edge.confidence === "low";
    return {
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: uncertain ? "uncertain" : edge.confidence,
      animated: uncertain,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        uncertain,
        confidence: edge.confidence,
        rationale: edge.rationale,
        temporalAssumption: edge.temporal_assumption,
        supportingEvidence: edge.supporting_evidence,
      },
      style: {
        stroke: uncertain ? "#f59e0b" : "#2563eb",
        strokeWidth: uncertain ? 2.5 : 2,
        strokeDasharray: uncertain ? "6 4" : undefined,
      },
    };
  });

  return { nodes, edges };
}

function reactFlowToGraph(
  baseGraph: CausalGraphDraft,
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
): CausalGraphDraft {
  const nodeById = new Map(baseGraph.nodes.map((node) => [node.node_id, node]));
  const convertedNodes: CausalGraphNode[] = nodes.map((node) => {
    const original = nodeById.get(node.id);
    return {
      node_id: node.id,
      variable_name: original?.variable_name || node.id,
      display_name: String(node.data?.label || original?.display_name || node.id),
      role: String(node.data?.role || original?.role || "unknown"),
      temporal_role: String(
        node.data?.temporalRole || original?.temporal_role || "unknown",
      ),
      data_category: original?.data_category || "user_edited",
      is_observed: original?.is_observed ?? true,
      confidence: original?.confidence || "user_reviewed",
    };
  });

  const convertedEdges: CausalGraphEdge[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    edge_type: "directed",
    rationale:
      edge.data?.rationale ||
      "User-edited edge; deterministic backend validation required.",
    supporting_evidence: edge.data?.supportingEvidence || [],
    confidence: edge.data?.uncertain
      ? "low"
      : edge.data?.confidence || "user_reviewed",
    temporal_assumption:
      edge.data?.temporalAssumption || "User must confirm temporal ordering.",
    user_editable: true,
  }));

  const uncertainEdges = edges
    .filter((edge) => edge.data?.uncertain)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      possible_direction: `${edge.source}->${edge.target}`,
      uncertainty_reason: "Marked uncertain by user in graph canvas.",
      evidence_gap: "Requires user review and supporting evidence.",
      recommended_user_review: "Confirm direction, timing, and role consistency.",
    }));

  return {
    ...baseGraph,
    nodes: convertedNodes,
    edges: convertedEdges,
    uncertain_edges: uncertainEdges,
  };
}

export function CausalGraphCanvas({
  graphDraft,
  validation,
  onGraphChange,
}: CausalGraphCanvasProps) {
  const initialGraph = useMemo(
    () => (graphDraft ? graphToReactFlow(graphDraft, validation) : null),
    [graphDraft, validation],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialGraph) return;
    setNodes(initialGraph.nodes);
    setEdges(initialGraph.edges);
  }, [initialGraph, setEdges, setNodes]);

  useEffect(() => {
    if (!graphDraft || nodes.length === 0) return;
    onGraphChange(reactFlowToGraph(graphDraft, nodes, edges));
  }, [edges, graphDraft, nodes, onGraphChange]);

  function handleConnect(connection: Connection) {
    setEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: {
            confidence: "user_reviewed",
            temporalAssumption: "User must confirm temporal ordering.",
          },
          style: { stroke: "#2563eb", strokeWidth: 2 },
        },
        currentEdges,
      ),
    );
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((currentNodes) =>
      currentNodes.filter((node) => node.id !== selectedNodeId),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId(null);
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return;
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== selectedEdgeId),
    );
    setSelectedEdgeId(null);
  }

  function markSelectedEdgeUncertain() {
    if (!selectedEdgeId) return;
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              animated: true,
              label: "uncertain",
              data: { ...edge.data, uncertain: true, confidence: "low" },
              style: {
                ...edge.style,
                stroke: "#f59e0b",
                strokeWidth: 2.5,
                strokeDasharray: "6 4",
              },
            }
          : edge,
      ),
    );
  }

  if (!graphDraft) {
    return (
      <div className="graph-canvas-empty">
        Generate a graph draft to open the editable canvas.
      </div>
    );
  }

  return (
    <section className="graph-canvas-shell">
      <div className="graph-toolbar">
        <button disabled={!selectedNodeId} onClick={deleteSelectedNode} type="button">
          Delete Node
        </button>
        <button disabled={!selectedEdgeId} onClick={deleteSelectedEdge} type="button">
          Delete Edge
        </button>
        <button
          disabled={!selectedEdgeId}
          onClick={markSelectedEdgeUncertain}
          type="button"
        >
          Mark Edge Uncertain
        </button>
      </div>

      <div className="graph-canvas">
        <ReactFlow
          edges={edges}
          fitView
          nodes={nodes}
          onConnect={handleConnect}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={() => setSelectedEdgeId(null)}
          onNodesChange={onNodesChange}
          onNodesDelete={() => setSelectedNodeId(null)}
          onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
            setSelectedNodeId(selectedNodes[0]?.id ?? null);
            setSelectedEdgeId(selectedEdges[0]?.id ?? null);
          }}
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>

      <div className="graph-legend">
        {Object.entries(roleColors).map(([role, color]) => (
          <span key={role}>
            <i style={{ background: color }} />
            {role}
          </span>
        ))}
        <span>
          <i className="legend-edge legend-edge--uncertain" />
          uncertain edge
        </span>
        <span>
          <i className="legend-warning" />
          validation warning
        </span>
      </div>
    </section>
  );
}
