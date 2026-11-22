'use client';

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
import {
  type VisibilityMode,
  type FeatureFlagConfig,
  MOCK_FEATURE_FLAGS,
  calculateClientPortalVisibility,
} from './workforce-types';

export function FeatureSwitchboardSimulator() {
  const [flags, setFlags] = useState<Record<string, VisibilityMode>>(() => {
    const initial: Record<string, VisibilityMode> = {};
    for (const flag of MOCK_FEATURE_FLAGS) {
      initial[flag.flagKey] = flag.mode;
    }
    return initial;
  });

  const handleModeChange = (key: string, mode: VisibilityMode) => {
    setFlags((prev) => ({
      ...prev,
      [key]: mode,
    }));
  };

  const visibility = calculateClientPortalVisibility(flags);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6">
      <div className="flex flex-col gap-1 pb-5 border-b border-[var(--line)]">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-[var(--muted)] tracking-wider uppercase">
              Client Portal Entitlements
            </span>
            <h2 className="text-[18px] font-semibold tracking-tight text-[var(--text)] mt-1">
              Feature Visibility Switchboard
            </h2>
          </div>
          <span className="rounded border border-[var(--line)] bg-[var(--surface-raised)] px-2.5 py-1 text-[11px] text-[var(--muted)] font-mono">
            3-Way Matrix
          </span>
        </div>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1">
          Configure which autonomous AI capabilities are enabled in production, displayed as upgrade teasers with fixed pricing, or hidden from the client portal.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Switchboard Controls (7 cols) */}
        <div className="space-y-3 lg:col-span-7">
          {MOCK_FEATURE_FLAGS.map((flag) => {
            const currentMode = flags[flag.flagKey] || 'hidden';
            return (
              <div
                key={flag.flagKey}
                className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--text)]">
                      {flag.name}
                    </span>
                    {flag.upsellPrice && (
                      <span className="rounded border border-[var(--line)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] font-mono">
                        {flag.upsellPrice}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{flag.description}</p>
                </div>

                {/* 3-Way Segmented Control */}
                <div className="flex items-center rounded-md border border-[var(--line)] bg-[var(--panel)] p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleModeChange(flag.flagKey, 'active')}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      currentMode === 'active'
                        ? 'bg-[var(--text)] text-[var(--bg)] shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange(flag.flagKey, 'teaser')}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      currentMode === 'teaser'
                        ? 'bg-[var(--surface-raised)] text-[var(--text)] border border-[var(--line)]'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Teaser
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange(flag.flagKey, 'hidden')}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      currentMode === 'hidden'
                        ? 'bg-[var(--surface-raised)] text-[var(--muted)] border border-[var(--line)]'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Hidden
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Live Client Portal Preview (5 cols) */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-4 lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                <span className="text-[12px] font-medium text-[var(--text)]">
                  Live Client View (København VVS)
                </span>
              </div>
              <span className="text-[11px] text-[var(--muted)] font-mono">
                /portal
              </span>
            </div>

            <p className="mt-3 text-[12px] text-[var(--text-muted)]">
              Real-time render of client workspace navigation based on active matrix settings:
            </p>

            <div className="mt-3 space-y-2">
              {/* Active Features */}
              {visibility.activeFeatures.map((key) => {
                const item = MOCK_FEATURE_FLAGS.find((f) => f.flagKey === key);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="dot-live" aria-hidden />
                      <span className="font-medium text-[var(--text)]">{item?.name}</span>
                    </div>
                    <span className="text-[11px] text-[var(--muted)]">Active</span>
                  </div>
                );
              })}

              {/* Teaser Features */}
              {visibility.teaserFeatures.map((key) => {
                const item = MOCK_FEATURE_FLAGS.find((f) => f.flagKey === key);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded border border-dashed border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <Lock size={12} className="text-[var(--muted)]" aria-hidden />
                      <span className="text-[var(--text-secondary)]">{item?.name}</span>
                    </div>
                    <span className="text-[11px] text-[var(--muted)] font-mono">
                      {item?.upsellPrice || 'Upgrade'}
                    </span>
                  </div>
                );
              })}

              {/* Hidden features are not rendered */}
              {visibility.hiddenFeatures.length > 0 && (
                <p className="pt-2 text-[11px] text-[var(--muted)] italic">
                  + {visibility.hiddenFeatures.length} module{visibility.hiddenFeatures.length > 1 ? 's' : ''} completely hidden from client view
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>Client sub-account tenant guard</span>
            <span className="font-mono text-[var(--text)]">RLS Enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
}
