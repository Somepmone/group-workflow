'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowNode, Member, NodeKind, NodeType } from '@/lib/types';
import { NODE_TYPES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toLocalInputValue, toISODateTime } from '@/lib/client-utils';
import { formatPointTime } from '@/lib/client-utils';
import { inferNodeType, reduceIntents } from '@/lib/node-types';
import { Trash2, Info, Check } from 'lucide-react';

interface NodeEditorProps {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  members: Member[];
  onUpdate: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (nodeId: string) => Promise<void>;
}

const typeColorMap: Record<string, { active: string; dot: string }> = {
  linear: { active: 'border-sky-500 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  converge: { active: 'border-amber-500 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
};

/** 节点详情编辑表单 */
export default function NodeEditor({ node, nodes, members, onUpdate, onDelete }: NodeEditorProps) {
  const [name, setName] = useState(node.name);
  // 上一次有效名称：失焦时若名字为空则静默恢复为该值，不弹窗不提示
  const nameRef = useRef(node.name);
  const [kind, setKind] = useState<NodeKind>(node.node_kind ?? 'ddl');
  const [assignees, setAssignees] = useState<string[]>(node.assignees && node.assignees.length > 0 ? node.assignees : (node.assignee ? [node.assignee] : []));
  // 上一次有效负责人列表：全删光失焦时静默恢复
  const assigneesRef = useRef<string[]>(assignees);
  const [customAssignee, setCustomAssignee] = useState('');
  const [ddl, setDdl] = useState<string>(toLocalInputValue(node.ddl));
  const [pointDate, setPointDate] = useState<string>(node.point_date ?? '');
  const [pointAllDay, setPointAllDay] = useState<boolean>(node.point_all_day ?? true);
  const [pointStart, setPointStart] = useState<string>(node.point_start_time ?? '');
  const [pointEnd, setPointEnd] = useState<string>(node.point_end_time ?? '');
  const [note, setNote] = useState<string>(node.note ?? '');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pointTimeError, setPointTimeError] = useState<string | null>(null);
  const [prevIds, setPrevIds] = useState<string[]>(node.intent_prev_node_ids ?? node.prev_node_ids ?? []);
  const [deleting, setDeleting] = useState(false);

  // 切换节点或后端返回的字段变化时同步本地表单
  useEffect(() => {
    setName(node.name);
    nameRef.current = node.name;
    setKind(node.node_kind ?? 'ddl');
    const nextAssignees = node.assignees && node.assignees.length > 0 ? node.assignees : (node.assignee ? [node.assignee] : []);
    setAssignees(nextAssignees);
    assigneesRef.current = nextAssignees;
    setDdl(toLocalInputValue(node.ddl));
    setPointDate(node.point_date ?? '');
    setPointAllDay(node.point_all_day ?? true);
    setPointStart(node.point_start_time ?? '');
    setPointEnd(node.point_end_time ?? '');
    setNote(node.note ?? '');
    setPointTimeError(null);
    setPrevIds(node.intent_prev_node_ids ?? node.prev_node_ids ?? []);
    setDeleting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, JSON.stringify(node.intent_prev_node_ids ?? node.prev_node_ids), JSON.stringify(node.prev_node_ids)]);

  const others = nodes.filter((n) => n.id !== node.id);
  const memberNames = new Set(members.map((m) => m.name));

  // 前端轻量重算有效边：当前节点用本地乐观 intent，其他节点用库中 intent，
  // 经传递约简后即后端 prev_node_ids，保证类型预览与「已简化」标记与后端一致
  const candidateNodes: WorkflowNode[] = nodes.map((n) =>
    n.id === node.id ? { ...n, intent_prev_node_ids: prevIds } : n
  );
  const { prevNodeIdsByNode } = reduceIntents(candidateNodes);
  const effectivePrevs = prevNodeIdsByNode.get(node.id) ?? [];

  // 系统自动推断的类型（基于约简后的有效边，与后端一致）
  const autoType: NodeType = inferNodeType(effectivePrevs, nodes);
  const typeInfo = NODE_TYPES.find((t) => t.value === autoType);

  const updatePatch = (key: string, value: unknown) => {
    void onUpdate(node.id, { [key]: value });
  };

  function togglePrev(id: string) {
    const exists = prevIds.includes(id);
    const next = exists ? prevIds.filter((p) => p !== id) : [...prevIds, id];
    setPrevIds(next);
    void onUpdate(node.id, { prev_node_ids: next }).catch(() => {
      setPrevIds(prevIds);
    });
  }

  async function handleDelete() {
    if (window.confirm(`确定删除节点「${node.name}」吗？`)) {
      setDeleting(true);
      await onDelete(node.id);
    }
  }

  // 负责人：toggle 成员 chip
  function toggleAssignee(name_: string) {
    const next = assignees.includes(name_) ? assignees.filter((a) => a !== name_) : [...assignees, name_];
    setAssignees(next);
    if (next.length > 0) assigneesRef.current = next;
    if (next.length > 0) void onUpdate(node.id, { assignees: next });
  }

  // 自定义负责人：回车添加
  function addCustomAssignee() {
    const v = customAssignee.trim();
    if (!v) return;
    if (assignees.includes(v)) {
      setCustomAssignee('');
      return;
    }
    const next = [...assignees, v];
    setAssignees(next);
    assigneesRef.current = next;
    setCustomAssignee('');
    void onUpdate(node.id, { assignees: next });
  }

  function removeAssignee(name_: string) {
    const next = assignees.filter((a) => a !== name_);
    setAssignees(next);
    if (next.length === 0) return; // 全删光：等待失焦静默恢复
    assigneesRef.current = next;
    void onUpdate(node.id, { assignees: next });
  }

  // 全删光失焦：静默恢复上一次有效负责人
  function onAssigneeBlur() {
    if (assignees.length === 0) {
      setAssignees(assigneesRef.current);
    }
  }

  // 点状校验：结束时间需晚于开始时间
  function validatePointTime(s: string, e: string): boolean {
    if (pointAllDay) return true;
    if (!s || !e) return true;
    if (e <= s) {
      setPointTimeError('结束时间需晚于开始时间');
      return false;
    }
    setPointTimeError(null);
    return true;
  }

  function switchKind(next: NodeKind) {
    setKind(next);
    if (next === 'point') {
      // 切点状：清 DDL、切换日期输入，回填 point_date
      void onUpdate(node.id, { node_kind: 'point', ddl: null });
      if (!pointDate && node.point_date) setPointDate(node.point_date);
    } else {
      // 切回 DDL：清点状字段
      setPointDate('');
      setPointAllDay(true);
      setPointStart('');
      setPointEnd('');
      setPointTimeError(null);
      void onUpdate(node.id, {
        node_kind: 'ddl',
        point_date: null,
        point_all_day: true,
        point_start_time: null,
        point_end_time: null,
      });
    }
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm md:p-6">
      {/* 节点名 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">节点名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            // 输入过程不校验、不弹窗；失焦时提交有效名，空名静默恢复为上一次有效名称
            const trimmed = name.trim();
            if (!trimmed) {
              setName(nameRef.current);
              return;
            }
            nameRef.current = trimmed;
            updatePatch('name', trimmed);
          }}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* 类型（系统自动判断，只读展示） */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">节点类型</label>
          <div
            className={cn(
              'flex h-11 items-center justify-between rounded-xl border-2 px-3.5',
              typeColorMap[autoType]?.active ?? 'border-slate-100 bg-slate-50 text-slate-500'
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <i className={cn('h-2.5 w-2.5 rounded-full', typeColorMap[autoType]?.dot ?? 'bg-slate-300')} />
              {typeInfo?.label ?? '线性'}
            </span>
            <span className="text-[11px] font-normal opacity-80">{typeInfo?.desc}</span>
          </div>
          <p className="flex items-center gap-1 text-[11px] leading-relaxed text-slate-400">
            <Info className="h-3 w-3 shrink-0" />
            由前置节点关系自动判断，修改前置节点后自动更新
          </p>
        </div>

        {/* 节点形态：DDL 型 / 点状（会议、答辩等） */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">节点形态</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'ddl', label: 'DDL 型', desc: '有截止时间' },
                { value: 'point', label: '点状', desc: '会议 / 答辩' },
              ] as { value: NodeKind; label: string; desc: string }[]
            ).map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => switchKind(k.value)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2 text-left transition',
                  kind === k.value
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'
                )}
              >
                <span className="text-xs font-semibold">{k.label}</span>
                <span className="text-[10px] opacity-80">{k.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 负责人：成员 chip 多选 + 自定义 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">负责人（可多选）</label>
        {members.length > 0 && (
          <div className="flex max-h-[96px] flex-wrap gap-2 overflow-y-auto rounded-xl py-1 pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.45)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80">
            {members.map((m) => {
              const checked = assignees.includes(m.name);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAssignee(m.name)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    checked
                      ? 'border-teal-400 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-1.5">
            <input
              value={customAssignee}
              onChange={(e) => setCustomAssignee(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomAssignee();
                }
              }}
              placeholder="输入不在列表中的名字，回车添加"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            <button
              type="button"
              onClick={addCustomAssignee}
              className="h-10 shrink-0 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
            >
              添加
            </button>
          </div>
        </div>
        {assignees.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {assignees.map((a) => (
              <span
                key={a}
                className="group flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700"
              >
                {a}
                {!memberNames.has(a) && <span className="text-[9px] text-teal-400">(未加入)</span>}
                <button
                  type="button"
                  onClick={() => removeAssignee(a)}
                  className="ml-0.5 rounded-full text-teal-400 transition hover:text-teal-700"
                  aria-label={`移除 ${a}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-400">至少选 1 位负责人；清空后失焦自动恢复上一次的值</p>
          {assignees.length === 0 && (
            <span className="text-[11px] font-medium text-rose-500">至少选择 1 位负责人</span>
          )}
        </div>
      </div>

      {/* 时间：DDL 型 / 点状型互斥展示 */}
      {kind === 'ddl' ? (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">截止时间（DDL）</label>
          <input
            type="datetime-local"
            value={ddl}
            onChange={(e) => {
              setDdl(e.target.value);
              updatePatch('ddl', toISODateTime(e.target.value));
            }}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
          />
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
          <label className="text-sm font-medium text-slate-700">日期（点状节点）</label>
          <input
            type="date"
            value={pointDate}
            onChange={(e) => {
              const v = e.target.value;
              setPointDate(v);
              updatePatch('point_date', v || null);
            }}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={pointAllDay}
              onChange={(e) => {
                const v = e.target.checked;
                setPointAllDay(v);
                setPointTimeError(null);
                if (v) {
                  setPointStart('');
                  setPointEnd('');
                  updatePatch('point_all_day', true);
                } else {
                  updatePatch('point_all_day', false);
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-teal-500 focus:ring-teal-400"
            />
            All day（整天）
          </label>
          {!pointAllDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">开始时间</label>
                <input
                  type="time"
                  value={pointStart}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPointStart(v);
                    validatePointTime(v, pointEnd);
                    updatePatch('point_start_time', v || null);
                  }}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">结束时间</label>
                <input
                  type="time"
                  value={pointEnd}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPointEnd(v);
                    validatePointTime(pointStart, v);
                    updatePatch('point_end_time', v || null);
                  }}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                />
              </div>
            </div>
          )}
          {pointTimeError && (
            <p className="text-[11px] font-medium text-rose-500">{pointTimeError}</p>
          )}
          {pointDate && (
            <p className="text-[11px] text-slate-400">
              时间轴显示：{formatPointTime({
                point_date: pointDate,
                point_all_day: pointAllDay,
                point_start_time: pointStart || null,
                point_end_time: pointEnd || null,
              })}
            </p>
          )}
        </div>
      )}

      {/* 备注（取代 DDL 严格程度） */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">备注</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const v = note.trim();
            setNote(v);
            if (v === node.note) return;
            updatePatch('note', v);
          }}
          rows={3}
          placeholder="比如：需要查重、必须包含图表、交给学委前要过一遍…"
          className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
        />
        {noteError && <p className="text-[11px] font-medium text-rose-500">{noteError}</p>}
      </div>

      {/* 前置节点 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">前置节点（可多选）</label>
        {others.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-400">暂无其他节点可选</p>
        ) : (
          <div className="flex max-h-[132px] flex-wrap gap-2 overflow-y-auto rounded-xl py-1 pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.45)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80">
            {others.map((n) => {
              const checked = prevIds.includes(n.id);
              const isSimplified = checked && !effectivePrevs.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => togglePrev(n.id)}
                  title={isSimplified ? '该依赖已被现有路径覆盖，若中间节点被移除会自动恢复' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    checked
                      ? isSimplified
                        ? 'border-dashed border-slate-300 bg-slate-50 text-slate-400'
                        : 'border-teal-400 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  )}
                >
                  {n.name}
                  {isSimplified && (
                    <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-400">
                      已简化
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          已勾选的依赖若被现有路径覆盖会自动简化，中间节点被移除时自动恢复
        </p>
      </div>

      {/* 删除 */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <p className="text-[11px] text-slate-400">创建于 {new Date(node.created_at).toLocaleDateString('zh-CN')}</p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition hover:bg-rose-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deleting ? '删除中…' : '删除节点'}
        </button>
      </div>
    </div>
  );
}