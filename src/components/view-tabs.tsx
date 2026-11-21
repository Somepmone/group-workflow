'use client';

import Link from 'next/link';
import { Workflow, CalendarClock, KanbanSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewKey = 'flow' | 'timeline' | 'board';

const TABS: { key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'flow', label: '流程图', icon: Workflow },
  { key: 'timeline', label: '时间轴', icon: CalendarClock },
  { key: 'board', label: '看板', icon: KanbanSquare },
];

interface ViewTabsProps {
  projectId: string;
  active: ViewKey;
}

/** 三视图切换：流程图 / 时间轴 / 看板 */
export default function ViewTabs({ projectId, active }: ViewTabsProps) {
  const hrefOf = (key: ViewKey): string =>
    key === 'flow'
      ? `/project/${projectId}`
      : key === 'timeline'
        ? `/project/${projectId}/timeline`
        : `/project/${projectId}/board`;

  return (
    <nav className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={hrefOf(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
              isActive ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}