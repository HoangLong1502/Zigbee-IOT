import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { topologyApi, apiErrorMessage } from '@/lib/api';
import type { TopologyEdge, TopologyNode } from '@/types';
import { formatAbsolute, formatRelative } from '@/lib/utils';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui/Card';

interface LaidOutNode extends TopologyNode {
  x: number;
  y: number;
}

/**
 * Force-free radial layout:
 *  - Coordinator at the centre
 *  - Routers on an inner ring
 *  - End devices on an outer ring, clustered near their parent when known
 */
function layoutNodes(nodes: TopologyNode[], edges: TopologyEdge[]): LaidOutNode[] {
  const width = 900;
  const height = 620;
  const cx = width / 2;
  const cy = height / 2;

  const coordinator = nodes.find((node) => node.type === 'Coordinator');
  const routers = nodes.filter((node) => node.type === 'Router');
  const ends = nodes.filter(
    (node) => node.type !== 'Coordinator' && node.type !== 'Router',
  );

  const placed = new Map<string, LaidOutNode>();

  if (coordinator) {
    placed.set(coordinator.id, { ...coordinator, x: cx, y: cy });
  }

  routers.forEach((router, index) => {
    const angle = (index / Math.max(routers.length, 1)) * Math.PI * 2 - Math.PI / 2;
    placed.set(router.id, {
      ...router,
      x: cx + Math.cos(angle) * 180,
      y: cy + Math.sin(angle) * 180,
    });
  });

  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    if (!edge.isParentChild) continue;
    // Prefer the parent->child direction when available.
    if (edge.relationship === 'parent') parentOf.set(edge.target, edge.source);
    else if (edge.relationship === 'child') parentOf.set(edge.source, edge.target);
  }

  const childrenByParent = new Map<string, TopologyNode[]>();
  for (const end of ends) {
    const parent = parentOf.get(end.id) ?? coordinator?.id ?? routers[0]?.id;
    if (!parent) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(end);
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = placed.get(parentId);
    children.forEach((child, index) => {
      const baseAngle = parent
        ? Math.atan2(parent.y - cy, parent.x - cx)
        : (index / children.length) * Math.PI * 2;
      const spread = Math.min(1.2, Math.PI / Math.max(children.length, 1));
      const angle = baseAngle - spread / 2 + (index + 0.5) * (spread / children.length);
      const radius = parent ? 110 : 280;
      const originX = parent?.x ?? cx;
      const originY = parent?.y ?? cy;
      placed.set(child.id, {
        ...child,
        x: originX + Math.cos(angle) * radius,
        y: originY + Math.sin(angle) * radius,
      });
    });
  }

  // Any leftover nodes (no parent link) go on the outer ring.
  ends
    .filter((end) => !placed.has(end.id))
    .forEach((end, index, list) => {
      const angle = (index / Math.max(list.length, 1)) * Math.PI * 2;
      placed.set(end.id, {
        ...end,
        x: cx + Math.cos(angle) * 280,
        y: cy + Math.sin(angle) * 280,
      });
    });

  return [...placed.values()];
}

function edgeColor(quality: number): string {
  if (quality >= 70) return '#22c55e';
  if (quality >= 40) return '#818cf8';
  if (quality >= 20) return '#f59e0b';
  return '#ef4444';
}

export function TopologyPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['topology'],
    queryFn: topologyApi.get,
  });

  const refresh = useMutation({
    mutationFn: topologyApi.refresh,
    onSuccess: (graph) => {
      queryClient.setQueryData(['topology'], graph);
    },
  });

  const laidOut = useMemo(
    () => (data ? layoutNodes(data.nodes, data.edges) : []),
    [data],
  );
  const byId = useMemo(
    () => new Map(laidOut.map((node) => [node.id, node])),
    [laidOut],
  );

  useEffect(() => {
    if (!selected && laidOut[0]) setSelected(laidOut[0].id);
  }, [laidOut, selected]);

  const selectedNode = selected ? byId.get(selected) : undefined;

  return (
    <div>
      <PageHeader
        title="Network Topology"
        description="Coordinator, routers, end devices and parent-child link quality"
        actions={
          <button
            type="button"
            className="btn-primary"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Scan network
          </button>
        }
      />

      {refresh.isError ? (
        <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-rose-300">
          {apiErrorMessage(refresh.error)}
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : !data || data.nodes.length === 0 ? (
        <EmptyState
          title="No topology snapshot yet"
          description="Click “Scan network” to walk every router neighbour table through Zigbee2MQTT. This can take a minute."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Coordinators" value={data.stats.coordinators} />
            <StatCard label="Routers" value={data.stats.routers} tone="accent" />
            <StatCard label="End Devices" value={data.stats.endDevices} />
            <StatCard label="Links" value={data.stats.links} />
            <StatCard
              label="Avg LQI"
              value={data.stats.averageLinkQuality}
              hint={`${data.stats.weakLinks} weak`}
              tone={data.stats.weakLinks > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
            <Card className="overflow-hidden p-0">
              <svg
                ref={svgRef}
                viewBox="0 0 900 620"
                className="h-[min(70vh,620px)] w-full bg-[radial-gradient(circle_at_center,_rgba(99,102,241,0.08),_transparent_60%)]"
              >
                {data.edges.map((edge) => {
                  const source = byId.get(edge.source);
                  const target = byId.get(edge.target);
                  if (!source || !target) return null;
                  return (
                    <g key={`${edge.source}-${edge.target}`}>
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={edgeColor(edge.quality)}
                        strokeWidth={edge.isParentChild ? 2.5 : 1}
                        strokeOpacity={edge.isParentChild ? 0.9 : 0.35}
                      />
                      <text
                        x={(source.x + target.x) / 2}
                        y={(source.y + target.y) / 2 - 4}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="10"
                      >
                        {edge.linkQuality}
                      </text>
                    </g>
                  );
                })}

                {laidOut.map((node) => {
                  const radius =
                    node.type === 'Coordinator' ? 22 : node.type === 'Router' ? 16 : 12;
                  const fill =
                    node.type === 'Coordinator'
                      ? '#6366f1'
                      : node.type === 'Router'
                        ? '#22c55e'
                        : '#38bdf8';
                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(node.id)}
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={radius + (selected === node.id ? 4 : 0)}
                        fill={fill}
                        opacity={node.failed ? 0.4 : 1}
                        stroke={selected === node.id ? '#fff' : 'transparent'}
                        strokeWidth={2}
                      />
                      <text
                        x={node.x}
                        y={node.y + radius + 14}
                        textAnchor="middle"
                        fill="#e2e8f0"
                        fontSize="11"
                      >
                        {node.friendlyName.length > 18
                          ? `${node.friendlyName.slice(0, 16)}…`
                          : node.friendlyName}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <p className="border-t border-white/5 px-4 py-2 text-xs text-slate-500">
                Last scan {data.generatedAt ? formatAbsolute(data.generatedAt) : '—'} ·
                Auto-refreshes when a new snapshot arrives over WebSocket
              </p>
            </Card>

            <Card>
              <CardHeader title="Node details" />
              {selectedNode ? (
                <div className="space-y-3 text-sm">
                  <p className="text-base font-medium text-white">{selectedNode.friendlyName}</p>
                  <Badge tone="accent">{selectedNode.type}</Badge>
                  {selectedNode.failed ? <Badge tone="danger">Scan failed</Badge> : null}
                  <Info label="IEEE" value={selectedNode.ieeeAddress} />
                  <Info label="NWK" value={String(selectedNode.networkAddress)} />
                  <Info label="Manufacturer" value={selectedNode.manufacturer ?? '—'} />
                  <Info label="Model" value={selectedNode.model ?? '—'} />
                  <Info
                    label="Last seen"
                    value={selectedNode.lastSeen ? formatRelative(selectedNode.lastSeen) : '—'}
                  />
                  <div>
                    <p className="mb-1 text-xs uppercase text-slate-500">Links</p>
                    <ul className="space-y-1">
                      {data.edges
                        .filter(
                          (edge) =>
                            edge.source === selectedNode.id || edge.target === selectedNode.id,
                        )
                        .map((edge) => {
                          const otherId =
                            edge.source === selectedNode.id ? edge.target : edge.source;
                          const other = byId.get(otherId);
                          return (
                            <li
                              key={`${edge.source}-${edge.target}`}
                              className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5 text-xs"
                            >
                              <span className="truncate text-slate-300">
                                {other?.friendlyName ?? otherId}
                              </span>
                              <span style={{ color: edgeColor(edge.quality) }}>
                                LQI {edge.linkQuality}
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Select a node</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 break-all font-mono text-xs text-slate-200">{value}</p>
    </div>
  );
}
