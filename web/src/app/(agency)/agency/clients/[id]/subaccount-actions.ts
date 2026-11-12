'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { agencyScope } from '@/lib/actions/scope';
import { DuplicateError } from '@/lib/db/mutations';
import {
  createSubaccountUser,
  resetSubaccountUserPassword,
  setSubaccountUserActive,
  updateTenantAgencySettings,
} from '@/lib/db/subaccounts';

export interface SubaccountActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const TenantSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(2, 'Enter a workspace name.').max(120),
  status: z.enum(['active', 'paused', 'archived']),
  flynumberDid: z.string().trim().max(50).optional(),
  telephonyMode: z.enum(['zero_cost_webrtc', 'paid_sip_trunk']),
  defaultLanguage: z.enum(['da-DK', 'en-US']),
});

export async function updateTenantAgencySettingsAction(
  formData: FormData
): Promise<SubaccountActionResult> {
  const { session } = await agencyScope();
  const parsed = TenantSettingsSchema.safeParse({
    tenantId: formData.get('tenantId'),
    name: formData.get('name'),
    status: formData.get('status'),
    flynumberDid: String(formData.get('flynumberDid') ?? ''),
    telephonyMode: formData.get('telephonyMode'),
    defaultLanguage: formData.get('defaultLanguage'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid workspace settings.' };
  }

  const { tenantId, name, status, flynumberDid, telephonyMode, defaultLanguage } = parsed.data;
  try {
    await updateTenantAgencySettings(session.userId, tenantId, {
      name,
      status,
      flynumberDid: flynumberDid ? flynumberDid : null,
      telephonyMode,
      defaultLanguage,
    });
  } catch (err) {
    if (err instanceof DuplicateError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save workspace settings.' };
  }

  revalidatePath('/agency');
  revalidatePath('/agency/clients');
  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Workspace settings saved.' };
}

const CreateUserSchema = z.object({
  tenantId: z.string().uuid(),
  fullName: z.string().trim().min(2, 'Enter the user’s full name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
  role: z.enum(['owner', 'staff']),
});

export async function createSubaccountUserAction(
  formData: FormData
): Promise<SubaccountActionResult> {
  const { session } = await agencyScope();
  const parsed = CreateUserSchema.safeParse({
    tenantId: formData.get('tenantId'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: String(formData.get('password') ?? ''),
    role: formData.get('role') ?? 'owner',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid user details.' };
  }

  try {
    await createSubaccountUser(session.userId, parsed.data.tenantId, {
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      password: parsed.data.password,
      role: parsed.data.role,
    });
  } catch (err) {
    if (err instanceof DuplicateError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Could not provision user.' };
  }

  revalidatePath(`/agency/clients/${parsed.data.tenantId}`);
  return { ok: true, message: 'Sub-account user provisioned.' };
}

const ResetPasswordSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  password: z.string().min(8, 'New password must be at least 8 characters.').max(200),
});

export async function resetSubaccountPasswordAction(
  formData: FormData
): Promise<SubaccountActionResult> {
  const { session } = await agencyScope();
  const parsed = ResetPasswordSchema.safeParse({
    tenantId: formData.get('tenantId'),
    userId: formData.get('userId'),
    password: String(formData.get('password') ?? ''),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid password.' };
  }

  try {
    await resetSubaccountUserPassword(
      session.userId,
      parsed.data.tenantId,
      parsed.data.userId,
      parsed.data.password
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Password reset failed.' };
  }

  revalidatePath(`/agency/clients/${parsed.data.tenantId}`);
  return { ok: true, message: 'Password updated and existing sessions revoked.' };
}

const ToggleUserSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  isActive: z.enum(['true', 'false']),
});

export async function toggleSubaccountUserActiveAction(
  formData: FormData
): Promise<SubaccountActionResult> {
  const { session } = await agencyScope();
  const parsed = ToggleUserSchema.safeParse({
    tenantId: formData.get('tenantId'),
    userId: formData.get('userId'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid user state request.' };
  }

  try {
    await setSubaccountUserActive(
      session.userId,
      parsed.data.tenantId,
      parsed.data.userId,
      parsed.data.isActive === 'true'
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update user status.' };
  }

  revalidatePath(`/agency/clients/${parsed.data.tenantId}`);
  return {
    ok: true,
    message: parsed.data.isActive === 'true' ? 'User activated.' : 'User suspended and sessions revoked.',
  };
}
