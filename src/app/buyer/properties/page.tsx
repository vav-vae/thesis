"use client";

import { useEffect, useState } from "react";

import {
  collection,
  getDocs,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import Link from "next/link";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  [key: string]: unknown;
}

export default function BuyerPropertiesPage() {

  const [properties, setProperties] =
    useState<Property[]>([]);

  useEffect(() => {

    const fetchProperties = async () => {

      try {

        const querySnapshot =
          await getDocs(
            collection(db, "properties")
          );

        const propertyList: Property[] = [];

        querySnapshot.forEach((doc) => {

          propertyList.push({
            id: doc.id,
            ...doc.data(),
          });

        });

        setProperties(propertyList);

      } catch (error) {
        console.log(error);
      }
    };

    fetchProperties();

  }, []);

  return (
    <div className="p-10">

      <h1 className="text-3xl font-bold mb-6">
        Browse Properties
      </h1>

      <div className="flex flex-col gap-4">

        {properties.map((property) => (
          <Link
            href={`/buyer/properties/${property.id}`}
            key={property.id}
          >
            <div className="border p-4 rounded">

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
          </Link>
        ))}

      </div>

    </div>
  );
}