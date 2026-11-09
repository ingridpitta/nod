import { expect, it } from "vitest";
import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { VOZES_NOD } from "../../src/contracts/vozes.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { disponibilidadeLigacao, vozDoAgente, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { prepararLeitura, type ContextoLeitura } from "../../src/use-cases/ouvir-mensagem.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-180: ouvir uma resposta. `prepararLeitura` confere sob RLS (mensagem do bot, pronta, de texto, na conversa própria
 * de um bot próprio, com o aviso da voz aceito) e devolve os trechos, a voz e a velocidade do bot. A disponibilidade da
 * ligação ganha `ouvir`, que não depende do Mac nem da IA.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const LIGADA: ContextoLeitura = { habilitada: true, permitido: true, vozDisponivel: true };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function cenario(trx: Trx, opcoes: { dono?: "pessoa" | "empresa"; consentir?: boolean } = {}) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina", dono: opcoes.dono });
  if (opcoes.consentir !== false) await repos.ligacoes.consentir(VERSAO_CONSENTIMENTO_VOZ, Date.now());
  const { deps } = depsSobre(trx, MARLON);
  const resposta = async (texto: string, extra: { parcial?: boolean; kind?: "texto" | "sistema" } = {}) =>
    (await repos.mensagens.criar({ conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: extra.kind ?? "texto", assunto: "sistema.generico", texto, confianca: "confiavel", parcial: extra.parcial }))?.id ?? "";
  return { repos, deps, agenteId, conversaId, resposta };
}

describeIntegracao("ouvir uma resposta (NOD-180): prepararLeitura e disponibilidade.ouvir", () => {
  it("resposta pronta do bot → trechos, voz derivada do bot e velocidade 1, caracteres = soma dos trechos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId, resposta } = await cenario(trx);
      const id = await resposta("Pronto, abri o [PR #157](https://github.com/x/y/pull/157).\n\n```ts\nconst a = 1;\n```");
      const r = (await prepararLeitura(deps, { mensagemId: id, contexto: LIGADA })).data;
      expect(r.trechos).toEqual(["Pronto, abri o PR #157.", "Aqui tem um bloco de código em TypeScript."]);
      expect(r).toMatchObject({ agenteId, voz: vozDoAgente(agenteId, null), velocidade: 1 });
      expect(r.caracteres).toBe(r.trechos.join("").length);
    });
  });

  it("a voz e a velocidade escolhidas para o bot valem na leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, agenteId, resposta } = await cenario(trx);
      const voz = VOZES_NOD.find((v) => v.id !== vozDoAgente(agenteId, null))?.id ?? "";
      await repos.agentes.definirVoz(agenteId, { voz, velocidade: 1.25 });
      const id = await resposta("Tudo certo.");
      const r = (await prepararLeitura(deps, { mensagemId: id, contexto: LIGADA })).data;
      expect(r).toMatchObject({ voz, velocidade: 1.25 });
    });
  });

  it("chave desligada, voz fechada para a conta ou fora do ar recusam antes de ler a mensagem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = await cenario(trx);
      const inexistente = "00000000-0000-4000-8000-000000000000";
      await esperarErro(() => prepararLeitura(deps, { mensagemId: inexistente, contexto: { ...LIGADA, habilitada: false } }), "nao_permitido");
      await esperarErro(() => prepararLeitura(deps, { mensagemId: inexistente, contexto: { ...LIGADA, permitido: false } }), "nao_permitido");
      await esperarErro(() => prepararLeitura(deps, { mensagemId: inexistente, contexto: { ...LIGADA, vozDisponivel: false } }), "conector_indisponivel");
      await esperarErro(() => prepararLeitura(deps, { mensagemId: inexistente, contexto: LIGADA }), "nao_encontrado");
    });
  });

  it("resposta do bot de outra pessoa → nao_encontrado (o RLS esconde)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { resposta } = await cenario(trx);
      const id = await resposta("Só do Marlon.");
      await vincularEscopo(trx, ANA);
      const daAna = await agenteComConversa(trx, ANA, { nome: "Tuca" });
      await daAna.repos.ligacoes.consentir(VERSAO_CONSENTIMENTO_VOZ, Date.now());
      await esperarErro(() => prepararLeitura(depsSobre(trx, ANA).deps, { mensagemId: id, contexto: LIGADA }), "nao_encontrado");
    });
  });

  it("mensagem da pessoa, de sistema, parcial ou sem nada para falar → entrada_invalida", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conversaId, resposta } = await cenario(trx);
      const daPessoa = (await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "oi", confianca: "confiavel" }))?.id ?? "";
      for (const id of [daPessoa, await resposta("Linha de sistema.", { kind: "sistema" }), await resposta("Meio caminho", { parcial: true }), await resposta("   ")]) {
        await esperarErro(() => prepararLeitura(deps, { mensagemId: id, contexto: LIGADA }), "entrada_invalida");
      }
    });
  });

  it("sem o aviso da voz aceito → estado_invalido (nada vai ao Google)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, resposta } = await cenario(trx, { consentir: false });
      await esperarErro(async () => prepararLeitura(deps, { mensagemId: await resposta("Oi."), contexto: LIGADA }), "estado_invalido");
    });
  });

  it("bot da equipe e conversa de sala → nao_permitido", async () => {
    await withRollback(MARLON, async (trx) => {
      const daEquipe = await cenario(trx, { dono: "empresa" });
      await esperarErro(async () => prepararLeitura(daEquipe.deps, { mensagemId: await daEquipe.resposta("Oi."), contexto: LIGADA }), "nao_permitido");

      const a = await cenario(trx);
      const b = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const s = await criarSala(a.deps, { nome: "revisão", agenteIds: [a.agenteId, b.agenteId] });
      const naSala = (await a.repos.mensagens.criar({ conversaId: s.data.conversa.id, autoria: autoriaAgente(a.agenteId, PESSOA_MARLON), kind: "texto", texto: "Oi da sala.", confianca: "confiavel" }))?.id ?? "";
      await esperarErro(() => prepararLeitura(a.deps, { mensagemId: naSala, contexto: LIGADA }), "nao_permitido");
    });
  });

  it("disponibilidade: ouvir vale mesmo sem Mac e sem IA; cai com a chave desligada, sem permissão, voz fora do ar ou bot da equipe", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, agenteId } = await cenario(trx);
      const contexto: ContextoLigacao = {
        permitido: true, habilitada: true, maquinaComLigacao: false, iaPronta: false, codexSemVoz: false, drenando: false, vozDisponivel: true,
        vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso", leituraHabilitada: true,
      };
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto })).data).toMatchObject({ disponivel: false, motivo: "sem_mac", ouvir: true });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, leituraHabilitada: false } })).data).toMatchObject({ ouvir: false });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, leituraHabilitada: undefined } })).data).toMatchObject({ ouvir: false });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, permitido: false } })).data).toMatchObject({ ouvir: false });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, maquinaComLigacao: true } })).data).toMatchObject({ disponivel: false, motivo: "sem_ia", ouvir: true });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, habilitada: false } })).data).toMatchObject({ ouvir: false });
      expect((await disponibilidadeLigacao(deps, { agenteId, contexto: { ...contexto, vozDisponivel: false } })).data).toMatchObject({ ouvir: false });
      const daEquipe = await cenario(trx, { dono: "empresa" });
      expect((await disponibilidadeLigacao(deps, { agenteId: daEquipe.agenteId, contexto })).data).toMatchObject({ ouvir: false });
    });
  });
});
