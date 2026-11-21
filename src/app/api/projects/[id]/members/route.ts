import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getProjectLockState } from '@/lib/lock-utils';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 加入项目成员：输入昵称加入，重复昵称返回已存在 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });

    const client = getSupabaseClient();

    // 确认项目存在
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // 锁定校验：full 完全锁定后禁止新成员加入；workflow 锁定不影响人员
    const { lockState } = await getProjectLockState(client, id);
    if (lockState === 'full') {
      return NextResponse.json({ error: '项目已完全锁定，无法加入新成员。请在项目总览中解锁。' }, { status: 403 });
    }

    // 幂等：同名成员已存在则直接返回
    const { data: existing } = await client
      .from('members')
      .select('*')
      .eq('project_id', id)
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ member: existing, joined: false });
    }

    const { data: member, error: memberError } = await client
      .from('members')
      .insert({ project_id: id, name })
      .select('*')
      .single();
    if (memberError) throw new Error(`加入失败: ${memberError.message}`);

    return NextResponse.json({ member, joined: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '加入项目失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 获取成员列表 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('members')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`查询成员失败: ${error.message}`);
    return NextResponse.json({ members: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取成员失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}