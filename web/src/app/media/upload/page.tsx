'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, CheckCircle2, Upload, AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react';

function UploadContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selected]);

    const newPreviews = selected.map((file) => URL.createObjectURL(file));
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Ugyldigt eller manglende upload-link. Kontakt venligst virksomheden.');
      return;
    }
    if (files.length === 0) {
      setError('Vælg venligst mindst ét billede af projektet.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        formData.append('description', description);

        const res = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Kunne ikke uploade billede');
        }
      }
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Der opstod en fejl under upload');
    } finally {
      setUploading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Ugyldigt upload-link</h1>
          <p className="text-sm text-slate-400">
            Dette upload-link mangler en gyldig adgangsnøgle. Tjek SMS-beskeden fra håndværkeren eller anmod om et nyt link.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 text-center shadow-xl">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Billederne er modtaget!</h1>
          <p className="text-slate-300 text-sm mb-6 leading-relaxed">
            Mange tak! Vi har modtaget dine billeder. Vores koordinator og beregner kigger på dem nu og udarbejder et vejledende overslag til dig.
          </p>
          <div className="bg-slate-800/60 rounded-xl p-4 text-xs text-slate-400 border border-slate-800">
            <span className="font-semibold text-slate-200 block mb-1">Næste skridt:</span>
            Du hører fra os inden for kort tid med et realistisk prisoverslag og forslag til eventuel besigtigelse.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 flex items-center justify-center">
      <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-blue-500/10 text-blue-400 mb-3 border border-blue-500/20">
            <Camera className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Upload projektbilleder</h1>
          <p className="text-sm text-slate-400 mt-1">
            Send billeder af opgaven, så vi kan vurdere omfanget og give dig et hurtigt overslag.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="file-upload"
              className="border-2 border-dashed border-slate-700 hover:border-blue-500/60 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-950/40 hover:bg-blue-500/5 group"
            >
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-blue-400 mb-2 transition-colors" />
              <span className="text-sm font-medium text-slate-200">
                Tryk her for at tage eller vælge fotos
              </span>
              <span className="text-xs text-slate-500 mt-1">
                JPEG, PNG, WebP eller HEIC (maks 10 MB pr. billede)
              </span>
              <input
                id="file-upload"
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {previews.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Valgte billeder ({previews.length})
              </label>
              <div className="grid grid-cols-3 gap-3">
                {previews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Kort kommentar til opgaven (valgfrit)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="F.eks. Ca. 8 m2 badeværelse, ønsker nye fliser og væghængt toilet..."
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none h-24"
            />
          </div>

          <button
            type="submit"
            disabled={uploading || files.length === 0}
            className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploader billeder...</span>
              </>
            ) : (
              <>
                <ImageIcon className="w-4 h-4" />
                <span>Indsend {files.length > 0 ? `${files.length} billeder` : 'billeder'}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function MediaUploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Indlæser...</div>}>
      <UploadContent />
    </Suspense>
  );
}
