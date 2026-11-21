import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 项目内所有节点的评论计数聚合（看板卡片展示用）：
 * 返回 { counts: { [nodeId]: { commentCount, helpCount } } }，一次查完不 N+1。
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();

    // 校验项目存在
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const { data, error } = await client
      .from('node_comments')
      .select('node_id, kind')
      .eq('project_id', id);
    if (error) throw new Error(`查询评论失败: ${error.message}`);

    const counts: Record<string, { commentCount: number; helpCount: number }> = {};
    (data ?? []).forEach((c: { node_id: string; kind: string }) => {
      const prev = counts[c.node_id] ?? { commentCount: 0, helpCount: 0 };
      prev.commentCount += 1;
      if (c.kind === 'help') prev.helpCount += 1;
      counts[c.node_id] = prev;
    });

    return NextResponse.json({ counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取评论计数失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}