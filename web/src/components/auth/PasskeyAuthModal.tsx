'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Key, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { Tenant } from '@/contracts/schemas';

interface PasskeyAuthModalProps {
  tenant: Tenant;
  onAuthenticated: () => void;
}

export function PasskeyAuthModal({ tenant, onAuthenticated }: PasskeyAuthModalProps) {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);

  useEffect(() => {
    // If tenant has no passkey configured, unlock immediately
    if (!tenant.client_passkey) {
      setIsUnlocked(true);
      onAuthenticated();
      setIsChecking(false);
      return;
    }

    // 1. Check URL query param ?key=...
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('key');

    // 2. Check localStorage
    const storedKey = localStorage.getItem(`nordic_omni_passkey_${tenant.slug}`);

    const candidate = keyFromUrl || storedKey;
    if (candidate && validateKey(candidate)) {
      localStorage.setItem(`nordic_omni_passkey_${tenant.slug}`, candidate);
      setIsUnlocked(true);
      onAuthenticated();
    }

    setIsChecking(false);
  }, [tenant]);

  const validateKey = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    // Direct match or master bypass
    return (
      trimmed === tenant.client_passkey ||
      trimmed === 'MASTER-AGENCY-KEY' ||
      trimmed === '8899' ||
      trimmed === tenant.owner_pin
    );
  };

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (validateKey(inputKey)) {
      localStorage.setItem(`nordic_omni_passkey_${tenant.slug}`, inputKey.trim());
      setIsUnlocked(true);
      onAuthenticated();
    } else {
      setError('Invalid client passkey. Please check the key provided in Super-Admin.');
    }
  };

  if (isChecking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06080D]">
        <div className="w-8 h-8 rounded-full border-2 border-[#00F5D4] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isUnlocked) return null;

  const isDanish = tenant.default_language === 'da-DK';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#06080D]/95 backdrop-blur-2xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-[#0A0E17] border border-[#1E273A] rounded-3xl p-6 sm:p-8 shadow-2xl text-white text-center space-y-6 relative overflow-hidden"
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-[#00F5D4]/15 blur-2xl pointer-events-none" />

        {/* Lock Icon */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#00F5D4]/20 to-[#7B61FF]/20 border border-[#00F5D4]/40 flex items-center justify-center mx-auto text-[#00F5D4]">
          <Lock className="w-6 h-6" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            {tenant.name}
            <ShieldCheck className="w-4 h-4 text-[#00F5D4]" />
          </h2>
          <p className="text-xs text-[#8E9CAE] mt-1">
            {isDanish
              ? 'Dette workspace er beskyttet. Indtast din klient-adgangsnøgle (Passkey) for at fortsætte.'
              : 'This workspace is protected. Enter your Client Passkey to access CRM and recordings.'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="relative">
            <Key className="w-4 h-4 text-[#8E9CAE] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={inputKey}
              onChange={(e) => {
                setInputKey(e.target.value);
                if (error) setError(null);
              }}
              placeholder="CPK-XXXX-XXXX-SEC"
              className="w-full bg-[#101624] border border-[#232F48] focus:border-[#00F5D4] rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder-[#5A6980] font-mono tracking-wider focus:outline-none transition-colors"
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-[#00F5D4] to-[#00D2B6] hover:brightness-110 text-black font-bold text-xs rounded-2xl shadow-lg shadow-[#00F5D4]/20 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <span>{isDanish ? 'Lås Workspace Op' : 'Unlock Workspace'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="pt-2 border-t border-[#161D2B]">
          <p className="text-[11px] text-[#637286]">
            {isDanish ? 'Glemt adgangsnøgle? Kontakt administrator.' : 'Lost your passkey? Contact your agency administrator.'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
