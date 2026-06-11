import { Ionicons } from "@expo/vector-icons";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await login(email, password);
      router.replace("/");
    } catch (error) {
      Alert.alert("Não foi possível entrar", error instanceof Error ? error.message : "Verifique seus dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={styles.page}>
        <View style={styles.brand}>
          <View style={styles.logo}><Ionicons name="shield-checkmark" size={38} color={colors.primary} /></View>
          <Text style={styles.title}>Casa protegida,{`\n`}onde você estiver.</Text>
          <Text style={styles.subtitle}>Acompanhe as cinco zonas e controle sua central com segurança.</Text>
        </View>
        <View style={styles.form}>
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="voce@email.com" />
          <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry placeholder="Sua senha" />
          <Button title="Entrar" onPress={submit} loading={loading} disabled={!email || !password} />
          <Link href="/forgot-password" style={styles.link}>Esqueci minha senha</Link>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "space-between", paddingVertical: 28 },
  brand: { gap: 18, marginTop: 30 },
  logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 34, lineHeight: 40, fontWeight: "900" },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 23, maxWidth: 340 },
  form: { gap: 14 },
  link: { color: colors.primary, fontWeight: "700", textAlign: "center", padding: 8 },
});
