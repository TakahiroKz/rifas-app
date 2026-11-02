import { type HealthResponse, healthResponseSchema } from "@rifas/contracts";
import { useEffect, useState } from "preact/hooks";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/v1/health")
      .then((r) => r.json())
      .then((data) => setHealth(healthResponseSchema.parse(data)))
      .catch(() => setHealth(null));
  }, []);

  return (
    <main class="mx-auto max-w-md p-6 text-center">
      <h1 class="text-2xl font-bold">Tu Rifa</h1>
      <p class="mt-2 text-sm text-gray-600">
        API: {health ? "conectada" : "sin conexión (inicia `pnpm dev`)"}
      </p>
    </main>
  );
}
