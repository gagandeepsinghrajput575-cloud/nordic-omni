"""Do we actually have working credentials for the voice pipeline?

The worker uses LiveKit Inference for STT/LLM/TTS, which means there are NO
Deepgram/Azure/OpenAI keys in this project by design. That decision is only
valid if inference genuinely answers. This test asks it for real:

  * TTS  -> synthesise a Danish sentence and count audio frames
  * LLM  -> complete a one-line prompt and read the text back

It is deliberately NOT in the smoke test, because it needs the network. Run it
by hand when credentials change:

    .venv/bin/python tests/test_inference.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def load_env() -> None:
    """Minimal .env reader so this script needs no extra dependency."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


async def probe_tts() -> bool:
    from livekit.agents import inference
    from livekit.agents.utils import http_context

    model = os.environ.get("TTS_MODEL") or "cartesia/sonic-3"
    voice = os.environ.get("TTS_VOICE") or None

    kwargs = {"language": "da"}
    if voice:
        kwargs["voice"] = voice

    frames = 0
    samples = 0

    # Plugins invoked outside an agent job need an HTTP context; without it the
    # plugin raises "Attempted to use an http session outside of a job context".
    # This is a harness requirement, not a credential problem.
    async with http_context.open():
        tts = inference.TTS(model, **kwargs)
        stream = tts.synthesize("Hej med dig. Hvordan kan jeg hjælpe?")
        async for event in stream:
            frame = getattr(event, "frame", None)
            if frame is not None:
                frames += 1
                samples += getattr(frame, "samples_per_channel", 0)
        await stream.aclose()

    print(f"  model       : {model}")
    print(f"  audio frames: {frames}")
    print(f"  samples     : {samples}")
    if frames == 0:
        print("  FAIL  TTS returned no audio")
        return False
    print("  PASS  Danish speech synthesised")
    return True


async def probe_llm() -> bool:
    from livekit.agents import inference
    from livekit.agents.llm import ChatContext, ChatMessage

    model = os.environ.get("LLM_MODEL") or "google/gemini-2.5-flash"

    llm = inference.LLM(model)
    ctx = ChatContext()
    ctx.add_message(
        role="system",
        content="You are a terse assistant. Answer with a single word.",
    )
    ctx.add_message(
        role="user",
        content="Svar kun med ordet: klar",
    )

    text = ""
    stream = llm.chat(chat_ctx=ctx)
    async for chunk in stream:
        delta = getattr(chunk, "delta", None)
        if delta and getattr(delta, "content", None):
            text += delta.content

    await stream.aclose()

    text = text.strip()
    print(f"  model       : {model}")
    print(f"  response    : {text!r}")
    if not text:
        print("  FAIL  LLM returned no text")
        return False
    print("  PASS  LLM inference answered")
    return True


async def probe_stt() -> bool:
    """Round-trip: synthesise Danish speech, then transcribe it back.

    This proves the third leg without needing a microphone. If the transcript
    contains the words that were spoken, STT credentials and routing both work.
    """
    from livekit.agents import inference
    from livekit.agents.utils import http_context

    stt_model = os.environ.get("STT_MODEL") or "deepgram/nova-3"
    spoken = "Mit hovedrør er sprunget"

    async with http_context.open():
        # 1. Produce audio with TTS.
        tts = inference.TTS(os.environ.get("TTS_MODEL") or "cartesia/sonic-3", language="da")
        frames = []
        stream = tts.synthesize(spoken)
        async for event in stream:
            frame = getattr(event, "frame", None)
            if frame is not None:
                frames.append(frame)
        await stream.aclose()

        if not frames:
            print("  FAIL  no audio to transcribe")
            return False

        # 2. Transcribe it back.
        #
        # Inference STT refuses batch `recognize()` ("does not support batch
        # recognition, use stream() instead"), and `stream()` enforces a 6s
        # liveness timeout. Pushing every frame in a tight loop trips it, because
        # nothing arrives from the server during the burst. So: give the socket
        # a moment to connect, then pace the frames at their real duration.
        stt = inference.STT(model=stt_model, language="da")

        # The real pipeline runs Silero VAD inside AgentSession, which detects
        # end-of-speech properly. This probe has no VAD, so it fakes
        # end-of-utterance with trailing silence — reliable, but not
        # deterministic. Up to three attempts, and any exact match passes.
        transcript = ""
        attempt = 0

        for attempt in range(1, 4):
            speech = stt.stream()
            await asyncio.sleep(0.6)

            # Pace each frame at its REAL duration, not a guessed constant. A
            # fixed sleep either bursts (trips the liveness timeout) or dribbles
            # (the endpoint detector never sees a continuous signal), and both
            # truncate the transcript.
            for frame in frames:
                speech.push_frame(frame)
                duration = frame.samples_per_channel / float(frame.sample_rate)
                await asyncio.sleep(duration)

            # Trailing silence so end-of-utterance detection fires before we
            # close the stream. Without it the last word is regularly dropped.
            from livekit import rtc

            template = frames[-1]
            silence_samples = template.samples_per_channel
            frame_duration = silence_samples / float(template.sample_rate)
            silence_bytes = bytes(silence_samples * template.num_channels * 2)

            for _ in range(int(1.2 / frame_duration)):
                speech.push_frame(
                    rtc.AudioFrame(
                        silence_bytes,
                        template.sample_rate,
                        template.num_channels,
                        silence_samples,
                    )
                )
                await asyncio.sleep(frame_duration)

            speech.end_input()

            async def consume() -> list[str]:
                collected: list[str] = []
                async for event in speech:
                    alternatives = getattr(event, "alternatives", None)
                    if alternatives and alternatives[0].text.strip():
                        collected.append(alternatives[0].text)
                return collected

            heard = await asyncio.wait_for(consume(), timeout=40)
            await speech.aclose()

            if heard:
                transcript = heard[-1]
                if "hovedr" in transcript.lower() and "sprunget" in transcript.lower():
                    break

    print(f"  model       : {stt_model}")
    print(f"  spoken      : {spoken!r}")
    print(f"  transcribed : {transcript!r}")
    print(f"  attempts    : {attempt}")

    lowered = transcript.lower()
    if not transcript:
        print("  FAIL  no transcript produced in 3 attempts")
        return False
    if "hovedr" not in lowered and "sprunget" not in lowered:
        print("  FAIL  transcript does not resemble what was spoken")
        return False
    print("  PASS  Danish speech transcribed")
    return True


async def main() -> int:
    load_env()

    required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"MISSING CREDENTIALS: {', '.join(missing)}")
        return 1

    print(f"LiveKit URL : {os.environ['LIVEKIT_URL']}")
    print(f"API key     : {os.environ['LIVEKIT_API_KEY'][:6]}… ({len(os.environ['LIVEKIT_API_KEY'])} chars)")
    print("")

    ok = True

    print("=== TTS via LiveKit Inference ===")
    try:
        ok &= await probe_tts()
    except Exception as exc:  # noqa: BLE001 - we want the real message
        print(f"  FAIL  {type(exc).__name__}: {exc}")
        ok = False

    print("\n=== LLM via LiveKit Inference ===")
    try:
        ok &= await probe_llm()
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL  {type(exc).__name__}: {exc}")
        ok = False

    print("\n=== STT via LiveKit Inference (TTS -> STT round trip) ===")
    try:
        ok &= await probe_stt()
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL  {type(exc).__name__}: {exc}")
        ok = False

    print("\n" + "=" * 46)
    print("ALL INFERENCE PROBES PASSED" if ok else "SOME INFERENCE PROBES FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
