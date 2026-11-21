import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 获取项目完整数据：项目信息 + 成员 + 节点 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const [{ data: members, error: memberError }, { data: nodes, error: nodesError }] = await Promise.all([
      client.from('members').select('*').eq('project_id', id).order('created_at', { ascending: true }),
      client.from('nodes').select('*').eq('project_id', id).order('position', { ascending: true }),
    ]);
    if (memberError) throw new Error(`查询成员失败: ${memberError.message}`);
    if (nodesError) throw new Error(`查询节点失败: ${nodesError.message}`);

    return NextResponse.json({ project, members, nodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取项目失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 更新项目（目前仅 lock_state 三态锁定切换） */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const client = getSupabaseClient();

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const patch: Record<string, unknown> = {};
    if (body.lock_state !== undefined) {
      const ls = String(body.lock_state);
      if (!['none', 'workflow', 'full'].includes(ls)) {
        return NextResponse.json({ error: '不支持的锁定状态' }, { status: 400 });
      }
      patch.lock_state = ls;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await client
      .from('projects')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) throw new Error(`更新项目失败: ${updateError.message}`);

    return NextResponse.json({ project: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新项目失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 删除项目（级联删除节点、成员、评论） */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const { error: deleteError } = await client.from('projects').delete().eq('id', id);
    if (deleteError) throw new Error(`删除项目失败: ${deleteError.message}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除项目失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}