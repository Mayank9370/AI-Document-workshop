'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { fetchDocuments, deleteDocumentApi, reindexDocumentApi } from '../services/api.service';
import { DocumentItem, DocumentStatus, IndexingStatus } from '../types/api';
import {
  FileText,
  Trash2,
  RefreshCw,
  AlertTriangle,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  HardDrive,
  Loader2,
  CheckCircle,
  XCircle,
  Layers,
  Database,
  RotateCw,
  MessageSquare,
} from 'lucide-react';

interface DocumentLibraryProps {
  refreshTrigger: number;
}

/** Poll every 4 seconds when any document is in `processing` state */
const POLLING_INTERVAL_MS = 4000;

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({ refreshTrigger }) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cursor-based and offset pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Deletion modal state
  const [deletingDoc, setDeletingDoc] = useState<DocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDocuments = useCallback(async (targetPage = 1, silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchDocuments(targetPage, 10);
      if (response.data) {
        setDocuments(response.data.documents);
        setPage(response.data.pagination.page || targetPage);
        setTotalPages(response.data.pagination.totalPages || 1);
        setTotal(response.data.pagination.total || response.data.documents.length);
        setNextCursor(response.data.pagination.nextCursor || null);
        setHasMore(Boolean(response.data.pagination.hasMore));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load documents.';
      setErrorMessage(msg);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  const loadMoreWithCursor = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setErrorMessage(null);
    try {
      const response = await fetchDocuments({ cursor: nextCursor, limit: 10 });
      if (response.data) {
        const incomingDocs = response.data.documents;
        setDocuments((prev) => {
          const existingIds = new Set(prev.map((d) => d.id));
          const uniqueNew = incomingDocs.filter((d) => !existingIds.has(d.id));
          return [...prev, ...uniqueNew];
        });
        setNextCursor(response.data.pagination.nextCursor || null);
        setHasMore(Boolean(response.data.pagination.hasMore));
        if (response.data.pagination.total) {
          setTotal(response.data.pagination.total);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load more documents.';
      setErrorMessage(msg);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Auto-poll while any document is in `processing` or `indexing` state
  useEffect(() => {
    const hasActiveState = documents.some(
      (d) => d.status === 'processing' || d.indexingStatus === 'indexing'
    );
    if (hasActiveState && !pollingRef.current) {
      pollingRef.current = setInterval(() => {
        loadDocuments(page, true);
      }, POLLING_INTERVAL_MS);
    } else if (!hasActiveState && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [documents, page, loadDocuments]);

  useEffect(() => {
    loadDocuments(page);
  }, [loadDocuments, page, refreshTrigger]);

  const confirmDelete = async () => {
    if (!deletingDoc) return;
    setIsDeleting(true);
    try {
      await deleteDocumentApi(deletingDoc.id);
      setDeletingDoc(null);
      // Reload current page or previous page if last item deleted
      const nextPage = documents.length === 1 && page > 1 ? page - 1 : page;
      loadDocuments(nextPage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete document.';
      alert(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getStatusBadge = (status: DocumentStatus) => {
    switch (status) {
      case 'ready':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Ready
          </span>
        );
      case 'processing':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 animate-pulse flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Processing…
          </span>
        );
      case 'failed':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Failed
          </span>
        );
      case 'uploaded':
      default:
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
            Uploaded
          </span>
        );
    }
  };

  const getIndexingBadge = (indexingStatus?: IndexingStatus) => {
    switch (indexingStatus) {
      case 'indexed':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 flex items-center gap-1">
            <Database className="w-3 h-3" /> Indexed
          </span>
        );
      case 'indexing':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 animate-pulse flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Indexing…
          </span>
        );
      case 'failed':
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 flex items-center gap-1" title="Vector indexing failed">
            <XCircle className="w-3 h-3" /> Index Failed
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60">
            Index Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-indigo-400" />
            Document Library
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {total} {total === 1 ? 'document' : 'documents'} stored in your workspace.
          </p>
        </div>

        <button
          onClick={() => loadDocuments(page)}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Loading your documents...</p>
        </div>
      ) : documents.length === 0 ? (
        /* Empty state */
        <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800/60 text-slate-500 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">No documents uploaded yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Drag and drop your first PDF document in the upload box above to begin managing your files.
          </p>
        </div>
      ) : (
        /* Document Cards / Table */
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-900/90 transition"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mt-0.5">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-white text-sm break-all">
                    {doc.originalName}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1 font-mono">
                      <HardDrive className="w-3 h-3 text-slate-500" />
                      {formatFileSize(doc.fileSize)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {new Date(doc.createdAt).toLocaleDateString()} at{' '}
                      {new Date(doc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {doc.status === 'ready' && doc.totalPages !== undefined && (
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-slate-500" />
                        {doc.totalPages} {doc.totalPages === 1 ? 'page' : 'pages'}
                        {doc.totalChunks !== undefined && `, ${doc.totalChunks} chunks`}
                      </span>
                    )}
                    {doc.status === 'failed' && doc.processingError && (
                      <span className="flex items-center gap-1 text-rose-400 max-w-xs truncate" title={doc.processingError}>
                        <XCircle className="w-3 h-3 flex-shrink-0" />
                        {doc.processingError}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/60">
                <div className="flex items-center gap-2">
                  {getStatusBadge(doc.status)}
                  {doc.status === 'ready' && getIndexingBadge(doc.indexingStatus)}
                </div>

                {doc.status === 'ready' && doc.indexingStatus === 'indexed' && (
                  <Link
                    href={`/dashboard/documents/${doc.id}/chat`}
                    title="Chat with Document"
                    className="p-1.5 px-3 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 hover:text-indigo-200 border border-indigo-500/30 transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Chat</span>
                  </Link>
                )}

                {doc.status === 'ready' && doc.indexingStatus === 'failed' && (
                  <button
                    onClick={async () => {
                      try {
                        await reindexDocumentApi(doc.id);
                        loadDocuments(page, true);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Reindexing failed.');
                      }
                    }}
                    title="Retry Vector Indexing"
                    className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition cursor-pointer flex items-center gap-1 text-xs"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Retry Index</span>
                  </button>
                )}

                <button
                  onClick={() => setDeletingDoc(doc)}
                  title="Delete Document"
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cursor-Based Load More / Pagination Controls */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMoreWithCursor}
            disabled={isLoadingMore}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Loading more documents...</span>
              </>
            ) : (
              <>
                <RotateCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Load More Documents</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Page Summary and Page Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-xs text-slate-400">
          <div>
            Showing <span className="font-semibold text-white">{documents.length}</span> of{' '}
            <span className="font-semibold text-white">{total}</span> documents (Page {page} of {totalPages})
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-40 disabled:pointer-events-none text-white transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-40 disabled:pointer-events-none text-white transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="p-3 bg-rose-500/10 text-rose-400 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white">Delete Document</h3>
              <p className="text-xs text-slate-400 mt-2">
                Are you sure you want to delete{' '}
                <strong className="text-white break-all">&quot;{deletingDoc.originalName}&quot;</strong>?
                This will permanently delete the physical file and its metadata record.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingDoc(null)}
                className="flex-1 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDelete}
                className="flex-1 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Confirm Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
