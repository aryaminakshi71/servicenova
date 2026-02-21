import { ScrollView, StyleSheet, Text, View } from "react-native";
const stats = [
  { label: "Total Children", value: "15", icon: "👶" },
  { label: "Sessions Today", value: "8", icon: "📅" },
  { label: "Completed", value: "45", icon: "✅" },
  { label: "Progress", value: "78%", icon: "📈" },
];
const upcomingSessions = [
  {
    id: "1",
    child: "Alex",
    activity: "Speech Therapy",
    time: "10:00 AM",
    status: "Upcoming",
  },
  {
    id: "2",
    child: "Emma",
    activity: "OT Session",
    time: "11:30 AM",
    status: "Upcoming",
  },
];
export default function HomeScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Autism Care</Text>
        <Text style={styles.subtitle}>Supporting your child</Text>
      </View>
      <View style={styles.statsGrid}>
        {stats.map((stat, index) => (
          <View key={index} style={styles.statCard}>
            <Text style={styles.statIcon}>{stat.icon}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Today's Sessions</Text>
      {upcomingSessions.map((session) => (
        <View key={session.id} style={styles.sessionCard}>
          <View style={styles.sessionInfo}>
            <Text style={styles.childName}>{session.child}</Text>
            <Text style={styles.activity}>{session.activity}</Text>
            <Text style={styles.time}>{session.time}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{session.status}</Text>
          </View>
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
  statsGrid: { flexDirection: "row", flexWrap: "wrap", padding: 12 },
  statCard: {
    width: "46%",
    margin: "2%",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 2,
  },
  statIcon: { fontSize: 28 },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1F2937",
    marginTop: 8,
  },
  statLabel: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2937",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sessionCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
  },
  sessionInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: "600", color: "#1F2937" },
  activity: { fontSize: 14, color: "#6B7280", marginTop: 2 },
  time: { fontSize: 12, color: "#8B5CF6", marginTop: 2 },
  statusBadge: {
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: { fontSize: 12, fontWeight: "600", color: "#8B5CF6" },
});
