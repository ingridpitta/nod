import { describe, expect, it } from "vitest";
import { RESPOSTA_NA_TROCA_MAX } from "../../../src/contracts/troca-entre-bots.ts";
import { caiuDeVez, decidirFecho, destinoDoLote, entradaComplementar, entradaDoRetorno, INSTRUCAO_DO_RETORNO, motivoDaFrente, PERGUNTA_DA_QUEDA, PERGUNTA_DA_RECONEXAO, recusouDeVez, respostaAoColega, respostaComplementarAoColega, resumoMudou, respostaNaTroca, textoFrentesTerminadas, textoPedidoRespondido, type FrenteNoFecho } from "../../../src/domain/retorno-do-lote.ts";

const frente = (id: string, extra: Partial<FrenteNoFecho> = {}): FrenteNoFecho => ({ id, titulo: `Frente ${id}`, estado: "terminado", resumo: { feito: `fiz ${id}` }, deFora: false, motivoInterrupcao: null, ...extra });

describe("retorno do lote (ADR-099, I3): a quem devolve", () => {
  it("pedido de colega (delegacao, ou o peer legado) é de colega; o resto é do dono", () => {
    expect(destinoDoLote({ origem: "delegacao" })).toBe("colega");
    expect(destinoDoLote({ origem: "peer" })).toBe("colega");
    for (const origem of ["conversa", "rotina", "retomada", "sala", "ligacao"] as const) expect(destinoDoLote({ origem })).toBe("dono");
    expect(destinoDoLote(null)).toBe("dono");
  });
});

describe("retorno do lote (ADR-099, I3): a decisão do fecho", () => {
  const base = { destino: "dono" as const, avisarACadaUma: false, devolvido: false, donoParado: false };

  it("lote do dono: espera a última; quando ela acaba, um retorno com todas e o lote fecha", () => {
    const tres = [frente("a"), frente("b", { estado: "rodando" }), frente("c", { estado: "na_fila" })];
    expect(decidirFecho({ ...base, frentes: tres, fechou: "a" })).toEqual({ acao: "nada" });
    const prontas = [frente("a"), frente("b", { estado: "falhou" }), frente("c", { estado: "parado" })];
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "c" })).toEqual({ acao: "dono", frentes: prontas, fechaLote: true, cuidado: false, faltam: 0 });
  });

  it("lote do dono com avisar_a_cada_uma: um retorno por frente; só o último fecha o lote", () => {
    const tres = [frente("a"), frente("b", { estado: "rodando" }), frente("c", { estado: "rodando" })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, frentes: tres, fechou: "a" })).toEqual({ acao: "dono", frentes: [tres[0]], fechaLote: false, cuidado: false, faltam: 2 });
    const ultima = [frente("a"), frente("b"), frente("c", { estado: "falhou", deFora: true })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, frentes: ultima, fechou: "c" })).toEqual({ acao: "dono", frentes: [ultima[2]], fechaLote: true, cuidado: true, faltam: 0 });
  });

  it("a marca de fora: uma frente que leu de fora marca o retorno inteiro", () => {
    const prontas = [frente("a"), frente("b", { deFora: true })];
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "a" })).toMatchObject({ acao: "dono", cuidado: true });
    expect(decidirFecho({ ...base, frentes: [frente("a"), frente("b")], fechou: "a" })).toMatchObject({ acao: "dono", cuidado: false });
  });

  it("lote de colega: só quando todas acabaram, e avisar_a_cada_uma não vale (a entrega é uma por pedido)", () => {
    const meio = [frente("a"), frente("b", { estado: "rodando" })];
    expect(decidirFecho({ ...base, destino: "colega", frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, destino: "colega", avisarACadaUma: true, frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    const prontas = [frente("a"), frente("b", { deFora: true })];
    expect(decidirFecho({ ...base, destino: "colega", frentes: prontas, fechou: "b" })).toEqual({ acao: "colega", frentes: prontas });
  });

  it("lote já devolvido, frente que não acabou ou fora do lote: nada", () => {
    const prontas = [frente("a"), frente("b")];
    expect(decidirFecho({ ...base, devolvido: true, frentes: prontas, fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, frentes: [frente("a", { estado: "rodando" })], fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "z" })).toEqual({ acao: "nada" });
  });

  it("o dono parado pela pessoa (Parar do chat): o lote fecha com uma linha, quando a última para, sem acordar", () => {
    const meio = [frente("a", { estado: "parado" }), frente("b", { estado: "rodando" })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, donoParado: true, frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    const paradas = [frente("a", { estado: "parado" }), frente("b", { estado: "parado" })];
    expect(decidirFecho({ ...base, donoParado: true, frentes: paradas, fechou: "b" })).toEqual({ acao: "so_linha", frentes: paradas });
  });
});

describe("retorno do lote (ADR-099, I3): os textos", () => {
  it("a entrada do retorno: a instrução de responder numa mensagem só e o JSON com estado, motivo e cuidado", () => {
    const frentes = [frente("a", { resumo: { feito: "Corrigi o login", pr: 301, sha: "3f8bd4d", branch: "frente/login" } }), frente("b", { estado: "falhou", motivoInterrupcao: "erro_execucao", resumo: { feito: "Falhou", falta: "rever" }, deFora: true })];
    const e = entradaDoRetorno({ frentes, faltam: 0, total: 2 });
    expect(e).toContain("As 2 frentes que você abriu para este pedido terminaram.");
    expect(e).toContain(INSTRUCAO_DO_RETORNO);
    expect(e).toContain("As marcadas com cuidado leram conteúdo de fora");
    const json = JSON.parse(e.split("\n")[1]!) as Record<string, unknown>[];
    expect(json[0]).toEqual({ titulo: "Frente a", estado: "terminado", feito: "Corrigi o login", pr: 301, sha: "3f8bd4d", branch: "frente/login" });
    expect(json[1]).toMatchObject({ titulo: "Frente b", estado: "falhou", feito: "Falhou", falta: "rever", cuidado: true });
    expect(typeof json[1]!.motivo).toBe("string");
    // Sem frente de fora, nada de cuidado.
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 1 })).not.toContain("cuidado");
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 1 })).toContain("A frente que você abriu para este pedido terminou.");
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 2, total: 3 })).toContain('A frente "Frente a" deste pedido terminou; faltam 2.');
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 3 })).toContain("era a última");
  });

  it("o motivo legível: parada pela pessoa, a falha traduzida, nada para a que terminou", () => {
    expect(motivoDaFrente({ estado: "parado", motivoInterrupcao: "parado_pela_pessoa" })).toBe("parada pela pessoa");
    expect(motivoDaFrente({ estado: "falhou", motivoInterrupcao: null })).toBe("a frente falhou");
    expect(motivoDaFrente({ estado: "falhou", motivoInterrupcao: "maquina_sem_contato" })).not.toBe("maquina_sem_contato");
    expect(motivoDaFrente({ estado: "terminado", motivoInterrupcao: null })).toBeNull();
  });

  it("as linhas e a resposta ao colega", () => {
    expect(textoFrentesTerminadas([frente("a"), frente("b"), frente("c")])).toBe("3 frentes terminaram");
    expect(textoFrentesTerminadas([frente("a")])).toBe("A frente Frente a terminou");
    expect(textoFrentesTerminadas([frente("a", { estado: "parado" })])).toBe("A frente Frente a parou");
    expect(textoFrentesTerminadas([frente("a", { estado: "falhou" })])).toBe("A frente Frente a falhou");
    expect(textoPedidoRespondido("Ada")).toBe("Respondi ao pedido de Ada");
    expect(respostaAoColega([frente("a", { resumo: { feito: "Fiz.", pr: 7, branch: "frente/a", sha: "abcdef12345", falta: "deploy" } })])).toBe("Fiz. PR #7. Branch frente/a (abcdef1). Falta: deploy");
    expect(respostaAoColega([frente("a"), frente("b", { estado: "parado" })])).toBe("- Frente a: fiz a\n- Frente b: (não concluída: parada pela pessoa) fiz b");
  });
});

describe("retorno do lote (ADR-099, I9): a frente que caiu de vez", () => {
  const base = { destino: "dono" as const, avisarACadaUma: false, devolvido: false, donoParado: false };
  const caida = (id: string, quedas = 3) => frente(id, { estado: "falhou", motivoInterrupcao: "maquina_sem_contato", quedas, resumo: null });

  it("caiu de vez = falhou por um motivo de queda; outra falha não é queda", () => {
    expect(caiuDeVez(caida("a"))).toBe(true);
    expect(caiuDeVez(frente("a", { estado: "falhou", motivoInterrupcao: "erro_execucao" }))).toBe(false);
    expect(caiuDeVez(frente("a", { estado: "precisa_de_voce", motivoInterrupcao: "maquina_sem_contato" }))).toBe(false);
  });

  it("com outras frentes ainda rodando, volta sozinha e na hora (pergunta na hora); sendo a última, volta com todas", () => {
    const meio = [caida("a"), frente("b", { estado: "rodando" })];
    expect(decidirFecho({ ...base, frentes: meio, fechou: "a" })).toEqual({ acao: "dono", frentes: [meio[0]], fechaLote: false, cuidado: false, faltam: 1 });
    const prontas = [frente("a"), caida("b")];
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "b" })).toEqual({ acao: "dono", frentes: prontas, fechaLote: true, cuidado: false, faltam: 0 });
    // Lote de colega: continua uma entrega só, quando todas acabaram.
    expect(decidirFecho({ ...base, destino: "colega", frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
  });

  it("o retorno diz que caiu, quantas vezes, e manda perguntar à pessoa com opções", () => {
    expect(motivoDaFrente(caida("a"))).toMatch(/ \(caiu 3 vezes\)$/);
    expect(motivoDaFrente(caida("a", 1))).not.toContain("caiu");
    const e = entradaDoRetorno({ frentes: [caida("a")], faltam: 1, total: 2 });
    expect(e).toContain('A frente "Frente a" deste pedido caiu; falta 1.');
    expect(e).toContain(PERGUNTA_DA_QUEDA);
    expect(PERGUNTA_DA_QUEDA).toContain("pedir_a_pessoa");
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 1 })).not.toContain(PERGUNTA_DA_QUEDA);
    expect(respostaAoColega([caida("a")])).toMatch(/^\(não concluída: .+ \(caiu 3 vezes\)\)/);
  });
});

describe("NOD-282: recusa no despacho, aprovação vencida e o retorno complementar", () => {
  const base = { destino: "dono" as const, avisarACadaUma: false, devolvido: false, donoParado: false };
  const recusada = (id: string, motivoFalha: string) => frente(id, { estado: "falhou", motivoInterrupcao: "executor_indisponivel", motivoFalha, resumo: null });

  it("G4: sem login ou sem a IA, a frente volta sozinha na hora com a pergunta de reconexão", () => {
    const meio = [recusada("a", "nao_autenticado"), frente("b", { estado: "rodando" })];
    expect(recusouDeVez(meio[0]!)).toBe(true);
    expect(caiuDeVez(meio[0]!)).toBe(false);
    expect(decidirFecho({ ...base, frentes: meio, fechou: "a" })).toEqual({ acao: "dono", frentes: [meio[0]], fechaLote: false, cuidado: false, faltam: 1 });
    const e = entradaDoRetorno({ frentes: [meio[0]!], faltam: 1, total: 2 });
    expect(e).toContain('A frente "Frente a" deste pedido não rodou; falta 1.');
    expect(e).toContain(PERGUNTA_DA_RECONEXAO);
    expect(e).not.toContain(PERGUNTA_DA_QUEDA);
    for (const opcao of ["Já reconectei, tentar de novo", "Seguir sem essa parte", "Parar por aqui"]) expect(PERGUNTA_DA_RECONEXAO).toContain(opcao);
    expect(recusouDeVez(recusada("a", "motor_ausente"))).toBe(true);
  });

  it("G4: recusa de espera (cota no limite, sem conta) não volta sozinha", () => {
    for (const mf of ["limite_do_plano", "sem_conta"]) {
      const meio = [recusada("a", mf), frente("b", { estado: "rodando" })];
      expect(recusouDeVez(meio[0]!)).toBe(false);
      expect(decidirFecho({ ...base, frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    }
  });

  it("G5: aprovação vencida tem texto próprio; a pergunta mantém o de antes", () => {
    expect(motivoDaFrente({ estado: "falhou", motivoInterrupcao: "pergunta_vencida", vencidaTipo: "aprovacao" })).toBe("o pedido de aprovação venceu sem resposta");
    expect(motivoDaFrente({ estado: "falhou", motivoInterrupcao: "pergunta_vencida", vencidaTipo: "pergunta" })).toBe("a pergunta à pessoa venceu sem resposta");
    expect(motivoDaFrente({ estado: "falhou", motivoInterrupcao: "pergunta_vencida" })).toBe("a pergunta à pessoa venceu sem resposta");
  });

  it("G7: a entrada complementar fala só da frente que voltou e pede só o que mudou", () => {
    const e = entradaComplementar(frente("a", { resumo: { feito: "Agora deu certo" } }));
    expect(e).toContain('A frente "Frente a", que tinha ficado pendente, terminou agora.');
    expect(e).toContain("só o que mudou");
    const json = JSON.parse(e.split("\n")[1]!) as Record<string, unknown>[];
    expect(json).toEqual([{ titulo: "Frente a", estado: "terminado", feito: "Agora deu certo" }]);
    expect(entradaComplementar(frente("a", { deFora: true }))).toContain("cuidado");
  });
});

describe("a resposta na troca (chat limpo, PR 3): o texto entregue vai no pedido_respondido até o teto", () => {
  it("curta, igual (sem os espaços das pontas); longa, cortada no último espaço antes do teto, com reticências", () => {
    expect(respostaNaTroca("  Login revisado: ok  ")).toBe("Login revisado: ok");
    const exata = "a".repeat(RESPOSTA_NA_TROCA_MAX);
    expect(respostaNaTroca(exata)).toBe(exata);
    const longa = `${"palavra ".repeat(400)}fim`;
    const cortada = respostaNaTroca(longa);
    expect(cortada.length).toBeLessThanOrEqual(RESPOSTA_NA_TROCA_MAX);
    expect(cortada).toMatch(/palavra…$/);
    // Sem espaço perto do teto (um bloco só), corta no teto mesmo.
    const bloco = respostaNaTroca("x".repeat(RESPOSTA_NA_TROCA_MAX + 50));
    expect(bloco).toHaveLength(RESPOSTA_NA_TROCA_MAX);
    expect(bloco.endsWith("…")).toBe(true);
  });

  it("revisão do PR 3: o corte no teto não parte um emoji (o Postgres recusa a metade solta no jsonb); a quebra de linha também serve de corte", () => {
    const emojis = respostaNaTroca("🎉".repeat(RESPOSTA_NA_TROCA_MAX));
    expect(emojis.endsWith("🎉…")).toBe(true);
    expect(emojis.length).toBeLessThanOrEqual(RESPOSTA_NA_TROCA_MAX);
    expect(() => encodeURIComponent(emojis)).not.toThrow();
    const linhas = respostaNaTroca(`${"palavra\n".repeat(300)}fim`);
    expect(linhas.endsWith("palavra…")).toBe(true);
    expect(linhas.length).toBeLessThanOrEqual(RESPOSTA_NA_TROCA_MAX);
  });
});

describe("NOD-282 (G7): o retorno complementar", () => {
  it("resumoMudou: compara o conteúdo, não a ordem das chaves; o arquivado vazio conta como mudança", () => {
    expect(resumoMudou({ feito: "a", pr: 1 }, { pr: 1, feito: "a" })).toBe(false);
    expect(resumoMudou({ feito: "a" }, { feito: "b" })).toBe(true);
    expect(resumoMudou({}, { feito: "a" })).toBe(true);
    expect(resumoMudou({}, null)).toBe(false);
  });

  it("a resposta complementar ao colega diz que é complemento, com o verbo e o resumo da frente", () => {
    const texto = respostaComplementarAoColega(frente("x", { titulo: "Publicar", resumo: { feito: "Publiquei" } }));
    expect(texto).toMatch(/^Complemento: a frente "Publicar", que tinha ficado pendente, terminou agora\. /);
    expect(texto).toContain("Publiquei");
  });
});
