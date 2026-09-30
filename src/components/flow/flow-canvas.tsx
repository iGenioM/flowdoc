"use client";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleHelp, House, Layers, Pencil, Search, Settings } from "lucide-react";
import { saveLayout, saveManual } from "@/app/actions";
import * as E from "@/core/edit";
import type { EditApi } from "./node-editor";
import { Background, ConnectionMode, Controls, MarkerType, ReactFlow, ReactFlowProvider, getNodesBounds, getViewportForBounds, useReactFlow, type Connection, type Edge, type Node, type NodeChange } from "@xyflow/react";
import { dropTarget, layoutBoard, placeAll, routeSides, stretchLayout, type Pt } from "@/core/layout";
import { DEFAULT_LANES, EMPTY_OVERRIDES, type FlowDoc, type LaneConfig, type LayoutOverrides, type Side } from "@/core/schema";
import type { DocDiff } from "@/analysis/diff";
import { toPng, toSvg } from "html-to-image";
import { NodeDrawer, type Review } from "./drawer";
import { Legend } from "./legend";
import { LANE_DESC, LaneNode, StepNode, type LaneData, type StepData } from "./nodes";

const nodeTypes = { step: StepNode, lane: LaneNode };
const KIND = {
  sync: { color: "#6420EF", dash: undefined },
  async: { color: "#160253", dash: "6 4" },
  data: { color: "#7A7A8C", dash: undefined },
  err: { color: "#E02F2F", dash: "6 4" },
} as const;
const ASYNC_LANES = new Set(["async", "events", "notify"]);

const TYPES = ["action", "decision", "error", "third_party", "db", "continuation"] as const;

const SAVE = (href: string, name: string) => Object.assign(document.createElement("a"), { href, download: name }).click();

type Props = { doc: FlowDoc; repoRoot?: string; lanes: LaneConfig[]; flowId?: string; review?: Review; diff?: DocDiff | null; projectId?: string; projectName?: string; startEditing?: boolean; layout?: LayoutOverrides | null };

const CARD = "rounded-xl border border-black/5 bg-white shadow-[0_2px_14px_rgba(0,0,0,.09)]";
const ICON_BTN = "flex size-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100";
const SELECT = `h-10 ${CARD} px-3 text-sm text-slate-700 outline-none`;
const CHIP = (on: boolean) => `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${on ? "bg-slate-200 text-slate-900" : "text-slate-600 hover:bg-slate-100"}`;

function Canvas({ doc: saved, repoRoot, lanes, flowId, review, diff, projectId, projectName, startEditing, layout: layoutProp }: Props) {
  const router = useRouter();
  // rascunho local: o canvas sempre renderiza `doc`; fora do modo edição ele é igual ao salvo
  const [doc, setDoc] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(!!startEditing && !!flowId);
  const [newLane, setNewLane] = useState<FlowDoc["boards"][number]["nodes"][number]["lane"]>("api");
  const [saving, setSaving] = useState(false);
  // ajustes manuais de layout (posição dos nós, lados das setas), salvos fora do JSON do fluxo
  const [lay, setLay] = useState<LayoutOverrides>(layoutProp ?? EMPTY_OVERRIDES);
  const [layDirty, setLayDirty] = useState(false);
  const [seenLay, setSeenLay] = useState(layoutProp);
  if (seenLay !== layoutProp) { setSeenLay(layoutProp); if (!layDirty) setLay(layoutProp ?? EMPTY_OVERRIDES); }
  const [drag, setDrag] = useState<Record<string, Pt>>({});
  // o React Flow mede os nós e avisa por onNodesChange; como recriamos os nós a cada render, devolvemos as medidas
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [linking, setLinking] = useState(false); // uma seta está sendo arrastada: mostra as bolinhas de todos os nós
  const anyDirty = dirty || layDirty;
  const setOv = (fn: (l: LayoutOverrides) => LayoutOverrides) => { setLay(fn(lay)); setLayDirty(true); };
  // novo `saved` do servidor (após salvar/refresh) substitui o rascunho, exceto se há edição não salva
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) { setSeen(saved); if (!dirty) setDoc(saved); }
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);
  const apply = (next: FlowDoc) => { setDoc(next); setDirty(true); };
  const [boardId, setBoardId] = useState(doc.boards[0].id);
  const [sel, setSel] = useState<string | null>(null);
  const [menu, setMenu] = useState<"" | "settings" | "help">("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [spot, setSpot] = useState<"" | "confirm" | "diverge">("");
  const [showReview, setShowReview] = useState(true);
  const [showDiff, setShowDiff] = useState(true);
  const [laneF, setLaneF] = useState("");
  const [typeF, setTypeF] = useState("");
  const { fitView, getNodes } = useReactFlow();
  const board = doc.boards.find((b) => b.id === boardId) ?? doc.boards[0];
  const base = useMemo(() => layoutBoard(board, lanes), [board, lanes]);
  // Geometria de raias e nós. Durante o arraste o nó já conta como "solto" onde está: a raia estica ao vivo e empurra as de baixo.
  const without = (id: string): LayoutOverrides => ({ ...lay, nodes: Object.fromEntries(Object.entries(lay.nodes).filter(([k]) => k !== id)) });
  const live = useMemo(() => {
    const id = Object.keys(drag)[0];
    if (!id) return { layout: stretchLayout(base, board, lay), board, ov: lay };
    const rest = without(id);
    const t = dropTarget(stretchLayout(base, board, rest), drag[id].x, drag[id].y);
    const b2 = { ...board, nodes: board.nodes.map((n) => (n.id === id ? { ...n, lane: t.lane } : n)) };
    const ov = { ...rest, nodes: { ...rest.nodes, [id]: { x: t.x, dy: t.dy } } };
    return { layout: stretchLayout(base, b2, ov), board: b2, ov };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, board, lay, drag]);
  const layout = live.layout;

  const matches = (id: string) => {
    const n = board.nodes.find((x) => x.id === id)!;
    return (!laneF || n.lane === laneF) && (!typeF || n.type === typeF)
      && (spot !== "confirm" || n.toConfirm.length > 0) && (spot !== "diverge" || n.divergences.length > 0);
  };
  // ao selecionar, só o nó e seus vizinhos ficam em destaque; o resto esmaece
  const related = useMemo(() => {
    if (!sel) return null;
    const ids = new Set([sel]);
    for (const e of board.edges) { if (e.from === sel) ids.add(e.to); if (e.to === sel) ids.add(e.from); }
    return ids;
  }, [sel, board]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") { setSearchOpen(false); setMenu(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // numeração do fluxo principal: ordem de leitura (coluna, depois raia); nós de erro não recebem número
  const order = [...base.nodes].sort((p, q) => p.rank - q.rank || p.y - q.y).filter((p) => board.nodes.find((n) => n.id === p.id)!.type !== "error");
  const numOf = new Map(order.map((p, i) => [p.id, i + 1]));
  const pos = placeAll(layout, live.board, live.ov);
  const nodes: Node[] = [
    ...layout.lanes.map((l, i) => ({
      id: `lane-${l.id}`, type: "lane", position: { x: 0, y: l.y }, zIndex: -1, selectable: false, draggable: false, focusable: false, measured: dims[`lane-${l.id}`],
      data: { label: l.label, desc: LANE_DESC[l.id], width: layout.width, height: l.height, odd: i % 2 === 1 } satisfies LaneData,
    })),
    ...layout.nodes.map((p) => ({
      id: p.id, type: "step", position: pos.get(p.id)!, draggable: editing, measured: dims[p.id],
      data: { step: board.nodes.find((n) => n.id === p.id)!, editing, linking, dim: !matches(p.id) || (!!related && !related.has(p.id)), num: numOf.get(p.id), review: showReview ? review?.statuses[p.id] : undefined, diff: !showDiff ? undefined : diff?.added.includes(p.id) ? "added" : diff?.changed.includes(p.id) ? "changed" : undefined } satisfies StepData,
    })),
  ];
  const edges: Edge[] = board.edges.map((e) => {
    const from = board.nodes.find((n) => n.id === e.from)!, to = board.nodes.find((n) => n.id === e.to)!;
    const kind = e.type === "error" || to.type === "error" ? "err" : from.lane === "db" || to.lane === "db" ? "data"
      : ASYNC_LANES.has(from.lane) || ASYNC_LANES.has(to.lane) || from.lane === "third_party" ? "async" : "sync";
    const { color, dash } = KIND[kind];
    const [ss, tt] = routeSides(pos.get(e.from)!, pos.get(e.to)!, lay.edges[`${board.id}/${e.id}`]);
    const picked = selEdge === e.id;
    const fade = sel && e.from !== sel && e.to !== sel ? 0.12 : 1;
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: `s-${ss}`, targetHandle: `t-${tt}`, label: e.label, type: "smoothstep", reconnectable: editing, interactionWidth: 24,
      pathOptions: { borderRadius: 0, offset: 16 },
      style: { stroke: color, strokeWidth: picked ? 3.5 : fade === 1 && sel ? 2.5 : 1.75, strokeDasharray: dash, opacity: fade },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      labelStyle: { fontSize: 10, fontWeight: 500, fill: "#160253", opacity: fade },
      labelBgStyle: { fill: "#fff", stroke: kind === "err" ? "#F2B8B5" : "#DCDCE4", opacity: fade }, labelBgPadding: [8, 4] as [number, number], labelBgBorderRadius: 10,
    };
  });
  // exporta a prancheta inteira (não só o viewport atual), com fundo opaco
  async function exportAs(kind: "png" | "svg" | "pdf") {
    try { await doExport(kind); } catch (e) { console.error("export falhou", e); alert(`Falha ao exportar: ${e instanceof Error ? e.message : "erro ao renderizar imagem"}`); }
  }
  async function doExport(kind: "png" | "svg" | "pdf") {
    const el = document.querySelector<HTMLElement>(".react-flow__viewport")!;
    const b = getNodesBounds(getNodes());
    const w = Math.ceil(b.width) + 80, h = Math.ceil(b.height) + 80;
    const v = getViewportForBounds(b, w, h, 0.2, 2, 0.05);
    const opts = { width: w, height: h, backgroundColor: "#fff", style: { width: `${w}px`, height: `${h}px`, transform: `translate(${v.x}px,${v.y}px) scale(${v.zoom})` } };
    const name = `${doc.id}-${board.id}`;
    if (kind === "svg") return SAVE(await toSvg(el, opts), `${name}.svg`);
    const png = await toPng(el, { ...opts, pixelRatio: 2 });
    if (kind === "png") return SAVE(png, `${name}.png`);
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: w >= h ? "l" : "p", unit: "px", format: [w, h] });
    pdf.addImage(png, "PNG", 0, 0, w, h);
    pdf.save(`${name}.pdf`);
  }
  const select = (id: string) => { setSel(id); fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 1.5 }); };
  const node = sel ? board.nodes.find((n) => n.id === sel) ?? null : null;

  const edit: EditApi | undefined = editing && node ? {
    boardId: board.id,
    onPatch: (patch) => apply(E.patchNode(doc, board.id, node.id, patch)),
    onDelete: () => { apply(E.removeNode(doc, board.id, node.id)); setSel(null); },
    onAddEdge: (o) => apply(E.addEdge(doc, board.id, o)),
    onRemoveEdge: (id) => apply(E.removeEdge(doc, board.id, id)),
  } : undefined;
  const sideOf = (h?: string | null) => (h ? h.slice(-1) : "") as Side;
  const setSides = (edgeId: string, s?: Side, t?: Side) => setOv((l) => ({ ...l, edges: { ...l.edges, [`${board.id}/${edgeId}`]: { s, t } } }));
  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) { const p = c.position; setDrag((d) => ({ ...d, [c.id]: p })); }
      if (c.type === "dimensions" && c.dimensions) {
        const m = c.dimensions;
        setDims((d) => (d[c.id]?.width === m.width && d[c.id]?.height === m.height ? d : { ...d, [c.id]: m }));
      }
    }
  };
  /** Solta o nó: guarda x e o deslocamento dentro da raia; se caiu em outra raia, o nó muda de raia. */
  const onNodeDragStop = (_: unknown, n: Node) => {
    const t = dropTarget(stretchLayout(base, board, without(n.id)), n.position.x, n.position.y);
    setDrag((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== n.id)));
    setOv((l) => ({ ...l, nodes: { ...l.nodes, [n.id]: { x: t.x, dy: t.dy } } }));
    const cur = board.nodes.find((x) => x.id === n.id);
    if (cur && cur.lane !== t.lane) apply(E.patchNode(doc, board.id, n.id, { lane: t.lane }));
  };
  /** Arrastar a ponta da seta: outro lado do mesmo nó só troca o encaixe; outro nó troca a ligação. */
  const onReconnect = (old: Edge, c: Connection) => {
    try {
      const sourceKept = c.source === old.source && c.sourceHandle === old.sourceHandle;
      let from = old.source, to = old.target, s = sideOf(old.sourceHandle), t = sideOf(old.targetHandle);
      if (sourceKept) { to = c.target; t = sideOf(c.targetHandle); } else { from = c.source; s = sideOf(c.sourceHandle); }
      if (from !== old.source || to !== old.target) apply(E.moveEdge(doc, board.id, old.id, { from, to }));
      setSides(old.id, s, t);
    } catch (e) { alert((e as Error).message); }
  };
  /** Puxar de uma bolinha até outra cria a ligação já encaixada nesses lados. */
  const onConnect = (c: Connection) => {
    try {
      const next = E.addEdge(doc, board.id, { from: c.source, to: c.target });
      apply(next);
      const created = next.boards.find((b) => b.id === board.id)!.edges.at(-1)!;
      setSides(created.id, sideOf(c.sourceHandle), sideOf(c.targetHandle));
      setSelEdge(created.id);
    } catch (e) { alert((e as Error).message); }
  };
  const addStep = () => { const r = E.addNode(doc, board.id, { lane: newLane, after: sel ?? undefined }); apply(r.doc); setTimeout(() => select(r.id), 80); };
  const addBoard = () => { const t = prompt("Nome da nova prancheta"); if (t === null) return; const r = E.addBoard(doc, t); apply(r.doc); setBoardId(r.id); setSel(null); };
  const renameBoard = () => { const t = prompt("Novo nome da prancheta", board.title); if (t?.trim()) apply(E.renameBoard(doc, board.id, t.trim())); };
  async function save() {
    setSaving(true);
    try { if (dirty) await saveManual(flowId!, doc); if (layDirty) await saveLayout(flowId!, lay); setDirty(false); setLayDirty(false); router.refresh(); }
    catch (e) { alert(`Não foi possível salvar: ${(e as Error).message}`); }
    setSaving(false);
  }
  const discard = () => { if (!anyDirty || confirm("Descartar as alterações não salvas?")) { setDoc(saved); setLay(layoutProp ?? EMPTY_OVERRIDES); setDirty(false); setLayDirty(false); setDrag({}); setEditing(false); setSel(null); setSelEdge(null); } };
  const nConfirm = board.nodes.filter((n) => n.toConfirm.length).length;
  const nDiverge = board.nodes.filter((n) => n.divergences.length).length;
  const approved = board.nodes.filter((n) => review?.statuses[n.id] === "approved").length;

  return (
    <div className="relative h-full w-full bg-[#F4F4F6] text-[#160253]" style={{ fontFamily: "var(--font-poppins), sans-serif" }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2} nodesConnectable={editing} connectionMode={ConnectionMode.Loose}
        edgesReconnectable={editing} reconnectRadius={26} connectionRadius={32} snapToGrid={editing} snapGrid={[10, 10]}
        onConnectStart={() => setLinking(true)} onConnectEnd={() => setLinking(false)} onReconnectStart={() => setLinking(true)} onReconnectEnd={() => setLinking(false)}
        onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onReconnect={onReconnect} onConnect={onConnect}
        onEdgeClick={(_, e) => { if (editing) { setSelEdge(e.id); setSel(null); } }}
        onNodeClick={(_, n) => { if (n.type === "step") { setSel(n.id); setSelEdge(null); } }} onPaneClick={() => { setSel(null); setSelEdge(null); setMenu(""); }}>
        <Background color="#d4d4d8" gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-right" className={node ? "!mr-[440px]" : ""} />
      </ReactFlow>

      {/* topo esquerdo: navegação e caminho */}
      <div className={`absolute left-3 top-3 z-20 flex h-12 items-center gap-1 px-2 text-slate-800 ${CARD}`}>
        {projectId ? <Link href="/" className={ICON_BTN} title="Início"><House size={18} /></Link> : <span className={ICON_BTN}><House size={18} /></span>}
        <button className={ICON_BTN} title="Voltar" onClick={() => router.back()}><ArrowLeft size={18} /></button>
        <button className={ICON_BTN} title="Avançar" onClick={() => router.forward()}><ArrowRight size={18} /></button>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        {projectId && <><Link href={`/projects/${projectId}`} className="rounded-lg px-2 py-1 text-sm font-medium hover:bg-slate-100">{projectName ?? "Projeto"}</Link><span className="text-slate-300">/</span></>}
        <span className="flex items-center gap-2 px-2 text-sm font-semibold"><Layers size={18} className="text-[#6420EF]" />{doc.title}</span>
      </div>

      {/* abaixo: prancheta e filtros */}
      <div className="absolute left-3 top-[68px] z-20 flex flex-wrap items-center gap-2">
        {doc.boards.length > 1 && (
          <select className={SELECT} value={boardId} onChange={(e) => { setBoardId(e.target.value); setSel(null); }} aria-label="Prancheta">
            {doc.boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}
        <select className={SELECT} value={laneF} onChange={(e) => setLaneF(e.target.value)} aria-label="Raia">
          <option value="">Todas as raias</option>
          {layout.lanes.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select className={SELECT} value={typeF} onChange={(e) => setTypeF(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* topo direito: busca, configurações, ajuda */}
      <div className={`absolute right-3 top-3 z-30 flex h-12 items-center gap-1 px-3 text-slate-700 ${CARD}`}>
        <button className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-100" onClick={() => setSearchOpen(true)}><Search size={18} />Buscar <kbd className="text-xs text-slate-400">⌘K</kbd></button>
        {flowId && <button className={`${ICON_BTN} ${editing ? "bg-[#EFE8FD] text-[#4100AD]" : ""}`} title={editing ? "Sair da edição" : "Editar fluxo"} onClick={() => (editing ? discard() : setEditing(true))}><Pencil size={18} /></button>}
        <button className={ICON_BTN} title="Exportar" onClick={() => setMenu(menu === "settings" ? "" : "settings")}><Settings size={18} /></button>
        <button className={ICON_BTN} title="Legenda" onClick={() => setMenu(menu === "help" ? "" : "help")}><CircleHelp size={18} /></button>
      </div>
      {menu === "settings" && (
        <div className={`absolute right-3 top-[64px] z-40 w-52 p-1.5 text-sm text-slate-700 ${CARD}`}>
          <div className="px-3 py-1 text-xs font-semibold uppercase text-slate-400">Exportar prancheta</div>
          {(["png", "svg", "pdf"] as const).map((k) => <button key={k} className="block w-full rounded-lg px-3 py-2 text-left uppercase hover:bg-slate-100" onClick={() => { setMenu(""); exportAs(k); }}>{k}</button>)}
          {flowId && <a className="block rounded-lg px-3 py-2 hover:bg-slate-100" href={`/api/flows/${flowId}/export`}>Relatório .md</a>}
        </div>
      )}
      {menu === "help" && <div className="absolute right-3 top-[64px] z-40"><Legend /></div>}

      {/* rodapé: sobreposições e contadores */}
      <div className="absolute bottom-3 left-3 z-20 space-y-2">
        {editing && selEdge && (() => {
          const e = board.edges.find((x) => x.id === selEdge);
          if (!e) return null;
          const ov = lay.edges[`${board.id}/${e.id}`];
          const auto = routeSides(pos.get(e.from)!, pos.get(e.to)!);
          const SIDE_OPTS: [string, string][] = [["t", "Topo"], ["b", "Base"], ["l", "Esquerda"], ["r", "Direita"]];
          const nm = (id: string) => board.nodes.find((n) => n.id === id)?.title ?? id;
          return (
            <div className={`flex flex-wrap items-center gap-2 p-2 text-sm text-slate-700 ${CARD}`}>
              <b className="max-w-[260px] truncate">{nm(e.from)} → {nm(e.to)}</b>
              <input className="h-8 w-36 rounded-lg border border-slate-200 px-2 text-sm" placeholder="rótulo" value={e.label ?? ""} onChange={(ev) => apply(E.patchEdge(doc, board.id, e.id, { label: ev.target.value }))} />
              <select className="h-8 rounded-lg border border-slate-200 px-1 text-sm" value={e.type} onChange={(ev) => apply(E.patchEdge(doc, board.id, e.id, { type: ev.target.value as "normal" }))}><option value="normal">normal</option><option value="error">erro / retry</option></select>
              <label className="flex items-center gap-1">sai <select className="h-8 rounded-lg border border-slate-200 px-1" value={ov?.s ?? ""} onChange={(ev) => setSides(e.id, (ev.target.value || undefined) as Side, ov?.t)}><option value="">auto ({auto[0]})</option>{SIDE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="flex items-center gap-1">entra <select className="h-8 rounded-lg border border-slate-200 px-1" value={ov?.t ?? ""} onChange={(ev) => setSides(e.id, ov?.s, (ev.target.value || undefined) as Side)}><option value="">auto ({auto[1]})</option>{SIDE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <button className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50" onClick={() => { apply(E.removeEdge(doc, board.id, e.id)); setSelEdge(null); }}>Excluir</button>
            </div>
          );
        })()}
        {editing && (
          <div className={`flex flex-wrap items-center gap-2 p-2 text-sm text-slate-700 ${CARD}`}>
            <select className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm" value={newLane} onChange={(e) => setNewLane(e.target.value as typeof newLane)} aria-label="Raia da nova etapa">
              {DEFAULT_LANES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700" onClick={addStep} title={sel ? "Cria a etapa já ligada à selecionada" : "Cria uma etapa solta"}>+ Etapa</button>
            <button className="rounded-lg px-2 py-1.5 hover:bg-slate-100" onClick={addBoard}>+ Prancheta</button>
            <button className="rounded-lg px-2 py-1.5 hover:bg-slate-100" onClick={renameBoard}>Renomear</button>
            <button className="rounded-lg px-2 py-1.5 hover:bg-slate-100" title="Volta nós e setas para a posição automática" onClick={() => { if (confirm("Voltar todos os nós e setas para o layout automático?")) { setOv(() => EMPTY_OVERRIDES); } }}>Auto-layout</button>
            <span className="h-6 w-px bg-slate-200" />
            <button className="rounded-lg bg-[#6420EF] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" disabled={!anyDirty || saving} onClick={save}>{saving ? "Salvando…" : anyDirty ? "Salvar" : "Salvo"}</button>
            <button className="rounded-lg px-2 py-1.5 hover:bg-slate-100" onClick={discard}>{anyDirty ? "Descartar" : "Sair"}</button>
          </div>
        )}
        <div className={`flex items-center gap-1 p-1 ${CARD}`}>
          <button className={CHIP(showReview)} onClick={() => setShowReview(!showReview)}>Revisão</button>
          <button className={CHIP(showDiff)} onClick={() => setShowDiff(!showDiff)}>Mudanças</button>
        </div>
        <div className={`flex flex-wrap items-center gap-1 p-1 ${CARD}`}>
          <button className={CHIP(spot === "confirm")} onClick={() => setSpot(spot === "confirm" ? "" : "confirm")}>A confirmar <b>{nConfirm}</b></button>
          <button className={CHIP(spot === "diverge")} onClick={() => setSpot(spot === "diverge" ? "" : "diverge")}>Divergências <b>{nDiverge}</b></button>
          {flowId && <span className="px-3 text-sm text-slate-600">Aprovados <b>{approved}/{board.nodes.length}</b></span>}
          {diff && diff.added.length + diff.changed.length + diff.removed.length > 0 && (
            <span title={diff.removed.length ? `Removidos: ${diff.removed.join(", ")}` : "vs versão anterior"} className="px-3 text-sm text-orange-600">vs anterior +{diff.added.length} ~{diff.changed.length} −{diff.removed.length}</span>
          )}
        </div>
      </div>

      <NodeDrawer node={node} board={board} boards={doc.boards} edit={edit} repoRoot={repoRoot} flowId={flowId} review={review} onClose={() => setSel(null)} onSelect={select} />
      {searchOpen && <SearchPalette doc={doc} onClose={() => setSearchOpen(false)} onPick={(bid, id) => { setSearchOpen(false); if (bid !== boardId) { setBoardId(bid); setTimeout(() => select(id), 120); } else select(id); }} />}
    </div>
  );
}

/** Busca em todas as pranchetas (título, id, resumo). ↑↓ navega, Enter abre, Esc fecha. */
function SearchPalette({ doc, onClose, onPick }: { doc: FlowDoc; onClose: () => void; onPick: (boardId: string, nodeId: string) => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const all = doc.boards.flatMap((b) => b.nodes.map((n) => ({ b, n })));
  const t = q.trim().toLowerCase();
  const hits = (t ? all.filter(({ n }) => `${n.id} ${n.title} ${n.summary} ${n.lane}`.toLowerCase().includes(t)) : all).slice(0, 12);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, hits.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); }
    if (e.key === "Enter" && hits[i]) onPick(hits[i].b.id, hits[i].n.id);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[14vh]" onClick={onClose}>
      <div className={`w-[560px] max-w-[92vw] overflow-hidden text-slate-800 ${CARD}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-4"><Search size={18} className="text-slate-400" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={key} placeholder="Buscar etapa por nome, id ou resumo…" className="h-12 flex-1 bg-transparent text-sm outline-none" /></div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {hits.map(({ b, n }, k) => (
            <li key={`${b.id}/${n.id}`}>
              <button onMouseEnter={() => setI(k)} onClick={() => onPick(b.id, n.id)} className={`flex w-full flex-col rounded-lg px-3 py-2 text-left ${k === i ? "bg-slate-100" : ""}`}>
                <span className="text-sm font-medium">{n.title}</span>
                <span className="truncate text-xs text-slate-500">{doc.boards.length > 1 ? `${b.title} · ` : ""}{n.lane} · {n.summary || n.id}</span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-3 py-6 text-center text-sm text-slate-500">Nada encontrado</li>}
        </ul>
      </div>
    </div>
  );
}

export function FlowCanvas(props: Omit<Props, "lanes"> & { lanes?: LaneConfig[] }) {
  return <ReactFlowProvider><Canvas {...props} lanes={props.lanes ?? DEFAULT_LANES} /></ReactFlowProvider>;
}
