// Survey server: serves the static survey pages and stores submissions.
// No dependencies - runs on any Node 18+.
//
// Usage:
//   node server.js                       start on port 8642
//   PORT=3000 node server.js             start on another port
//   ADMIN_TOKEN=secret node server.js    protect the CSV export with a token
//
// Responses are appended to data/responses.ndjson, one JSON object per line.
// The data/ folder is never served over HTTP.
//
// CSV export for the team:
//   GET /admin/responses.csv?token=<ADMIN_TOKEN>
// If ADMIN_TOKEN is not set, the export only answers requests from localhost.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'responses.ndjson');
const PORT = Number(process.env.PORT) || 8642;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL || '';
const MAX_BODY_BYTES = 200 * 1024;

// Preferred CSV column order; any unknown keys are appended alphabetically.
const COLUMNS = [
  'receivedAt', 'id', 'language', 'name', 'email', 'follow-up', 'age',
  'country', 'sight-today', 'sight-birth', 'vision-change', 'screenreader',
  'screenreader-other', 'devices', 'devices-other', 'learning',
  'learning-other', 'comfort-time', 'difficulty', 'works-well', 'barriers',
  'barriers-other', 'harder', 'leave-frequency', 'unusable',
  'accessible-sites', 'ideal', 'ideal-other', 'redesign', 'redesign-other',
  'useful', 'would-use', 'ai-concerns', 'ai-concerns-other', 'life-change',
  'final-thoughts'
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function isLocalhost(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readResponses() {
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  return fs.readFileSync(DATA_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(function (line) {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function csvEscape(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function toCsv(rows) {
  const extra = new Set();
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (key) {
      if (!COLUMNS.includes(key)) {
        extra.add(key);
      }
    });
  });
  const columns = COLUMNS.concat(Array.from(extra).sort());
  const lines = [columns.map(csvEscape).join(',')];
  rows.forEach(function (row) {
    lines.push(columns.map(function (col) { return csvEscape(row[col]); }).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function handleSubmit(req, res) {
  let size = 0;
  const chunks = [];
  let aborted = false;

  req.on('data', function (chunk) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, { ok: false, error: 'payload too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', function () {
    if (aborted) {
      return;
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON' });
      return;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      sendJson(res, 400, { ok: false, error: 'expected a JSON object' });
      return;
    }
    const record = Object.assign({}, data, {
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString()
    });
    fs.appendFile(DATA_FILE, JSON.stringify(record) + '\n', function (err) {
      if (err) {
        console.error('Failed to store response locally:', err);
        sendJson(res, 500, { ok: false, error: 'could not store response' });
        return;
      }

      // Asynchronously forward to Google Sheets if URL is configured
      if (GOOGLE_SHEETS_URL) {
        fetch(GOOGLE_SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        })
          .then(function (response) {
            if (!response.ok) {
              console.error('Google Sheets forwarding failed with status:', response.status);
            }
          })
          .catch(function (fetchErr) {
            console.error('Error forwarding to Google Sheets:', fetchErr);
          });
      }

      sendJson(res, 200, { ok: true });
    });
  });
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && pathname.endsWith('/api/submit')) {
    handleSubmit(req, res);
    return;
  }

  if (req.method === 'GET' && pathname.endsWith('/admin/responses.csv')) {
    const token = url.searchParams.get('token') || '';
    const authorized = ADMIN_TOKEN ? token === ADMIN_TOKEN : isLocalhost(req);
    if (!authorized) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const csv = toCsv(readResponses());
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="survey-responses.csv"'
    });
    // Leading BOM so Excel opens UTF-8 (accents, Cyrillic) correctly.
    res.end('﻿' + csv);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD, POST' });
    res.end('Method not allowed');
    return;
  }

  // Static pages: only .html files in the project root are served, so
  // data/, server.js, and anything else stay private.
  const file = pathname === '/' ? 'index.html' : path.basename(pathname);
  if (!file.endsWith('.html')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  fs.readFile(path.join(ROOT, file), function (err, content) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
});

server.listen(PORT, function () {
  console.log('Survey server running on http://localhost:' + PORT);
  console.log('Responses are stored in ' + DATA_FILE);
});
