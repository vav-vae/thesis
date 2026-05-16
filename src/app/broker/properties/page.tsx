"use client";

import { useEffect, useState } from "react";

import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import {
  onAuthStateChanged,
} from "firebase/auth";

import { auth, db } from "@/lib/firebase";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  [key: string]: unknown;
}

export default function BrokerPropertiesPage() {

  const [properties, setProperties] =
    useState<Property[]>([]);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(auth, async (user) => {

        if (!user) {
          setLoading(false);
          return;
        }

        console.log("LOGGED IN USER:", user.uid);

        const q = query(
          collection(db, "properties"),
          where("brokerId", "==", user.uid)
        );

        const querySnapshot =
          await getDocs(q);

        const propertyList: Property[] = [];

        querySnapshot.forEach((doc) => {
          propertyList.push({
            id: doc.id,
            ...doc.data(),
          });
        });

        setProperties(propertyList);

        setLoading(false);
      });

    return () => unsubscribe();

  }, []);

  if (loading) {
    return <div className="p-10">Loading...</div>;
  }

  return (
    <div className="p-10">

      <h1 className="text-3xl font-bold mb-6">
        My Properties
      </h1>

      <div className="flex flex-col gap-4">

        {properties.map((property) => (

          <div
            key={property.id}
            className="border p-4 rounded"
          >

            <h2 className="text-xl font-bold">
              {property.title}
            </h2>

            <p>
              {property.description}
            </p>

            <p>
              ₱ {property.price}
            </p>

            <p>
              {property.location}
            </p>

          </div>

        ))}

      </div>

    </div>
  );
}