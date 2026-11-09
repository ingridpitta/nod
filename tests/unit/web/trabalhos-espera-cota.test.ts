import { describe, expect, it } from "vitest";
import type { EsperaDaConta } from "../../../src/contracts/cota.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { esperaDaConta, iaDaEntrada } from "../../../src/domain/espera-da-cota.ts";
import { entradaDaTrocaDeConta, entradaDaVoltaDaCota } from "../../../src/domain/cota-da-ia.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { situacaoDe } from "../../../web/lib/trabalhos.ts";
import { renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/** definido em 2026-10-15 (NOD-277, pacote A3): a linha da task esperando a cota, com "Seguir com" nas contas livres. */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 15, 13, 0).getTime();
const VOLTA = new Date(2026, 9, 15, 14, 0).getTime();

const trabalho = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "tk", agenteId: "leo", conversaId: "c-leo", titulo: "Migrar relatórios", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60 * MIN, iniciadoEm: AGORA - 60 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null,
  acordaEm: VOLTA, ...extra,
} as TrabalhoDto);

const estadoCom = (t: TrabalhoDto): Estado => ({
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true }] } as never,
  trabalhos: { trabalhos: [t], pressao: null, memoriaTotalMb: null },
  tela: { tipo: "trabalho", id: t.id, voltar: { tipo: "inicio" } } as never,
});

const daConta: EsperaDaConta = {
  ia: "claude-cli", iaNome: "Claude", conta: { id: "c2", apelido: "Conta 2", nome: "Claude · Conta 2" }, voltaEm: VOLTA,
  livres: [{ id: "c3", nome: "Claude · Conta 3" }, { id: "c4", nome: "Claude · Trabalho" }],
};

describe("linha da task esperando a cota (NOD-277)", () => {
  it("linha esperando a conta N com Seguir com", () => {
    const t = trabalho({ esperaDaConta: daConta });
    expect(situacaoDe(t, [], false, AGORA)).toBe("esperando a conta 2 · volta às 14:00");
    const topo = renderTopoTrabalho(estadoCom(t), "tk");
    expect(topo).toContain("esperando a conta 2 · volta às 14:00");
    expect(topo).toContain('data-act="cl-seguir" data-id="c3" data-conversa="c-leo" data-trabalho="tk">Seguir com Claude · Conta 3</button>');
    expect(topo).toContain('data-id="c4" data-conversa="c-leo" data-trabalho="tk">Seguir com Claude · Trabalho</button>');
    // A lista de "Todos os trabalhos" leva o mesmo status (os botões ficam só na tela da task: a linha já é um botão).
    const lista = renderTodosOsTrabalhos(estadoCom(t));
    expect(lista).toContain("esperando a conta 2 · volta às 14:00");
    expect(lista).not.toContain("cl-seguir");
  });

  it("conta sem nome padrão, cota da IA sem conta conhecida e sem conta livre", () => {
    expect(situacaoDe(trabalho({ esperaDaConta: { ...daConta, conta: { id: "c9", apelido: "Pessoal", nome: "Claude · Pessoal" } } }), [], false, AGORA)).toBe("esperando a conta Pessoal · volta às 14:00");
    const semConta = trabalho({ esperaDaConta: { ...daConta, conta: null, livres: [] } });
    expect(situacaoDe(semConta, [], false, AGORA)).toBe("esperando a cota do Claude · volta às 14:00");
    expect(renderTopoTrabalho(estadoCom(semConta), "tk")).not.toContain("Seguir com");
  });

  it("passada a hora da volta, ou com a task terminada, a linha volta ao de sempre", () => {
    expect(situacaoDe(trabalho({ esperaDaConta: daConta, acordaEm: null }), [], false, VOLTA + MIN)).not.toContain("esperando a conta");
    expect(situacaoDe(trabalho({ esperaDaConta: daConta, estado: "terminado" }), [], false, AGORA)).toBe("terminou");
  });
});

describe("a espera montada no domínio (src/domain/espera-da-cota.ts)", () => {
  it("lê a IA da entrada da volta da cota e da troca de conta", () => {
    expect(iaDaEntrada(entradaDaVoltaDaCota("Claude Code"))).toEqual({ ia: "claude-cli", nome: "Claude" });
    expect(iaDaEntrada(entradaDaTrocaDeConta("Codex", 1, 2))).toEqual({ ia: "codex-cli", nome: "ChatGPT" });
    expect(iaDaEntrada("me chame às 14h")).toBeNull();
  });

  it("a conta no limite dá a IA; as livres são só as da mesma IA, sem a que espera", () => {
    const livres = [{ id: "c1", ia: "claude-cli" as const, apelido: "Conta 1" }, { id: "x", ia: "codex-cli" as const, apelido: "Conta 1" }, { id: "c3", ia: "claude-cli" as const, apelido: "Conta 3" }];
    const e = esperaDaConta({ voltaEm: VOLTA, entrada: entradaDaVoltaDaCota("Claude Code"), conta: { id: "c1", ia: "claude-cli", apelido: "Conta 1" } }, livres);
    expect(e).toEqual({ ia: "claude-cli", iaNome: "Claude", conta: { id: "c1", apelido: "Conta 1", nome: "Claude · Conta 1" }, voltaEm: VOLTA, livres: [{ id: "c3", nome: "Claude · Conta 3" }] });
    const semConta = esperaDaConta({ voltaEm: VOLTA, entrada: entradaDaVoltaDaCota("Codex"), conta: null }, livres);
    expect(semConta?.livres).toEqual([{ id: "x", nome: "ChatGPT · Conta 1" }]);
    expect(semConta?.iaNome).toBe("ChatGPT");
  });
});
