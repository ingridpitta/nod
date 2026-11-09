import { describe, expect, it } from "vitest";
import type { FerramentaPlano, ModoTurno } from "../../../src/contracts/plano-turno.ts";
import { falaDeCapacidadeDoTurno } from "../../../src/domain/memoria-de-capacidade.ts";
import { motivoSemTerminal, NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { montarPromptSistema, secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";

const ferramenta = (nome: string): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: {} });

describe("o turno sem terminal diz por quê (ADR-065)", () => {
  it("o motivo sai da mesma regra das nativas: com o harness do terminal (ADR-066), só o peer legado fica sem", () => {
    for (const modo of ["conversa", "criacao", "rotina", "delegacao", "sala"] as ModoTurno[]) {
      for (const confianca of ["confiavel", "nao_confiavel"] as const) expect(motivoSemTerminal({ modo, confianca, terminal: true }), `${modo}/${confianca}`).toBeNull();
    }
    expect(motivoSemTerminal({ modo: "peer", confianca: "confiavel", terminal: true })).toBe("resposta_a_colega");
    // Codex ou máquina sem o hook: não é o turno que tirou, é o harness que não tem.
    expect(motivoSemTerminal({ modo: "delegacao", confianca: "confiavel", terminal: false })).toBeNull();
  });

  it("no pedido de colega a linha diz o motivo, quando o terminal vem e a quem dizer o que ficou de fora", () => {
    const prompt = montarPromptSistema({
      agente: { nome: "Dev 4", titulo: "Dev Sr", descricao: "" }, memorias: [], pessoaNome: "Marlon", modo: "delegacao",
      ferramentas: [ferramenta("lembrar")],
      delegacao: { pessoaNome: "Marlon", remetenteNome: "Chico" },
      semTerminal: "pedido_de_colega",
    });
    const linha = prompt.split("\n").find((l) => l.startsWith("Terminal:")) ?? "";
    expect(linha).toContain("porque é um pedido de colega; no nod, o terminal vem nos turnos que Marlon abre na conversa com você");
    expect(linha).not.toContain("anotar_pendencia");
    expect(linha).toContain("e diga a Chico, na sua resposta,");
    expect(linha).toContain("Não guarde \"sem terminal\" como fato");
    expect(secaoDaLinha(linha)).toBe("ferramentas");
  });

  it("na rotina a linha não promete ferramenta de anotar, e com o terminal no turno ela não aparece", () => {
    const base = { agente: { nome: "Dev 1", titulo: "", descricao: "" }, memorias: [], pessoaNome: "Marlon" } as const;
    const rotina = montarPromptSistema({ ...base, modo: "rotina", ferramentas: [ferramenta("sem_novidade")], semTerminal: "rotina" });
    expect(rotina).toContain("Terminal: este turno não tem terminal, arquivos nem skills porque é uma rotina;");
    expect(rotina).not.toContain("anotar_pendencia o que precisa");
    expect(rotina).toContain("e diga em uma frase que essa parte precisa de um turno com terminal");
    const comTerminal = montarPromptSistema({ ...base, modo: "conversa", ferramentas: [], nativas: NATIVAS_DO_TERMINAL, pastaDoBot: "Dev 1", semTerminal: "rotina" });
    expect(comTerminal).not.toContain("Terminal: este turno");
  });

  it("quem fala com colegas lê que o que um colega diz que não tem vale só para o turno dele", () => {
    const prompt = montarPromptSistema({ agente: { nome: "Chico", titulo: "", descricao: "" }, memorias: [], pessoaNome: "Marlon", modo: "conversa", ferramentas: [ferramenta("pedir_a_bot")], colegas: [] });
    expect(prompt).toContain("O que um colega diz que não tem (terminal, acesso, ferramenta) vale para o turno dele, não para o próximo");
  });
});

describe("capacidade do turno não vira memória (ADR-065)", () => {
  it("recusa o que diz que falta terminal, pasta, skills, computador ou colega neste turno — as frases reais de 30/09", () => {
    for (const texto of [
      "Dev 3/Dev 4 não têm terminal nem permissão de push no GitHub",
      "Os Devs estão sem terminal nem pasta do acme-rh",
      "Neste turno não consigo delegar",
      "workspace_propor_pasta não existe no meu catálogo",
      "Não tenho Read, Edit, Write, Glob, Grep nem Bash",
      "o computador caiu e não tenho skills",
    ]) expect(falaDeCapacidadeDoTurno(texto), texto).toBe(true);
  });

  it("deixa gravar acesso a app, regra de processo e o que só cita terminal sem negar", () => {
    for (const texto of [
      "Não tenho acesso ao Supabase de produção",
      "Regra do Marlon: git merge origin/main na branch do PR e push normal, sem reescrever histórico nem --force",
      "O repo acme-rh só está ativo para liderança e clientes",
      "Rodo os testes no terminal antes de abrir o PR",
      "Em toda mensagem no Slack, marcar a pessoa com <@ID>",
    ]) expect(falaDeCapacidadeDoTurno(texto), texto).toBe(false);
  });
});
