import { describe, expect, it, vi } from "vitest";
import fixtures from "../test/fixtures/gane-results.json";
import { GaneSource, GaneSourceError, normalizeNumber, parseGaneResponse } from "./gane";

type Fixture = { date: string; response: unknown };
const day = (date: string) => (fixtures as Fixture[]).find((f) => f.date === date) as Fixture;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseGaneResponse (respuestas reales de Gane)", () => {
  it("miércoles entre semana: Chontico Noche (62), Dorado Noche (46) y Valle (17)", () => {
    const draws = parseGaneResponse("2026-10-14", day("2026-10-14").response);
    expect(draws.map((d) => [d.lotteryId, d.number, d.series, d.sourceRef])).toEqual([
      ["chontico-noche", "9141", "--2", "3402"],
      ["dorado-noche", "0862", "--5", "874"],
      ["loteria-del-valle", "5091", "--3", "724"],
    ]);
    expect(draws.every((d) => d.drawDate === "2026-10-14")).toBe(true);
  });

  it("sábado: Chontico Noche Sábado (89) cuenta como Chontico Noche", () => {
    const draws = parseGaneResponse("2026-10-03", day("2026-10-03").response);
    expect(draws.map((d) => [d.lotteryId, d.number])).toEqual([
      ["chontico-noche", "2094"],
      ["dorado-noche", "2016"],
    ]);
  });

  it("domingo y festivo: Festivo Noche (63) y Dorado Festivo (65); ignora Festivo Día (99)", () => {
    for (const [date, chontico, dorado] of [
      ["2026-10-04", "6998", "0712"],
      ["2026-10-12", "6403", "0963"],
    ] as const) {
      const draws = parseGaneResponse(date, day(date).response);
      expect(draws.map((d) => [d.lotteryId, d.number])).toEqual(
        [
          ["dorado-noche", dorado],
          ["chontico-noche", chontico],
        ]
          .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""))
          .reverse(),
      );
      expect(draws).toHaveLength(2); // el 99 (Chontico Festivo Día) no es un juego soportado
    }
  });

  it("conserva los ceros a la izquierda (Dorado Noche 0862, 0712)", () => {
    const all = (fixtures as Fixture[]).flatMap((f) => parseGaneResponse(f.date, f.response));
    expect(all.some((d) => d.number === "0862")).toBe(true);
    expect(all.some((d) => d.number === "0712")).toBe(true);
    expect(all.every((d) => /^\d{4}$/.test(d.number))).toBe(true);
  });

  it("descarta filas de otra fecha, con número raro o desconocidas, sin fallar", () => {
    const row = (over: object) => ({
      CODIGO: 62,
      FECHA_SORTEO: "2026-10-14T00:00:00",
      RESULTADO: "1234",
      SERIE_RESULTADO: "--1",
      NUMERO_SORTEO: 1,
      ...over,
    });
    const body = {
      exito: true,
      resultados: [
        row({}),
        row({ FECHA_SORTEO: "2026-10-13T00:00:00" }), // otro día
        row({ RESULTADO: "12a4" }),
        row({ RESULTADO: "12345" }),
        row({ CODIGO: 9999 }), // juego no soportado
        { basura: true },
        row({ RESULTADO: 7, CODIGO: 46 }), // se completa a 0007
      ],
    };
    expect(parseGaneResponse("2026-10-14", body).map((d) => [d.lotteryId, d.number])).toEqual([
      ["chontico-noche", "1234"],
      ["dorado-noche", "0007"],
    ]);
  });

  it("formato inesperado o sin éxito → lanza", () => {
    expect(() => parseGaneResponse("2026-10-14", null)).toThrow(GaneSourceError);
    expect(() => parseGaneResponse("2026-10-14", { exito: false })).toThrow(GaneSourceError);
    expect(() => parseGaneResponse("2026-10-14", { hola: 1 })).toThrow(GaneSourceError);
  });
});

describe("normalizeNumber", () => {
  it("completa a 4 cifras", () => {
    expect(normalizeNumber("7")).toBe("0007");
    expect(normalizeNumber(712)).toBe("0712");
    expect(normalizeNumber("0000")).toBe("0000");
    expect(normalizeNumber("12345")).toBeNull();
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("1.5")).toBeNull();
  });
});

describe("GaneSource", () => {
  it("consulta la fecha pedida y devuelve los juegos soportados", async () => {
    const fetchFn = vi.fn(async () => json(200, day("2026-10-14").response));
    const source = new GaneSource(
      true,
      fetchFn as unknown as typeof fetch,
      "https://gane.test/api",
    );
    const draws = await source.fetchDraws("2026-10-14");
    expect(draws).toHaveLength(3);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://gane.test/api/consultar?fecha_especifica=2026-10-14",
    );
    expect(source.enabled).toBe(true);
  });

  it("404 de Gane = todavía no hay resultados (no es un error)", async () => {
    const f = async () =>
      json(404, {
        detail: "No se encontraron resultados de loterias para el rango: 2026-11-02 - 2026-11-02",
      });
    expect(
      await new GaneSource(true, f as unknown as typeof fetch).fetchDraws("2026-11-02"),
    ).toEqual([]);
  });

  it("500 de Gane (su base de datos caída) → error genérico, sin filtrar su detalle interno", async () => {
    const f = async () =>
      json(500, {
        detail:
          'Error interno del servidor: (psycopg2.OperationalError) connection to server at "prod-portalweb03..."',
      });
    const err = await new GaneSource(true, f as unknown as typeof fetch)
      .fetchDraws("2026-09-30")
      .catch((e) => e);
    expect(err).toBeInstanceOf(GaneSourceError);
    expect(err.message).toBe("Gane respondió 500");
    expect(err.message).not.toContain("psycopg2");
  });

  it("tiempo agotado o sin red → error propio y genérico (transitorio)", async () => {
    const f = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const err = await new GaneSource(true, f as unknown as typeof fetch)
      .fetchDraws("2026-10-14")
      .catch((e) => e);
    expect(err).toBeInstanceOf(GaneSourceError);
    expect(err.message).toBe("No se pudo contactar a Gane");
  });

  it("respuesta que no es JSON → error", async () => {
    const f = async () => new Response("<html>", { status: 200 });
    await expect(
      new GaneSource(true, f as unknown as typeof fetch).fetchDraws("2026-10-14"),
    ).rejects.toBeInstanceOf(GaneSourceError);
  });

  it("rechaza fechas con formato inválido sin llamar a la red", async () => {
    const fetchFn = vi.fn();
    await expect(
      new GaneSource(true, fetchFn as unknown as typeof fetch).fetchDraws("14/10/2026"),
    ).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
