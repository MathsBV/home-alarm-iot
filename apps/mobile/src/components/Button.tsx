import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius } from "@/theme";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary";
  loading?: boolean;
  disabled?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
}: Props) {
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
        <Text style={styles.text}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.medium,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.primaryDark },
  danger: { backgroundColor: "#A82E3B" },
  secondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.white, fontWeight: "800", fontSize: 15 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});
