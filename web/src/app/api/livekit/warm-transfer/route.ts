import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WarmTransferActionSchema, CallStatus } from '@/contracts/schemas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = WarmTransferActionSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid warm transfer action payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { callLogId, tenantId, action, ownerInstruction } = parseResult.data;

    let targetStatus: CallStatus = 'in_progress';
    if (action === 'START_PRIVATE_CONSULT') {
      targetStatus = 'owner_consulting_ai';
    } else if (action === 'RELAY_OWNER_INSTRUCTION') {
      targetStatus = 'ai_relaying_owner_instruction';
    } else if (action === 'MERGE_OWNER_INTO_CALL') {
      targetStatus = 'merged_live_with_owner';
    } else if (action === 'RESOLVE_AND_END') {
      targetStatus = 'completed';
    }

    // Update database call_logs record
    const updatePayload: Record<string, any> = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };

    if (ownerInstruction) {
      updatePayload.owner_instructions = ownerInstruction;
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callLogId);
    let updatedCallLog = null;

    if (isUuid) {
      const { data, error: dbErr } = await supabaseAdmin
        .from('call_logs')
        .update(updatePayload)
        .eq('id', callLogId)
        .select()
        .maybeSingle();
      if (!dbErr) updatedCallLog = data;
    } else {
      const { data, error: dbErr } = await supabaseAdmin
        .from('call_logs')
        .update(updatePayload)
        .eq('room_name', callLogId)
        .select()
        .maybeSingle();
      if (!dbErr) updatedCallLog = data;
    }

    // Broadcast Realtime Event to sync all open browsers & agent workers
    await supabaseAdmin.from('ui_command_events').insert({
      tenant_id: tenantId,
      command_type: 'TRIGGER_DIRE_MODAL',
      payload: {
        callLogId,
        action,
        status: targetStatus,
        ownerInstruction: ownerInstruction || null,
        timestamp: Date.now(),
      },
    });

    return NextResponse.json({
      success: true,
      action,
      newStatus: targetStatus,
      callLog: updatedCallLog || { id: callLogId, status: targetStatus },
    });
  } catch (error: any) {
    console.error('Warm transfer route error:', error);
    return NextResponse.json(
      { error: 'Warm transfer state transition failure', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
