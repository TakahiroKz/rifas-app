import { describe, expect, it } from "vitest";
import { buildWhatsAppMessage, buildWhatsAppUrl, joinNumbers } from "./whatsapp";

describe("joinNumbers", () => {
  it("une en español", () => {
    expect(joinNumbers(["07"])).toBe("07");
    expect(joinNumbers(["07", "23"])).toBe("07 y 23");
    expect(joinNumbers(["07", "23", "85"])).toBe("07, 23 y 85");
  });
});

describe("mensaje de WhatsApp", () => {
  const base = {
    raffleTitle: "Rifa de Navidad",
    numbers: ["07", "23", "85"],
    code: "RF-4K9P2X",
    reservedUntil: "2026-11-03T15:00:00.000Z",
    privacyUrl: "https://turifa.capitalfinaura.com/r/finaura/navidad/privacidad",
  };

  it("incluye números, rifa, código, vigencia y política de privacidad", () => {
    const m = buildWhatsAppMessage(base);
    expect(m).toContain('los números 07, 23 y 85 de la rifa "Rifa de Navidad"');
    expect(m).toContain("Código de apartado: RF-4K9P2X");
    expect(m).toMatch(/vigente hasta el .*2026/);
    expect(m).toContain(base.privacyUrl);
    expect(m.split("\n")).toHaveLength(4);
  });

  it("singular cuando es un solo número", () => {
    expect(buildWhatsAppMessage({ ...base, numbers: ["07"] })).toContain("el número 07 de la rifa");
  });
});

describe("enlace wa.me", () => {
  it("teléfono solo con dígitos (sin +) y texto codificado", () => {
    const url = buildWhatsAppUrl("+57 304 523 5606", "Hola, ñandú\nCódigo: RF-1 & más");
    expect(url.startsWith("https://wa.me/573045235606?text=")).toBe(true);
    expect(url).toContain("%0A"); // salto de línea
    expect(url).not.toContain(" ");
    expect(url).not.toMatch(/text=.*[&](?!amp)/); // el & del texto va codificado
    const text = new URL(url).searchParams.get("text");
    expect(text).toBe("Hola, ñandú\nCódigo: RF-1 & más");
  });

  it("el mensaje completo sobrevive al viaje de ida y vuelta", () => {
    const m = buildWhatsAppMessage({
      raffleTitle: 'Rifa "Pascua" 50%',
      numbers: ["0007", "9999"],
      code: "RF-ABC234",
      reservedUntil: "2026-11-03T15:00:00.000Z",
      privacyUrl: "https://turifa.capitalfinaura.com/r/finaura/pascua/privacidad",
    });
    const url = buildWhatsAppUrl("573045235606", m);
    expect(new URL(url).searchParams.get("text")).toBe(m);
    expect(new URL(url).searchParams.size).toBe(1);
  });
});
