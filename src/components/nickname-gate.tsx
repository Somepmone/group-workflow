'use client';

import { useEffect, useState } from 'react';
import { getLocalNickname, saveLocalNickname } from '@/lib/client-utils';

interface NicknameGateProps {
  projectName: string;
  /** 昵称是否已存在于成员列表（可提前判断） */
  existingNames?: string[];
  onJoined: (nickname: string) => void;
  children: React.ReactNode;
}

/**
 * 轻量身份门卫：打开分享链接后，若本机无昵称则弹出输入框；
 * 已有昵称则直接进入。输入昵称通过后端接口加入项目成员。
 */
export default function NicknameGate({ projectName, existingNames, onJoined, children }: NicknameGateProps) {
  const [nickname, setNickname] = useState('');
  const [pending, setPending] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const cached = getLocalNickname();
    if (cached) {
      setPending(false);
      onJoined(cached);
    } else {
      setPending(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleJoin() {
    const name = nickname.trim();
    if (!name) {
      setError('请输入昵称');
      return;
    }
    // 重名校验
    if (existingNames && existingNames.some((n) => n === name)) {
      setError('该昵称已被使用，请换一个');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const projectId = window.location.pathname.split('/').filter(Boolean)[1];
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加入失败');
        setLoading(false);
        return;
      }
      if (!data.joined && existingNames && existingNames.some((n) => n === name)) {
        setError('该昵称已被使用，请换一个');
        setLoading(false);
        return;
      }
      saveLocalNickname(name);
      onJoined(name);
      setPending(false);
    } catch {
      setError('网络异常，请重试');
      setLoading(false);
    }
  }

  if (!pending) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-teal-50/60 to-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500 shadow-lg shadow-teal-200">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-white">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="M19 8v6M22 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="mt-5 text-center text-lg font-bold text-slate-800">加入「{projectName}」</h2>
        <p className="mt-1.5 text-center text-xs text-slate-400">输入昵称即可加入小组协作，无需注册</p>

        <div className="mt-6 space-y-2">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="你的昵称"
            maxLength={20}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
          />
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
          <button
            type="button"
            onClick={handleJoin}
            disabled={loading}
            className="mt-1 w-full rounded-xl bg-teal-500 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-200 transition hover:bg-teal-600 active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? '加入中…' : '加入项目'}
          </button>
        </div>
      </div>
    </div>
  );
}