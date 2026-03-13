'use client';

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Save, Loader2, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NodePalette } from './node-palette';
import { NodeConfigSheet } from './node-config-sheet';
import { TestRunDialog } from './test-run-dialog';
import { TriggerNode } from './trigger-node';
import { ConditionNode } from './condition-node';
import { ActionNode } from './action-node';
import type {
  Workflow,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  TriggerNodeData,
  ConditionNodeData,
  ActionNodeData,
} from '@/types';

const NODE_TYPES = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};

interface WorkflowCanvasProps {
  workflow: Workflow;
  onSave: (updates: { name?: string; graph?: WorkflowGraph }) => Promise<void>;
}

function getNextId() {
  return `node_${crypto.randomUUID()}`;
}

export function WorkflowCanvas({ workflow, onSave }: WorkflowCanvasProps) {
  const graph = workflow.graph as WorkflowGraph;
  const initialNodes: Node[] = (graph.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data as unknown as Record<string, unknown>,
  }));
  const initialEdges: Edge[] = (graph.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.label,
    animated: true,
    style: { strokeWidth: 2 },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [saving, setSaving] = useState(false);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(workflow.name);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Save debounce ref
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // We'll do nothing here — auto-save is opt-in via save button
    }, 2000);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: Edge = {
        ...connection,
        id: `edge_${Date.now()}`,
        animated: true,
        style: { strokeWidth: 2 },
        label:
          connection.sourceHandle === 'true'
            ? 'Yes'
            : connection.sourceHandle === 'false'
            ? 'No'
            : undefined,
      };
      setEdges((eds) => addEdge(edge, eds));
      scheduleAutoSave();
    },
    [setEdges, scheduleAutoSave]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const workflowGraph: WorkflowGraph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as WorkflowNodeType,
          position: n.position,
          data: n.data as unknown as TriggerNodeData | ConditionNodeData | ActionNodeData,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          label: typeof e.label === 'string' ? e.label : undefined,
        })),
      };
      await onSave({ name, graph: workflowGraph });
      toast.success('Workflow saved');
    } catch {
      toast.error('Failed to save workflow');
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, name, onSave]);

  // Drag-and-drop from palette
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/reactflow');
      if (!raw) return;

      const { nodeType, data } = JSON.parse(raw) as {
        nodeType: WorkflowNodeType;
        data: TriggerNodeData | ConditionNodeData | ActionNodeData;
      };

      // Check: only one trigger allowed
      if (nodeType === 'trigger' && nodes.some((n) => n.type === 'trigger')) {
        toast.error('Only one trigger node is allowed');
        return;
      }

      const position = reactFlowInstance.current?.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      }) ?? { x: 250, y: 250 };

      const newNode: Node = {
        id: getNextId(),
        type: nodeType,
        position,
        data: data as unknown as Record<string, unknown>,
      };

      setNodes((nds) => [...nds, newNode]);
      scheduleAutoSave();
    },
    [nodes, setNodes, scheduleAutoSave]
  );

  // Node click → open config sheet
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode({
        id: node.id,
        type: node.type as WorkflowNodeType,
        position: node.position,
        data: node.data as unknown as TriggerNodeData | ConditionNodeData | ActionNodeData,
      });
    },
    []
  );

  // Update node data from config sheet
  const handleNodeUpdate = useCallback(
    (nodeId: string, newData: TriggerNodeData | ConditionNodeData | ActionNodeData) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: newData as unknown as Record<string, unknown> } : n
        )
      );
      setSelectedNode((prev) =>
        prev && prev.id === nodeId ? { ...prev, data: newData } : prev
      );
      scheduleAutoSave();
    },
    [setNodes, scheduleAutoSave]
  );

  // Delete selected nodes with backspace/delete
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
        const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
        if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
          setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
          setEdges((eds) =>
            eds.filter(
              (e) =>
                !selectedEdgeIds.includes(e.id) &&
                !selectedNodeIds.includes(e.source) &&
                !selectedNodeIds.includes(e.target)
            )
          );
          setSelectedNode(null);
          scheduleAutoSave();
        }
      }
    },
    [nodes, edges, setNodes, setEdges, scheduleAutoSave]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0 bg-card">
        <div className="flex items-center gap-2">
          {editingName ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingName(false);
              }}
              className="text-sm font-medium bg-background border border-input rounded px-2 py-1 w-60"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="text-sm font-medium hover:underline"
            >
              {name}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTestDialog(true)}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Test Run
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex overflow-hidden" onKeyDown={onKeyDown} tabIndex={-1}>
        <NodePalette />

        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeClick={onNodeClick}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode={null}
            className="bg-background"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              className="!bg-background"
            />
            <Controls className="!bg-card !border-border !shadow-sm" />
          </ReactFlow>
        </div>
      </div>

      {/* Config sheet */}
      <NodeConfigSheet
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onUpdate={handleNodeUpdate}
      />

      {/* Test run dialog */}
      <TestRunDialog
        open={showTestDialog}
        onClose={() => setShowTestDialog(false)}
        workflowId={workflow.id}
        graph={{
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type as WorkflowNodeType,
            position: n.position,
            data: n.data as unknown as TriggerNodeData | ConditionNodeData | ActionNodeData,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            label: typeof e.label === 'string' ? e.label : undefined,
          })),
        }}
      />
    </div>
  );
}
