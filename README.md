# Nov

Una app privada para ser mejor pareja con María: lo que le gusta, lo que te cuenta, sus fechas, tus gestos y las guías para los momentos difíciles.

## Qué tiene

No es para abrirla diario. Es una herramienta para cuando la necesitas.

- **María:** lo que sé de ella (gustos, comida, sus órdenes, tallas…), cómo quererla (cómo se siente querida, lo que me ha pedido, sus respuestas) y regalos.
- **Ayuda:** antes de contestar, disculparme bien, decir algo difícil, qué hacer según cómo esté, y una idea al azar: cita, gesto o pregunta.
- **Fechas:** el check-in mensual y sus fechas importantes. Los avisos llegan solos.

## Estructura

```
index.html      La app completa en una sola página. Funciona en cualquier navegador.
app/            La versión para iPhone y Android (Expo). Muestra index.html y le agrega
                notificaciones, Face ID o huella y guardado en el teléfono.
```

## Usarla en el navegador

Abre `index.html`. Todo se guarda en ese navegador.

Para tenerla en línea, activa GitHub Pages en este repositorio (Settings, Pages, rama `main`, carpeta raíz).

## La app del teléfono

```bash
cd app
npm install
npm start
```

Abre Expo Go en el teléfono y escanea el código. `npm start` copia primero la versión más nueva de `index.html` dentro de la app.

En Expo Go, Face ID pide el código del teléfono y en Android las notificaciones pueden no salir. Con la app instalada funcionan completas:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
eas build --platform ios
```

En iPhone hace falta una cuenta de Apple Developer para instalarla fuera de Expo Go.

## Pasar tus datos

En Nov: Ajustes, **Copiar mis datos**. En la otra versión: Ajustes, **Pegar mis datos**.
