# claude-cli-mod

Mod para o Claude Code que adiciona um menu de configuração (`/tools`) e o **modo Zen**: uma faixa de
progresso compacta que acompanha o que o Claude está fazendo, passo a passo.

Mantido por [iagopadilha](https://github.com/iagopadilha).

> **Recomendado: use o TUI em tela cheia (fullscreen) do Claude Code.** É onde o mod funciona da melhor
> maneira: o painel do `/tools` fica encaixado ao lado da transcrição, a largura pedida é respeitada e a faixa do
> Zen acompanha o trabalho. O TUI padrão tem as limitações listadas abaixo.

## O que faz

- **Menu `/tools`** com cinco abas: Zen, Mode, Theme, Status e Config e Contas. Cada seção mostra o valor atual
  (`Atual: ...`) e marca com ✓ a opção escolhida.
- **Modo Zen:** o Claude mostra só as mensagens de texto, e a faixa acima do prompt exibe o título da
  tarefa, uma barra de progresso, a porcentagem, o passo atual e os próximos. Antes de o Claude nomear a
  tarefa, a faixa diz "Pensando…". As cores da faixa são as mesmas do menu (blue, dark, light, green,
  rainbow ou custom).
- **Temas** do Claude Code vindos do [terminalcolors.com](https://terminalcolors.com), com busca, e a opção de
  voltar ao padrão do Claude Code.
- **Modelo, esforço (effort) e modo de permissão**, tanto o da sessão quanto o padrão das próximas sessões.
- **Status line** com modelo, branch, contexto, limites de uso e estado do cache.
- **Idioma** do menu em inglês ou português (na aba Status e Config).
- **Contas:** diz em que conta a sessão roda e se é um token (aberto pelo `cc` do claude-contas) ou o seu
  `/login`; lista os limites de 5h e da semana de todas as contas, quais estão disponíveis e qual é a mais livre.

## Instalação

No Claude Code:

```
/plugin marketplace add iagopadilha/claude-cli-mod
/plugin install claude-cli-mod@iagopadilha-mods
/reload-plugins
```

Para atualizar depois, use o gerenciador de plugins (`/plugin`) e rode `/reload-plugins`.

## Uso

| Comando | O que faz |
| --- | --- |
| `/tools` | Abre ou fecha o menu |
| `/tools zen` · `themes` · `mode` · `status` · `accounts` | Abre direto numa aba |
| `/contas` · `/contas atualizar` | Abre a aba Contas e escreve o resumo; `atualizar` consulta todas as contas de novo |
| `/zen hide` · `/zen show` | Esconde ou mostra os passos da faixa (a primeira linha continua) |
| `/zen off` | Desliga o modo Zen |

No menu: **setas** e **Tab** movem o foco, **Enter** escolhe, **Esc** fecha. O espaço não faz nada enquanto o
menu está aberto e a caixa de texto está vazia. Digitar qualquer coisa fecha o menu e o texto vai para o chat.

### Como o Zen funciona

Com o Zen ligado, o plugin pede ao Claude que monte um plano de 4 a 5 passos (mais em planos longos, como
orquestrações e loops) e atualize a ferramenta `zen_progress` a cada passo que começa ou termina. A barra
sobe conforme os passos são concluídos. A faixa mostra os próximos 5 passos pendentes e conta o resto.

### Como a aba Contas funciona

A aba lê o claude-contas, uma pasta local (padrão `~/Documents/claude-contas`) com `contas.json`, um token por
conta (`claude setup-token`) e o `status.mjs`. O lançador `cc` abre o Claude com o token da conta escolhida e
passa `CLAUDE_CONTA` e `CLAUDE_CONTAS_DIR`, por onde o mod sabe a conta e a pasta.

- **Esta sessão:** `token <conta>` quando há `CLAUDE_CODE_OAUTH_TOKEN` no ambiente (sem `CLAUDE_CONTA`, a conta é
  achada comparando o token com os arquivos do `contas.json`; o token nunca é mostrado nem guardado). Sem token,
  `login <e-mail>` do `~/.claude.json`, e qual conta do claude-contas ele é (campo `email` da conta, ou o nome
  igual à parte antes do `@`).
- **Limites:** o mod roda `node status.mjs --json` ao abrir a sessão e a cada 5 minutos (o claude-contas guarda
  a resposta por 2 minutos). A linha da conta atual usa os números da própria sessão (`ao vivo`), os mesmos da
  status line. Passando de 90% da janela de 5h, um aviso indica a conta mais livre.
- A conta atual também aparece no começo da status line (ou ao lado da dica, com a status line desligada).

## Onde ficam os dados

- Temas baixados: `~/.claude/claude-cli-mod/themes`.
- Ao mudar o modo padrão ou ligar a status line pelo menu, o plugin altera `~/.claude/settings.json` e guarda uma
  cópia do original em `~/.claude/settings.json.claude-cli-mod.bak`.

## Limitações conhecidas

As limitações abaixo aparecem no **TUI padrão** do Claude Code e vêm do próprio Claude Code, não do plugin.
Para o melhor resultado, use o **TUI em tela cheia (fullscreen)**:

- **Suporte limitado ao painel do `/tools` no TUI padrão.** O menu é um painel do Claude Code, e esse modo tem
  suporte reduzido a painéis. Não há uso de mouse, então a navegação é só pelo teclado.
- **Moldura e botão de fechar.** A borda em volta do menu e o ✕ no canto são desenhados pelo Claude Code, na
  largura toda do terminal. Um plugin só controla o conteúdo dentro da moldura (limitado aqui a 58 colunas) e não
  consegue remover nem mover a borda ou o ✕.
- **Altura do menu.** Cada aba pede a altura do seu conteúdo, mas o Claude Code pode ignorar o pedido, por exemplo
  se o painel já foi redimensionado. Em terminais estreitos, linhas de opções podem quebrar. A janela rola
  acompanhando o foco.
- **`[-]` no canto da faixa do Zen.** Esse controle é do Claude Code. Para recolher os passos, use `/zen hide`.
- **A faixa depende do Claude.** Ela só se move quando o Claude chama `zen_progress`. Se ele pular uma
  atualização, a barra pula junto.
- **Modo tela cheia (fullscreen): recomendado.** O painel fica encaixado ao lado da transcrição e a largura
  pedida é respeitada. É o modo em que o mod funciona melhor.

## Desenvolvimento

```
claude plugin test plugins/claude-cli-mod        # testes (22)
claude plugin validate plugins/claude-cli-mod    # carrega e checa o plugin
```

Estrutura:

```
.claude-plugin/marketplace.json          # marketplace "iagopadilha-mods"
plugins/claude-cli-mod/
  hooks/register.tsx                     # hooks, painel, faixa e status line
  hooks/lib/                             # i18n, modos, paleta de temas, status, Zen
  tests/extra-mods.test.tsx
  types/index.d.ts                       # estado do plugin ($.state)
```

Observação: o `claude plugin validate` reclama do prefixo `claude-` no nome do plugin (nomes de terceiros não
deveriam começar assim). A instalação pelo marketplace acima funciona normalmente. Se o nome for um problema no
futuro, a alternativa é renomear o plugin e o comando.

## Créditos

Baseado em um mod liberado publicamente pelo autor original, Jhonatan de Souza, em vídeo no YouTube.
