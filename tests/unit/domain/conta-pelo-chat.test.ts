import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import { ETAPAS_PELO_CHAT, PEDIDOS_DE_CONTA, type SituacaoConta } from "../../../src/contracts/ferramentas-conta.ts";
import { cartaoDoPedido, resultadoAbrirConta } from "../../../src/domain/conta-pelo-chat.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";
import { errosDoSchema } from "../../../src/domain/schema-args.ts";
import { abrirConta } from "../../../src/use-cases/abrir-conta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";

/** NOD-351: qualquer bot abre, pelo chat, o cartão de conta da NOD-345 — sem executar nada e sem tocar em segredo. */
const SITUACOES: SituacaoConta[] = ["sem_conta", "legado", "conta_sem_senha", "conta_google_de_antes", "conta_com_senha", "fora_das_contas"];

describe("cartão por pedido e situação (domínio puro)", () => {
  it("a matriz inteira: cada pedido em cada situação abre o cartão certo ou diz por que não", () => {
    const tabela = Object.fromEntries(PEDIDOS_DE_CONTA.map((p) => [p, Object.fromEntries(SITUACOES.map((s) => [s, cartaoDoPedido(p, s)]))]));
    expect(tabela).toEqual({
      criar: { sem_conta: { etapa: "inicio" }, legado: { motivo: "ja_tem_conta" }, conta_sem_senha: { motivo: "ja_tem_conta" }, conta_google_de_antes: { motivo: "ja_tem_conta" }, conta_com_senha: { motivo: "ja_tem_conta" }, fora_das_contas: { motivo: "fora_das_contas" } },
      entrar: { sem_conta: { etapa: "entrar" }, legado: { etapa: "entrar" }, conta_sem_senha: { etapa: "entrar" }, conta_google_de_antes: { etapa: "entrar" }, conta_com_senha: { etapa: "entrar" }, fora_das_contas: { etapa: "entrar" } },
      trocar_senha: { sem_conta: { etapa: "recuperar" }, legado: { motivo: "entra_pelo_google" }, conta_sem_senha: { etapa: "recuperar" }, conta_google_de_antes: { motivo: "entra_pelo_google" }, conta_com_senha: { etapa: "senha" }, fora_das_contas: { motivo: "fora_das_contas" } },
      sair_das_outras: { sem_conta: { motivo: "sem_conta" }, legado: { etapa: "sessoes" }, conta_sem_senha: { etapa: "sessoes" }, conta_google_de_antes: { etapa: "sessoes" }, conta_com_senha: { etapa: "sessoes" }, fora_das_contas: { etapa: "sessoes" } },
      conectar_computador: { sem_conta: { motivo: "sem_conta" }, legado: { motivo: "entra_pelo_google" }, conta_sem_senha: { etapa: "parear-gerar" }, conta_google_de_antes: { etapa: "parear-gerar" }, conta_com_senha: { etapa: "parear-gerar" }, fora_das_contas: { motivo: "fora_das_contas" } },
    });
  });

  it("toda etapa que sai está na lista do chat, e todo resultado traz instrução sem dado da conta", () => {
    for (const p of PEDIDOS_DE_CONTA) for (const s of SITUACOES) {
      const r = cartaoDoPedido(p, s);
      if ("etapa" in r) expect(ETAPAS_PELO_CHAT).toContain(r.etapa);
      const res = resultadoAbrirConta(r);
      expect(res.instrucao.length).toBeGreaterThan(10);
      expect(Object.keys(res).sort()).toEqual("etapa" in r ? ["aberto", "instrucao"] : ["aberto", "instrucao", "motivo"]);
    }
    expect(resultadoAbrirConta({ motivo: "sem_conta" })).toMatchObject({ aberto: null, motivo: "sem_conta" });
    expect(resultadoAbrirConta({ motivo: "sem_conta" }).instrucao).toContain("criar");
    expect(resultadoAbrirConta({ etapa: "sessoes" }).instrucao).toContain("Nada saiu ainda");
  });
});

describe("o que o bot oferece cabe na situação", () => {
  it("toda instrução sem cartão que oferece outro pedido aponta para um que abre cartão na MESMA situação (sem laço)", () => {
    let ofertas = 0;
    for (const p of PEDIDOS_DE_CONTA) for (const s of SITUACOES) {
      const r = cartaoDoPedido(p, s);
      if ("etapa" in r) continue;
      for (const [, oferecido] of resultadoAbrirConta(r).instrucao.matchAll(/pedido (\w+)/g)) {
        ofertas++;
        expect(PEDIDOS_DE_CONTA).toContain(oferecido);
        expect(cartaoDoPedido(oferecido as (typeof PEDIDOS_DE_CONTA)[number], s), `${p}/${s} oferece ${oferecido}`).toHaveProperty("etapa");
      }
    }
    expect(ofertas).toBeGreaterThan(0);
  });

  it("quem entra pelo Google do login de antes nunca cai na recuperação, que não cria senha para ele", () => {
    for (const s of ["legado", "conta_google_de_antes"] as const) expect(cartaoDoPedido("trocar_senha", s)).toEqual({ motivo: "entra_pelo_google" });
    expect(resultadoAbrirConta({ motivo: "entra_pelo_google" }).instrucao).toContain("Google");
  });
});

describe("schema de abrir_conta", () => {
  const s = FERRAMENTAS_NOD.abrir_conta;
  it("só o enum do pedido: nenhum campo leva senha, código, token, cookie ou e-mail", () => {
    expect(Object.keys(s.properties)).toEqual(["pedido"]);
    expect(s.required).toEqual(["pedido"]);
    expect(s.additionalProperties).toBe(false);
    for (const pedido of PEDIDOS_DE_CONTA) expect(errosDoSchema(s, { pedido })).toEqual([]);
    expect(errosDoSchema(s, { pedido: "excluir_conta" }).length).toBeGreaterThan(0);
    expect(errosDoSchema(s, {}).length).toBeGreaterThan(0);
    for (const extra of [{ senha: "x" }, { codigo: "123456" }, { token: "t" }, { cookie: "c" }, { email: "a@b.c" }, { agenteId: "outro" }, { conversaId: "outra" }, { turnoId: "outro" }]) {
      expect(errosDoSchema(s, { pedido: "entrar", ...extra }).length).toBeGreaterThan(0);
    }
  });

  it("rótulo do Atividade", () => {
    expect(rotuloFerramenta("mcp__nod__abrir_conta")).toBe("Pediu um cartão de conta");
  });
});

describe("catálogo e prompt (NOD_CONTAS)", () => {
  const agora = 1_000_000;
  const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-black", fixado: false, oculto: false, confirmado: true, modelo: "auto", duplicadoDe: null, criadoEm: 0, papel: null };
  const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 1, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "quero trocar minha senha", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "auto", criadoEm: agora, mensagemOrigemId: "m0" };
  const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.290", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
  const nomes = (e: EntradaPlano) => montarPlano(e).catalogo.ferramentas.map((f) => f.nome);

  it("com contas: entra na conversa, na criação e na sala, de qualquer bot (inclusive o Nod)", () => {
    for (const modo of ["conversa", "criacao", "sala"] as const) expect(nomes({ ...base, modo, contas: true })).toContain("abrir_conta");
    expect(nomes({ ...base, agente: { ...agente, papel: "nod" } as Agente, contas: true })).toContain("abrir_conta");
    expect(montarPlano({ ...base, contas: true }).promptSistema).toContain("chame abrir_conta");
  });

  it("sem contas (padrão), não entra em modo nenhum e o prompt não fala dela", () => {
    for (const modo of ["conversa", "criacao", "sala"] as const) expect(nomes({ ...base, modo })).not.toContain("abrir_conta");
    expect(montarPlano(base).promptSistema).not.toContain("abrir_conta");
  });

  it("fora de rotina, delegação, ligação, peer e frente, mesmo com contas", () => {
    for (const modo of ["rotina", "ligacao", "delegacao", "peer"] as const) {
      expect(nomes({ ...base, modo, contas: true, ...(modo === "delegacao" ? { delegacao: { pessoaNome: "Marlon", remetenteNome: "Vera" } } : {}) })).not.toContain("abrir_conta");
    }
    expect(nomes({ ...base, contas: true, trabalho: { titulo: "x", origem: "pessoa", trabalhoMaeId: "tm", forma: "frente" } })).not.toContain("abrir_conta");
    // task em modo conversa: a tela da task não mostra o bloco de conta
    expect(nomes({ ...base, contas: true, trabalho: { titulo: "x", origem: "pessoa", trabalhoMaeId: null, forma: "task" } })).not.toContain("abrir_conta");
  });
});

describe("remover_computador atrás de NOD_ONBOARDING_TEXTO (ADA-245, revisão do PR #694)", () => {
  const agora = 1_000_000;
  const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-black", fixado: false, oculto: false, confirmado: true, modelo: "auto", duplicadoDe: null, criadoEm: 0, papel: null };
  const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 1, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "tira o nod do notebook", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "auto", criadoEm: agora, mensagemOrigemId: "m0" };
  const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.290", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
  const nomes = (e: EntradaPlano) => montarPlano(e).catalogo.ferramentas.map((f) => f.nome);

  it("flag desligada (padrão): o bot não oferece remover um computador, em modo nenhum", () => {
    for (const modo of ["conversa", "criacao"] as const) expect(nomes({ ...base, modo })).not.toContain("remover_computador");
  });

  it("flag ligada: entra na conversa e na criação", () => {
    for (const modo of ["conversa", "criacao"] as const) expect(nomes({ ...base, modo, onboardingTexto: true })).toContain("remover_computador");
  });
});

describe("caso de uso abrirConta", () => {
  const ESCOPO = { tenantId: "t1", pessoaId: "p1" };
  const ctx = { turnoId: "tu1", agenteId: "a1", conversaId: "c1" };
  const TURNO = { id: "tu1", origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" } as Partial<Turno>;
  const deps = (situacao?: SituacaoConta, turno: Partial<Turno> | null = TURNO, contaminado = false) =>
    ({ escopo: ESCOPO, agora: () => 5, repos: { turnos: { buscar: async (id: string) => (turno && id === turno.id ? turno : null), contaminado: async () => contaminado } }, ...(situacao ? { situacaoConta: async () => situacao } : {}) }) as unknown as Deps;

  it("contas desligadas: sem cartão (indisponivel) e nenhum evento", async () => {
    const r = await abrirConta(deps(), { ...ctx, pedido: "entrar" });
    expect(r.data).toMatchObject({ aberto: null, motivo: "indisponivel" });
    expect(r.events ?? []).toEqual([]);
  });

  it("abre: um evento conta_abrir só para a pessoa do escopo, na conversa e no turno, com a etapa e nada mais", async () => {
    const r = await abrirConta(deps("conta_com_senha"), { ...ctx, pedido: "trocar_senha" });
    expect(r.data).toMatchObject({ aberto: "senha" });
    expect(r.events).toHaveLength(1);
    expect(r.events![0]).toMatchObject({ kind: "conta_abrir", pessoaDestinoId: "p1", tenantId: "t1", conversaId: "c1", turnoId: "tu1", dados: { etapa: "senha" } });
    expect(Object.keys(r.events![0]!.dados)).toEqual(["etapa"]);
  });

  it("na sala e na retomada da fala da pessoa, abre", async () => {
    for (const origem of ["sala", "retomada"] as const) expect((await abrirConta(deps("conta_com_senha", { ...TURNO, origem }), { ...ctx, pedido: "entrar" })).data).toMatchObject({ aberto: "entrar" });
  });

  it("pedido que não veio da própria pessoa (outro bot, conteúdo não confiável, rotina, turno de fora): sem cartão e sem evento", async () => {
    const casos: (Partial<Turno> | null)[] = [{ ...TURNO, profundidade: 1 }, { ...TURNO, entradaConfianca: "nao_confiavel" }, { ...TURNO, origem: "rotina" }, { ...TURNO, origem: "peer" }, { ...TURNO, origem: "delegacao" }, { ...TURNO, ligacaoId: "lg1" }, null];
    for (const turno of casos) {
      const r = await abrirConta(deps("conta_com_senha", turno), { ...ctx, pedido: "sair_das_outras" });
      expect(r.data, JSON.stringify(turno)).toMatchObject({ aberto: null, motivo: "nao_foi_a_pessoa" });
      expect(r.events ?? []).toEqual([]);
    }
  });

  it("turno que leu conteúdo de fora (ADR-062) ou com plano não confiável: sem cartão e sem evento", async () => {
    const lido = await abrirConta(deps("conta_com_senha", TURNO, true), { ...ctx, pedido: "sair_das_outras" });
    expect(lido.data).toMatchObject({ aberto: null, motivo: "nao_foi_a_pessoa" });
    expect(lido.events ?? []).toEqual([]);
    const plano = await abrirConta(deps("conta_com_senha"), { ...ctx, pedido: "sair_das_outras", plano: { confiancaEntrada: "nao_confiavel" } } as never);
    expect(plano.data).toMatchObject({ aberto: null, motivo: "nao_foi_a_pessoa" });
  });

  it("sem cartão pela situação (sair das outras sem conta): nenhum evento", async () => {
    const r = await abrirConta(deps("sem_conta"), { ...ctx, pedido: "sair_das_outras" });
    expect(r.data).toMatchObject({ aberto: null, motivo: "sem_conta" });
    expect(r.events ?? []).toEqual([]);
  });
});
