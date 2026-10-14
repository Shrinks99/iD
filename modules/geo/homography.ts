import type { Vec2 } from './vector.js';

/** A 3×3 matrix in row-major order: `[a, b, c, d, e, f, g, h, i]` */
export type Mat3 = [
    a: number, b: number, c: number,
    d: number, e: number, f: number,
    g: number, h: number, i: number
];

/** Four corners in the order top-left, top-right, bottom-right, bottom-left */
export type Quad = [tl: Vec2, tr: Vec2, br: Vec2, bl: Vec2];


function multiply(m: Mat3, n: Mat3): Mat3 {
    return [
        m[0] * n[0] + m[1] * n[3] + m[2] * n[6],
        m[0] * n[1] + m[1] * n[4] + m[2] * n[7],
        m[0] * n[2] + m[1] * n[5] + m[2] * n[8],
        m[3] * n[0] + m[4] * n[3] + m[5] * n[6],
        m[3] * n[1] + m[4] * n[4] + m[5] * n[7],
        m[3] * n[2] + m[4] * n[5] + m[5] * n[8],
        m[6] * n[0] + m[7] * n[3] + m[8] * n[6],
        m[6] * n[1] + m[7] * n[4] + m[8] * n[7],
        m[6] * n[2] + m[7] * n[5] + m[8] * n[8]
    ];
}


// The adjugate is proportional to the inverse, which is all
// that matters for a projective transform.
function adjugate(m: Mat3): Mat3 {
    return [
        m[4] * m[8] - m[5] * m[7],
        m[2] * m[7] - m[1] * m[8],
        m[1] * m[5] - m[2] * m[4],
        m[5] * m[6] - m[3] * m[8],
        m[0] * m[8] - m[2] * m[6],
        m[2] * m[3] - m[0] * m[5],
        m[3] * m[7] - m[4] * m[6],
        m[1] * m[6] - m[0] * m[7],
        m[0] * m[4] - m[1] * m[3]
    ];
}


/**
 * Projective transform mapping the rectangle `[0, 0] – [width, height]`
 * onto `quad`, using the closed-form square-to-quad solution
 * (Heckbert, "Fundamentals of Texture Mapping and Image Warping", 1989).
 * `width` and `height` default to 1 (the unit square).
 */
export function geoHomographySquareToQuad(quad: Quad, width = 1, height = 1): Mat3 {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
    const dx3 = x0 - x1 + x2 - x3;
    const dy3 = y0 - y1 + y2 - y3;
    let m: Mat3;

    if (dx3 === 0 && dy3 === 0) {   // parallelogram, affine is enough
        m = [
            x1 - x0, x2 - x1, x0,
            y1 - y0, y2 - y1, y0,
            0, 0, 1
        ];
    } else {
        const dx1 = x1 - x2;
        const dx2 = x3 - x2;
        const dy1 = y1 - y2;
        const dy2 = y3 - y2;
        const den = dx1 * dy2 - dx2 * dy1;
        const g = (dx3 * dy2 - dx2 * dy3) / den;
        const h = (dx1 * dy3 - dx3 * dy1) / den;
        m = [
            x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
            y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
            g, h, 1
        ];
    }

    if (width !== 1 || height !== 1) {
        m = multiply(m, [1 / width, 0, 0, 0, 1 / height, 0, 0, 0, 1]);
    }
    return m;
}


/** Projective transform mapping the four points of `src` onto the four points of `dst` */
export function geoHomography(src: Quad, dst: Quad): Mat3 {
    return multiply(geoHomographySquareToQuad(dst), adjugate(geoHomographySquareToQuad(src)));
}


/** Inverse of a projective transform (up to scale) */
export function geoHomographyInvert(m: Mat3): Mat3 {
    return adjugate(m);
}


/** Apply a projective transform to a point */
export function geoHomographyApply(m: Mat3, p: Vec2): Vec2 {
    const w = m[6] * p[0] + m[7] * p[1] + m[8];
    return [
        (m[0] * p[0] + m[1] * p[1] + m[2]) / w,
        (m[3] * p[0] + m[4] * p[1] + m[5]) / w
    ];
}


/**
 * CSS `matrix3d()` value for a projective transform of an element
 * whose `transform-origin` is `0 0`.
 * The matrix is scaled so that `w` is positive at the origin, because
 * browsers clip any part of an element where `w <= 0`.
 */
export function geoHomographyToCssMatrix3d(m: Mat3): string {
    const s = m[8] < 0 ? -1 : 1;
    const [a, b, c, d, e, f, g, h, i] = m.map(v => v * s);
    // CSS lists the 4×4 matrix column by column
    return `matrix3d(${[
        a, d, 0, g,
        b, e, 0, h,
        0, 0, 1, 0,
        c, f, 0, i
    ].join(',')})`;
}


/**
 * Whether `quad` is a convex, non-mirrored quadrilateral with an area of
 * at least `minArea`. Points are expected in screen space (y pointing down),
 * so the corners top-left, top-right, bottom-right, bottom-left turn clockwise.
 * Bow-ties, concave and mirrored quads can't be rendered sensibly.
 */
export function geoQuadIsValid(quad: Quad, minArea = 1): boolean {
    let area = 0;
    for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        const c = quad[(i + 2) % 4];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (!(cross > 0)) return false;    // also catches NaN
        area += a[0] * b[1] - b[0] * a[1];
    }
    return area / 2 >= minArea;
}
