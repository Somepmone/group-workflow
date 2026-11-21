import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const KIND_VALUES = ['comment', 'help'] as const;
type CommentKind = (typeof KIND_VALUES)[number];

/** 校验节点存在（并返回所属 project_id） */
async function ensureNode(client: ReturnType<typeof getSupabaseClient>, nodeId: string): Promise<string> {
  const { data, error } = await client.from('nodes').select('project_id').eq('id', nodeId).maybeSingle();
  if (error) throw new Error(`查询节点失败: ${error.message}`);
  if (!data) throw new ApiError('节点不存在', 404);
  return data.project_id as string;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 获取节点全部评论（按 created_at 升序） */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();
    await ensureNode(client, id);

    const { data, error } = await client
      .from('node_comments')
      .select('*')
      .eq('node_id', id)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`查询评论失败: ${error.message}`);

    const comments = (data ?? []).map((c: Record<string, unknown>) => ({
      id: c.id,
      authorName: c.author_name,
      content: c.content,
      kind: KIND_VALUES.includes(c.kind as CommentKind) ? c.kind : 'comment',
      createdAt: c.created_at,
    }));
    return NextResponse.json({ comments });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : '获取评论失败';
    return NextResponse.json({ error: message }, { status });
  }
}

/** 发表评论：{ authorName, content, kind? }，kind 仅 comment / help，其他回落 comment */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const client = getSupabaseClient();
    const projectId = await ensureNode(client, id);

    const authorName = String(body.authorName ?? '').trim();
    if (!authorName) return NextResponse.json({ error: '请先输入昵称' }, { status: 400 });
    const content = String(body.content ?? '').trim();
    if (content.length < 1) return NextResponse.json({ error: '评论内容不能为空' }, { status: 400 });

    const kind: CommentKind = KIND_VALUES.includes(body.kind as CommentKind) ? (body.kind as CommentKind) : 'comment';

    const { data, error } = await client
      .from('node_comments')
      .insert({ project_id: projectId, node_id: id, author_name: authorName, content, kind })
      .select('*')
      .single();
    if (error) throw new Error(`发表评论失败: ${error.message}`);

    return NextResponse.json({
      comment: {
        id: data.id,
        authorName: data.author_name,
        content: data.content,
        kind: data.kind,
        createdAt: data.created_at,
      },
    }, { status: 201 });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : '发表评论失败';
    return NextResponse.json({ error: message }, { status });
  }
}

/** 删除评论（作者本人，评论来自本机昵称才允许）：body { id: 评论id, authorName } */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id: nodeId } = await context.params;
    const body = await request.json();
    const client = getSupabaseClient();
    const commentId = String(body.id ?? '').trim();
    if (!commentId) return NextResponse.json({ error: '缺少评论 id' }, { status: 400 });
    const { data: existing, error: findError } = await client
      .from('node_comments')
      .select('*')
      .eq('id', commentId)
      .maybeSingle();
    if (findError) throw new Error(`查询评论失败: ${findError.message}`);
    if (!existing) throw new ApiError('评论不存在', 404);
    if (existing.node_id !== nodeId) throw new ApiError('评论不属于该节点', 400);
    const authorName = String(body.authorName ?? '').trim();
    if (!authorName || authorName !== existing.author_name) {
      throw new ApiError('只能删除自己的评论', 403);
    }
    const { error: delError } = await client.from('node_comments').delete().eq('id', commentId);
    if (delError) throw new Error(`删除评论失败: ${delError.message}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : '删除评论失败';
    return NextResponse.json({ error: message }, { status });
  }
}