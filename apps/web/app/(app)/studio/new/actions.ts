'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  getFormatPreset,
  isPublicationCategory,
  type PublicationCategory,
} from '@baxter/domain';

export type CreatePublicationState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'untitled'
  );
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function createPublication(
  _prev: CreatePublicationState,
  formData: FormData
): Promise<CreatePublicationState> {
  const title = String(formData.get('title') ?? '').trim();
  const formatPresetId = String(formData.get('formatPresetId') ?? '');
  const categoryRaw = String(formData.get('category') ?? '');

  if (!title) {
    return { status: 'error', message: 'A title is required.' };
  }
  if (title.length > 120) {
    return {
      status: 'error',
      message: 'Titles cannot exceed one hundred and twenty characters.',
    };
  }

  const preset = getFormatPreset(formatPresetId);
  if (!preset) {
    return { status: 'error', message: 'Pick a format.' };
  }

  if (!isPublicationCategory(categoryRaw)) {
    return { status: 'error', message: 'Pick a category.' };
  }
  const category: PublicationCategory = categoryRaw;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'error', message: 'Sign in first.' };
  }

  const slug = `${slugify(title)}-${shortId()}`;

  const { data: row, error } = await supabase
    .from('publications')
    .insert({
      creator_id: user.id,
      slug,
      title,
      category,
      format: 'print',
      // page_count is filled in by the register-artifact route after upload,
      // when the PDF is parsed. Left null at creation so the creator does not
      // have to guess before producing the work.
      trim_width_mm: preset.trimWidthMm,
      trim_height_mm: preset.trimHeightMm,
      // status defaults to 'draft', currency to 'CAD'.
    })
    .select('id')
    .single();

  if (error || !row) {
    console.error('createPublication: insert failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      userId: user.id,
    });
    return {
      status: 'error',
      message:
        'Something prevented the publication from being created. Try again.',
    };
  }

  revalidatePath('/studio');
  revalidatePath('/library');
  redirect(`/studio/publications/${row.id}`);
}
