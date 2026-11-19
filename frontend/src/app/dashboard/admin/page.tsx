'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { fetchAdminStats, fetchAdminActivity } from '@/services/api.service';
import { AdminStatsData, AdminActivityItem } from '@/types/api';
import {
  ShieldCheck,
  ShieldAlert,
  Users,
  UserCheck,
  UserPlus,
  FileText,
  Layers,
  MessageSquare,
  MessageCircle,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Activity,
  HardDrive,
  Database,
  Search,
  Filter,
} from 'lucide-react';

export default function AdminDashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const [stats, setStats] = useState<AdminStatsData | null>(null);
  const [activities, setActivities] = useState<AdminActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'user' | 'document' | 'chat'>('all');

  const loadAdminData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);

    try {
      const [statsRes, activityRes] = await Promise.all([
        fetchAdminStats(),
        fetchAdminActivity(30),
      ]);

      if (statsRes.data) {
        setStats(statsRes.data);
      }
      if (activityRes.data) {
        setActivities(activityRes.data.activities);
      }
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load admin statistics.';
      setErrorMessage(msg);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAdminData();
    }
  }, [user, loadAdminData]);

  // If still checking session
  if (isAuthLoading) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm">Verifying authorization credentials...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Access Denied Screen for regular users
  if (user && user.role !== 'admin') {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-8 text-center space-y-4 shadow-2xl">
            <div className="p-3 bg-rose-500/10 text-rose-400 rounded-2xl w-14 h-14 flex items-center justify-center mx-auto border border-rose-500/20">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Access Denied (403 Forbidden)</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Administrator privileges are strictly required to view system analytics and activity logs.
              Your account (<span className="text-slate-300 font-medium">{user.email}</span>) has the standard{' '}
              <span className="text-emerald-400 font-semibold uppercase">{user.role}</span> role.
            </p>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Return to User Dashboard
              </Link>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Filter activities
  const filteredActivities = activities.filter((act) => {
    if (activityFilter === 'all') return true;
    if (activityFilter === 'user') return act.type === 'user_registered';
    if (activityFilter === 'document') return act.type.startsWith('document_');
    if (activityFilter === 'chat') return act.type === 'chat_message';
    return true;
  });

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-600/20 border border-purple-500/30 text-purple-400 rounded-xl">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">Admin Intelligence Dashboard</h1>
                  <p className="text-xs text-slate-400">
                    System-wide telemetry, user growth, document ingestion pipelines, and conversational analytics.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastRefreshed && (
                <span className="text-[11px] text-slate-500 hidden md:inline">
                  Last updated: {lastRefreshed}
                </span>
              )}

              <button
                type="button"
                onClick={() => loadAdminData(false)}
                disabled={isLoading}
                className="p-2 sm:px-3 sm:py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
                <span className="hidden sm:inline">Refresh Data</span>
              </button>

              <Link
                href="/dashboard"
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>User Dashboard</span>
              </Link>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span className="text-xs">{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-xs text-rose-400 hover:text-rose-200 underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Top Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Metric 1: Total Users */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Users</span>
                <Users className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {isLoading ? (
                  <div className="h-7 w-16 bg-slate-800 animate-pulse rounded" />
                ) : (
                  stats?.users.total.toLocaleString() ?? '0'
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <span>Platform registered accounts</span>
              </p>
            </div>

            {/* Metric 2: Active Users */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Active Users (30d)</span>
                <UserCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400 tracking-tight">
                {isLoading ? (
                  <div className="h-7 w-16 bg-slate-800 animate-pulse rounded" />
                ) : (
                  stats?.users.active.toLocaleString() ?? '0'
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Active within the last 30 days
              </p>
            </div>

            {/* Metric 3: New Users (7d / 30d) */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>New Users</span>
                <UserPlus className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight flex items-baseline gap-2">
                {isLoading ? (
                  <div className="h-7 w-24 bg-slate-800 animate-pulse rounded" />
                ) : (
                  <>
                    <span>+{stats?.users.new7d ?? 0}</span>
                    <span className="text-xs font-normal text-slate-400">/ 7 days</span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                +{stats?.users.new30d ?? 0} in the last 30 days
              </p>
            </div>

            {/* Metric 4: Total Documents */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Documents</span>
                <FileText className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {isLoading ? (
                  <div className="h-7 w-16 bg-slate-800 animate-pulse rounded" />
                ) : (
                  stats?.documents.total.toLocaleString() ?? '0'
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <span className="text-emerald-400 font-medium">{stats?.documents.ready ?? 0} ready</span>
                <span>•</span>
                <span className="text-rose-400 font-medium">{stats?.documents.failed ?? 0} failed</span>
              </p>
            </div>
          </div>

          {/* Secondary Metrics: Ingestion & Chat Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Card: Vector Store Indexed */}
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Qdrant Vector Indexed</span>
                <div className="text-xl font-bold text-emerald-400 mt-1">
                  {isLoading ? '...' : `${stats?.documents.indexed ?? 0} Documents`}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Embeddings stored with 768d Cosine distance
                </p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Layers className="w-5 h-5" />
              </div>
            </div>

            {/* Card: Total Chat Messages */}
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Total Chat Messages</span>
                <div className="text-xl font-bold text-purple-400 mt-1">
                  {isLoading ? '...' : `${stats?.chat.totalMessages ?? 0} Messages`}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Logged in MongoDB with citation excerpts
                </p>
              </div>
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <MessageSquare className="w-5 h-5" />
              </div>
            </div>

            {/* Card: Active Conversations */}
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Active Conversations</span>
                <div className="text-xl font-bold text-indigo-400 mt-1">
                  {isLoading ? '...' : `${stats?.chat.totalConversations ?? 0} Pairs`}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Distinct user-document threads with chat
                </p>
              </div>
              <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <MessageCircle className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Section: Ingestion Status Pipeline */}
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Document Pipeline &amp; Indexing Telemetry</h3>
                <p className="text-xs text-slate-400">
                  Real-time status breakdown across PDF extraction, chunking, and Qdrant semantic indexing.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400">Processing</span>
                <div className="text-lg font-bold text-amber-400 mt-1">
                  {stats?.documents.processing ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">In extraction queue</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400">Ready</span>
                <div className="text-lg font-bold text-blue-400 mt-1">
                  {stats?.documents.ready ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">Parsed &amp; chunked</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400">Indexed</span>
                <div className="text-lg font-bold text-emerald-400 mt-1">
                  {stats?.documents.indexed ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">Vectorized in Qdrant</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400">Failed Processing</span>
                <div className="text-lg font-bold text-rose-400 mt-1">
                  {stats?.documents.failed ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">Corrupted / No text</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400">Indexing Failures</span>
                <div className="text-lg font-bold text-rose-400 mt-1">
                  {stats?.documents.indexingFailed ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">Qdrant retry eligible</span>
              </div>
            </div>
          </div>

          {/* Section: Recent System Activity Feed */}
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Live Platform Activity Log</h3>
                <p className="text-xs text-slate-400">
                  Chronological audit of user registrations, document uploads, and conversational events.
                </p>
              </div>

              {/* Activity Filter Buttons */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setActivityFilter('all')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    activityFilter === 'all'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({activities.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter('user')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    activityFilter === 'user'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Users
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter('document')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    activityFilter === 'document'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Documents
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter('chat')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    activityFilter === 'chat'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Chat
                </button>
              </div>
            </div>

            {/* Activity List */}
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                <p className="text-xs">Loading activity stream...</p>
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No activity recorded matching this filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 max-h-[480px] overflow-y-auto pr-2">
                {filteredActivities.map((act) => {
                  const isUser = act.type === 'user_registered';
                  const isDocIndexed = act.type === 'document_indexed';
                  const isDocFailed = act.type === 'document_failed';
                  const isDocUploaded = act.type === 'document_uploaded';
                  const isChat = act.type === 'chat_message';

                  return (
                    <div
                      key={act.id}
                      className="py-3 flex items-start justify-between gap-4 hover:bg-slate-900/40 px-2 rounded-xl transition"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-xl flex-shrink-0 mt-0.5 ${
                            isUser
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : isDocIndexed
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : isDocFailed
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : isDocUploaded
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          }`}
                        >
                          {isUser && <Users className="w-3.5 h-3.5" />}
                          {isDocIndexed && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {isDocFailed && <AlertTriangle className="w-3.5 h-3.5" />}
                          {isDocUploaded && <FileText className="w-3.5 h-3.5" />}
                          {isChat && <MessageSquare className="w-3.5 h-3.5" />}
                        </div>

                        <div>
                          <p className="text-xs font-medium text-slate-200">
                            {act.description}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                            {act.metadata?.userName && (
                              <span className="text-slate-400">User: {act.metadata.userName}</span>
                            )}
                            {act.metadata?.documentName && (
                              <span className="text-slate-400 truncate max-w-xs">
                                Doc: {act.metadata.documentName}
                              </span>
                            )}
                            {act.metadata?.status && (
                              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400">
                                {act.metadata.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 flex-shrink-0 whitespace-nowrap">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span>{new Date(act.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
