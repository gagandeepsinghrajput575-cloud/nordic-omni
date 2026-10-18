import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { LiveKitTokenRequestSchema } from '@/contracts/schemas';

const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
const livekitHost = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || 'wss://your-livekit.livekit.cloud';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = LiveKitTokenRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid token request payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const {
      tenantId,
      roomName,
      participantIdentity,
      participantName,
      role,
      metadata,
    } = parseResult.data;

    // Mint LiveKit Access Token
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName,
      ttl: '2h',
      metadata: JSON.stringify({
        tenantId,
        tenant_id: tenantId,
        role,
        contactId: metadata?.contactId || metadata?.contact_id || null,
        contact_id: metadata?.contact_id || metadata?.contactId || null,
        ...(metadata || {}),
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await at.toJwt();

    return NextResponse.json({
      success: true,
      token: jwt,
      roomName,
      participantIdentity,
      serverUrl: livekitHost,
      role,
    });
  } catch (error: any) {
    console.error('LiveKit token generation error:', error);
    return NextResponse.json(
      { error: 'Token minting failure', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
