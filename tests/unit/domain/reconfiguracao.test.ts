import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { comandoDaConversa, montarCatalogo } from "../../../src/domain/comandos.ts";
import { FERRAMENTA_RECONFIGURACAO, FERRAMENTAS_NOD_POR_MODO, montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { INSTRUCAO_RECONFIGURACAO } from "../../../src/domain/prompt-sistema.ts";
import { emReconfiguracao, entradaDaReconfiguracao, JANELA_RECONFIGURACAO_MS, podeReconfigurar } from "../../../src/domain/reconfiguracao.ts";

const agora = 10_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "Revisora", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno = (entradaTexto: string): Turno => ({ executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto, entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" });
const base = (texto: string, extra: Partial<EntradaPlano> = {}): EntradaPlano => ({ turno: turno(texto), agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, ...extra });
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("NOD-23: quem pode e quando está em reconfiguração", () => {
  it("a janela exigida é exatamente 2 h", () => {
    expect(JANELA_RECONFIGURACAO_MS).toBe(7_200_000);
  });

  it("só bot da própria pessoa, confirmado, não excluído e que não seja o Nod", () => {
    expect(podeReconfigurar(agente, "p")).toBe(true);
    expect(podeReconfigurar(agente, "outra")).toBe(false);
    expect(podeReconfigurar({ ...agente, confirmado: false }, "p")).toBe(false);
    expect(podeReconfigurar({ ...agente, papel: "nod" }, "p")).toBe(false);
    expect(podeReconfigurar({ ...agente, excluidoEm: 1 }, "p")).toBe(false);
  });

  it("a janela é de 2 h a partir do pedido; nula ou no futuro não vale", () => {
    expect(emReconfiguracao({ configurandoDesde: null }, agora)).toBe(false);
    expect(emReconfiguracao({}, agora)).toBe(false);
    expect(emReconfiguracao({ configurandoDesde: agora }, agora)).toBe(true);
    expect(emReconfiguracao({ configurandoDesde: agora - JANELA_RECONFIGURACAO_MS + 1 }, agora)).toBe(true);
    expect(emReconfiguracao({ configurandoDesde: agora - JANELA_RECONFIGURACAO_MS }, agora)).toBe(false);
    expect(emReconfiguracao({ configurandoDesde: agora + 1 }, agora)).toBe(false);
  });

  it("/configurar, /setup e /config são o mesmo comando da conversa, só de bot próprio, e nunca do terminal", () => {
    for (const t of ["/configurar", "/setup", "/config muda o tom"]) expect(comandoDaConversa(t)?.comando.nome).toBe("configurar");
    expect(comandoDaConversa("/setup muda o tom")?.resto).toBe("muda o tom");
    const c = comandoDaConversa("/configurar")!.comando;
    expect(c.acao).toBe("turno");
    expect(c.soBotProprio).toBe(true);
    // "config" era só do terminal; agora é apelido da conversa e sai dessa lista (senão a barra diria que só roda lá).
    const cat = montarCatalogo({ skills: [], comandos: [], soDoTerminal: ["config", "doctor"], arquivos: {}, versaoCli: null });
    expect(cat.soDoTerminal).not.toContain("config");
    expect(cat.soDoTerminal).toContain("doctor");
    // A skill do Mac chamada "setup" nunca rodaria pelo chat (o servidor a trata como /configurar): some da barra.
    const comSkill = montarCatalogo({ skills: ["setup", "review"], comandos: [], soDoTerminal: [], arquivos: { setup: { origem: "suas", frontmatter: { description: "Monta o projeto." } }, review: { origem: "suas", frontmatter: { description: "Revisa." } } }, versaoCli: null });
    expect(comSkill.comandos.map((x) => x.nome)).toEqual(["review"]);
  });

  it("a entrada da entrevista leva o pedido direto quando houver", () => {
    expect(entradaDaReconfiguracao("")).toContain("Comece a entrevista pela primeira pergunta.");
    expect(entradaDaReconfiguracao("fala mais curto")).toContain('"fala mais curto"');
  });
});

describe("NOD-23: o plano da conversa em reconfiguração", () => {
  it("em reconfiguração: soma atualizar_perfil, troca a linha do modo e a entrada vira a entrevista", () => {
    expect(FERRAMENTAS_NOD_POR_MODO.conversa).not.toContain(FERRAMENTA_RECONFIGURACAO);
    const p = montarPlano(base("/configurar", { reconfiguracao: true }));
    expect(nomes(p)).toContain("atualizar_perfil");
    expect(p.promptSistema).toContain(INSTRUCAO_RECONFIGURACAO);
    expect(p.promptSistema).not.toContain("Modo de conversa: responda à pessoa.");
    expect(p.entrada.texto).toBe(entradaDaReconfiguracao(""));
    expect(montarPlano(base("/setup fala mais curto", { reconfiguracao: true })).entrada.texto).toBe(entradaDaReconfiguracao("fala mais curto"));
  });

  it("a resposta seguinte da entrevista, ainda na janela, mantém a ferramenta e passa o texto igual", () => {
    const p = montarPlano(base("quero que você seja mais direto", { reconfiguracao: true }));
    expect(nomes(p)).toContain("atualizar_perfil");
    expect(p.entrada.texto).toBe("quero que você seja mais direto");
  });

  it("fora do modo: conversa comum sem atualizar_perfil, e /configurar vira a explicação em vez de ir cru ao CLI", () => {
    const p = montarPlano(base("/configurar"));
    expect(nomes(p)).not.toContain("atualizar_perfil");
    expect(p.promptSistema).toContain("Modo de conversa: responda à pessoa.");
    expect(p.promptSistema).not.toContain(INSTRUCAO_RECONFIGURACAO);
    expect(p.entrada.texto).toContain("Aqui ele não vale");
  });

  it("a flag não vale fora da conversa, no Nod nem numa task", () => {
    const sala = montarPlano(base("oi", { reconfiguracao: true, modo: "sala" }));
    expect(nomes(sala)).not.toContain("atualizar_perfil");
    const nod = montarPlano(base("/configurar", { reconfiguracao: true, agente: { ...agente, papel: "nod" } }));
    expect(nomes(nod)).not.toContain("atualizar_perfil");
    expect(nod.promptSistema).not.toContain(INSTRUCAO_RECONFIGURACAO);
    const task = montarPlano(base("oi", { reconfiguracao: true, trabalho: { titulo: "x", origem: "pessoa", trabalhoMaeId: "w0", forma: "frente" } }));
    expect(nomes(task)).not.toContain("atualizar_perfil");
  });
});
