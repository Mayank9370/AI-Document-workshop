/**
 * Centralized API Configuration
 * 
 * IMPORTANT: Only public configuration values are exposed here.
 * Never place Gemini API keys, JWT secrets or other backend secrets
 * in client-side NEXT_PUBLIC environment variables.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const API_ENDPOINTS = {
  HEALTH: `${API_BASE_URL}/health`,
  READY: `${API_BASE_URL}/health/ready`,
  AUTH: {
    REGISTER: `${API_BASE_URL}/auth/register`,
    LOGIN: `${API_BASE_URL}/auth/login`,
    LOGOUT: `${API_BASE_URL}/auth/logout`,
    ME: `${API_BASE_URL}/auth/me`,
    ADMIN_TEST: `${API_BASE_URL}/auth/admin-test`,
  },
  DOCUMENTS: {
    BASE: `${API_BASE_URL}/documents`,
    UPLOAD: `${API_BASE_URL}/documents/upload`,
    BY_ID: (id: string) => `${API_BASE_URL}/documents/${id}`,
    REINDEX: (id: string) => `${API_BASE_URL}/documents/${id}/reindex`,
    SEARCH: (id: string) => `${API_BASE_URL}/documents/${id}/search`,
  },
  CHAT: {
    MESSAGES: (documentId: string) => `${API_BASE_URL}/chat/${documentId}/messages`,
  },
  ADMIN: {
    STATS: `${API_BASE_URL}/admin/stats`,
    ACTIVITY: `${API_BASE_URL}/admin/activity`,
  },
} as const;
