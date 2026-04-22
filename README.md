# Super Secretaria Mind Map

Editor de mind map com geração por IA via Anthropic Claude. O app serve o HTML e o backend no mesmo serviço Node, pronto para Coolify.

## Arquivos principais

- `mind_map_editor_interativo_projeto_administradora.html`: frontend do editor.
- `server.js`: servidor Node com endpoint de IA.
- `package.json`: script de start.
- `Dockerfile`: opção de deploy via Docker.
- `.env.example`: variáveis necessárias.

## Rodar localmente

Crie um arquivo `.env` ou defina a variável no terminal:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-sua-chave-aqui
```

Depois rode:

```bash
npm start
```

Acesse:

```txt
http://localhost:3000
```

Health check:

```txt
http://localhost:3000/health
```

## Configuração no Coolify

Use uma aplicação Node/Nixpacks:

```txt
Build Pack: Nixpacks
Start Command: npm start
Port: 3000
```

Variável obrigatória:

```txt
ANTHROPIC_API_KEY=sk-ant-api03-sua-chave-aqui
```

Variáveis opcionais:

```txt
ALLOWED_ORIGINS=https://seu-dominio.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Configuração no frontend

No editor, clique em `Configurar IA`, selecione `Backend próprio` e use:

```txt
/api/generate-mindmap
```

Se o frontend estiver em outro domínio, use a URL completa:

```txt
https://seu-dominio.com/api/generate-mindmap
```

## Endpoints

- `GET /`: abre o editor.
- `GET /health`: verifica se o backend está online.
- `POST /api/generate-mindmap`: gera mind map.
- `POST /generate-mindmap`: alias do endpoint acima.

Payload:

```json
{
  "text": "Texto para transformar em mind map..."
}
```
