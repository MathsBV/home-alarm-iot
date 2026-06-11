import type { CommandType } from "@home-alarm/contracts";
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { colors, radius } from "@/theme";
import { Button } from "./Button";

type PendingCommand = {
  type: CommandType;
  value?: boolean | number | string;
  label: string;
};

type Props = {
  visible: boolean;
  command: PendingCommand | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function PinModal({ visible, command, onClose, onSuccess }: Props) {
  const { homeId, getToken } = useAuth();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const close = () => {
    setPin("");
    onClose();
  };

  const submit = async () => {
    if (!command || !homeId) return;
    setLoading(true);
    try {
      const token = await getToken();
      await api.command(homeId, token, { type: command.type, value: command.value, pin });
      onSuccess();
      close();
    } catch (error) {
      Alert.alert("Comando não enviado", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CONFIRMAÇÃO DE SEGURANÇA</Text>
          <Text style={styles.title}>{command?.label}</Text>
          <Text style={styles.description}>
            Digite o PIN da residência para autorizar este comando.
          </Text>
          <TextInput
            autoFocus
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            placeholder="PIN"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Button title="Confirmar comando" onPress={submit} loading={loading} disabled={pin.length < 4} />
          <Button title="Cancelar" variant="secondary" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.large,
    padding: 22,
    gap: 14,
  },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 23, fontWeight: "800" },
  description: { color: colors.textMuted, lineHeight: 21 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.medium,
    color: colors.text,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
    padding: 14,
  },
});
