import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("envía el token CSRF solo en peticiones que modifican datos", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("tok");
    await api.releaseTicket("r1", 5);
    await api.listTickets("r1").catch(() => {});
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect((calls[0]?.[1].headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    expect(calls[0]?.[0]).toBe("/api/v1/admin/raffles/r1/tickets/5");
    expect((calls[1]?.[1].headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
  });

  it("convierte el error del servidor en ApiError con su código y detalles", async () => {
    vi.stubGlobal("fetch", async () =>
      json(409, { error: { code: "invalid_state", message: "Ya está activo" } }),
    );
    await expect(api.releaseTicket("r1", 1)).rejects.toMatchObject({
      status: 409,
      code: "invalid_state",
      message: "Ya está activo",
    });
  });

  it("un 401 fuera del login avisa que la sesión caducó; en el login no", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", async () =>
      json(401, { error: { code: "unauthorized", message: "Inicia sesión" } }),
    );
    await expect(api.listRaffles()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(api.login("a@b.co", "x")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("respuesta con forma inesperada falla en lugar de pasar datos erróneos", async () => {
    vi.stubGlobal("fetch", async () => json(200, { raffles: [{ id: 1 }] }));
    await expect(api.listRaffles()).rejects.toThrow();
  });

  it("construye la consulta del historial", async () => {
    const fetchMock = vi.fn(async () => json(200, { events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.listHistory("r1", { number: 7, beforeId: 50 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "/api/v1/admin/raffles/r1/history?number=7&beforeId=50",
    );
  });
});
