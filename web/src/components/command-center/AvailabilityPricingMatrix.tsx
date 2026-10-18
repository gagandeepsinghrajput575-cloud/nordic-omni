'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Tag, Plus, Check, Edit2, Zap } from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';
import { PricingItem, BusinessDayHours } from '@/contracts/schemas';

const DAY_LABELS_DA: Record<string, string> = {
  mon: 'Mandag',
  tue: 'Tirsdag',
  wed: 'Onsdag',
  thu: 'Torsdag',
  fri: 'Fredag',
  sat: 'Lørdag',
  sun: 'Søndag',
};

const DAY_LABELS_EN: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export const AvailabilityPricingMatrix: React.FC = () => {
  const {
    currentTenant,
    status,
    highlightedPricingId,
    highlightedDayKey,
    optimisticUpdatePricing,
  } = useUICommandStore();

  const isDanish = currentTenant?.default_language === 'da-DK';
  const dayLabels = isDanish ? DAY_LABELS_DA : DAY_LABELS_EN;

  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [editPriceVal, setEditPriceVal] = useState<number>(0);

  if (status === 'skeleton' || !currentTenant) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-gray-950 border border-gray-800 animate-pulse space-y-4">
          <div className="h-5 w-40 bg-gray-800 rounded" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 bg-gray-900 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="p-5 rounded-2xl bg-gray-950 border border-gray-800 animate-pulse space-y-4">
          <div className="h-5 w-40 bg-gray-800 rounded" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 bg-gray-900 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const businessHours = currentTenant.business_hours;
  const pricingCatalog = currentTenant.pricing_catalog || [];

  const handleStartEditPricing = (item: PricingItem) => {
    setEditingPricingId(item.id);
    setEditPriceVal(item.price_dkk);
  };

  const handleSavePricing = (item: PricingItem) => {
    optimisticUpdatePricing({
      ...item,
      price_dkk: Number(editPriceVal),
    });
    setEditingPricingId(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. WEEKLY BUSINESS HOURS MATRIX */}
      <div className="p-5 rounded-2xl bg-gray-950/80 border border-gray-800/80 backdrop-blur-md shadow-xl">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-800/80">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/60 text-cyan-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white tracking-wide">
                {isDanish ? 'Ugentlige Åbningstider' : 'Weekly Business Hours'}
              </h3>
              <p className="text-[11px] text-gray-400">
                {isDanish ? 'Telefon- og kalendertider styret af AI' : 'Phone & calendar availability managed by AI'}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase bg-gray-800 px-2 py-0.5 rounded text-gray-300">
            {isDanish ? 'Dansk Tid (CET)' : 'Local Time (CET)'}
          </span>
        </div>

        <div className="space-y-2">
          {Object.entries(businessHours).map(([dayKey, hours]) => {
            const dayHours = hours as BusinessDayHours;
            const isHighlighted = highlightedDayKey === dayKey;

            return (
              <motion.div
                key={dayKey}
                animate={
                  isHighlighted
                    ? {
                        borderColor: '#00F5D4',
                        backgroundColor: 'rgba(0, 245, 212, 0.1)',
                        scale: [1, 1.02, 1],
                      }
                    : {
                        borderColor: 'rgba(31, 41, 55, 0.6)',
                        backgroundColor: 'rgba(17, 24, 39, 0.5)',
                      }
                }
                transition={{ duration: 0.3 }}
                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                  isHighlighted ? 'border-cyan-400 shadow-md shadow-cyan-500/20' : 'border-gray-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-20 font-bold text-gray-200">{dayLabels[dayKey] || dayKey}</span>
                  {dayHours.closed ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                      {isDanish ? 'Lukket for faste bookinger' : 'Closed for bookings'}
                    </span>
                  ) : (
                    <span className="font-mono text-gray-300">
                      {dayHours.open} - {dayHours.close}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {dayHours.closed ? (
                    <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {isDanish ? 'Kun Døgnvagt' : 'Emergency Only'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {isDanish ? 'Åben' : 'Open'}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 2. DKK SERVICE PRICING CATALOG */}
      <div className="p-5 rounded-2xl bg-gray-950/80 border border-gray-800/80 backdrop-blur-md shadow-xl">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-800/80">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-950/60 border border-purple-800/60 text-purple-400">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white tracking-wide">
                {isDanish ? 'Priskatalog & Ydelser (DKK)' : 'Services & Pricing Catalog (DKK)'}
              </h3>
              <p className="text-[11px] text-gray-400">
                {isDanish ? 'Realtidspriser oplyst af DeepSeek & LiveKit' : 'Real-time rates synced with voice & chat AI'}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
            {isDanish ? 'Live Overstyring' : 'Live Overrides'}
          </span>
        </div>

        <div className="space-y-2">
          {pricingCatalog.map((item) => {
            const isHighlighted = highlightedPricingId === item.id;
            const isEditing = editingPricingId === item.id;

            return (
              <motion.div
                key={item.id}
                animate={
                  isHighlighted
                    ? {
                        borderColor: '#00F5D4',
                        backgroundColor: 'rgba(0, 245, 212, 0.1)',
                        scale: [1, 1.02, 1],
                      }
                    : {
                        borderColor: 'rgba(31, 41, 55, 0.6)',
                        backgroundColor: 'rgba(17, 24, 39, 0.5)',
                      }
                }
                transition={{ duration: 0.3 }}
                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                  isHighlighted ? 'border-cyan-400 shadow-md shadow-cyan-500/20' : 'border-gray-800'
                }`}
              >
                <div className="flex-1 mr-3">
                  <span className="font-semibold text-gray-200 block">{item.service}</span>
                  <span className="text-[10px] text-gray-400 font-mono uppercase">
                    {isDanish ? 'Enhed:' : 'Unit:'} {item.unit}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={editPriceVal}
                        onChange={(e) => setEditPriceVal(Number(e.target.value))}
                        className="w-20 px-2 py-1 bg-gray-900 border border-cyan-400 rounded text-xs font-mono text-white focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSavePricing(item)}
                        className="p-1 rounded bg-cyan-400 text-black hover:bg-cyan-300"
                        title={isDanish ? 'Gem' : 'Save'}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white text-sm">
                        {item.price_dkk.toLocaleString(isDanish ? 'da-DK' : 'en-US')} DKK
                      </span>
                      <button
                        onClick={() => handleStartEditPricing(item)}
                        className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                        title={isDanish ? 'Redigér pris' : 'Edit rate'}
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {pricingCatalog.length === 0 && (
            <div className="py-8 text-center border border-dashed border-gray-800 rounded-xl">
              <p className="text-xs text-gray-500">
                {isDanish ? 'Ingen ydelser oprettet' : 'No services configured'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
