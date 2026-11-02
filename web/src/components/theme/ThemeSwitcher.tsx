'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTheme, ThemeMode } from '@/lib/theme/ThemeContext';
import { Sparkles, Sun, Zap, Check, ChevronDown } from 'lucide-react';

interface ThemeOption {
  id: ThemeMode;
  name: string;
  tag: string;
  dotColor: string;
  bgPreview: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'nordic-noir',
    name: 'Nordic Noir',
    tag: 'Cyber Obsidian',
    dotColor: '#00F5D4',
    bgPreview: '#07090E',
  },
  {
    id: 'industrial-volt',
    name: 'Industrial Volt',
    tag: 'Stark Monolith',
    dotColor: '#D4FF00',
    bgPreview: '#000000',
  },
  {
    id: 'surgical-daylight',
    name: 'Surgical Daylight',
    tag: 'Technical Light',
    dotColor: '#1D4ED8',
    bgPreview: '#F4F6F9',
  },
];

export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption = THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border-subtle,#1E2638)] bg-[var(--bg-surface,#0D111A)] text-[var(--text-primary,#FFFFFF)] hover:border-[var(--border-strong,#374151)] transition-all font-mono text-xs shadow-sm"
        title="Toggle Visual Theme"
      >
        <span
          className="w-2.5 h-2.5 rounded-full inline-block border border-black/40"
          style={{ backgroundColor: currentOption.dotColor }}
        />
        <span className="font-semibold">{currentOption.name}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60 ml-0.5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[var(--border-strong,#2B374E)] bg-[var(--bg-surface,#0D111A)] shadow-2xl p-1.5 z-50 backdrop-blur-xl animate-fade-in font-mono text-xs">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted,#64748B)] border-b border-[var(--border-subtle,#1E2638)] mb-1">
            Display Engine / Theme
          </div>

          {THEME_OPTIONS.map((opt) => {
            const isSelected = opt.id === theme;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setTheme(opt.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left ${
                  isSelected
                    ? 'bg-[var(--bg-raised,#171F2E)] text-[var(--text-primary,#FFFFFF)] font-bold'
                    : 'text-[var(--text-secondary,#94A3B8)] hover:bg-[var(--bg-ground,#08090C)] hover:text-[var(--text-primary,#FFFFFF)]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full border border-black/30 shadow-sm"
                    style={{ backgroundColor: opt.dotColor }}
                  />
                  <div>
                    <div className="leading-tight">{opt.name}</div>
                    <div className="text-[10px] text-[var(--text-muted,#64748B)]">{opt.tag}</div>
                  </div>
                </div>

                {isSelected && (
                  <Check className="w-3.5 h-3.5" style={{ color: opt.dotColor }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

