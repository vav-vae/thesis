"use client";

import { useEffect } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

type Coordinates = { latitude: number; longitude: number };

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const pinIcon = divIcon({
  className: "property-map-pin",
  html: '<div aria-hidden="true" style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:#2563eb;border:4px solid white;box-shadow:0 4px 12px rgba(15,23,42,.3);transform:rotate(-45deg)"><div style="width:8px;height:8px;border-radius:50%;background:white;margin:9px"></div></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

function MapInteraction({ editable, onChange }: { editable: boolean; onChange?: (coordinates: Coordinates) => void }) {
  useMapEvents({
    click(event) {
      if (editable) onChange?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function Recenter({ coordinates }: { coordinates: Coordinates | null }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates) map.flyTo([coordinates.latitude, coordinates.longitude], Math.max(map.getZoom(), 15));
  }, [coordinates, map]);
  return null;
}

export default function PropertyLocationMap({ latitude, longitude, editable = false, onChange }: { latitude?: number | null; longitude?: number | null; editable?: boolean; onChange?: (coordinates: Coordinates) => void }) {
  const coordinates = typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null;
  const center: [number, number] = coordinates ? [coordinates.latitude, coordinates.longitude] : DEFAULT_CENTER;

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
    <MapContainer center={center} zoom={coordinates ? 15 : 6} scrollWheelZoom className="h-80 w-full" aria-label="Property location map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapInteraction editable={editable} onChange={onChange} />
      <Recenter coordinates={coordinates} />
      {coordinates && <Marker
        position={[coordinates.latitude, coordinates.longitude]}
        icon={pinIcon}
        draggable={editable}
        eventHandlers={{ dragend: (event) => {
          const point = event.target.getLatLng();
          onChange?.({ latitude: point.lat, longitude: point.lng });
        } }}
      />}
    </MapContainer>
  </div>;
}
