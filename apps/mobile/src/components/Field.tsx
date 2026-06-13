import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, radius } from "@/theme";

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  input: {
    minHeight: 50,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
  },
});
