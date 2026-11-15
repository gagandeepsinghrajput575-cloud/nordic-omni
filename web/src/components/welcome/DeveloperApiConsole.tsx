'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import { GlidingTabSwitcher } from './GlidingTabSwitcher';
import { tokenize } from './code-highlight';
import {
  DISPATCH_PATH,
  LANGUAGES,
  WEBHOOK_PATH,
  snippetFor,
  type SnippetLanguage,
} from './code-samples';

/**
 * The developer console.
 *
 * Three behaviours worth calling out:
 *
 * **Instant switching.** All four snippets are plain strings in the same module,
 * so a language change is a `useMemo` recompute over ~12 lines. Switching tabs
 * cannot flicker because there is nothing to wait for — no fetch, no import, no
 * async grammar. It is deliberately *not* animated: a cross-fade here would be
 * the flicker it is meant to avoid, and the pill already supplies the motion.
 *
 * **Copy morph.** The icon springs from copy-glyph to check-glyph at 1.2x and
 * settles. Reduced motion swaps the glyph with no scale.
 *
 * **No innerHTML.** `tokenize` returns tokens and this component renders spans,
 * so a snippet can never inject markup.
 */

export type EndpointId = 'webhook' | 'dispatch';

export interface EndpointSummary {
  id: EndpointId;
  method: 'POST';
  path: string;
  description: string;
}

export const ENDPOINTS: ReadonlyArray<EndpointSummary> = [
  {
    id: 'webhook',
    method: 'POST',
    path: WEBHOOK_PATH,
    description: 'Universel indgang: ét signeret endepunkt til CRM og telefoni.',
  },
  {
    id: 'dispatch',
    method: 'POST',
    path: DISPATCH_PATH,
    description: 'Telefoni-dispatch: bind et indgående opkald til agentens rum.',
  },
];

export interface DeveloperApiConsoleProps {
  className?: string;
}

const COPIED_MS = 2000;

export function DeveloperApiConsole({ className }: DeveloperApiConsoleProps) {
  const reduceMotion = useReducedMotion();
  const [language, setLanguage] = useState<SnippetLanguage>('ts');
  const [endpoint, setEndpoint] = useState<EndpointId>('webhook');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const code = snippetFor(language);
  // Memoised on the snippet: every language is a string in the same module, so
  // switching is a recompute over ~12 lines with nothing to await.
  const lines = useMemo(() => tokenize(code), [code]);

  const activePath = ENDPOINTS.find((candidate) => candidate.id === endpoint)?.path ?? WEBHOOK_PATH;

  const clearReset = useCallback(() => {
    if (resetRef.current !== null) {
      clearTimeout(resetRef.current);
      resetRef.current = null;
    }
  }, []);

  useEffect(() => clearReset, [clearReset]);

  const copy = useCallback(async () => {
    clearReset();
    setCopyFailed(false);
    try {
      // `navigator.clipboard` is undefined on insecure origins, so the failure
      // is a real path rather than paranoia.
      await navigator.clipboard.writeText(code);
      setCopied(true);
      resetRef.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }, [clearReset, code]);

  return (
    <div className={['devc-terminal', className ?? ''].filter(Boolean).join(' ')}>
      <div className="devc-terminal__bar">
        <span className="devc-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="devc-terminal__label">{activePath}</span>

        <span className="devc-terminal__actions">
          <button
            type="button"
            className="devc-copy"
            data-copied={copied ? 'true' : 'false'}
            onClick={copy}
            aria-label={copied ? 'Kopieret' : 'Kopier kode'}
          >
            <motion.span
              // The bounce is a scale on a 16px glyph: the whole point is that
              // it is felt rather than watched.
              animate={copied && !reduceMotion ? { scale: [1, 1.2, 1] } : { scale: 1 }}
              transition={
                reduceMotion ? { duration: 0 } : { ...springFor(reduceMotion, SPRING), duration: 0.2 }
              }
              style={{ display: 'inline-flex' }}
              aria-hidden="true"
            >
              {copied ? <CheckGlyph /> : <CopyGlyph />}
            </motion.span>
            <span>{copied ? 'Kopieret' : copyFailed ? 'Kunne ikke kopiere' : 'Kopier'}</span>
          </button>
        </span>
      </div>

      <div className="devc-tabs">
        <GlidingTabSwitcher
          options={LANGUAGES}
          value={language}
          onChange={setLanguage}
          label="Vælg sprog"
        />
        <span className="devc-req">POST · application/json</span>
      </div>

      <pre className="devc-code" tabIndex={0} aria-label={`${language} eksempel`}>
        {lines.map((line, index) => (
          <span className="devc-line" key={index}>
            <span className="devc-line__num" aria-hidden="true">
              {index + 1}
            </span>
            {line.tokens.map((token, tokenIndex) => (
              <span
                key={tokenIndex}
                className={token.kind === 'plain' ? 'devc-code__plain' : `devc-tok-${token.kind}`}
              >
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}

function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <rect x="4.6" y="4.6" width="7.4" height="7.4" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.4 3.4A1.6 1.6 0 0 0 7.8 2H3.6A1.6 1.6 0 0 0 2 3.6v4.2c0 .7.4 1.3 1 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path d="M2.6 7.4 5.6 10.4 11.4 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
