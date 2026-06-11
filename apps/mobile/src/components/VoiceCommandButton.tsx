import type { CommandType } from "@home-alarm/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { parseVoiceCommand } from "@/lib/voice";
import { colors, radius } from "@/theme";

type Props = {
  onCommand: (command: { type: CommandType; label: string }) => void;
};

export function VoiceCommandButton({ onCommand }: Props) {
  const [listening, setListening] = useState(false);

  const startListening = async () => {
    try {
      const speech = await import("expo-speech-recognition");
      const permission = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microfone indisponível", "Permita o acesso ao microfone nas configurações.");
        return;
      }
      setListening(true);
      const resultSubscription = speech.ExpoSpeechRecognitionModule.addListener(
        "result",
        (event: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
          const transcript = event.results?.[0]?.transcript ?? "";
          if (!event.isFinal) return;
          const command = parseVoiceCommand(transcript);
          setListening(false);
          speech.ExpoSpeechRecognitionModule.stop();
          resultSubscription.remove();
          errorSubscription.remove();
          if (command) onCommand(command);
          else Alert.alert("Comando não reconhecido", `Você disse: “${transcript}”.`);
        },
      );
      const errorSubscription = speech.ExpoSpeechRecognitionModule.addListener(
        "error",
        () => {
          setListening(false);
          resultSubscription.remove();
          errorSubscription.remove();
        },
      );
      speech.ExpoSpeechRecognitionModule.start({
        lang: "pt-BR",
        interimResults: true,
        continuous: false,
      });
    } catch {
      setListening(false);
      Alert.alert(
        "Recurso disponível no Development Build",
        "O reconhecimento de voz exige o aplicativo compilado com EAS, não o Expo Go.",
      );
    }
  };

  return (
    <Pressable onPress={startListening} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <View style={[styles.icon, listening && styles.iconActive]}>
        <Ionicons name={listening ? "mic" : "mic-outline"} size={22} color={colors.white} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{listening ? "Estou ouvindo..." : "Comando de voz"}</Text>
        <Text style={styles.subtitle}>Diga “armar”, “desarmar” ou “silenciar”</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.medium,
    padding: 14,
  },
  pressed: { opacity: 0.75 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: { backgroundColor: colors.danger },
  copy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 12 },
});
