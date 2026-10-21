/**
 * The outline of one shape of the Stratemark mark, measured from the artwork (assets/logo-mark.svg): two chains of points, each from
 * the shape's blunt end to its sharp end, one along the rounded outer edge and one along the straight edge. The other shape is the
 * first turned half a circle about MARK_CENTRE (the mark is point-symmetric), so only one is stored.
 */
export const MARK_CENTRE: readonly [number, number] = [37.3, 43.5];
export const MARK_OUTER: ReadonlyArray<readonly [number, number]> = [[23.44, 47.31], [23.25, 45.98], [23.26, 44.62], [23.28, 43.26], [23.29, 41.9], [23.35, 40.54], [23.47, 39.18], [23.7, 37.84], [24.05, 36.52], [24.54, 35.25], [25.16, 34.04], [25.91, 32.9], [26.74, 31.82], [27.66, 30.82], [28.69, 29.92], [29.8, 29.14], [30.98, 28.46], [32.23, 27.91], [33.51, 27.46], [34.84, 27.13], [36.18, 26.92], [37.54, 26.83], [38.9, 26.84], [40.26, 26.84], [41.63, 26.86], [42.99, 26.89], [44.35, 26.92], [45.71, 26.95], [47.07, 26.99], [48.39, 27.17]];
export const MARK_EDGE: ReadonlyArray<readonly [number, number]> = [[23.44, 47.31], [24.61, 47.45], [25.79, 47.46], [26.97, 47.42], [28.15, 47.35], [29.33, 47.21], [30.47, 46.9], [31.57, 46.47], [32.62, 45.93], [33.59, 45.26], [34.5, 44.5], [35.32, 43.65], [36.08, 42.75], [36.85, 41.85], [37.62, 40.95], [38.38, 40.05], [39.14, 39.15], [39.91, 38.25], [40.68, 37.35], [41.44, 36.45], [42.21, 35.55], [42.97, 34.64], [43.74, 33.74], [44.5, 32.84], [45.26, 31.94], [46.02, 31.03], [46.78, 30.13], [47.54, 29.22], [48.3, 28.31], [48.39, 27.17]];
