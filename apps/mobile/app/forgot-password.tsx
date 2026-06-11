import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");

  const submit = async () => {
    try {
      await resetPassword(email);
      Alert.alert("E-mail enviado", "Confira sua caixa de entrada para redefinir a senha.", [
        { text: "Voltar", onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert("Falha no envio", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  return (
    <Screen title="Recuperar acesso" subtitle="Enviaremos um link seguro ao seu e-mail.">
      <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="voce@email.com" />
      <Button title="Enviar link" onPress={submit} disabled={!email} />
      <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
