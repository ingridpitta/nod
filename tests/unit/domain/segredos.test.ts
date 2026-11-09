import { describe, expect, it } from "vitest";
import { cunharChaveMaquina } from "../../../src/services/token-maquina.ts";
import { erroDoCodex, interpretarCodex, ultimaLinhaUtil } from "../../../src/domain/codex-stream.ts";
import { redigirCampos, redigirECortar, redigirSegredos } from "../../../src/domain/segredos.ts";
import { interpretarLinhaStreamJson } from "../../../src/domain/stream-json.ts";
import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";

const m = (n: number) => `«redigido: ${n} caracteres»`;
// Montados em tempo de execução: um literal com cara de chave real dispara o secret scanning do push.
const rep = (c: string, n: number) => c.repeat(n);
const ANTHROPIC = `sk-ant-api03-${rep("A1b2", 10)}`;
const OPENAI = `sk-proj-${rep("Zx9_", 8)}`;
const GITHUB = `ghp_${rep("a1B2", 9)}`;
const GITHUB_PAT = `github_pat_${rep("11AB", 6)}`;
const SLACK = `xoxb-${rep("1234-", 5)}abcd`;
const SLACK_APP = `xapp-1-${rep("A0b1", 6)}`;
const GOOGLE = `AIza${rep("Sy0_", 9)}`;
const GOOGLE_OAUTH = `ya29.${rep("a0Af", 8)}`;
const GOOGLE_CLIENT = `GOCSPX-${rep("k9_Z", 6)}`;
const AWS = `AKIA${rep("Q7", 8)}`;
const COMPOSIO = `ak_${rep("q1W2", 6)}`;
const JWT = `eyJhbGciOiJIUzI1NiJ9.${rep("eyJzdWIi", 3)}.${rep("s1G_", 8)}`;

describe("redigirSegredos (NOD-158)", () => {
  it.each([
    ["prefixo Anthropic", `falhou com ${ANTHROPIC} agora`, `falhou com ${m(ANTHROPIC.length)} agora`],
    ["prefixo OpenAI", `chave ${OPENAI}`, `chave ${m(OPENAI.length)}`],
    ["GitHub clássico", `remote: ${GITHUB}`, `remote: ${m(GITHUB.length)}`],
    ["GitHub fine-grained", `usando ${GITHUB_PAT}`, `usando ${m(GITHUB_PAT.length)}`],
    ["Slack", `token ${SLACK} inválido`, `token ${m(SLACK.length)} inválido`],
    ["Google", `key ${GOOGLE}`, `key ${m(GOOGLE.length)}`],
    ["Google OAuth (ADC)", `401 ${GOOGLE_OAUTH} expirado`, `401 ${m(GOOGLE_OAUTH.length)} expirado`],
    ["Google client secret", `client ${GOOGLE_CLIENT}`, `client ${m(GOOGLE_CLIENT.length)}`],
    ["Slack token de app", `socket ${SLACK_APP}`, `socket ${m(SLACK_APP.length)}`],
    ["senha=valor (pt-BR)", "senha=hunter2hunter2", `senha=${m(14)}`],
    ["cookie", "Cookie: sid=abcdef123456", `Cookie: ${m(16)}`],
    ["x-api-key da Composio", "x-api-key: q1W2e3R4t5", `x-api-key: ${m(10)}`],
    ["AWS", `id ${AWS} negado`, `id ${m(AWS.length)} negado`],
    ["Composio", `consumer ${COMPOSIO}`, `consumer ${m(COMPOSIO.length)}`],
    ["JWT", `sessão ${JWT} expirou`, `sessão ${m(JWT.length)} expirou`],
    ["Bearer", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD", `Authorization: Bearer ${m(40)}`],
    ["nome=valor", `ANTHROPIC_API_KEY=${rep("x", 51)}`, `ANTHROPIC_API_KEY=${m(51)}`],
    ["nome: \"valor\"", `"token": "abcd1234efgh"`, `"token": "${m(12)}"`],
    ["sufixo _key sem piso", "COMPOSIO_KEY=abc", `COMPOSIO_KEY=${m(3)}`],
    ["flag --token", "codex --token s3cr3tv4lor login", `codex --token ${m(11)} login`],
    ["flag --password=", "psql --password=hunter2", `psql --password=${m(7)}`],
    ["senha em URL", "postgres://nod:s3nh4-forte@db:5432/nod", `postgres://nod:${m(11)}@db:5432/nod`],
    // Regression: ISSUE-001 — senha curta ou com símbolo passava crua (o CHAVE_VALOR exige 8+ sem símbolo)
    // Found by /qa on 2026-10-05
    ["senha=valor curta", "senha=hunter2 falhou", `senha=${m(7)} falhou`],
    ["senha com símbolos", "DB_PASSWORD=p@ss!w0rd$9 x", `DB_PASSWORD=${m(11)} x`],
    ["segredo e secret curtos", "segredo=abc client_secret=xyz", `segredo=${m(3)} client_secret=${m(3)}`],
    ["senha em query string", "?user=a&password=s3nh@&x=1", `?user=a&password=${m(5)}&x=1`],
    ["senha entre aspas com espaço", `{"password": "minha senha!"}`, `{"password": "${m(12)}"}`],
    // Regression: ISSUE-002 — Authorization: Basic (usuario:senha em base64) passava cru
    ["Authorization: Basic", "Authorization: Basic dXNlcjpodW50ZXIy", `Authorization: Basic ${m(16)}`],
    ["Proxy-Authorization: Basic", "Proxy-Authorization: Basic YWxpY2U6czNuaGE=", `Proxy-Authorization: Basic ${m(16)}`],
  ])("%s vira nome + marcador com N certo", (_caso, entrada, esperado) => {
    expect(redigirSegredos(entrada)).toBe(esperado);
  });

  it("bloco PEM perde o corpo e mantém as bordas", () => {
    const corpo = rep("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", 3);
    const pem = `-----BEGIN PRIVATE KEY-----\n${corpo}\n-----END PRIVATE KEY-----`;
    expect(redigirSegredos(pem)).toBe(`-----BEGIN PRIVATE KEY-----\n${m(corpo.length)}\n-----END PRIVATE KEY-----`);
  });

  it("a chave de máquina do nod (duas partes, não JWT) é redigida inteira", () => {
    const { chave } = cunharChaveMaquina({ tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" });
    expect(chave.startsWith("eyJ")).toBe(true);
    expect(redigirSegredos(`x-nod-maquina: ${chave} recusada`)).toBe(`x-nod-maquina: ${m(chave.length)} recusada`);
  });

  it("o token de turno sem prefixo só é pego por Bearer ou token=", () => {
    const turno = rep("Qk9", 11) + "x";
    expect(redigirSegredos(`Bearer ${turno}`)).toBe(`Bearer ${m(turno.length)}`);
    expect(redigirSegredos(`token=${turno}`)).toBe(`token=${m(turno.length)}`);
    expect(redigirSegredos(`solto ${turno}`)).toBe(`solto ${turno}`);
  });

  it("JSON dentro de string de JSON (aspa escapada) não vaza o valor (NOD-138, QA)", () => {
    const tok = "tokAninhado987654";
    const senha = "segredoAninhado12345";
    expect(redigirSegredos(String.raw`{"corpo":"{\"token\":\"${tok}\",\"password\":\"${senha}\"}"}`)).toBe(String.raw`{"corpo":"{\"token\":\"${m(tok.length)}\",\"password\":\"${m(senha.length)}\"}"}`);
    expect(redigirSegredos(String.raw`{\"senha\":\"hunter2\"}`)).toBe(String.raw`{\"senha\":\"${m(7)}\"}`);
    expect(redigirSegredos(String.raw`password=\"abc123\"`)).toBe(String.raw`password=\"${m(6)}\"`);
    expect(redigirSegredos(String.raw`{\"api_key\": \"abcdefgh1234\"}`)).toBe(String.raw`{\"api_key\": \"${m(12)}\"}`);
    expect(redigirSegredos("password: deixe em branco")).toBe("password: deixe em branco");
  });

  it("é idempotente byte a byte, inclusive com nome=valor sobre o próprio marcador", () => {
    const texto = [
      `ANTHROPIC_API_KEY=${ANTHROPIC}`, `Bearer ${GITHUB}`, "token=abc12345678", "X_KEY=v",
      "--token abcdefghij", "https://u:p4ss@h.com", "senha=p@ss!", `{"password": "a b"}`, "Authorization: Basic dXNlcjpodW50ZXIy", `-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`,
    ].join("\n");
    const uma = redigirSegredos(texto);
    expect(uma).not.toBe(texto);
    expect(redigirSegredos(uma)).toBe(uma);
    expect(redigirSegredos(m(51))).toBe(m(51));
    expect(redigirSegredos(`token=${m(11)}`)).toBe(`token=${m(11)}`);
  });

  it("o corpus de não segredos sai inalterado", () => {
    for (const t of [
      "3f2b6c1e-9a7d-4c2e-8b1f-0d9e8c7b6a51",
      "commit 7d88e1c4b2a9f0e3d5c6b7a8f9e0d1c2b3a4f5e6",
      `sha256 ${rep("a3f9", 16)}`,
      "session_id: 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      "hotkey=CommandOrControl+Shift+Space",
      "keyboard=abnt2",
      "password: deixe em branco para usar o padrão",
      "if (password === \"\") return;",
      "Basic auth desligado; senha: obrigatória",
      "PWD=/Users/nod/projeto",
      // definido em 2026-10-18 (revisão de engenharia 15 dos modos de aprovação): os padrões novos não mordem isto.
      "git push -u origin feat/login",
      "mysql -p db_producao",
      "OLDPWD=/tmp e DB_HOST=localhost",
      "https://example.com/busca?q=signature&page=2",
      "const token = await obterToken(escopo);\nif (!token) throw new ErroDeDominio(\"nao_permitido\");",
      "Error: stream closed by provider (exit 1)",
      "curto",
    ]) expect(redigirSegredos(t)).toBe(t);
  });

  // Sem teto nas repetições a redação era O(n²): 8000 caracteres de `a-`/`a.`/`eyJ-` levavam 250–360 ms, e
  // 16000 passam de 1 s. Com o teto, poucos ms. NOD-194: a guarda mede o crescimento (4000 → 16000 caracteres)
  // em tempo de CPU, não o relógio de parede, que caía com o Mac em load ~950 sem regressão nenhuma.
  // medido em 2026-10-07 (load ~950): com o teto, razão 3,3–4,4 nos 12 casos; com os tetos removidos de
  // segredos.ts ({0,64}→*, {8,256}→{8,}, {0,31}→*, {1,256}→+), `a-`, `a.`, `ab-`, `a-ke` e `eyJ-` deram 16–17,5 e
  // falharam (os mesmos que já eram quadráticos); os outros casos cobrem regex que não dependem do teto.
  // 4000 fica bem acima do maior teto (256), senão o próprio teto ainda pareceria quadrático.
  // São 11 execuções por caso (aquecimento + 5 de cada tamanho): com load ~950 o `eyJ-` passou dos 5 s padrão
  // (medido em 2026-10-07), daí o PRAZO_GUARDA (30 s) por caso. Uma regex quadrática falha pela razão, não pelo prazo.
  it.each(["a=", "a-", "a.", "ab-", "a-ke", "eyJ-", "token=", "x://", "senha=", "a_password", "password:\"", "Authorization: Basic ", "APASSWORD", "-u a", "--user ", "sshpass -p", "mysql a -p", "?sig=", "SG.aaaaaaaaaaaaaaaa", "1234567:AA", "gt_aaaaaaaa-", "ghs_a-"])("o custo de `%s` repetido cresce linear (4000 → 16000 caracteres)", PRAZO_GUARDA, (unidade) => {
    const razao = razaoDeCrescimento((n) => rep(unidade, Math.ceil(n / unidade.length)), redigirSegredos, 4000);
    expect(razao).toBeLessThan(RAZAO_MAXIMA_LINEAR);
  });
});

describe("padrões novos (revisão de engenharia 15 do plano dos modos de aprovação)", () => {
  it.each([
    ["PGPASSWORD=s3nh4 psql", "PGPASSWORD=«redigido: 5 caracteres» psql"],
    ["MYSQL_PWD='s3nh4' mysql", "MYSQL_PWD='«redigido: 5 caracteres»' mysql"],
    ["curl -u maria:s3nh4 https://x", "curl -u maria:«redigido: 5 caracteres» https://x"],
    ["curl --user=maria:s3nh4 x", "curl --user=maria:«redigido: 5 caracteres» x"],
    ["sshpass -p s3nh4 ssh host", "sshpass -p «redigido: 5 caracteres» ssh host"],
    ["mysql -uroot -ps3nh4 db", "mysql -uroot -p«redigido: 5 caracteres» db"],
    ["https://b.s3/x?X-Amz-Signature=abc123&y=1", "https://b.s3/x?X-Amz-Signature=«redigido: 6 caracteres»&y=1"],
    ["https://c.blob/y?sv=1&sig=abc%2F", "https://c.blob/y?sv=1&sig=«redigido: 6 caracteres»"],
  ])("%s", (entrada, saida) => {
    expect(redigirSegredos(entrada)).toBe(saida);
    expect(redigirSegredos(saida)).toBe(saida);
  });

  it("prefixos de GitLab, Stripe, webhook do Stripe, SendGrid e Telegram", () => {
    for (const s of [`glpat-${"a1".repeat(10)}`, `rk_live_${"b2".repeat(12)}`, `sk_test_${"c3".repeat(12)}`, `whsec_${"d4".repeat(16)}`, `SG.${"e".repeat(22)}.${"f".repeat(43)}`, `123456789:AA${"g".repeat(33)}`]) {
      expect(redigirSegredos(`valor ${s} fim`), s).toBe(`valor «redigido: ${s.length} caracteres» fim`);
    }
  });
});

describe("redigirECortar", () => {
  it("um segredo atravessando a posição 500 não deixa prefixo nenhum dele", () => {
    const t = `${rep("x", 480)} ${ANTHROPIC} ${rep("y", 100)}`;
    expect(t.slice(0, 500)).toContain("sk-ant-");
    const r = redigirECortar(t, 500)!;
    expect(r.length).toBeLessThanOrEqual(500);
    expect(r).not.toContain("sk-");
    expect(r).not.toContain(ANTHROPIC.slice(0, 8));
  });

  it("um marcador na borda nunca é partido: o corte recua para antes do «", () => {
    const t = `${rep("x", 490)} ${GITHUB} fim`;
    const r = redigirECortar(t, 500)!;
    expect(r).toBe(`${rep("x", 490)} `);
    // corte exatamente no « também recua
    expect(redigirECortar(`${rep("x", 499)}${" "}${GITHUB}`, 501)).toBe(`${rep("x", 499)} `);
    // marcador que cabe inteiro fica
    const cabe = redigirECortar(`ok ${GITHUB}`, 500)!;
    expect(cabe).toBe(`ok ${m(GITHUB.length)}`);
  });

  it("vazio ou ausente vira null; texto curto passa direto", () => {
    expect(redigirECortar("", 10)).toBeNull();
    expect(redigirECortar(null, 10)).toBeNull();
    expect(redigirECortar(undefined, 10)).toBeNull();
    expect(redigirECortar("oi", 10)).toBe("oi");
  });
});

describe("redigirCampos", () => {
  it("redige só os valores string de um objeto raso", () => {
    expect(redigirCampos({ erro_cru: "token=abc12345678", n: 3, ok: true, nada: null })).toEqual({ erro_cru: `token=${m(11)}`, n: 3, ok: true, nada: null });
  });
});

describe("as costuras dos fornecedores saem redigidas", () => {
  it("o erroCru do Claude (`result` com Bearer) sai redigido e com no máximo 500", () => {
    const tok = rep("Zk3", 20);
    const ev = interpretarLinhaStreamJson(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: `401 com Bearer ${tok} ${rep("z", 600)}` }));
    expect(ev).toMatchObject({ tipo: "result", sucesso: false });
    const erro = (ev as { erroCru: string }).erroCru;
    expect(erro).toContain(`Bearer ${m(tok.length)}`);
    expect(erro).not.toContain(tok.slice(0, 12));
    expect(erro.length).toBeLessThanOrEqual(500);
  });

  it("o erroCru do Codex (OPENAI_API_KEY=sk-… no stderr, no turn.failed e no evento error) sai redigido", () => {
    expect(ultimaLinhaUtil(`2026-10-05T14:47:05Z ERROR boot\n2026-10-05T14:47:06Z ERROR env OPENAI_API_KEY=${OPENAI} rejeitada\n`)).toBe(`ERROR env OPENAI_API_KEY=${m(OPENAI.length)} rejeitada`);
    expect(interpretarCodex(JSON.stringify({ type: "turn.failed", error: { message: `auth ${OPENAI}` } }))).toMatchObject([{ erroCru: `auth ${m(OPENAI.length)}` }]);
    expect(erroDoCodex(JSON.stringify({ type: "error", message: `token=${OPENAI}` }))).toBe(`token=${m(OPENAI.length)}`);
  });
});

describe("NOD-84: o endereço do webhook e o segredo HMAC no redator comum", () => {
  it("gt_<alegado>.<segredo> e ghs_<base64url> saem inteiros", () => {
    const token = `gt_${Buffer.from('{"t":"a","p":"b","r":"c"}').toString("base64url")}.${"x_Y-".repeat(10)}abc`;
    const ghs = `ghs_${"Ab-_".repeat(10)}xyz`;
    const out = redigirSegredos(`url=https://nod/api/w/${token} e ${ghs}`);
    expect(out).not.toContain("x_Y-");
    expect(out).not.toContain("Ab-_");
    expect(out).toContain("https://nod/api/w/«redigido");
  });
});
