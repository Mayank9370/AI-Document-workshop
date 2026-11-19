/**
 * Chat & SSE Client Service (Phase 7)
 *
 * Provides:
 * 1. Fetching document chat history (cookie authenticated)
 * 2. POST-based Server-Sent Events (SSE) streaming reader with token, citations, and done events
 */

import { API_ENDPOINTS } from '../lib/api';
import { ChatHistoryResponse, CitationItem } from '../types/api';

export interface StreamChatParams {
  documentId: string;
  message: string;
  signal?: AbortSignal;
  onStart?: () => void;
  onToken: (token: string) => void;
  onCitations?: (citations: CitationItem[]) => void;
  onDone?: (data: {
    messageId: string;
    content: string;
    citations?: CitationItem[];
    createdAt?: string;
  }) => void;
  onError?: (error: string) => void;
}

/**
 * Fetch chronological chat history for a specific document with optional cursor-based pagination.
 */
export async function fetchChatHistory(
  documentId: string,
  cursor?: string | null,
  limit?: number
): Promise<ChatHistoryResponse> {
  let url = API_ENDPOINTS.CHAT.MESSAGES(documentId);
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', limit.toString());
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to load chat history.');
  }

  return data;
}

/**
 * Send user message and stream assistant RAG response via SSE over POST.
 */
export async function streamChatMessage(params: StreamChatParams): Promise<void> {
  const {
    documentId,
    message,
    signal,
    onStart,
    onToken,
    onCitations,
    onDone,
    onError,
  } = params;

  let response: Response;
  try {
    response = await fetch(API_ENDPOINTS.CHAT.MESSAGES(documentId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (err: unknown) {
    if (signal?.aborted) {
      return;
    }
    const msg = err instanceof Error ? err.message : 'Network error connecting to chat service.';
    if (onError) onError(msg);
    return;
  }

  // Handle standard non-streaming error responses (e.g., 400 Bad Request, 401 Unauthorized, 404 Not Found)
  if (!response.ok) {
    try {
      const errJson = await response.json();
      const msg = errJson.message || errJson.error || `Request failed with status ${response.status}`;
      if (onError) onError(msg);
    } catch {
      if (onError) onError(`Request failed with status ${response.status}`);
    }
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    if (onError) onError('Streaming response body is not supported by your browser.');
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split SSE frames on double-newline
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // Keep incomplete trailing fragment in buffer

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        let eventType = 'message';
        let eventData = '';

        const lines = trimmed.split('\n');
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim();
          }
        }

        if (!eventData) continue;

        try {
          const parsed = JSON.parse(eventData);

          switch (eventType) {
            case 'start':
              if (onStart) onStart();
              break;
            case 'token':
              if (parsed.token) {
                onToken(parsed.token);
              }
              break;
            case 'citations':
              if (parsed.citations && onCitations) {
                onCitations(parsed.citations);
              }
              break;
            case 'done':
              if (onDone) {
                onDone(parsed);
              }
              break;
            case 'error':
              if (onError) {
                onError(parsed.error || 'Failed to generate response.');
              }
              break;
            default:
              break;
          }
        } catch (parseErr) {
          console.warn('Failed to parse SSE event data JSON:', eventData, parseErr);
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return;
    }
    const msg = err instanceof Error ? err.message : 'Error reading response stream.';
    if (onError) onError(msg);
  } finally {
    reader.releaseLock();
  }
}
