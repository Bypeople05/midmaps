import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const INDEX_FILE = 'mind_map_editor_interativo_projeto_administradora.html';
const MAX_BODY_BYTES = 1_000_000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function getCorsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
    ? (origin || '*')
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body muito grande.'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function buildPrompt(text) {
  const truncated = text.substring(0, 15000);
  return `Você é um especialista em análise de texto e estruturação visual. Analise o texto abaixo e gere um mind map no formato JSON exatamente como especificado.

TEXTO PARA ANÁLISE:
"""
${truncated}
"""

INSTRUÇÕES:
1. Identifique o tema central e crie um nó raiz (level 0) com título curto (máximo 6 palavras).
2. Identifique 4 a 8 ramos principais (level 1) representando grandes temas/categorias.
3. Para cada ramo, adicione 3 a 7 sub-nós (level 2) com pontos específicos.
4. Se relevante, adicione sub-sub-nós (level 3) para detalhar ainda mais.
5. Linguagem concisa, cada nó com no máximo 6 palavras.
6. Para reuniões de negócios use tipicamente: contexto, dores, soluções, casos de uso, próximos passos, decisões, métricas.
7. Seja fiel ao conteúdo, sem inventar informações.

FORMATO DE RESPOSTA (retorne APENAS o JSON, sem markdown, sem explicação):
{"text":"Título central","level":0,"children":[{"text":"Ramo 1","level":1,"children":[{"text":"Sub-ponto","level":2,"children":[]}]}]}`;
}

async function generateMindmap(req, res, corsHeaders) {
  if (!process.env.ANTHROPIC_API_KEY) {
    sendJson(res, 500, {
      error: 'Backend não configurado: falta ANTHROPIC_API_KEY nas variáveis de ambiente.'
    }, corsHeaders);
    return;
  }

  const body = await readJsonBody(req);
  const text = String(body.text || '').trim();

  if (!text) {
    sendJson(res, 400, { error: 'Campo "text" é obrigatório.' }, corsHeaders);
    return;
  }

  if (text.length < 50) {
    sendJson(res, 400, { error: 'Texto muito curto. Envie ao menos 50 caracteres.' }, corsHeaders);
    return;
  }

  if (text.length > 50000) {
    sendJson(res, 400, { error: 'Texto muito longo. Máximo 50.000 caracteres.' }, corsHeaders);
    return;
  }

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: buildPrompt(text) }]
    })
  });

  const responseBody = await anthropicResponse.text();

  if (!anthropicResponse.ok) {
    sendJson(res, 502, {
      error: `Erro na API Anthropic: ${anthropicResponse.status}`,
      details: responseBody.substring(0, 300)
    }, corsHeaders);
    return;
  }

  const data = JSON.parse(responseBody);
  const responseText = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  sendJson(res, 200, responseText, corsHeaders);
}

function serveStatic(req, res, corsHeaders) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === '/' ? `/${INDEX_FILE}` : url.pathname;
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(__dirname, safePath);

  if (!filePath.startsWith(__dirname) || !existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' }, corsHeaders);
    return;
  }

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  res.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    ...corsHeaders
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'mindmap-generator',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
      }, corsHeaders);
      return;
    }

    if (req.method === 'POST' && ['/api/generate-mindmap', '/generate-mindmap'].includes(url.pathname)) {
      await generateMindmap(req, res, corsHeaders);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, corsHeaders);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' }, corsHeaders);
  } catch (error) {
    sendJson(res, 500, { error: `Erro interno: ${error.message}` }, corsHeaders);
  }
});

server.listen(PORT, () => {
  console.log(`Mind map app running on port ${PORT}`);
});
