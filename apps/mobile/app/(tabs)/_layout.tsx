import { Tabs } from "expo/native";
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#8B5CF6" }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="children"
        options={{
          title: "Children",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>👶</Text>,
        }}
      />
      <Tabs.Screen
        name="activities"
        options={{
          title: "Activities",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🎨</Text>,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>📈</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}
