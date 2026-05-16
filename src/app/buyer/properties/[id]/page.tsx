"use client";

import { use } from "react";

import { useEffect, useState } from "react";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  [key: string]: unknown;
}

interface RoomImage {
  id: string;
  propertyId?: string;
  roomType?: string;
  imageUrls?: string[];
  [key: string]: unknown;
}

export default function PropertyDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id } = use(params);

  // PROPERTY DATA
  const [property, setProperty] =
    useState<Property | null>(null);

  // ROOM IMAGES
  const [roomImages, setRoomImages] =
    useState<RoomImage[]>([]);

  useEffect(() => {

    const fetchProperty = async () => {

      try {

        console.log("PROPERTY ID:", id);

        // FETCH PROPERTY
        const docRef = doc(
          db,
          "properties",
          id
        );

        const docSnap =
          await getDoc(docRef);

        if (docSnap.exists()) {

          setProperty({
            id: docSnap.id,
            ...docSnap.data(),
          });

        }

        // FETCH ROOM IMAGES
        const roomQuery = query(
          collection(db, "roomImages"),
          where("propertyId", "==", id)
        );

        const roomSnapshot =
          await getDocs(roomQuery);

        const roomList: RoomImage[] = [];

        roomSnapshot.forEach((doc) => {

          roomList.push({
            id: doc.id,
            ...doc.data(),
          });

        });

        setRoomImages(roomList);

        console.log(roomList);

      } catch (error) {

        console.log(error);

      }
    };

    fetchProperty();

  }, [id]);

  // LOADING
  if (!property) {

    return (
      <div className="p-10">
        Loading...
      </div>
    );

  }

  return (
    <div className="p-10">

      {/* PROPERTY INFO */}
      <h1 className="text-4xl font-bold mb-4">
        {property.title}
      </h1>

      <p className="mb-4">
        {property.description}
      </p>

      <p className="mb-2">
        Price:
        ₱ {property.price}
      </p>

      <p className="mb-10">
        Location:
        {property.location}
      </p>

      {/* ROOM IMAGES */}
      <div className="mb-10">

        <h2 className="text-2xl font-bold mb-4">
          Room Images
        </h2>

        {roomImages.map((room) => (

          <div
            key={room.id}
            className="mb-10"
          >

            <h3 className="text-xl font-semibold mb-4">
              {room.roomType as string}
            </h3>

            <div className="grid grid-cols-2 gap-4">

              {(room.imageUrls as string[] | undefined)?.map(
                (
                  url: string,
                  index: number
                ) => (

                  <img
                    key={index}
                    src={url}
                    alt="Room"
                    className="rounded border w-full"
                    width={300}
                    height={200}
                  />

                )
              )}

            </div>

          </div>

        ))}

      </div>

      {/* VIRTUAL TOUR PLACEHOLDER */}
      <div className="border p-10 rounded">

        <h2 className="text-2xl font-bold">
          Virtual Tour Placeholder
        </h2>

        <p>
          Panorama viewer will appear here.
        </p>

      </div>

    </div>
  );
}