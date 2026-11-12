export interface AnalyserRuntime {
  analyser: AnalyserNode;
  dataArray: Uint8Array;
  dispose: () => void;
}

function disconnect(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    // A node can already be disconnected by a closing AudioContext.
  }
}

function closeContext(context: AudioContext | null): void {
  if (!context || context.state === 'closed') return;
  try {
    void context.close().catch(() => undefined);
  } catch {
    // Some WebKit implementations throw synchronously while closing.
  }
}

/** Own every Web Audio resource associated with one MediaStream effect. */
export function createAnalyserRuntime(audioStream: MediaStream): AnalyserRuntime | null {
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let resume: (() => void) | null = null;

  try {
    if (audioStream.getAudioTracks().length === 0) return null;
    const AudioContextConstructor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    context = new AudioContextConstructor();
    analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    source = context.createMediaStreamSource(audioStream);
    source.connect(analyser);

    const ownedContext = context;
    resume = () => {
      if (ownedContext.state === 'suspended') {
        void ownedContext.resume().catch(() => undefined);
      }
    };
    resume();
    ownedContext.addEventListener('statechange', resume);
    document.addEventListener('visibilitychange', resume);

    let disposed = false;
    return {
      analyser,
      dataArray: new Uint8Array(analyser.frequencyBinCount),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        ownedContext.removeEventListener('statechange', resume as () => void);
        document.removeEventListener('visibilitychange', resume as () => void);
        disconnect(source);
        disconnect(analyser);
        closeContext(ownedContext);
      },
    };
  } catch {
    if (context && resume) context.removeEventListener('statechange', resume);
    if (resume) document.removeEventListener('visibilitychange', resume);
    disconnect(source);
    disconnect(analyser);
    closeContext(context);
    return null;
  }
}

export interface MotionPreference {
  readonly reduced: boolean;
  dispose: () => void;
}

/** Subscribe to live preference changes, including older Safari's listener API. */
export function createMotionPreference(onChange: () => void): MotionPreference {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = query.matches;
  let disposed = false;
  const changed = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    if (!disposed) onChange();
  };
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', changed);
  } else {
    query.addListener(changed);
  }

  return {
    get reduced() {
      return reduced;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', changed);
      } else {
        query.removeListener(changed);
      }
    },
  };
}

export interface FrameLoop {
  refresh: () => void;
  dispose: () => void;
}

/** A single owned RAF chain with 33 ms pacing and an immediate static fallback. */
export function createPacedFrameLoop(
  draw: (now: number) => void,
  shouldAnimate: () => boolean,
): FrameLoop {
  let frameId: number | null = null;
  let disposed = false;
  let last = 0;

  const cancel = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  };
  const schedule = () => {
    if (!disposed && shouldAnimate() && frameId === null) {
      frameId = requestAnimationFrame(tick);
    }
  };
  const tick = (now: number) => {
    frameId = null;
    if (disposed || !shouldAnimate()) return;
    if (now - last >= 33) {
      last = now;
      draw(now);
    }
    schedule();
  };

  draw(0);
  schedule();
  return {
    refresh: () => {
      if (disposed) return;
      cancel();
      last = 0;
      draw(0);
      schedule();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  };
}
