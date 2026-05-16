"use client";

import { useState } from "react";

import {
  addDoc,
  collection,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

export default function CreatePropertyPage() {

  const [title, setTitle] = useState("");

  const [description, setDescription] =
    useState("");

  const [price, setPrice] = useState("");

  const [location, setLocation] =
    useState("");

  const createProperty = async () => {

    try {

      const user = auth.currentUser;

      if (!user) {
        alert("User not logged in");
        return;
      }

      await addDoc(
        collection(db, "properties"),
        {
          title,
          description,
          price: Number(price),
          location,
          brokerId: user.uid,
          createdAt: new Date(),
        }
      );

      alert("Property Created");

      setTitle("");
      setDescription("");
      setPrice("");
      setLocation("");

    } catch (error: Error | unknown) {
      alert(error instanceof Error ? error.message : "An error occurred");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-10">

      <h1 className="text-3xl font-bold">
        Create Property
      </h1>

      <input
        className="border p-2"
        placeholder="Property Title"
        value={title}
        onChange={(e) =>
          setTitle(e.target.value)
        }
      />

      <textarea
        className="border p-2"
        placeholder="Description"
        value={description}
        onChange={(e) =>
          setDescription(e.target.value)
        }
      />

      <input
        className="border p-2"
        placeholder="Price"
        value={price}
        onChange={(e) =>
          setPrice(e.target.value)
        }
      />

      <input
        className="border p-2"
        placeholder="Location"
        value={location}
        onChange={(e) =>
          setLocation(e.target.value)
        }
      />

      <button
        className="bg-black text-white p-2"
        onClick={createProperty}
      >
        Create Property
      </button>

    </div>
  );
}