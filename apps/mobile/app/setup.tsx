import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { demoMode } from "@/lib/firebase";
import { colors } from "@/theme";

export default function SetupScreen() {
  const { setHomeId, getToken } = useAuth();
  const [name, setName] = useState("Minha residência");
  const [deviceId, setDeviceId] = useState("alarm-demo-001");
  const [pin, setPin] = useState("1234");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (demoMode) {
        await setHomeId(process.env.EXPO_PUBLIC_DEMO_HOME_ID ?? "home-demo-001");
      } else {
        const token = await getToken();
        const home = await api.createHome(token, { name, deviceId, pin });
        await setHomeId(home.id);
      }
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert("Configuração não concluída", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen title="Conectar central" subtitle="Vincule esta conta ao identificador configurado no ESP32.">
      {demoMode ? <Text style={styles.demo}>MODO DEMONSTRAÇÃO · PIN 1234</Text> : null}
      <Field label="Nome da residência" value={name} onChangeText={setName} />
      <Field label="Identificador do dispositivo" value={deviceId} onChangeText={setDeviceId} />
      <Field label="PIN de segurança (4 a 8 dígitos)" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={8} />
      <Button title="Concluir configuração" onPress={submit} loading={loading} disabled={!name || !deviceId || pin.length < 4} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  demo: { color: colors.warning, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
});
