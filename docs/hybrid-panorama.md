# LiBot hybrid panorama reconstruction

## Workflow

1. The broker captures eight guided landscape images from one fixed position. The API accepts 6–12 images.
2. `POST /validate` checks orientation, resolution, sharpness, brightness, feature count, and consecutive overlap.
3. `POST /reconstruct/hybrid` rejects sequences with blocking quality or overlap errors.
4. ORB (or optional SIFT), BFMatcher, Lowe ratio filtering, RANSAC homography estimation, and `warpPerspective` reconstruct all supported pixels.
5. An evidence mask follows every geometric warp. Black mask pixels have no uploaded-image support.
6. The mosaic is fitted to a 2:1 equirectangular output without claiming that padding is real evidence.
7. `placeholder_ai_gap_fill` changes only missing-mask pixels. It currently uses deterministic OpenCV Telea inpainting and is the sole replacement point for a future AI provider.
8. The panorama, generated-region mask, metrics, region bounds, and disclosure are returned and saved with the room tour.

## Firestore schema

The target schema is `properties/{propertyId}/rooms/{roomId}`:

```ts
{
  roomName: "Living Room",
  captureMode: "guided_hybrid",
  sourceImageUrls: ["https://res.cloudinary.com/..."],
  panoramaUrl: "https://res.cloudinary.com/...",
  aiGeneratedMaskUrl: "https://res.cloudinary.com/...",
  reconstructionStatus: "pending" | "processing" | "completed" | "failed",
  reconstructionConfidence: 0.83,
  overlapReport: [{ from_index: 0, to_index: 1, good_matches: 94, inliers: 71, inlier_ratio: 0.755, issues: [] }],
  ransacReport: [{ pair: 1, candidate_matches: 3400, good_matches: 94, inliers: 71, inlier_ratio: 0.755 }],
  aiCompletionUsed: true,
  aiGeneratedRegions: [{
    id: "gap-1",
    pixel_bounds: { x: 0, y: 0, width: 2048, height: 120 },
    normalized_bounds: { x: 0, y: 0, width: 1, height: 0.117188 },
    pixel_count: 245760,
    canvas_ratio: 0.117188,
    source: "ai_placeholder"
  }],
  disclosureMessage: "Some missing regions were completed by an inpainting placeholder and may not represent exact property details.",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

The current application reads the top-level `roomTours` collection. The broker flow therefore writes these fields there for backward compatibility. A later data migration can mirror or move these documents into each property's `rooms` subcollection after buyer and broker queries are updated together.

## FastAPI endpoints

### `POST /validate`

Multipart fields: repeated `files` and `algorithm`. Returns per-image issues and consecutive-pair overlap reports. This is a preflight operation and does not create output.

### `POST /reconstruct/hybrid`

Multipart fields:

- `files`: 6–12 images in clockwise capture order
- `algorithm`: `orb` (default) or `sift`
- `ransac_threshold`: 1–10 pixels, default 4
- `fill_gaps`: boolean, default true

Response:

```json
{
  "success": true,
  "panorama_url": "/outputs/hybrid-....jpg",
  "ai_mask_url": "/outputs/hybrid-...-ai-mask.png",
  "metadata": {
    "reconstruction_confidence": 0.8311,
    "evidence_coverage_ratio": 0.9725,
    "average_inlier_ratio": 0.7546,
    "overlap_report": [],
    "ransac_report": [],
    "ai_completion_used": true,
    "ai_generated_regions": [],
    "disclosure_message": "..."
  }
}
```

White pixels in `ai_mask_url` identify output pixels without source-image evidence. This mask must remain associated with the panorama even if the placeholder is later replaced with a generative inpainting model.

## Service structure

- `analyze_image_sequence`: image quality and consecutive overlap validation
- `_stitch_pair`: ORB/SIFT, BFMatcher, RANSAC, homography, warp, blend, and evidence-mask propagation
- `_fit_to_equirectangular`: 2:1 output canvas normalization
- `describe_missing_regions`: connected-component region metadata
- `placeholder_ai_gap_fill`: isolated completion-provider hook
- `reconstruct_hybrid_panorama`: workflow orchestration, confidence, reports, and disclosure

## Confidence interpretation

The prototype confidence is bounded to 0–1 and calculated as `65% mean RANSAC inlier ratio + 35% real-evidence coverage`. AI-filled pixels do not increase either term. This score is a reconstruction-quality indicator, not a probability that every depicted detail is correct.

## Marzipano integration

`PanoramaViewer` is a client component because Marzipano requires browser APIs. It uses `ImageUrlSource`, `EquirectGeometry`, and `RectilinearView`, creates one scene for the Cloudinary panorama URL, switches to it, and destroys the viewer during React cleanup. The final image must remain 2:1 for correct equirectangular display.

## Methodology paragraph

LiBot applies an evidence-first hybrid panorama reconstruction method in which six to twelve guided landscape photographs are captured sequentially from a fixed room position. Each image is assessed for orientation, resolution, sharpness, brightness, and detectable visual features, while consecutive views are evaluated for sufficient shared content. ORB keypoints and binary descriptors are matched using a brute-force matcher, after which RANSAC estimates robust homographies by excluding inconsistent correspondences. Valid images are geometrically aligned through perspective warping and blended into a common canvas while a parallel evidence mask records every pixel supported by an uploaded photograph. Missing regions are detected from this mask and may be completed only through a separately bounded inpainting stage; completed pixels remain identified through a stored mask, region metadata, and a user-facing disclosure. Reconstruction confidence combines RANSAC inlier consistency and source-image coverage, ensuring that generated completion does not increase the measured evidential reliability of the virtual tour.
