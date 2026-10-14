import { select as d3_select } from 'd3-selection';
import type { Vec2 } from '../../../modules/geo/vector';

// jsdom can't decode images, so pretend that every image is 400×200 px
class FakeImage {
    naturalWidth = 400;
    naturalHeight = 200;
    onload?: () => void;
    get src() { return ''; }
    set src(_: string) { window.setTimeout(() => this.onload?.()); }
}

describe('iD.rendererImageOverlay', () => {
    let content: d3.Selection;
    let context: iD.Context;
    let overlay: ReturnType<typeof iD.rendererImageOverlay>;
    const file = new File([''], 'site-plan.png', { type: 'image/png' });

    beforeEach(() => {
        vi.stubGlobal('Image', FakeImage);
        URL.createObjectURL = vi.fn(() => 'blob:image');
        URL.revokeObjectURL = vi.fn();

        content = d3_select('body').append<HTMLElement>('div');
        context = iD.coreContext().assetPath('../dist/').init().container(content);
        content.call(context.map());
        context.map().dimensions([1000, 500]);
        context.map().centerZoom([0, 0], 16);
        overlay = context.background().imageOverlay();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        content.remove();
    });

    describe('#load', () => {
        it('places the image in the middle of the map, keeping its aspect ratio', async () => {
            const spy = vi.fn();
            overlay.on('change.test', spy);
            await overlay.load(file);

            expect(overlay.hasImage()).toBe(true);
            expect(overlay.filename()).toBe('site-plan.png');
            expect(overlay.size()).toEqual([400, 200]);
            expect(spy).toHaveBeenCalled();

            const [tl, tr, br, bl] = overlay.screenCorners()!;
            expect(tl[0]).toBeCloseTo(200);
            expect(tl[1]).toBeCloseTo(100);
            expect(tr[0]).toBeCloseTo(800);
            expect(br[1]).toBeCloseTo(400);
            expect(bl[0]).toBeCloseTo(200);
        });

        it('rejects images which can not be decoded', async () => {
            vi.stubGlobal('Image', class {
                onerror?: () => void;
                get src() { return ''; }
                set src(_: string) { window.setTimeout(() => this.onerror?.()); }
            });
            await expect(overlay.load(file)).rejects.toThrow();
            expect(overlay.hasImage()).toBe(false);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image');
        });
    });

    describe('#fitToView', () => {
        function openPane() {
            const pane = content.append('div').attr('class', 'map-panes')
                .append('div').attr('class', 'map-pane shown');
            Object.defineProperty(pane.node(), 'offsetWidth', { value: 400 });
        }

        it('avoids the open pane on the right', async () => {
            openPane();
            await overlay.load(file);
            const [tl, tr] = overlay.screenCorners()!;
            expect(tl[0]).toBeCloseTo(120);
            expect(tr[0]).toBeCloseTo(480);
        });

        it('avoids the open pane on the left in right-to-left languages', async () => {
            vi.spyOn(iD.localizer, 'textDirection').mockReturnValue('rtl');
            openPane();
            await overlay.load(file);
            const [tl, tr] = overlay.screenCorners()!;
            expect(tl[0]).toBeCloseTo(520);
            expect(tr[0]).toBeCloseTo(880);
        });

        it('keeps the image within the bounds of the world, so that its position can be exported', async () => {
            context.map().centerZoom([150, 80], 2);
            await overlay.load(file);
            for (const [lon, lat] of overlay.corners()!) {
                expect(Math.abs(lon)).toBeLessThanOrEqual(180);
                expect(Math.abs(lat)).toBeLessThanOrEqual(85.06);
            }
            expect(() => overlay.applyGeoreference(JSON.parse(JSON.stringify(overlay.georeference())))).not.toThrow();
        });
    });

    describe('#remove', () => {
        it('removes the image and releases its URL', async () => {
            await overlay.load(file);
            overlay.remove();
            expect(overlay.hasImage()).toBe(false);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image');
        });
    });

    describe('#imageryUsed', () => {
        it('never contains the file name', async () => {
            await overlay.load(file);
            expect(overlay.imageryUsed()).toBe('Local image');
        });
    });

    describe('#georeference', () => {
        it('round-trips through JSON', async () => {
            await overlay.load(file);
            const corners = overlay.corners();
            const json = JSON.parse(JSON.stringify(overlay.georeference()));

            overlay.reset().corners([[1, 2], [3, 2], [3, 1], [1, 1]]);
            expect(overlay.applyGeoreference(json)).toEqual([]);
            expect(overlay.corners()).toEqual(corners);
        });

        it('has a counterclockwise polygon, as required by GeoJSON', async () => {
            await overlay.load(file);
            const ring = overlay.georeference()!.geometry.coordinates[0];
            let area = 0;
            for (let i = 0; i < ring.length - 1; i++) {
                area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
            }
            expect(area).toBeGreaterThan(0);
            expect(ring[0]).toEqual(ring[4]);
        });

        it('reads the corners from the polygon, so that it can be edited in other tools', async () => {
            await overlay.load(file);
            const json = overlay.georeference()!;
            const ring = json.geometry.coordinates[0].map(([lon, lat]) => [lon + 0.001, lat, 12]);
            json.geometry.coordinates = [ring as Vec2[]];

            expect(overlay.applyGeoreference(json)).toEqual([]);
            const [tl, bl, br, tr] = ring;
            expect(overlay.corners()).toEqual([tl, tr, br, bl].map(([lon, lat]) => [lon, lat]));
        });

        it('accepts clockwise polygons', async () => {
            await overlay.load(file);
            const corners = overlay.corners();
            const json = overlay.georeference()!;
            json.geometry.coordinates[0].reverse();

            overlay.reset().corners([[1, 2], [3, 2], [3, 1], [1, 1]]);
            overlay.applyGeoreference(json);
            expect(overlay.corners()).toEqual(corners);
        });

        it('warns if the georeference was saved for a different image', async () => {
            await overlay.load(file);
            const json = overlay.georeference()!;
            json.properties.filename = 'other.png';
            json.properties.width = 100;
            expect(overlay.applyGeoreference(json)).toEqual(['filename', 'aspect']);
        });

        it('throws for invalid georeferences', async () => {
            await overlay.load(file);
            const json = overlay.georeference()!;
            expect(() => overlay.applyGeoreference({})).toThrow();
            expect(() => overlay.applyGeoreference({ ...json, properties: { ...json.properties, format: 'x' } })).toThrow();

            // corners in the wrong order make a bow-tie
            const [tl, bl, br, tr] = json.geometry.coordinates[0];
            const bowTie = { ...json.geometry, coordinates: [[tl, br, bl, tr, tl]] };
            expect(() => overlay.applyGeoreference({ ...json, geometry: bowTie })).toThrow();

            const unclosed = { ...json.geometry, coordinates: [[tl, bl, br, tr, bl]] };
            expect(() => overlay.applyGeoreference({ ...json, geometry: unclosed })).toThrow();
        });
    });

    describe('#render', () => {
        it('draws the image with a perspective transform', async () => {
            await overlay.load(file);
            overlay.opacity(0.4);
            const selection = d3_select<HTMLElement, unknown>(document.createElement('div'));
            overlay.render(selection);

            const layer = selection.select('.layer-image-overlay');
            expect(layer.style('opacity')).toBe('0.4');
            const img = layer.select('img');
            expect(img.attr('src')).toBe('blob:image');
            expect(img.style('width')).toBe('400px');
            const transform = img.style('transform');
            expect(transform).toMatch(/^matrix3d\(.*\)$/);
            // 1.5× scale, and translated to the top left corner
            const values = transform.slice(9, -1).split(',').map(Number);
            [1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1, 0, 200, 100, 0, 1]
                .forEach((expected, i) => expect(values[i]).toBeCloseTo(expected, 6));
        });

        it('draws nothing when disabled', async () => {
            await overlay.load(file);
            overlay.enabled(false);
            const selection = d3_select<HTMLElement, unknown>(document.createElement('div'));
            overlay.render(selection);
            expect(selection.select('.layer-image-overlay').empty()).toBe(true);
        });
    });
});
