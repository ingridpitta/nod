/**
 * NOD-95 (ADR-138, 30/10): o ensaio de ponta a ponta da tela ao vivo contra um servidor já no ar, com login stub. Manual:
 * entra como a pessoa, acorda o computador se preciso, abre a tela do bot (observar), assume o controle, abre o
 * WebSocket ao vivo e espera o VNC falar ("RFB 003.008"); responde a versão e confere a lista de segurança (bytes nos
 * dois sentidos). No fim devolve o controle. Não roda em CI. ATENÇÃO: assume e devolve o computador REAL ligado ao
 * servidor apontado; fora do loopback exige NOD_ENSAIO_REMOTO=1 (o login stub só sobe em loopback, então produção recusa).
 *
 * Uso: node scripts/ensaio-computador/vivo.ts --api http://127.0.0.1:8889 --tenant <uuid> --pessoa <uuid> --agente <uuid>
 */
import WebSocket from "ws";

let o: ReturnType<typeof lerOpcoes>;
const t0 = Date.now();
const log = (m: string) => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);

type Resposta = { status: number; json: Record<string, unknown> | null };
let cookie = "";
async function pedir(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const r = await fetch(`${o.api}${caminho}`, { method: metodo, headers: { "content-type": "application/json", cookie, origin: o.api }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0]!;
  let json: Record<string, unknown> | null = null;
  try { json = (await r.json()) as Record<string, unknown>; } catch { /* sem corpo */ }
  return { status: r.status, json };
}

export function lerOpcoes(argv: string[]): { api: string; tenant: string; pessoa: string; agente: string } {
  const r = { api: process.env.NOD_ENSAIO_API ?? "http://127.0.0.1:8889", tenant: "", pessoa: "", agente: "" };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!.replace(/^--/, "") as keyof typeof r;
    const v = argv[i + 1];
    if (!(k in r) || v === undefined) throw new Error(`opção inválida: ${argv[i]} (use --api --tenant --pessoa --agente)`);
    r[k] = v;
  }
  if (!r.tenant || !r.pessoa || !r.agente) throw new Error("faltam --tenant, --pessoa e --agente");
  return r;
}

type TelaDoEnsaio = { agenteId?: string; controle?: string; ajuda?: unknown };
/**
 * Revisão independente (PR 602): o bot que pediu ajuda (aguardando_pessoa) espera a pessoa de verdade. O assumir e o
 * devolver do ensaio fechariam o pedido e retomariam o turno com "Concluí o passo no computador", que ninguém fez.
 */
export function recusaDoEnsaio(telas: readonly TelaDoEnsaio[], agente: string): string | null {
  const t = telas.find((x) => x.agenteId === agente);
  if (t?.controle === "aguardando_pessoa" || (t?.ajuda !== undefined && t.ajuda !== null)) return "o bot pediu ajuda e espera a pessoa; o ensaio não responde por ela.";
  return null;
}

type Pedir = (metodo: string, caminho: string, corpo?: unknown) => Promise<Resposta>;
/**
 * Rodada 3 da revisão: as telas da pessoa, ou a recusa. Fecha na dúvida: sem 200 ou sem a lista, o ensaio não segue
 * (não dá para saber se o bot espera a pessoa).
 */
export async function conferirTelas(pedir: Pedir, base: string, agente: string, exigirTela = false): Promise<{ telas: TelaDoEnsaio[] } | { falha: string; codigo: number }> {
  const r = await pedir("GET", `${base}/computador`);
  if (r.status !== 200 || !Array.isArray(r.json?.telas)) return { falha: `Recusado: o computador não respondeu as telas (${r.status}); sem saber se o bot pediu ajuda, o ensaio não segue.`, codigo: 2 };
  const telas = r.json.telas as TelaDoEnsaio[];
  // Rodada 4: depois do observar a tela do bot tem de estar na lista; sem ela não dá para saber se ele pediu ajuda.
  if (exigirTela && !telas.some((t) => t.agenteId === agente)) return { falha: "Recusado: a tela do bot não apareceu nas telas da pessoa; o ensaio não segue.", codigo: 2 };
  const recusa = recusaDoEnsaio(telas, agente);
  return recusa ? { falha: `Recusado: ${recusa}`, codigo: 2 } : { telas };
}

/**
 * Do login ao assumir: confere o pedido de ajuda antes de tudo (o observar pode acordar a máquina real), abre a tela do
 * bot e confere de novo logo antes do assumir (o bot pode ter pedido ajuda no meio). Devolve as telas da 2ª conferência.
 */
export async function prepararEnsaio(pedir: Pedir, base: string, agente: string, anotar: (m: string) => void, pausa = 3000): Promise<{ telas: TelaDoEnsaio[] } | { falha: string; codigo: number }> {
  const antes = await conferirTelas(pedir, base, agente);
  if ("falha" in antes) return antes;
  let obs: Resposta | null = null;
  for (let i = 0; i < 60; i++) {
    obs = await pedir("POST", `${base}/agentes/${agente}/computador/acoes`, { tipo: "observar" });
    if (obs.status === 200) break;
    const pc = await pedir("GET", `${base}/computador`);
    const estado = pc.json?.estado as string | undefined;
    anotar(`observar: ${obs.status} · computador ${estado}`);
    if (estado === "dormindo" || estado === "fora_do_ar") await pedir("POST", `${base}/computador`, { operacao: estado === "dormindo" ? "acordar" : "tentar_de_novo" });
    await new Promise((r) => setTimeout(r, pausa));
  }
  if (obs?.status !== 200) return { falha: "a tela não abriu", codigo: 1 };
  return conferirTelas(pedir, base, agente, true);
}

async function main(): Promise<void> {
  if (process.env.CI && process.env.CI !== "false" && process.env.CI !== "0") { log("Recusado: o ensaio da tela ao vivo não roda em CI."); process.exitCode = 2; return; }
  o = lerOpcoes(process.argv.slice(2));
  const host = new URL(o.api).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) && process.env.NOD_ENSAIO_REMOTO !== "1") {
    log(`Recusado: ${host} não é loopback; o ensaio mexe no computador real. Use NOD_ENSAIO_REMOTO=1 se é isso mesmo.`);
    process.exitCode = 2;
    return;
  }
  const entrar = await pedir("POST", "/api/sessao/entrar", { pessoaId: o.pessoa });
  log(`entrar: ${entrar.status}`);
  if (entrar.status >= 300 || !cookie) { log("o login stub não respondeu (NOD_LOGIN=stub no servidor?)"); process.exitCode = 1; return; }
  const base = `/api/t/${o.tenant}`;
  const preparo = await prepararEnsaio(pedir, base, o.agente, log);
  if ("falha" in preparo) { log(preparo.falha); process.exitCode = preparo.codigo; return; }
  const { telas } = preparo;
  const jaEraDaPessoa = telas.some((t) => t.agenteId === o.agente && t.controle === "pessoa");
  const assumir = await pedir("POST", `${base}/agentes/${o.agente}/computador`, { operacao: "assumir" });
  log(`assumir: ${assumir.status}${jaEraDaPessoa ? " (a pessoa já estava no controle)" : ""}`);
  if (assumir.status >= 300) { log("não assumiu; nada a devolver"); process.exitCode = 1; return; }
  const devolver = async () => {
    if (jaEraDaPessoa) return;
    log(`devolver: ${(await pedir("POST", `${base}/agentes/${o.agente}/computador`, { operacao: "devolver" })).status}`);
  };
  // Ctrl+C no meio não deixa o computador real com a pessoa: devolve e sai.
  const aoInterromper = () => { void devolver().finally(() => process.exit(130)); };
  process.once("SIGINT", aoInterromper);
  process.once("SIGTERM", aoInterromper);
  let resultado: { ok: boolean; motivo?: string } = { ok: false, motivo: "não chegou ao VNC" };
  try {
    resultado = await ensaiarVnc(base);
  } finally {
    process.off("SIGINT", aoInterromper);
    process.off("SIGTERM", aoInterromper);
    log(`resultado: ${JSON.stringify(resultado)}`);
    await devolver();
  }
  process.exitCode = resultado.ok ? 0 : 1;
}

/** Abre o WebSocket ao vivo e faz o começo do handshake RFB. */
async function ensaiarVnc(base: string): Promise<{ ok: boolean; motivo?: string }> {
  const url = new URL(`${o.api}${base}/agentes/${o.agente}/computador/vivo`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, { headers: { cookie, origin: o.api } });
  ws.binaryType = "nodebuffer";
  const recebidos: Buffer[] = [];
  const resultado = await new Promise<{ ok: boolean; motivo?: string }>((resolve) => {
    const prazo = setTimeout(() => resolve({ ok: false, motivo: "90 s sem o VNC" }), 90_000);
    ws.on("open", () => log("websocket ao vivo aberto; esperando o VNC…"));
    ws.on("unexpected-response", (_q, res) => { clearTimeout(prazo); resolve({ ok: false, motivo: `upgrade recusado: ${res.statusCode}` }); });
    ws.on("error", (e) => { clearTimeout(prazo); resolve({ ok: false, motivo: e.message }); });
    ws.on("close", (c, r) => { clearTimeout(prazo); resolve({ ok: false, motivo: `fechou: ${c} ${r.toString()}` }); });
    // 1º: a versão ("RFB 003.008\n", 12 bytes); depois, a lista de segurança: o 1º byte é quantos tipos (0 = recusa).
    let respondeu = false;
    ws.on("message", (d) => {
      recebidos.push(Buffer.from(d as Buffer));
      const tudo = Buffer.concat(recebidos);
      if (!respondeu) {
        if (tudo.length < 12) return;
        if (!tudo.toString("latin1").startsWith("RFB ")) { clearTimeout(prazo); resolve({ ok: false, motivo: "não é VNC" }); return; }
        log(`o VNC falou: ${JSON.stringify(tudo.toString("latin1").slice(0, 12))}`);
        respondeu = true;
        ws.send(Buffer.from("RFB 003.008\n"), { binary: true });
        if (tudo.length === 12) return;
      }
      const lista = tudo.subarray(12);
      if (!lista.length) return;
      clearTimeout(prazo);
      resolve(lista[0]! > 0 ? { ok: true } : { ok: false, motivo: "o VNC recusou (sem tipos de segurança)" });
    });
  });
  try { ws.close(); } catch { /* já fechado */ }
  return resultado;
}

if (process.argv[1]?.endsWith("vivo.ts")) await main().catch((e: unknown) => { log(`falhou: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
