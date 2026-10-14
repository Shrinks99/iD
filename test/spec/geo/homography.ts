import type { Quad } from '../../../modules/geo/homography';

describe('iD.geo - homography', () => {
    const unit: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const trapezoid: Quad = [[10, 20], [110, 0], [130, 160], [0, 120]];

    // rounds away floating point noise (and -0)
    function round(p: [number, number]) {
        return p.map(v => Math.round(v * 1e6) / 1e6 + 0);
    }

    describe('geoHomographySquareToQuad', () => {
        it('returns the identity for the unit square', () => {
            expect(iD.geoHomographySquareToQuad(unit)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        });

        it('returns an affine transform for a parallelogram', () => {
            const m = iD.geoHomographySquareToQuad([[0, 0], [2, 1], [3, 3], [1, 2]]);
            expect(m.slice(6)).toEqual([0, 0, 1]);
            expect(round(iD.geoHomographyApply(m, [0.5, 0.5]))).toEqual([1.5, 1.5]);
        });

        it('maps the corners of a width × height rectangle onto the quad', () => {
            const m = iD.geoHomographySquareToQuad(trapezoid, 400, 300);
            expect(round(iD.geoHomographyApply(m, [0, 0]))).toEqual(trapezoid[0]);
            expect(round(iD.geoHomographyApply(m, [400, 0]))).toEqual(trapezoid[1]);
            expect(round(iD.geoHomographyApply(m, [400, 300]))).toEqual(trapezoid[2]);
            expect(round(iD.geoHomographyApply(m, [0, 300]))).toEqual(trapezoid[3]);
        });
    });

    describe('geoHomography', () => {
        it('maps each source corner to the matching target corner', () => {
            const src: Quad = [[-3, -2], [5, -1], [4, 6], [-2, 5]];
            const m = iD.geoHomography(src, trapezoid);
            src.forEach((p, i) => expect(round(iD.geoHomographyApply(m, p))).toEqual(trapezoid[i]));
        });

        it('round-trips through its inverse', () => {
            const m = iD.geoHomographySquareToQuad(trapezoid, 400, 300);
            const inv = iD.geoHomographyInvert(m);
            const p: [number, number] = [123, 45];
            expect(round(iD.geoHomographyApply(inv, iD.geoHomographyApply(m, p)))).toEqual(p);
        });
    });

    describe('geoHomographyToCssMatrix3d', () => {
        it('lists the matrix column by column', () => {
            expect(iD.geoHomographyToCssMatrix3d([1, 2, 3, 4, 5, 6, 7, 8, 9]))
                .toBe('matrix3d(1,4,0,7,2,5,0,8,0,0,1,0,3,6,0,9)');
        });

        it('flips the sign so that w is positive at the origin', () => {
            expect(iD.geoHomographyToCssMatrix3d([1, 0, 0, 0, 1, 0, 0, 0, -2]))
                .toBe('matrix3d(-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,2)');
        });
    });

    describe('geoQuadIsValid', () => {
        it('accepts convex quads ordered clockwise on screen', () => {
            expect(iD.geoQuadIsValid(unit, 0.5)).toBe(true);
            expect(iD.geoQuadIsValid(trapezoid)).toBe(true);
        });

        it('rejects mirrored quads', () => {
            expect(iD.geoQuadIsValid([[0, 0], [0, 1], [1, 1], [1, 0]], 0.5)).toBe(false);
        });

        it('rejects concave quads', () => {
            expect(iD.geoQuadIsValid([[0, 0], [10, 0], [2, 2], [0, 10]])).toBe(false);
        });

        it('rejects bow-ties', () => {
            expect(iD.geoQuadIsValid([[0, 0], [10, 0], [0, 10], [10, 10]])).toBe(false);
        });

        it('rejects quads smaller than minArea', () => {
            expect(iD.geoQuadIsValid(unit, 2)).toBe(false);
        });

        it('rejects quads containing NaN', () => {
            expect(iD.geoQuadIsValid([[0, 0], [NaN, 0], [1, 1], [0, 1]], 0)).toBe(false);
        });
    });
});
