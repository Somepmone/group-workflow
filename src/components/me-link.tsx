'use client';

import Link from 'next/link';
import { UserRound } from 'lucide-react';

/** 三视图顶部工具条旁的小人图标入口，跳 /me（我的任务） */
export default function MeLink() {
  return (
    <Link
      href="/me"
      title="我的任务"
      aria-label="我的任务"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-teal-300 hover:text-teal-600"
    >
      <UserRound className="h-4.5 w-4.5" />
    </Link>
  );
}