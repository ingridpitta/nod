import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lerVersao, sondar, sondarDetalhado } from "../../../src/adapters/executor/sonda.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";

/**
 * Sonda ADR-019 contra o binário falso (tests/fixtures/claude-falso.mjs): `--version` + turno
 * stream-json (medido em 2026-09-16: o `--output-format json` real NÃO traz apiKeySource; por isso os
 * knobs json do binário falso — NOD_FALSO_NAO_AUTENTICADO/API_KEY_SOURCE — não servem à sonda e os
 * cenários "deslogado" e "chave" são shims próprios abaixo). Shims de shell fixam o cenário: as
 * variáveis NOD_FALSO_* têm prefixo NOD_ e a denylist do executor as apaga — o que o 1º teste prova.
 */
const FALSO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "claude-falso.mjs");

async function shim(dir: string, nome: string, envDoCenario: Record<string, string> = {}): Promise<string> {
  const exports = Object.entries(envDoCenario)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
  const sh = join(dir, nome);
  await writeFile(sh, `#!/bin/sh\n${exports}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FALSO)} "$@"\n`);
  await chmod(sh, 0o755);
  return sh;
}

/** CLI de mentira que responde --version/--help e, no turno, faz o que `corpo` manda (sh). */
async function shimProprio(dir: string, nome: string, corpo: string): Promise<string> {
  const sh = join(dir, nome);
  await writeFile(sh, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.290 (Claude Code)"; exit 0; fi\nif [ "$1" = "--help" ]; then echo "  --strict-mcp-config"; exit 0; fi\n${corpo}\n`);
  await chmod(sh, 0o755);
  return sh;
}

const INIT = (apiKeySource: string) => JSON.stringify({ type: "system", subtype: "init", session_id: "s", tools: [], model: "m", claude_code_version: "2.1.290", apiKeySource });
const RESULT = JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s", result: "OK", total_cost_usd: 0.003, num_turns: 1, permission_denials: [] });

const MODELO = "claude-haiku-4-5-20251001";
/**
 * NOD-198: o prazo da sonda vem de `prazoSondaDoTeste()` (NOD_PRAZO_SONDA_MS continua mandando, NOD-178). Antes, sem a
 * variável, valia o padrão de 10 s do código e, sob carga, o `--version` do falso (um node) estourava: `ausente` com
 * sonda_lenta em 9 testes por rodada. Nenhum teste deste arquivo mede o prazo da sonda (isso é a sonda-lenta).
 */
const PRAZO_SONDA_MS = prazoSondaDoTeste();

/**
 * definido em 2026-09-16: 30 s por teste — cada um spawna 3–4 processos node (shim + binário falso +
 * --version/--help) e o padrão de 5 s do vitest estourava de forma intermitente sob o projeto
 * integration inteiro. medido em 2026-09-16: até 6,4 s num teste do claude-cli-falso e 4,0 s num da
 * sonda-falsa com o projeto integration completo em paralelo (8 execuções); 1–3 s rodando só a lane.
 */
const TIMEOUT_MS = PRAZO_TESTE_FALSO_MS; // NOD-198: era 30 s; a medida sob carga está em prazo-falso.ts

describe("sonda (ADR-019) contra o binário falso", { timeout: TIMEOUT_MS }, () => {
  let dir: string;
  let env: Record<string, string>;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-sonda-falsa-"));
    env = { HOME: dir, PATH: process.env.PATH ?? "", ANTHROPIC_API_KEY: "sk-herdada", CLAUDECODE: "1", NOD_FALSO_NAO_AUTENTICADO: "1" };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("binário presente e logado → pronto com a versão lida do --version; a variável NOD_FALSO_* do env NÃO chega ao filho (denylist)", async () => {
    const bin = await shim(dir, "claude-pronto");
    const s = await sondarDetalhado(bin, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 123 });
    // env tinha NOD_FALSO_NAO_AUTENTICADO=1: se tivesse chegado ao filho, seria nao_autenticado
    expect(s.inventario).toEqual({ estado: "pronto", versao: "2.1.290", em: 123 });
    expect(s.binario).toBe(bin);
    expect("email" in s.inventario).toBe(false);
  });

  it("binário que não existe → ausente (bin explícito ou fora do PATH)", async () => {
    expect(await sondar("/nao/existe/claude", env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 1 })).toEqual({ estado: "ausente", motivo: "binario_nao_encontrado", em: 1 });
    // home explícito: sem ele, ~/.local/bin do PATH aumentado seria o da pessoa (onde o claude real mora)
    expect(await sondar(undefined, { ...env, PATH: "/nao/existe" }, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 2, home: dir })).toEqual({ estado: "ausente", motivo: "claude_fora_do_path", em: 2 });
  });

  it("CLI instalado mas deslogado (turno sai 1) → nao_autenticado com a versão e um motivo por código de saída, nunca pelo texto do stderr", async () => {
    const bin = await shimProprio(dir, "claude-deslogado", 'echo "Not logged in · Please run /login" >&2\nexit 1');
    const inv = await sondar(bin, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 3 });
    expect(inv).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_exit_1", versao: "2.1.290", em: 3 });
  });

  it("init.apiKeySource ≠ none (cobraria na chave, não na assinatura) → nao_autenticado com motivo; init sem o campo é fail-closed", async () => {
    const chave = await shimProprio(dir, "claude-chave", `echo '${INIT("apiKeyHelper")}'\necho '${RESULT}'\nexit 0`);
    expect(await sondar(chave, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 4 })).toEqual({ estado: "nao_autenticado", motivo: "api_key_source_apiKeyHelper", versao: "2.1.290", em: 4 });

    const semCampo = await shimProprio(dir, "claude-sem-campo", `echo '${JSON.stringify({ type: "system", subtype: "init", session_id: "s" })}'\necho '${RESULT}'\nexit 0`);
    expect((await sondar(semCampo, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS })).estado).toBe("nao_autenticado");
    expect(await sondar(semCampo, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 41 })).toEqual({ estado: "nao_autenticado", motivo: "api_key_source_desconhecido", versao: "2.1.290", em: 41 });
  });

  it("turno que sai 0 sem init, ou sem result, ou com result de erro → nao_autenticado (nunca 'pronto' por omissão)", async () => {
    const semInit = await shimProprio(dir, "claude-sem-init", `echo '${RESULT}'\nexit 0`);
    expect(await sondar(semInit, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 5 })).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_sem_init", versao: "2.1.290", em: 5 });
    const semResult = await shimProprio(dir, "claude-sem-result", `echo '${INIT("none")}'\nexit 0`);
    expect(await sondar(semResult, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 6 })).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_sem_result", versao: "2.1.290", em: 6 });
    const comErro = await shimProprio(dir, "claude-erro", `echo '${INIT("none")}'\necho '${JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, session_id: "s" })}'\nexit 0`);
    expect(await sondar(comErro, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 7 })).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_com_erro", versao: "2.1.290", em: 7 });
  });

  it("binário que existe mas não responde --version (sai 2) → ausente", async () => {
    const quebrado = join(dir, "claude-quebrado");
    await writeFile(quebrado, "#!/bin/sh\nexit 2\n");
    await chmod(quebrado, 0o755);
    expect(await sondar(quebrado, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 5 })).toEqual({ estado: "ausente", motivo: "version_exit_2", em: 5 });
    expect(await lerVersao(quebrado, env, PRAZO_SONDA_MS)).toEqual({ erro: "version_exit_2" });
  });

  it("--version sem x.y.z → ausente versao_ilegivel; turno que não responde no tempo → nao_autenticado sem_resposta", async () => {
    const ilegivel = join(dir, "claude-ilegivel");
    await writeFile(ilegivel, "#!/bin/sh\necho versao-desconhecida\n");
    await chmod(ilegivel, 0o755);
    expect((await sondar(ilegivel, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS })).estado).toBe("ausente");
    expect(await sondar(ilegivel, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 6 })).toEqual({ estado: "ausente", motivo: "versao_ilegivel", em: 6 });

    const lento = join(dir, "claude-lento");
    await writeFile(lento, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.290 (Claude Code)"; exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexec sleep 5\n');
    await chmod(lento, 0o755);
    const inv = await sondar(lento, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 8, timeoutTurnoMs: 300 });
    expect(inv).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_sem_resposta", versao: "2.1.290", em: 8 });
  });

  /**
   * definido em 2026-10-05 (medido em produção nesse dia): conta LOGADA de uma organização que desativou o uso por
   * assinatura. O login conferia e todo turno voltava com a frase abaixo no lugar da resposta.
   */
  const RECUSA = "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access";
  const resultCom = (texto: string, erro = false) => JSON.stringify({ type: "result", subtype: erro ? "error_during_execution" : "success", is_error: erro, session_id: "s", result: texto, total_cost_usd: 0, num_turns: 1, permission_denials: [] });

  it("a recusa da organização reprova a IA com a causa, venha num result 'de sucesso', num de erro ou só no texto do assistente", async () => {
    const esperado = { estado: "nao_autenticado", motivo: "conta_sem_acesso", causa: "conta_sem_acesso", versao: "2.1.290", em: 9 };
    const comoSucesso = await shimProprio(dir, "claude-recusa-sucesso", `echo '${INIT("none")}'\necho '${resultCom(RECUSA)}'\nexit 0`);
    const s = await sondarDetalhado(comoSucesso, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 9 });
    expect(s.inventario).toEqual(esperado);
    expect(s.resposta).toBeNull();

    const comoErro = await shimProprio(dir, "claude-recusa-erro", `echo '${INIT("none")}'\necho '${resultCom(RECUSA, true)}'\nexit 1`);
    expect(await sondar(comoErro, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 9 })).toEqual(esperado);

    const soNoTexto = await shimProprio(dir, "claude-recusa-texto", `echo '${INIT("none")}'\necho '${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: RECUSA }] }, session_id: "s" })}'\nexit 1`);
    expect(await sondar(soNoTexto, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 9 })).toEqual(esperado);
  });

  it("com o login já conferido, um turno que falha por outro motivo é 'teste_falhou' (não 'falta entrar'); sem isso, nenhuma causa", async () => {
    const quebrou = await shimProprio(dir, "claude-quebrou", 'echo "API Error: 529" >&2\nexit 1');
    expect(await sondar(quebrou, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 10, loginConferido: true })).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_exit_1", causa: "teste_falhou", versao: "2.1.290", em: 10 });
    expect(await sondar(quebrou, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 10 })).toEqual({ estado: "nao_autenticado", motivo: "turno_de_sonda_exit_1", versao: "2.1.290", em: 10 });
  });

  it("o teste do onboarding: a pergunta vai inteira num argumento só e a resposta volta pronta para a tela", async () => {
    const visto = join(dir, "pergunta-vista.txt");
    const bin = await shimProprio(dir, "claude-oi", `printf '%s' "$2" > ${JSON.stringify(visto)}\necho '${INIT("none")}'\necho '${resultCom("“Oi, Marcelo. Tudo pronto por aqui.”\\nsegunda linha")}'\nexit 0`);
    const pergunta = "Diga oi para Marcelo em uma frase curta, em português. Só a frase.";
    const s = await sondarDetalhado(bin, env, MODELO, { timeoutVersaoMs: PRAZO_SONDA_MS, relogio: () => 11, pergunta, loginConferido: true });
    expect(s.inventario).toEqual({ estado: "pronto", versao: "2.1.290", em: 11 });
    expect(s.resposta).toBe("Oi, Marcelo. Tudo pronto por aqui.");
    expect(await readFile(visto, "utf8")).toBe(pergunta);
  });
});
