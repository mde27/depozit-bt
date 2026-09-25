import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Lista firmelor existente (users + stock_items), pentru <datalist>. */
export function useCompanies() {
  const [companies, setCompanies] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ companies: string[] }>('/api/companies');
      setCompanies(data.companies || []);
    } catch {
      // opțional — inputul rămâne liber
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { companies, reload };
}
