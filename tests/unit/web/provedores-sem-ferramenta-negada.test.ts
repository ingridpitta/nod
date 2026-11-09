import { describe, expect, it } from "vitest";
import type { ContaIa, ContasIaDto } from "../../../src/contracts/contas-ia.ts";
import type { Negacao } from "../../../src/contracts/negacao.ts";
import { estadoInicial, type Estado, type NegacaoVista } from "../../../web/estado/reducer.ts";
import { renderProvedores } from "../../../web/telas/provedores.ts";

/**
 * definido em 2026-10-27 (NOD-384, decisão do Marlon): Configurações › Provedores de IA não mostra mais o bloco
 * "Ferramenta negada" (título, contagem nem lista), nos dois modos da tela; o resto (contas, Fora do ar, plano ausente)
 * fica, e o estado continua guardando a negação (só a exibição sai).
 */
const AGORA = Date.UTC(2026, 9, 27, 12, 0);
const negada = (nome: string, o: Partial<Negacao> = {}): Negacao => ({ classe: "ferramenta_negada", nome, motivo: "fora_do_catalogo", desde: AGORA - 60_000, terminal: false, ...o });
const vista = (n: Negacao): NegacaoVista => ({ ...n, conversaId: "c1", vistaEm: AGORA });
const VM = "11111111-1111-4111-8111-111111111111";
const CONTA: ContaIa = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", ia: "claude-cli", impressao: "a".repeat(64), apelido: "Pessoal", email: null, organizacao: null, plano: "Max", corporativa: false, posicao: 1,
  entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas: [{ maquinaId: VM, nome: "vm-bots", estado: "pronta" }],
};
const CONTAS: ContasIaDto = { disponivel: true, modo: "perguntar", contas: [CONTA] };
const MAQUINAS = { maquinas: [{ id: VM, nome: "vm-bots", prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false }], padraoId: null };

const NEGADAS_FROTA = [negada("Bash", { terminal: true }), negada("WebFetch")];
const NEGADA_LOCAL = vista(negada("Edit", { vezes: 3 }));
const PLANO_AUSENTE: Negacao = { classe: "plano_ausente", nome: "executor", motivo: "plano_ausente", desde: AGORA - 120_000, terminal: true };
const CONECTOR_FORA: Negacao = { classe: "conector_indisponivel", nome: "gmail", motivo: "conector_indisponivel", desde: AGORA - 300_000, terminal: false };

const estado = (o: Partial<Estado> = {}): Estado =>
  ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [], negacoes: NEGADAS_FROTA } as never, negacoes: [NEGADA_LOCAL], ...o }) as Estado;

/** O que prova que o resto da tela (contas/IAs na ordem) continua lá, em cada modo. */
const MODOS: [string, Partial<Estado>, string][] = [
  ["modo local / app antigo (cartões por IA)", {}, 'data-ordem-lista="pessoa"'],
  ["modo compartilhado (lista única de contas, ADR-102)", { contasIa: CONTAS, maquinas: MAQUINAS as never }, "Claude · Pessoal"],
];

/** Tudo o que denunciaria o bloco: o título (com ou sem o text-transform), a frase de cada item e os nomes negados. */
function semBloco(html: string): void {
  expect(html).not.toMatch(/ferramentas? negadas?/i);
  expect(html).not.toContain("negacao-ferramenta_negada");
  for (const nome of ["Bash", "WebFetch", "Edit"]) expect(html).not.toContain(`ferramenta ${nome}`);
}

describe("Provedores de IA sem Ferramentas negadas (NOD-384)", () => {
  for (const [modo, extra, resto] of MODOS) {
    describe(modo, () => {
      it("com negações de ferramenta na frota e no estado, a tela não mostra o bloco nem a contagem", () => {
        const html = renderProvedores(estado(extra));
        expect(html).toContain("Provedores de IA");
        expect(html).toContain(resto);
        semBloco(html);
        expect(html).not.toContain('class="negacoes"');
      });

      it("o resto do rodapé fica: Fora do ar e o plano ausente", () => {
        const html = renderProvedores(estado({ ...extra, frota: { agentes: [], negacoes: [...NEGADAS_FROTA, CONECTOR_FORA, PLANO_AUSENTE] } as never }));
        semBloco(html);
        expect(html).toContain(resto);
        expect(html).toContain('<h3 class="espaco-subtitulo">Fora do ar</h3>');
        expect(html).toContain("negacao-plano_ausente");
        expect(html).toContain("plano ausente · 1");
      });
    });
  }

  // O reducer seguir guardando a negação de ferramenta que chega pelo frame já está em reducer-frames.test.ts ("negacao").
});
