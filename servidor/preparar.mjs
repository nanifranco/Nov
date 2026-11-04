// Deja listo el servidor de avisos de Nov en tu cuenta de Cloudflare.
// Uso: npm install && npm run preparar
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const toml = path.join(aqui, 'wrangler.toml');
const llavesF = path.join(aqui, '.llaves.json');
const wr = (args, opts = {}) => spawnSync('npx', ['wrangler', ...args], { cwd: aqui, encoding: 'utf8', shell: process.platform === 'win32', ...opts });

function paso(t) { console.log('\n› ' + t); }
function b64u(b) { return Buffer.from(b).toString('base64url'); }

// 1. Sesión de Cloudflare
paso('Revisando tu sesión de Cloudflare');
const quien = wr(['whoami']);
if (!/associated with the email|You are logged in/i.test((quien.stdout || '') + (quien.stderr || ''))) {
  console.log('Se va a abrir el navegador para que entres a Cloudflare.');
  const r = wr(['login'], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('No se pudo entrar a Cloudflare.'); process.exit(1); }
}

// 2. Espacio para guardar los avisos (KV)
let config = fs.readFileSync(toml, 'utf8');
if (config.includes('id = "PENDIENTE"')) {
  paso('Creando dónde se guardan los avisos');
  const r = wr(['kv', 'namespace', 'create', 'AVISOS']);
  const salida = (r.stdout || '') + (r.stderr || '');
  const m = salida.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/i);
  if (!m) { console.error(salida); console.error('No pude crear el espacio de avisos.'); process.exit(1); }
  config = config.replace('id = "PENDIENTE"', 'id = "' + m[1] + '"');
  fs.writeFileSync(toml, config);
}

// 3. Llaves para firmar los avisos (la privada nunca se sube a GitHub)
let llaves;
if (fs.existsSync(llavesF)) llaves = JSON.parse(fs.readFileSync(llavesF, 'utf8'));
else {
  paso('Creando las llaves de los avisos');
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', par.privateKey);
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)));
  llaves = { publica: pub, privada: { kty: priv.kty, crv: priv.crv, d: priv.d, x: priv.x, y: priv.y } };
  fs.writeFileSync(llavesF, JSON.stringify(llaves));
}
config = config.replace(/VAPID_PUBLIC = ".*"/, 'VAPID_PUBLIC = "' + llaves.publica + '"');
fs.writeFileSync(toml, config);

// 4. Subirlo
paso('Subiendo el servidor');
const dep = wr(['deploy'], { stdio: 'inherit' });
if (dep.status !== 0) { console.error('No se pudo subir.'); process.exit(1); }

paso('Guardando la llave privada en Cloudflare');
const sec = wr(['secret', 'put', 'VAPID_PRIVATE'], { input: JSON.stringify(llaves.privada) });
if (sec.status !== 0) { console.error(sec.stdout, sec.stderr); console.error('No se pudo guardar la llave.'); process.exit(1); }

console.log('\n✓ Listo.');
console.log('Copia el link que termina en .workers.dev de arriba y pégalo en Nov: Ajustes, Avisos.');
