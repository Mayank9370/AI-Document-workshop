'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/api';
import { Loader2, ShieldAlert } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
}) => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-400">Verifying authentication session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect via useEffect
  }

  if (requiredRole && user?.role !== requiredRole) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 bg-slate-900/80 border border-rose-500/30 rounded-xl text-center space-y-4">
        <div className="p-3 bg-rose-500/10 text-rose-400 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Access Denied (403)</h2>
        <p className="text-sm text-slate-400">
          Your current account role (<span className="text-slate-200 font-semibold">{user?.role}</span>) does not have permission to view this section.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition"
        >
          Return to Home
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
