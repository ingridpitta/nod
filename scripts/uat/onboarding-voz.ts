/**
 * UAT do onboarding por ligação com voz de verdade (definido em 2026-10-04, ADR-077): a Nina liga, o roteiro "atende"
 * (consentimento + etapa entrevista), responde às perguntas falando (frases do `say` em tempo real) e confere que o
 * cérebro anotou os campos (GET onboarding) e que a ligação encolheu para a configuração. Com NOD_EXECUTOR=claude-cli,
 * gasta a assinatura (o modelo da ligação do servidor).
 * Uso: node scripts/uat/onboarding-voz.ts --url http://127.0.0.1:8890
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const i = process.argv.indexOf("--url");
const url = i >= 0 ? process.argv[i + 1]! : "http://127.0.0.1:8890";
const escrever = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const respostas = [
  "Meu nome é Marlon.",
  "Conheci o nod por indicação de um amigo.",
  "Quero que os bots respondam os e-mails dos meus clientes mais rápido.",
  "Somos uns cinco no time.",
  "Isso mesmo, pode seguir.",
];

function pcmDoSay(texto: string): Int16Array {
  const arquivo = join(tmpdir(), `uat-onb-${Date.now()}.wav`);
  execFileSync("say", ["-v", "Luciana", "--file-format=WAVE", "--data-format=LEI16@16000", "-o", arquivo, texto]);
  const b = readFileSync(arquivo);
  const d = b.indexOf("data");
  return new Int16Array(b.buffer.slice(b.byteOffset + d + 8));
}

async function main(): Promise<void> {
  const modo = (await (await fetch(`${url}/api/sessao/modo`)).json()) as { pessoas: { id: string }[] };
  const entrar = await fetch(`${url}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: modo.pessoas[0]!.id }) });
  const cookie = (entrar.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { tenantId } = (await entrar.json()) as { tenantId: string };
  const api = async <T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> => {
    const r = await fetch(`${url}/api/t/${tenantId}/${caminho}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${t}`);
    return JSON.parse(t) as T;
  };
  type Estado = { etapa: string | null; campos: Record<string, string | null>; ligacao: { id: string } | null; recusa: { texto: string } | null; bot: { nome: string } | null };
  // Como o "Ver o onboarding de novo": volta ao olá (quem já concluiu só reabre por ele) e segue.
  await api<Estado>("POST", "onboarding/etapa", { etapa: "ola" });
  let e = await api<Estado>("POST", "onboarding/etapa", { etapa: "chamando" });
  if (!e.ligacao) throw new Error(`a Nina não ligou: ${e.recusa?.texto ?? "?"}`);
  escrever(`📞 a Nina está ligando (ligação ${e.ligacao.id})`);
  await api("POST", "voz/consentimento", { versao: 1 });
  e = await api<Estado>("POST", "onboarding/etapa", { etapa: "entrevista" });
  const ws = new WebSocket(`${url.replace("http", "ws")}/api/t/${tenantId}/voz/v1/midia`, { headers: { cookie, origin: url } });
  const msgs: { em: number; m: Record<string, unknown> }[] = [];
  ws.on("message", (d, bin) => {
    if (bin) {
      const b = d as Buffer;
      const utt = b.readUInt16LE(5);
      setTimeout(() => ws.send(JSON.stringify({ t: "tocou-fim", utt })), 300);
      return;
    }
    const m = JSON.parse(String(d)) as Record<string, unknown>;
    msgs.push({ em: Date.now(), m });
    if (m.t === "bot-fala") escrever(`  🤖 [${String(m.tipo)}] ${String(m.texto)}`);
    if (m.t === "legenda" && m.final) escrever(`  🎤 ${String(m.texto)}`);
    if (m.t === "onboarding" || m.t === "sugestoes") escrever(`  📋 ${JSON.stringify(m)}`);
  });
  await new Promise<void>((ok, j) => { ws.once("open", () => ok()); ws.once("error", j); ws.once("unexpected-response", (_q, r) => j(new Error(`upgrade ${r.statusCode}`))); });
  ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: e.ligacao!.id, entrada: "pcm16", saida: "pcm16" }));
  const esperar = async (f: (m: Record<string, unknown>) => boolean, desde: number, ms: number) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (msgs.some((x) => x.em >= desde && f(x.m))) return true; await dormir(100); }
    return false;
  };
  await esperar((m) => m.t === "cerebro" && m.online === true, 0, 40_000);
  await dormir(6000);
  let seq = 0;
  for (const frase of respostas) {
    const pcm = pcmDoSay(frase);
    const q = Math.ceil(pcm.length / 320);
    for (let k = 0; k < q + 75; k++) {
      const p = k < q ? pcm.subarray(k * 320, k * 320 + 320) : new Int16Array(320);
      const f = Buffer.alloc(645);
      f.writeUInt8(1, 0);
      f.writeUInt32LE(seq++, 1);
      Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(f, 5);
      ws.send(f);
      await dormir(20);
    }
    const desde = Date.now();
    await esperar((m) => m.t === "bot-fala" && m.tipo === "conteudo", desde, 25_000);
    await dormir(5000);
  }
  await esperar((m) => m.t === "onboarding", 0, 20_000);
  e = await api<Estado>("GET", "onboarding");
  escrever(`\netapa: ${e.etapa} · campos: ${JSON.stringify(e.campos)} · bot: ${e.bot?.nome ?? "—"}`);
  ws.send(JSON.stringify({ t: "tchau" }));
  await dormir(1000);
  ws.close();
}

main().catch((er: unknown) => {
  process.stderr.write(`${er instanceof Error ? er.message : String(er)}\n`);
  process.exit(1);
});
