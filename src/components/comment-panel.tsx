'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MessageSquare, Send, LifeBuoy, Trash2, Loader2 } from 'lucide-react';
import type { NodeComment, CommentKind } from '@/lib/types';

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM/DD */
export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

const avatarPalette = ['bg-teal-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500'];

/** 首字：中文取首字，英文取首字母大写 */
function firstChar(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const ch = Array.from(t)[0];
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

export interface CommentBodyProps {
  nodeId: string;
  /** 当前用户昵称（无则不允许发言/删除） */
  myName: string | null;
  /** 提交/删除成功回调（父组件可刷新评论计数） */
  onSubmitted?: () => void;
  /** 最大高度（内嵌时用；弹窗内不传） */
  className?: string;
}

/**
 * 评论脑区主体（无 Dialog 壳，列表 + 输入区）：
 * - 列表：头像首字 + 昵称 + 相对时间 + 内容；help 橙色左边框 +「求助」标签 + 加粗
 * - 自己评论右侧删除（二次确认：先点垃圾桶变「确认删除」）
 * - 输入区：发表评论（teal）/ 发起求助（橙，placeholder 变化，≥2 字）
 * - 发送成功乐观追加并滚动到底部；失败回滚。
 */
export function CommentBody({ nodeId, myName, onSubmitted, className }: CommentBodyProps) {
  const [comments, setComments] = useState<NodeComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<CommentKind>('comment');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const scrollOuterRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nodes/${nodeId}/comments`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载评论失败');
      setComments(data.comments ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载评论失败');
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 新评论加入后滚动到底部（仅当用户在底部时）
  useEffect(() => {
    const el = scrollOuterRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  async function submit() {
    const content = text.trim();
    if (!myName) {
      setError('请先设置昵称再发言');
      return;
    }
    if (content.length < 1) {
      setError('评论内容不能为空');
      return;
    }
    if (mode === 'help' && content.length < 2) {
      setError('求助内容至少 2 个字');
      return;
    }
    setSending(true);
    setError(null);
    const temp: NodeComment = {
      id: `temp-${Date.now()}`,
      authorName: myName,
      content,
      kind: mode,
      createdAt: new Date().toISOString(),
    };
    // 乐观追加
    setComments((prev) => [...prev, temp]);
    setText('');
    try {
      const res = await fetch(`/api/nodes/${nodeId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName: myName, content, kind: mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '发送失败');
      // 用服务端返回替换临时条目
      setComments((prev) => prev.map((c) => (c.id === temp.id ? data.comment : c)));
      onSubmitted?.();
    } catch (err) {
      // 回滚失败条目
      setComments((prev) => prev.filter((c) => c.id !== temp.id));
      setText(content);
      toast.error(err instanceof Error ? err.message : '发送失败，请重试');
    } finally {
      setSending(false);
    }
  }

  async function removeComment(id: string) {
    if (!myName) return;
    if (confirmDelId !== id) {
      setConfirmDelId(id);
      return;
    }
    setConfirmDelId(null);
    try {
      const res = await fetch(`/api/nodes/${nodeId}/comments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, authorName: myName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      setComments((prev) => prev.filter((c) => c.id !== id));
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试');
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {/* 列表区 */}
      <div ref={scrollOuterRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && comments.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-slate-400">加载中…</div>
        ) : comments.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 text-slate-300">
            <MessageSquare className="h-6 w-6" />
            <p className="text-xs">还没有评论，说点什么吧</p>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => {
              const isMine = myName !== null && c.authorName === myName;
              const color =
                avatarPalette[Array.from(c.authorName).reduce((s, ch) => s + ch.charCodeAt(0), 0) % avatarPalette.length];
              return (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-xl border bg-white px-3 py-2.5 shadow-sm',
                    c.kind === 'help' ? 'border-l-4 border-l-amber-400 border-slate-100' : 'border-slate-100'
                  )}
                >
                  {c.kind === 'help' && (
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-bold text-amber-600">
                      <LifeBuoy className="h-3 w-3" />
                      求助
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                          color
                        )}
                      >
                        {firstChar(c.authorName)}
                      </span>
                      <span className="text-xs font-semibold text-slate-600">{c.authorName}</span>
                      <span className="shrink-0 text-[10px] text-slate-300">{relativeTime(c.createdAt)}</span>
                    </div>
                    {isMine && (
                      <button
                        type="button"
                        onClick={() => void removeComment(c.id)}
                        onBlur={() => setConfirmDelId((v) => (v === c.id ? null : v))}
                        className={cn(
                          'flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-medium transition',
                          confirmDelId === c.id
                            ? 'bg-rose-50 text-rose-600'
                            : 'text-slate-300 hover:bg-rose-50 hover:text-rose-500'
                        )}
                        title={confirmDelId === c.id ? '再次点击确认删除' : '删除评论'}
                      >
                        {confirmDelId === c.id ? '确认删除' : <Trash2 className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed',
                      c.kind === 'help' ? 'font-medium text-slate-700' : 'text-slate-600'
                    )}
                  >
                    {c.content}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-slate-100 px-4 py-3">
        {error && <p className="mb-1.5 text-[11px] font-medium text-rose-500">{error}</p>}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim().length >= 1) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={mode === 'help' ? '描述你卡在哪里了…' : '说点什么…'}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => {
                setMode('comment');
                setError(null);
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
                mode === 'comment' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              )}
            >
              评论
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('help');
                setError(null);
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
                mode === 'help' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              )}
            >
              求助
            </button>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || !text.trim() || !myName}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:opacity-45',
              mode === 'help' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-teal-500 hover:bg-teal-600'
            )}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {mode === 'help' ? '发起求助' : '发表评论'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CommentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  nodeName: string;
  /** 当前用户昵称（无则不允许发言/删除） */
  myName: string | null;
  /** 提交成功回调（父组件可刷新评论计数） */
  onSubmitted?: () => void;
}

/** 评论与求助面板（Dialog 弹窗，桌面居中 480px / 移动端全屏接近） */
export default function CommentPanel({ open, onOpenChange, nodeId, nodeName, myName, onSubmitted }: CommentPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(720px,92dvh)] w-[min(480px,calc(100vw-2rem))] flex-col gap-0 p-0 sm:rounded-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-teal-500" />
            <span className="min-w-0 truncate">评论与求助 · {nodeName}</span>
          </DialogTitle>
        </DialogHeader>
        <CommentBody nodeId={nodeId} myName={myName} onSubmitted={onSubmitted} className="min-h-0 flex-1" />
      </DialogContent>
    </Dialog>
  );
}