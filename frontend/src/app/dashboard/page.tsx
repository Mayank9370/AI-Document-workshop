'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useAuth } from '../../context/AuthContext';
import { fetchAdminTest } from '../../services/api.service';
import { DocumentUploadZone } from '../../components/DocumentUploadZone';
import { DocumentLibrary } from '../../components/DocumentLibrary';
import {
  User,
  ShieldCheck,
  Calendar,
  Mail,
  Key,
  ShieldAlert,
  CheckCircle2,
  LogOut,
  ArrowLeft,
  Loader2,
  FileText,
} from 'lucide-react';

function DashboardContent() {
  const { user, logout } = useAuth();
  const [adminTestResult, setAdminTestResult] = useState<string | null>(null);
  const [adminTestStatus, setAdminTestStatus] = useState<'success' | 'error' | null>(null);
  const [isTestingAdmin, setIsTestingAdmin] = useState(false);

  // Trigger library refresh on upload
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTestAdminRoute = async () => {
    setIsTestingAdmin(true);
    setAdminTestResult(null);
    setAdminTestStatus(null);

    try {
      const response = await fetchAdminTest();
      setAdminTestStatus('success');
      setAdminTestResult(
        `HTTP 200: ${response.message} (Admin: ${JSON.stringify(response.data)})`
      );
    } catch (err: unknown) {
      setAdminTestStatus('error');
      const msg = err instanceof Error ? err.message : 'Admin test failed';
      setAdminTestResult(`Access Denied: ${msg}`);
    } finally {
      setIsTestingAdmin(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-2">
            <User className="w-3.5 h-3.5" /> Authenticated Session
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Document Workspace &bull; {user.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your PDF documents securely. All files are isolated and verified.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Infra Status
          </Link>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-300 text-xs font-medium transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Profile & RBAC Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <User className="w-4 h-4 text-indigo-400" /> Account Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-lg space-y-1">
              <span className="text-slate-400 font-medium">User ID</span>
              <p className="font-mono text-slate-200 truncate">{user.id}</p>
            </div>
            <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-lg space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-slate-400" /> Email
              </span>
              <p className="text-slate-200 font-medium truncate">{user.email}</p>
            </div>
            <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-lg space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Key className="w-3.5 h-3.5 text-slate-400" /> Role
              </span>
              <p>
                <span
                  className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded text-[11px] ${
                    user.role === 'admin'
                      ? 'bg-purple-500/10 text-purple-300 border border-purple-500/30'
                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {user.role === 'admin' ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" /> Administrator
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5" /> Standard User
                    </>
                  )}
                </span>
              </p>
            </div>
            <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-lg space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" /> Member Since
              </span>
              <p className="text-slate-300">
                {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* RBAC Tester */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" /> RBAC Tester
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Probe admin-only route <code className="text-indigo-300 bg-slate-950 px-1 py-0.5 rounded font-mono">/api/auth/admin-test</code> to verify role protection.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800">
            <button
              onClick={handleTestAdminRoute}
              disabled={isTestingAdmin}
              className="w-full inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-xs transition cursor-pointer"
            >
              {isTestingAdmin ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Admin Access'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Admin Test Banner */}
      {adminTestResult && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${
            adminTestStatus === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          {adminTestStatus === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">
              {adminTestStatus === 'success'
                ? 'Authorized Access (Role: admin)'
                : 'Role Authorization Rejected (HTTP 403 Forbidden)'}
            </p>
            <p className="mt-1 font-mono text-[11px]">{adminTestResult}</p>
          </div>
        </div>
      )}

      {/* Admin Quick Action Banner (Admin only) */}
      {user.role === 'admin' && (
        <div className="p-4 rounded-xl bg-purple-600/10 border border-purple-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Administrator Access Enabled</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                You have system access to telemetry, user growth metrics, and document ingestion status.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/admin"
            className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <span>Open Admin Dashboard</span>
            <span>&rarr;</span>
          </Link>
        </div>
      )}

      {/* Section: Upload PDF */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" /> Upload PDF Document
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Files are validated with signature inspection and saved safely with randomized identifiers.
          </p>
        </div>

        <DocumentUploadZone onUploadSuccess={() => setRefreshTrigger((prev) => prev + 1)} />
      </section>

      {/* Section: Document Library */}
      <section className="pt-4 border-t border-slate-800">
        <DocumentLibrary refreshTrigger={refreshTrigger} />
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
