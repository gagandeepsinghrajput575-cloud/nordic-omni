export interface ArchitectureStage {
id: string;
title: string;
detail: string;
code?: string;
latencyMs?: number;
}

export interface ArchitectureLane {
id: "inbound" | "audio" | "agent";
label: string;
summary: string;
stages: ArchitectureStage[];
}

export const TELEPHONY_ARCHITECTURE: ArchitectureLane[] = [
{
id: "inbound",
label: "Carrier → LiveKit SIP ingress",
summary: "Danish PSTN call lands on FlyNumber, is forwarded as a SIP INVITE, matched to a tenant by DID and turned into an attempt-scoped room.",
stages: [
{
id: "pstn",
title: "1 · Danish PSTN dial-in",
detail: "Caller dials a +45 DID from an iPhone or Android. No app, no data connection required.",
latencyMs: 0,
},
{
id: "flynumber",
title: "2 · FlyNumber SIP trunk",
detail: "Carrier terminates G.711/AMR-WB audio and forwards the INVITE to LiveKit over TLS (5061). Caller ID is preserved in From.",
code: "INVITE sip:omni_432110@sip.livekit.cloud SIP/2.0\nTo: <sip:+4535432110@flynumber.dk>\nFrom: <sip:+4527441802@flynumber.dk>\nX-FlyNumber-DID: +4535432110",
latencyMs: 40,
},
{
id: "dispatch",
title: "3 · Dispatch rule → tenant lookup",
detail: "POST /api/telephony/dispatch resolves flynumber_did → workspace in PostgreSQL, creates an attempt-scoped room and returns the AgentSession dispatch payload.",
code: 'POST /api/telephony/dispatch\n{ "event": "inbound_call", "tr_sip_to": "+4535432110", "tr_sip_from": "+4527441802" }',
latencyMs: 18,
},
{
id: "ring",
title: "4 · Ring behaviour",
detail: "Immediate answer, simulated 1-ring (1200 ms) or 2-ring (2400 ms) delay — matched to Danish receptionist expectations.",
latencyMs: 1200,
},
{
id: "agent",
title: "5 · Agent worker joins",
detail: "Python agent-worker binds CustomerAgent to the room, applies the tenant sound profile and triggers Freja's warm greeting.",
latencyMs: 120,
},
],
},
{
id: "audio",
label: "Dual-frequency acoustic engineering",
summary: "Browser audio keeps full 48 kHz Opus; phone audio is normalised to a telephone-safe 16 kHz profile with warm mid-range EQ and comfort noise.",
stages: [
{
id: "web",
title: "Web showcase profile",
detail: "48 kHz stereo Opus, high dynamic range, full-band TTS for headphones and studio speakers.",
code: "sampleRate 48000 · channels 2 · codec OPUS · bitrate 96k",
},
{
id: "telephony",
title: "Telephony profile",
detail: "16 kHz render, resampled to the negotiated G.711 8 kHz or AMR-WB 16 kHz. High shelf is rolled off to stop harsh sibilance on mobile speakers.",
code: "sampleRate 16000 · channels 1 · codec PCMA · highShelf -4.5dB > 6kHz",
},
{
id: "noise",
title: "Noise suppression & VAD",
detail: "WebRTC AEC + RNNoise, VAD threshold tuned per workspace for car Bluetooth, windy streets and open-plan clinics.",
code: "echoCancellation true · noiseSuppression true · autoGainControl true",
},
{
id: "fillers",
title: "Comfort fillers & CNG",
detail: "Danish acknowledgements stream while tools resolve: “Ja, lige et øjeblik”, “Helt sikkert”, “Forstået”.",
code: 'fillers: ["Ja, lige et øjeblik.", "Helt sikkert.", "Forstået."]',
},
],
},
{
id: "agent",
label: "Turn-taking & latency budget",
summary: "Speech-to-speech budget stays under 600 ms on cellular by streaming each stage rather than waiting for full completions.",
stages: [
{ id: "stt", title: "Streaming STT", detail: "Partial transcripts arm barge-in; endpoints finalise on VAD silence.", latencyMs: 170 },
{ id: "llm", title: "LLM first token", detail: "Grounded prompt + tenant knowledge, streamed token-by-token through the OpenAI-compatible client.", latencyMs: 210 },
{ id: "tts", title: "TTS first byte", detail: "First audio frame is emitted before the sentence completes.", latencyMs: 130 },
{ id: "rtt", title: "Total round trip", detail: "Target < 600 ms end-to-end on cellular; MOS ≥ 4.2 with jitter under 15 ms.", latencyMs: 510 },
],
},
];

export interface WorkerFile {
path: string;
language: string;
purpose: string;
content: string;
}

export const AGENT_WORKER_FILES: WorkerFile[] = [
{
path: "agent-worker/entrypoint.py",
language: "python",
purpose: "Room entrypoint bound by the SIP dispatch payload — resolves tenant metadata and starts the AgentSession.",
content: `import asyncio
import json
import os

from livekit import rtc
from livekit.agents import JobContext, WorkerOptions, cli

from agent.session import build_session
from agent.telephony import TelephonyProfile


async def entrypoint(ctx: JobContext) -> None:
"""Called once per dispatched room (one call attempt)."""
await ctx.connect()

metadata = json.loads(ctx.job.metadata or "{}")
workspace_slug = metadata.get("workspaceSlug", "kbh-dental")
ring_delay_ms = int(metadata.get("ringDelayMs", 1200))
codec = metadata.get("codec", "PCMA")

profile = TelephonyProfile(
sample_rate=int(metadata.get("sampleRate", 16000)),
codec=codec,
noise_suppression=True,
comfort_noise=True,
eq_curve="warm-mid",
)

# Honour the Danish ring expectation before the agent speaks.
if ring_delay_ms > 0:
await asyncio.sleep(ring_delay_ms / 1000)

session = build_session(
workspace_slug=workspace_slug,
voice=metadata.get("voiceModel", "da-DK-ChristelNeural"),
language=metadata.get("greetingLanguage", "da"),
profile=profile,
)

await session.start(room=ctx.room, agent=session.agent)
await session.say_greeting()


if __name__ == "__main__":
cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, api_key=os.environ["LIVEKIT_API_KEY"],
api_secret=os.environ["LIVEKIT_API_SECRET"],
ws_url=os.environ["LIVEKIT_URL"]))
`,
},
{
path: "agent-worker/agent/session.py",
language: "python",
purpose: "Builds the AgentSession with Danish turn-taking, telephony-aware VAD and the tenant's grounded LLM config.",
content: `from dataclasses import dataclass

from livekit.agents import Agent, AgentSession
from livekit.plugins import azure, openai, silero

from agent.telephony import TelephonyProfile


@dataclass
class CustomerAgent(Agent):
workspace_slug: str
language: str = "da"

def __init__(self, workspace_slug: str, instructions: str, language: str = "da") -> None:
super().__init__(instructions=instructions)
self.workspace_slug = workspace_slug
self.language = language


def build_session(workspace_slug: str, voice: str, language: str, profile: TelephonyProfile) -> AgentSession:
instructions = (  # produced by the Nordic-Omni brain endpoint
open(f"prompts/{workspace_slug}.md", encoding="utf-8").read()
)

session = AgentSession(
stt=openai.STT(model="whisper-1", language="da"),
llm=openai.LLM(base_url="https://api.openai.com/v1", model="gpt-4o-mini", temperature=0.35),
tts=azure.TTS(voice=voice, sample_rate=profile.sample_rate, speed=1.0),
vad=silero.VAD.load(min_silence_duration=0.35, activation_threshold=0.55),
allow_interruptions=True,
min_interruption_duration=0.18,
)
session.agent = CustomerAgent(workspace_slug=workspace_slug, instructions=instructions, language=language)
return session
`,
},
{
path: "agent-worker/agent/telephony.py",
language: "python",
purpose: "Applies the PSTN acoustic profile: high-shelf rolloff, warm mid boost, comfort noise and telephone-safe gain.",
content: `from dataclasses import dataclass


@dataclass(frozen=True)
class TelephonyProfile:
sample_rate: int = 16000
codec: str = "PCMA"
noise_suppression: bool = True
comfort_noise: bool = True
eq_curve: str = "warm-mid"
gain_db: float = -2.0

@property
def filter_chain(self) -> list[tuple[str, float, float]]:
"""(biquad type, frequency Hz, gain dB) — applied to the TTS render."""
if self.eq_curve == "presence":
return [("lowshelf", 120, -1.0), ("peaking", 2400, 2.4)]
if self.eq_curve == "flat":
return []
return [("lowshelf", 120, 2.5), ("peaking", 1200, 1.2), ("highshelf", 6000, -4.5)]
`,
},
{
path: "livkit/sip-dispatch.yaml",
language: "yaml",
purpose: "LiveKit SIP inbound trunk + dispatch rule that the FlyNumber carrier forwards to.",
content: `apiVersion: v1
kind: SIPInboundTrunk
metadata:
name: flynumber-danish-dids
spec:
numbers:
- "+4535432110"
- "+4536174490"
- "+4533120000"
allowedAddresses:
- "185.76.32.0/24"      # FlyNumber media egress
krispEnabled: true        # carrier-grade noise suppression
---
apiVersion: v1
kind: SIPDispatchRule
metadata:
name: tenant-by-did
spec:
rule:
dispatchRuleIndividual:
roomPrefix: "call-"
pin: ""
roomConfig:
agents:
- agentName: "nordic-omni-receptionist"
emptyTimeout: 60
`,
},
];
