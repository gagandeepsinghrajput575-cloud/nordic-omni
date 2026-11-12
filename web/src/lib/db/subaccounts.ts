import { hashPassword } from '@/lib/auth/password';
import { withUser } from '@/lib/db/client';
import { DuplicateError } from '@/lib/db/mutations';

export interface SubaccountUserRow {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  role: 'owner' | 'staff';
  created_at: string;
}

export async function listSubaccountUsers(
  actingUserId: string,
  tenantId: string
): Promise<SubaccountUserRow[]> {
  return withUser(actingUserId, async (tx) => {
    const rows = await tx`
      select id, email, full_name, is_active, role, created_at
      from public.subaccount_list_users(${tenantId}::uuid)
    `;
    return rows as unknown as SubaccountUserRow[];
  });
}

export async function createSubaccountUser(
  actingUserId: string,
  tenantId: string,
  input: {
    email: string;
    fullName: string;
    password: string;
    role: 'owner' | 'staff';
  }
): Promise<string> {
  const passwordHash = hashPassword(input.password);
  return withUser(actingUserId, async (tx) => {
    try {
      const rows = await tx`
        select public.subaccount_create_user(
          ${tenantId}::uuid,
          ${input.email},
          ${input.fullName},
          ${passwordHash},
          ${input.role}
        ) as id
      `;
      return rows[0].id as string;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new DuplicateError('email', 'An account with this email already exists.');
      }
      throw error;
    }
  });
}

export async function setSubaccountUserActive(
  actingUserId: string,
  tenantId: string,
  targetUserId: string,
  isActive: boolean
): Promise<void> {
  await withUser(actingUserId, async (tx) => {
    await tx`
      select public.subaccount_set_user_active(
        ${tenantId}::uuid,
        ${targetUserId}::uuid,
        ${isActive}
      )
    `;
  });
}

export async function resetSubaccountUserPassword(
  actingUserId: string,
  tenantId: string,
  targetUserId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = hashPassword(newPassword);
  await withUser(actingUserId, async (tx) => {
    await tx`
      select public.subaccount_reset_password(
        ${tenantId}::uuid,
        ${targetUserId}::uuid,
        ${passwordHash}
      )
    `;
  });
}

export interface TenantAgencySettingsPatch {
  name: string;
  status: 'active' | 'paused' | 'archived';
  flynumberDid: string | null;
  telephonyMode: 'zero_cost_webrtc' | 'paid_sip_trunk';
  defaultLanguage: 'da-DK' | 'en-US';
}

export async function updateTenantAgencySettings(
  actingUserId: string,
  tenantId: string,
  patch: TenantAgencySettingsPatch
): Promise<number> {
  return withUser(actingUserId, async (tx) => {
    try {
      const rows = await tx`
        update public.tenants
           set name = ${patch.name},
               status = ${patch.status},
               flynumber_did = ${patch.flynumberDid},
               telephony_mode = ${patch.telephonyMode}::telephony_mode,
               default_language = ${patch.defaultLanguage}::language_code,
               updated_at = now()
         where id = ${tenantId}::uuid
        returning id
      `;
      return rows.length;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new DuplicateError('flynumberDid', 'That FlyNumber DID is already assigned to another workspace.');
      }
      throw error;
    }
  });
}
