'use client';

import React, { useState, useEffect, use } from 'react';
import {
  Star,
  MessageSquare,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Share2,
  Copy,
  Check,
  Send,
  Loader2,
} from 'lucide-react';

interface TenantReviewInfo {
  businessName: string;
  ownerName: string;
  customerName: string;
  googleReviewUrl: string;
}

export default function ReviewGatekeeperPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<TenantReviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    status: 'internal_feedback' | 'redirected_to_google';
    googleUrl: string;
    message?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const res = await fetch(`/api/review/${token}`);
        if (!res.ok) {
          throw new Error('Ugyldigt eller udløbet anmeldelseslink');
        }
        const data = await res.json();
        setInfo(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Kunne ikke hente information');
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          feedbackText: feedback,
          platform: 'web',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fejl ved indsendelse');

      setResult(data);

      if (data.status === 'redirected_to_google' && data.googleUrl) {
        // Copy review text to clipboard if user wrote something
        if (feedback.trim() && navigator.clipboard) {
          await navigator.clipboard.writeText(feedback.trim()).catch(() => {});
        }
        // Small delay then redirect to Google Review page
        setTimeout(() => {
          window.location.href = data.googleUrl;
        }, 1200);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kunne ikke indsende anmeldelse');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (feedback.trim() && navigator.clipboard) {
      navigator.clipboard.writeText(feedback.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Ugyldigt anmeldelseslink</h1>
          <p className="text-sm text-slate-400">
            {error || 'Linket er ikke længere gyldigt. Kontakt venligst virksomheden.'}
          </p>
        </div>
      </div>
    );
  }

  // Result screen after submission
  if (result) {
    if (result.status === 'redirected_to_google') {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-emerald-500/30 rounded-3xl p-8 text-center shadow-2xl">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Mange tak for din anmeldelse!</h1>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              Din anmeldelse er kopieret til udklipsholderen. Vi viderestiller dig nu til Google, hvor du blot kan indsætte din tekst.
            </p>
            <a
              href={result.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm shadow-lg shadow-blue-600/20 transition-all"
            >
              <span>Åbn Google Anmeldelser manuelt</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      );
    }

    // Low rating internal resolution screen (compliant with Markedsføringsloven)
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
          <MessageSquare className="w-14 h-14 text-blue-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Tak for din ærlige feedback</h1>
          <p className="text-slate-300 text-sm mb-6 leading-relaxed">
            {result.message || 'Din besked er sendt direkte til ledelsen. Vi kontakter dig snarest muligt for at rette op på tingene.'}
          </p>
          <div className="pt-4 border-t border-slate-800/80 text-xs text-slate-500 flex flex-col gap-2">
            <span>Vil du stadig gå til den offentlige Google-profil?</span>
            <a
              href={result.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline flex items-center justify-center gap-1"
            >
              <span>Gå til Google anmeldelser</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  const isLowRating = rating < 3;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 flex items-center justify-center">
      <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 text-amber-400 mb-3 border border-amber-500/20">
            <Star className="w-7 h-7 fill-amber-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Hvordan var din oplevelse med {info.businessName}?
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            {info.customerName ? `Hej ${info.customerName}, vi` : 'Vi'} sætter stor pris på din mening, så vi hele tiden kan levere det bedste håndværk.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Star selector */}
          <div className="flex flex-col items-center justify-center py-2">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = (hoverRating || rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                    className="p-1.5 focus:outline-none transition-transform hover:scale-110"
                    aria-label={`${star} stjerner`}
                  >
                    <Star
                      className={`w-9 h-9 ${
                        filled ? 'text-amber-400 fill-amber-400' : 'text-slate-700'
                      } transition-colors`}
                    />
                  </button>
                );
              })}
            </div>
            <span className="text-xs font-medium text-slate-400 mt-2">
              {rating === 5 && 'Fremragende — 5 ud af 5 stjerner'}
              {rating === 4 && 'Rigtig god — 4 ud af 5 stjerner'}
              {rating === 3 && 'Gennemsnitlig — 3 ud af 5 stjerner'}
              {rating === 2 && 'Under forventning — 2 ud af 5 stjerner'}
              {rating === 1 && 'Utilfredsstillende — 1 ud af 5 stjerner'}
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              {isLowRating ? 'Hvad kunne vi have gjort bedre?' : 'Skriv et par ord om din oplevelse'}
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={
                isLowRating
                  ? 'Fortæl os hvad der gik galt, så vi kan rette op på det med det samme...'
                  : 'F.eks. Hurtig betjening, pænt opryddet efter arbejdet og god kommunikation...'
              }
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none h-28"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
              isLowRating
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/25'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Indsender...</span>
              </>
            ) : isLowRating ? (
              <>
                <Send className="w-4 h-4" />
                <span>Indsend direkte til ledelsen</span>
              </>
            ) : (
              <>
                <Star className="w-4 h-4 fill-white" />
                <span>Indsend og del på Google</span>
              </>
            )}
          </button>
        </form>

        {/* Quick share options */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Share2 className="w-4 h-4 text-slate-500" />
            <span>Del oplevelse:</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Jeg har lige anmeldt mit projekt hos ${info.businessName}: ${typeof window !== 'undefined' ? window.location.href : ''}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-400 transition-colors"
            >
              WhatsApp
            </a>
            <span className="text-slate-700">•</span>
            <button
              type="button"
              onClick={handleCopy}
              className="hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Kopieret' : 'Kopiér link'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
