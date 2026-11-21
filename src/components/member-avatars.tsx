'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getLocalNickname } from '@/lib/client-utils';
import type { Member } from '@/lib/types';

/** 主色（蓝绿）系渐变池：随成员序号循环 */
const AVATAR_GRADIENTS = [
  'from-teal-500 to-teal-600',
  'from-cyan-500 to-cyan-600',
  'from-emerald-500 to-emerald-600',
  'from-sky-500 to-sky-600',
  'from-teal-600 to-teal-700',
  'from-cyan-600 to-teal-600',
];

/** 昵称首字：汉字取第一个字；英文取首字母大写 */
export function memberInitial(name: string): string {
  const c = name.trim();
  if (!c) return '?';
  const first = c.charAt(0);
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

/** 加入时间：MM/DD HH:mm（本地时区） */
export function formatJoinTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MemberAvatarsProps {
  members: Member[];
}

/**
 * 顶部协作成员列表：
 * - 横向排列的头像圈，显示昵称首字（汉字取第一个字，英文取首字母大写），主色系渐变背景 32px
 * - 最多显示 5 个，超过显示「+N」灰色圈
 * - 当前用户（本地昵称）头像加一圈主色描边
 * - hover 头像显示昵称 tooltip
 * - 点击成员区域展开完整列表弹层：昵称 + 加入时间（MM/DD HH:mm），当前用户标注「（我）」
 */
export default function MemberAvatars({ members }: MemberAvatarsProps) {
  const [open, setOpen] = useState(false);
  const myName = useMemo(() => getLocalNickname(), []);
  const visible = members.slice(0, 5);
  const extra = members.length - 5;

  const avatarCls = (name: string, i: number) =>
    cn(
      'flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full border-2 border-white bg-gradient-to-br text-[11px] font-bold text-white shadow-sm',
      AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
      name === myName && 'ring-2 ring-teal-500 ring-offset-1'
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 cursor-pointer items-center rounded-full outline-none -space-x-2"
          title="查看全部成员"
        >
          {visible.map((m, i) => (
            <span key={m.id} className="group relative">
              <span className={avatarCls(m.name, i)}>{memberInitial(m.name)}</span>
              {/* hover 昵称 tooltip */}
              <span
                className={cn(
                  'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2',
                  'whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100'
                )}
              >
                {m.name}
              </span>
            </span>
          ))}
          {extra > 0 && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold text-slate-500">
              +{extra}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-1.5">
        <div className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">{members.length} 位成员</div>
        <div className="max-h-72 overflow-y-auto pb-1">
          {members.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-300">暂无成员</p>}
          {members.map((m, i) => (
            <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-slate-50">
              <span className={avatarCls(m.name, i)}>{memberInitial(m.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-slate-700">
                  {m.name}
                  {m.name === myName && <span className="ml-1 text-[11px] text-teal-600">（我）</span>}
                </div>
                <div className="text-[11px] tabular-nums text-slate-400">
                  {formatJoinTime(m.created_at) ? `${formatJoinTime(m.created_at)} 加入` : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}