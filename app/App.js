// Nov: la app. Muestra la interfaz (novHtml.js) y le da lo que una página no puede:
// guardar en el teléfono, notificaciones y bloqueo con Face ID o huella.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as LocalAuthentication from 'expo-local-authentication';
import NOV_HTML from './novHtml';

const CLAVE = 'nov:v1';
const SEGUNDOS_PARA_BLOQUEAR = 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function pedirPermisoDeAvisos() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Recordatorios',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const actual = await Notifications.getPermissionsAsync();
    if (actual.granted) return true;
    if (actual.canAskAgain === false) return false;
    const pedido = await Notifications.requestPermissionsAsync();
    return !!pedido.granted;
  } catch (e) {
    return false;
  }
}

// Borra todo lo programado y lo vuelve a programar con lo que manda la interfaz.
async function programarAvisos(avisos) {
  try {
    const permiso = await Notifications.getPermissionsAsync();
    if (!permiso.granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();

    const ahora = Date.now();
    for (const a of (avisos || []).slice(0, 40)) {
      if (!a || typeof a.at !== 'number' || a.at <= ahora) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: String(a.titulo || 'Nov'), body: String(a.cuerpo || '') },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(a.at),
          channelId: 'default',
        },
      });
    }
  } catch (e) {
    // Si falla (por ejemplo en Expo Go de Android), la app sigue funcionando sin avisos.
  }
}

function Nov() {
  const oscuro = useColorScheme() === 'dark';
  const margen = useSafeAreaInsets();
  const [cargado, setCargado] = useState(false);
  const [datos, setDatos] = useState(null);
  const [abierta, setAbierta] = useState(false);
  const salioEn = useRef(0);
  const pidiendo = useRef(false);
  const temporizador = useRef(null);

  const fondo = oscuro ? '#0B0B0C' : '#FFFFFF';
  const tinta = oscuro ? '#F5F5F7' : '#111113';

  const desbloquear = useCallback(async () => {
    if (pidiendo.current) return;
    pidiendo.current = true;
    try {
      const tiene = await LocalAuthentication.hasHardwareAsync();
      const configurado = await LocalAuthentication.isEnrolledAsync();
      if (!tiene || !configurado) {
        setAbierta(true);
      } else {
        const r = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Abrir Nov',
          cancelLabel: 'Cancelar',
        });
        if (r.success) setAbierta(true);
      }
    } catch (e) {
      setAbierta(true);
    } finally {
      pidiendo.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      let guardado = null;
      try {
        guardado = await AsyncStorage.getItem(CLAVE);
      } catch (e) {}
      setDatos(guardado);
      setCargado(true);
      await desbloquear();
      await pedirPermisoDeAvisos();
    })();
  }, [desbloquear]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background') {
        salioEn.current = Date.now();
      } else if (estado === 'active' && salioEn.current) {
        const fuera = (Date.now() - salioEn.current) / 1000;
        salioEn.current = 0;
        if (fuera > SEGUNDOS_PARA_BLOQUEAR) {
          setAbierta(false);
          desbloquear();
        }
      }
    });
    return () => sub.remove();
  }, [desbloquear]);

  const alRecibir = useCallback((evento) => {
    let m = null;
    try {
      m = JSON.parse(evento.nativeEvent.data);
    } catch (e) {
      return;
    }
    if (!m || m.t !== 'save' || typeof m.d !== 'string') return;
    AsyncStorage.setItem(CLAVE, m.d).catch(() => {});
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => programarAvisos(m.avisos), 1500);
  }, []);

  if (!cargado) return <View style={[estilos.todo, { backgroundColor: fondo }]} />;

  // En iPhone la interfaz ya respeta el notch y la barra de abajo por sí sola.
  const relleno = Platform.OS === 'android' ? { paddingTop: margen.top, paddingBottom: margen.bottom } : null;

  return (
    <View style={[estilos.todo, { backgroundColor: fondo }, relleno]}>
      <StatusBar barStyle={oscuro ? 'light-content' : 'dark-content'} backgroundColor={fondo} />
      <WebView
        style={{ flex: 1, backgroundColor: fondo }}
        originWhitelist={['*']}
        source={{ html: NOV_HTML, baseUrl: 'https://nov.app/' }}
        injectedJavaScriptBeforeContentLoaded={'window.__NOV_DATA__ = ' + JSON.stringify(datos) + '; true;'}
        onMessage={alRecibir}
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('https://nov.app/')}
        javaScriptEnabled
        domStorageEnabled
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
        overScrollMode="never"
        textZoom={100}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
      />
      {!abierta && (
        <View style={[StyleSheet.absoluteFill, estilos.candado, { backgroundColor: fondo }]}>
          <Text style={[estilos.nombre, { color: tinta }]}>Nov</Text>
          <Pressable
            onPress={desbloquear}
            style={[estilos.boton, { backgroundColor: tinta }]}
            accessibilityRole="button"
          >
            <Text style={[estilos.botonTexto, { color: fondo }]}>Desbloquear</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Nov />
    </SafeAreaProvider>
  );
}

const estilos = StyleSheet.create({
  todo: { flex: 1 },
  candado: { alignItems: 'center', justifyContent: 'center', gap: 28 },
  nombre: { fontSize: 44, fontWeight: '800', letterSpacing: -2 },
  boton: { minHeight: 50, paddingHorizontal: 26, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { fontSize: 16, fontWeight: '700' },
});
