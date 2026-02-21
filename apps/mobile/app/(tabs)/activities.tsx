import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
const activities = [
  { id: "1", name: "Speech Therapy", duration: "45 min", children: 5 },
  { id: "2", name: "OT Session", duration: "30 min", children: 3 },
];
export default function ActivitiesScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Activities</Text>
        <Text style={styles.subtitle}>{activities.length} activities</Text>
      </View>
      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.activityCard}>
            <View style={styles.activityInfo}>
              <Text style={styles.activityName}>{item.name}</Text>
              <Text style={styles.duration}>{item.duration}</Text>
            </View>
            <Text style={styles.children}>{item.children} children</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 20, paddingTop: 60, backgroundColor: "#8B5CF6" },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  subtitle: { fontSize: 14, color: "#EDE9FE", marginTop: 4 },
  activityCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
  },
  activityInfo: { flex: 1 },
  activityName: { fontSize: 16, fontWeight: "600", color: "#1F2937" },
  duration: { fontSize: 14, color: "#6B7280", marginTop: 2 },
  children: { fontSize: 14, color: "#8B5CF6", fontWeight: "600" },
});
