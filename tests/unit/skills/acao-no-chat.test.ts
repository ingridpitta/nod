import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMATO_ID_ACAO, REGISTRO_DE_ACOES } from "../../../src/domain/acoes/index.ts";
import { contarEstados } from "../../../src/domain/acoes/paridade.ts";
import { decidirLote } from "../../../src/domain/lote-bots.ts";
import { decidirPeloModo, semRevisor } from "../../../src/domain/modo-aprovacao.ts";
import { EXECUTORES } from "../../../src/use-cases/acoes/index.ts";

/**
 * NOD-392: a skill /acao-no-chat é a fonte única da regra "todo botão novo tem ação no registro e caminho no chat" para o
 * spec, o protótipo e o plano. Ela cita nomes e regras do registro da NOD-391 (ADR-135); este teste a trava contra o
 * código e a ADR, para um rename ou uma regra mudada derrubar o CI em vez de deixar a skill ensinando o que não vale.
 */

const RAIZ = new URL("../../../", import.meta.url);
const ler = (rel: string) => readFileSync(new URL(rel, RAIZ), "utf8");
const SKILL_REL = ".claude/skills/acao-no-chat/SKILL.md";
const skill = ler(SKILL_REL);
const so = (s: string) => s.replace(/\s+/g, " ");
const crases = (s: string) => [...s.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
const blocosDeCodigo = [...skill.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
/** Tudo entre crases fora dos blocos ``` (os modelos usam `<dominio>` e o id de exemplo). */
const citados = crases(skill.replace(/```[\s\S]*?```/g, ""));
const EXEMPLO = "dominio.verbo";
const bloco = (n: number) => skill.split(new RegExp(`^## ${n + 1}\\.`, "m"))[0]?.split(new RegExp(`^## ${n}\\.`, "m"))[1] ?? "";
/** O item `- **rotulo** …` da regra, até o próximo item ou a linha em branco. */
const item = (rotulo: string) => {
  const i = skill.indexOf(`- **${rotulo}`);
  expect(i, `item ${rotulo} sumiu`).toBeGreaterThanOrEqual(0);
  return /^- \*\*[\s\S]*?(?=^- \*\*|^$)/m.exec(skill.slice(i))?.[0] ?? "";
};

/** Os riscos de `RiscoAcao` e o JSDoc de cada um (o tipo não existe em runtime: lê a união em src/contracts/acoes.ts). */
function riscosDoContrato(): { risco: string; doc: string }[] {
  const corpo = /export type RiscoAcao =([\s\S]*?);\n/.exec(ler("src/contracts/acoes.ts"))?.[1] ?? "";
  return [...corpo.matchAll(/\/\*\*\s*([^*]+?)\s*\*\/\s*\|\s*"([a-z_]+)"/g)].map((m) => ({ risco: m[2] ?? "", doc: so(m[1] ?? "") }));
}

describe("skill /acao-no-chat (NOD-392)", () => {
  it("tem o frontmatter das skills do repo (name + description com gatilhos) e no máximo 150 linhas", () => {
    expect(skill).toMatch(/^---\nname: acao-no-chat\ndescription: >-\n[\s\S]*?Gatilhos:[\s\S]*?\n---\n/);
    expect(skill.trimEnd().split("\n").length).toBeLessThanOrEqual(150);
  });

  it("tem os quatro blocos: regra, spec, protótipo e plano", () => {
    for (const h of [/^## 1\. A regra$/m, /^## 2\. Spec /m, /^## 3\. Protótipo /m, /^## 4\. Plano e QA /m]) expect(skill).toMatch(h);
  });

  it("diz o que cada letra da catraca derruba, como o cabeçalho dela, e não promete que ela exige o caminho no chat", () => {
    const intro = so(skill.split(/^## 1\./m)[0] ?? "");
    const cabecalho = so(ler("tests/conformidade/paridade.test.ts"));
    // a letra: [o que a skill diz, o que o cabeçalho da catraca diz]
    const letras: [string, string, string][] = [
      ["A", "a rota nova sem id (A)", "A: toda rota de pessoa que muda algo declara um id do registro"],
      ["B", "a ação sem rota (B)", "B: toda ação tem rota"],
      ["C", "as vivas abaixo do piso (C)", "C: as vivas não caem abaixo do piso"],
      ["D", "o `docs/paridade.md` velho (D)", "D: o docs/paridade.md está em dia"],
    ];
    for (const [l, naSkill, naCatraca] of letras) {
      expect(cabecalho, `a letra ${l} da catraca mudou: reveja a skill`).toContain(naCatraca);
      expect(intro).toContain(naSkill);
    }
    expect(so(intro)).toMatch(/\*\*não\*\* exige o caminho no chat: aceita `falta` e `nunca`/);
  });

  it("o bloco do spec traz o modelo No chat, o critério fixo e quando não usar o critério", () => {
    const spec = bloco(2);
    expect(spec).toMatch(/^## No chat$/m);
    for (const campo of ["Ação (id)", "Risco", "cartaoNoChat", "Em que bot", "Como a pessoa pede", "O cartão:", "Risco:"]) expect(spec).toContain(campo);
    expect(spec).toContain("Dá para fazer pelo chat com qualquer bot");
    // a linha de exemplo do modelo é coerente: muda, sem cartão próprio, nasce vivo
    expect(spec).toMatch(/^\| `dominio\.verbo` \| frase curta \| muda \| não \| vivo \| /m);
    expect(spec).toMatch(/\*\*Quando não usar o critério fixo:\*\*/);
    const quando = so(spec.slice(spec.indexOf("**Quando não usar")));
    expect(quando).toContain('"No chat: nenhuma ação nova"');
    expect(quando).toMatch(/nenhuma ação nova" e o critério não entra/);
    expect(quando).toMatch(/A ação em `falta` ou `nunca` [^.]*e fica fora do critério\./);
    expect(quando).toMatch(/A ação em `parcial` fica fora também/);
  });

  it("'qualquer bot' é definido pelo plano de turno, com as exceções do Nod e do criar_bots, e o critério fica igual", () => {
    const def = so(bloco(2).slice(bloco(2).indexOf('**"Qualquer bot"**')));
    expect(def).toMatch(/`montarPlano` em `src\/domain\/plano-turno\.ts`/);
    expect(def).toMatch(/`FERRAMENTAS_DO_NOD` \(ex\.: `gerir_bots`\) só entram no turno do Nod, e só em conversa e criação \(`MODOS_DAS_MAOS_DO_NOD`\)/);
    expect(def).toContain("`criar_bots` só entra nos outros bots, também só em conversa e criação");
    expect(def).toContain("O critério fica igual");
    // a fonte do que a skill afirma: o plano de turno
    const plano = ler("src/domain/plano-turno.ts");
    expect(plano).toMatch(/MODOS_DAS_MAOS_DO_NOD\b[^=]*= \["conversa", "criacao"\]/);
    expect(plano).toMatch(/[^!]ehNod\([^)]*\)[^;]*MODOS_DAS_MAOS_DO_NOD[^;]*FERRAMENTAS_DO_NOD/);
    expect(plano).toMatch(/!ehNod\([^)]*\)[^;]*MODOS_DAS_MAOS_DO_NOD[^;]*FERRAMENTA_CRIAR_BOTS/);
    // FERRAMENTAS_NOD_POR_MODO entra em todo bot; FERRAMENTAS_DO_NOD é somado
    expect(plano).toMatch(/\.\.\.FERRAMENTAS_NOD_POR_MODO\[modo\][^;]*\.\.\.doNod/);
    expect(plano).toContain('FERRAMENTA_CRIAR_BOTS: NomeFerramentaNod = "criar_bots"');
  });

  it("as frases que carregam a regra estão inteiras (negar ou afrouxar qualquer uma derruba)", () => {
    const texto = so(skill);
    const frases = [
      "toda rota de pessoa que não é GET",
      "Reusar um id existente cita o id.",
      "> - [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o > cartão que o risco e o modo pedem.",
      "nos modos de turno em que ela entra",
      "O critério fica igual: é a coluna \"Em que bot\" que diz o bot e o modo, e o QA testa por ela.",
      "A jornada do protótipo mostra **os dois caminhos** para cada ação da seção \"No chat\"",
      "o **resultado** (o mesmo estado final da tela, visto na tela)",
      "Sem ação nova, o protótipo não precisa do caminho pela conversa.",
      "Tudo no **mesmo PR** (registro, rota, executor, ferramenta, teste de contrato, piso e `npm run paridade`).",
      "Efeito fora do banco vai em `Deps.aposCommit` (ADR-135 §4)",
      "Ação que fica `falta` não sobe o piso e diz a onda.",
      "Ação `parcial` ou `nunca` leva registro e rota, e a linha diz a divergência ou o motivo.",
      "entra na união `EfeitoAposCommit` e ganha o seu ramo em `rodarAposCommit` (`src/adapters/http/compor.ts`), que hoje desliga o computador, limpa o computador removido e traz a importação do Linear em segundo plano.",
      "**O cartão só sai do risco sozinho no lote do `gerir_bots`** (`riscoDaAcao` em `src/domain/lote-bots.ts`; o modo, o de quem recebe o pedido, lá o do Nod, entra em `decidirLote`; hoje, lá, `leitura` segue o modo como `muda`).",
      "`leitura` não consulta o modo; `pessoa_confirma` vira cartão antes do modo",
      "`arriscada` vai direto em `semRevisor(decidirPeloModo(modo, { arriscada: true, credencial: false }))` (modo atual do bot; sem plano, manual), nunca por `confirmacaoPeloModo`",
      "`muda` vai por `confirmacaoPeloModo` com `arriscada: false`.",
      "A cerca 3 fora do lote só vale com o revisor ligado (`gravaInstrucao`); se o spec a pede sempre, a ação é `arriscada`. Divergência de risco não vira `parcial`:",
      "um POST que só lê é ação `leitura` e entra no registro",
      "e o teste do cartão por risco e modo (`pessoa_confirma` no total; `arriscada` no automático, na conversa)",
      "Tabela de executores ou efeito novo também atualizam o \"hoje\" desta skill e o teste dela (`tests/unit/skills/acao-no-chat.test.ts`).",
      "Antes do push: `npm run paridade` (regera o `docs/paridade.md`) e o `npm run check` (a catraca roda nele).",
      "confere que o estado final é o mesmo, que o cartão aparece só quando o risco e o modo pedem",
      "**Todo botão novo tem ação no registro e caminho no chat.**",
      "o clique na tela e o pedido no chat (uma das falas do spec, com o app real, no bot da coluna \"Em que bot\")",
      "contrato: `tests/integration/paridade-<dominio>.test.ts` (tela e chat → mesmo estado no banco)",
      "**Como a pessoa pede** (2–3 falas reais, de jeitos diferentes):",
      "1. **Pela tela:** o clique, como sempre.",
      "a resposta do bot, o **cartão** (quando o risco e o modo pedem) e o **resultado**",
      "`falta` é exceção que a Ada decide no spec, com o porquê",
      "`cartaoNoChat` é declarativo (nada o lê em runtime; ex.: `bots.excluir` tem `sim` e, no lote em \"Ignorar todas as aprovações\", roda sem cartão); o cartão que aparece sai do risco × modo",
      "Id que já existe e muda de estado (`falta`/`parcial` → `vivo`, as ondas) conta como ação nova: leva a seção \"No chat\" e o critério.",
      "ou rota nova para um id já `vivo`",
      "se a ferramenta que já existe diverge do mapa, a Ada decide no spec (corrigir a ferramenta ou o risco no registro), no mesmo PR.",
      "com a proposta que o mostra (um `TipoDecisao` de `src/contracts/decisao.ts` reusado, ou um novo com migração e cartão na web)",
      "a só do Nod entra nos dois `FERRAMENTAS_DO_NOD`, o de schemas e o do plano",
      "Um caminho sem prova entra em \"o que ficou sem prova\" no resumo.",
      "Sem ação nova: o plano escreve \"Ações: nenhuma ação nova\" e o QA testa só a tela.",
    ];
    for (const f of frases) expect(texto, f).toContain(f);
  });

  it("o bloco do protótipo diz como o Gil lê a skill de fora do repo, com fetch antes", () => {
    expect(bloco(3)).toContain("git -C ~/nod/.clones/gamefik/nod.git fetch -q origin && git -C ~/nod/.clones/gamefik/nod.git show origin/HEAD:" + SKILL_REL);
  });

  it("o bloco do plano traz a seção Ações completa e o QA dos dois caminhos", () => {
    const plano = bloco(4);
    expect(plano).toMatch(/^## Ações$/m);
    const modelo = so(blocosDeCodigo.find((b) => b.includes("## Ações")) ?? "");
    for (const campo of ["registro:", "titulo", "risco", "cartaoNoChat", "schema", "casoDeUso", "contrato", "lote.tipo = via.tipoNoLote", "rota:", "executor único:", "ferramenta:", "`TIPOS_ACAO_LOTE`", "contrato:", "piso:"]) expect(modelo, campo).toContain(campo);
    expect(plano).toContain("mesmo PR");
    expect(modelo).toContain("piso: `docs/paridade.piso.json` sobe N");
    expect(so(plano)).toContain('Sem ação nova: o plano escreve "Ações: nenhuma ação nova"');
    // o executor entra na tabela id → executor que o teste dos executores confere
    expect(modelo).toContain("na tabela id → executor");
    expect(so(plano)).toContain("`EXECUTORES_BOTS`, e o `casoDeUso` da ação é o id; domínio novo cria a sua tabela e, em `tests/unit/use-cases/acoes-executores.test.ts` (que compara as chaves com o `casoDeUso` das ações `vivo`), troca `EXECUTORES_BOTS` pela união das tabelas.");
    // o que a skill diz da tabela vale em runtime: casoDeUso = id, e as chaves são os vivos
    const vivos = REGISTRO_DE_ACOES.filter((a) => a.chat.estado === "vivo");
    for (const a of vivos) expect("casoDeUso" in a ? a.casoDeUso : undefined, a.id).toBe(a.id);
    expect(so(plano)).toContain("Hoje a união é `EXECUTORES` (`src/use-cases/acoes/index.ts`: `bots.*` e `quadro.*`)");
    expect(Object.keys(EXECUTORES).sort(), "domínio novo com executor: atualize o \"hoje\" da skill e este teste").toEqual(vivos.map((a) => a.id).sort());
    // a ferramenta: onde mora, como entra no turno, o cartão e o lote só do gerir_bots
    expect(modelo).toContain("schema em `src/contracts/ferramentas-nod.ts` (ou no arquivo do domínio espalhado em `FERRAMENTAS_NOD`; as só do Nod em `src/contracts/ferramentas-do-nod.ts`), nome em `NOMES_FERRAMENTAS_NOD`, caso de uso em `USE_CASE_POR_FERRAMENTA` (`src/contracts/servicos.ts`), despacho em `src/use-cases/chamar-ferramenta.ts`, rótulo (opcional) em `src/domain/rotulo-ferramenta.ts` (e o que os testes das ferramentas pedirem: `ESPERADAS`, `DESPACHO`); entra no turno por `src/domain/plano-turno.ts` (`FERRAMENTAS_NOD_POR_MODO` = todo bot, por modo; `FERRAMENTAS_DO_NOD` = só o Nod, somado;");
    // por que a skill manda segurar pessoa_confirma antes do modo: o modo total aprova até o arriscado, e o lote o segura antes
    expect(decidirPeloModo("total", { arriscada: true, credencial: false })).toMatchObject({ automatico: true });
    // e por que o arriscado vai direto em decidirPeloModo: no automático ele vira cartão, e confirmacaoPeloModo o alivia na conversa
    expect(semRevisor(decidirPeloModo("automatico", { arriscada: true, credencial: false }))).toMatchObject({ automatico: false });
    expect(ler("src/use-cases/confirmar-pelo-modo.ts")).toMatch(/plantada = revisor && o\.gravaInstrucao === true/);
    expect(ler("src/domain/lote-bots.ts")).toMatch(/risco === "ligar_total" \? risco/);
    // o "hoje" da skill: no lote, sem risco (leitura e muda) segue o modo — cartão no manual, nada no automático
    const semRisco = [{ i: 0, alvoId: null, alvoDaAcao: null }] as unknown as Parameters<typeof decidirLote>[0];
    const hojeLote = 'no lote, leitura deixou de seguir o modo: atualize o "hoje" da skill';
    expect(decidirLote(semRisco, "manual", [null]), hojeLote).toEqual(["manual"]);
    expect(decidirLote(semRisco, "automatico", [null]), hojeLote).toEqual([null]);
    expect(ler("src/use-cases/confirmar-pelo-modo.ts")).toMatch(/o\.arriscada && !conversaComAPessoa\(/);
    expect(modelo).toContain("lote (só se entra no `gerir_bots`): lote.tipo = via.tipoNoLote, `riscoDe`/`deFora` se o risco muda com o argumento ou depois de conteúdo de fora, o tipo em `TIPOS_ACAO_LOTE` e o `case` em `src/use-cases/gerir-bots.ts`");
    expect(ler("src/use-cases/chamar-ferramenta.ts")).toMatch(/\bgerir_bots: \(/);
    expect(ler("src/use-cases/gerir-bots.ts")).toMatch(/case "[a-z_]+":[\s\S]*?EXECUTORES_BOTS\[/);
    // o efeito pós-commit: a união tem três tipos, e rodarAposCommit desliga o computador, limpa o removido (ADA-245) e traz a importação do Linear
    const hoje = 'efeito novo: atualize o "hoje desliga o computador, limpa o computador removido e traz a importação do Linear" da skill e este teste';
    expect([...ler("src/contracts/acoes.ts").matchAll(/export type EfeitoAposCommit =[\s\S]*?};/g)][0]?.[0].match(/tipo:/g), hoje).toHaveLength(3);
    expect(ler("src/adapters/http/compor.ts"), hoje).toMatch(/rodarAposCommit = [\s\S]*?desligarExcluido[\s\S]*?removerDepoisDoCommit[\s\S]*?trazerImportacao/);
    expect(so(plano)).toContain('"Ignorar todas as aprovações" não pula o `pessoa_confirma`');
    expect(plano).toMatch(/QA testa os dois caminhos/);
  });

  it("todo caminho citado existe no repo (nos modelos, o diretório antes do <placeholder>)", () => {
    const fora = citados.filter((c) => /^(src|tests|docs|\.claude)\/[^\s<]+\.[a-z]+$/.test(c));
    expect(fora.length).toBeGreaterThan(5);
    for (const c of fora) expect(existsSync(new URL(c, RAIZ)), `${c} não existe`).toBe(true);
    const nosModelos = blocosDeCodigo.flatMap(crases).filter((c) => /^(src|tests|docs)\//.test(c));
    expect(nosModelos.length).toBeGreaterThan(3);
    for (const c of nosModelos) {
      const dir = c.includes("<") ? c.slice(0, c.indexOf("<")).replace(/[^/]*$/, "") : c;
      expect(existsSync(new URL(dir, RAIZ)), `${c}: ${dir} não existe`).toBe(true);
    }
  });

  it("todo id de ação citado está no REGISTRO_DE_ACOES", () => {
    const ids = new Set<string>(REGISTRO_DE_ACOES.map((a) => a.id));
    const todos = [...citados, ...blocosDeCodigo.flatMap(crases)];
    const citadosIds = todos.filter((c) => FORMATO_ID_ACAO.test(c) && c !== EXEMPLO && !/\.(ts|md|json|mjs)$/.test(c));
    expect(citadosIds.length).toBeGreaterThan(0);
    for (const id of citadosIds) expect(ids.has(id), `${id} não está no registro`).toBe(true);
    // o exemplo de `cartaoNoChat: sim` tem mesmo o cartão próprio no registro
    const exemplo = /ex\.: `([a-z_.]+)` tem `sim`/.exec(skill)?.[1] ?? "";
    expect(REGISTRO_DE_ACOES.find((a) => a.id === exemplo)?.cartaoNoChat, exemplo).toBe(true);
  });

  it("o item do risco diz, para cada risco do contrato e só para eles, o que o JSDoc diz", () => {
    const riscos = riscosDoContrato();
    expect(riscos.map((r) => r.risco)).toEqual(["leitura", "muda", "arriscada", "pessoa_confirma"]);
    // a frase de cada risco na skill, e o trecho do JSDoc do contrato que ela repete
    const frase: Record<string, [string, string]> = {
      leitura: ["nunca vira cartão", "nunca vira cartão"],
      muda: ["segue o modo do bot", "segue o modo do bot"],
      arriscada: ["vira cartão no manual e no automático", "cartão no manual e no automático"],
      pessoa_confirma: ["é sempre da pessoa, também em \"Ignorar todas as aprovações\"", "sempre a pessoa, inclusive em \"Ignorar todas as aprovações\""],
    };
    for (const { risco, doc } of riscos) expect(doc, `o JSDoc de ${risco} mudou: reveja a skill`).toContain(frase[risco]?.[1] ?? "?");
    const esperado = riscos.map(({ risco }) => `\`${risco}\` ${frase[risco]?.[0] ?? "?"}`);
    // o item da regra: exatamente uma frase por risco, sem nada acrescentado
    const r = so(item("Risco")).trim();
    expect(r.replace(/^- \*\*Risco\*\* \(`RiscoAcao`, ADR-135 §3\): /, "").replace(/\.$/, "").split(" · ")).toEqual(esperado);
    // o modelo do spec (o que a Ada copia) repete o mesmo mapa para quem pode virar cartão
    const doModelo = /o cartão que aparece sai do risco × modo \(([^)]*)\)\./.exec(so(bloco(2)))?.[1] ?? "";
    expect(doModelo.split("; ")).toEqual(esperado.slice(1));
  });

  it("o item do estado cita todos os estados do contrato e só eles", () => {
    // contarEstados devolve um Record<estado, número>: o compilador obriga a chave de todo estado de EstadoNoChat.
    const estados = Object.keys(contarEstados([]));
    expect(estados).toEqual(["vivo", "parcial", "falta", "nunca"]);
    const e = so(item("Estado no chat")).trim();
    expect(crases(e).filter((c) => !["EstadoNoChat", "ONDAS"].includes(c)).sort()).toEqual([...estados].sort());
    // o sentido de cada estado: o campo que o contrato exige dele aparece na descrição dele
    const contrato = so(ler("src/contracts/acoes.ts"));
    const campo: Record<string, [string, RegExp]> = {
      vivo: ["(mesmo executor da tela, com teste de contrato)", /estado: "vivo"; via: ViaNoChat; contrato: string/],
      parcial: ["(o chat faz, mas diverge; diz o quê)", /estado: "parcial"; via: ViaNoChat; falta: string/],
      falta: ["(a onda dona, uma de `ONDAS`, vai ligar)", /estado: "falta"; onda: Onda/],
      nunca: ["(exceção com motivo escrito)", /estado: "nunca"; motivo: string/],
    };
    const partes = e.replace(/^- \*\*Estado no chat\*\* \(`EstadoNoChat`\): /, "").replace(/\.$/, "").split(" · ");
    expect(partes).toEqual(estados.map((x) => `\`${x}\` ${campo[x]?.[0] ?? "?"}`));
    for (const x of estados) expect(contrato).toMatch(campo[x]?.[1] ?? /^$/);
  });

  it("ação nova nasce vivo, o nunca lista exatamente as exceções da ADR-135 §2 e o piso só sobe", () => {
    const nasce = so(item("Ação nova nasce"));
    expect(nasce).toMatch(/^- \*\*Ação nova nasce `vivo`\.\*\* `falta` é exceção que a Ada decide no spec/);
    const daAdr = /`nunca`: exceção escrita \(([^)]+)\)/.exec(so(ler("docs/adr/adr-135-registro-unico-de-acoes-e-paridade.md")))?.[1]?.split(", ") ?? [];
    const daSkill = /`nunca` só nas exceções da ADR-135 §2: ([^.]+)\./.exec(nasce)?.[1]?.split(", ") ?? [];
    expect(daAdr.length).toBe(8);
    expect(daSkill).toEqual(daAdr);
    expect(so(item("Placar")).trim()).toMatch(/^- \*\*Placar:\*\* `docs\/paridade\.md` \(gerado por `npm run paridade`, nunca à mão\) e o piso `docs\/paridade\.piso\.json`, que só sobe\.$/m);
  });

  it("os nomes de código citados existem onde a skill diz", () => {
    const onde: Record<string, string> = {
      REGISTRO_DE_ACOES: "src/domain/acoes/index.ts",
      IdAcao: "src/domain/acoes/index.ts",
      validarRegistro: "src/domain/acoes/index.ts",
      DefinicaoAcao: "src/contracts/acoes.ts",
      RiscoAcao: "src/contracts/acoes.ts",
      EstadoNoChat: "src/contracts/acoes.ts",
      ONDAS: "src/contracts/acoes.ts",
      NOME_DA_ONDA: "src/contracts/acoes.ts",
      cartaoNoChat: "src/contracts/acoes.ts",
      casoDeUso: "src/contracts/acoes.ts",
      tipoNoLote: "src/contracts/acoes.ts",
      EfeitoAposCommit: "src/contracts/acoes.ts",
      FERRAMENTAS_DO_NOD: "src/domain/plano-turno.ts",
      FERRAMENTAS_NOD_POR_MODO: "src/domain/plano-turno.ts",
      FERRAMENTAS_NOD: "src/contracts/ferramentas-nod.ts",
      riscoDaAcao: "src/domain/lote-bots.ts",
      decidirLote: "src/domain/lote-bots.ts",
      decidirPeloModo: "src/domain/modo-aprovacao.ts",
      confirmacaoPeloModo: "src/use-cases/confirmar-pelo-modo.ts",
      conversaComAPessoa: "src/domain/modo-aprovacao.ts",
      NOMES_FERRAMENTAS_NOD: "src/contracts/ferramentas-nod.ts",
      USE_CASE_POR_FERRAMENTA: "src/contracts/servicos.ts",
      rodarAposCommit: "src/adapters/http/compor.ts",
      riscoDe: "src/contracts/acoes.ts",
      deFora: "src/contracts/acoes.ts",
      TIPOS_ACAO_LOTE: "src/contracts/ferramentas-do-nod.ts",
      montarPlano: "src/domain/plano-turno.ts",
      semRotaDePessoa: "src/contracts/acoes.ts",
      EXECUTORES_BOTS: "src/use-cases/acoes/bots.ts",
    };
    for (const [nome, arq] of Object.entries(onde)) {
      expect(skill, `a skill não cita ${nome}`).toContain(nome);
      expect(ler(arq), `${nome} sumiu de ${arq}`).toMatch(new RegExp(`\\b${nome}\\b`));
    }
    // os nomes compostos, como a skill os escreve
    for (const n of ["`Rota.acao`", "`Deps.aposCommit`", "`npm run paridade`"]) expect(skill).toContain(n);
    expect(so(item("A rota declara o id"))).toContain("em `Rota.acao` (tipo `IdAcao`; id fora do registro não compila)");
    expect(so(blocosDeCodigo.find((b) => b.includes("## Ações")) ?? "")).toContain("rota: `Rota.acao` em");
    // os campos do item Registro existem na DefinicaoAcao
    const reg = so(item("Registro"));
    const def = /export type DefinicaoAcao = \{([\s\S]*?)\n\};/.exec(ler("src/contracts/acoes.ts"))?.[1] ?? "";
    for (const c of ["titulo", "risco", "cartaoNoChat", "chat"]) {
      expect(reg).toContain(`\`${c}\``);
      expect(def).toMatch(new RegExp(`^\\s*${c}\\??:`, "m"));
    }
    expect(ler("src/use-cases/tipos.ts")).toMatch(/export interface Deps \{[\s\S]*?\baposCommit\?:[\s\S]*?\n\}/);
    expect(ler("src/adapters/http/roteador.ts")).toMatch(/acao\?: IdAcao/);
    expect(JSON.parse(ler("package.json")).scripts.paridade).toBeTruthy();
  });

  it("AGENTS.md aponta para a skill no fim de 'Regras que o código trava'; o quebrar-jornada tem o item e o checklist", () => {
    const agents = ler("AGENTS.md");
    const linha = agents.search(/^- \*\*Todo botão novo tem ação no registro e caminho no chat\*\*/m);
    expect(linha).toBeGreaterThan(agents.indexOf("## Regras que o código trava"));
    expect(linha).toBeLessThan(agents.indexOf("## Quatro modos de teste"));
    const item = so(agents.slice(linha, agents.indexOf("## Quatro modos de teste")));
    expect(item).toContain("(.claude/skills/acao-no-chat/SKILL.md)");
    expect(item).toContain("o registro a catraca acima trava; o caminho no chat (que ela aceita como `falta`/`nunca`) o fluxo garante");
    const qj = ler(".claude/skills/quebrar-jornada/SKILL.md");
    const anatomia = qj.slice(qj.indexOf("### Anatomia de cada issue"), qj.indexOf("### Incógnitas"));
    expect(anatomia).toMatch(/^- \*\*No chat\*\* — [\s\S]{0,400}\(\.\.\/acao-no-chat\/SKILL\.md\)/m);
    expect(so(anatomia)).toContain('2-3 falas de como a pessoa pede, o cartão e o risco, mais o critério fixo "dá para fazer pelo chat com qualquer bot"; sem ação nova, "No chat: nenhuma ação nova"');
    expect(qj.slice(qj.indexOf("## Checklist antes de fechar"))).toMatch(/^- \[ \] [^\n]*"No chat"[^\n]*`\/acao-no-chat`/m);
  });
});
