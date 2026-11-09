import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { MsgMidiaServidor } from "../../src/contracts/voz.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Onboarding por ligação ponta a ponta com custo zero (definido em 2026-10-04, ADR-077): servidor completo, executor
 * catcher em modo ligação (os marcadores `[[tool: …]]` chamam as ferramentas do onboarding) e voz falsa. Um cliente
 * WebSocket faz o papel do app: a Nina liga (iniciada pelo produto), a mídia só abre depois do Atender (consentimento),
 * a entrevista anota os quatro campos, concluir_entrevista encolhe para a configuração, propor_bot vira o card que a
 * pessoa aprova falando ("pode criar"), o bot nasce, a Nina pede o app e propõe a rotina PARA o bot novo, e o
 * onboarding termina.
 */
let srv: ServidorCompleto;
const criados = { agentes: [] as string[], conversas: [] as string[] };

beforeAll(async () => {
  srv = await servidorCompleto({ nomePessoa: "Ana Teste", env: { NOD_LIGACAO: "todas", NOD_VOZ_FALSO_ROTEIRO: "pode criar|pode criar" } });
});

afterAll(async () => {
  try {
    await srv.fechar();
  } finally {
    await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
    await srv.desligar();
  }
});

type Cliente = { msgs: MsgMidiaServidor[]; ws: WebSocket; fechado: Promise<number>; fechou: string | null; esperarMsg(f: (m: MsgMidiaServidor) => boolean, nome: string, timeoutMs?: number): Promise<MsgMidiaServidor> };

function abrirMidia(ligacaoId: string): Cliente {
  const url = `${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`;
  const ws = new WebSocket(url, { headers: { cookie: srv.pessoa.cookie, origin: `http://${new URL(srv.url).host}` } });
  const c: Cliente = {
    msgs: [],
    ws,
    fechado: new Promise((r) => ws.once("close", (codigo) => r(codigo))),
    fechou: null,
    async esperarMsg(f, nome, timeoutMs = 8_000) {
      return srv.esperar(async () => c.msgs.find(f) ?? semMidiaFechada(c, nome), { nome, timeoutMs });
    },
  };
  ws.on("close", (codigo, motivo) => {
    c.fechou = `${codigo} ${String(motivo)}`.trim();
  });
  ws.on("message", (dados, binario) => {
    if (binario) {
      ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
      return;
    }
    c.msgs.push(JSON.parse(String(dados)) as MsgMidiaServidor);
  });
  ws.once("open", () => ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId, entrada: "pcm16", saida: "pcm16" })));
  return c;
}

/** NOD-184: a mídia fechada pelo servidor não traz mais nada — falha já, com o motivo, em vez de estourar o prazo. */
function semMidiaFechada(c: Cliente, nome: string): null {
  if (c.fechou) throw new Error(`a mídia fechou (${c.fechou}) esperando: ${nome}`);
  return null;
}

function quadroMicrofone(seq: number, comVoz: boolean): Buffer {
  const amostras = 320;
  const b = Buffer.alloc(5 + amostras * 2);
  b.writeUInt8(0x01, 0);
  b.writeUInt32LE(seq, 1);
  for (let i = 0; i < amostras; i++) b.writeInt16LE(comVoz ? Math.round(Math.sin((i + seq * amostras) / 6) * 9000) : 0, 5 + i * 2);
  return b;
}

let seq = 0;
/**
 * 600 ms de tom e 1,2 s de silêncio: o STT falso devolve a próxima fala do roteiro ("pode criar"). Em blocos de 100 ms em
 * tempo real, como o app: em rajada, duas falas logo depois de a mídia abrir passam de 1,2× o tempo real + 2 s e a guarda
 * de abuso fecha a mídia (NOD-184).
 */
async function falar(cli: Cliente): Promise<void> {
  for (let i = 0; i < 90; i++) {
    cli.ws.send(quadroMicrofone(seq++, i < 30));
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
  }
}

/** Aprova por voz o próximo card lido: leitura → janela → "pode criar" → comando → rota de decisão. */
async function aprovarPorVoz(cli: Cliente, ligacaoId: string, jaVistas: number): Promise<string> {
  const janela = await srv.esperar(async () => cli.msgs.filter((m) => m.t === "janela")[jaVistas] ?? semMidiaFechada(cli, `janela ${jaVistas + 1}`), { nome: `janela ${jaVistas + 1}`, timeoutMs: 10_000 });
  const decisaoId = janela.t === "janela" ? janela.decisaoId : "";
  await falar(cli);
  const comando = await srv.esperar(async () => cli.msgs.filter((m) => m.t === "comando")[jaVistas] ?? semMidiaFechada(cli, `comando ${jaVistas + 1}`), { nome: `comando ${jaVistas + 1}` });
  if (comando.t !== "comando") throw new Error("sem comando");
  expect(comando.acao).toBe("aprovar");
  expect(comando.decisaoId).toBe(decisaoId);
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId, comandoId: comando.comandoId, acao: "aprovar" })).status).toBe(200);
  return decisaoId;
}

it("o Nod (a guia, ADR-081) liga, entrevista, encolhe, propõe o bot aprovado por voz, pede o app e a rotina PARA o bot novo, e o onboarding conclui", async () => {
  // Pessoa nova: o onboarding aparece, e o catcher conta como IA pronta.
  const inicio = await srv.json<EstadoOnboarding>("GET", "onboarding");
  // ADR-081: o primeiro GET já cria o Nod da pessoa, e ele é a guia.
  expect(inicio).toMatchObject({ etapa: null, mostrar: true, guia: { nome: "Nod" }, bot: null, passo: "bot", executor: { pronto: true } });
  expect(inicio.modelo.objetivo).toBe("clientes");

  // 'chamando': a guia nasce e a ligação começa iniciada pelo produto, tocando, ANTES do consentimento.
  const chamando = await srv.json<EstadoOnboarding>("POST", "onboarding/etapa", { etapa: "chamando" });
  expect(chamando.etapa).toBe("chamando");
  expect(chamando.guia).toMatchObject({ id: inicio.guia?.id, nome: "Nod" });
  expect(chamando.recusa).toBeNull();
  const ligacao = chamando.ligacao;
  if (!ligacao) throw new Error("sem ligação");
  expect(ligacao).toMatchObject({ estado: "chamando", iniciadaPor: "produto", agenteId: chamando.guia?.id });
  criados.agentes.push(ligacao.agenteId);
  criados.conversas.push(ligacao.conversaId);
  // Repetir 'chamando' não cria outra guia nem outra ligação.
  const denovo = await srv.json<EstadoOnboarding>("POST", "onboarding/etapa", { etapa: "chamando" });
  expect(denovo.ligacao?.id).toBe(ligacao.id);
  expect(denovo.guia?.id).toBe(chamando.guia?.id);

  // Sem o Atender (consentimento), a mídia é recusada: nenhum áudio sobe.
  const antes = abrirMidia(ligacao.id);
  expect(await antes.fechado).toBe(4403);
  // O Atender sem consentimento gravado é recusado.
  expect((await srv.chamar("POST", "onboarding/etapa", { etapa: "entrevista" })).status).toBe(409);
  await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
  const atendida = await srv.json<EstadoOnboarding>("POST", "onboarding/etapa", { etapa: "entrevista" });
  expect(atendida.etapa).toBe("entrevista");

  const cli = abrirMidia(ligacao.id);
  await cli.esperarMsg((m) => m.t === "pronto", "pronto");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.startsWith("Oi! Eu sou o Nod, seu bot fixo aqui no nod."), "primeira fala do roteiro");
  await cli.esperarMsg((m) => m.t === "sugestoes" && m.itens.includes("Me chama de Ana"), "chip do apelido");
  await cli.esperarMsg((m) => m.t === "cerebro" && m.online, "cérebro online", 10_000);

  // A guia fala primeiro (a reação e a próxima pergunta), anota depois e fecha a volta com "ok", que não é falado.
  const responder = (fala: string, campo: string, valor: string, proxima: string) =>
    cli.ws.send(JSON.stringify({ t: "texto", conteudo: `${fala} [[delta: ${proxima}]] [[tool: anotar_entrevista ${JSON.stringify({ campo, valor })}]] [[delta: ok]]` }));

  responder("Me chama de Ana", "apelido", "Ana", "Prazer, Ana. Como você conheceu o nod?");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto === "Como você conheceu o nod?", "a pergunta dita antes da ferramenta é falada", 10_000);
  await cli.esperarMsg((m) => m.t === "onboarding" && m.etapa === "entrevista" && m.campos.apelido === "Ana", "painel com o apelido", 10_000);
  await cli.esperarMsg((m) => m.t === "sugestoes" && m.itens.includes("Um amigo me indicou"), "chips de como conheceu");
  responder("Um amigo me indicou", "como_conheceu", "Indicação", "E o que te fez baixar o nod?");
  await cli.esperarMsg((m) => m.t === "onboarding" && m.campos.comoConheceu === "Indicação", "painel com a origem", 10_000);
  responder("Responder clientes mais rápido", "objetivo", "Responder clientes mais rápido", "Última pergunta, quantas pessoas trabalham com você?");
  await cli.esperarMsg((m) => m.t === "onboarding" && m.campos.objetivo === "Responder clientes mais rápido", "painel com o objetivo", 10_000);
  // Na última pergunta, só a ponte antes da ferramenta; o resumo vem depois dela.
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `Somos uns cinco [[delta: Deixa eu juntar tudo.]] [[tool: anotar_entrevista ${JSON.stringify({ campo: "tamanho_time", valor: "uns cinco" })}]] [[delta: Então, você é Ana. Certo?]]` }));
  await cli.esperarMsg((m) => m.t === "onboarding" && m.campos.tamanhoTime === "2_10", "painel com o time", 10_000);
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto === "Certo?", "o resumo depois da ferramenta é falado", 10_000);
  await cli.esperarMsg((m) => m.t === "sugestoes" && m.itens.includes("Isso mesmo"), "chips do resumo");

  const meio = await srv.json<EstadoOnboarding>("GET", "onboarding");
  expect(meio.campos).toEqual({ apelido: "Ana", comoConheceu: "Indicação", objetivo: "Responder clientes mais rápido", tamanhoTime: "2_10" });
  // O "ok" que fecha cada volta depois de anotar nunca foi falado.
  expect(cli.msgs.some((m) => m.t === "bot-fala" && /^ok[.!]?$/i.test(m.texto))).toBe(false);

  // "Isso mesmo" → concluir_entrevista: a mídia recebe a etapa nova (a tela encolhe para a pílula).
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: "Isso mesmo [[delta: Perfeito. Agora vou te mostrar o nod.]] [[tool: concluir_entrevista {}]] [[delta: ok]]" }));
  await cli.esperarMsg((m) => m.t === "onboarding" && m.etapa === "configurando", "encolhe para a configuração", 10_000);
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("Agora vou te mostrar o nod"), "a transição dita antes de concluir é falada", 10_000);
  expect((await srv.json<EstadoOnboarding>("GET", "onboarding")).etapa).toBe("configurando");

  // propor_bot → card "Novo bot" → leitura e janela → "pode criar" → o bot nasce.
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `bora [[tool: propor_bot ${JSON.stringify({ nome: "Atendente", descricao: "Lê os e-mails de clientes e escreve rascunhos no meu tom." })}]] [[delta: Pensei no Atendente.]]` }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "leitura" && m.texto.includes("Proponho criar um bot"), "leitura do card do bot", 10_000);
  const comCard = await srv.esperar(async () => {
    const e = await srv.json<EstadoOnboarding>("GET", "onboarding");
    return e.pendentes.bot ? e : null;
  }, { nome: "card do bot pendente" });
  expect(comCard.pendentes.bot).toMatchObject({ nome: "Atendente", forma: "shape-triangle", cor: "c-amber" });
  const decisaoBot = await aprovarPorVoz(cli, ligacao.id, 0);
  expect(decisaoBot).toBe(comCard.pendentes.bot?.decisaoId);
  const comBot = await srv.esperar(async () => {
    const e = await srv.json<EstadoOnboarding>("GET", "onboarding");
    return e.bot ? e : null;
  }, { nome: "bot criado" });
  expect(comBot.bot?.nome).toBe("Atendente");
  expect(comBot.passo).toBe("app");
  expect(comBot.pendentes.bot).toBeNull();
  criados.agentes.push(comBot.bot!.id);
  criados.conversas.push(comBot.bot!.conversaId);
  await cli.esperarMsg((m) => m.t === "sugestoes" && m.itens.includes("Conecta aí"), "chip do passo do app", 10_000);

  // pedir_acesso com para_bot: o card de conexão nasce na conversa do bot NOVO (o Gmail ainda não está conectado).
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `[[tool: pedir_acesso ${JSON.stringify({ conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: ["enviar"], para_bot: "Atendente" })}]] [[delta: Agora o Gmail.]]` }));
  const comApp = await srv.esperar(async () => {
    const e = await srv.json<EstadoOnboarding>("GET", "onboarding");
    return e.pendentes.acesso ? e : null;
  }, { nome: "card do app para o bot", timeoutMs: 10_000 });
  expect(comApp.pendentes.acesso).toMatchObject({ app: "gmail", conectar: true });

  // criar_rotina com para_bot: a proposta é do bot novo, na conversa dele; "pode criar" ativa a rotina.
  const rotina = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "liste o que pede resposta hoje", fonte: "Gmail", entregavel: "lista curta", limites_aprovacao: "nada sai sem aprovação", politica_sem_dado: "diga que não houve", para_bot: "Atendente" };
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `[[tool: criar_rotina ${JSON.stringify(rotina)}]] [[delta: Proposta de rotina enviada.]]` }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "leitura" && m.texto.includes("Proponho uma rotina"), "leitura do card da rotina", 10_000);
  await aprovarPorVoz(cli, ligacao.id, 1);
  const comRotina = await srv.esperar(async () => {
    const e = await srv.json<EstadoOnboarding>("GET", "onboarding");
    return e.rotinaCriada ? e : null;
  }, { nome: "rotina do bot novo" });
  expect(comRotina.rotinaCriada?.resumo).toContain("liste o que pede resposta hoje");
  const rotinasDoBot = await srv.json<{ id: string }[] | { rotinas: { id: string; agenteId: string }[] }>("GET", `agentes/${comBot.bot!.id}/rotinas`).catch(() => null);
  if (rotinasDoBot) expect(Array.isArray(rotinasDoBot) ? rotinasDoBot.length : rotinasDoBot.rotinas.length).toBe(1);

  // para_bot com outro nome é recusado (só o bot do onboarding).
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `[[tool: criar_rotina ${JSON.stringify({ ...rotina, para_bot: "Outro" })}]] [[delta: Tentei.]]` }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Tentei"), "a recusa não derruba a ligação", 10_000);

  cli.ws.send(JSON.stringify({ t: "tchau" }));
  await cli.esperarMsg((m) => m.t === "fim", "fim");
  const fim = await srv.json<EstadoOnboarding>("POST", "onboarding/concluir");
  expect(fim).toMatchObject({ etapa: "concluido", mostrar: false });
  expect(fim.concluidoEm).not.toBeNull();
  // Concluído não reabre por um clique atrasado; "Ver o onboarding de novo" (olá) reabre com a mesma guia.
  expect((await srv.chamar("POST", "onboarding/etapa", { etapa: "configurando" })).status).toBe(409);
  const deNovo = await srv.json<EstadoOnboarding>("POST", "onboarding/etapa", { etapa: "ola" });
  expect(deNovo).toMatchObject({ etapa: "ola", mostrar: true, bot: null, passo: "bot", campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } });
  expect(deNovo.guia?.id).toBe(chamando.guia?.id);
  await srv.json("POST", "onboarding/concluir");
}, 90_000);
