'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { fetchDocumentDetails } from '@/services/api.service';
import { fetchChatHistory, streamChatMessage } from '@/services/chat.service';
import { DocumentItem, ChatMessageItem, CitationItem } from '@/types/api';
import {
  ArrowLeft,
  Send,
  Square,
  FileText,
  Bot,
  User,
  Sparkles,
  AlertCircle,
  Clock,
  BookOpen,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Layers,
} from 'lucide-react';

const SUGGESTED_PROMPTS = [
  'Summarize the key points in this document.',
  'What are the core technologies and frameworks discussed?',
  'Explain the main objectives and requirements.',
  'What architectural patterns are mentioned in this text?',
];

export default function DocumentChatPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<CitationItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedCitationIdx, setExpandedCitationIdx] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isPrependingRef = useRef(false);

  // Auto-scroll to bottom of chat
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (isPrependingRef.current) {
      isPrependingRef.current = false;
      return;
    }
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Load document metadata and chat history
  useEffect(() => {
    if (!documentId) return;

    let isMounted = true;

    async function loadData() {
      setIsLoadingDoc(true);
      setIsLoadingHistory(true);
      setErrorMessage(null);

      try {
        const doc = await fetchDocumentDetails(documentId);
        if (isMounted) {
          setDocument(doc);
          setIsLoadingDoc(false);
        }

        const historyResponse = await fetchChatHistory(documentId);
        if (isMounted && historyResponse.data) {
          setMessages(historyResponse.data.messages);
          setHistoryCursor(historyResponse.data.pagination?.nextCursor || null);
          setHasMoreHistory(Boolean(historyResponse.data.pagination?.hasMore));
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'Failed to load document chat.';
          setErrorMessage(msg);
        }
      } finally {
        if (isMounted) {
          setIsLoadingDoc(false);
          setIsLoadingHistory(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
    };
  }, [documentId]);

  // Load older messages via cursor pagination
  const loadOlderMessages = async () => {
    if (!historyCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const historyResponse = await fetchChatHistory(documentId, historyCursor);
      if (historyResponse.data) {
        const olderMessages = historyResponse.data.messages;
        isPrependingRef.current = true;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const uniqueOlder = olderMessages.filter((m) => !existingIds.has(m.id));
          return [...uniqueOlder, ...prev];
        });
        setHistoryCursor(historyResponse.data.pagination?.nextCursor || null);
        setHasMoreHistory(Boolean(historyResponse.data.pagination?.hasMore));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load older messages.';
      setErrorMessage(msg);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Handle message sending
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isStreaming || !document) return;

    if (document.status !== 'ready' || document.indexingStatus !== 'indexed') {
      setErrorMessage('Chat is only available once document vector indexing is complete.');
      return;
    }

    setErrorMessage(null);
    setInputMessage('');

    // Append user message to UI immediately
    const tempUserMsg: ChatMessageItem = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingCitations([]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let accumulatedContent = '';
    let accumulatedCitations: CitationItem[] = [];

    await streamChatMessage({
      documentId,
      message: text,
      signal: abortController.signal,
      onStart: () => {
        // Stream initiated
      },
      onToken: (token) => {
        accumulatedContent += token;
        setStreamingContent(accumulatedContent);
      },
      onCitations: (citations) => {
        accumulatedCitations = citations;
        setStreamingCitations(citations);
      },
      onDone: (data) => {
        const assistantMsg: ChatMessageItem = {
          id: data.messageId || `msg-${Date.now()}`,
          role: 'assistant',
          content: data.content || accumulatedContent,
          citations: data.citations || accumulatedCitations,
          createdAt: data.createdAt || new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent('');
        setStreamingCitations([]);
        setIsStreaming(false);
        abortControllerRef.current = null;
        setTimeout(() => inputRef.current?.focus(), 50);
      },
      onError: (err) => {
        setErrorMessage(err);
        setStreamingContent('');
        setStreamingCitations([]);
        setIsStreaming(false);
        abortControllerRef.current = null;
      },
    });
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingCitations([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isChatDisabled =
    !document ||
    document.status !== 'ready' ||
    document.indexingStatus !== 'indexed' ||
    isStreaming;

  return (
    <ProtectedRoute>
      <div className="flex flex-col h-[calc(100vh-4rem)] max-w-5xl mx-auto px-4 py-4 sm:px-6">
        {/* Document Chat Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white truncate max-w-sm sm:max-w-md">
                  {document?.originalName || 'Document Chat'}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {document && (
                    <>
                      <span className="flex items-center gap-1 font-mono">
                        <Layers className="w-3 h-3 text-slate-500" />
                        {document.totalPages ?? 1} {document.totalPages === 1 ? 'page' : 'pages'}
                      </span>
                      <span>•</span>
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Qdrant Vector Indexed
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (documentId) {
                  fetchChatHistory(documentId).then((res) => {
                    if (res.data) setMessages(res.data.messages);
                  });
                }
              }}
              title="Refresh Chat History"
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Indexing Guard Notification */}
        {document && (document.status !== 'ready' || document.indexingStatus !== 'indexed') && (
          <div className="mt-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-start gap-3 flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Document Not Ready for Chat</p>
              <p className="text-xs text-amber-200/80 mt-0.5">
                {document.status !== 'ready'
                  ? `The document is currently ${document.status}. PDF text extraction must complete first.`
                  : `Vector indexing status is "${document.indexingStatus}". Semantic retrieval requires Qdrant indexing.`}
              </p>
              <div className="mt-2">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 underline"
                >
                  Return to Document Library
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span className="text-xs">{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-xs text-rose-400 hover:text-rose-200 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Loading conversation history...</p>
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            // Empty State
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="p-4 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-4">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-white">Ask questions about this document</h3>
              <p className="text-xs text-slate-400 max-w-md mt-1 mb-6">
                Answers are grounded directly in the text extracted from{' '}
                <span className="text-slate-200 font-medium">{document?.originalName}</span> with
                exact page citations.
              </p>

              {document?.indexingStatus === 'indexed' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(prompt)}
                      className="text-left p-3 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-indigo-500/40 text-xs text-slate-300 hover:text-white transition group flex items-start gap-2"
                    >
                      <span className="text-indigo-400 group-hover:translate-x-0.5 transition-transform mt-0.5">
                        →
                      </span>
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Render Message List
            <>
              {/* Cursor-Based Load Older Messages */}
              {hasMoreHistory && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={isLoadingOlder}
                    className="px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    {isLoadingOlder ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                        <span>Loading older messages...</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Load older messages</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {messages.map((msg, index) => (
                <div
                  key={msg.id || index}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}

                    {/* Citations Footer */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Sources & Citations:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.citations.map((cite, cIdx) => {
                            const citationKey = `${msg.id}-${cIdx}`;
                            const isExpanded = expandedCitationIdx === citationKey;
                            return (
                              <div key={cIdx} className="flex flex-col">
                                <button
                                  onClick={() =>
                                    setExpandedCitationIdx(isExpanded ? null : citationKey)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/60 transition cursor-pointer"
                                  title="Click to view excerpt preview"
                                >
                                  <span>Page {cite.pageNumber}</span>
                                  {cite.text && (
                                    isExpanded ? (
                                      <ChevronUp className="w-3 h-3 text-indigo-400" />
                                    ) : (
                                      <ChevronDown className="w-3 h-3 text-indigo-400" />
                                    )
                                  )}
                                </button>
                                {isExpanded && cite.text && (
                                  <div className="mt-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 max-w-md font-sans">
                                    <div className="text-[10px] uppercase font-bold text-indigo-400 mb-0.5">
                                      Page {cite.pageNumber} Excerpt
                                    </div>
                                    <p className="italic text-slate-400 leading-relaxed">
                                      &quot;{cite.text}&quot;
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-1.5 text-[10px] opacity-60 text-right">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 flex-shrink-0 mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {/* In-Progress Streaming Assistant Bubble */}
              {isStreaming && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-1 animate-pulse">
                    <Bot className="w-4 h-4" />
                  </div>

                  <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm p-4 text-sm bg-slate-900 border border-slate-800 text-slate-200">
                    {streamingContent ? (
                      <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed">
                        <ReactMarkdown>{streamingContent}</ReactMarkdown>
                        <span className="inline-block w-2 h-4 bg-indigo-400 ml-1 animate-pulse" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                        <span>Searching Qdrant vectors and generating answer...</span>
                      </div>
                    )}

                    {/* Stream Citations Preview */}
                    {streamingCitations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Sources:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {streamingCitations.map((cite, cIdx) => (
                            <span
                              key={cIdx}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-500/30"
                            >
                              Page {cite.pageNumber}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="pt-3 border-t border-slate-800 flex-shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-end gap-2"
          >
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  document?.indexingStatus !== 'indexed'
                    ? 'Chat disabled: Document indexing incomplete'
                    : 'Ask a question about this document... (Enter to send, Shift+Enter for newline)'
                }
                disabled={isChatDisabled}
                rows={1}
                className="w-full resize-none rounded-xl bg-slate-900 border border-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="h-12 px-4 rounded-xl bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 transition flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
                title="Stop streaming response"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputMessage.trim() || isChatDisabled}
                className="h-12 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white transition flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
                title="Send Message"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            )}
          </form>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Answers generated by Gemini and grounded in document vectors.</span>
            <span>Esc to stop, Enter to send</span>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
