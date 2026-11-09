import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { FRASE_ARQUIVO_DE_CREDENCIAL, FRASE_MCP_COM_CREDENCIAL, NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { autorizarComando, comandoRodaSemCard } from "../../src/use-cases/autorizar-comando.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * PR 6 dos modos de aprovação ("Ignorar todas as aprovações" de verdade; ADR-115, emendas da ADR-055 §3 e da ADR-059), no
 * Postgres. O hook novo manda ao servidor o arquivo de credencial que antes negava sozinho; o servidor decide pelo modo:
 * manual nega com a frase de sempre, automático vira cartão (sem revisor), total roda e registra em `acoes_pelo_modo`.
 * O comando que toca credencial, que no total virava cartão, passa a rodar e registrar também.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
const AWS = "/Users/m/.aws/config";

async function cenario(trx: Trx, modo: ModoAprovacao, extra: Partial<PlanoTurno> = {}) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  if (modo !== "manual") await mudarModoAprovacao(deps, { agenteId, modo, confirmado: true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "publica a imagem", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano: PlanoTurno = {
    tenantId: TENANT_PADRAO, turnoId: turno.id, agenteId, conversaId, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok",
    expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL, NATIVA_MCP_DA_PESSOA, "apply_patch", "view_image"], modoTurno: "conversa", ...extra,
  };
  const credencial = (caminho: string, ferramenta = "Read") => autorizarComando(deps, { plano, credencial: caminho, ferramenta });
  const comando = (texto: string) => autorizarComando(deps, { plano, comando: texto });
  return { repos, deps, plano, credencial, comando };
}

describeIntegracao("Ignorar todas as aprovações de verdade (PR 6)", () => {
  it("manual: o arquivo de credencial continua negado, com a frase de sempre (ler, gravar e o MCP); nada é registrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "manual");
      expect((await c.credencial(AWS)).data).toEqual({ negar: FRASE_ARQUIVO_DE_CREDENCIAL });
      expect((await c.credencial("/Users/m/.ssh/config", "Write")).data).toEqual({ negar: FRASE_ARQUIVO_DE_CREDENCIAL });
      expect((await c.credencial("/Users/m/.ssh/config", "apply_patch")).data).toEqual({ negar: FRASE_ARQUIVO_DE_CREDENCIAL });
      expect((await c.credencial('fs: read {"path":"~/.ssh/id_ed25519"}', NATIVA_MCP_DA_PESSOA)).data).toEqual({ negar: FRASE_MCP_COM_CREDENCIAL });
      // O comando que toca credencial, no manual, continua o cartão de sempre.
      expect("aguardar" in (await c.comando("gh auth token")).data).toBe(true);
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toEqual([]);
    });
  });

  it("automático: o arquivo de credencial vira cartão (sem revisor); aprovado, a segunda consulta passa; negado, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "automatico");
      const r = await c.credencial(AWS);
      if (!("aguardar" in r.data)) throw new Error("esperava cartão");
      expect(r.events?.map((e) => e.kind)).toEqual(["decisao_criada"]);
      expect((await c.repos.decisoes.buscar(r.data.aguardar))).toMatchObject({ estado: "pendente", frase: "Ze quer ler um arquivo de credencial do seu Mac" });
      expect(await c.repos.itensAprovacao.listar(r.data.aguardar)).toMatchObject([{ textoOriginal: `Ler ${AWS}`, destino: { conector: "terminal", argumentos: { arquivo: AWS } }, motivoManual: "toca_credencial" }]);
      await decidir(c.deps, { decisaoId: r.data.aguardar });
      expect((await c.credencial(AWS)).data).toEqual({ permitir: true, porque: "aprovado" });
      // Outro arquivo de credencial pede de novo; a gravação do mesmo caminho também (é outro texto).
      expect("aguardar" in (await c.credencial("/Users/m/.aws/credentials")).data).toBe(true);
      const grava = await c.credencial(AWS, "Write");
      if (!("aguardar" in grava.data)) throw new Error("esperava cartão");
      expect((await c.repos.decisoes.buscar(grava.data.aguardar))?.frase).toBe("Ze quer mudar um arquivo de credencial do seu Mac");
      const [item] = await c.repos.itensAprovacao.listar(grava.data.aguardar);
      await decidir(c.deps, { decisaoId: grava.data.aguardar, itens: [{ id: item?.id ?? "", selecionado: false }] });
      expect("aguardar" in (await c.credencial(AWS, "Write")).data).toBe(true);
      // O Automático não registra nada sem revisor.
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toEqual([]);
    });
  });

  it("total: lê, grava e usa a credencial sem cartão, e cada uma fica em acoes_pelo_modo (veredito nulo, sem decisão)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      expect((await c.credencial(AWS)).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await c.credencial("/Users/m/.ssh/config", "Edit")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await c.credencial('fs: read {"path":"~/.netrc"}', NATIVA_MCP_DA_PESSOA)).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await c.comando("gh auth token | docker login ghcr.io -u marlon --password-stdin")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toMatchObject([
        { modo: "total", tipo: "leitura_credencial", gatilho: "credencial", resumo: `Ler ${AWS}`, veredito: null, decisaoId: null },
        { modo: "total", tipo: "arquivo", gatilho: "credencial", resumo: "Gravar /Users/m/.ssh/config" },
        { modo: "total", tipo: "mcp", gatilho: "credencial", resumo: 'fs: read {"path":"~/.netrc"}' },
        { modo: "total", tipo: "comando", gatilho: "credencial", resumo: "gh auth token | docker login ghcr.io -u marlon --password-stdin" },
      ]);
    });
  });

  it("total: o que o manual pediria também é registrado, com o gatilho — arriscado (com o risco), fora da pasta e comum; a leitura não", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      expect((await c.comando("git status")).data).toEqual({ permitir: true, porque: "leitura" });
      expect((await c.comando("git push --force origin staging")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await c.comando("npm install")).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await autorizarComando(c.deps, { plano: c.plano, arquivo: "/Users/m/code/app/.env.example" })).data).toEqual({ permitir: true, porque: "modo_total" });
      expect((await autorizarComando(c.deps, { plano: c.plano, mcp: "linear: create_issue {}" })).data).toEqual({ permitir: true, porque: "modo_total" });
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toMatchObject([
        { tipo: "comando", gatilho: "arriscado", risco: "reescreve ou apaga no remoto", resumo: "git push --force origin staging" },
        { tipo: "comando", gatilho: "comum", risco: null, resumo: "npm install" },
        { tipo: "arquivo", gatilho: "fora_da_pasta", resumo: "Gravar /Users/m/code/app/.env.example" },
        { tipo: "mcp", gatilho: "comum", resumo: "linear: create_issue {}" },
      ]);
    });
  });

  it("total: o segredo no comando é redigido no registro", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      await c.comando("curl -H 'Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz' https://api.github.com/user/repos -d '{}'");
      const [a] = await c.repos.acoesPeloModo.doTurno(c.plano.turnoId);
      expect(a?.resumo).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("a chave do próprio nod continua pedindo a pessoa até no total (arquivo e comando)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      const r = await c.credencial("/home/nod/.config/nod-motor/conexao.json");
      if (!("aguardar" in r.data)) throw new Error("esperava cartão");
      expect((await c.repos.itensAprovacao.listar(r.data.aguardar))[0]?.motivoManual).toBe("toca_credencial");
      expect("aguardar" in (await c.comando("cat ~/.config/nod-motor/conexao.json")).data).toBe(true);
      // Revisão do PR 6: o hook manda todos os caminhos de credencial da chamada; o patch que grava a chave SSH e a do nod
      // juntas não passa no total por causa da primeira.
      const patch = await c.credencial("/Users/m/.ssh/config /Users/m/.config/nod-motor/conexao.json", "apply_patch");
      if (!("aguardar" in patch.data)) throw new Error("esperava cartão");
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toEqual([]);
    });
  });

  it("a nativa que mandou a credencial tem de estar no plano do turno; caminho vazio é entrada inválida", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total", { nativas: ["Bash"] });
      await expect(c.credencial(AWS)).rejects.toMatchObject({ codigo: "nao_permitido" });
      const d = await cenario(trx, "total");
      await expect(d.credencial("  ")).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("a espera (esperar_comando) não roda comando com credencial em modo nenhum, como antes; o que ela roda pelo total é registrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "total");
      expect(await comandoRodaSemCard(c.deps, c.plano, "gh auth token")).toBeNull();
      const leitura = await comandoRodaSemCard(c.deps, c.plano, "gh run watch 123");
      expect(leitura).toMatchObject({ permitir: true, porque: "leitura" });
      await leitura?.registrar();
      const total = await comandoRodaSemCard(c.deps, c.plano, "npm install left-pad");
      expect(total).toMatchObject({ permitir: true, porque: "modo_total" });
      // Revisão do PR 6: só registra quando quem chama confirma que a espera foi criada (`registrar`).
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toEqual([]);
      await total?.registrar();
      expect(await c.repos.acoesPeloModo.doTurno(c.plano.turnoId)).toMatchObject([{ tipo: "comando", gatilho: "comum", resumo: "npm install left-pad" }]);
    });
  });
});
