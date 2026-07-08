export const AMENITY_GROUPS = [
  { title: "Essentials", options: [
    { id: "wifi", label: "Wi-Fi" }, { id: "airConditioning", label: "Air conditioning" },
    { id: "kitchen", label: "Kitchen" }, { id: "washer", label: "Washer" },
    { id: "furnished", label: "Furnished" }, { id: "workspace", label: "Dedicated workspace" },
  ] },
  { title: "Features", options: [
    { id: "parking", label: "Free parking" }, { id: "pool", label: "Swimming pool" },
    { id: "gym", label: "Gym" }, { id: "elevator", label: "Elevator" },
    { id: "balcony", label: "Balcony" }, { id: "garden", label: "Garden" },
  ] },
  { title: "Safety and access", options: [
    { id: "security", label: "24/7 security" }, { id: "cctv", label: "CCTV" },
    { id: "smokeAlarm", label: "Smoke alarm" }, { id: "fireExtinguisher", label: "Fire extinguisher" },
    { id: "accessible", label: "Accessible entrance" }, { id: "petFriendly", label: "Pet friendly" },
  ] },
] as const;

export const AMENITY_LABELS: Map<string, string> = new Map(AMENITY_GROUPS.flatMap((group) => group.options.map((option) => [option.id, option.label] as [string, string])));
export const PROPERTY_TYPES = ["House", "Condominium", "Townhouse", "Apartment", "Commercial", "Lot"] as const;
