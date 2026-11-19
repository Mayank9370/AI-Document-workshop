'use client';

import React from 'react';
import {
  Server,
  Database,
  Layers,
  Cpu,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { useBackendHealth } from '../hooks/useBackendHealth';
import { API_BASE_URL } from '../lib/api';
import { ConnectionStatus } from '../types/api';

interface StatusCardProps {
  name: string;
  role: string;
  status: ConnectionStatus;
  icon: React.ReactNode;
  port?: string;
  details: string;
}

const StatusCard: React.FC<StatusCardProps> = ({
  name,
  role,
  status,
  icon,
  port,
  details,
}) => {
  const getBadge = () => {
    switch (status) {
      case 'Connected':
        return {
          color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          label: 'Connected',
        };
      case 'Disconnected':
        return {
          color: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
          icon: <XCircle className="w-3.5 h-3.5" />,
          label: 'Disconnected',
        };
      case 'Checking':
      default:
        return {
          color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
          label: 'Checking',
        };
    }
  };

  const badge = getBadge();

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between mb-3">
          <div className="p-2.5 rounded-lg bg-slate-800/80 text-indigo-400 border border-slate-700/60">
            {icon}
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.color}`}
          >
            {badge.icon}
            {badge.label}
          </span>
        </div>
        <h3 className="font-semibold text-white text-base">{name}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{role}</p>
        {port && (
          <div className="mt-2 text-xs font-mono text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded inline-block">
            Port: {port}
          </div>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        {details}
      </div>
    </div>
  );
};

export const InfrastructureStatus: React.FC = () => {
  const { backend, mongodb, redis, qdrant, isLoading, lastChecked, errorMessage, refetch } =
    useBackendHealth();

  const services: StatusCardProps[] = [
    {
      name: 'Express Backend API',
      role: 'Core REST API & Orchestration',
      status: backend,
      port: '5000',
      icon: <Server className="w-5 h-5" />,
      details: 'Node.js, Express, Helmet, CORS, Zod validation',
    },
    {
      name: 'MongoDB Atlas',
      role: 'Document & Metadata Store',
      status: mongodb,
      icon: <Database className="w-5 h-5" />,
      details: 'External cloud cluster connected via Mongoose',
    },
    {
      name: 'Redis',
      role: 'Cache & Message Queue',
      status: redis,
      port: '6379',
      icon: <Cpu className="w-5 h-5" />,
      details: 'Docker container with AOF persistence',
    },
    {
      name: 'Qdrant Vector DB',
      role: 'Embeddings & Vector Search',
      status: qdrant,
      port: '6333 / 6334',
      icon: <Layers className="w-5 h-5" />,
      details: 'Vector engine running in Docker with persistent volume',
    },
  ];

  return (
    <section className="mt-8 space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Infrastructure &amp; Health Monitoring
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Real-time readiness status verified via backend endpoint <code className="text-indigo-400 font-mono text-xs">/api/health/ready</code>.
          </p>
        </div>

        <button
          onClick={refetch}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow transition cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Checking Readiness...' : 'Refresh Status'}
        </button>
      </div>

      {/* Error / Alert banner if degraded */}
      {errorMessage && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3.5 text-xs text-rose-300 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>
            <strong>Readiness Notice:</strong> {errorMessage}
          </span>
        </div>
      )}

      {/* Configured API Information bar */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
        <span>
          Configured Base API: <code className="text-indigo-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">{API_BASE_URL}</code>
        </span>
        {lastChecked && (
          <span className="text-slate-400">
            Last Checked: <strong className="text-slate-300">{lastChecked}</strong>
          </span>
        )}
      </div>

      {/* Real-time Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map((svc) => (
          <StatusCard key={svc.name} {...svc} />
        ))}
      </div>
    </section>
  );
};
