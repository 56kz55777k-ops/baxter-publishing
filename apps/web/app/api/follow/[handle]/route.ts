import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Follow API.
 *
 *   POST   /api/follow/<handle>  → follow the creator
 *   DELETE /api/follow/<handle>  → unfollow
 *
 * Both require an authenticated session. Both refuse to follow yourself.
 * Idempotent: re-following or re-unfollowing returns a 200 with no error.
 */

async function resolveCreator(handle: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'auth', message: 'Sign in to follow creators.', status: 401 } as const;
  }
  if (handle.startsWith('~pending-')) {
    return { error: 'not_found', message: 'Creator not found.', status: 404 } as const;
  }
  const { data: creator } = await supabase
    .from('users')
    .select('id, handle')
    .eq('handle', handle)
    .maybeSingle();
  if (!creator) {
    return { error: 'not_found', message: 'Creator not found.', status: 404 } as const;
  }
  if (creator.id === user.id) {
    return {
      error: 'self',
      message: 'You cannot follow your own profile.',
      status: 400,
    } as const;
  }
  return { supabase, user, creator } as const;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  const ctx = await resolveCreator(decoded);
  if ('error' in ctx) {
    return NextResponse.json({ message: ctx.message }, { status: ctx.status });
  }
  const { supabase, user, creator } = ctx;

  const { error } = await supabase
    .from('follows')
    .upsert(
      { follower_id: user.id, creator_id: creator.id },
      { onConflict: 'follower_id,creator_id', ignoreDuplicates: true }
    );

  if (error) {
    return NextResponse.json(
      { message: 'Something prevented this from completing.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, following: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  const ctx = await resolveCreator(decoded);
  if ('error' in ctx) {
    return NextResponse.json({ message: ctx.message }, { status: ctx.status });
  }
  const { supabase, user, creator } = ctx;

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('creator_id', creator.id);

  if (error) {
    return NextResponse.json(
      { message: 'Something prevented this from completing.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, following: false });
}
