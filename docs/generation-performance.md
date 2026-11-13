# Generation performance

For SIFT captures above 40 photos with explicit view labels, opposing top/bottom
pairs first receive a spatially spread 192-descriptor overlap probe. A pair with
plausible shared geometry still receives the original full-resolution match.
All same-view and surrounding-ring pairs retain the complete search.

When the initial graph is disconnected, only deferred pairs that could bridge
different components are expanded. Remaining deferred pairs survive component
selection and are fully restored if camera fitting fails. The original matching,
inlier, connectivity and camera-quality gates still apply. Unlabelled uploads,
ORB and small sets retain the complete search.

Images already within the 1600px working limit reuse their decoded buffers.
Ceiling correction converts each native keypoint vector once per photo and
reuses camera matrices and homogeneous coordinates during graph scoring.
The same ceiling graph and numeric quality checks remain in place.

## Local 64-photo comparison

The saved successful capture was resized using the existing server batch budget
and processed with OpenCV 4.14 on the same machine:

| Measurement | Complete search | Optimized search |
| --- | ---: | ---: |
| Full descriptor comparisons | 2,016 | 1,366 |
| Matching stage | 116.5 s | 70.3 s |
| Verified links | 238 | 238 |
| Previously disconnected optional photo | Same | Same |

The optimized run checked 25 possible connectivity bridges and retained 650
deferred comparisons for camera-fit recovery. Reusing image buffers avoided
299,774,592 bytes of additional copies. These are local stage measurements,
not a guarantee of total production latency. Source photos and private benchmark
files stay uncommitted under `.local/`.

Results now include `stage_timings_ms` and
`camera_report.matching_report` for per-capture profiling. Regression tests cover
unchanged verified geometry, incorrectly labelled capture groups, isolated optional
photos, feature reuse during expansion, and full-search camera recovery.
