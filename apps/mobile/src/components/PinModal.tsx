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
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.eyebrow}>CONFIRMAÇÃO</Text>
          <Text style={styles.title}>{command?.label}</Text>
          <Text style={styles.description}>
            Digite o PIN da residência para autorizar.
          </Text>
          <TextInput
            autoFocus
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            placeholder="• • • •"
            placeholderTextColor={colors.border}
            style={styles.input}
          />
          <Button title="Confirmar" onPress={submit} loading={loading} disabled={pin.length < 4} />
          <Button title="Cancelar" variant="secondary" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.80)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 6,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.2 },
  description: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.medium,
    color: colors.text,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    paddingVertical: 16,
    fontWeight: "700",
  },
});
