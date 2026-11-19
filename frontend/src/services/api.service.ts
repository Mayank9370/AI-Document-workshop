import { API_ENDPOINTS } from '../lib/api';
import {
  HealthResponse,
  ReadinessResponse,
  AuthResponse,
  UserProfile,
  DocumentListResponse,
  DocumentSingleResponse,
  DocumentItem,
  AdminStatsResponse,
  AdminActivityResponse,
} from '../types/api';

export const fetchBackendHealth = async (): Promise<HealthResponse> => {
  const response = await fetch(API_ENDPOINTS.HEALTH, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }

  return response.json();
};

export const fetchBackendReadiness = async (): Promise<ReadinessResponse> => {
  const response = await fetch(API_ENDPOINTS.READY, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  // Note: Readiness endpoint responds with HTTP 503 when services are not_ready,
  // but still returns structured JSON details on which services failed.
  const data = await response.json();
  return data as ReadinessResponse;
};

export const registerUser = async (
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> => {
  const response = await fetch(API_ENDPOINTS.AUTH.REGISTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Registration failed');
  }

  return data;
};

export const loginUser = async (
  email: string,
  password: string
): Promise<AuthResponse> => {
  const response = await fetch(API_ENDPOINTS.AUTH.LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Login failed');
  }

  return data;
};

export const fetchCurrentUser = async (): Promise<UserProfile | null> => {
  const response = await fetch(API_ENDPOINTS.AUTH.ME, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch current user (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data?.data?.user || null;
};

export const logoutUser = async (): Promise<void> => {
  await fetch(API_ENDPOINTS.AUTH.LOGOUT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
};

export const fetchAdminTest = async (): Promise<{ success: boolean; message: string; data?: unknown }> => {
  const response = await fetch(API_ENDPOINTS.AUTH.ADMIN_TEST, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Admin test failed (HTTP ${response.status})`);
  }

  return data;
};

// ==========================================
// Document Management API Services (Phase 4)
// ==========================================

export const fetchDocuments = async (
  options?: { cursor?: string | null; limit?: number; page?: number } | number,
  limitParam = 10
): Promise<DocumentListResponse> => {
  let url = API_ENDPOINTS.DOCUMENTS.BASE;
  const params = new URLSearchParams();

  if (typeof options === 'number') {
    params.set('page', options.toString());
    params.set('limit', limitParam.toString());
  } else if (options) {
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.page && !options.cursor) params.set('page', options.page.toString());
  } else {
    params.set('limit', limitParam.toString());
  }

  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch documents.');
  }

  return data as DocumentListResponse;
};

export const uploadPdfDocument = (
  file: File,
  onProgress?: (percent: number) => void
): Promise<DocumentSingleResponse> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', API_ENDPOINTS.DOCUMENTS.UPLOAD);
    xhr.withCredentials = true;

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as DocumentSingleResponse);
        } else {
          reject(new Error(data.message || data.error || `Upload failed (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`Server error (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during file upload. Please verify backend connection.'));
    };

    xhr.send(formData);
  });
};

export const deleteDocumentApi = async (id: string): Promise<void> => {
  const response = await fetch(API_ENDPOINTS.DOCUMENTS.BY_ID(id), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete document.');
  }
};

export const fetchDocumentDetails = async (id: string): Promise<DocumentItem> => {
  const response = await fetch(API_ENDPOINTS.DOCUMENTS.BY_ID(id), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to retrieve document details.');
  }

  return data.data.document;
};

export const reindexDocumentApi = async (id: string): Promise<void> => {
  const response = await fetch(API_ENDPOINTS.DOCUMENTS.REINDEX(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to trigger reindexing.');
  }
};

export const searchDocumentApi = async (
  id: string,
  query: string,
  topK = 5
): Promise<{ totalMatches: number; results: Array<{ chunkId: string; documentId: string; pageNumber: number; chunkIndex: number; text: string; score: number }> }> => {
  const response = await fetch(API_ENDPOINTS.DOCUMENTS.SEARCH(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ query, topK }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Semantic search failed.');
  }

  return data.data;
};

// ==========================================
// Admin Dashboard API Services (Phase 10)
// ==========================================

export const fetchAdminStats = async (): Promise<AdminStatsResponse> => {
  const response = await fetch(API_ENDPOINTS.ADMIN.STATS, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || `Failed to fetch admin stats (HTTP ${response.status})`);
  }

  return data as AdminStatsResponse;
};

export const fetchAdminActivity = async (limit = 20): Promise<AdminActivityResponse> => {
  const response = await fetch(`${API_ENDPOINTS.ADMIN.ACTIVITY}?limit=${limit}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || `Failed to fetch admin activity (HTTP ${response.status})`);
  }

  return data as AdminActivityResponse;
};
