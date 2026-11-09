import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { argumentosComTextoFinal, decidir } from "../../../src/use-cases/decidir.ts";
import { JUSTIFICATIVA_SENSIVEL } from "../../../src/domain/aprovacao-item.ts";
import { pedirAprovacao } from "../../../src/use-cases/pedir-aprovacao.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { depsFalsos, type OpcoesDepsFalsos } from "./deps-l5.ts";

const destino = { conector: "email", ferramenta: "enviar", argumentos: { texto: "corpo" } };

async function cenarioComDecisao(opcoes: OpcoesDepsFalsos = {}, entradaAnexos: string[] = []) {
  const { deps, banco, chamadas } = depsFalsos(opcoes);
  banco.pessoas.push({ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const email = await deps.repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: 1 });
  await deps.repos.concessoes.conceder({ agenteId: agente?.id ?? "", conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: "m" });
  await deps.repos.conectores.criar({ nome: "CRM", slug: "crm", transporte: "stdio", comando: "node", declaracao: "toca" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: 9e12, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001", entradaAnexos });
  const pedido = await pedirAprovacao(deps, {
    turnoId: turno?.id ?? "",
    agenteId: agente?.id ?? "",
    conversaId: conversa?.id ?? "",
    resumo: "enviar 4 emails",
    itens: [
      { texto: "ana", destino: { ...destino, argumentos: { texto: "ana" } } },
      { texto: "bia (do CRM)", destino: { ...destino, argumentos: { texto: "bia" } }, origem_conector: "crm" },
      { texto: "caio", destino: { ...destino, argumentos: { texto: "caio" } } },
      { texto: "dani (do CRM)", destino: { ...destino, argumentos: { texto: "dani" } }, origem_conector: "crm" },
    ],
  });
  if (pedido.data.estado !== "pendente") throw new Error("esperava pendente");
  // A classificação por origem está desligada (ADR-002, refinamento 2026-09-21), então nenhum item
  // nasce sensível. O caminho da PESSOA decidindo continua tratando item sensível de forma própria
  // — desmarcado vira `sensivel_nao_aprovado`, não `retirado_pela_pessoa` —, e é isso que este
  // cenário exercita: bia e dani são marcadas à mão, como se a classificação estivesse ligada.
  const criados = await deps.repos.itensAprovacao.listar(pedido.data.decisao_id);
  for (const alvo of [criados[1], criados[3]]) {
    if (alvo) Object.assign(alvo, { origemSensivel: true, selecionado: false, justificativa: JUSTIFICATIVA_SENSIVEL });
  }
  const itens = await deps.repos.itensAprovacao.listar(pedido.data.decisao_id);
  return { deps: deps as Deps, banco, chamadas, decisaoId: pedido.data.decisao_id, itens, turnoId: turno?.id ?? "", conectorId: email?.id ?? "" };
}

describe("decidir (E4.1/E4.3/E4.5): aprovação em lista com execução parcial", () => {
  it("4 itens, pessoa marca 2 (um deles sensível) → exatamente 2 chamadas no conector, desfechos certos, mensagem resultado_aprovacao e turno de retomada", async () => {
    const c = await cenarioComDecisao();
    const [ana, bia, caio, dani] = c.itens;
    const r = await decidir(c.deps, {
      decisaoId: c.decisaoId,
      itens: [
        { id: bia?.id ?? "", selecionado: true },
        { id: caio?.id ?? "", selecionado: false },
      ],
    });
    expect(c.chamadas).toHaveLength(2);
    expect(c.chamadas.map((x) => [x.conectorId, x.tool, x.args])).toEqual([
      [c.conectorId, "enviar", { texto: "ana" }],
      [c.conectorId, "enviar", { texto: "bia" }],
    ]);
    const porId = new Map(r.data.itens.map((i) => [i.id, i]));
    expect(porId.get(ana?.id ?? "")?.desfecho).toBe("executado");
    expect(porId.get(bia?.id ?? "")).toMatchObject({ desfecho: "executado", selecionado: true, marcadoPor: PESSOA_MARLON, origemSensivel: true });
    expect(porId.get(bia?.id ?? "")?.marcadoEm).not.toBeNull();
    expect(porId.get(caio?.id ?? "")?.desfecho).toBe("retirado_pela_pessoa");
    expect(porId.get(dani?.id ?? "")?.desfecho).toBe("sensivel_nao_aprovado");
    expect(r.data.decisao.estado).toBe("decidida");
    expect(r.data.decisao.desfecho).toMatchObject({ tipo: "decidida", por: PESSOA_MARLON });

    const mensagem = c.banco.mensagens.find((m) => m.kind === "resultado_aprovacao");
    expect(mensagem?.texto).toBe("Marlon aprovou 2 de 4; não enviado: caio (retirado pela pessoa); dani (do CRM) (sensível, não aprovado).");
    expect(mensagem?.payload).toMatchObject({ kind: "resultado_aprovacao", decisaoId: c.decisaoId });
    expect(mensagem?.id).toBe(r.data.mensagemId);

    const retomada = c.banco.turnos.find((t) => t.origem === "retomada");
    expect(retomada?.id).toBe(r.data.turnoRetomadaId);
    expect(retomada?.retomaTurnoId).toBe(c.turnoId);
    expect(retomada?.entradaTexto).toContain("item 3 (email.enviar): retirado_pela_pessoa");
    expect(retomada?.entradaTexto).toContain("nada foi reenviado");
    expect(r.events?.map((e) => e.kind)).toEqual(["decisao_decidida", "turno_criado", "mensagem_criada"]);
  });

  it("decidir duas vezes: a segunda é estado_invalido e não executa nada de novo", async () => {
    const c = await cenarioComDecisao();
    await decidir(c.deps, { decisaoId: c.decisaoId, itens: [] });
    expect(c.chamadas).toHaveLength(2);
    await expect(decidir(c.deps, { decisaoId: c.decisaoId, itens: [] })).rejects.toMatchObject({ codigo: "estado_invalido" });
    expect(c.chamadas).toHaveLength(2);
  });

  it("conector que falha ou devolve isError → falhou_na_execucao, nunca 'enviado' (E4.5)", async () => {
    const c = await cenarioComDecisao({
      responder: (x) => {
        if (x.args.texto === "ana") throw new Error("conector fora");
        return { conteudo: "erro do outro lado", isError: true };
      },
    });
    const r = await decidir(c.deps, { decisaoId: c.decisaoId, itens: [] });
    const desfechos = r.data.itens.map((i) => i.desfecho);
    expect(desfechos).toEqual(["falhou_na_execucao", "sensivel_nao_aprovado", "falhou_na_execucao", "sensivel_nao_aprovado"]);
    expect(c.banco.mensagens.find((m) => m.kind === "resultado_aprovacao")?.texto).toContain("Marlon aprovou 0 de 4; não enviado: ana (falhou na execução)");
  });

  it("texto editado antes de aprovar vai para a ação e fica registrado com quem editou (E4.3)", async () => {
    const c = await cenarioComDecisao();
    const [ana] = c.itens;
    const r = await decidir(c.deps, { decisaoId: c.decisaoId, itens: [{ id: ana?.id ?? "", selecionado: true, textoFinal: "ana editada" }] });
    expect(c.chamadas[0]?.args).toEqual({ texto: "ana editada" });
    const item = r.data.itens.find((i) => i.id === ana?.id);
    expect(item).toMatchObject({ textoOriginal: "ana", textoFinal: "ana editada", editadoPor: PESSOA_MARLON, desfecho: "executado" });
    expect(argumentosComTextoFinal({ ...item!, destino: { conector: "x", ferramenta: "y", argumentos: { a: "ana", b: "outro" } } })).toEqual({ a: "ana editada", b: "outro" });
  });

  it("item de outra decisão, decisão inexistente e tipo não coberto são recusados com código fechado", async () => {
    const c = await cenarioComDecisao();
    await expect(decidir(c.deps, { decisaoId: "nao-existe", itens: [] })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(decidir(c.deps, { decisaoId: c.decisaoId, itens: [{ id: "item-alheio", selecionado: true }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    const perfil = await c.deps.repos.decisoes.criar({ tipo: "perfil", agenteId: c.itens[0]?.decisaoId ?? "a", conversaId: "c", prazoDecisaoEm: 9e12, frase: "x" });
    await expect(decidir(c.deps, { decisaoId: perfil?.id ?? "" })).rejects.toBeInstanceOf(ErroDeDominio);
    expect(c.chamadas).toHaveLength(0);
  });
});

describe("a retomada da aprovação leva o anexo da fala (NOD-285)", () => {
  it("a retomada nasce com o mesmo entradaAnexos e diz que os arquivos seguem anexados, nunca 'nada foi reenviado'", async () => {
    const anexos = ["5b0c7c39-6c1e-4f43-9a8e-0f6a2d1e9b01", "5b0c7c39-6c1e-4f43-9a8e-0f6a2d1e9b02"];
    const c = await cenarioComDecisao({}, anexos);
    await decidir(c.deps, { decisaoId: c.decisaoId, itens: [] });
    const retomada = c.banco.turnos.find((t) => t.origem === "retomada");
    expect(retomada?.entradaAnexos).toEqual(anexos);
    expect(retomada?.entradaTexto).toContain("os arquivos da fala de origem seguem anexados");
    expect(retomada?.entradaTexto).not.toContain("nada foi reenviado");
  });
});
