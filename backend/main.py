from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from typing import List

import cv2
import numpy as np
import os

from services.panorama_service import stitch_images
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ALLOW FRONTEND
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CREATE OUTPUT FOLDER
os.makedirs("outputs", exist_ok=True)
app.mount(
    "/outputs",
    StaticFiles(directory="outputs"),
    name="outputs"
)


@app.get("/")
def home():
    return {
        "message": "LiBot Panorama API Running"
    }


@app.post("/stitch")
async def stitch(
    files: List[UploadFile] = File(...)
):

    try:

        images = []

        # READ IMAGES
        for file in files:

            contents = await file.read()

            np_array = np.frombuffer(
                contents,
                np.uint8
            )

            image = cv2.imdecode(
                np_array,
                cv2.IMREAD_COLOR
            )

            if image is None:
                raise Exception(
                    "Invalid image uploaded"
                )

            images.append(image)

        # NEED AT LEAST 2 IMAGES
        if len(images) < 2:
            raise Exception(
                "Upload at least 2 images"
            )

        # STITCH IMAGES
        panorama = stitch_images(images)

        # SAVE OUTPUT
        output_path = "outputs/panorama.jpg"

        cv2.imwrite(
            output_path,
            panorama
        )

        return {
            "success": True,
            "panorama": output_path
        }

    except Exception as e:

        return {
            "success": False,
            "error": str(e)
        }