# LiBot hybrid panorama reconstruction

## Workflow

1. The broker captures at least six guided landscape images from one fixed position; there is no fixed photo-count cap within the byte, pixel, and processing budgets.
2. **Finish & generate** runs local image checks, uploads the set to Cloudinary, and sends source URLs and `capture_views` directly to `/reconstruct/hybrid/remote`. That request validates overlap and reconstructs in one pass. Closing the camera to review still offers the separate preflight workflow.
3. Validation checks image quality and the verified overlap graph. A low sharpness or exposure score is a warning when strong feature matches still support alignment. Disconnected surrounding views remain blocking errors.
4. Optional ceiling/floor views that cannot connect to a core containing every surrounding image may be excluded when at least six connected photos remain. Their indices and missing coverage are disclosed; their pixels are never claimed as captured.
5. SIFT (or ORB), feature matching, MAGSAC homography fitting, rotation geometry checks, camera estimation, and bundle adjustment reconstruct supported pixels onto a true 4096×2048 spherical canvas.
6. An evidence mask follows projection. Missing ceiling/floor areas remain unsupported rather than being represented as photographed detail.
7. `placeholder_ai_gap_fill` changes only missing-mask pixels. It currently uses deterministic OpenCV Telea inpainting and is the sole replacement point for a future AI provider.
8. The panorama, generated-region mask, metrics, region bounds, and disclosure are returned and saved with the room tour.

### Larger capture sets

SIFT uses at most 4,000 features per photo and reuses a FLANN search index per destination. Keypoint coordinates are converted once per image. Native matcher containers are allocated with an empty pair mask, avoiding a duplicate matching pass. All verified links contribute to quality reports; camera refinement uses at most 200 spatially spread inliers per link to bound its residual count. Excluding disconnected optional views reuses the already verified matches.

Pair acceptance checks camera-rotation compatibility across plausible focal scales. Nearly collapsed and reflected homographies are rejected even if a repeated texture supplies many apparent inliers. A physical fit with at least 15 inliers and 20% inlier support can connect a set even when the old heuristic confidence score was below 1; final fitted-camera reprojection checks still apply.

The live top/bottom guide uses three targets: a 30° row connected to wall details, a 60° row overlapping that row, then 90° overhead/below. Each row retains its own heading. The old 45° jump left insufficient vertical overlap on the supplied live-capture fixture.

Initial camera estimation uses the full verified inlier counts as spanning-tree weights, then restores the bounded sample counts before optimization. If ray adjustment fails, produces nonfinite parameters, or fails the image-point fit check, the processor retries pixel reprojection with fixed image centres and aspect ratio. A final bounded attempt fixes intrinsics and refines rotations. Every accepted solution must have a connected graph of geometrically consistent image links covering every retained photograph and a bounded median reprojection error. `camera_report` records the method, recovery flag, and measured pixel error. An optimizer failure does not automatically require recapturing the entire set; unrecoverable fit errors identify the photos with the largest discrepancies when available.

The streamed generation response reports detail extraction, overlap checks, camera alignment, rendering, and storage. Runtime logs include request ID, photo count, elapsed time, and stage. Source and output resolution and the byte/pixel budgets remain unchanged.

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

Multipart fields: repeated `files` and `algorithm`. Returns per-image issues and verified overlap links across the image set. The active browser uses `/validate/remote` with owned source URLs and optional `capture_views`. Its response includes `used_image_indices` and `excluded_image_indices`.

### `POST /reconstruct/hybrid`

Multipart fields:

- `files`: at least 6 overlapping images
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

- `analyze_image_sequence`: image quality and connected overlap validation
- `prepare_spherical_matches`: SIFT/FLANN or ORB/BF matching and verified RANSAC graph
- `reconstruct_sphere`: joint camera estimation, bundle adjustment, and spherical evidence projection
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

LiBot reconstructs a spherical panorama from at least six landscape photographs taken from one fixed lens position. SIFT descriptors use indexed FLANN matching; the optional ORB mode uses brute force matching. RANSAC verifies shared scene features across the image set. The connected overlap graph supports joint camera rotation estimation and bundle adjustment, followed by projection and feather blending onto a 4096×2048 equirectangular canvas. A parallel evidence mask records photographed pixels. Optional disconnected ceiling or floor views may be excluded with a disclosure; disconnected surrounding views remain errors. Missing regions may receive bounded inpainting and are identified separately in the stored mask and metadata. Reconstruction confidence combines verified inlier consistency and photographed coverage; generated pixels do not increase evidence coverage.
