import os
from typing import Optional
from livekit.api import LiveKitAPI, RoomCompositeEgressRequest, EncodedFileOutput, S3Upload


async def start_supabase_s3_recording(room_name: str, tenant_slug: str) -> Optional[str]:
    """
    Triggers an audio-only RoomCompositeEgress saved directly to Supabase Storage S3.
    """
    url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not url or not supabase_url:
        return None

    # Supabase S3 endpoint: https://<project>.supabase.co/storage/v1/s3
    s3_endpoint = f"{supabase_url}/storage/v1/s3"

    try:
        async with LiveKitAPI(url, api_key, api_secret) as api:
            request = RoomCompositeEgressRequest(
                room_name=room_name,
                audio_only=True,
                file=EncodedFileOutput(
                    filepath=f"call-recordings/{tenant_slug}/{room_name}.mp3",
                    s3=S3Upload(
                        endpoint=s3_endpoint,
                        access_key=service_key,
                        secret=service_key,
                        region="eu-central-1",
                        bucket="call-recordings"
                    )
                )
            )
            egress = await api.egress.start_room_composite_egress(request)
            return egress.egress_id
    except Exception as e:
        print(f"Failed to start Egress recording: {e}")
        return None
