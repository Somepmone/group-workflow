import { getSupabaseClient } from '@/storage/database/supabase-client';
import { notFound } from 'next/navigation';
import type { Project, Member, WorkflowNode } from '@/lib/types';
import BoardPage from '@/components/board/board-page';

export const dynamic = 'force-dynamic';

export default async function ProjectBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getSupabaseClient();

  const { data: project } = await client
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!project) notFound();

  const [{ data: members }, { data: nodes }] = await Promise.all([
    client.from('members').select('*').eq('project_id', id).order('created_at', { ascending: true }),
    client.from('nodes').select('*').eq('project_id', id).order('position', { ascending: true }),
  ]);

  return (
    <BoardPage
      initialProject={project as Project}
      initialMembers={(members as Member[]) ?? []}
      initialNodes={(nodes as WorkflowNode[]) ?? []}
    />
  );
}