'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEMPLATES } from '@/lib/types';
import { saveLocalNickname } from '@/lib/client-utils';
import { cn } from '@/lib/utils';
import { GitBranch, Presentation, FlaskConical, Sparkles, Square } from 'lucide-react';

const templateIcons: Record<string, React.ReactNode> = {
  presentation: <Presentation className="h-5 w-5" />,
  flask: <FlaskConical className="h-5 w-5" />,
  sparkles: <Sparkles className="h-5 w-5" />,
  square: <Square className="h-5 w-5" />,
};

export default function CreateProjectForm() {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [nickname, setNickname] = useState('');
  const [template, setTemplate] = useState<string>('course_report');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!projectName.trim()) {
      setError('请输入项目名');
      return;
    }
    if (!nickname.trim()) {
      setError('请输入你的昵称');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          ownerName: nickname.trim(),
          template,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '创建失败');
        setLoading(false);
        return;
      }
      saveLocalNickname(nickname.trim());
      router.push(`/project/${data.project.id}`);
    } catch {
      setError('网络异常，请重试');
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-xl space-y-6">
      {/* 项目名 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">项目名</label>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="例如：经济学导论小组作业"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
        />
      </div>

      {/* 昵称 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">你的昵称（组长）</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="例如：小婷"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
        />
      </div>

      {/* 模板 */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-slate-700">选择模板</label>
        <div className="grid grid-cols-2 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTemplate(t.value)}
              className={cn(
                'group flex items-start gap-3 rounded-xl border-2 bg-white p-4 text-left transition-all hover:shadow-md',
                template === t.value
                  ? 'border-teal-500 shadow-md shadow-teal-100'
                  : 'border-slate-100 hover:border-slate-200'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
                  template === t.value ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                )}
              >
                {templateIcons[t.icon]}
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">{t.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 text-[15px] font-semibold text-white shadow-lg shadow-teal-200 transition hover:bg-teal-600 active:scale-[0.99] disabled:opacity-60"
      >
        <GitBranch className="h-5 w-5" />
        {loading ? '创建中…' : '创建工作流'}
      </button>
      <p className="text-center text-xs text-slate-400">创建后生成默认节点，可自由增删改</p>
    </div>
  );
}