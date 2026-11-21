'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** 时间轴视图错误边界：渲染异常时显示兜底卡片，避免整块区域空白 */
export default class TimelineErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[TimelineErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <span className="text-sm text-slate-500">时间轴加载失败</span>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-600"
          >
            点击重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}