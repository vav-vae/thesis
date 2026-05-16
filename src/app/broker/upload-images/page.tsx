"use client";

import { useEffect, useState } from "react";

import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import {
  onAuthStateChanged,
} from "firebase/auth";

import {
  auth,
  db,
} from "@/lib/firebase";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  [key: string]: unknown;
}

export default function UploadImagesPage() {

  // IMAGE FILES
  const [images, setImages] =
    useState<FileList | null>(null);

  // BROKER PROPERTIES
  const [properties, setProperties] =
    useState<Property[]>([]);

  // SELECTED PROPERTY
  const [selectedProperty, setSelectedProperty] =
    useState("");

  // ROOM TYPE
  const [roomType, setRoomType] =
    useState("");

  // FETCH BROKER PROPERTIES
  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(auth, async (user) => {

        if (!user) return;
        console.log("CURRENT USER:", user.uid);

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

      });

    return () => unsubscribe();

  }, []);

  // UPLOAD IMAGES
  const uploadImages = async () => {

    if (!images) {
      alert("Please select images");
      return;
    }

    if (!selectedProperty) {
      alert("Please select a property");
      return;
    }

    if (!roomType) {
      alert("Please enter room type");
      return;
    }

    try {

      const uploadedUrls: string[] = [];

      // UPLOAD TO CLOUDINARY
      for (let i = 0; i < images.length; i++) {

        const file = images[i];

        const formData = new FormData();

        formData.append("file", file);

        formData.append(
          "upload_preset",
          "libot_uploads"
        );

        const response = await fetch(
          "https://api.cloudinary.com/v1_1/dpnsayn8m/image/upload",
          {
            method: "POST",
            body: formData,
          }
        );

        const data = await response.json();

        console.log(data);

        uploadedUrls.push(data.secure_url);

      }

      // SAVE TO FIRESTORE
      await addDoc(
        collection(db, "roomImages"),
        {
          propertyId: selectedProperty,
          roomType: roomType,
          imageUrls: uploadedUrls,
          createdAt: new Date(),
        }
      );

      alert("Images Uploaded Successfully");

      console.log(uploadedUrls);

      // RESET
      setImages(null);
      setSelectedProperty("");
      setRoomType("");

    } catch (error) {

      console.log(error);

      alert("Upload Failed");

    }
  };

  return (
    <div className="p-10 flex flex-col gap-4">

      <h1 className="text-3xl font-bold">
        Upload Room Images
      </h1>

      {/* PROPERTY DROPDOWN */}
      <select
        className="border p-2"
        value={selectedProperty}
        onChange={(e) =>
          setSelectedProperty(e.target.value)
        }
      >

        <option value="">
          Select Property
        </option>

        {properties.map((property) => (

          <option
            key={property.id}
            value={property.id}
          >
            {property.title}
          </option>

        ))}

      </select>

      {/* ROOM TYPE */}
      <input
        className="border p-2"
        placeholder="Room Type"
        value={roomType}
        onChange={(e) =>
          setRoomType(e.target.value)
        }
      />

      {/* IMAGE INPUT */}
      <input
        type="file"
        multiple
        onChange={(e) =>
          setImages(e.target.files)
        }
      />

      {/* UPLOAD BUTTON */}
      <button
        className="bg-black text-white p-2"
        onClick={uploadImages}
      >
        Upload Images
      </button>

    </div>
  );
}