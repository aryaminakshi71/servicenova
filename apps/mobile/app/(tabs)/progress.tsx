import { ScrollView, StyleSheet, Text, View } from "react-native";
const progressData = [
  { label: "Speech", value: "75%", color: "#8B5CF6" },
  { label: "Motor Skills", value: "60%", color: "#10B981" },
  { label: "Social", value: "45%", color: "#F59E0B" },
];
export default function ProgressScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Progress</Text>
        <Text style={styles.subtitle}>Track development</Text>
      </View>
      {progressData.map((item, index) => (
        <View key={index} style={styles.progressCard}>
          <Text style={styles.label}>{item.label}</Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: item.value, backgroundColor: item.color },
              ]}
            />
          </View>
          <Text style={[styles.value, { color: item.color }]}>
            {item.value}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 20, paddingTop: 60, backgroundColor: "#8B5CF6" },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  subtitle: { fontSize: 14, color: "#EDE9FE", marginTop: 4 },
  progressCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
  },
  label: { fontSize: 16, fontWeight: "600", color: "#1F2937", marginBottom: 8 },
  progressBar: { height: 8, backgroundColor: "#E5E7EB", borderRadius: 4 },
  progressFill: { height: "100%", borderRadius: 4 },
  value: { fontSize: 14, fontWeight: "600", marginTop: 8 },
});
