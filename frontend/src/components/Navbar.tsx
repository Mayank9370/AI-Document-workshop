'use client';

import React from 'react';
import Link from 'next/link';
import { Layers, User, LogOut, ShieldCheck, LogIn, UserPlus, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-md shadow-indigo-500/20 group-hover:bg-indigo-500 transition">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-lg font-bold text-white tracking-tight">AI Document Workspace</span>
            <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              AI Document Workspace
            </span>
          </div>
        </Link>

        {/* Auth Navigation */}
        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="h-8 w-24 bg-slate-800/60 animate-pulse rounded-lg" />
          ) : isAuthenticated && user ? (
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 transition"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                Dashboard
              </Link>

              {user.role === 'admin' && (
                <Link
                  href="/dashboard/admin"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-300 hover:text-white px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 transition shadow-xs"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span>Admin</span>
                </Link>
              )}

              {/* User Profile Pill */}
              <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-lg text-xs">
                <div className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold text-[10px]">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-slate-200 font-medium hidden md:inline">{user.name}</span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                    user.role === 'admin'
                      ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {user.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3 h-3" /> User
                    </span>
                  )}
                </span>
              </div>

              {/* Sign Out Button */}
              <button
                onClick={logout}
                title="Sign out of account"
                className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800/70 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center gap-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 rounded-lg font-medium shadow-sm transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
