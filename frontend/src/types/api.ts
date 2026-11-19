export interface HealthResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export type ConnectionStatus = 'Connected' | 'Disconnected' | 'Checking';

export interface ReadinessResponse {
  success: boolean;
  status: 'ready' | 'not_ready';
  services: {
    mongodb: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
    qdrant: 'connected' | 'disconnected';
  };
}

export type UserRole = 'user' | 'admin';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  data?: {
    user: UserProfile;
  };
  error?: string;
}

export type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type IndexingStatus = 'pending' | 'indexing' | 'indexed' | 'failed';

export interface DocumentItem {
  id: string;
  userId: string;
  originalName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: DocumentStatus;
  processingError?: string;
  totalPages?: number;
  totalChunks?: number;
  indexingStatus?: IndexingStatus;
  indexedChunkCount?: number;
  indexingError?: string;
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface CursorPaginationMeta {
  nextCursor?: string | null;
  hasMore?: boolean;
  limit: number;
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface DocumentListResponse {
  success: boolean;
  message?: string;
  data?: {
    documents: DocumentItem[];
    pagination: CursorPaginationMeta;
  };
  error?: string;
}

export interface DocumentSingleResponse {
  success: boolean;
  message?: string;
  data?: {
    document: DocumentItem;
  };
  error?: string;
}

export interface ServiceStatusState {
  backend: ConnectionStatus;
  mongodb: ConnectionStatus;
  redis: ConnectionStatus;
  qdrant: ConnectionStatus;
  lastChecked: string | null;
  errorMessage: string | null;
}

export type ChatRole = 'user' | 'assistant';

export interface CitationItem {
  chunkId: string;
  pageNumber: number;
  chunkIndex: number;
  text?: string;
}

export interface ChatMessageItem {
  id: string;
  role: ChatRole;
  content: string;
  citations?: CitationItem[];
  createdAt: string;
}

export interface ChatHistoryResponse {
  success: boolean;
  message?: string;
  data?: {
    documentId: string;
    documentName: string;
    messages: ChatMessageItem[];
    pagination?: CursorPaginationMeta;
    total: number;
  };
  error?: string;
}

// ==========================================
// Admin Statistics & Activity Types (Phase 10)
// ==========================================

export interface AdminUserStats {
  total: number;
  new7d: number;
  new30d: number;
}

export interface AdminDocumentStats {
  total: number;
  uploaded: number;
  processing: number;
  ready: number;
  failed: number;
  indexed: number;
  indexingFailed: number;
}

export interface AdminChatStats {
  totalMessages: number;
  totalConversations: number;
}

export interface AdminStatsData {
  users: AdminUserStats;
  documents: AdminDocumentStats;
  chat: AdminChatStats;
}

export interface AdminStatsResponse {
  success: boolean;
  message?: string;
  data?: AdminStatsData;
  error?: string;
}

export interface AdminActivityItem {
  id: string;
  type:
    | 'user_registered'
    | 'document_uploaded'
    | 'document_ready'
    | 'document_failed'
    | 'document_indexed'
    | 'chat_message';
  description: string;
  timestamp: string;
  metadata?: {
    userId?: string;
    userName?: string;
    documentId?: string;
    documentName?: string;
    status?: string;
  };
}

export interface AdminActivityResponse {
  success: boolean;
  message?: string;
  data?: {
    activities: AdminActivityItem[];
    total: number;
  };
  error?: string;
}
