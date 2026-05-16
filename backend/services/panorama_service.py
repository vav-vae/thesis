import cv2
import numpy as np


def stitch_images(images):

    # ORB DETECTOR
    orb = cv2.ORB_create(5000)

    stitched_image = images[0]

    for i in range(1, len(images)):

        image1 = stitched_image
        image2 = images[i]

        # CONVERT TO GRAYSCALE
        gray1 = cv2.cvtColor(
            image1,
            cv2.COLOR_BGR2GRAY
        )

        gray2 = cv2.cvtColor(
            image2,
            cv2.COLOR_BGR2GRAY
        )

        # DETECT KEYPOINTS
        keypoints1, descriptors1 = orb.detectAndCompute(
            gray1,
            None
        )

        keypoints2, descriptors2 = orb.detectAndCompute(
            gray2,
            None
        )

        # BF MATCHER
        matcher = cv2.BFMatcher(
            cv2.NORM_HAMMING,
            crossCheck=True
        )

        matches = matcher.match(
            descriptors1,
            descriptors2
        )

        # SORT MATCHES
        matches = sorted(
            matches,
            key=lambda x: x.distance
        )

        # NEED MINIMUM MATCHES
        if len(matches) < 10:
            raise Exception(
                "Not enough matches found"
            )

        # EXTRACT MATCH POINTS
        src_points = np.float32([
            keypoints1[m.queryIdx].pt
            for m in matches
        ]).reshape(-1, 1, 2)

        dst_points = np.float32([
            keypoints2[m.trainIdx].pt
            for m in matches
        ]).reshape(-1, 1, 2)

        # HOMOGRAPHY USING RANSAC
        H, mask = cv2.findHomography(
            dst_points,
            src_points,
            cv2.RANSAC,
            5.0
        )

        if H is None:
            raise Exception(
                "Homography failed"
            )

        # WARP PERSPECTIVE
        height1, width1 = image1.shape[:2]
        height2, width2 = image2.shape[:2]

        panorama_width = width1 + width2
        panorama_height = max(
            height1,
            height2
        )

        warped_image = cv2.warpPerspective(
            image2,
            H,
            (panorama_width, panorama_height)
        )

        # PLACE FIRST IMAGE
        warped_image[
            0:height1,
            0:width1
        ] = image1

        stitched_image = warped_image

    return stitched_image