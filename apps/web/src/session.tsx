import type { SessionResponse } from "@rifas/contracts";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export interface SessionContextValue {
  session: SessionResponse;
  setSession: (s: SessionResponse) => void;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fuera de SessionContext");
  return ctx;
}
