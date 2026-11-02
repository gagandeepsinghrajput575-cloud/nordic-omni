import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MOCK_TENANTS } from '@/lib/mockData';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

export async function GET() {
  try {
    const { data: tenants, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, owner_name, owner_phone, telephony_mode, client_passkey, default_language')
      .order('created_at', { ascending: false });

    if (!error && tenants && tenants.length > 0) {
      return NextResponse.json({ success: true, tenants });
    }

    return NextResponse.json({ success: true, tenants: MOCK_TENANTS });
  } catch {
    return NextResponse.json({ success: true, tenants: MOCK_TENANTS });
  }
}
