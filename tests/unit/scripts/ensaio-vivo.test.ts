import { expect, it } from "vitest";
import { prepararEnsaio, recusaDoEnsaio } from "../../../scripts/ensaio-computador/vivo.ts";

// Revisão independente (PR 602): o ensaio não assume nem devolve a tela do bot que espera a pessoa (pedido de ajuda).
it("vivo.ts recusa a tela que pediu ajuda e segue com a do bot ou a da pessoa", () => {
  expect(recusaDoEnsaio([{ agenteId: "a", controle: "aguardando_pessoa", ajuda: "Entre no banco" }], "a")).toMatch(/ajuda/);
  expect(recusaDoEnsaio([{ agenteId: "a", controle: "aguardando_pessoa", ajuda: null }], "a")).toMatch(/ajuda/);
  expect(recusaDoEnsaio([{ agenteId: "a", controle: "bot", ajuda: "Entre no banco" }], "a")).toMatch(/ajuda/);
  expect(recusaDoEnsaio([{ agenteId: "a", controle: "bot", ajuda: null }], "a")).toBeNull();
  expect(recusaDoEnsaio([{ agenteId: "a", controle: "pessoa" }], "a")).toBeNull();
  expect(recusaDoEnsaio([{ agenteId: "b", controle: "aguardando_pessoa" }], "a")).toBeNull();
});

// Rodada 3: a ordem do preparo (nada de observar antes da conferência) e a conferência que fecha na dúvida.
type Chamada = string;
const falso = (respostas: Record<string, { status: number; json: Record<string, unknown> | null }[]>) => {
  const chamadas: Chamada[] = [];
  const pedir = async (metodo: string, caminho: string) => {
    const k = `${metodo} ${caminho}`;
    chamadas.push(k);
    const fila = respostas[k] ?? [];
    return fila.length > 1 ? fila.shift()! : (fila[0] ?? { status: 404, json: null });
  };
  return { chamadas, pedir };
};
const B = "/api/t/t1";
const OBS = `POST ${B}/agentes/a/computador/acoes`;
const PC = `GET ${B}/computador`;

it("vivo.ts: o pedido de ajuda é visto antes de qualquer observar (que acordaria a máquina real)", async () => {
  const f = falso({ [PC]: [{ status: 200, json: { telas: [{ agenteId: "a", controle: "aguardando_pessoa" }] } }] });
  const r = await prepararEnsaio(f.pedir, B, "a", () => {}, 0);
  expect(r).toMatchObject({ codigo: 2 });
  expect(f.chamadas).toEqual([PC]);
});

it("vivo.ts: sem a lista de telas (erro ou corpo estranho) o ensaio não segue", async () => {
  for (const resp of [{ status: 500, json: null }, { status: 200, json: { telas: "x" } }, { status: 200, json: {} }]) {
    const f = falso({ [PC]: [resp] });
    expect(await prepararEnsaio(f.pedir, B, "a", () => {}, 0)).toMatchObject({ codigo: 2 });
    expect(f.chamadas).toEqual([PC]);
  }
});

it("vivo.ts: o bot que pede ajuda enquanto a tela abria é visto na 2ª conferência, antes do assumir", async () => {
  const f = falso({
    [PC]: [{ status: 200, json: { telas: [{ agenteId: "a", controle: "bot" }] } }, { status: 200, json: { telas: [{ agenteId: "a", controle: "bot", ajuda: "entre no banco" }] } }],
    [OBS]: [{ status: 200, json: { tela: { quadro: "q" } } }],
  });
  expect(await prepararEnsaio(f.pedir, B, "a", () => {}, 0)).toMatchObject({ codigo: 2 });
  expect(f.chamadas).toEqual([PC, OBS, PC]);
});

it("vivo.ts: caminho feliz devolve as telas da conferência de depois do observar", async () => {
  const depois = [{ agenteId: "a", controle: "pessoa" }];
  const f = falso({ [PC]: [{ status: 200, json: { telas: [] } }, { status: 200, json: { telas: depois } }], [OBS]: [{ status: 200, json: {} }] });
  expect(await prepararEnsaio(f.pedir, B, "a", () => {}, 0)).toEqual({ telas: depois });
});

it("vivo.ts (rodada 4): sem a tela do bot na conferência de depois do observar, o ensaio não segue", async () => {
  const f = falso({ [PC]: [{ status: 200, json: { telas: [] } }, { status: 200, json: { telas: [{ agenteId: "outro", controle: "bot" }] } }], [OBS]: [{ status: 200, json: {} }] });
  expect(await prepararEnsaio(f.pedir, B, "a", () => {}, 0)).toMatchObject({ codigo: 2 });
  expect(f.chamadas).toEqual([PC, OBS, PC]);
});
