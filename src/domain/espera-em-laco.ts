/**
 * O bot esperando com `sleep` no próprio terminal (definido em 2026-10-09, ADR-089, #217). Medido no Mac do Marlon em
 * 09/10: a Cecília esperava o CI com `while :; do gh run list …; sleep 30; done` e o Ze, com laços de `sleep 10/15`. O
 * `claude -p` mantém a entrada aberta enquanto houver comando em segundo plano, então o processo e a memória ficam
 * presos no Mac pelo tempo do laço, sem trabalho. Esperar algo de fora é `me_chame_as` (ADR-086).
 *
 * Nega só o desperdício, nunca o comando demorado de verdade (testes, build, `npm ci`, `docker compose up`): sem teto de
 * tempo, decisão do Marlon em 09/10 (ADR-067). Duas formas:
 *  - laço (`while`, `until`, `for`, `select`) cujo maior `sleep` dentro chega a SLEEP_DE_ESPERA_S — o laço de espera;
 *  - `sleep` fora de laço que, somado no mesmo comando, passa de SLEEP_MAXIMO_S — a espera longa sem laço.
 * revisto em 2026-10-09 (revisão do #223, decisão do coordenador na ausência do Marlon): a primeira versão negava todo
 * `while`/`until` com `sleep`, e com isso negava trabalho de verdade — `until pg_isready; do sleep 1; done`, o
 * `docker compose ps | grep healthy` com `sleep 2`, um lote com `sleep 1` por limite de API, o uso normal do Monitor.
 * Laço de `sleep` curto é esperar algo local subir; quem espera o CI dorme 10 s ou mais (medido: 30 s, 10 s, 15 s). E o
 * laço dentro de `timeout N` com N até TIMEOUT_QUE_LIMITA_S passa inteiro: o próprio comando já tem fim.
 *
 * A leitura é de shell, não de texto: palavra entre aspas, comentário e corpo de heredoc são dados (a mensagem de commit
 * que fala em "sleep 90" passa). Entra no que o shell RODA: `$(…)`, crase, `bash -c '…'`, `eval '…'` e o heredoc dado a um
 * shell (`bash <<EOF`). Guarda contra o hábito, não contra quem quer esconder: um script num arquivo não é aberto.
 * Puro.
 */

/** definido em 2026-10-09 (#217, proposta da issue): um minuto. Acima disso a espera é de algo de fora, e a volta marcada é o caminho. */
export const SLEEP_MAXIMO_S = 60;
/**
 * definido em 2026-10-09 (revisão do #223): o `sleep` dentro de um laço a partir do qual o laço é de espera. Os medidos em
 * 09/10 dormiam 10, 15 e 30 s; o laço que espera algo local subir dorme 1–2 s. Para voltar atrás (negar todo laço com
 * sleep), use 0.
 */
export const SLEEP_DE_ESPERA_S = 10;
/** definido em 2026-10-09 (revisão do #223): `timeout N` até 10 min limita o comando; laço lá dentro tem fim garantido. */
export const TIMEOUT_QUE_LIMITA_S = 600;

export type EsperaEmLaco = { tipo: "laco_com_sleep"; segundos: number } | { tipo: "sleep_longo"; segundos: number };

type Palavra = { valor: string; literal: boolean };
/** `laco`: algum laço fechou com sleep de espera. Vale para a análise inteira, inclusive dentro de `bash -c` e `$(…)`. */
type Achado = { laco: boolean; maiorLaco: number };
/** O que um pedaço de shell devolve a quem o contém: o maior sleep em qualquer lugar, e a soma dos que ficam fora de laço. */
type Sono = { maior: number; soma: number };

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
/** Palavras reservadas que podem vir antes do comando de um segmento. */
const PREFIXOS = new Set(["do", "then", "else", "elif", "if", "!", "{", "}", "time"]);
/** Prefixos que rodam o comando seguinte: `nohup sleep 300` é o mesmo sleep. */
const EMBRULHOS = new Set(["nohup", "exec", "command", "builtin", "nice", "caffeinate"]);
/** definido em 2026-10-09: profundidade de `bash -c "$(…)"` dentro de outro; mais fundo que isso não é hábito. */
const PROFUNDIDADE_MAXIMA = 6;

function nomeDoPrograma(p: string): string {
  const barra = p.lastIndexOf("/");
  return barra >= 0 ? p.slice(barra + 1) : p;
}

/** `30`, `1.5`, `2m`, `1h`, `1d`, `infinity`; null para o que não é número (variável, opção). */
function segundosDoSleep(arg: string): number | null {
  if (arg === "inf" || arg === "infinity") return Number.POSITIVE_INFINITY;
  const m = /^(\d+(?:\.\d*)?|\.\d+)([smhd]?)$/.exec(arg);
  if (!m) return null;
  const n = Number(m[1]);
  const fator = m[2] === "m" ? 60 : m[2] === "h" ? 3_600 : m[2] === "d" ? 86_400 : 1;
  return n * fator;
}

/** Fecha o `$(`/`<(` aberto em `inicio` (logo depois do parêntese) e devolve o índice do `)` que fecha. */
function fimDoParentese(texto: string, inicio: number): number {
  let nivel = 1;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]!;
    if (c === "\\") { i++; continue; }
    if (c === "'") { const f = texto.indexOf("'", i + 1); if (f < 0) return texto.length; i = f; continue; }
    if (c === '"') {
      let j = i + 1;
      for (; j < texto.length && texto[j] !== '"'; j++) if (texto[j] === "\\") j++;
      i = j;
      continue;
    }
    if (c === "(") nivel++;
    if (c === ")" && --nivel === 0) return i;
  }
  return texto.length;
}

function fimDaCrase(texto: string, inicio: number): number {
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "\\") { i++; continue; }
    if (texto[i] === "`") return i;
  }
  return texto.length;
}

function analisar(texto: string, profundidade: number, achado: Achado): Sono {
  const sono: Sono = { maior: 0, soma: 0 };
  if (profundidade > PROFUNDIDADE_MAXIMA) return sono;
  /** Pilha dos laços abertos, cada um com o maior sleep visto dentro dele. */
  const lacos: { maior: number }[] = [];
  const dormiu = (segundos: number, foraDeLaco: number) => {
    sono.maior = Math.max(sono.maior, segundos);
    if (lacos.length === 0) sono.soma += foraDeLaco;
    for (const l of lacos) l.maior = Math.max(l.maior, segundos);
  };
  const fecharLaco = (l: { maior: number } | undefined) => {
    if (l && l.maior >= SLEEP_DE_ESPERA_S && l.maior > 0) {
      achado.laco = true;
      achado.maiorLaco = Math.max(achado.maiorLaco, l.maior);
    }
  };
  let segmento: Palavra[] = [];
  let redirecionados = new Set<number>();
  let atual = "";
  let temAtual = false;
  let literal = false;
  let proximaERedirecionamento = false;
  const heredocs: { delimitador: string; tirarTabs: boolean; segmento: Palavra[] }[] = [];

  const sub = (conteudo: string) => {
    const r = analisar(conteudo, profundidade + 1, achado);
    dormiu(r.maior, r.soma);
  };

  const fecharPalavra = () => {
    if (!temAtual) return;
    if (proximaERedirecionamento) {
      redirecionados.add(segmento.length);
      proximaERedirecionamento = false;
    }
    segmento.push({ valor: atual, literal });
    atual = "";
    temAtual = false;
    literal = false;
  };

  /** O comando do segmento, depois dos prefixos (palavras reservadas, `X=1`, embrulhos). Mexe na pilha dos laços. */
  const fecharSegmento = () => {
    fecharPalavra();
    const palavras = segmento.filter((_, i) => !redirecionados.has(i));
    segmento = [];
    redirecionados = new Set();
    proximaERedirecionamento = false;
    let i = 0;
    for (; i < palavras.length; i++) {
      const p = palavras[i]!;
      if (p.literal) break;
      if (p.valor === "while" || p.valor === "until") { lacos.push({ maior: 0 }); continue; }
      if (p.valor === "for" || p.valor === "select" || p.valor === "case") {
        if (p.valor !== "case") lacos.push({ maior: 0 });
        return; // o resto é o cabeçalho (`for x in a b`), não comando
      }
      if (p.valor === "done") { fecharLaco(lacos.pop()); continue; }
      if (p.valor === "esac" || PREFIXOS.has(p.valor)) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(p.valor)) continue;
      break;
    }
    // Embrulhos: `nohup`, `env X=1`, `timeout 600` rodam o comando que vem depois.
    while (i < palavras.length) {
      const nome = nomeDoPrograma(palavras[i]!.valor);
      if (EMBRULHOS.has(nome)) {
        i++;
        while (i < palavras.length && palavras[i]!.valor.startsWith("-")) i += palavras[i]!.valor === "-n" ? 2 : 1;
        continue;
      }
      if (nome === "env") {
        i++;
        while (i < palavras.length && (palavras[i]!.valor.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(palavras[i]!.valor))) i++;
        continue;
      }
      if (nome === "timeout" || nome === "gtimeout") {
        i++;
        while (i < palavras.length && palavras[i]!.valor.startsWith("-")) i += ["-s", "-k", "--signal", "--kill-after"].includes(palavras[i]!.valor) ? 2 : 1;
        const duracao = segundosDoSleep(palavras[i]?.valor ?? "");
        // Revisão do #223: com fim garantido em até 10 min, o que roda lá dentro não é espera sem fim. `timeout 0` desliga o
        // limite (GNU) e não libera nada. A duração aceita os sufixos s/m/h/d do coreutils.
        if (duracao !== null && duracao > 0 && duracao <= TIMEOUT_QUE_LIMITA_S) return;
        i++;
        continue;
      }
      break;
    }
    const programa = palavras[i];
    if (!programa) return;
    const nome = nomeDoPrograma(programa.valor);
    const args = palavras.slice(i + 1).map((p) => p.valor);
    if (nome === "sleep") {
      const segundos = args.map(segundosDoSleep).filter((s): s is number => s !== null).reduce((a, b) => a + b, 0);
      dormiu(segundos, segundos);
      return;
    }
    if (SHELLS.has(nome)) {
      const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
      if (c >= 0 && args[c + 1] !== undefined) sub(args[c + 1]!);
      return;
    }
    if (nome === "eval") sub(args.join(" "));
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    const prox = texto[i + 1] ?? "";
    if (c === "\\") {
      if (prox === "\n") { i++; continue; } // continuação de linha
      atual += prox;
      temAtual = true;
      literal = true;
      i++;
      continue;
    }
    if (c === "'") {
      const fim = texto.indexOf("'", i + 1);
      const f = fim < 0 ? texto.length : fim;
      atual += texto.slice(i + 1, f);
      temAtual = true;
      literal = true;
      i = f;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < texto.length && texto[j] !== '"'; j++) {
        const d = texto[j]!;
        if (d === "\\") { atual += texto[j + 1] ?? ""; j++; continue; }
        if (d === "$" && texto[j + 1] === "(" && texto[j + 2] !== "(") {
          const f = fimDoParentese(texto, j + 2);
          sub(texto.slice(j + 2, f));
          j = f;
          continue;
        }
        if (d === "`") {
          const f = fimDaCrase(texto, j + 1);
          sub(texto.slice(j + 1, f));
          j = f;
          continue;
        }
        atual += d;
      }
      temAtual = true;
      literal = true;
      i = j;
      continue;
    }
    if (c === "$" && prox === "(") {
      // `$((…))` é conta, não comando.
      const f = fimDoParentese(texto, i + 2);
      if (texto[i + 2] !== "(") sub(texto.slice(i + 2, f));
      temAtual = true;
      literal = true;
      i = f;
      continue;
    }
    if (c === "$" && prox === "{") {
      const f = texto.indexOf("}", i + 2);
      atual += texto.slice(i, f < 0 ? texto.length : f + 1);
      temAtual = true;
      literal = true;
      i = f < 0 ? texto.length : f;
      continue;
    }
    if (c === "`") {
      const f = fimDaCrase(texto, i + 1);
      sub(texto.slice(i + 1, f));
      temAtual = true;
      literal = true;
      i = f;
      continue;
    }
    if (c === "#" && !temAtual) {
      const f = texto.indexOf("\n", i);
      i = (f < 0 ? texto.length : f) - 1;
      continue;
    }
    if ((c === "<" || c === ">") && prox === "(") {
      fecharPalavra();
      const f = fimDoParentese(texto, i + 2);
      sub(texto.slice(i + 2, f));
      i = f;
      continue;
    }
    if (c === "<" && prox === "<" && texto[i + 2] !== "<") {
      // heredoc: o delimitador é a palavra seguinte; o corpo começa na próxima linha.
      fecharPalavra();
      let j = i + 2;
      const tirarTabs = texto[j] === "-";
      if (tirarTabs) j++;
      while (texto[j] === " " || texto[j] === "\t") j++;
      let delimitador = "";
      for (; j < texto.length && !/[\s;&|<>()]/.test(texto[j]!); j++) if (texto[j] !== "'" && texto[j] !== '"' && texto[j] !== "\\") delimitador += texto[j];
      if (delimitador !== "") heredocs.push({ delimitador, tirarTabs, segmento });
      i = j - 1;
      continue;
    }
    if (c === "<" || c === ">") {
      // `2>` / `2>&1`: o descritor grudado é parte do redirecionamento, e a palavra seguinte é o alvo.
      if (/^\d+$/.test(atual) && !literal) { atual = ""; temAtual = false; }
      fecharPalavra();
      let j = i + 1;
      while (texto[j] === ">" || texto[j] === "<" || texto[j] === "&" || texto[j] === "|") j++;
      i = j - 1;
      proximaERedirecionamento = true;
      continue;
    }
    if (c === "&" && prox === ">") {
      fecharPalavra();
      i++;
      if (texto[i + 1] === ">") i++;
      proximaERedirecionamento = true;
      continue;
    }
    if (c === " " || c === "\t") { fecharPalavra(); continue; }
    if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      fecharSegmento();
      if (c === "\n" && heredocs.length > 0) {
        // Os corpos dos heredocs da linha: dados, a não ser que o comando seja um shell (`bash <<EOF`).
        let linhaInicio = i + 1;
        for (const h of heredocs.splice(0)) {
          const corpo: string[] = [];
          while (linhaInicio < texto.length) {
            const fimLinha = texto.indexOf("\n", linhaInicio);
            const linha = texto.slice(linhaInicio, fimLinha < 0 ? texto.length : fimLinha);
            linhaInicio = fimLinha < 0 ? texto.length : fimLinha + 1;
            if ((h.tirarTabs ? linha.replace(/^\t+/, "") : linha) === h.delimitador) break;
            corpo.push(linha);
          }
          const primeiro = h.segmento.find((p) => !p.literal && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(p.valor) && !PREFIXOS.has(p.valor));
          if (primeiro && SHELLS.has(nomeDoPrograma(primeiro.valor))) sub(corpo.join("\n"));
        }
        i = linhaInicio - 1;
      }
      continue;
    }
    atual += c;
    temAtual = true;
  }
  fecharSegmento();
  // Laço sem `done` (comando cortado) conta como fechado.
  while (lacos.length > 0) fecharLaco(lacos.pop());
  return sono;
}

/** O laço ou a espera longa no comando, ou null. */
export function esperaEmLaco(comando: string): EsperaEmLaco | null {
  const achado: Achado = { laco: false, maiorLaco: 0 };
  const sono = analisar(comando, 0, achado);
  if (achado.laco) return { tipo: "laco_com_sleep", segundos: achado.maiorLaco };
  if (sono.soma > SLEEP_MAXIMO_S) return { tipo: "sleep_longo", segundos: sono.soma };
  return null;
}

/**
 * O que o modelo lê na negação. Com `me_chame_as` no catálogo do turno, ele é o caminho; sem ele (sala, ligação), o turno
 * encerra dizendo o que falta. Nos dois casos fica dito o que continua livre, para o bot não largar o comando de verdade.
 */
export function motivoDaEsperaNegada(espera: EsperaEmLaco, comMeChameAs: boolean, comEsperarComando = false): string {
  const tempo = Number.isFinite(espera.segundos) ? `${Math.round(espera.segundos)} s` : "tempo sem fim";
  const oQue = espera.tipo === "laco_com_sleep" ? `laço de espera com sleep de ${tempo}` : `sleep de ${tempo}`;
  const local = `Para algo que você mesmo subiu neste Mac (um servidor local, um banco), um laço com sleep curto (abaixo de ${SLEEP_DE_ESPERA_S} s) ou dentro de timeout de até ${TIMEOUT_QUE_LIMITA_S / 60} min roda normalmente, como todo comando demorado de verdade (testes, build, npm ci).`;
  // revisto em 2026-10-12 (ADR-099, parte 2): com esperar_comando no catálogo, a espera de CI e deploy é um comando que o
  // Nod roda fora deste turno; me_chame_as fica para hora marcada.
  if (comEsperarComando) {
    return `${oQue} segura este processo no Mac sem trabalho. Para esperar algo de fora (a CI, um deploy), chame esperar_comando com um comando que só termina quando a espera acabar (gh pr checks <n> --watch, gh run watch <id>) e o que está esperando, e encerre o turno: o Nod roda o comando e você volta nesta mesma sessão quando ele terminar. Sem comando que acompanhe (a resposta de alguém), use me_chame_as. ${local}`;
  }
  if (comMeChameAs) {
    return `${oQue} segura este processo no Mac sem trabalho. Para esperar algo de fora (o CI, um deploy, a resposta de alguém), chame me_chame_as com em quantos minutos voltar e o que vai conferir, diga em uma frase o que está esperando e encerre o turno: você volta sozinho nesta mesma sessão. ${local}`;
  }
  return `${oQue} segura este processo no Mac sem trabalho, e neste turno não há como marcar uma volta. Não espere aqui: encerre o turno dizendo o que falta e o que precisa ser conferido depois. ${local}`;
}
