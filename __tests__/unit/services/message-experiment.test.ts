import { describe, it, expect } from "vitest";
import {
  pickVariant,
  computeMessageExperimentResults,
  type MessageVariant,
} from "@/server/services/message-experiment";
import { twoProportionConfidence } from "@/server/services/ab-stats";

const VARIANTS: MessageVariant[] = [
  { key: "A", label: "A", content: "hola A" },
  { key: "B", label: "B", content: "hola B" },
];

describe("pickVariant", () => {
  it("devuelve null sin variantes", () => {
    expect(pickVariant([], () => 0.5)).toBeNull();
  });

  it("elige la primera con rng bajo y la última con rng alto", () => {
    expect(pickVariant(VARIANTS, () => 0)?.key).toBe("A");
    expect(pickVariant(VARIANTS, () => 0.99)?.key).toBe("B");
  });

  it("clamp: rng=1 no desborda el índice", () => {
    expect(pickVariant(VARIANTS, () => 1)?.key).toBe("B");
  });

  it("reparte entre variantes según el rng", () => {
    const three: MessageVariant[] = [
      { key: "A", label: "A", content: "" },
      { key: "B", label: "B", content: "" },
      { key: "C", label: "C", content: "" },
    ];
    expect(pickVariant(three, () => 0.1)?.key).toBe("A");
    expect(pickVariant(three, () => 0.5)?.key).toBe("B");
    expect(pickVariant(three, () => 0.9)?.key).toBe("C");
  });
});

describe("computeMessageExperimentResults", () => {
  it("agrega envíos, respuestas y conversiones por variante", () => {
    const sends = [
      { variantKey: "A", replied: true, converted: true, replySentiment: 0.5 },
      { variantKey: "A", replied: true, converted: false, replySentiment: 0.1 },
      { variantKey: "A", replied: false, converted: false, replySentiment: null },
      { variantKey: "B", replied: false, converted: false, replySentiment: null },
    ];
    const res = computeMessageExperimentResults(VARIANTS, sends);
    const a = res.variants.find((v) => v.key === "A")!;
    const b = res.variants.find((v) => v.key === "B")!;

    expect(a.sends).toBe(3);
    expect(a.replies).toBe(2);
    expect(a.replyRate).toBeCloseTo(2 / 3);
    expect(a.conversions).toBe(1);
    expect(a.conversionRate).toBeCloseTo(1 / 3);
    expect(a.avgReplySentiment).toBeCloseTo(0.3); // (0.5 + 0.1) / 2
    expect(b.avgReplySentiment).toBeNull();
    expect(res.leaderKey).toBe("A"); // mayor conversionRate
  });

  it("sin muestra suficiente la confianza es 0", () => {
    const sends = [
      { variantKey: "A", replied: true, converted: true, replySentiment: null },
      { variantKey: "B", replied: false, converted: false, replySentiment: null },
    ];
    const res = computeMessageExperimentResults(VARIANTS, sends);
    expect(res.confidence).toBe(0);
    expect(res.suggestedWinnerKey).toBeNull();
  });

  it("leaderKey es null cuando no hay ningún envío", () => {
    const res = computeMessageExperimentResults(VARIANTS, []);
    expect(res.leaderKey).toBeNull();
    expect(res.confidence).toBe(0);
  });
});

describe("twoProportionConfidence", () => {
  it("devuelve 0 bajo el mínimo de muestra", () => {
    expect(twoProportionConfidence(5, 0.5, 5, 0.1)).toBe(0);
  });

  it("da confianza alta con una diferencia grande y muestra amplia", () => {
    const c = twoProportionConfidence(200, 0.5, 200, 0.1);
    expect(c).toBeGreaterThan(0.95);
  });

  it("da confianza baja cuando las tasas son iguales", () => {
    const c = twoProportionConfidence(200, 0.3, 200, 0.3);
    expect(c).toBeLessThan(0.5);
  });
});
