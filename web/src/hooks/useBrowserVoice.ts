"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognition,
  isSpeechSynthesisSupported,
  pickVoice,
  speechLocale,
  type SpeechRecognitionLike,
} from "@/lib/speech";
import type { Language } from "@/lib/types";

interface UseBrowserVoiceOptions {
  language: Language;
  onUtterance: (text: string) => void;
  onBargeIn?: () => void;
}

export interface BrowserVoiceApi {
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  listening: boolean;
  speaking: boolean;
  interim: string;
  error: string | null;
  micStream: MediaStream | null;
  startListening: () => Promise<boolean>;
  stopListening: () => void;
  speak: (text: string, language?: Language) => Promise<void>;
  cancelSpeech: () => void;
  endSession: () => void;
  clearError: () => void;
}

export function useBrowserVoice({ language, onUtterance, onBargeIn }: UseBrowserVoiceOptions): BrowserVoiceApi {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const lastSpokenRef = useRef("");
  const languageRef = useRef(language);
  const utteranceRef = useRef(onUtterance);
  const bargeInRef = useRef(onBargeIn);
  const resolveSpeechRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    languageRef.current = language;
    if (recognitionRef.current) {
      recognitionRef.current.lang = speechLocale(language);
    }
  }, [language]);

  useEffect(() => {
    utteranceRef.current = onUtterance;
    bargeInRef.current = onBargeIn;
  }, [onUtterance, onBargeIn]);

  const recognitionSupported = typeof window !== "undefined" && getSpeechRecognition() !== null;
  const synthesisSupported = isSpeechSynthesisSupported();

  const cancelSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
    setSpeaking(false);
    const resolve = resolveSpeechRef.current;
    resolveSpeechRef.current = null;
    resolve?.();
  }, []);

  const speak = useCallback(
    async (text: string, spokenLanguage?: Language): Promise<void> => {
      if (!text.trim()) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setError("This browser cannot play synthetic speech. Subtitles are shown instead.");
        return;
      }
      cancelSpeech();
      const locale = spokenLanguage ?? languageRef.current;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speechLocale(locale);
      utterance.rate = 1.02;
      utterance.pitch = 1;
      const voice = pickVoice(locale);
      if (voice) utterance.voice = voice;
      lastSpokenRef.current = text.toLowerCase();
      speakingRef.current = true;
      setSpeaking(true);

      await new Promise<void>((resolve) => {
        const finish = (): void => {
          speakingRef.current = false;
          resolveSpeechRef.current = null;
          setSpeaking(false);
          resolve();
        };
        resolveSpeechRef.current = finish;
        utterance.onend = finish;
        utterance.onerror = finish;
        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          finish();
        }
      });
    },
    [cancelSpeech],
  );

  const buildRecognition = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return null;
    if (recognitionRef.current) return recognitionRef.current;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = speechLocale(languageRef.current);

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        if (!alternative) continue;
        if (result.isFinal) {
          finalText += alternative.transcript;
        } else {
          interimText += alternative.transcript;
        }
      }

      const trimmedInterim = interimText.trim();
      if (trimmedInterim) {
        setInterim(trimmedInterim);
        const spoken = lastSpokenRef.current;
        const words = trimmedInterim.toLowerCase().split(/\s+/).filter(Boolean);
        const overlaps = spoken.includes(words.join(" "));
        if (speakingRef.current && words.length >= 2 && !overlaps) {
          cancelSpeech();
          bargeInRef.current?.();
        }
      }

      if (finalText.trim()) {
        setInterim("");
        const normalized = finalText.trim().toLowerCase();
        const spoken = lastSpokenRef.current;
        if (speakingRef.current && spoken.includes(normalized)) {
          return;
        }
        if (speakingRef.current) {
          cancelSpeech();
          bargeInRef.current?.();
        }
        utteranceRef.current(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow the mic or type your message below.");
        activeRef.current = false;
        setListening(false);
      } else if (event.error === "network") {
        setError("Speech recognition lost its network connection. You can type instead.");
      } else if (event.error === "no-speech") {
        setError(null);
      }
    };

    recognition.onend = () => {
      if (activeRef.current) {
        try {
          recognition.start();
        } catch {
          activeRef.current = false;
          setListening(false);
        }
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [cancelSpeech]);

  const startListening = useCallback(async (): Promise<boolean> => {
    setError(null);
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Live speech recognition needs Chrome, Edge or Safari. You can still type to the receptionist.");
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access a microphone. Typed chat is still available.");
      return false;
    }

    if (!streamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        setMicStream(stream);
      } catch {
        setError("Microphone permission was denied. Allow mic access in your browser to speak live.");
        return false;
      }
    }

    const recognition = buildRecognition();
    if (!recognition) {
      setError("Live speech recognition is unavailable in this browser.");
      return false;
    }

    activeRef.current = true;
    setListening(true);
    try {
      recognition.lang = speechLocale(languageRef.current);
      recognition.start();
    } catch {
      // Already started — onend will keep the loop alive.
    }
    return true;
  }, [buildRecognition]);

  const stopListening = useCallback(() => {
    activeRef.current = false;
    setListening(false);
    setInterim("");
    try {
      recognitionRef.current?.stop();
    } catch {
      // Recognition already stopped.
    }
  }, []);

  const endSession = useCallback(() => {
    stopListening();
    cancelSpeech();
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore.
    }
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicStream(null);
  }, [cancelSpeech, stopListening]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(
    () => () => {
      activeRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore teardown errors.
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  return {
    recognitionSupported,
    synthesisSupported,
    listening,
    speaking,
    interim,
    error,
    micStream,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
    endSession,
    clearError,
  };
}