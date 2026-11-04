// Servidor de avisos de Nov (Cloudflare Worker).
// La app le manda la lista de avisos con su hora; cada 5 minutos este worker
// revisa cuáles ya tocan y los manda como notificación push al iPhone.

const CLAVE = 'datos';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/llave') return json({ llave: env.VAPID_PUBLIC });
      if (req.method !== 'POST') return json({ ok: true, nov: 'avisos' });
      const body = await req.json();
      if (!body || !body.sub || !body.sub.endpoint) return json({ error: 'falta la suscripción' }, 400);
      const id = await hash(body.sub.endpoint);
      const datos = await leer(env);

      if (url.pathname === '/avisos') {
        const avisos = (Array.isArray(body.avisos) ? body.avisos : [])
          .filter((a) => a && typeof a.at === 'number')
          .slice(0, 400)
          .map((a) => ({ at: a.at, titulo: String(a.titulo || 'Nov').slice(0, 120), cuerpo: String(a.cuerpo || '').slice(0, 300) }));
        const antes = datos.subs[id];
        datos.subs[id] = { sub: body.sub, avisos, hasta: antes ? antes.hasta : Date.now() };
        await env.AVISOS.put(CLAVE, JSON.stringify(datos));
        return json({ ok: true, programados: avisos.filter((a) => a.at > Date.now()).length });
      }
      if (url.pathname === '/prueba') {
        const r = await enviar(env, body.sub, { titulo: '+ contacto físico', cuerpo: 'Así te van a llegar los avisos de Nov.' });
        return json({ ok: r.ok, estado: r.status });
      }
      if (url.pathname === '/quitar') {
        delete datos.subs[id];
        await env.AVISOS.put(CLAVE, JSON.stringify(datos));
        return json({ ok: true });
      }
      return json({ error: 'no existe' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(evento, env) {
    const datos = await leer(env);
    const ahora = Date.now();
    let cambio = false;
    for (const [id, s] of Object.entries(datos.subs)) {
      // Solo lo que tocó desde la última revisión, y nada de hace más de 6 horas.
      const desde = Math.max(s.hasta || 0, ahora - 6 * 3600e3);
      const tocan = s.avisos.filter((a) => a.at > desde && a.at <= ahora);
      for (const a of tocan) {
        const r = await enviar(env, s.sub, a);
        if (r.status === 404 || r.status === 410) { delete datos.subs[id]; break; }
      }
      if (datos.subs[id]) {
        s.hasta = ahora;
        s.avisos = s.avisos.filter((a) => a.at > ahora);
      }
      if (tocan.length || !datos.subs[id]) cambio = true;
    }
    if (cambio) await env.AVISOS.put(CLAVE, JSON.stringify(datos));
  },
};

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
async function leer(env) {
  const t = await env.AVISOS.get(CLAVE);
  const d = t ? JSON.parse(t) : {};
  if (!d.subs) d.subs = {};
  return d;
}
async function hash(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return b64u(new Uint8Array(b)).slice(0, 22);
}

/* ---------- Web Push (RFC 8291 y RFC 8292) con WebCrypto ---------- */
export async function enviar(env, sub, aviso) {
  const cuerpo = await cifrar(JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo }), sub.keys.p256dh, sub.keys.auth);
  const jwt = await firmar(env, new URL(sub.endpoint).origin);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '43200',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC,
    },
    body: cuerpo,
  });
}

async function firmar(env, aud) {
  const jwk = JSON.parse(env.VAPID_PRIVATE);
  const llave = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const datos = enc({ typ: 'JWT', alg: 'ES256' }) + '.' +
    enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/nanifranco/Nov' });
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, llave, new TextEncoder().encode(datos));
  return datos + '.' + b64u(new Uint8Array(firma));
}

export async function cifrar(texto, p256dh, auth) {
  const uaPub = deB64u(p256dh), secreto = deB64u(auth);
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const uaLlave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaLlave }, par.privateKey, 256));

  const ikm = await hkdf(secreto, compartido, unir(txt('WebPush: info\0'), uaPub, asPub), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, txt('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, txt('Content-Encoding: nonce\0'), 12);

  const plano = unir(new TextEncoder().encode(texto), new Uint8Array([2]));
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, plano));

  const cab = new Uint8Array(21);
  cab.set(sal, 0);
  new DataView(cab.buffer).setUint32(16, 4096);
  cab[20] = asPub.length;
  return unir(cab, asPub, cifrado);
}

async function hkdf(sal, ikm, info, n) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, n * 8));
}
function txt(s) { return new TextEncoder().encode(s); }
function unir(...partes) {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0; for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
function b64u(b) { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function deB64u(s) { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, (c) => c.charCodeAt(0)); }
