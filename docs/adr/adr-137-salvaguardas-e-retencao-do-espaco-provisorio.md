# ADR-137 — Salvaguardas e retenção do espaço provisório público

Status: proposta — validação jurídica pendente · Data: 2026-10-28 · Issue: NOD-408 · Emenda proposta a [ADR-124](adr-124-identidade-progressiva-uso-sem-conta-e-conversao.md).

## Contexto

O espaço provisório público entrou no ar com limites por IP e hora, mas sem teto por espaço, desafio contra criação em
massa nem uma decisão explícita de privacidade e retenção. Isso permite gasto sem conversão e automação barata.

## Decisão

`NOD_PROVISORIO_COTA_TURNOS=N` limita turnos novos do espaço sem conta. Retomadas, repetições e a continuação de um
turno já iniciado passam, para não deixar trabalho pela metade. No teto, o servidor responde 429 com texto fixo que
preserva a fala no campo e convida a criar conta. Converter o espaço remove o teto sem perder conteúdo.

`NOD_ANTIABUSO=1` mantém os limites existentes e acrescenta: três espaços novos por IP/hora sem desafio; depois disso,
cada criação exige SHA-256 com 16 bits zero sobre desafio assinado, amarrado ao IP, válido por dois minutos e de uso
único; quarenta espaços por IP/dia; quarenta cadastros por IP/dia; e sessenta pedidos por domínio/hora no cadastro e na
recuperação, em janelas deslizantes. O domínio só conta depois da posse provada no cadastro ou para conta existente na
recuperação. Provedores públicos de e-mail não compartilham o teto de domínio. O servidor continua dando resposta
neutra na recuperação e nunca guarda IP, e-mail ou desafio em claro nas chaves dos contadores (HMAC).

As duas salvaguardas são flags independentes, desligadas por padrão e exigem `NOD_BOOTSTRAP=1`. A admissão de turno
novo é serializada por espaço com trava transacional: um burst no último lugar não passa do teto.

## LGPD e retenção

A base legal proposta para o espaço provisório é execução de medidas pré-contratuais pedidas pela pessoa; para os
controles de segurança, legítimo interesse restrito à prevenção de fraude e segurança. A redação pública candidata
deve dizer que o Nod guarda o conteúdo no espaço para prestar o serviço, usa sinais técnicos para limitar abuso e
recomenda criar conta para manter o acesso. Ela não vai a `/privacidade` ou `/termos` antes da validação jurídica.

O espaço provisório não convertido é retido enquanto a instalação puder voltar a ele; apagar automaticamente agora
quebraria a promessa de continuidade da ADR-124. A conta por e-mail segue a retenção e a exclusão descritas em
`/privacidade`, `/termos` e ADR-126: pedido de exclusão, arrependimento de 30 dias e purga quando a flag correspondente
estiver ligada. Contadores de abuso não são identificadores reversíveis sem o segredo do servidor; o varredor roda a
poda global a cada hora e remove janelas com mais de 48 horas, inclusive desafios de uso único sem nova requisição.
Antes de ampliar o lançamento, jurídico/produto deve confirmar a redação e definir prazo de inatividade para apagar
espaços provisórios abandonados; até lá, não se promete prazo que o produto ainda não executa.

## Operação e reversão

Os passos e a reversão ficam em `docs/deploy-gcp.md`. Esvaziar `NOD_PROVISORIO_COTA_TURNOS` e `NOD_ANTIABUSO` e fazer
deploy desliga os portões sem apagar espaços, contas ou conversas. `NOD_BOOTSTRAP` vazio fecha também a criação de
novos espaços.
