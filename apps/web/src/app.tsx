import type { SessionResponse } from "@rifas/contracts";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Link, Route, Switch } from "wouter-preact";
import { api, setUnauthorizedHandler } from "./api";
import { Login } from "./pages/Login";
import { OrgSettings } from "./pages/OrgSettings";
import { RaffleDetail } from "./pages/RaffleDetail";
import { RaffleList } from "./pages/RaffleList";
import { RaffleNew } from "./pages/RaffleNew";
import { SessionContext, type SessionContextValue } from "./session";
import { Button, ToastProvider } from "./ui";

export function App() {
  return (
    <ToastProvider>
      <Switch>
        <Route path="/admin/*?" component={AdminApp} />
        <Route component={Home} />
      </Switch>
    </ToastProvider>
  );
}

function Home() {
  return (
    <main class="mx-auto max-w-md p-6 text-center">
      <h1 class="text-2xl font-bold">Tu Rifa</h1>
      <p class="mt-2 text-sm text-slate-600">La página pública de rifas llegará pronto.</p>
      <Link href="/admin" class="mt-4 inline-block text-sm text-indigo-700 underline">
        Administración
      </Link>
    </main>
  );
}

function AdminApp() {
  // undefined = comprobando; null = sin sesión
  const [session, setSession] = useState<SessionResponse | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    api.session().then(setSession, () => setSession(null));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setSession(null);
  }, []);

  const ctx = useMemo<SessionContextValue | null>(
    () => (session ? { session, setSession: (s) => setSession(s), logout } : null),
    [session, logout],
  );

  if (session === undefined) return <p class="p-6 text-center text-sm text-slate-500">Cargando…</p>;
  if (!session || !ctx) return <Login onLogin={setSession} />;

  return (
    <SessionContext.Provider value={ctx}>
      <div class="min-h-screen bg-slate-50">
        <header class="border-b border-slate-200 bg-white">
          <div class="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
            <div class="flex items-center gap-4">
              <Link href="/admin" class="font-bold text-slate-900">
                {session.organization.name}
              </Link>
              <Link href="/admin/settings" class="text-sm text-slate-500 hover:text-slate-800">
                Ajustes
              </Link>
            </div>
            <div class="flex items-center gap-3">
              <span class="hidden text-sm text-slate-500 sm:inline">{session.user.name}</span>
              <Button variant="ghost" onClick={logout}>
                Salir
              </Button>
            </div>
          </div>
        </header>
        <main class="mx-auto max-w-4xl px-4 py-6">
          <Switch>
            <Route path="/admin" component={RaffleList} />
            <Route path="/admin/raffles/new" component={RaffleNew} />
            <Route path="/admin/raffles/:id">{(params) => <RaffleDetail id={params.id} />}</Route>
            <Route path="/admin/settings" component={OrgSettings} />
            <Route>
              <p class="text-sm text-slate-600">Página no encontrada.</p>
            </Route>
          </Switch>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
