import { EXPRESSIONS, EXPRESSION_BY_ID, type BotExpression } from "../vendor/bloub/expressions.ts";

// definido em 2026-09-18: pose neutra ajustada à referência estática enviada; demais expressões são originais.
export const REPOUSO_NOD: BotExpression = {
  ...EXPRESSIONS[0]!,
  gaze: { yaw: 23, pitch: 15, roll: -13 },
  split: 18,
};
export function expressaoMascote(id: string | null): BotExpression {
  return !id || id === "neutre" ? REPOUSO_NOD : EXPRESSION_BY_ID.get(id) ?? REPOUSO_NOD;
}
