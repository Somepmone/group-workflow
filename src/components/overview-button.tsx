'use client';

import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import ProjectOverviewDialog from '@/components/project-overview-dialog';

interface OverviewButtonProps {
  projectId: string;
  className?: string;
}

/** 三视图顶部「总览」入口：图标按钮 + 弹窗 */
export default function OverviewButton({ projectId, className }: OverviewButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="项目总览"
        aria-label="项目总览"
        className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-600 ${className ?? ''}`}
      >
        <LayoutDashboard className="h-4 w-4" />
      </button>
      <ProjectOverviewDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => {
          // 项目被删除：离开当前项目页
          window.location.href = '/';
        }}
      />
    </>
  );
}