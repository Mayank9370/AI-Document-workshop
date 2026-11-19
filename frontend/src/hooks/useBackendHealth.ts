'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchBackendReadiness } from '../services/api.service';
import { ConnectionStatus, ServiceStatusState } from '../types/api';

export const useBackendHealth = () => {
  const [status, setStatus] = useState<ServiceStatusState>({
    backend: 'Checking',
    mongodb: 'Checking',
    redis: 'Checking',
    qdrant: 'Checking',
    lastChecked: null,
    errorMessage: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const checkReadiness = useCallback(async () => {
    setIsLoading(true);
    setStatus((prev) => ({
      ...prev,
      backend: 'Checking',
      mongodb: 'Checking',
      redis: 'Checking',
      qdrant: 'Checking',
      errorMessage: null,
    }));

    try {
      const data = await fetchBackendReadiness();

      const formatStatus = (val?: string): ConnectionStatus =>
        val === 'connected' ? 'Connected' : 'Disconnected';

      setStatus({
        backend: 'Connected',
        mongodb: formatStatus(data.services?.mongodb),
        redis: formatStatus(data.services?.redis),
        qdrant: formatStatus(data.services?.qdrant),
        lastChecked: new Date().toLocaleTimeString(),
        errorMessage: data.status === 'not_ready' ? 'Some dependencies are offline (HTTP 503)' : null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to backend API';
      setStatus({
        backend: 'Disconnected',
        mongodb: 'Disconnected',
        redis: 'Disconnected',
        qdrant: 'Disconnected',
        lastChecked: new Date().toLocaleTimeString(),
        errorMessage: msg,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkReadiness();
  }, [checkReadiness]);

  return {
    ...status,
    isLoading,
    refetch: checkReadiness,
  };
};
