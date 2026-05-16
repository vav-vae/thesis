"use client";

import { useState } from "react";

export default function PanoramaTestPage() {

  const [images, setImages] =
    useState<FileList | null>(null);

  const [panorama, setPanorama] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const generatePanorama = async () => {

    if (!images) {
      alert("Select images first");
      return;
    }

    try {

      setLoading(true);

      const formData = new FormData();

      // APPEND FILES
      for (let i = 0; i < images.length; i++) {

        formData.append(
          "files",
          images[i]
        );

      }

      // SEND TO FASTAPI
      const response = await fetch(
        "http://127.0.0.1:8000/stitch",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      console.log(data);

      if (data.success) {

        setPanorama(
          "http://127.0.0.1:8000/" +
          data.panorama
        );

      } else {

        alert(data.error);

      }

    } catch (error) {

      console.log(error);

      alert("Panorama generation failed");

    } finally {

      setLoading(false);

    }
  };

  return (
    <div className="p-10 flex flex-col gap-4">

      <h1 className="text-3xl font-bold">
        Panorama Reconstruction Test
      </h1>

      <input
        type="file"
        multiple
        onChange={(e) =>
          setImages(e.target.files)
        }
      />

      <button
        className="bg-black text-white p-2"
        onClick={generatePanorama}
      >
        Generate Panorama
      </button>

      {loading && (
        <p>Generating panorama...</p>
      )}

      {panorama && (

        <div className="mt-10">

          <h2 className="text-2xl font-bold mb-4">
            Generated Panorama
          </h2>

          <img
            src={panorama}
            alt="Panorama"
            className="border rounded"
          />

        </div>

      )}

    </div>
  );
}