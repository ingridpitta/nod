import type { PlataformaMaquina } from "../contracts/ponte.ts";
import type { UsoDoMac } from "../contracts/raio-x.ts";
import type { LeituraDisco, LeituraMemoria, LeituraProcessador, MotivoEsperaMac, NivelPressao, Trabalho } from "../contracts/trabalho.ts";

/**
 * Memória do Mac (definido em 2026-10-07, ADR-083 §4, #194): o mapa do nível de pressão do macOS e a soma da memória
 * por grupo de processos. Puro: quem lê `sysctl` e `ps` é o adapter (src/adapters/executor/amostrador-memoria.ts).
 */

/**
 * `kern.memorystatus_vm_pressure_level`: 1 = normal (verde), 2 = aviso (amarela), 4 = crítica (vermelha). Qualquer
 * outra coisa (sysctl falhou, fora do macOS, saída estranha) é verde: o aviso nunca nasce de uma leitura que falhou.
 */
export function nivelDaPressao(bruto: string | number | null | undefined): NivelPressao {
  const n = typeof bruto === "number" ? bruto : Number(String(bruto ?? "").trim());
  if (n === 2) return "amarela";
  if (n === 4) return "vermelha";
  return "verde";
}

/**
 * definido em 2026-10-09 (ADR-090): o nível de memória de uma máquina Linux (o motor numa VM), pelo `/proc/meminfo`. O
 * Linux não tem o nível de pressão do macOS; a fração `MemAvailable / MemTotal` faz o papel: amarela abaixo de 20%
 * livres, vermelha abaixo de 10%. Leitura sem os dois campos = verde, nunca um aviso que ninguém mediu.
 */
export function nivelDaMemoriaLinux(meminfo: string): NivelPressao {
  const campo = (nome: string) => Number(new RegExp(`^${nome}:\\s+(\\d+)`, "m").exec(meminfo)?.[1]);
  const total = campo("MemTotal");
  const livre = campo("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0) return "verde";
  const fracao = livre / total;
  if (fracao < 0.1) return "vermelha";
  if (fracao < 0.2) return "amarela";
  return "verde";
}

/** `NOD_SIMULAR_PRESSAO=1|2|4` força o nível (testes e UAT); outro valor ou ausente = ler do sistema. */
export function pressaoSimulada(valor: string | undefined): NivelPressao | null {
  const v = valor?.trim();
  return v === "1" || v === "2" || v === "4" ? nivelDaPressao(v) : null;
}

/**
 * `ps -A -o pgid=,rss=` → RSS somado por grupo, em KiB. O `ps -g` do macOS não filtra por grupo de forma confiável,
 * então a soma é feita aqui. Linha que não tem os dois números é ignorada.
 */
export function somarPorGrupo(saidaPs: string): Map<number, number> {
  const soma = new Map<number, number>();
  for (const linha of saidaPs.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(linha);
    if (!m) continue;
    const grupo = Number(m[1]);
    soma.set(grupo, (soma.get(grupo) ?? 0) + Number(m[2]));
  }
  return soma;
}

/** Uma linha de `ps -A -o pid=,pgid=,rss=` (rss em KiB). */
export type LinhaDoPs = { pid: number; pgid: number; rssKib: number };

export function lerLinhasDoPs(saidaPs: string): LinhaDoPs[] {
  const linhas: LinhaDoPs[] = [];
  for (const linha of saidaPs.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(linha);
    if (m) linhas.push({ pid: Number(m[1]), pgid: Number(m[2]), rssKib: Number(m[3]) });
  }
  return linhas;
}

/**
 * A memória de cada grupo, com os fugitivos (definido em 2026-10-11, ADR-097, fase 0c). O Postgres de teste abre sessão
 * própria e sai do grupo do turno: medido na nod-motor-teste em 11/10, a tela dizia "925 MB" com 5,4 GB em uso. Um
 * processo fora dos grupos dos turnos que `grupoDoFugitivo` reconhece (pela marca NOD_GRUPO do turno) soma no grupo
 * dele. Os outros somam no próprio grupo, como antes.
 */
export function somarComFugitivos(linhas: readonly LinhaDoPs[], gruposDosTurnos: ReadonlySet<number>, grupoDoFugitivo: (pid: number) => number | undefined): Map<number, number> {
  const soma = new Map<number, number>();
  for (const l of linhas) {
    const dono = gruposDosTurnos.has(l.pgid) ? l.pgid : (grupoDoFugitivo(l.pid) ?? l.pgid);
    soma.set(dono, (soma.get(dono) ?? 0) + l.rssKib);
  }
  return soma;
}

/** O valor de NOD_GRUPO num ambiente lido (`/proc/<pid>/environ` ou `ps -E`), ou null. */
export function marcaNoAmbiente(ambiente: string | undefined): string | null {
  for (const t of (ambiente ?? "").split(/\s+/)) if (t.startsWith("NOD_GRUPO=") && t.length > "NOD_GRUPO=".length) return t.slice("NOD_GRUPO=".length);
  return null;
}

const kibParaMb = (kib: number) => Math.round(kib / 1024);

/**
 * A leitura de um turno: o nível, o total dos grupos dos turnos vivos desta máquina e a linha do turno que renova
 * (só se ele tem grupo medido). Turno sem grupo (harness sem `processoProprio`) leva só o nível e o total.
 * ADR-085: `turnoId` null é a leitura da máquina (a do `puxar`), sem linha de turno; o processador vai junto.
 * NOD-93 (ADR-127, definido em 2026-10-24): `blocoMb` é a memória da VM local ligada (2/3/4 GiB pelo modo, teto de 25%
 * da RAM; `memoriaDaVm`). Entra no total como um bloco: com a VM ligada, a memória dela sai do disponível do Mac.
 */
export function leituraDoTurno(p: { nivel: NivelPressao; rssPorGrupo: ReadonlyMap<number, number>; gruposVivos: readonly number[]; turnoId: string | null; grupo: number | null; processador?: LeituraProcessador | null; disco?: LeituraDisco | null; blocoMb?: number }): LeituraMemoria {
  const totalKib = [...new Set(p.gruposVivos)].reduce((t, g) => t + (p.rssPorGrupo.get(g) ?? 0), 0);
  const doTurno = p.grupo !== null ? p.rssPorGrupo.get(p.grupo) : undefined;
  return {
    nivel: p.nivel,
    totalMb: kibParaMb(totalKib) + Math.max(0, Math.round(p.blocoMb ?? 0)),
    porTurno: doTurno !== undefined && p.turnoId !== null ? [{ turnoId: p.turnoId, mb: kibParaMb(doTurno) }] : [],
    ...(p.processador ? { processador: p.processador } : {}),
    // Revisão do #224: `null` vai junto (o app mede e não conseguiu); `undefined` (fora do macOS) não.
    ...(p.disco !== undefined ? { disco: p.disco } : {}),
  };
}

/**
 * Processador (definido em 2026-10-08, ADR-085). `vm.loadavg` do macOS sai como "{ 2.43 2.12 1.98 }": a primeira é a
 * carga média do último minuto. Saída estranha = null (sem leitura, nunca um aviso que a máquina não deu).
 */
export function cargaDoLoadavg(bruto: string): number | null {
  const n = Number(/[\d.]+/.exec(bruto)?.[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A carga por núcleo vira nível. definido em 2026-10-08: amarela a partir de 0,7 (o Mac já disputa processador com o
 * que a pessoa está fazendo) e vermelha a partir de 1,0 (fila de processos esperando núcleo: tudo fica lento). Em 06/10
 * o diário chegou a 265 em 12 núcleos (22 por núcleo) com 8 bots ao mesmo tempo.
 */
export const CARGA_AMARELA = 0.7;
export const CARGA_VERMELHA = 1.0;

export function nivelDoProcessador(carga: number, nucleos: number): LeituraProcessador {
  const porNucleo = nucleos > 0 ? carga / nucleos : 0;
  const arredondada = Math.round(porNucleo * 100) / 100;
  return { nivel: porNucleo >= CARGA_VERMELHA ? "vermelha" : porNucleo >= CARGA_AMARELA ? "amarela" : "verde", carga: arredondada };
}

/**
 * A régua em duas (definido em 2026-10-09, ADR-091, opção C escolhida pelo Marlon). O `vm.loadavg` do macOS conta também
 * quem espera o disco: em 09/10 ele marcava 3,0 por núcleo com os núcleos ~75% ocupados (um `du` em ~250 GB). A régua
 * única dizia "Processador cheio" para um disco engarrafado. Agora são duas:
 * - **processador**: a fração do tempo em que os núcleos trabalharam desde a última amostra (`os.cpus()`, ~30 s) — o
 *   "% de CPU" do Monitor de Atividade. Amarela a partir de 70%, vermelha a partir de 90%;
 * - **fila**: a mesma carga por núcleo de antes, com limiares altos — amarela a partir de 1,5, vermelha a partir de 2,0. Com
 *   os núcleos cheios ela fica perto de 1; acima de 2 há mais gente esperando a vez do que núcleo, quase sempre o disco.
 * Os limiares moram aqui e o servidor recalcula os níveis dos números crus: calibrar não pede app novo.
 */
export const USO_CPU_AMARELO = 0.7;
export const USO_CPU_VERMELHO = 0.9;
/** Histerese do processador (ADR-091): a fração oscila mais que o loadavg; para sair do nível, 5 pontos abaixo. */
export const USO_CPU_SAI_AMARELO = 0.65;
export const USO_CPU_SAI_VERMELHO = 0.85;
export const FILA_AMARELA = 1.5;
export const FILA_VERMELHA = 2.0;

/** Tempos de CPU somados de todos os núcleos (ms), de `os.cpus()`: o ocupado e o total. */
export type TemposCpu = { ocupado: number; total: number };

export function temposDaCpu(cpus: readonly { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): TemposCpu {
  let ocupado = 0;
  let total = 0;
  for (const { times: t } of cpus) {
    ocupado += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { ocupado, total };
}

/** A fração ocupada entre duas leituras (0 a 1, duas casas). Sem tempo entre elas (ou contador que voltou), null. */
export function usoDaCpu(antes: TemposCpu, depois: TemposCpu): number | null {
  const total = depois.total - antes.total;
  const ocupado = depois.ocupado - antes.ocupado;
  if (!(total > 0) || ocupado < 0) return null;
  return Math.round(Math.min(1, ocupado / total) * 100) / 100;
}

export function nivelDoUsoCpu(uso: number, anterior: NivelPressao | null = null): NivelPressao {
  if (uso >= USO_CPU_VERMELHO || (anterior === "vermelha" && uso >= USO_CPU_SAI_VERMELHO)) return "vermelha";
  if (uso >= USO_CPU_AMARELO || ((anterior === "vermelha" || anterior === "amarela") && uso >= USO_CPU_SAI_AMARELO)) return "amarela";
  return "verde";
}

export function nivelDaFila(cargaPorNucleo: number): NivelPressao {
  return cargaPorNucleo >= FILA_VERMELHA ? "vermelha" : cargaPorNucleo >= FILA_AMARELA ? "amarela" : "verde";
}

/**
 * A leitura do processador que o app manda (ADR-091): `uso` e `carga` crus, e `nivel` = o pior dos dois (é o que um
 * servidor anterior lê e usa no portão). Sem `uso` (sem a leitura da CPU), só a fila.
 */
export function leituraDoProcessador(uso: number | null, cargaPorNucleo: number): LeituraProcessador {
  const carga = Math.round(cargaPorNucleo * 100) / 100;
  const fila = nivelDaFila(carga);
  if (uso === null) return { nivel: fila, carga };
  return { nivel: piorNivel(nivelDoUsoCpu(uso), fila) ?? fila, carga, uso };
}

/**
 * Os níveis que o servidor guarda de uma leitura (ADR-091): `processador` (a CPU), `fila` e `portao` (o pior dos dois, o
 * que o portão usa). Com `uso`, recalculados aqui com a histerese do processador (`anterior`). Sem `uso` (app anterior a
 * esta régua), a leitura vale como era: o nível mandado é o do processador e não há fila.
 */
export function niveisDoProcessador(p: LeituraProcessador | undefined, anterior: NivelPressao | null): { processador: NivelPressao | null; fila: NivelPressao | null; portao: NivelPressao | null } {
  if (!p) return { processador: null, fila: null, portao: null };
  if (p.uso === undefined) return { processador: p.nivel, fila: null, portao: p.nivel };
  const processador = nivelDoUsoCpu(p.uso, anterior);
  const fila = nivelDaFila(p.carga);
  return { processador, fila, portao: piorNivel(processador, fila) };
}

const GRAVIDADE: Record<NivelPressao, number> = { verde: 0, amarela: 1, vermelha: 2 };
const peloMenos = (n: NivelPressao | null | undefined, minimo: NivelPressao): boolean => n !== null && n !== undefined && GRAVIDADE[n] >= GRAVIDADE[minimo];

/**
 * Trabalho novo em segundo plano espera? (definido em 2026-10-08, ADR-085). Conversa com a pessoa e ligação nunca
 * passam por aqui (o `reivindicar` só segura trabalho que ainda não começou). Sem leitura de um lado, ele não segura.
 * - pouco: a memória em alerta ou o processador começando a apertar (amarela);
 * - equilibrado: a memória em alerta;
 * - livre: nunca — só o aviso da ADR-083.
 * revisto em 2026-10-11 (ADR-097, fase 1): no equilibrado o processador cheio deixou de segurar. Processador cheio deixa
 * tudo mais lento e não derruba nada; quem o enchia na nod-motor-teste eram os testes que os bots rodavam (rajadas de 1 a 2
 * min), e o portão barrava um agente novo, que gasta ~5% de um núcleo, por causa deles. Ficou no "pouco", que é a escolha
 * da pessoa de deixar o Mac folgado para ela.
 */
export function deveSegurar(uso: UsoDoMac, memoria: NivelPressao | null, processador: NivelPressao | null, regra: RegraDaPlataforma = {}): boolean {
  if (uso === "livre") return false;
  const minimo = nivelQueSegura(regra);
  if (peloMenos(memoria, minimo)) return true;
  return uso === "pouco" && peloMenos(processador, minimo);
}

/**
 * NOD-279 (C15, definido em 2026-10-15, suposição conservadora até a linha de base da VM): a plataforma da máquina que
 * pede trabalho e a regra nova. Com `linuxSoVermelha` (NOD_FUNDO_LINUX_SO_VERMELHA=1, desligada por padrão), numa máquina
 * `linux` memória e processador em amarela NÃO seguram o fundo novo; vermelha segura. O disco e a espera máxima de 1 h
 * (ESPERA_MAXIMA_FUNDO_MS) não mudam. Sem plataforma = `darwin` (o app do Mac anterior ao campo, ADR-090): a regra de antes.
 */
export type RegraDaPlataforma = { plataforma?: PlataformaMaquina | null; linuxSoVermelha?: boolean };

function nivelQueSegura(regra: RegraDaPlataforma): NivelPressao {
  return regra.linuxSoVermelha === true && (regra.plataforma ?? "darwin") === "linux" ? "vermelha" : "amarela";
}

/**
 * definido em 2026-10-08 (ADR-085, revisão do #209): o Mac apertado segura trabalho por no máximo 1 h. Depois ele roda
 * mesmo assim, um por vez (ESPACO_FUNDO_MS): rotina que nunca roda e pedido de colega que nunca volta são piores que
 * um Mac lento por alguns minutos. O log `fundo_comecou` traz a espera de cada um.
 */
export const ESPERA_MAXIMA_FUNDO_MS = 60 * 60_000;

/**
 * definido em 2026-10-08 (ADR-085, revisão do #209): entre dois trabalhos novos em segundo plano no mesmo Mac, 30 s — a
 * batida do amostrador. A leitura é de até 30 s atrás e a carga é a média do último minuto: sem o espaço, quando o Mac
 * alivia, tudo o que esperava começa na mesma leitura verde (o pico de 06/10 de novo).
 */
export const ESPACO_FUNDO_MS = 30_000;

/**
 * O Mac apertado seguraria este trabalho? Em segundo plano (rotina ou pedido de colega), ainda não começou, ninguém
 * esperando por ele (`pessoaEsperando`) e dentro da espera máxima. É a mesma regra do `reivindicar` (turnos.repo.ts).
 * ADA-16 (ADR-163): a tarefa do quadro também, agora que roda em paralelo; mas ela não entra no espaço de 30 s entre
 * trabalhos novos (ESPACO_FUNDO_MS), que a serializaria: sem teto próprio, o freio dela é este portão e o pool de laços.
 */
export function seguravelPeloMac(t: Pick<Trabalho, "origem" | "iniciadoEm" | "criadoEm" | "pessoaEsperando">, agora: number): boolean {
  return (t.origem === "rotina" || t.origem === "colega" || t.origem === "quadro") && t.iniciadoEm === null && t.pessoaEsperando !== true && agora - t.criadoEm < ESPERA_MAXIMA_FUNDO_MS;
}

/** O pior de dois níveis (null = sem leitura). */
export function piorNivel(a: NivelPressao | null, b: NivelPressao | null): NivelPressao | null {
  if (a === null) return b;
  if (b === null) return a;
  return GRAVIDADE[b] > GRAVIDADE[a] ? b : a;
}

/**
 * Disco (definido em 2026-10-09, #219, emenda à ADR-085; revisto no mesmo dia pelo coordenador do épico #221, na
 * ausência do Marlon): dois limites absolutos de espaço livre, num lugar só. Abaixo de 10 GB é ALERTA — trabalho novo em
 * segundo plano espera, como a memória em alerta; abaixo de 3 GB é CRÍTICO — nada novo começa, em qualquer uso (trava de
 * segurança: commit, npm e Postgres falham no meio sem espaço). Sem regra percentual: 5% de 466 GB (23 GB) seguraria um
 * disco grande com folga de sobra. Em 09/10 o Mac do Marlon tinha 17 GB livres de 466 GB: nenhum dos dois.
 */
export const DISCO_ALERTA_MB = 10 * 1024;
export const DISCO_CRITICO_MB = 3 * 1024;
/**
 * Histerese (revisão do #224, definido em 2026-10-09): para sair de um nível o disco precisa passar um pouco do limite —
 * do crítico só acima de 3,5 GB, do alerta só acima de 11 GB. Sem ela, um disco parado perto do limite trocaria de nível a
 * cada leitura de 30 s, e a pílula e o frame `memoria.mudou` piscariam junto.
 */
export const DISCO_SAI_CRITICO_MB = 3.5 * 1024;
export const DISCO_SAI_ALERTA_MB = 11 * 1024;

/**
 * O nível do disco pelo espaço livre: amarela abaixo de 10 GB, vermelha abaixo de 3 GB; com o nível `anterior` (o da
 * leitura passada do mesmo Mac), a histerese acima. Sem leitura válida, null.
 */
export function nivelDoDisco(d: LeituraDisco | null | undefined, anterior: NivelPressao | null = null): NivelPressao | null {
  if (!d || !(d.totalMb > 0) || !(d.livreMb >= 0)) return null;
  if (d.livreMb < DISCO_CRITICO_MB || (anterior === "vermelha" && d.livreMb <= DISCO_SAI_CRITICO_MB)) return "vermelha";
  if (d.livreMb < DISCO_ALERTA_MB || ((anterior === "vermelha" || anterior === "amarela") && d.livreMb <= DISCO_SAI_ALERTA_MB)) return "amarela";
  return "verde";
}

/**
 * `NOD_SIMULAR_DISCO` força a leitura do disco (testes e UAT), em GB: "8" = 8 GB livres de 500; "17/466" = 17 livres de
 * 466. Outro valor ou ausente = ler do sistema.
 */
export function discoSimulado(valor: string | undefined): LeituraDisco | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(valor ?? "");
  if (!m) return null;
  const livre = Number(m[1]);
  const total = m[2] === undefined ? 500 : Number(m[2]);
  return total > 0 && livre <= total ? { livreMb: Math.round(livre * 1024), totalMb: Math.round(total * 1024) } : null;
}

/** `statfs` → MB: o livre é `bavail` (o que um processo sem privilégio pode gravar), não `bfree`. */
export function discoDoStatfs(s: { bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }): LeituraDisco | null {
  const bsize = Number(s.bsize);
  const total = Number(s.blocks) * bsize;
  const livre = Number(s.bavail) * bsize;
  if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0 || livre < 0) return null;
  return { livreMb: Math.floor(livre / 1048576), totalMb: Math.floor(total / 1048576) };
}

/**
 * ADR-096 §6 (definido em 2026-10-11): a tendência do disco. Em 11/10 a VM dos bots perdeu 2 GB numa hora de trabalho, e
 * ninguém soube antes de os bots pararem. O servidor guarda o espaço livre de cada máquina (um ponto a cada 5 min, as
 * últimas 3 h), estima pela reta dos mínimos quadrados quando ele chega ao vermelho (3 GB) e avisa abaixo de 24 h. Menos
 * de 30 min de leituras ou de 3 pontos não dizem nada; disco estável ou que ganhou espaço também não.
 */
export type PontoDoDisco = { em: number; livreMb: number };
export const TENDENCIA_PASSO_MS = 5 * 60_000;
export const TENDENCIA_JANELA_MS = 3 * 3_600_000;
export const TENDENCIA_MINIMA_MS = 30 * 60_000;
export const AVISO_DA_TENDENCIA_MS = 24 * 3_600_000;

/** O histórico com o ponto novo (só se 5 min passaram desde o último), sem o que saiu da janela de 3 h. */
export function comPonto(historico: readonly PontoDoDisco[], ponto: PontoDoDisco): PontoDoDisco[] {
  const ultimo = historico[historico.length - 1];
  const lista = ultimo && ponto.em - ultimo.em < TENDENCIA_PASSO_MS ? [...historico] : [...historico, ponto];
  return lista.filter((p) => ponto.em - p.em <= TENDENCIA_JANELA_MS);
}

/** O que a tela recebe: a estimativa só quando o livre acaba em menos de 24 h (a web só mostra; quem decide é aqui). */
export function acabaLogo(ms: number | null | undefined): number | null {
  return ms !== null && ms !== undefined && ms <= AVISO_DA_TENDENCIA_MS ? ms : null;
}

/** Em quanto tempo o espaço livre chega ao vermelho no ritmo das últimas horas (0 = já chegou), ou null se não cai. */
export function acabaEmMs(historico: readonly PontoDoDisco[], agora: number): number | null {
  const pontos = historico.filter((p) => agora - p.em <= TENDENCIA_JANELA_MS);
  if (pontos.length < 3) return null;
  const primeiro = pontos[0]!;
  const ultimo = pontos[pontos.length - 1]!;
  if (ultimo.em - primeiro.em < TENDENCIA_MINIMA_MS) return null;
  const n = pontos.length;
  const mx = pontos.reduce((s, p) => s + (p.em - primeiro.em), 0) / n;
  const my = pontos.reduce((s, p) => s + p.livreMb, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pontos) {
    const dx = p.em - primeiro.em - mx;
    num += dx * (p.livreMb - my);
    den += dx * dx;
  }
  const inclinacao = den > 0 ? num / den : 0; // MB por ms; negativa = o disco enche
  if (!(inclinacao < 0)) return null;
  if (ultimo.livreMb <= DISCO_CRITICO_MB) return 0;
  return Math.round((ultimo.livreMb - DISCO_CRITICO_MB) / -inclinacao);
}

/**
 * O portão do Mac no `reivindicar` (definido em 2026-10-09, #219, emenda à ADR-085; revisto no mesmo dia pelo
 * coordenador do épico #221), pela leitura de UM Mac:
 * - `tudoNovo`: disco crítico (< 3 GB) — nada novo começa, nem a task da pessoa, nem o "Executar agora"; vale em
 *   qualquer uso, até em "O quanto precisar".
 * - `fundo`: só trabalho novo em segundo plano espera (rotina, pedido de colega, a volta marcada); o que a pessoa pediu
 *   passa. Por memória crítica, disco em alerta, memória em alerta ou processador (`deveSegurar`; desde a ADR-097, só no
 *   "pouco"), nunca em "livre".
 * - `semPrazo`: memória crítica — o segundo plano espera mesmo depois da espera máxima de 1 h.
 * A volta marcada de uma task já começada (ADR-086) só espera pelo disco crítico (revisão do #224: é o próximo passo de
 * algo que já começou).
 * O motivo vai para a linha da task, pela gravidade: disco crítico, memória crítica, disco em alerta, memória em alerta,
 * processador. Sem leitura, nada espera.
 */
export type PortaoDoMac = { fundo: MotivoEsperaMac | null; tudoNovo: MotivoEsperaMac | null; semPrazo: boolean };

const PORTAO_ABERTO: PortaoDoMac = { fundo: null, tudoNovo: null, semPrazo: false };

export function portaoDoMac(uso: UsoDoMac, l: { memoria: NivelPressao | null; processador: NivelPressao | null; discoNivel?: NivelPressao | null } | null, regra: RegraDaPlataforma = {}): PortaoDoMac {
  if (!l) return PORTAO_ABERTO;
  // O nível já vem com a histerese (trabalhos-vivos.ts guarda o anterior de cada Mac).
  const disco = l.discoNivel ?? null;
  if (disco === "vermelha") return { fundo: "disco", tudoNovo: "disco", semPrazo: false };
  if (uso === "livre") return PORTAO_ABERTO;
  if (l.memoria === "vermelha") return { fundo: "memoria", tudoNovo: null, semPrazo: true };
  if (disco === "amarela") return { fundo: "disco", tudoNovo: null, semPrazo: false };
  if (!deveSegurar(uso, l.memoria, l.processador, regra)) return PORTAO_ABERTO;
  return { fundo: peloMenos(l.memoria, nivelQueSegura(regra)) ? "memoria" : "processador", tudoNovo: null, semPrazo: false };
}

/**
 * Por que o Mac segura este trabalho agora (null = não segura). É a regra do `reivindicar` (turnos.repo.ts): com
 * `tudoNovo`, todo trabalho que ainda não começou; com `fundo`, só o que `seguravelPeloMac` aceita (com `semPrazo`,
 * também o que passou da espera máxima). Revisão do #224: a volta marcada vencida ("me chame às 16:00", ADR-086) de task
 * sem turno vivo também, pelo disco crítico (o único que a segura), para a linha dizer "esperando…" em vez de "volta às
 * 16:00" já passado.
 */
export function esperaDoMac(t: Pick<Trabalho, "estado" | "origem" | "iniciadoEm" | "criadoEm" | "pessoaEsperando"> & { acordaEm?: number | null; turnoVivoId?: string | null }, portao: PortaoDoMac, agora: number): MotivoEsperaMac | null {
  if (t.acordaEm != null && t.acordaEm <= agora && !t.turnoVivoId && (t.estado === "rodando" || t.estado === "na_fila")) return portao.tudoNovo;
  if (t.estado !== "na_fila") return null;
  if (portao.tudoNovo && t.iniciadoEm === null) return portao.tudoNovo;
  if (portao.fundo && seguravelPeloMac(portao.semPrazo ? { ...t, criadoEm: agora } : t, agora)) return portao.fundo;
  return null;
}

/** Por que o trabalho espera uma máquina: o portão dela, ou ela sem contato com o servidor (NOD-276, G12). */
export type MotivoEsperaNaMaquina = MotivoEsperaMac | "sem_contato";

/**
 * De qual máquina o trabalho espera, e por quê (definido em 2026-10-09, a tela fala por máquina). O `puxar` de cada
 * máquina decide pela leitura DELA (ponte-interna.ts) e o `reivindicar` só lhe entrega o turno que tem ela como alvo; a
 * tela seguia o pior entre todas e dizia "Seu Mac está ocupado" quando quem estava cheia era a VM.
 * - Com máquina (o alvo do turno, ou o Mac do servidor no modo local): o portão dela; sem leitura dela, nada espera.
 * - Sem máquina (modo compartilhado, bot sem escolha): qualquer uma pega, então ele só espera se TODAS as que mandaram
 *   leitura o seguram; a máquina só é dita quando há uma só.
 */
export function esperaNaMaquina(
  t: Parameters<typeof esperaDoMac>[0],
  maquinaId: string | null,
  portoes: ReadonlyMap<string, PortaoDoMac>,
  agora: number,
  semContatoDesde: (maquinaId: string) => number | null = () => null,
): { motivo: MotivoEsperaNaMaquina; maquinaId: string | null } | null {
  // NOD-276 (definido em 2026-10-15, G12): o trabalho na fila cujo alvo não fala com o servidor espera essa máquina —
  // nenhuma outra o pega (o `reivindicar` só entrega a quem é o alvo). Vem antes do portão: a leitura dela é velha.
  if (maquinaId !== null && t.estado === "na_fila" && semContatoDesde(maquinaId) !== null) return { motivo: "sem_contato", maquinaId };
  if (maquinaId !== null) {
    const portao = portoes.get(maquinaId);
    const motivo = portao ? esperaDoMac(t, portao, agora) : null;
    return motivo ? { motivo, maquinaId } : null;
  }
  const todas = [...portoes].map(([id, p]) => ({ id, motivo: esperaDoMac(t, p, agora) }));
  if (todas.length === 0 || todas.some((x) => x.motivo === null)) return null;
  return { motivo: todas[0]!.motivo!, maquinaId: todas.length === 1 ? todas[0]!.id : null };
}
