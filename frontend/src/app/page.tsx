import React from 'react';
import { InfrastructureStatus } from '../components/InfrastructureStatus';
import { FileText, Shield, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="space-y-10">
      {/* Hero Section */}
      <section className="text-center max-w-3xl mx-auto pt-6 pb-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-4">
          <Zap className="w-3.5 h-3.5" /> Phase 1 Setup Completed
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          AI Document Workspace
        </h1>
        <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
          A modern, high-performance monorepo platform designed for intelligent document ingestion, 
          semantic search, and AI-driven conversational analysis.
        </p>

        {/* High-level Architecture Highlights */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3.5">
            <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
              <FileText className="w-4 h-4" /> Clean Monorepo
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Independent Next.js App Router frontend and Express TypeScript backend.
            </p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3.5">
            <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
              <Zap className="w-4 h-4" /> Dockerized Stack
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Redis for queueing/cache and Qdrant for vector embeddings storage.
            </p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3.5">
            <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
              <Shield className="w-4 h-4" /> Secure &amp; Scalable
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Separation of secrets, CORS &amp; Helmet security headers, strictly typed.
            </p>
          </div>
        </div>
      </section>

      {/* Infrastructure Status Component (Static placeholder) */}
      <InfrastructureStatus />
    </div>
  );
}
