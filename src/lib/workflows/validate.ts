import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from '@/types';

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a workflow graph is a well-formed DAG with exactly
 * one trigger, at least one action, and no orphan nodes.
 */
export function validateWorkflow(graph: WorkflowGraph): ValidationResult {
  const errors: string[] = [];
  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    return { valid: false, errors: ['Workflow has no nodes'] };
  }

  // --- Exactly one trigger ---
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push('Workflow must have exactly one trigger node');
  } else if (triggers.length > 1) {
    errors.push(`Workflow has ${triggers.length} trigger nodes — only one is allowed`);
  }

  // --- At least one action ---
  const actions = nodes.filter((n) => n.type === 'action');
  if (actions.length === 0) {
    errors.push('Workflow must have at least one action node');
  }

  // --- All nodes reachable from trigger (no orphans) ---
  if (triggers.length === 1) {
    const reachable = new Set<string>();
    const adjacency = buildAdjacency(nodes, edges);
    bfs(triggers[0].id, adjacency, reachable);

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        errors.push(`Node "${node.id}" (${node.type}) is not reachable from the trigger`);
      }
    }
  }

  // --- No cycles (DAG check) ---
  if (hasCycle(nodes, edges)) {
    errors.push('Workflow graph contains a cycle — only acyclic graphs are allowed');
  }

  // --- Condition nodes must have both true and false output edges ---
  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  for (const cond of conditionNodes) {
    const outEdges = edges.filter((e) => e.source === cond.id);
    const hasTrue = outEdges.some((e) => e.sourceHandle === 'true');
    const hasFalse = outEdges.some((e) => e.sourceHandle === 'false');
    if (!hasTrue) {
      errors.push(`Condition node "${cond.id}" is missing a "Yes" (true) output edge`);
    }
    if (!hasFalse) {
      errors.push(`Condition node "${cond.id}" is missing a "No" (false) output edge`);
    }
  }

  // --- Trigger must have at least one outgoing edge ---
  if (triggers.length === 1) {
    const triggerOutEdges = edges.filter((e) => e.source === triggers[0].id);
    if (triggerOutEdges.length === 0) {
      errors.push('Trigger node must have at least one outgoing connection');
    }
  }

  // --- Trigger must not have incoming edges ---
  if (triggers.length === 1) {
    const triggerInEdges = edges.filter((e) => e.target === triggers[0].id);
    if (triggerInEdges.length > 0) {
      errors.push('Trigger node cannot have incoming connections');
    }
  }

  return { valid: errors.length === 0, errors };
}

function buildAdjacency(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
  }
  return adj;
}

function bfs(
  start: string,
  adjacency: Map<string, string[]>,
  visited: Set<string>
) {
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
}

/**
 * Detect cycles using Kahn's algorithm (topological sort).
 * If we can't process all nodes, there's a cycle.
 */
function hasCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  return processed < nodes.length;
}
