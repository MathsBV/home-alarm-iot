import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius } from "@/theme";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary";
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = "primary", loading, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={[styles.text, variant === "secondary" && styles.textSecondary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.medium,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.primaryDark },
  danger: { backgroundColor: "#8A1E28" },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  text: { color: colors.white, fontWeight: "700", fontSize: 15, letterSpacing: 0.3 },
  textSecondary: { color: colors.textMuted },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.35 },
});
