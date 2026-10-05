"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "fi6900.adminToken";

/**
 * Admin token held in sessionStorage (cleared when the tab closes). The value is only ever read into
 * the Authorization header; it is never logged, never put in a URL or a query key.
 */
export function useAdminToken() {
  const [token, setTokenState] = useState<string>("");
  const [ready, setReady] = useState(false);
  const ref = useRef("");
  useEffect(() => {
    try {
      const t = window.sessionStorage.getItem(KEY) ?? "";
      ref.current = t;
      setTokenState(t);
    } catch {
      /* storage blocked */
    }
    setReady(true);
  }, []);
  const setToken = useCallback((t: string) => {
    ref.current = t;
    setTokenState(t);
    try {
      if (t) window.sessionStorage.setItem(KEY, t);
      else window.sessionStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  }, []);
  const getToken = useCallback(() => ref.current || null, []);
  return { token, setToken, getToken, ready };
}
