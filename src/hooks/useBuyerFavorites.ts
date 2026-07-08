"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { arrayRemove, arrayUnion, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export function useBuyerFavorites() {
  const [userId, setUserId] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? "";
    setUserId(uid);
    if (!uid) {
      setFavoriteIds([]);
      setLoading(false);
    }
  }), []);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(doc(db, "users", userId), (snapshot) => {
      const storedFavorites = snapshot.data()?.favorites;
      setFavoriteIds(Array.isArray(storedFavorites) ? storedFavorites.filter((value): value is string => typeof value === "string") : []);
      setLoading(false);
    }, (snapshotError) => {
      console.error("Unable to load favorites:", snapshotError);
      setError("Unable to load your favorites.");
      setLoading(false);
    });
  }, [userId]);

  const toggleFavorite = async (propertyId: string) => {
    if (!userId || updatingIds.includes(propertyId)) return;
    const isFavorite = favoriteIds.includes(propertyId);
    setUpdatingIds((current) => [...current, propertyId]);
    setFavoriteIds((current) => isFavorite ? current.filter((id) => id !== propertyId) : [...current, propertyId]);
    setError("");
    try {
      await updateDoc(doc(db, "users", userId), {
        favorites: isFavorite ? arrayRemove(propertyId) : arrayUnion(propertyId),
      });
    } catch (updateError) {
      console.error("Unable to update favorite:", updateError);
      setFavoriteIds((current) => isFavorite ? [...current, propertyId] : current.filter((id) => id !== propertyId));
      setError("Your favorite could not be updated. Please try again.");
    } finally {
      setUpdatingIds((current) => current.filter((id) => id !== propertyId));
    }
  };

  return {
    favoriteIds,
    favorites: new Set(favoriteIds),
    loading,
    error,
    toggleFavorite,
    isUpdating: (propertyId: string) => updatingIds.includes(propertyId),
  };
}
